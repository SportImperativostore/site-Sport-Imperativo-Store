/* Cria a seção "Times Árabes" dentro de Futebol e reúne ali os clubes árabes (idempotente).
 * Uso: node --env-file=.env scripts/restructure4.js [--dry] */
const { q, client, init } = require('../server/db');
const { norm } = require('../server/lib/util');
const ARAB = /^(al[ -]|zamalek|esperance|wydad|raja casablanca|etoile du sahel|kuwait sc|neom|ittihad|ettifaq)/;

(async () => {
  await init();
  const DRY = process.argv.includes('--dry');
  const ops = []; const op = (sql, ...args) => ops.push({ sql, args });
  const futebol = (await q.get("SELECT id FROM entities WHERE slug='futebol'")).id;
  let dept = await q.get("SELECT id FROM entities WHERE slug='times-arabes'");
  let id = dept && dept.id;
  if (!id) { id = (await q.get('SELECT COALESCE(MAX(id),0)+1 n FROM entities')).n; op("INSERT INTO entities(id,type,name,slug,sort,show_in_menu,active) VALUES(?,'department','Times Árabes','times-arabes',7,1,1)", id); }
  else op("UPDATE entities SET type='department',name='Times Árabes',sort=7,show_in_menu=1,active=1 WHERE id=?", id);
  op('INSERT OR REPLACE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,7)', futebol, id);
  const clubs = (await q.all("SELECT id,name,slug FROM entities WHERE type='club' AND slug NOT LIKE 'nba-%' AND slug NOT LIKE 'nfl-%' AND slug NOT LIKE 'f1-%'")).filter((c) => ARAB.test(norm(c.name)) || ARAB.test(c.slug.replace(/-/g, ' ')));
  clubs.forEach((c, i) => {
    op('INSERT OR REPLACE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', id, c.id, i + 1);
    op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) SELECT product_id, ? FROM product_entities WHERE entity_id=?', id, c.id);
  });
  console.log('clubes árabes:', clubs.map((c) => c.name).join(', '), '| operações', ops.length);
  if (DRY) return process.exit(0);
  for (let i = 0; i < ops.length; i += 100) await client.batch(ops.slice(i, i + 100), 'write');
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
