const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(dir, 'store.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  cpf TEXT, phone TEXT, whatsapp TEXT, role TEXT NOT NULL DEFAULT 'customer',
  consent_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), deleted_at TEXT);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS addresses(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, label TEXT,
  cep TEXT, street TEXT, number TEXT, complement TEXT, district TEXT, city TEXT, state TEXT, is_default INTEGER DEFAULT 0);

-- Entidades dinâmicas: esporte, categoria, país, liga, competição, clube, seleção, marca, modelo, modalidade, coleção
CREATE TABLE IF NOT EXISTS entities(
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
  logo TEXT, banner TEXT, description TEXT, color1 TEXT, color2 TEXT, country_id INTEGER,
  sort INTEGER DEFAULT 100, active INTEGER DEFAULT 1, show_in_menu INTEGER DEFAULT 1);
CREATE INDEX IF NOT EXISTS ix_entities_type ON entities(type);
CREATE TABLE IF NOT EXISTS entity_links(
  parent_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  sort INTEGER DEFAULT 100, PRIMARY KEY(parent_id, child_id));

CREATE TABLE IF NOT EXISTS suppliers(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, contact TEXT, whatsapp TEXT, email TEXT, link TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp', webhook_url TEXT, notes TEXT, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS size_guides(id INTEGER PRIMARY KEY, name TEXT NOT NULL, headers TEXT NOT NULL DEFAULT '[]', rows TEXT NOT NULL DEFAULT '[]', notes TEXT);
CREATE TABLE IF NOT EXISTS sizes(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort INTEGER DEFAULT 100);

CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT,
  price_cents INTEGER NOT NULL, sale_price_cents INTEGER, pix_pct REAL, max_installments INTEGER,
  fulfillment TEXT NOT NULL DEFAULT 'stock',            -- stock (pronta entrega) | import (sob encomenda)
  stock INTEGER DEFAULT 0, shipping_rule TEXT NOT NULL DEFAULT 'cep', shipping_fixed_cents INTEGER DEFAULT 0,
  origin TEXT, lead_min INTEGER, lead_max INTEGER, import_notes TEXT, weight_g INTEGER DEFAULT 400,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL, supplier_sku TEXT, supplier_link TEXT, supplier_cost_cents INTEGER, supplier_notes TEXT,
  customizable INTEGER DEFAULT 0, custom_price_cents INTEGER, size_guide_id INTEGER REFERENCES size_guides(id) ON DELETE SET NULL,
  badge TEXT, tags TEXT, video_url TEXT, meta_title TEXT, meta_description TEXT,
  style TEXT, color1 TEXT, color2 TEXT, shape TEXT DEFAULT 'jersey',
  search_text TEXT, rating_avg REAL DEFAULT 0, rating_count INTEGER DEFAULT 0, sold INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1, sale_starts TEXT, sale_ends TEXT, sku TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS ix_products_active ON products(active, sold);
CREATE TABLE IF NOT EXISTS product_entities(product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE, PRIMARY KEY(product_id, entity_id));
CREATE INDEX IF NOT EXISTS ix_pe_entity ON product_entities(entity_id);
CREATE TABLE IF NOT EXISTS product_images(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, url TEXT NOT NULL, kind TEXT DEFAULT 'image', sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS variants(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, size TEXT NOT NULL, stock INTEGER DEFAULT 0, sku TEXT, UNIQUE(product_id,size));

CREATE TABLE IF NOT EXISTS coupons(
  id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, type TEXT NOT NULL, value REAL DEFAULT 0,   -- percent | fixed | free_shipping
  product_id INTEGER, entity_id INTEGER, min_cents INTEGER DEFAULT 0, first_purchase INTEGER DEFAULT 0, is_public INTEGER DEFAULT 0, description TEXT,
  starts_at TEXT, ends_at TEXT, max_uses INTEGER, uses INTEGER DEFAULT 0, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS banners(
  id INTEGER PRIMARY KEY, title TEXT, subtitle TEXT, cta_text TEXT, link TEXT, image_desktop TEXT, image_mobile TEXT,
  starts_at TEXT, ends_at TEXT, sort INTEGER DEFAULT 100, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS favorites(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author TEXT, stars INTEGER NOT NULL, body TEXT, photos TEXT DEFAULT '[]', video_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending', featured INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS testimonials(
  id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'photo', name TEXT, product_name TEXT, stars INTEGER DEFAULT 5, body TEXT,
  media_url TEXT, link TEXT, sort INTEGER DEFAULT 100, active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS pages(slug TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT, updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, access_token TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  customer TEXT NOT NULL, address TEXT NOT NULL,                 -- JSON
  subtotal_cents INTEGER, discount_cents INTEGER DEFAULT 0, shipping_cents INTEGER DEFAULT 0, total_cents INTEGER,
  coupon_code TEXT, payment_method TEXT, installments INTEGER DEFAULT 1, shipping_info TEXT,   -- JSON dos grupos de envio
  import_ack INTEGER DEFAULT 0, notes TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT, size TEXT, qty INTEGER, unit_cents INTEGER, custom_name TEXT, custom_number TEXT, custom_cents INTEGER DEFAULT 0,
  fulfillment TEXT, supplier_id INTEGER, supplier_sku TEXT, image TEXT);
CREATE TABLE IF NOT EXISTS payments(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, provider TEXT, method TEXT, status TEXT DEFAULT 'pending',
  external_id TEXT, amount_cents INTEGER, pix_code TEXT, pix_qr TEXT, checkout_url TEXT, raw TEXT, created_at TEXT DEFAULT (datetime('now')), paid_at TEXT);
CREATE TABLE IF NOT EXISTS shipments(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, grp TEXT, carrier TEXT, code TEXT, url TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS supplier_orders(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'awaiting', channel TEXT, message TEXT, link TEXT, sent_at TEXT, confirmed_at TEXT, log TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS order_events(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, status TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, detail TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
`);

try { db.exec('ALTER TABLE testimonials ADD COLUMN product_id INTEGER'); } catch { /* já existe */ }

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const q = {
  all: (sql, ...p) => db.prepare(sql).all(...p),
  get: (sql, ...p) => db.prepare(sql).get(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};
function setting(key, def = '') {
  const r = q.get('SELECT value FROM settings WHERE key=?', key);
  return r ? r.value : def;
}
function allSettings() {
  const o = {};
  for (const r of q.all('SELECT key,value FROM settings')) o[r.key] = r.value;
  return o;
}
function audit(userId, action, detail, ip) {
  q.run('INSERT INTO audit_log(user_id,action,detail,ip) VALUES(?,?,?,?)', userId || null, action, typeof detail === 'string' ? detail : JSON.stringify(detail), ip || null);
}
module.exports = { db, q, tx, setting, allSettings, audit };
