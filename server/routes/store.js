const express = require('express');
const { q, allSettings } = require('../db');
const cat = require('../lib/catalog');
const { priceCart } = require('../lib/cart');
const art = require('../lib/art');
const { wrap, HttpError, norm, onlyDigits } = require('../lib/util');

const r = express.Router();
const PUBLIC_SETTINGS = ['store_name', 'slogan', 'whatsapp', 'instagram', 'tiktok', 'youtube', 'email', 'pix_pct', 'max_installments', 'import_notice', 'free_shipping_over_cents', 'personalization_cents', 'instagram_feedback_url', 'company_name', 'cnpj'];
const cacheHdr = (res, s = 60) => res.set('Cache-Control', `public, s-maxage=${s}, stale-while-revalidate=${s * 5}, max-age=${Math.min(s, 30)}`);

r.get('/config', wrap(async (_req, res) => {
  const s = allSettings(), o = {};
  for (const k of PUBLIC_SETTINGS) o[k] = s[k] ?? '';
  cacheHdr(res);
  res.json({ settings: o, sizes: (await q.all('SELECT name FROM sizes ORDER BY sort,name')).map((x) => x.name) });
}));
r.get('/menu', wrap(async (_req, res) => { cacheHdr(res); res.json(await cat.buildMenu()); }));

r.get('/home', wrap(async (_req, res) => {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const [banners, best, offers, news, sports, testimonials] = await Promise.all([
    q.all(`SELECT id,title,subtitle,cta_text,link,image_desktop,image_mobile FROM banners WHERE active=1 AND (starts_at IS NULL OR starts_at='' OR starts_at<=?) AND (ends_at IS NULL OR ends_at='' OR ends_at>=?) ORDER BY sort,id`, now, now),
    q.all('SELECT * FROM products WHERE active=1 ORDER BY sold DESC, rating_count DESC, id DESC LIMIT 8').then(cat.cards),
    cat.listProducts({ sale: true, sort: 'discount' }, 1, 8).then((x) => x.items),
    q.all('SELECT * FROM products WHERE active=1 ORDER BY id DESC LIMIT 8').then(cat.cards),
    q.all("SELECT name,slug,logo,banner,description FROM entities WHERE type='sport' AND active=1 ORDER BY sort,name"),
    q.all('SELECT t.*, p.slug product_slug FROM testimonials t LEFT JOIN products p ON p.id=t.product_id WHERE t.active=1 ORDER BY t.sort,t.id LIMIT 24'),
  ]);
  cacheHdr(res, 30);
  res.json({ banners, best, offers, news, sports, testimonials });
}));

function parseFilters(qs) {
  const f = {};
  f.q = String(qs.q || '').slice(0, 80);
  f.entities = String(qs.e || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12);
  f.min = parseFloat(qs.min) || 0; f.max = parseFloat(qs.max) || 0;
  f.ship = ['stock', 'import'].includes(qs.ship) ? qs.ship : '';
  f.custom = qs.custom === '1'; f.sale = qs.sale === '1'; f.avail = qs.avail === '1';
  f.rating = parseFloat(qs.rating) || 0; f.size = qs.size ? String(qs.size).slice(0, 20) : '';
  f.sort = qs.sort || 'relevance';
  return f;
}
r.get('/products', wrap(async (req, res) => {
  const f = parseFilters(req.query);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const [list, facets] = await Promise.all([cat.listProducts(f, page, 24), req.query.facets === '1' ? cat.facets(f) : undefined]);
  res.json({ ...list, facets });
}));

// Resolve /futebol/premier-league/liverpool em um conjunto de entidades (ordem livre) e devolve a página de catálogo.
r.get('/catalog', wrap(async (req, res) => {
  const segs = String(req.query.path || '').split('/').map((s) => s.trim()).filter(Boolean);
  if (!segs.length || segs.length > 6) throw new HttpError(404, 'Página não encontrada.');
  const ents = [];
  for (const s of segs) {
    const e = await q.get('SELECT * FROM entities WHERE slug=? AND active=1', s);
    if (!e) throw new HttpError(404, 'Página não encontrada.');
    ents.push(e);
  }
  const f = parseFilters(req.query);
  f.entities = [...new Set([...segs, ...f.entities])];
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const main = [...ents].reverse().find((e) => e.type !== 'sport' && e.type !== 'category') || ents[ents.length - 1];
  const sport = ents.find((e) => e.type === 'sport');
  const [list, facets, children, catTabs] = await Promise.all([
    cat.listProducts(f, page, 24), cat.facets(f),
    q.all(`SELECT e.name,e.slug,e.type,e.logo FROM entity_links l JOIN entities e ON e.id=l.child_id WHERE l.parent_id=? AND e.active=1 ORDER BY l.sort,e.name`, main.id),
    q.all("SELECT name,slug FROM entities WHERE type='category' AND active=1 ORDER BY sort,name"),
  ]);
  res.json({
    entities: ents.map((e) => ({ id: e.id, type: e.type, name: e.name, slug: e.slug })), title: main.name, main: { name: main.name, type: main.type, logo: main.logo, banner: main.banner, description: main.description, color1: main.color1, color2: main.color2 },
    breadcrumbs: ents.map((e, i) => ({ name: e.name, path: '/' + segs.slice(0, i + 1).join('/') })), sport: sport ? sport.slug : null, children, categoryTabs: catTabs,
    ...list, facets,
  });
}));

