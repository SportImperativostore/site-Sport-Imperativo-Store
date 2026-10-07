/* Reorganiza o catálogo na nova estrutura (idempotente). Uso: node --env-file=.env scripts/restructure.js [--dry]
 *   FUTEBOL → Camisas de Futebol (Clubes · Seleções · Retrô · Jogadores · Edições Especiais) · Conjuntos · Agasalhos
 *   CHUTEIRAS (Marcas · Modalidades · Cores)   •   NBA   •   NFL
 * Também: prazo 15–30 dias úteis; tamanhos (retrô e jogador até 2XG; demais adultos até 4XG). */
const { q, client, init, refreshSettings } = require('../server/db');
const { slugify } = require('../server/lib/util');

const NBA = ['Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets', 'Chicago Bulls', 'Cleveland Cavaliers', 'Dallas Mavericks', 'Denver Nuggets', 'Detroit Pistons', 'Golden State Warriors', 'Houston Rockets', 'Indiana Pacers', 'Los Angeles Clippers', 'Los Angeles Lakers', 'Memphis Grizzlies', 'Miami Heat', 'Milwaukee Bucks', 'Minnesota Timberwolves', 'New Orleans Pelicans', 'New York Knicks', 'Oklahoma City Thunder', 'Orlando Magic', 'Philadelphia 76ers', 'Phoenix Suns', 'Portland Trail Blazers', 'Sacramento Kings', 'San Antonio Spurs', 'Toronto Raptors', 'Utah Jazz', 'Washington Wizards'];
const NFL = ['Arizona Cardinals', 'Atlanta Falcons', 'Baltimore Ravens', 'Buffalo Bills', 'Carolina Panthers', 'Chicago Bears', 'Cincinnati Bengals', 'Cleveland Browns', 'Dallas Cowboys', 'Denver Broncos', 'Detroit Lions', 'Green Bay Packers', 'Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars', 'Kansas City Chiefs', 'Las Vegas Raiders', 'Los Angeles Chargers', 'Los Angeles Rams', 'Miami Dolphins', 'Minnesota Vikings', 'New England Patriots', 'New Orleans Saints', 'New York Giants', 'New York Jets', 'Philadelphia Eagles', 'Pittsburgh Steelers', 'San Francisco 49ers', 'Seattle Seahawks', 'Tampa Bay Buccaneers', 'Tennessee Titans', 'Washington Commanders'];
const COLORS = ['Preta', 'Branca', 'Azul', 'Vermelha', 'Amarela', 'Verde', 'Laranja', 'Rosa', 'Cinza', 'Dourada'];
const SPECIAL = /edi[cç][aã]o especial|special|anivers|centen|revers[ií]vel|copa do mundo|world cup|\bfinal\b|champion|new year|commemorat/i;

