const { q, init } = require('../server/db');
(async () => {
  await init();
  const cols = await q.all("SELECT e.id,e.name,e.slug,(SELECT COUNT(*) FROM product_entities pe JOIN products p ON p.id=pe.product_id AND p.active=1 WHERE pe.entity_id=e.id) n FROM entities e WHERE e.type='color' ORDER BY n DESC");
  console.log('cores:', cols.map((c) => c.name + ':' + c.n).join(' | '));
  const total = (await q.get('SELECT COUNT(*) n FROM products WHERE active=1')).n;
  const withC = (await q.get("SELECT COUNT(DISTINCT p.id) n FROM products p JOIN product_entities pe ON pe.product_id=p.id JOIN entities e ON e.id=pe.entity_id AND e.type='color' WHERE p.active=1")).n;
  console.log('ativos:', total, '| com alguma cor:', withC);
  const s = await q.get("SELECT name,tags,search_text FROM products WHERE name LIKE 'Camisa Manchester United 2008/09 Away Retro' LIMIT 1");
  console.log('exemplo:', JSON.stringify(s));
  const sch = await q.get("SELECT sql FROM sqlite_master WHERE name='products'");
  console.log('search_text em products:', /search_text/.test(sch.sql));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