r.get('/products/:slug', wrap(async (req, res) => {
  const p = await q.get('SELECT * FROM products WHERE slug=? AND active=1', req.params.slug);
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  const [product, reviewsRaw, ents, relatedRows, dist, feedbacks] = await Promise.all([
    cat.fullProduct(p),
    q.all("SELECT id,author,stars,body,photos,video_url,featured,created_at FROM reviews WHERE product_id=? AND status='approved' ORDER BY featured DESC,id DESC LIMIT 50", p.id),
    q.all('SELECT e.slug,e.type FROM product_entities pe JOIN entities e ON e.id=pe.entity_id WHERE pe.product_id=?', p.id),
    q.all(`SELECT p2.* FROM products p2 WHERE p2.active=1 AND p2.id!=? AND p2.id IN (SELECT product_id FROM product_entities WHERE entity_id IN (SELECT entity_id FROM product_entities WHERE product_id=?)) GROUP BY p2.id ORDER BY (SELECT COUNT(*) FROM product_entities a JOIN product_entities b ON a.entity_id=b.entity_id WHERE a.product_id=p2.id AND b.product_id=?) DESC, p2.sold DESC LIMIT 8`, p.id, p.id, p.id),
    q.all("SELECT stars,COUNT(*) n FROM reviews WHERE product_id=? AND status='approved' GROUP BY stars", p.id),
    q.all('SELECT t.*, p.slug product_slug FROM testimonials t LEFT JOIN products p ON p.id=t.product_id WHERE t.active=1 AND t.product_id=? ORDER BY t.sort,t.id', p.id),
  ]);
  const reviews = reviewsRaw.map((x) => ({ ...x, photos: JSON.parse(x.photos || '[]') }));
  const club = ents.find((e) => e.type === 'club' || e.type === 'national_team');
  const sport = ents.find((e) => e.type === 'sport');
  cacheHdr(res, 20);
  res.json({ product, feedbacks, reviews, related: await cat.cards(relatedRows), ratingDist: dist, crumbPath: sport ? '/' + sport.slug + (club ? '/' + club.slug : '') : '/' });
}));

r.get('/search/suggest', wrap(async (req, res) => {
  const term = String(req.query.q || '').slice(0, 60);
  const ts = cat.tokens(term);
  if (!ts.length || term.length < 2) return res.json({ entities: [], products: [] });
  const n = norm(term);
  const [entities, list] = await Promise.all([
    q.all(`SELECT e.type,e.name,e.slug,e.logo,(SELECT s.slug FROM entity_links l JOIN entities s ON s.id=l.parent_id WHERE l.child_id=e.id AND s.type='sport' LIMIT 1) sport_slug
      FROM entities e WHERE e.active=1 AND e.type NOT IN ('sport','category') AND (LOWER(e.name) LIKE ? OR e.slug LIKE ?) ORDER BY LENGTH(e.name) LIMIT 6`, `%${n}%`, `%${n.replace(/\s+/g, '-')}%`),
    cat.listProducts({ q: term, sort: 'relevance' }, 1, 6),
  ]);
  res.json({ entities, products: list.items });
}));

r.post('/cart/price', wrap(async (req, res) => {
  res.json(await priceCart({ items: req.body.items, cep: req.body.cep, method: req.body.method, coupon: req.body.coupon, userId: req.user && req.user.id }));
}));

const cepCache = new Map();
r.get('/cep/:cep', wrap(async (req, res) => {
  const cep = onlyDigits(req.params.cep);
  if (cep.length !== 8) throw new HttpError(400, 'CEP inválido.');
  if (cepCache.has(cep)) return res.json(cepCache.get(cep));
  try {
    const j = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(5000) })).json();
    if (j.erro) throw new HttpError(404, 'CEP não encontrado.');
    const out = { cep, street: j.logradouro, district: j.bairro, city: j.localidade, state: j.uf };
    cepCache.set(cep, out);
    res.json(out);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    res.json({ cep, street: '', district: '', city: '', state: '', manual: true });
  }
}));

r.get('/pages/:slug', wrap(async (req, res) => {
  const p = await q.get('SELECT slug,title,body FROM pages WHERE slug=?', req.params.slug);
  if (!p) throw new HttpError(404, 'Página não encontrada.');
  res.json(p);
}));
r.get('/size-guides', wrap(async (_req, res) => res.json((await q.all('SELECT * FROM size_guides ORDER BY id')).map((g) => ({ ...g, headers: JSON.parse(g.headers), rows: JSON.parse(g.rows) })))));
r.get('/testimonials', wrap(async (_req, res) => res.json(await q.all('SELECT t.*, p.slug product_slug FROM testimonials t LEFT JOIN products p ON p.id=t.product_id WHERE t.active=1 ORDER BY t.sort,t.id'))));

module.exports = r;
// Imagens ilustrativas geradas (produtos sem foto enviada)
module.exports.imgHandler = wrap(async (req, res) => {
  const p = await q.get('SELECT shape,color1,color2,style,name FROM products WHERE id=?', parseInt(req.params.id, 10));
  if (!p) return res.status(404).end();
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, s-maxage=86400, max-age=3600' });
  res.send(art.render({ shape: p.shape, c1: p.color1, c2: p.color2, style: p.style, label: p.name, view: req.query.v === '1' ? 1 : 0 }));
});
