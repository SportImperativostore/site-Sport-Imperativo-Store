const { q, setting } = require('../db');
const { norm } = require('./util');

const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function salePrice(p) {
  if (!p.sale_price_cents) return null;
  const n = nowSql();
  if (p.sale_starts && p.sale_starts > n) return null;
  if (p.sale_ends && p.sale_ends < n) return null;
  return p.sale_price_cents;
}
function pricing(p) {
  const orig = p.price_cents, sale = salePrice(p);
  const final = sale && sale < orig ? sale : orig;
  const pixPct = p.pix_pct ?? parseFloat(setting('pix_pct', '5'));
  const maxInst = p.max_installments || parseInt(setting('max_installments', '12'), 10);
  const minInst = parseInt(setting('min_installment_cents', '3000'), 10);
  const n = Math.max(1, Math.min(maxInst, Math.floor(final / minInst)));
  return {
    original: orig, final, onSale: final < orig, discountPct: final < orig ? Math.round((1 - final / orig) * 100) : 0,
    pix: Math.round(final * (1 - pixPct / 100)), pixPct, installments: { n, value: Math.ceil(final / n) },
  };
}
function availability(p, variants) {
  if (p.fulfillment === 'import') return { code: 'on_demand', label: 'SOB ENCOMENDA' };
  const total = variants && variants.length ? variants.reduce((a, v) => a + v.stock, 0) : p.stock;
  if (total <= 0) return { code: 'out', label: 'ESGOTADO' };
  if (total <= 3) return { code: 'low', label: 'ÚLTIMAS UNIDADES' };
  return { code: 'in_stock', label: 'PRONTA ENTREGA' };
}
const group = (rows, key) => { const m = new Map(); for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); } return m; };

/** Monta cards de vários produtos com 3 consultas em lote (evita N+1 com banco remoto). */
async function cards(products) {
  if (!products.length) return [];
  const ids = JSON.stringify(products.map((p) => p.id));
  const [ents, vars, imgs] = await Promise.all([
    q.all(`SELECT pe.product_id,e.type,e.name FROM product_entities pe JOIN entities e ON e.id=pe.entity_id WHERE pe.product_id IN (SELECT value FROM json_each(?))`, ids),
    q.all(`SELECT product_id,size,stock FROM variants WHERE product_id IN (SELECT value FROM json_each(?))`, ids),
    q.all(`SELECT product_id,url FROM product_images WHERE kind='image' AND product_id IN (SELECT value FROM json_each(?)) ORDER BY sort,id`, ids),
  ]);
  const E = group(ents, 'product_id'), V = group(vars, 'product_id'), I = group(imgs, 'product_id');
  return products.map((p) => {
    const es = E.get(p.id) || [];
    const pick = (t) => (es.find((e) => e.type === t) || {}).name || null;
    const pr = pricing(p);
    return {
      id: p.id, slug: p.slug, name: p.name, image: (I.get(p.id) || [])[0] ? I.get(p.id)[0].url : `/img/p/${p.id}.svg`, image2: (I.get(p.id) || [])[1] ? I.get(p.id)[1].url : null, pricing: pr,
      badge: p.badge || (pr.onSale ? 'OFERTA' : null), availability: availability(p, p.fulfillment === 'stock' ? V.get(p.id) || [] : []),
      rating: { avg: p.rating_avg, count: p.rating_count }, club: pick('club') || pick('national_team') || pick('brand'),
      category: pick('category') || pick('modality') || (es.find((e) => e.type === 'sport') || {}).name || '',
      fulfillment: p.fulfillment, customizable: !!p.customizable,
    };
  });
}
async function fullProduct(p) {
  const [images, variants, entities, guide, [base]] = await Promise.all([
    q.all('SELECT url,kind FROM product_images WHERE product_id=? ORDER BY sort,id', p.id),
    q.all('SELECT size,stock FROM variants WHERE product_id=? ORDER BY (SELECT sort FROM sizes WHERE name=variants.size),size', p.id),
    q.all(`SELECT e.id,e.type,e.name,e.slug FROM product_entities pe JOIN entities e ON e.id=pe.entity_id WHERE pe.product_id=?`, p.id),
    p.size_guide_id ? q.get('SELECT id,name,headers,rows,notes FROM size_guides WHERE id=?', p.size_guide_id) : null,
    cards([p]),
  ]);
  const imgs = images.length ? images : [0, 1].map((v) => ({ url: `/img/p/${p.id}.svg${v ? '?v=1' : ''}`, kind: 'image' }));
  return {
    ...base, description: p.description, images: imgs, video: p.video_url || null, variants, entities, tags: p.tags,
    shipping: {
      rule: p.shipping_rule, fixed: p.shipping_fixed_cents, origin: p.fulfillment === 'import' ? (p.origin || 'Exterior') : 'Brasil',
      leadMin: p.lead_min, leadMax: p.lead_max, importNotice: p.fulfillment === 'import' ? (p.import_notes || setting('import_notice')) : null,
    },
    customization: p.customizable ? { priceCents: p.custom_price_cents ?? parseInt(setting('personalization_cents', '2500'), 10) } : null,
    sizeGuide: guide ? { ...guide, headers: JSON.parse(guide.headers), rows: JSON.parse(guide.rows) } : null,
    meta: { title: p.meta_title, description: p.meta_description }, sku: p.sku,
  };
}

