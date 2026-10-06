const express = require('express');
const fs = require('fs');
const path = require('path');
const { db, q, tx, allSettings, audit } = require('../db');
const { requireAdmin } = require('../lib/auth');
const cat = require('../lib/catalog');
const orders = require('../lib/orders');
const { wrap, HttpError, slugify, token } = require('../lib/util');

const r = express.Router();
r.use(requireAdmin);

/* ----- helpers ----- */
const conv = {
  text: (v) => (v == null || v === '' ? null : String(v).trim()),
  str: (v) => String(v ?? '').trim(),
  int: (v) => (v === '' || v == null ? null : Math.round(+v) || 0),
  num: (v) => (v === '' || v == null ? null : +v || 0),
  bool: (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0),
  money: (v) => (v === '' || v == null ? null : Math.round((parseFloat(String(v).replace(',', '.')) || 0) * 100)),
  date: (v) => (v ? String(v).replace('T', ' ').slice(0, 19) : null),
  json: (v) => (typeof v === 'string' ? v : JSON.stringify(v ?? [])),
};
const toClient = (row, spec) => {
  if (!row) return row;
  const o = { ...row };
  for (const [k, t] of Object.entries(spec)) if (t === 'money') o[k] = row[k] == null ? '' : row[k] / 100;
  return o;
};
function crud(name, table, spec, { order = 'id DESC', search = [], hooks = {} } = {}) {
  const cols = Object.keys(spec);
  r.get(`/${name}`, (req, res) => {
    const where = [], args = [];
    const s = String(req.query.q || '').trim();
    if (s && search.length) { where.push('(' + search.map((c) => `${c} LIKE ?`).join(' OR ') + ')'); search.forEach(() => args.push(`%${s}%`)); }
    for (const f of hooks.filters || []) if (req.query[f]) { where.push(`${f}=?`); args.push(req.query[f]); }
    const rows = q.all(`SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 500`, ...args);
    res.json(rows.map((x) => toClient(hooks.list ? hooks.list(x) : x, spec)));
  });
  r.get(`/${name}/:id`, (req, res) => {
    const row = q.get(`SELECT * FROM ${table} WHERE id=?`, +req.params.id);
    if (!row) throw new HttpError(404, 'Não encontrado.');
    res.json(toClient(hooks.get ? hooks.get(row) : row, spec));
  });
  const save = (id, body) => {
    const vals = cols.map((c) => conv[spec[c]](body[c]));
    if (hooks.validate) hooks.validate(body, vals, cols, id);
    if (id) { q.run(`UPDATE ${table} SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`, ...vals, id); return id; }
    return Number(q.run(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...vals).lastInsertRowid);
  };
  r.post(`/${name}`, wrap((req, res) => { const id = tx(() => { const i = save(0, req.body || {}); hooks.after && hooks.after(i, req.body); return i; }); audit(req.user.id, `create_${name}`, id, req.ip); res.json({ id }); }));
  r.put(`/${name}/:id`, wrap((req, res) => { const id = +req.params.id; tx(() => { save(id, req.body || {}); hooks.after && hooks.after(id, req.body); }); audit(req.user.id, `update_${name}`, id, req.ip); res.json({ id }); }));
  r.delete(`/${name}/:id`, wrap((req, res) => { q.run(`DELETE FROM ${table} WHERE id=?`, +req.params.id); audit(req.user.id, `delete_${name}`, req.params.id, req.ip); res.json({ ok: true }); }));
}
const uniqueSlug = (table, base, id) => { let s = slugify(base) || token(4).toLowerCase(), n = 2, c = s; while (q.get(`SELECT 1 x FROM ${table} WHERE slug=? AND id!=?`, c, id || 0)) c = `${s}-${n++}`; return c; };

/* ----- entidades (esportes, ligas, clubes, países, marcas...) ----- */
const ENT = { type: 'str', name: 'str', slug: 'str', logo: 'text', banner: 'text', description: 'text', color1: 'text', color2: 'text', country_id: 'int', sort: 'int', active: 'bool', show_in_menu: 'bool' };
crud('entities', 'entities', ENT, {
  order: 'type, sort, name', search: ['name', 'slug'], hooks: {
    filters: ['type'],
    validate(body, vals, cols, id) {
      if (!body.name) throw new HttpError(400, 'Informe o nome.');
      vals[cols.indexOf('slug')] = uniqueSlug("entities", body.slug || body.name, id || 0);
      if (!body.type) throw new HttpError(400, 'Informe o tipo.');
    },
    get: (row) => ({ ...row, parents: q.all('SELECT parent_id FROM entity_links WHERE child_id=?', row.id).map((x) => x.parent_id) }),
    after(id, body) {
      if (Array.isArray(body.parents)) {
        q.run('DELETE FROM entity_links WHERE child_id=?', id);
        for (const p of body.parents) if (+p !== id) q.run('INSERT OR IGNORE INTO entity_links(parent_id,child_id) VALUES(?,?)', +p, id);
      }
    },
  },
});
// slug precisa ser calculado também em criação (id desconhecido): sobrescreve via POST wrapper acima usando body.id=0

