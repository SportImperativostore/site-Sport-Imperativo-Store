const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

/* Banco: libSQL/Turso (SQLite remoto, funciona na Vercel) ou arquivo local em desenvolvimento.
 * TURSO_DATABASE_URL + TURSO_AUTH_TOKEN  → remoto.   Sem elas → file:data/store.db (apenas local). */
const isVercel = !!process.env.VERCEL;
let url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  if (isVercel) throw new Error('Defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN nas variáveis de ambiente da Vercel.');
  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  url = 'file:' + (process.env.DB_FILE || path.join(dir, 'store.db'));
}
const isFile = url.startsWith('file:');
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const SCHEMA = require('./schema');

const clean = (a) => a.map((v) => (v === undefined ? null : v));
const toObj = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
const mk = (exec) => ({
  all: async (sql, ...p) => toObj(await exec(sql, clean(p))),
  get: async (sql, ...p) => toObj(await exec(sql, clean(p)))[0],
  run: async (sql, ...p) => { const r = await exec(sql, clean(p)); return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid || 0) }; },
});
const q = mk((sql, args) => client.execute({ sql, args }));

/** Transação: use SOMENTE o objeto Q recebido dentro do callback. */
async function tx(fn) {
  const t = await client.transaction('write');
  const Q = mk((sql, args) => t.execute({ sql, args }));
  try { const r = await fn(Q); await t.commit(); return r; } catch (e) { try { await t.rollback(); } catch { /* ignore */ } throw e; } finally { t.close(); }
}

/* Configurações em cache (evita uma consulta por produto) */
let cache = {}, cacheAt = 0;
async function refreshSettings() {
  const o = {};
  for (const r of await q.all('SELECT key,value FROM settings')) o[r.key] = r.value;
  cache = o; cacheAt = Date.now();
}
const setting = (key, def = '') => (cache[key] ?? def);
const allSettings = () => ({ ...cache });

let ready;
function init() {
  return (ready ||= (async () => {
    if (isFile) await client.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    await client.executeMultiple(SCHEMA);
    if (isFile) { try { await client.execute('ALTER TABLE testimonials ADD COLUMN product_id INTEGER'); } catch { /* já existe */ } }
    await refreshSettings();
  })());
}
/** Chamar no início de cada requisição. */
async function ensureReady() {
  await init();
  if (Date.now() - cacheAt > 15000) await refreshSettings();
}
async function audit(userId, action, detail, ip) {
  try { await q.run('INSERT INTO audit_log(user_id,action,detail,ip) VALUES(?,?,?,?)', userId || null, action, typeof detail === 'string' ? detail : JSON.stringify(detail), ip || null); } catch (e) { console.error('audit', e.message); }
}
module.exports = { client, q, tx, setting, allSettings, refreshSettings, ensureReady, init, audit, isFile };