// Atualiza texto de busca e propaga entidades (clube → ligas/país) para o produto. Aceita um executor Q de transação.
async function reindexProduct(id, Q = q) {
  const ents = await Q.all('SELECT e.id,e.name,e.type,e.country_id FROM product_entities pe JOIN entities e ON e.id=pe.entity_id WHERE pe.product_id=?', id);
  const have = new Set(ents.map((e) => e.id));
  for (const e of ents.filter((x) => x.type === 'club' || x.type === 'national_team')) {
    const parents = await Q.all("SELECT p.id FROM entity_links l JOIN entities p ON p.id=l.parent_id WHERE l.child_id=? AND p.type IN ('league','competition','sport')", e.id);
    const extra = parents.map((x) => x.id);
    if (e.country_id) extra.push(e.country_id);
    for (const x of extra) if (!have.has(x)) { await Q.run('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', id, x); have.add(x); }
  }
  const names = (await Q.all('SELECT e.name FROM product_entities pe JOIN entities e ON e.id=pe.entity_id WHERE pe.product_id=?', id)).map((r) => r.name);
  const p = await Q.get('SELECT name,tags,sku FROM products WHERE id=?', id);
  await Q.run('UPDATE products SET search_text=? WHERE id=?', norm([p.name, p.tags, p.sku, ...names].join(' ')), id);
}
async function recalcRating(productId) {
  const r = await q.get("SELECT COUNT(*) c, AVG(stars) a FROM reviews WHERE product_id=? AND status='approved'", productId);
  await q.run('UPDATE products SET rating_count=?, rating_avg=? WHERE id=?', r.c, r.a ? Math.round(r.a * 10) / 10 : 0, productId);
}

const SYN = { camiseta: 'camisa', camisas: 'camisa', chuteiras: 'chuteira', tenis: 'chuteira', jersey: 'camisa' };
function tokens(s) { return norm(s).split(/[^a-z0-9]+/).filter(Boolean).map((t) => SYN[t] || t); }