crud('suppliers', 'suppliers', { name: 'str', contact: 'text', whatsapp: 'text', email: 'text', link: 'text', channel: 'str', webhook_url: 'text', notes: 'text', active: 'bool' }, { search: ['name'] });
crud('sizes', 'sizes', { name: 'str', sort: 'int' }, { order: 'sort,name' });
crud('size_guides', 'size_guides', { name: 'str', headers: 'json', rows: 'json', notes: 'text' }, { order: 'id' });
crud('banners', 'banners', { title: 'text', subtitle: 'text', cta_text: 'text', link: 'text', image_desktop: 'text', image_mobile: 'text', starts_at: 'date', ends_at: 'date', sort: 'int', active: 'bool' }, { order: 'sort,id' });
crud('coupons', 'coupons', { code: 'str', type: 'str', value: 'num', product_id: 'int', entity_id: 'int', min_cents: 'money', first_purchase: 'bool', is_public: 'bool', description: 'text', starts_at: 'date', ends_at: 'date', max_uses: 'int', active: 'bool' }, {
  hooks: { validate(b, vals, cols) { if (!/^[A-Za-z0-9_-]{3,30}$/.test(b.code || '')) throw new HttpError(400, 'Código inválido (3-30 letras/números).'); vals[cols.indexOf('code')] = b.code.toUpperCase(); if (!['percent', 'fixed', 'free_shipping'].includes(b.type)) throw new HttpError(400, 'Tipo inválido.'); } },
});
crud('testimonials', 'testimonials', { kind: 'str', name: 'text', product_name: 'text', product_id: 'int', stars: 'int', body: 'text', media_url: 'text', link: 'text', sort: 'int', active: 'bool' }, { order: 'sort,id' });

/* ----- páginas institucionais ----- */
r.get('/pages', (_req, res) => res.json(q.all('SELECT slug,title,body FROM pages ORDER BY slug')));
r.put('/pages/:slug', (req, res) => { q.run("INSERT INTO pages(slug,title,body,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(slug) DO UPDATE SET title=excluded.title, body=excluded.body, updated_at=datetime('now')", req.params.slug, String(req.body.title || ''), String(req.body.body || '')); res.json({ ok: true }); });

/* ----- configurações ----- */
const SETTING_KEYS = ['store_name', 'slogan', 'whatsapp', 'instagram', 'tiktok', 'youtube', 'email', 'company_name', 'cnpj', 'pix_pct', 'max_installments', 'min_installment_cents', 'personalization_cents', 'import_notice', 'free_shipping_over_cents', 'origin_cep', 'instagram_feedback_url', 'low_stock_threshold'];
r.get('/settings', (_req, res) => res.json(allSettings()));
r.put('/settings', (req, res) => { for (const k of SETTING_KEYS) if (k in (req.body || {})) q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(req.body[k])); audit(req.user.id, 'settings', '', req.ip); res.json({ ok: true }); });

