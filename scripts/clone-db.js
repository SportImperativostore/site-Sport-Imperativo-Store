/* Copia o banco remoto (Turso) para um arquivo local de testes. Uso: node --env-file=.env scripts/clone-db.js <destino.db> */
const { createClient } = require('@libsql/client');
const fs = require('fs');
const SCHEMA = require('../server/schema');

(async () => {
  const dest = process.argv[2]; if (!dest) throw new Error('informe o arquivo de destino');
  if (fs.existsSync(dest)) fs.rmSync(dest);
  const src = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const dst = createClient({ url: 'file:' + dest });
  await dst.executeMultiple('PRAGMA foreign_keys=OFF;');
  await dst.executeMultiple(SCHEMA);
  const tables = (await src.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('sessions','users','audit_log','addresses')")).rows.map((r) => r[0]);
  for (const t of tables) {
    let off = 0, total = 0;
    for (;;) {
      const rs = await src.execute({ sql: `SELECT * FROM "${t}" LIMIT 2000 OFFSET ${off}` });
      if (!rs.rows.length) break;
      const cols = rs.columns, sql = `INSERT OR REPLACE INTO "${t}"(${cols.map((c) => `"${c}"`).join(',')}) VALUES(${cols.map(() => '?').join(',')})`;
      await dst.batch(rs.rows.map((r) => ({ sql, args: cols.map((_, i) => (typeof r[i] === 'bigint' ? Number(r[i]) : r[i])) })), 'write');
      total += rs.rows.length; off += 2000;
    }
    console.log(t, total);
  }
  // usuário admin para testes locais
  const { hashPassword } = require('../server/lib/auth');
  await dst.execute({ sql: "INSERT OR REPLACE INTO users(id,name,email,password_hash,role) VALUES(1,'Admin','admin@local.test',?,'admin')", args: [hashPassword('teste12345')] });
  console.log('clone pronto:', dest);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