function buildFilters(f) {
  const where = ['p.active=1'], args = [];
  for (const s of f.entities || []) { where.push('EXISTS(SELECT 1 FROM product_entities pe JOIN entities e ON e.id=pe.entity_id WHERE pe.product_id=p.id AND e.slug=?)'); args.push(s); }
  if (f.q) for (const t of tokens(f.q)) { where.push('p.search_text LIKE ?'); args.push('%' + t + '%'); }
  if (f.min) { where.push('COALESCE(CASE WHEN p.sale_price_cents IS NOT NULL THEN p.sale_price_cents END,p.price_cents)>=?'); args.push(Math.round(f.min * 100)); }
  if (f.max) { where.push('COALESCE(CASE WHEN p.sale_price_cents IS NOT NULL THEN p.sale_price_cents END,p.price_cents)<=?'); args.push(Math.round(f.max * 100)); }
  if (f.ship === 'stock' || f.ship === 'import') { where.push('p.fulfillment=?'); args.push(f.ship); }
  if (f.custom) where.push('p.customizable=1');
  if (f.sale) where.push('p.sale_price_cents IS NOT NULL AND p.sale_price_cents<p.price_cents');
  if (f.rating) { where.push('p.rating_avg>=?'); args.push(f.rating); }
  if (f.size) { where.push("(p.fulfillment='import' OR EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.size=? AND v.stock>0))"); args.push(f.size); }
  if (f.avail) where.push("(p.fulfillment='import' OR p.stock>0 OR EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.stock>0))");
  return { where: where.join(' AND '), args };
}
const SORTS = {
  relevance: 'p.sold DESC, p.id DESC', price_asc: 'COALESCE(p.sale_price_cents,p.price_cents) ASC', price_desc: 'COALESCE(p.sale_price_cents,p.price_cents) DESC',
  newest: 'p.id DESC', rating: 'p.rating_avg DESC, p.rating_count DESC', discount: '(1.0*COALESCE(p.sale_price_cents,p.price_cents)/p.price_cents) ASC',
};
async function listProducts(f, page = 1, per = 24) {
  const { where, args } = buildFilters(f);
  const [tot, rows] = await Promise.all([
    q.get(`SELECT COUNT(*) c FROM products p WHERE ${where}`, ...args),
    q.all(`SELECT p.* FROM products p WHERE ${where} ORDER BY ${SORTS[f.sort] || SORTS.relevance} LIMIT ? OFFSET ?`, ...args, per, (page - 1) * per),
  ]);
  return { total: tot.c, page, per, items: await cards(rows) };
}
async function facets(f) {
  const { where, args } = buildFilters(f);
  const ids = JSON.stringify((await q.all(`SELECT p.id FROM products p WHERE ${where}`, ...args)).map((r) => r.id));
  const [ents, sizes, ship, custom] = await Promise.all([
    q.all(`SELECT e.type,e.name,e.slug,COUNT(*) n FROM product_entities pe JOIN entities e ON e.id=pe.entity_id
      WHERE pe.product_id IN (SELECT value FROM json_each(?)) AND e.active=1 GROUP BY e.id ORDER BY e.type, n DESC, e.name`, ids),
    q.all(`SELECT v.size,COUNT(DISTINCT v.product_id) n FROM variants v WHERE v.stock>0 AND v.product_id IN (SELECT value FROM json_each(?)) GROUP BY v.size ORDER BY (SELECT sort FROM sizes WHERE name=v.size)`, ids),
    q.all(`SELECT fulfillment,COUNT(*) n FROM products WHERE id IN (SELECT value FROM json_each(?)) GROUP BY fulfillment`, ids),
    q.get('SELECT COUNT(*) n FROM products WHERE customizable=1 AND id IN (SELECT value FROM json_each(?))', ids),
  ]);
  const byType = {};
  for (const e of ents) (byType[e.type] ||= []).push({ name: e.name, slug: e.slug, n: e.n });
  return { entities: byType, sizes, ship, custom: custom.n };
}

// Árvore de navegação (mega menu) 100% derivada do banco.
async function buildMenu() {
  const [sports, kids] = await Promise.all([
    q.all("SELECT * FROM entities WHERE type='sport' AND active=1 AND show_in_menu=1 ORDER BY sort,name"),
    q.all(`SELECT e.id,e.type,e.name,e.slug,l.parent_id FROM entity_links l JOIN entities e ON e.id=l.child_id WHERE e.active=1 AND e.show_in_menu=1 ORDER BY l.sort,e.name`),
  ]);
  const byParent = {};
  for (const k of kids) (byParent[k.parent_id] ||= []).push(k);
  const TITLES = { league: 'LIGAS', competition: 'COMPETIÇÕES', category: 'CATEGORIAS', national_team: 'SELEÇÕES', country: 'PAÍSES', club: 'TIMES', brand: 'MARCAS', modality: 'MODALIDADES', collection: 'COLEÇÕES', driver: 'PILOTOS', model: 'MODELOS' };
  const ORDER = ['league', 'club', 'category', 'modality', 'brand', 'driver', 'national_team', 'country', 'competition', 'collection'];
  return sports.map((s) => {
    const own = byParent[s.id] || [];
    const groups = [];
    for (const t of ORDER) {
      const items = own.filter((e) => e.type === t).map((e) => ({
        name: e.name, slug: e.slug, path: `/${s.slug}/${e.slug}`,
        children: (byParent[e.id] || []).filter((c) => ['club', 'national_team', 'category', 'brand', 'model', 'driver'].includes(c.type))
          .map((c) => ({ name: c.name, slug: c.slug, path: `/${s.slug}/${e.slug}/${c.slug}` })),
      }));
      if (items.length) groups.push({ type: t, title: TITLES[t], items });
    }
    return { name: s.name, slug: s.slug, path: '/' + s.slug, groups };
  });
}

module.exports = { pricing, cards, fullProduct, reindexProduct, recalcRating, listProducts, facets, buildMenu, tokens, availability, salePrice };
