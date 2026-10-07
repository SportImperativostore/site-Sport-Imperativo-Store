const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

/* Banco: libSQL/Turso (SQLite remoto, funciona na Vercel) ou arquivo local em desenvolvimento.
 * TURSO_DATABASE_URL + TURSO_AUTH_TOKEN  → remoto.   Sem elas → file:data/store.db (apenas local). */
const isVercel = !!process.env.VERCEL;
const CONFIG_MSG = 'Configuração pendente: defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN em Vercel → Settings → Environment Variables e faça Redeploy (veja o README).';
let _client = null, isFile = false;
// Cliente criado sob demanda: faltar configuração gera um erro claro na requisição, em vez de derrubar a função inteira.
function getClient() {
  if (_client) return _client;
  let url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    if (isVercel) {
      // Diagnóstico (só nomes, nunca valores): ajuda a achar variável com nome errado ou em outro ambiente.
      const all = Object.keys(process.env);
      const seen = all.filter((k) => /turso|database|libsql|blob|public_url/i.test(k));
      const custom = all.filter((k) => !/^(AWS_|LAMBDA_|_|VERCEL|NOW_|NODE|PATH|PWD|HOME|LANG|TZ|SHLVL|LD_|TMPDIR|NEXT|npm_|TURBO|OLDPWD|SHELL|USER|HOSTNAME|PNPM|YARN|XDG|LOGNAME|LC_)/i.test(k));
      const e = new Error(CONFIG_MSG + ` [ambiente: ${process.env.VERCEL_ENV || '?'}; variáveis encontradas: ${seen.length ? seen.join(', ') : 'nenhuma'}; total: ${all.length}; outras: ${custom.join(',') || '-'}]`);
      e.config = true; throw e;
    }
    const dir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    url = 'file:' + (process.env.DB_FILE || path.join(dir, 'store.db'));
  }
  isFile = url.startsWith('file:');
  _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return _client;
}
const client = new Proxy({}, { get: (_t, k) => { const c = getClient(); const v = c[k]; return typeof v === 'function' ? v.bind(c) : v; } });

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

/* Colunas adicionadas depois do schema inicial (ALTER só se faltar). */
async function migrate() {
  const want = {
    supplier_orders: { wa_message_id: 'TEXT', wa_status: 'TEXT', sent_to: 'TEXT', attempts: 'INTEGER DEFAULT 0', error: 'TEXT' },
    shipments: { shipped_at: 'TEXT' },
    order_items: { custom_extra: 'TEXT' },
  };
  for (const [table, cols] of Object.entries(want)) {
    const have = new Set((await q.all(`PRAGMA table_info(${table})`)).map((c) => c.name));
    for (const [c, def] of Object.entries(cols)) if (!have.has(c)) await client.execute(`ALTER TABLE ${table} ADD COLUMN ${c} ${def}`);
  }
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS ux_so_order_supplier ON supplier_orders(order_id, supplier_id)').catch(() => {});
}

let ready;
function init() {
  return (ready ||= (async () => {
    getClient();
    if (isFile) await client.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    await client.executeMultiple(SCHEMA);
    if (isFile) { try { await client.execute('ALTER TABLE testimonials ADD COLUMN product_id INTEGER'); } catch { /* já existe */ } }
    await migrate();
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
module.exports = { client, q, tx, setting, allSettings, refreshSettings, ensureReady, init, audit, get isFile() { return isFile; } };