(async () => {
  await init();
  const DRY = process.argv.includes('--dry');
  const one = async (slug) => q.get('SELECT * FROM entities WHERE slug=?', slug);
  let nextEnt = (await q.get('SELECT COALESCE(MAX(id),0) m FROM entities')).m;
  const ops = [];
  const op = (sql, ...args) => ops.push({ sql, args });
  const ID = {}; // slug -> id (inclui os criados nesta execução)
  const ensure = async (slug, type, name, sort = 100, menu = 1) => {
    const e = await one(slug);
    if (e) { ID[slug] = e.id; op('UPDATE entities SET type=?,name=?,sort=?,show_in_menu=?,active=1 WHERE id=?', type, name, sort, menu, e.id); return e.id; }
    const id = ++nextEnt; ID[slug] = id;
    op('INSERT INTO entities(id,type,name,slug,sort,show_in_menu,active) VALUES(?,?,?,?,?,?,1)', id, type, name, slug, sort, menu);
    return id;
  };
  const link = (p, c, sort = 100) => op('INSERT OR REPLACE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', ID[p], ID[c], sort);

  /* --- esportes (menu principal) --- */
  for (const [slug, name, sort] of [['futebol', 'Futebol', 1], ['chuteiras', 'Chuteiras', 2], ['nba', 'NBA', 3], ['nfl', 'NFL', 4]]) await ensure(slug, 'sport', name, sort);
  for (const slug of ['f1', 'agasalhos-conjuntos']) { const e = await one(slug); if (e) op('UPDATE entities SET show_in_menu=0,active=0 WHERE id=?', e.id); }
  const sportIds = ['futebol', 'nba', 'nfl'].map((s) => ID[s]);

  /* --- FUTEBOL --- */
  await ensure('camisas-de-futebol', 'department', 'Camisas de Futebol', 1);
  await ensure('conjuntos', 'department', 'Conjuntos', 2);
  await ensure('agasalhos', 'department', 'Agasalhos', 3);
  const camG = [['clubes', 'Clubes'], ['selecoes', 'Seleções'], ['retro', 'Retrô'], ['jogadores', 'Jogadores'], ['edicoes-especiais', 'Edições Especiais']];
  camG.forEach(([s, n], i) => ensure(s, 'group', n, i + 1));
  const conjG = [['conjuntos-de-clubes', 'Conjuntos de clubes'], ['conjuntos-de-selecoes', 'Conjuntos de seleções'], ['conjuntos-infantis', 'Conjuntos infantis'], ['outros-conjuntos-esportivos', 'Outros conjuntos esportivos']];
  const agG = [['agasalhos-de-clubes', 'Agasalhos de clubes'], ['agasalhos-de-selecoes', 'Agasalhos de seleções'], ['agasalhos-esportivos', 'Agasalhos esportivos'], ['jaquetas-e-conjuntos-de-agasalho', 'Jaquetas e conjuntos de agasalho']];
  conjG.forEach(([s, n], i) => ensure(s, 'group', n, i + 1)); agG.forEach(([s, n], i) => ensure(s, 'group', n, i + 1));
  // versões (filtros, não aparecem no menu)
  for (const [s, n] of [['torcedor', 'Torcedor'], ['feminina', 'Feminina'], ['infantil', 'Infantil'], ['manga-longa', 'Manga Longa']]) await ensure(s, 'version', n, 50, 0);
  const sel = await one('selecoes'); // a "liga" Seleções vira o grupo Seleções (mantém os times ligados a ela)
  const leagues = (await q.all("SELECT id,slug FROM entities WHERE type='league' AND slug!='selecoes' ORDER BY sort,name"));
  for (const l of leagues) ID['L:' + l.slug] = l.id;

  // limpa vínculos de menu dos esportes e refaz
  op(`DELETE FROM entity_links WHERE parent_id IN (${sportIds.join(',')})`);
  link('futebol', 'camisas-de-futebol', 1); link('futebol', 'conjuntos', 2); link('futebol', 'agasalhos', 3);
  camG.forEach(([s], i) => link('camisas-de-futebol', s, i + 1));
  conjG.forEach(([s], i) => link('conjuntos', s, i + 1)); agG.forEach(([s], i) => link('agasalhos', s, i + 1));
  op('DELETE FROM entity_links WHERE parent_id IN (?,?,?)', ID['camisas-de-futebol'], ID.conjuntos, ID.agasalhos);
  camG.forEach(([s], i) => link('camisas-de-futebol', s, i + 1)); conjG.forEach(([s], i) => link('conjuntos', s, i + 1)); agG.forEach(([s], i) => link('agasalhos', s, i + 1));
  op('DELETE FROM entity_links WHERE parent_id=?', ID.clubes);
  leagues.forEach((l, i) => op('INSERT OR REPLACE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', ID.clubes, l.id, i + 1));
  op("UPDATE entities SET type='group' WHERE slug='selecoes'");

  /* --- CHUTEIRAS: Marcas / Modalidades / Cores --- */
  await ensure('marcas-chuteiras', 'department', 'Marcas', 1); await ensure('modalidades-chuteiras', 'department', 'Modalidades', 2); await ensure('cores-chuteiras', 'department', 'Cores', 3);
  op('DELETE FROM entity_links WHERE parent_id=?', ID.chuteiras);
  link('chuteiras', 'marcas-chuteiras', 1); link('chuteiras', 'modalidades-chuteiras', 2); link('chuteiras', 'cores-chuteiras', 3);
  const brands = await q.all("SELECT id FROM entities WHERE type='brand' ORDER BY sort,name"); brands.forEach((b, i) => op('INSERT OR REPLACE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', ID['marcas-chuteiras'], b.id, i + 1));
  const mods = await q.all("SELECT id FROM entities WHERE type='modality' ORDER BY sort,name"); mods.forEach((m, i) => op('INSERT OR REPLACE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', ID['modalidades-chuteiras'], m.id, i + 1));
  for (let i = 0; i < COLORS.length; i++) { const s = 'cor-' + slugify(COLORS[i]); await ensure(s, 'color', COLORS[i], i + 1, 1); link('cores-chuteiras', s, i + 1); }

  /* --- NBA e NFL --- */
  for (const [sp, label, teams] of [['nba', 'NBA', NBA], ['nfl', 'NFL', NFL]]) {
    await ensure(`jerseys-${sp}`, 'department', `Camisas / Jerseys ${label}`, 1); await ensure(`times-${sp}`, 'department', 'Times', 2); await ensure(`jogadores-${sp}`, 'department', 'Jogadores', 3);
    await ensure(`edicoes-especiais-${sp}`, 'department', 'Edições especiais', 4); await ensure(`outros-${sp}`, 'department', `Outros produtos ${label}`, 5);
    op('DELETE FROM entity_links WHERE parent_id IN (?,?)', ID[sp], ID[`times-${sp}`]);
    ['jerseys', 'times', 'jogadores', 'edicoes-especiais', 'outros'].forEach((k, i) => link(sp, `${k}-${sp}`, i + 1));
    for (let i = 0; i < teams.length; i++) {
      const slug = `${sp}-${slugify(teams[i])}`;
      await ensure(slug, 'club', teams[i], i + 1, 1); link(`times-${sp}`, slug, i + 1);
    }
  }

  /* --- reclassifica produtos --- */
  const prods = await q.all('SELECT id,name,lead_min FROM products');
  const tagRows = await q.all(`SELECT pe.product_id pid, e.slug, e.type FROM product_entities pe JOIN entities e ON e.id=pe.entity_id WHERE e.type IN ('club','national_team','category','version','group','department')`);
  const tags = {}; for (const r of tagRows) (tags[r.pid] ||= []).push(r);
  const drop = new Set(['player', 'camisas', 'regatas']); // categorias antigas
  let counts = {};
  const sizesOf = { adult: ['P', 'M', 'G', 'GG', '2XG', '3XG', '4XG'], short: ['P', 'M', 'G', 'GG', '2XG'] };
  for (const p of prods) {
    const t = tags[p.id] || []; const has = (s) => t.some((x) => x.slug === s);
    const isNT = t.some((x) => x.type === 'national_team');
    const isAg = has('agasalhos') || /corta|jaqueta|windbreaker/i.test(p.name), isKid = has('infantil') && !isAg;
    const isRetro = has('retro'), isPlayer = has('player') || has('jogadores'), isFem = has('feminina');
    let dept, group;
    if (isAg) { dept = 'agasalhos'; group = /jaqueta/i.test(p.name) ? 'jaquetas-e-conjuntos-de-agasalho' : isNT ? 'agasalhos-de-selecoes' : 'agasalhos-de-clubes'; }
    else if (isKid) { dept = 'conjuntos'; group = 'conjuntos-infantis'; }
    else { dept = 'camisas-de-futebol'; group = isRetro ? 'retro' : SPECIAL.test(p.name) ? 'edicoes-especiais' : isPlayer ? 'jogadores' : isNT ? 'selecoes' : 'clubes'; }
    // remove vínculos antigos de departamento/grupo e aplica os novos
    op(`DELETE FROM product_entities WHERE product_id=? AND entity_id IN (SELECT id FROM entities WHERE type IN ('department','group') OR slug IN ('player','camisas','regatas','retro','agasalhos','conjuntos','edicoes-especiais'))`, p.id);
    for (const s of ['futebol', dept, group]) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', p.id, ID[s]);
    if (isPlayer) { /* grupo 'jogadores' já aplicado; mantém versão como filtro */ }
    counts[group] = (counts[group] || 0) + 1;
    // tamanhos
    let sizes = null;
    if (isRetro || group === 'jogadores') sizes = sizesOf.short; else if (isFem || isKid) sizes = null; else sizes = sizesOf.adult;
    if (sizes) { op('DELETE FROM variants WHERE product_id=?', p.id); sizes.forEach((s) => op('INSERT OR IGNORE INTO variants(product_id,size,stock) VALUES(?,?,0)', p.id, s)); }
  }
  op('UPDATE products SET lead_min=15, lead_max=30');
  op("UPDATE size_guides SET notes=notes WHERE 1=0");
  console.log('grupos:', counts, '| operações:', ops.length);
  if (DRY) return process.exit(0);
  for (let i = 0; i < ops.length; i += 250) await client.batch(ops.slice(i, i + 250), 'write');
  // remove categorias antigas sem uso
  await client.batch(["DELETE FROM entities WHERE slug IN ('player','camisas','regatas')"], 'write');
  await refreshSettings();
  const n = await q.get('SELECT (SELECT COUNT(*) FROM products) p, (SELECT COUNT(*) FROM entities) e');
  console.log('OK', n);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
