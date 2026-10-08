const express = require('express');
const fs = require('fs');
const path = require('path');
const { client, q, tx, allSettings, refreshSettings, audit } = require('../db');
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
  r.get(`/${name}`, async (req, res) => {
    const where = [], args = [];
    const s = String(req.query.q || '').trim();
    if (s && search.length) { where.push('(' + search.map((c) => `${c} LIKE ?`).join(' OR ') + ')'); search.forEach(() => args.push(`%${s}%`)); }
    for (const f of hooks.filters || []) if (req.query[f]) { where.push(`${f}=?`); args.push(req.query[f]); }
    const rows = await q.all(`SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 500`, ...args);
    res.json(rows.map((x) => toClient(hooks.list ? hooks.list(x) : x, spec)));
  });
  r.get(`/${name}/:id`, async (req, res) => {
    const row = await q.get(`SELECT * FROM ${table} WHERE id=?`, +req.params.id);
    if (!row) throw new HttpError(404, 'Não encontrado.');
    res.json(toClient(hooks.get ? await hooks.get(row) : row, spec));
  });
  // Validação (pode consultar o banco) acontece antes da transação; a escrita usa o executor Q da transação.
  const prep = async (id, body) => {
    const vals = cols.map((c) => conv[spec[c]](body[c]));
    if (hooks.validate) await hooks.validate(body, vals, cols, id);
    return vals;
  };
  const write = async (id, vals, body, Q) => {
    if (id) await Q.run(`UPDATE ${table} SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`, ...vals, id);
    else id = Number((await Q.run(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...vals)).lastInsertRowid);
    if (hooks.after) await hooks.after(id, body, Q);
    return id;
  };
  r.post(`/${name}`, wrap(async (req, res) => { const body = req.body || {}; const vals = await prep(0, body); const id = await tx((Q) => write(0, vals, body, Q)); await audit(req.user.id, `create_${name}`, id, req.ip); res.json({ id }); }));
  r.put(`/${name}/:id`, wrap(async (req, res) => { const id = +req.params.id, body = req.body || {}; const vals = await prep(id, body); await tx((Q) => write(id, vals, body, Q)); await audit(req.user.id, `update_${name}`, id, req.ip); res.json({ id }); }));
  r.delete(`/${name}/:id`, wrap(async (req, res) => { await q.run(`DELETE FROM ${table} WHERE id=?`, +req.params.id); await audit(req.user.id, `delete_${name}`, req.params.id, req.ip); res.json({ ok: true }); }));
}
const uniqueSlug = async (table, base, id) => { let s = slugify(base) || token(4).toLowerCase(), n = 2, c = s; while (await q.get(`SELECT 1 x FROM ${table} WHERE slug=? AND id!=?`, c, id || 0)) c = `${s}-${n++}`; return c; };