/* ----- produtos ----- */
const PROD = {
  name: 'str', slug: 'str', description: 'text', price_cents: 'money', sale_price_cents: 'money', sale_starts: 'date', sale_ends: 'date', pix_pct: 'num', max_installments: 'int',
  fulfillment: 'str', stock: 'int', shipping_rule: 'str', shipping_fixed_cents: 'money', origin: 'text', lead_min: 'int', lead_max: 'int', import_notes: 'text', weight_g: 'int',
  supplier_id: 'int', supplier_sku: 'text', supplier_link: 'text', supplier_cost_cents: 'money', supplier_notes: 'text', customizable: 'bool', custom_price_cents: 'money',
  size_guide_id: 'int', badge: 'text', tags: 'text', video_url: 'text', meta_title: 'text', meta_description: 'text', style: 'text', color1: 'text', color2: 'text', shape: 'str', sku: 'text', active: 'bool',
};
function saveProduct(id, b) {
  if (!b.name) throw new HttpError(400, 'Informe o nome do produto.');
  if (!(parseFloat(String(b.price_cents).replace(',', '.')) > 0)) throw new HttpError(400, 'Informe o preço.');
  if (!['stock', 'import'].includes(b.fulfillment)) b.fulfillment = 'stock';
  b.slug = uniqueSlug('products', b.slug || b.name, id || 0);
  const cols = Object.keys(PROD), vals = cols.map((c) => conv[PROD[c]](b[c]));
  tx(() => {
    if (id) q.run(`UPDATE products SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`, ...vals, id);
    else id = Number(q.run(`INSERT INTO products(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...vals).lastInsertRowid);
    q.run('DELETE FROM product_entities WHERE product_id=?', id);
    for (const e of b.entity_ids || []) q.run('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', id, +e);
    q.run('DELETE FROM variants WHERE product_id=?', id);
    let total = 0;
    for (const v of b.variants || []) if (v.size) { q.run('INSERT OR REPLACE INTO variants(product_id,size,stock,sku) VALUES(?,?,?,?)', id, String(v.size), Math.max(0, parseInt(v.stock, 10) || 0), v.sku || null); total += Math.max(0, parseInt(v.stock, 10) || 0); }
    if ((b.variants || []).length && b.fulfillment === 'stock') q.run('UPDATE products SET stock=? WHERE id=?', total, id);
    q.run('DELETE FROM product_images WHERE product_id=?', id);
    (b.images || []).forEach((im, i) => { if (im.url) q.run('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', id, im.url, im.kind === 'video' ? 'video' : 'image', i); });
    cat.reindexProduct(id);
  });
  return id;
}
r.get('/products', (req, res) => {
  const s = String(req.query.q || '').trim();
  const rows = s ? q.all('SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? OR supplier_sku LIKE ? ORDER BY id DESC LIMIT 300', `%${s}%`, `%${s}%`, `%${s}%`) : q.all('SELECT * FROM products ORDER BY id DESC LIMIT 300');
  res.json(rows.map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.price_cents / 100, sale: p.sale_price_cents ? p.sale_price_cents / 100 : null, stock: p.stock, fulfillment: p.fulfillment, active: p.active, sold: p.sold, image: cat.card(p).image, supplier: p.supplier_id })));
});
r.get('/products/:id', (req, res) => {
  const p = q.get('SELECT * FROM products WHERE id=?', +req.params.id);
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  res.json({ ...toClient(p, PROD), entity_ids: q.all('SELECT entity_id FROM product_entities WHERE product_id=?', p.id).map((x) => x.entity_id), variants: q.all('SELECT size,stock,sku FROM variants WHERE product_id=?', p.id), images: q.all('SELECT url,kind FROM product_images WHERE product_id=? ORDER BY sort,id', p.id) });
});
r.post('/products', wrap((req, res) => { const id = saveProduct(0, req.body || {}); audit(req.user.id, 'create_product', id, req.ip); res.json({ id }); }));
r.put('/products/:id', wrap((req, res) => { const id = saveProduct(+req.params.id, req.body || {}); audit(req.user.id, 'update_product', id, req.ip); res.json({ id }); }));
r.post('/products/:id/duplicate', wrap((req, res) => {
  const src = q.get('SELECT * FROM products WHERE id=?', +req.params.id);
  if (!src) throw new HttpError(404, 'Produto não encontrado.');
  const b = { ...toClient(src, PROD), entity_ids: q.all('SELECT entity_id FROM product_entities WHERE product_id=?', src.id).map((x) => x.entity_id), variants: q.all('SELECT size,stock,sku FROM variants WHERE product_id=?', src.id), images: q.all('SELECT url,kind FROM product_images WHERE product_id=?', src.id) };
  b.name += ' (cópia)'; b.slug = ''; b.active = 0; b.sku = null;
  res.json({ id: saveProduct(0, b) });
}));
r.delete('/products/:id', wrap((req, res) => { q.run('DELETE FROM products WHERE id=?', +req.params.id); audit(req.user.id, 'delete_product', req.params.id, req.ip); res.json({ ok: true }); }));
r.patch('/products/:id/quick', (req, res) => { // preço/estoque/status rápidos
  const b = req.body || {}, id = +req.params.id;
  if ('price' in b) q.run('UPDATE products SET price_cents=? WHERE id=?', conv.money(b.price), id);
  if ('sale' in b) q.run('UPDATE products SET sale_price_cents=? WHERE id=?', conv.money(b.sale), id);
  if ('stock' in b) q.run('UPDATE products SET stock=? WHERE id=?', conv.int(b.stock), id);
  if ('active' in b) q.run('UPDATE products SET active=? WHERE id=?', conv.bool(b.active), id);
  res.json({ ok: true });
});

/* ----- avaliações ----- */
r.get('/reviews', (req, res) => res.json(q.all(`SELECT r.*,p.name product FROM reviews r JOIN products p ON p.id=r.product_id ${req.query.status ? 'WHERE r.status=?' : ''} ORDER BY r.id DESC LIMIT 300`, ...(req.query.status ? [req.query.status] : []))));
r.put('/reviews/:id', (req, res) => {
  const rv = q.get('SELECT * FROM reviews WHERE id=?', +req.params.id);
  if (!rv) throw new HttpError(404, 'Não encontrada.');
  const status = ['approved', 'hidden', 'pending'].includes(req.body.status) ? req.body.status : rv.status;
  q.run('UPDATE reviews SET status=?, featured=? WHERE id=?', status, conv.bool(req.body.featured ?? rv.featured), rv.id);
  cat.recalcRating(rv.product_id); res.json({ ok: true });
});
r.delete('/reviews/:id', (req, res) => { const rv = q.get('SELECT product_id FROM reviews WHERE id=?', +req.params.id); q.run('DELETE FROM reviews WHERE id=?', +req.params.id); if (rv) cat.recalcRating(rv.product_id); res.json({ ok: true }); });

/* ----- pedidos ----- */
r.get('/orders', (req, res) => {
  const st = req.query.status, s = String(req.query.q || '').trim();
  const where = [], args = [];
  if (st) { where.push('status=?'); args.push(st); }
  if (s) { where.push('(CAST(id AS TEXT)=? OR customer LIKE ?)'); args.push(s.replace('#', ''), `%${s}%`); }
  const rows = q.all(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`, ...args);
  res.json(rows.map((o) => ({ id: o.id, status: o.status, statusLabel: orders.STATUS[o.status], total: o.total_cents, created_at: o.created_at, customer: JSON.parse(o.customer).name, method: o.payment_method, items: q.get('SELECT SUM(qty) n FROM order_items WHERE order_id=?', o.id).n })));
});
r.get('/orders/:id', (req, res) => {
  const o = q.get('SELECT * FROM orders WHERE id=?', +req.params.id);
  if (!o) throw new HttpError(404, 'Pedido não encontrado.');
  const items = q.all('SELECT i.*, s.name supplier_name FROM order_items i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.order_id=?', o.id);
  res.json({ ...orders.orderView(o), customer: JSON.parse(o.customer), items, notes: o.notes, supplierOrders: q.all('SELECT so.*, s.name supplier_name, s.channel FROM supplier_orders so LEFT JOIN suppliers s ON s.id=so.supplier_id WHERE so.order_id=?', o.id).map((x) => ({ ...x, log: JSON.parse(x.log || '[]') })), shipments: q.all('SELECT * FROM shipments WHERE order_id=?', o.id), payments: q.all('SELECT id,provider,method,status,amount_cents,paid_at,external_id FROM payments WHERE order_id=?', o.id), statuses: orders.STATUS });
});
r.put('/orders/:id/status', (req, res) => {
  const st = req.body.status;
  if (!orders.STATUS[st]) throw new HttpError(400, 'Status inválido.');
  if (st === 'paid') { orders.markPaid(+req.params.id, null); } else orders.setStatus(+req.params.id, st, req.body.note || 'Alterado manualmente pelo administrador');
  audit(req.user.id, 'order_status', `${req.params.id}:${st}`, req.ip);
  res.json({ ok: true });
});
r.put('/orders/:id/notes', (req, res) => { q.run('UPDATE orders SET notes=? WHERE id=?', String(req.body.notes || '').slice(0, 1000), +req.params.id); res.json({ ok: true }); });
r.put('/shipments/:id', (req, res) => {
  const b = req.body || {}, sh = q.get('SELECT * FROM shipments WHERE id=?', +req.params.id);
  if (!sh) throw new HttpError(404, 'Envio não encontrado.');
  q.run('UPDATE shipments SET carrier=?, code=?, url=?, status=? WHERE id=?', conv.text(b.carrier), conv.text(b.code), conv.text(b.url), b.code ? 'shipped' : sh.status, sh.id);
  const o = q.get('SELECT status FROM orders WHERE id=?', sh.order_id);
  if (b.code && ['paid', 'awaiting_supplier', 'sent_supplier', 'supplier_confirmed', 'preparing'].includes(o.status)) orders.setStatus(sh.order_id, 'shipped', 'Código de rastreio informado');
  res.json({ ok: true });
});
r.post('/supplier-orders/:id/send', wrap(async (req, res) => { await orders.dispatchSupplierOrder(+req.params.id); res.json({ ok: true }); }));
r.post('/supplier-orders/:id/mark-sent', (req, res) => { orders.markSupplierSent(+req.params.id); res.json({ ok: true }); });
r.post('/supplier-orders/:id/confirm', (req, res) => {
  const so = q.get('SELECT * FROM supplier_orders WHERE id=?', +req.params.id);
  q.run("UPDATE supplier_orders SET status='confirmed', confirmed_at=datetime('now') WHERE id=?", so.id);
  orders.setStatus(so.order_id, 'supplier_confirmed', 'Fornecedor confirmou'); res.json({ ok: true });
});
r.get('/supplier-orders', (req, res) => res.json(q.all(`SELECT so.id,so.order_id,so.status,so.channel,so.link,so.sent_at,so.created_at,s.name supplier FROM supplier_orders so LEFT JOIN suppliers s ON s.id=so.supplier_id ${req.query.status ? 'WHERE so.status=?' : ''} ORDER BY so.id DESC LIMIT 200`, ...(req.query.status ? [req.query.status] : []))));

/* ----- usuários, auditoria, dashboard ----- */
r.get('/users', (_req, res) => res.json(q.all('SELECT u.id,u.name,u.email,u.role,u.created_at,(SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) orders FROM users u WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 300')));
r.get('/audit', (_req, res) => res.json(q.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200')));
r.get('/dashboard', (_req, res) => {
  const PAID = "('paid','awaiting_supplier','sent_supplier','supplier_confirmed','preparing','shipped','in_transit','delivered')";
  const agg = (since) => q.get(`SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) rev FROM orders WHERE status IN ${PAID} ${since ? "AND created_at>=datetime('now', ?)" : ''}`, ...(since ? [since] : []));
  const all = agg(), d30 = agg('-30 days'), d7 = agg('-7 days');
  const thr = parseInt(allSettings().low_stock_threshold || '5', 10);
  res.json({
    orders: all.n, revenue: all.rev, ticket: all.n ? Math.round(all.rev / all.n) : 0, last30: d30, last7: d7,
    itemsSold: q.get(`SELECT COALESCE(SUM(i.qty),0) n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status IN ${PAID}`).n,
    customers: q.get("SELECT COUNT(*) n FROM users WHERE role='customer' AND deleted_at IS NULL").n,
    pendingReviews: q.get("SELECT COUNT(*) n FROM reviews WHERE status='pending'").n,
    awaitingSupplier: q.get("SELECT COUNT(*) n FROM orders WHERE status='awaiting_supplier'").n,
    pendingPayment: q.get("SELECT COUNT(*) n FROM orders WHERE status='payment_pending'").n,
    lowStock: q.all("SELECT id,name,stock FROM products WHERE active=1 AND fulfillment='stock' AND stock<=? ORDER BY stock LIMIT 10", thr),
    byStatus: q.all('SELECT status,COUNT(*) n FROM orders GROUP BY status').map((x) => ({ ...x, label: orders.STATUS[x.status] })),
    top: q.all('SELECT id,name,sold FROM products ORDER BY sold DESC LIMIT 5'),
    daily: q.all(`SELECT date(created_at) d, COUNT(*) n, SUM(total_cents) rev FROM orders WHERE status IN ${PAID} AND created_at>=datetime('now','-14 days') GROUP BY d ORDER BY d`),
  });
});

/* ----- uploads (imagens/vídeos) ----- */
const UP = path.join(__dirname, '..', '..', 'uploads');
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
r.post('/upload', express.raw({ type: Object.keys(EXT), limit: '25mb' }), wrap((req, res) => {
  const ext = EXT[String(req.headers['content-type']).split(';')[0]];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Arquivo inválido (use JPG, PNG, WebP, AVIF, MP4 ou WebM).');
  fs.mkdirSync(UP, { recursive: true });
  const name = `${Date.now()}-${token(6).replace(/[^\w]/g, '')}.${ext}`;
  fs.writeFileSync(path.join(UP, name), req.body);
  res.json({ url: '/uploads/' + name });
}));
// Backup consistente do banco
r.get('/backup', wrap((req, res) => {
  const f = path.join(require('os').tmpdir(), `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  audit(req.user.id, 'backup', '', req.ip);
  res.download(f, `sport-imperativo-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.unlink(f, () => {}));
}));
module.exports = r;
