/* Terceira rodada de organização (idempotente), rodar depois das importações:
 *  - times novos entram em "Outros Clubes"/Seleções (nada solto no menu de Futebol);
 *  - Camisas Retrô só com camisas (calções retrô ficam em Calções);
 *  - Fórmula 1: Equipes · Pilotos · Vestuário; jogadores NFL só dentro de "Jogadores".
 * Uso: node --env-file=.env scripts/restructure3.js [--dry] */
const { q, client, init } = require('../server/db');

(async () => {
  await init();
  const DRY = process.argv.includes('--dry');
  const one = (slug) => q.get('SELECT * FROM entities WHERE slug=?', slug);
  let nextEnt = (await q.get('SELECT COALESCE(MAX(id),0) m FROM entities')).m;
  const ops = []; const op = (sql, ...args) => ops.push({ sql, args });
  const ID = {};
  const ensure = async (slug, type, name, sort = 100, menu = 1) => {
    const e = await one(slug);
    if (e) { ID[slug] = e.id; op('UPDATE entities SET type=?,name=?,sort=?,show_in_menu=?,active=1 WHERE id=?', type, name, sort, menu, e.id); return e.id; }
    const id = ++nextEnt; ID[slug] = id;
    op('INSERT INTO entities(id,type,name,slug,sort,show_in_menu,active) VALUES(?,?,?,?,?,?,1)', id, type, name, slug, sort, menu);
    return id;
  };
  const link = (p, c, sort = 100) => op('INSERT OR REPLACE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', p, c, sort);
  for (const s of ['futebol', 'clubes', 'selecoes', 'nfl', 'nba', 'retro', 'calcoes', 'jogadores-nfl', 'f1']) { const e = await one(s); if (e) ID[s] = e.id; }

  /* times soltos → Outros Clubes / Seleções */
  await ensure('outros-clubes', 'league', 'Outros Clubes', 900);
  if (ID.clubes) link(ID.clubes, ID['outros-clubes'], 900);
  if (ID.futebol) op("DELETE FROM entity_links WHERE parent_id=? AND child_id IN (SELECT id FROM entities WHERE type IN ('club','national_team'))", ID.futebol);
  op(`INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort)
      SELECT ?, e.id, 900 FROM entities e WHERE e.type='club' AND e.slug NOT LIKE 'nba-%' AND e.slug NOT LIKE 'nfl-%' AND e.slug NOT LIKE 'f1-%'
      AND NOT EXISTS (SELECT 1 FROM entity_links l WHERE l.child_id=e.id)`, ID['outros-clubes']);
  if (ID.selecoes) op(`INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort)
      SELECT ?, e.id, 900 FROM entities e WHERE e.type='national_team' AND NOT EXISTS (SELECT 1 FROM entity_links l WHERE l.child_id=e.id)`, ID.selecoes);

  /* Retrô só camisas */
  if (ID.retro) op("DELETE FROM product_entities WHERE entity_id=? AND product_id IN (SELECT id FROM products WHERE name NOT LIKE 'Camisa%' AND name NOT LIKE 'Kit Infantil%')", ID.retro);
  /* Calções: também ficam com o time para o filtro */

  /* NFL: jogadores só em "Jogadores" */
  if (ID.nfl) op("DELETE FROM entity_links WHERE parent_id=? AND child_id IN (SELECT id FROM entities WHERE type='player')", ID.nfl);

  /* Fórmula 1 */
  if (ID.f1) {
    await ensure('equipes-f1', 'department', 'Equipes', 1);
    await ensure('pilotos-f1', 'department', 'Pilotos', 2);
    await ensure('vestuario-f1', 'department', 'Vestuário', 3);
    op('DELETE FROM entity_links WHERE parent_id=?', ID.f1);
    link(ID.f1, ID['equipes-f1'], 1); link(ID.f1, ID['pilotos-f1'], 2); link(ID.f1, ID['vestuario-f1'], 3);
    op('DELETE FROM entity_links WHERE parent_id IN (?,?)', ID['equipes-f1'], ID['pilotos-f1']);
    op("INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) SELECT ?, id, 10 FROM entities WHERE slug LIKE 'f1-%' AND type='club'", ID['equipes-f1']);
    op("INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) SELECT ?, id, 10 FROM entities WHERE type='driver'", ID['pilotos-f1']);
  }

  console.log(`${ops.length} operações`);
  if (DRY) return process.exit(0);
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
