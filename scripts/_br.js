const { q, init } = require('../server/db');
(async () => {
  await init();
  const br = await q.get("SELECT id FROM entities WHERE slug='brasileirao'");
  const kids = await q.all('SELECT e.id,e.name FROM entity_links l JOIN entities e ON e.id=l.child_id WHERE l.parent_id=? ORDER BY e.name', br.id);
  const rows = [];
  for (const k of kids) {
    const n = await q.all('SELECT p.name FROM product_entities pe JOIN products p ON p.id=pe.product_id AND p.active=1 WHERE pe.entity_id=?', k.id);
    const at = n.filter((p) => /202[56]/.test(p.name) && !/Retr/.test(p.name) && /^Camisa/.test(p.name)).length;
    rows.push(`${k.name}: ${n.length} (atuais ${at}, retrô ${n.filter((p) => /Retr/.test(p.name)).length})`);
  }
  console.log(rows.join('\n'));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
