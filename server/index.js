const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { q, setting, ensureReady } = require('./db');
const A = require('./lib/auth');
const cat = require('./lib/catalog');
const { esc } = require('./lib/util');

const app = express();
const PROD = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(compression());
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-src https://www.youtube.com https://www.instagram.com; object-src 'none'; base-uri 'self'; form-action 'self'",
  });
  if (PROD) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '200kb', verify: (req, _res, buf) => { req.rawBody = buf; } })); // rawBody: validação da assinatura do webhook
// Garante schema + configurações carregadas (uma vez por instância; cache de 15 s)
app.use(async (_req, _res, next) => { await ensureReady(); next(); });
app.use(A.loadUser);
app.use(A.csrfGuard);

app.get('/img/p/:id.svg', require('./routes/store').imgHandler);
app.use('/api/admin', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, require('./routes/admin'));
app.use('/api', require('./routes/whatsapp').webhook);
app.use('/api', require('./routes/store'));
app.use('/api', require('./routes/account'));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

const PUB = path.join(__dirname, '..', 'public');
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { maxAge: '30d', immutable: true, setHeaders: (r) => r.set('Content-Disposition', 'inline') }));
app.get('/admin', (req, res, next) => (req.path === '/admin' && !req.originalUrl.split('?')[0].endsWith('/') ? res.redirect('/admin/') : next()));
app.use(express.static(PUB, { maxAge: PROD ? '1h' : 0, index: false }));

const base = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /admin/\nDisallow: /api/\nDisallow: /carrinho\nDisallow: /checkout\nDisallow: /conta\nSitemap: ${base(req)}/sitemap.xml\n`));
app.get('/sitemap.xml', async (req, res) => {
  const b = base(req), urls = ['/', '/ofertas'];
  const [ents, links, prods, pages] = await Promise.all([
    q.all('SELECT id,slug,type FROM entities WHERE active=1'),
    q.all('SELECT parent_id,child_id FROM entity_links'),
    q.all('SELECT slug FROM products WHERE active=1'),
    q.all('SELECT slug FROM pages'),
  ]);
  const byId = new Map(ents.map((e) => [e.id, e]));
  const kids = new Map();
  for (const l of links) { if (!byId.has(l.child_id)) continue; if (!kids.has(l.parent_id)) kids.set(l.parent_id, []); kids.get(l.parent_id).push(byId.get(l.child_id)); }
  for (const s of ents.filter((e) => e.type === 'sport')) {
    urls.push('/' + s.slug);
    for (const l of kids.get(s.id) || []) {
      urls.push(`/${s.slug}/${l.slug}`);
      for (const c of kids.get(l.id) || []) urls.push(`/${s.slug}/${l.slug}/${c.slug}`);
    }
  }
  for (const p of prods) urls.push('/produto/' + p.slug);
  for (const p of pages) urls.push('/pagina/' + p.slug);
  res.set('Cache-Control', 'public, s-maxage=3600').type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(urls)].map((u) => `<url><loc>${esc(b + u)}</loc></url>`).join('')}</urlset>`);
});

const adminHtml = () => fs.readFileSync(path.join(PUB, 'admin', 'index.html'), 'utf8');
app.get(/^\/admin\/.*/, (req, res, next) => (path.extname(req.path) ? next() : res.type('html').send(adminHtml())));

