/* Numera nomes de produto repetidos: "Nome", "Nome (2)", "Nome (3)". Uso: node --env-file=.env scripts/dedupe-names.js */
const { q, client, init } = require('../server/db');
(async () => {
  await init();
  const rows = await q.all('SELECT id,name FROM products WHERE active=1 ORDER BY id');
  const seen = new Map(), ops = [];
  for (const r of rows) {
    const base = r.name.replace(/ \(\d+\)$/, ''); const k = base.toLowerCase(); const n = (seen.get(k) || 0) + 1; seen.set(k, n);
    if (n > 1 && r.name === base) ops.push({ sql: 'UPDATE products SET name=? WHERE id=?', args: [`${base} (${n})`, r.id] });
  }
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  console.log('renomeados', ops.length); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