/* ----- entidades (esportes, ligas, clubes, países, marcas...) ----- */
const ENT = { type: 'str', name: 'str', slug: 'str', logo: 'text', banner: 'text', description: 'text', color1: 'text', color2: 'text', country_id: 'int', sort: 'int', active: 'bool', show_in_menu: 'bool' };
crud('entities', 'entities', ENT, {
  order: 'type, sort, name', search: ['name', 'slug'], hooks: {
    filters: ['type'],
    async validate(body, vals, cols, id) {
      if (!body.name) throw new HttpError(400, 'Informe o nome.');
      vals[cols.indexOf('slug')] = await uniqueSlug("entities", body.slug || body.name, id || 0);
      if (!body.type) throw new HttpError(400, 'Informe o tipo.');
    },
    get: async (row) => ({ ...row, parents: (await q.all('SELECT parent_id FROM entity_links WHERE child_id=?', row.id)).map((x) => x.parent_id) }),
    async after(id, body, Q) {
      if (Array.isArray(body.parents)) {
        await Q.run('DELETE FROM entity_links WHERE child_id=?', id);
        for (const p of body.parents) if (+p !== id) await Q.run('INSERT OR IGNORE INTO entity_links(parent_id,child_id) VALUES(?,?)', +p, id);
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
r.get('/pages', async (_req, res) => res.json(await q.all('SELECT slug,title,body FROM pages ORDER BY slug')));
r.put('/pages/:slug', async (req, res) => { await q.run("INSERT INTO pages(slug,title,body,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(slug) DO UPDATE SET title=excluded.title, body=excluded.body, updated_at=datetime('now')", req.params.slug, String(req.body.title || ''), String(req.body.body || '')); res.json({ ok: true }); });

/* ----- configurações ----- */
const SETTING_KEYS = ['store_name', 'slogan', 'whatsapp', 'instagram', 'whatsapp_link', 'youtube', 'email', 'company_name', 'cnpj', 'pix_pct', 'max_installments', 'min_installment_cents', 'personalization_cents', 'import_notice', 'free_shipping_over_cents', 'origin_cep', 'instagram_feedback_url', 'low_stock_threshold', 'supplier_share_phone'];
r.get('/settings', async (_req, res) => res.json(allSettings()));
r.put('/settings', async (req, res) => { for (const k of SETTING_KEYS) if (k in (req.body || {})) await q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(req.body[k])); await refreshSettings(); await audit(req.user.id, 'settings', '', req.ip); res.json({ ok: true }); });

/* ----- produtos ----- */
const PROD = {
  name: 'str', slug: 'str', description: 'text', price_cents: 'money', sale_price_cents: 'money', sale_starts: 'date', sale_ends: 'date', pix_pct: 'num', max_installments: 'int',
  fulfillment: 'str', stock: 'int', shipping_rule: 'str', shipping_fixed_cents: 'money', origin: 'text', lead_min: 'int', lead_max: 'int', import_notes: 'text', weight_g: 'int',
  supplier_id: 'int', supplier_sku: 'text', supplier_link: 'text', supplier_cost_cents: 'money', supplier_notes: 'text', customizable: 'bool', custom_price_cents: 'money',
  size_guide_id: 'int', badge: 'text', tags: 'text', video_url: 'text', meta_title: 'text', meta_description: 'text', style: 'text', color1: 'text', color2: 'text', shape: 'str', sku: 'text', active: 'bool',
};
async function saveProduct(id, b) {
  if (!b.name) throw new HttpError(400, 'Informe o nome do produto.');
  if (!(parseFloat(String(b.price_cents).replace(',', '.')) > 0)) throw new HttpError(400, 'Informe o preço.');
  if (!['stock', 'import'].includes(b.fulfillment)) b.fulfillment = 'stock';
  b.slug = await uniqueSlug('products', b.slug || b.name, id || 0);
  const cols = Object.keys(PROD), vals = cols.map((c) => conv[PROD[c]](b[c]));
  return tx(async (Q) => {
    if (id) await Q.run(`UPDATE products SET ${cols.map((c) => c + '=?').join(',')} WHERE id=?`, ...vals, id);
    else id = Number((await Q.run(`INSERT INTO products(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...vals)).lastInsertRowid);
    await Q.run('DELETE FROM product_entities WHERE product_id=?', id);
    for (const e of b.entity_ids || []) await Q.run('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', id, +e);
    await Q.run('DELETE FROM variants WHERE product_id=?', id);
    let total = 0;
    for (const v of b.variants || []) if (v.size) { const st = Math.max(0, parseInt(v.stock, 10) || 0); await Q.run('INSERT OR REPLACE INTO variants(product_id,size,stock,sku) VALUES(?,?,?,?)', id, String(v.size), st, v.sku || null); total += st; }
    if ((b.variants || []).length && b.fulfillment === 'stock') await Q.run('UPDATE products SET stock=? WHERE id=?', total, id);
    await Q.run('DELETE FROM product_images WHERE product_id=?', id);
    let i = 0;
    for (const im of b.images || []) if (im.url) await Q.run('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', id, im.url, im.kind === 'video' ? 'video' : 'image', i++);
    await cat.reindexProduct(id, Q);
    return id;
  });
}
r.get('/products', async (req, res) => {
  const s = String(req.query.q || '').trim();
  const rows = s ? await q.all('SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? OR supplier_sku LIKE ? ORDER BY id DESC LIMIT 300', `%${s}%`, `%${s}%`, `%${s}%`) : await q.all('SELECT * FROM products ORDER BY id DESC LIMIT 300');
  const imgs = Object.fromEntries((await cat.cards(rows)).map((c) => [c.id, c.image]));
  res.json(rows.map((p) => ({ id: p.id, name: p.name, sku: p.sku, price: p.price_cents / 100, sale: p.sale_price_cents ? p.sale_price_cents / 100 : null, stock: p.stock, fulfillment: p.fulfillment, active: p.active, sold: p.sold, image: imgs[p.id], supplier: p.supplier_id })));
});
r.get('/products/:id', async (req, res) => {
  const p = await q.get('SELECT * FROM products WHERE id=?', +req.params.id);
  if (!p) throw new HttpError(404, 'Produto não encontrado.');
  res.json({ ...toClient(p, PROD), entity_ids: (await q.all('SELECT entity_id FROM product_entities WHERE product_id=?', p.id)).map((x) => x.entity_id), variants: await q.all('SELECT size,stock,sku FROM variants WHERE product_id=?', p.id), images: await q.all('SELECT url,kind FROM product_images WHERE product_id=? ORDER BY sort,id', p.id) });
});
r.post('/products', wrap(async (req, res) => { const id = await saveProduct(0, req.body || {}); await audit(req.user.id, 'create_product', id, req.ip); res.json({ id }); }));
r.put('/products/:id', wrap(async (req, res) => { const id = await saveProduct(+req.params.id, req.body || {}); await audit(req.user.id, 'update_product', id, req.ip); res.json({ id }); }));
r.post('/products/:id/duplicate', wrap(async (req, res) => {
  const src = await q.get('SELECT * FROM products WHERE id=?', +req.params.id);
  if (!src) throw new HttpError(404, 'Produto não encontrado.');
  const b = { ...toClient(src, PROD), entity_ids: (await q.all('SELECT entity_id FROM product_entities WHERE product_id=?', src.id)).map((x) => x.entity_id), variants: await q.all('SELECT size,stock,sku FROM variants WHERE product_id=?', src.id), images: await q.all('SELECT url,kind FROM product_images WHERE product_id=?', src.id) };
  b.name += ' (cópia)'; b.slug = ''; b.active = 0; b.sku = null;
  res.json({ id: await saveProduct(0, b) });
}));
r.delete('/products/:id', wrap(async (req, res) => { await q.run('DELETE FROM products WHERE id=?', +req.params.id); await audit(req.user.id, 'delete_product', req.params.id, req.ip); res.json({ ok: true }); }));
r.patch('/products/:id/quick', async (req, res) => { // preço/estoque/status rápidos
  const b = req.body || {}, id = +req.params.id;
  if ('price' in b) await q.run('UPDATE products SET price_cents=? WHERE id=?', conv.money(b.price), id);
  if ('sale' in b) await q.run('UPDATE products SET sale_price_cents=? WHERE id=?', conv.money(b.sale), id);
  if ('stock' in b) await q.run('UPDATE products SET stock=? WHERE id=?', conv.int(b.stock), id);
  if ('active' in b) await q.run('UPDATE products SET active=? WHERE id=?', conv.bool(b.active), id);
  res.json({ ok: true });
});

/* ----- avaliações ----- */
r.get('/reviews', async (req, res) => res.json(await q.all(`SELECT r.*,p.name product FROM reviews r JOIN products p ON p.id=r.product_id ${req.query.status ? 'WHERE r.status=?' : ''} ORDER BY r.id DESC LIMIT 300`, ...(req.query.status ? [req.query.status] : []))));
r.put('/reviews/:id', async (req, res) => {
  const rv = await q.get('SELECT * FROM reviews WHERE id=?', +req.params.id);
  if (!rv) throw new HttpError(404, 'Não encontrada.');
  const status = ['approved', 'hidden', 'pending'].includes(req.body.status) ? req.body.status : rv.status;
  await q.run('UPDATE reviews SET status=?, featured=? WHERE id=?', status, conv.bool(req.body.featured ?? rv.featured), rv.id);
  await cat.recalcRating(rv.product_id); res.json({ ok: true });
});
r.delete('/reviews/:id', async (req, res) => { const rv = await q.get('SELECT product_id FROM reviews WHERE id=?', +req.params.id); await q.run('DELETE FROM reviews WHERE id=?', +req.params.id); if (rv) await cat.recalcRating(rv.product_id); res.json({ ok: true }); });

/* ----- pedidos ----- */
r.get('/orders', async (req, res) => {
  const st = req.query.status, s = String(req.query.q || '').trim();
  const where = [], args = [];
  if (st) { where.push('status=?'); args.push(st); }
  if (s) { const m = s.match(/SIS[-\s#]*(\d+)/i); where.push('(CAST(id AS TEXT)=? OR id=? OR customer LIKE ?)'); args.push(s.replace('#', ''), m ? Number(m[1]) - 10000 : -1, `%${s}%`); }
  const rows = await q.all(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`, ...args);
  const counts = Object.fromEntries((await q.all('SELECT order_id,SUM(qty) n FROM order_items WHERE order_id IN (SELECT value FROM json_each(?)) GROUP BY order_id', JSON.stringify(rows.map((o) => o.id)))).map((x) => [x.order_id, x.n]));
  res.json(rows.map((o) => ({ id: o.id, ref: 'SIS-' + (10000 + o.id), status: o.status, statusLabel: orders.STATUS[o.status], total: o.total_cents, created_at: o.created_at, customer: JSON.parse(o.customer).name, method: o.payment_method, items: counts[o.id] || 0 })));
});
r.get('/orders/:id', async (req, res) => {
  const o = await q.get('SELECT * FROM orders WHERE id=?', +req.params.id);
  if (!o) throw new HttpError(404, 'Pedido não encontrado.');
  const items = await q.all('SELECT i.*, s.name supplier_name FROM order_items i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.order_id=?', o.id);
  const sos = await q.all('SELECT so.*, s.name supplier_name, s.channel FROM supplier_orders so LEFT JOIN suppliers s ON s.id=so.supplier_id WHERE so.order_id=?', o.id);
  const comm = await q.all('SELECT id,direction,kind,body,wa_message_id,status,created_at FROM comm_log WHERE order_id=? ORDER BY id', o.id);
  const events = await q.all('SELECT status,note,created_at FROM order_events WHERE order_id=? ORDER BY id', o.id);
  res.json({ ...(await orders.orderView(o)), status: o.status, statusLabel: orders.STATUS[o.status], events, comm, customer: JSON.parse(o.customer), items, notes: o.notes, supplierOrders: sos.map((x) => ({ ...x, log: JSON.parse(x.log || '[]') })), shipments: await q.all('SELECT * FROM shipments WHERE order_id=?', o.id), payments: await q.all('SELECT id,provider,method,status,amount_cents,paid_at,external_id FROM payments WHERE order_id=?', o.id), statuses: orders.STATUS });
});
r.put('/orders/:id/status', async (req, res) => {
  const st = req.body.status;
  if (!orders.STATUS[st]) throw new HttpError(400, 'Status inválido.');
  if (st === 'paid') { await orders.markPaid(+req.params.id, null); } else await orders.setStatus(+req.params.id, st, req.body.note || 'Alterado manualmente pelo administrador');
  await audit(req.user.id, 'order_status', `${req.params.id}:${st}`, req.ip);
  res.json({ ok: true });
});
r.put('/orders/:id/notes', async (req, res) => { await q.run('UPDATE orders SET notes=? WHERE id=?', String(req.body.notes || '').slice(0, 1000), +req.params.id); res.json({ ok: true }); });
r.put('/shipments/:id', async (req, res) => {
  const b = req.body || {}, sh = await q.get('SELECT * FROM shipments WHERE id=?', +req.params.id);
  if (!sh) throw new HttpError(404, 'Envio não encontrado.');
  await q.run('UPDATE shipments SET carrier=?, code=?, url=?, status=? WHERE id=?', conv.text(b.carrier), conv.text(b.code), conv.text(b.url), b.code ? 'shipped' : sh.status, sh.id);
  const o = await q.get('SELECT status FROM orders WHERE id=?', sh.order_id);
  if (b.code && ['paid', 'awaiting_supplier', 'sent_supplier', 'supplier_confirmed', 'preparing'].includes(o.status)) await orders.setStatus(sh.order_id, 'shipped', 'Código de rastreio informado');
  res.json({ ok: true });
});
r.post('/supplier-orders/:id/send', wrap(async (req, res) => { const out = await orders.dispatchSupplierOrder(+req.params.id, { force: !!(req.body || {}).force }); await audit(req.user.id, 'supplier_send', `${req.params.id}:${JSON.stringify(out).slice(0, 80)}`, req.ip); res.json(out); }));
r.post('/supplier-orders/:id/mark-sent', async (req, res) => { await orders.markSupplierSent(+req.params.id); res.json({ ok: true }); });
r.post('/supplier-orders/:id/confirm', async (req, res) => {
  const so = await q.get('SELECT * FROM supplier_orders WHERE id=?', +req.params.id);
  await q.run("UPDATE supplier_orders SET status='confirmed', confirmed_at=datetime('now') WHERE id=?", so.id);
  await orders.setStatus(so.order_id, 'supplier_confirmed', 'Fornecedor confirmou'); res.json({ ok: true });
});
r.get('/supplier-orders', async (req, res) => res.json(await q.all(`SELECT so.id,so.order_id,so.status,so.channel,so.link,so.sent_at,so.created_at,s.name supplier FROM supplier_orders so LEFT JOIN suppliers s ON s.id=so.supplier_id ${req.query.status ? 'WHERE so.status=?' : ''} ORDER BY so.id DESC LIMIT 200`, ...(req.query.status ? [req.query.status] : []))));

/* ----- usuários, auditoria, dashboard ----- */
r.get('/users', async (_req, res) => res.json(await q.all('SELECT u.id,u.name,u.email,u.role,u.created_at,(SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) orders FROM users u WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 300')));
r.get('/audit', async (_req, res) => res.json(await q.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200')));
r.get('/dashboard', async (_req, res) => {
  const PAID = "('paid','awaiting_supplier','sent_supplier','supplier_confirmed','preparing','shipped','in_transit','delivered')";
  const agg = (since) => q.get(`SELECT COUNT(*) n, COALESCE(SUM(total_cents),0) rev FROM orders WHERE status IN ${PAID} ${since ? "AND created_at>=datetime('now', ?)" : ''}`, ...(since ? [since] : []));
  const thr = parseInt(allSettings().low_stock_threshold || '5', 10);
  const [all, d30, d7, items, customers, pendingReviews, awaiting, pendingPay, lowStock, byStatus, top, daily] = await Promise.all([
    agg(), agg('-30 days'), agg('-7 days'),
    q.get(`SELECT COALESCE(SUM(i.qty),0) n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.status IN ${PAID}`),
    q.get("SELECT COUNT(*) n FROM users WHERE role='customer' AND deleted_at IS NULL"),
    q.get("SELECT COUNT(*) n FROM reviews WHERE status='pending'"),
    q.get("SELECT COUNT(*) n FROM orders WHERE status='awaiting_supplier'"),
    q.get("SELECT COUNT(*) n FROM orders WHERE status='payment_pending'"),
    q.all("SELECT id,name,stock FROM products WHERE active=1 AND fulfillment='stock' AND stock<=? ORDER BY stock LIMIT 10", thr),
    q.all('SELECT status,COUNT(*) n FROM orders GROUP BY status'),
    q.all('SELECT id,name,sold FROM products ORDER BY sold DESC LIMIT 5'),
    q.all(`SELECT date(created_at) d, COUNT(*) n, SUM(total_cents) rev FROM orders WHERE status IN ${PAID} AND created_at>=datetime('now','-14 days') GROUP BY d ORDER BY d`),
  ]);
  res.json({
    orders: all.n, revenue: all.rev, ticket: all.n ? Math.round(all.rev / all.n) : 0, last30: d30, last7: d7, itemsSold: items.n, customers: customers.n,
    pendingReviews: pendingReviews.n, awaitingSupplier: awaiting.n, pendingPayment: pendingPay.n, lowStock,
    byStatus: byStatus.map((x) => ({ ...x, label: orders.STATUS[x.status] })), top, daily,
  });
});

/* ----- uploads (imagens/vídeos) -----
 * Na Vercel: Vercel Blob (BLOB_READ_WRITE_TOKEN). Local: pasta uploads/. Limite do corpo na Vercel: ~4,5 MB por requisição. */
const UP = path.join(__dirname, '..', '..', 'uploads');
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
const MAX_UPLOAD = process.env.VERCEL ? '4mb' : '25mb';
r.post('/upload', express.raw({ type: Object.keys(EXT), limit: MAX_UPLOAD }), wrap(async (req, res) => {
  const type = String(req.headers['content-type']).split(';')[0];
  const ext = EXT[type];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Arquivo inválido (use JPG, PNG, WebP, AVIF, MP4 ou WebM).');
  const name = `${Date.now()}-${token(6).replace(/[^w]/g, '')}.${ext}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import('@vercel/blob');
    const b = await put('uploads/' + name, req.body, { access: 'public', contentType: type, addRandomSuffix: false });
    return res.json({ url: b.url });
  }
  if (process.env.VERCEL) throw new HttpError(500, 'Armazenamento de arquivos não configurado (crie um Blob Store na Vercel e conecte ao projeto).');
  fs.mkdirSync(UP, { recursive: true });
  fs.writeFileSync(path.join(UP, name), req.body);
  res.json({ url: '/uploads/' + name });
}));
// Backup lógico: exporta todas as tabelas em JSON (funciona com banco remoto; no Turso prefira também `turso db shell … .dump`)
r.get('/backup', wrap(async (req, res) => {
  const tables = (await q.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%' AND name!='sessions'")).map((t) => t.name);
  const dump = { exported_at: new Date().toISOString(), tables: {} };
  for (const t of tables) dump.tables[t] = await q.all(`SELECT * FROM "${t}"`);
  await audit(req.user.id, 'backup', '', req.ip);
  res.attachment(`sport-imperativo-backup-${new Date().toISOString().slice(0, 10)}.json`).json(dump);
}));
r.use(require('./whatsapp').admin);
module.exports = r;