let tpl = null;
const template = () => (PROD && tpl) || (tpl = fs.readFileSync(path.join(__dirname, 'shell.html'), 'utf8'));
async function seo(req) {
  const name = setting('store_name', 'Sport Imperativo Store'), slogan = setting('slogan', 'Aqui você veste o esporte.');
  const b = base(req), p = req.path.replace(/\/+$/, '') || '/';
  let title = `${name} — ${slogan}`, desc = 'Camisas de futebol, NBA, NFL, F1, chuteiras, agasalhos e conjuntos. Pronta entrega e importados com parcelamento e Pix.', image = `${b}/img/og.svg`, ld = null;
  let m;
  if ((m = p.match(/^\/produto\/([\w-]+)$/))) {
    const row = await q.get('SELECT * FROM products WHERE slug=? AND active=1', m[1]);
    if (row) {
      const fp = await cat.fullProduct(row), pr = fp.pricing;
      title = row.meta_title || `${row.name} | ${name}`;
      desc = row.meta_description || `${row.name}. ${(row.description || '').slice(0, 120)} Pix R$ ${(pr.pix / 100).toFixed(2)} ou em até ${pr.installments.n}x no cartão.`;
      image = /^https?:/.test(fp.images[0].url) ? fp.images[0].url : b + fp.images[0].url;
      ld = [{ '@context': 'https://schema.org', '@type': 'Product', name: row.name, image: fp.images.map((i) => (/^https?:/.test(i.url) ? i.url : b + i.url)), description: row.description || row.name, sku: row.sku || String(row.id), brand: { '@type': 'Brand', name: (fp.entities.find((e) => e.type === 'brand') || {}).name || name },
        ...(row.rating_count ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: row.rating_avg, reviewCount: row.rating_count } } : {}),
        offers: { '@type': 'Offer', url: `${b}/produto/${row.slug}`, priceCurrency: 'BRL', price: (pr.final / 100).toFixed(2), availability: fp.availability.code === 'out' ? 'https://schema.org/OutOfStock' : fp.availability.code === 'on_demand' ? 'https://schema.org/PreOrder' : 'https://schema.org/InStock', itemCondition: 'https://schema.org/NewCondition' } },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Início', item: b + '/' }, { '@type': 'ListItem', position: 2, name: row.name, item: `${b}/produto/${row.slug}` }] }];
    }
  } else if ((m = p.match(/^\/pagina\/([\w-]+)$/))) {
    const pg = await q.get('SELECT title FROM pages WHERE slug=?', m[1]); if (pg) title = `${pg.title} | ${name}`;
  } else if (p === '/ofertas') { title = `Ofertas | ${name}`; desc = 'Camisas e chuteiras em oferta com desconto, Pix e parcelamento.'; }
  else if (/^\/[a-z0-9-]+(\/[a-z0-9-]+){0,5}$/.test(p) && !['/carrinho', '/checkout', '/login', '/cadastro', '/busca', '/favoritos'].includes(p) && !p.startsWith('/conta') && !p.startsWith('/pedido')) {
    const ents = await Promise.all(p.slice(1).split('/').map((s) => q.get('SELECT name,description FROM entities WHERE slug=? AND active=1', s)));
    if (ents.every(Boolean)) {
      const names = ents.map((e) => e.name);
      title = `${names.slice().reverse().join(' ')} | ${name}`;
      desc = ents[ents.length - 1].description || `Compre ${names.slice().reverse().join(' ')} na ${name}. Pix, parcelamento e enviamos para o mundo todo.`;
      ld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: ents.map((e, i) => ({ '@type': 'ListItem', position: i + 1, name: e.name, item: `${b}/${p.slice(1).split('/').slice(0, i + 1).join('/')}` })) }];
    }
  }
  const canon = b + (p === '/' ? '/' : p);
  return `<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canon)}">
<meta property="og:type" content="${ld && ld[0]['@type'] === 'Product' ? 'product' : 'website'}"><meta property="og:site_name" content="${esc(name)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canon)}"><meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">
${ld ? ld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`).join('\n') : ''}`;
}
app.get('/img/og.svg', (_req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#06132e"/><stop offset="1" stop-color="#0b5cff"/></linearGradient></defs><rect width="1200" height="630" fill="url(#g)"/><text x="80" y="300" font-family="Arial Black,Arial" font-size="84" fill="#fff">SPORT IMPERATIVO</text><text x="80" y="380" font-family="Arial" font-size="40" fill="#cfe0ff" letter-spacing="6">AQUI VOCÊ VESTE O ESPORTE.</text></svg>'));

app.use(async (req, res, next) => {
  if (req.method !== 'GET' || path.extname(req.path)) return next();
  res.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
  res.type('html').send(template().replace('<!--SEO-->', await seo(req)));
});
app.use((err, req, res, _next) => {
  const status = err.config ? 503 : err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  if (req.path.startsWith('/api')) return res.status(status).json({ error: err.config ? err.message : status === 413 ? 'Arquivo grande demais para envio direto (limite ~4 MB na Vercel). Use URL externa para vídeos grandes.' : status >= 500 ? 'Erro interno. Tente novamente.' : err.message });
  if (err.config) return res.status(503).type('html').send(`<!doctype html><meta charset="utf-8"><title>Configuração pendente</title><body style="font-family:system-ui;max-width:640px;margin:12vh auto;padding:0 16px"><h1>Configuração pendente</h1><p>${esc(err.message)}</p></body>`);
  res.status(status).send('Erro');
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  require('./seed').ensureSeed().then((first) => {
    if (first) console.log('Banco inicializado com dados de demonstração.');
    app.listen(PORT, () => console.log(`Sport Imperativo Store rodando em http://localhost:${PORT}  (admin: /admin/)`));
  }).catch((e) => { console.error(e); process.exit(1); });
}
module.exports = app;
