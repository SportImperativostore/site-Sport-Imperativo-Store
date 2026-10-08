/* Segunda reorganização (idempotente): Camisas Retrô e Infantil como seções próprias, Conjuntos adultos x infantis, Calções, F1 e NBA infantil.
 *   FUTEBOL → Camisas de Futebol · Camisas Retrô · Conjuntos (Adultos | Infantis) · Agasalhos · Infantil · Calções
 * Uso: node --env-file=.env scripts/restructure2.js [--dry] */
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
  const link = (p, c, sort = 100) => op('INSERT OR REPLACE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', ID[p], ID[c], sort);
  const unlink = (p, c) => op('DELETE FROM entity_links WHERE parent_id=? AND child_id=?', ID[p], ID[c]);

  for (const s of ['futebol', 'nba', 'camisas-de-futebol', 'conjuntos', 'agasalhos', 'retro', 'conjuntos-infantis', 'clubes', 'selecoes']) { const e = await one(s); if (e) ID[s] = e.id; }
  if (!ID.futebol || !ID.retro) throw new Error('rode antes scripts/restructure.js');

  /* Camisas Retrô: sai de dentro de "Camisas de Futebol" e vira seção própria */
  await ensure('retro', 'department', 'Camisas Retrô', 2);
  unlink('camisas-de-futebol', 'retro');
  /* Infantil */
  await ensure('infantil-futebol', 'department', 'Infantil', 5);
  await ensure('conjuntos-infantis', 'group', 'Conjuntos Infantis', 2);
  await ensure('conjuntos-adultos', 'group', 'Conjuntos Adultos', 1);
  op('DELETE FROM entity_links WHERE parent_id=?', ID.conjuntos);
  link('conjuntos', 'conjuntos-adultos', 1); link('conjuntos', 'conjuntos-infantis', 2);
  op('DELETE FROM entity_links WHERE parent_id=?', ID['infantil-futebol']);
  link('infantil-futebol', 'conjuntos-infantis', 1);
  /* Calções */
  await ensure('calcoes', 'department', 'Calções', 6);
  /* ordem das seções de Futebol */
  link('futebol', 'camisas-de-futebol', 1); link('futebol', 'retro', 2); link('futebol', 'conjuntos', 3); link('futebol', 'agasalhos', 4); link('futebol', 'infantil-futebol', 5); link('futebol', 'calcoes', 6);

  /* Conjuntos adultos: tudo que está em "conjuntos" e não é infantil */
  op(`INSERT OR IGNORE INTO product_entities(product_id,entity_id)
      SELECT pe.product_id, ? FROM product_entities pe JOIN products p ON p.id=pe.product_id
      WHERE pe.entity_id=? AND pe.product_id NOT IN (SELECT product_id FROM product_entities WHERE entity_id=?)`, ID['conjuntos-adultos'], ID.conjuntos, ID['conjuntos-infantis']);
  /* infantis de futebol sempre dentro de "Conjuntos Infantis" */
  op(`INSERT OR IGNORE INTO product_entities(product_id,entity_id)
      SELECT p.id, ? FROM products p WHERE p.name LIKE 'Kit Infantil%' OR (p.name LIKE '%Infantil%' AND p.name NOT LIKE '%NBA%' AND p.name NOT LIKE '%NFL%')`, ID['conjuntos-infantis']);
  op(`INSERT OR IGNORE INTO product_entities(product_id,entity_id)
      SELECT pe.product_id, ? FROM product_entities pe WHERE pe.entity_id=?`, ID.conjuntos, ID['conjuntos-infantis']);
  op(`INSERT OR IGNORE INTO product_entities(product_id,entity_id)
      SELECT pe.product_id, ? FROM product_entities pe WHERE pe.entity_id=?`, ID['infantil-futebol'], ID['conjuntos-infantis']);

  /* Retrô: tudo que tem Retro/Retrô no nome entra na categoria; o que está na categoria ganha "Retro" no nome */
  op("INSERT OR IGNORE INTO product_entities(product_id,entity_id) SELECT p.id, ? FROM products p WHERE p.name LIKE 'Camisa%' AND (p.name LIKE '%Retro%' OR p.name LIKE '%Retrô%')", ID.retro);
  op("UPDATE products SET name = name || ' Retro', search_text = COALESCE(search_text, '') || ' retro' WHERE id IN (SELECT product_id FROM product_entities WHERE entity_id=?) AND name LIKE 'Camisa%' AND name NOT LIKE '%Retro%' AND name NOT LIKE '%Retrô%'", ID.retro);
  /* NBA infantil */
  if (ID.nba) {
    await ensure('infantil-nba', 'department', 'Infantil', 5);
    link('nba', 'infantil-nba', 5);
    op(`INSERT OR IGNORE INTO product_entities(product_id,entity_id) SELECT p.id, ? FROM products p JOIN product_entities pe ON pe.product_id=p.id WHERE pe.entity_id=? AND p.name LIKE '%Infantil%'`, ID['infantil-nba'], ID.nba);
  }
  /* Fórmula 1 como esporte do menu */
  await ensure('f1', 'sport', 'Fórmula 1', 5);

  console.log(`${ops.length} operações`);
  if (DRY) return process.exit(0);
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
