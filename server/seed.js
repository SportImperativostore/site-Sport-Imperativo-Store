/* Dados iniciais DEMONSTRATIVOS. Produtos, preços e imagens são fictícios (imagens ilustrativas geradas).
 * Substitua pelo catálogo real pelo painel /admin/. */
const crypto = require('crypto');
const { q, client, init, refreshSettings } = require('./db');
const { hashPassword } = require('./lib/auth');
const { slugify, norm } = require('./lib/util');

/* O seed monta uma fila de operações (IDs definidos localmente) e a executa em lotes — rápido mesmo com banco remoto.
 * SEED_DEMO=0 cria apenas a estrutura base (esportes, categorias, ligas, páginas, admin) sem produtos de demonstração. */
const ops = [];
const op = (sql, ...args) => { ops.push({ sql, args: args.map((a) => (a === undefined ? null : a)) }); };
let DEMO = true;
async function ensureSeed(opts = {}) {
  await init();
  if ((await q.get('SELECT COUNT(*) c FROM entities')).c > 0) return false;
  DEMO = opts.demo ?? process.env.SEED_DEMO !== '0';
  ops.length = 0;
  seed();
  for (let i = 0; i < ops.length; i += 150) await client.batch(ops.slice(i, i + 150), 'write');
  await refreshSettings();
  return true;
}
const E = {}; // slug -> id
const NAME = {}; // id -> nome
const made = [];
let nextEnt = 0, nextGuide = 0, nextProd = 0;
function ent(type, name, o = {}) {
  const slug = o.slug || slugify(name);
  const id = ++nextEnt;
  op('INSERT INTO entities(id,type,name,slug,description,color1,color2,country_id,sort,show_in_menu,banner) VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, type, name, slug, o.desc || null, o.c1 || null, o.c2 || null, o.country ? E[o.country] : null, o.sort ?? 100, o.menu === false ? 0 : 1, o.banner || null);
  E[slug] = id; NAME[id] = name;
  return slug;
}
const link = (p, c, sort = 100) => op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', E[p], E[c], sort);

function seed() {
  const S = (k, v) => op('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', k, String(v));
  S('store_name', 'Sport Imperativo Store'); S('slogan', 'Aqui você veste o esporte.'); S('whatsapp', ''); S('instagram', 'https://www.instagram.com/'); S('tiktok', 'https://www.tiktok.com/'); S('youtube', 'https://www.youtube.com/');
  S('email', 'contato@sportimperativo.com.br'); S('pix_pct', 5); S('max_installments', 12); S('min_installment_cents', 3000); S('personalization_cents', 2500); S('free_shipping_over_cents', 29900);
  S('origin_cep', '11010000'); S('low_stock_threshold', 5); S('instagram_feedback_url', 'https://www.instagram.com/'); S('company_name', 'Sport Imperativo Store'); S('cnpj', '');
  S('import_notice', 'Este produto é enviado do exterior. O prazo de entrega é maior que o de produtos à pronta entrega. Eventuais tributos ou taxas de importação aplicáveis serão tratados conforme a legislação e as condições informadas no momento da compra.');

  ['P', 'M', 'G', 'GG', 'XGG', '2XG', '3XG', 'Infantil 4', 'Infantil 8', 'Infantil 12', '37', '38', '39', '40', '41', '42', '43', '44', 'Único'].forEach((n, i) => op('INSERT INTO sizes(name,sort) VALUES(?,?)', n, (i + 1) * 10));
  const guide = (name, headers, rows, notes) => { op('INSERT INTO size_guides(id,name,headers,rows,notes) VALUES(?,?,?,?,?)', ++nextGuide, name, JSON.stringify(headers), JSON.stringify(rows), notes); return nextGuide; };
  const H = ['Tamanho', 'Largura (cm)', 'Comprimento (cm)'];
  const G = {
    torcedor: guide('Torcedor', H, [['P', 52, 70], ['M', 54, 72], ['G', 57, 74], ['GG', 60, 76], ['XGG', 63, 78], ['2XG', 66, 80], ['3XG', 69, 82]], 'Medidas aproximadas do produto. Em dúvida, escolha o tamanho acima.'),
    player: guide('Player (corte slim)', H, [['P', 49, 68], ['M', 51, 70], ['G', 54, 72], ['GG', 57, 74], ['XGG', 60, 76]], 'Modelagem mais justa: recomendamos um tamanho acima do habitual.'),
    feminina: guide('Feminina', H, [['P', 44, 61], ['M', 47, 63], ['G', 50, 65], ['GG', 53, 67]], 'Modelagem baby look.'),
    infantil: guide('Infantil', ['Tamanho', 'Idade', 'Altura (cm)'], [['Infantil 4', '3-4 anos', '100'], ['Infantil 8', '7-8 anos', '128'], ['Infantil 12', '11-12 anos', '150']], null),
    retro: guide('Retrô', H, [['P', 53, 71], ['M', 55, 73], ['G', 58, 75], ['GG', 61, 77], ['XGG', 64, 79]], 'Camisas retrô seguem modelagem clássica, mais ampla.'),
    chuteira: guide('Chuteiras', ['Tamanho BR', 'Comprimento do pé (cm)'], [['37', '24,0'], ['38', '24,7'], ['39', '25,3'], ['40', '26,0'], ['41', '26,7'], ['42', '27,3'], ['43', '28,0'], ['44', '28,7']], 'Meça o pé do calcanhar à ponta do dedo maior.'),
  };

  // ---- Esportes / seções ----
  ent('sport', 'Futebol', { sort: 1, desc: 'Camisas de futebol de clubes e seleções: torcedor, player, retrô e muito mais.' });
  ent('sport', 'NBA', { sort: 2, desc: 'Camisas e regatas da NBA.' }); ent('sport', 'NFL', { sort: 3, desc: 'Jerseys da NFL.' });
  ent('sport', 'F1', { sort: 4, desc: 'Camisas e itens das equipes e pilotos da Fórmula 1.' });
  ent('sport', 'Chuteiras', { sort: 5, desc: 'Chuteiras de campo, society e futsal.' });
  ent('sport', 'Agasalhos & Conjuntos', { sort: 6, slug: 'agasalhos-conjuntos', desc: 'Agasalhos e conjuntos esportivos.' });

  // ---- Categorias ----
  const cats = [['Torcedor', 1], ['Player', 2], ['Retrô', 3], ['Manga Longa', 4], ['Feminina', 5], ['Infantil', 6], ['Agasalhos', 7], ['Conjuntos', 8], ['Edições Especiais', 9], ['Camisas', 10], ['Regatas', 11]];
  cats.forEach(([n, s]) => ent('category', n, { sort: s }));
  const fCats = ['torcedor', 'player', 'retro', 'manga-longa', 'feminina', 'infantil', 'agasalhos', 'conjuntos', 'edicoes-especiais'];
  fCats.forEach((c, i) => link('futebol', c, i));
  ['camisas', 'player', 'retro', 'regatas', 'edicoes-especiais'].forEach((c, i) => link('nba', c, i));
  ['camisas', 'player', 'retro', 'edicoes-especiais'].forEach((c, i) => link('nfl', c, i));
  ['camisas', 'edicoes-especiais'].forEach((c, i) => link('f1', c, i));
  ['agasalhos', 'conjuntos'].forEach((c, i) => link('agasalhos-conjuntos', c, i));

  // ---- Países ----
  ['Brasil', 'Inglaterra', 'Espanha', 'Itália', 'Alemanha', 'França', 'Portugal', 'Argentina', 'Uruguai', 'Chile', 'Colômbia', 'Holanda', 'Estados Unidos'].forEach((n, i) => ent('country', n, { sort: i, menu: false }));

  // ---- Ligas e competições ----
  const leagues = [['Brasileirão Série A', 'brasil'], ['Brasileirão Série B', 'brasil'], ['Premier League', 'inglaterra'], ['La Liga', 'espanha'], ['Serie A', 'italia'], ['Bundesliga', 'alemanha'], ['Ligue 1', 'franca'], ['Liga Portugal', 'portugal'], ['MLS', 'estados-unidos'], ['Eredivisie', 'holanda'], ['Outras Ligas', null]];
  leagues.forEach(([n, c], i) => { ent('league', n, { sort: i, country: c }); link('futebol', slugify(n), i); });
  ['Copa do Brasil', 'Libertadores', 'Champions League', 'Europa League', 'Mundial de Clubes', 'Copa do Mundo'].forEach((n, i) => ent('competition', n, { sort: i, menu: false }));

  if (DEMO) {
  // ---- Clubes de futebol ----
  const clubs = [
    ['brasileirao-serie-a', 'brasil', [['Santos', '#ffffff', '#111111', 'plain', 'Peixe'], ['São Paulo', '#ffffff', '#e30613', 'hoops'], ['Corinthians', '#ffffff', '#111111', 'plain'], ['Palmeiras', '#006437', '#ffffff', 'plain'], ['Flamengo', '#d4202c', '#111111', 'hoops'], ['Vasco', '#111111', '#ffffff', 'sash'], ['Botafogo', '#111111', '#ffffff', 'stripes'], ['Fluminense', '#7a0019', '#0b7a3b', 'stripes'], ['Internacional', '#e5050f', '#ffffff', 'plain'], ['Grêmio', '#0d80bf', '#111111', 'stripes'], ['Atlético-MG', '#111111', '#ffffff', 'stripes'], ['Cruzeiro', '#1d4ed8', '#ffffff', 'plain'], ['Bahia', '#1d4ed8', '#e30613', 'half']]],
    ['premier-league', 'inglaterra', [['Manchester United', '#da291c', '#ffffff', 'plain'], ['Manchester City', '#6cabdd', '#ffffff', 'plain'], ['Liverpool', '#c8102e', '#ffffff', 'plain'], ['Arsenal', '#ef0107', '#ffffff', 'plain'], ['Chelsea', '#034694', '#ffffff', 'plain'], ['Tottenham', '#ffffff', '#132257', 'plain'], ['Newcastle', '#111111', '#ffffff', 'stripes'], ['Aston Villa', '#670e36', '#95bfe5', 'plain']]],
    ['la-liga', 'espanha', [['Real Madrid', '#ffffff', '#febe10', 'plain'], ['Barcelona', '#a50044', '#004d98', 'stripes'], ['Atlético de Madrid', '#cb3524', '#ffffff', 'stripes'], ['Sevilla', '#ffffff', '#d4202c', 'plain']]],
    ['serie-a', 'italia', [['Juventus', '#111111', '#ffffff', 'stripes'], ['Milan', '#fb090b', '#111111', 'stripes'], ['Inter de Milão', '#0068a8', '#111111', 'stripes'], ['Napoli', '#12a0d7', '#ffffff', 'plain'], ['Roma', '#8e1f2f', '#f0bc42', 'plain']]],
    ['bundesliga', 'alemanha', [['Bayern de Munique', '#dc052d', '#ffffff', 'plain'], ['Borussia Dortmund', '#fde100', '#111111', 'plain']]],
    ['ligue-1', 'franca', [['PSG', '#004170', '#da291c', 'plain'], ['Olympique de Marseille', '#ffffff', '#2faee0', 'plain']]],
    ['liga-portugal', 'portugal', [['Benfica', '#e30613', '#ffffff', 'plain'], ['Porto', '#003f7f', '#ffffff', 'stripes'], ['Sporting', '#00833e', '#ffffff', 'hoops']]],
    ['mls', 'estados-unidos', [['Inter Miami', '#f7b5cd', '#111111', 'plain']]],
    ['eredivisie', 'holanda', [['Ajax', '#ffffff', '#d2122e', 'plain']]],
    ['outras-ligas', 'argentina', [['Boca Juniors', '#0b2a6f', '#f4c20d', 'plain'], ['River Plate', '#ffffff', '#e30613', 'sash']]],
  ];
  const clubList = [];
  for (const [lg, country, list] of clubs) list.forEach(([n, c1, c2, st], i) => { const s = ent('club', n, { c1, c2, country, menu: true, sort: i }); link(lg, s, i); link('futebol', s, 500); clubList.push({ slug: s, name: n, c1, c2, st, league: lg, country, brasil: lg.startsWith('brasileirao') }); });
  // Clubes que também disputam outras competições (muitos-para-muitos)
  ['santos', 'flamengo', 'palmeiras', 'sao-paulo', 'corinthians'].forEach((c) => { link('libertadores', c); link('copa-do-brasil', c); });
  ['real-madrid', 'barcelona', 'manchester-city', 'liverpool', 'psg', 'bayern-de-munique'].forEach((c) => link('champions-league', c));

  // ---- Seleções ----
  const nts = [['Brasil', '#ffdf00', '#009739', 'plain'], ['Argentina', '#75aadb', '#ffffff', 'stripes'], ['França', '#0b2a6f', '#ffffff', 'plain'], ['Portugal', '#c8102e', '#006600', 'plain'], ['Espanha', '#c60b1e', '#ffc400', 'plain'], ['Inglaterra', '#ffffff', '#1d2a6e', 'plain'], ['Alemanha', '#ffffff', '#111111', 'plain'], ['Itália', '#1d5bd1', '#ffffff', 'plain'], ['Holanda', '#f36c21', '#ffffff', 'plain'], ['Uruguai', '#6fb1e5', '#111111', 'plain']];
  const ntList = nts.map(([n, c1, c2, st], i) => { const s = ent('national_team', 'Seleção ' + n, { slug: 'selecao-' + slugify(n), c1, c2, sort: i }); link('futebol', s, i); link('copa-do-mundo', s); return { slug: s, name: 'Seleção ' + n, c1, c2, st }; });

  // ---- NBA / NFL / F1 ----
  const team = (sport, list) => list.map(([n, c1, c2, st], i) => { const s = ent('club', n, { c1, c2, sort: i, slug: sport + '-' + slugify(n) }); link(sport, s, i); return { slug: s, name: n, c1, c2, st }; });
  const nba = team('nba', [['Lakers', '#552583', '#fdb927', 'plain'], ['Warriors', '#1d428a', '#ffc72c', 'plain'], ['Celtics', '#007a33', '#ffffff', 'plain'], ['Bulls', '#ce1141', '#111111', 'plain'], ['Knicks', '#006bb6', '#f58426', 'plain'], ['Heat', '#98002e', '#f9a01b', 'plain'], ['Nets', '#111111', '#ffffff', 'plain']]);
  const nfl = team('nfl', [['Chiefs', '#e31837', '#ffb81c', 'plain'], ['49ers', '#aa0000', '#b3995d', 'plain'], ['Cowboys', '#003594', '#869397', 'plain'], ['Patriots', '#002244', '#c60c30', 'plain'], ['Eagles', '#004c54', '#a5acaf', 'plain'], ['Packers', '#203731', '#ffb612', 'plain'], ['Bills', '#00338d', '#c60c30', 'plain']]);
  const f1 = team('f1', [['Ferrari', '#dc0000', '#ffffff', 'plain'], ['Red Bull', '#1e41ff', '#ffcc00', 'plain'], ['McLaren', '#ff8000', '#111111', 'plain'], ['Mercedes', '#00d2be', '#111111', 'plain'], ['Aston Martin', '#006f62', '#cedc00', 'plain']]);
  [['Max Verstappen', 'f1-red-bull'], ['Lewis Hamilton', 'f1-ferrari'], ['Charles Leclerc', 'f1-ferrari'], ['Lando Norris', 'f1-mclaren'], ['George Russell', 'f1-mercedes']].forEach(([n, t], i) => { const s = ent('driver', n, { sort: i }); link('f1', s, i); link(t, s, i); });

  // ---- Chuteiras ----
  ['Campo', 'Society', 'Futsal'].forEach((n, i) => { const s = ent('modality', n, { sort: i }); link('chuteiras', s, i); });
  const brands = { Nike: ['Mercurial', 'Phantom', 'Tiempo'], Adidas: ['Predator', 'F50', 'Copa'], Puma: ['Future', 'Ultra', 'King'], Mizuno: ['Morelia', 'Alpha'], Outras: [] };
  Object.entries(brands).forEach(([b, models], i) => { const bs = ent('brand', b, { sort: i }); link('chuteiras', bs, i); models.forEach((m, j) => { const ms = ent('model', `${b} ${m}`, { slug: slugify(b + '-' + m) }); link(bs, ms, j); }); });

  // ---- Fornecedor demonstrativo ----
  const sup = 1;
  op("INSERT INTO suppliers(id,name,contact,channel,notes) VALUES(1,'Fornecedor Demonstrativo (Exterior)','Contato','whatsapp','DEMO: configure o WhatsApp/e-mail/webhook reais em Fornecedores.')");

  // ---- Produtos ----
  let seedN = 7;
  const rnd = () => { seedN = (seedN * 1103515245 + 12345) & 0x7fffffff; return seedN / 0x7fffffff; };
  const sizesAdult = ['P', 'M', 'G', 'GG', 'XGG'];
  let sku = 1000;
  const add = (o) => {
    const price = o.price, sale = o.sale || null, soldOf = Math.floor(rnd() * 120);
    const id = ++nextProd;
    op(`INSERT INTO products(id,slug,name,description,price_cents,sale_price_cents,fulfillment,stock,shipping_rule,shipping_fixed_cents,origin,lead_min,lead_max,weight_g,supplier_id,supplier_sku,supplier_cost_cents,customizable,size_guide_id,badge,tags,style,color1,color2,shape,sold,sku,rating_avg,rating_count,sale_ends)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, id, o.slug, o.name, o.desc, price, sale, o.imp ? 'import' : 'stock', o.imp ? 0 : o.stock, o.imp ? 'free' : 'cep', 0, o.imp ? 'China' : null, o.imp ? 18 : null, o.imp ? 40 : null, o.weight || 400,
      o.imp ? sup : null, o.imp ? 'SKU-' + sku : null, o.imp ? Math.round(price * 0.45) : null, o.custom ? 1 : 0, o.guide || null, o.badge || null, o.tags || '', o.style, o.c1, o.c2, o.shape || 'jersey', soldOf, 'SI-' + (sku++),
      0, 0, sale ? new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 19).replace('T', ' ') : null);
    for (const e of o.ents) if (E[e]) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', id, E[e]);
    let total = 0;
    for (const s of o.sizes || []) { const st = o.imp ? 0 : Math.floor(rnd() * 6) + (rnd() > 0.85 ? 0 : 1); total += st; op('INSERT INTO variants(product_id,size,stock) VALUES(?,?,?)', id, s, st); }
    if (!o.imp && o.sizes) op('UPDATE products SET stock=? WHERE id=?', total, id);
    op('UPDATE products SET search_text=? WHERE id=?', norm([o.name, o.tags, 'SI-' + (sku - 1), ...o.ents.filter((e) => E[e]).map((e) => NAME[E[e]])].join(' ')), id);
    made.push({ id, sold: soldOf });
    return id;
  };
  const yr = (i) => [1995, 2002, 1999, 2011, 1982, 2005, 1970, 2000][i % 8];
  clubList.forEach((c, i) => {
    const imp = !c.brasil || rnd() > 0.6;
    const base = { c1: c.c1, c2: c.c2, style: c.st, imp, custom: true, sizes: sizesAdult };
    const E_ = (...x) => ['futebol', c.league, c.country, c.slug, ...x];
    add({ ...base, slug: `camisa-${c.slug}-i-2025-26-torcedor`, name: `Camisa ${c.name} I 2025/26 Torcedor`, desc: `Camisa ${c.name} modelo torcedor, temporada 2025/26. Tecido leve com acabamento premium.`, price: 18990, sale: rnd() > 0.5 ? 15990 : null, stock: 12, guide: G.torcedor, ents: E_('torcedor'), tags: 'camisa camiseta jersey home titular', badge: i % 5 === 0 ? 'MAIS VENDIDO' : null });
    add({ ...base, slug: `camisa-${c.slug}-ii-2025-26-torcedor`, name: `Camisa ${c.name} II 2025/26 Torcedor`, desc: `Camisa reserva ${c.name} 2025/26, modelo torcedor.`, c1: c.c2, c2: c.c1, price: 18990, stock: 8, guide: G.torcedor, ents: E_('torcedor'), tags: 'camisa camiseta away reserva', badge: 'NOVO' });
    if (i % 2 === 0) add({ ...base, slug: `camisa-${c.slug}-i-2025-26-player`, name: `Camisa ${c.name} I 2025/26 Player`, desc: `Versão jogador (player) da camisa do ${c.name}, corte slim.`, price: 24990, stock: 6, imp: true, guide: G.player, ents: E_('player'), tags: 'camisa player jogador authentic' });
    add({ ...base, slug: `camisa-${c.slug}-retro-${yr(i)}`, name: `Camisa ${c.name} Retrô ${yr(i)}`, desc: `Camisa retrô do ${c.name} (${yr(i)}). Modelagem clássica para colecionadores.`, price: 19990, sale: i % 3 === 0 ? 16990 : null, stock: 5, guide: G.retro, ents: E_('retro'), tags: 'camisa retro retrô classica antiga ' + yr(i), badge: i % 4 === 1 ? 'ÚLTIMAS UNIDADES' : null });
    if (i % 3 === 0) add({ ...base, slug: `camisa-${c.slug}-i-2025-26-manga-longa`, name: `Camisa ${c.name} I 2025/26 Manga Longa`, desc: `Manga longa ${c.name}.`, price: 20990, stock: 4, imp: true, guide: G.torcedor, ents: E_('manga-longa'), tags: 'camisa manga longa' });
    if (i % 3 === 1) add({ ...base, slug: `camisa-${c.slug}-i-2025-26-feminina`, name: `Camisa ${c.name} I 2025/26 Feminina`, desc: `Baby look ${c.name}.`, price: 17990, stock: 4, sizes: ['P', 'M', 'G', 'GG'], guide: G.feminina, ents: E_('feminina'), tags: 'camisa feminina baby look' });
    if (i % 3 === 2) add({ ...base, slug: `camisa-${c.slug}-i-2025-26-infantil`, name: `Camisa ${c.name} I 2025/26 Infantil`, desc: `Camisa infantil ${c.name}.`, price: 15990, stock: 5, sizes: ['Infantil 4', 'Infantil 8', 'Infantil 12'], guide: G.infantil, ents: E_('infantil'), tags: 'camisa infantil criança kids' });
    if (i % 4 === 0) add({ ...base, shape: 'jersey', slug: `conjunto-${c.slug}-2025-26`, name: `Conjunto ${c.name} Treino 2025/26`, desc: `Conjunto de treino ${c.name}: agasalho e calça.`, price: 32990, stock: 5, imp: true, custom: false, guide: G.torcedor, ents: [...E_('conjuntos'), 'agasalhos-conjuntos'], tags: 'conjunto agasalho treino' });
    if (i % 4 === 2) add({ ...base, slug: `agasalho-${c.slug}-2025-26`, name: `Agasalho ${c.name} 2025/26`, desc: `Jaqueta de agasalho ${c.name}.`, price: 27990, stock: 5, custom: false, guide: G.torcedor, ents: [...E_('agasalhos'), 'agasalhos-conjuntos'], tags: 'agasalho jaqueta', style: 'half' });
  });
  ntList.forEach((c, i) => {
    add({ c1: c.c1, c2: c.c2, style: c.st, imp: true, custom: true, sizes: sizesAdult, slug: `camisa-${c.slug}-2026-torcedor`, name: `Camisa ${c.name} 2026 Torcedor`, desc: `Camisa oficial-estilo da ${c.name}, modelo torcedor.`, price: 19990, sale: i < 3 ? 16990 : null, stock: 10, guide: G.torcedor, ents: ['futebol', c.slug, 'copa-do-mundo', 'torcedor'], tags: 'camisa selecao copa mundo', badge: i < 2 ? 'MAIS VENDIDO' : 'NOVO' });
  });
  const sp = (list, sport, shape, kind, price) => list.forEach((c, i) => add({ c1: c.c1, c2: c.c2, style: c.st, shape, imp: i % 2 === 0, custom: true, sizes: sizesAdult, slug: `${kind}-${c.slug}`, name: `${kind === 'regata' ? 'Regata' : kind === 'jersey' ? 'Jersey' : 'Camisa'} ${c.name}`, desc: `${c.name} — item ${sport.toUpperCase()}.`, price, sale: i % 3 === 0 ? price - 3000 : null, stock: 7, guide: G.torcedor, ents: [sport, c.slug, sport === 'nba' ? 'regatas' : 'camisas'], tags: `${sport} ${kind}`, badge: i === 0 ? 'MAIS VENDIDO' : null }));
  sp(nba, 'nba', 'tank', 'regata', 21990); sp(nfl, 'nfl', 'jersey', 'jersey', 25990); sp(f1, 'f1', 'jersey', 'camisa', 17990);

  const boots = [['Nike', 'Mercurial', 'Campo', 79990, '#ff6b00', '#111111'], ['Nike', 'Phantom', 'Society', 59990, '#111111', '#a3ff12'], ['Nike', 'Tiempo', 'Futsal', 39990, '#ffffff', '#111111'], ['Adidas', 'Predator', 'Campo', 74990, '#d4202c', '#111111'], ['Adidas', 'F50', 'Society', 54990, '#ffd400', '#111111'], ['Adidas', 'Copa', 'Futsal', 34990, '#111111', '#ffffff'], ['Puma', 'Future', 'Campo', 69990, '#0b5cff', '#ffffff'], ['Puma', 'Ultra', 'Society', 49990, '#f9ff00', '#111111'], ['Mizuno', 'Morelia', 'Campo', 64990, '#ffffff', '#0b5cff'], ['Mizuno', 'Alpha', 'Society', 44990, '#111111', '#e30613']];
  boots.forEach(([b, m, mod, price, c1, c2], i) => add({ c1, c2, style: 'plain', shape: 'boot', imp: false, custom: false, sizes: ['38', '39', '40', '41', '42', '43', '44'], slug: slugify(`chuteira-${b}-${m}-${mod}`), name: `Chuteira ${b} ${m} ${mod}`, desc: `Chuteira ${b} ${m} para ${mod.toLowerCase()}.`, price, sale: i % 3 === 0 ? price - 10000 : null, stock: 9, weight: 800, guide: G.chuteira, ents: ['chuteiras', slugify(b), slugify(b + '-' + m), slugify(mod)], tags: `chuteira ${b} ${m} ${mod}`, badge: i === 0 ? 'MAIS VENDIDO' : i === 4 ? 'NOVO' : null }));

  } // fim do bloco DEMO

  // ---- Banners ----
  const B = (t, s, cta, l, o) => op('INSERT INTO banners(title,subtitle,cta_text,link,sort) VALUES(?,?,?,?,?)', t, s, cta, l, o);
  B('AQUI VOCÊ VESTE O ESPORTE.', 'Camisas de futebol, NBA, NFL, F1, chuteiras e muito mais.', 'COMPRAR AGORA', '/futebol', 1);
  B('OFERTAS DA TEMPORADA', 'Descontos em camisas selecionadas. Pix com desconto adicional.', 'VER OFERTAS', '/ofertas', 2);
  B('CHUTEIRAS', 'Campo, society e futsal das melhores marcas.', 'VER CHUTEIRAS', '/chuteiras', 3);

  // ---- Cupons ----
  op("INSERT INTO coupons(code,type,value,first_purchase,is_public,description) VALUES('BEMVINDO10','percent',10,1,1,'10% de desconto na primeira compra')");
  op("INSERT INTO coupons(code,type,value,min_cents,is_public,description) VALUES('FRETEGRATIS','free_shipping',0,19900,1,'Frete grátis em compras acima de R$ 199')");

  // ---- Depoimentos (demonstrativos — substitua pelos reais) ----
  if (DEMO) [['Carlos M.', 'Camisa Santos Retrô', 'Qualidade excelente, chegou antes do prazo!'], ['Juliana P.', 'Camisa Flamengo Feminina', 'Tecido ótimo e caimento perfeito.'], ['Rafael S.', 'Chuteira Nike Mercurial', 'Entrega rápida e produto idêntico ao anunciado.'], ['Bruno L.', 'Camisa Real Madrid Player', 'Atendimento nota 10, recomendo.']].forEach(([n, p, b], i) => op("INSERT INTO testimonials(kind,name,product_name,stars,body,sort) VALUES('text',?,?,5,?,?)", n, p, b, i));

  // ---- Páginas institucionais (modelos — revise com assessoria jurídica) ----
  const pg = (slug, title, body) => op('INSERT INTO pages(slug,title,body) VALUES(?,?,?)', slug, title, body);
  pg('sobre-nos', 'Sobre nós', '<p>A <strong>Sport Imperativo Store</strong> é uma loja brasileira especializada em produtos esportivos. <em>Aqui você veste o esporte.</em></p>');
  pg('contato', 'Contato', '<p>Fale com a gente pelo WhatsApp, Instagram ou e-mail informados no rodapé do site.</p>');
  pg('politica-de-privacidade', 'Política de Privacidade', '<p><strong>Modelo — revise com assessoria jurídica antes de publicar.</strong></p><h3>Dados que coletamos</h3><p>Nome, CPF, e-mail, telefone, endereço e dados do pedido, necessários para processar compras, emitir documentos fiscais e entregar produtos (LGPD, art. 7º, V e II).</p><h3>Compartilhamento</h3><p>Compartilhamos dados estritamente necessários com gateway de pagamento, transportadoras e fornecedores (inclusive no exterior, para produtos importados), para cumprir o pedido.</p><h3>Cartões</h3><p>Não armazenamos dados de cartão: o pagamento é processado pelo gateway.</p><h3>Seus direitos</h3><p>Você pode acessar, exportar, corrigir e excluir seus dados em <a href="/conta/seguranca">Minha conta &gt; Segurança</a> ou pelo e-mail de contato.</p>');
  pg('termos-de-uso', 'Termos de Uso', '<p><strong>Modelo — revise com assessoria jurídica antes de publicar.</strong></p><p>Ao usar o site e comprar, você concorda com estes termos. Preços e disponibilidade podem mudar sem aviso. Produtos importados têm prazo maior e podem estar sujeitos a tributos conforme a legislação, informados antes do pagamento.</p>');
  pg('politica-de-cookies', 'Política de Cookies', '<p>Usamos cookies essenciais (sessão e carrinho) e, mediante consentimento, cookies de medição. Você pode alterar sua escolha limpando os dados do site no navegador.</p>');
  pg('trocas-e-devolucoes', 'Trocas e Devoluções', '<p><strong>Modelo — revise.</strong> Você pode desistir da compra em até 7 dias após o recebimento (CDC, art. 49). Produtos personalizados só podem ser trocados em caso de defeito ou erro nosso. Para trocas por tamanho, o produto deve estar sem uso e com etiquetas.</p>');
  pg('como-comprar', 'Como comprar', '<ol><li>Escolha o esporte, liga e clube.</li><li>Selecione o tamanho e personalize, se quiser.</li><li>Calcule o frete e adicione ao carrinho.</li><li>Finalize com Pix ou cartão.</li><li>Acompanhe em Meus Pedidos.</li></ol>');
  pg('formas-de-pagamento', 'Formas de pagamento', '<p>Pix (com desconto) e cartão de crédito em até 12x, conforme o valor. Os pagamentos são processados por gateway seguro.</p>');
  pg('prazo-de-entrega', 'Prazo de entrega', '<p><strong>Pronta entrega:</strong> envio do Brasil, prazo calculado pelo CEP.</p><p><strong>Sob encomenda / importado:</strong> enviado do exterior, prazo maior (geralmente de 18 a 40 dias úteis). Eventuais tributos de importação são informados antes do pagamento.</p>');
  pg('rastreamento', 'Rastreamento', '<p>Acompanhe seu pedido em <a href="/conta/pedidos">Meus Pedidos</a>. O código de rastreio aparece assim que o envio é postado.</p>');
  pg('tabela-de-medidas', 'Tabela de medidas', '<p>Veja o botão “Guia de tamanhos” na página de cada produto.</p>');

  // ---- Admin ----
  const email = (process.env.ADMIN_EMAIL || 'admin@sportimperativo.local').toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  op("INSERT INTO users(name,email,password_hash,role) VALUES('Administrador',?,?, 'admin')", email, hashPassword(pw));
  console.log('\n=== ACESSO ADMIN (anote — exibido apenas uma vez) ===');
  console.log('  URL:   /admin/\n  Email:', email, '\n  Senha:', process.env.ADMIN_PASSWORD ? '(definida em ADMIN_PASSWORD)' : pw, '\n');

  // avaliações demonstrativas
  if (DEMO) [...made].sort((a, b) => b.sold - a.sold).slice(0, 12).forEach((p, i) => { op("INSERT INTO reviews(product_id,author,stars,body,status) VALUES(?,?,?,?,'approved')", p.id, ['Lucas', 'Marina', 'Pedro', 'Ana'][i % 4], 4 + (i % 2), ['Muito bom, recomendo!', 'Tecido de qualidade e acabamento caprichado.', 'Chegou certinho, tamanho conforme a tabela.'][i % 3]); op('UPDATE products SET rating_count=1, rating_avg=? WHERE id=?', 4 + (i % 2), p.id); });
}
module.exports = { ensureSeed };
