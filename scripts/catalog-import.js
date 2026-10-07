/* Importa o catálogo real (levantado de sportimperativostore.meukatalogo.com) para o banco da loja.
 *
 * Uso:
 *   node scripts/catalog-import.js --dir=D:/loja/catalogo-import --local            (copia imagens p/ public/img/catalog — só desenvolvimento)
 *   node scripts/catalog-import.js --dir=D:/loja/catalogo-import --blob             (envia imagens ao Vercel Blob; requer BLOB_READ_WRITE_TOKEN)
 * Flags: --keep-demo (não apaga produtos/clubes de demonstração)   --dry (só mostra o resumo)
 * O banco usado é o das variáveis TURSO_* (ou data/store.db local).
 */
const fs = require('fs');
const path = require('path');
const { client, q, init, refreshSettings } = require('../server/db');
const { slugify, norm } = require('../server/lib/util');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const has = (k) => process.argv.includes('--' + k);
const DIR = arg('dir', 'D:/loja/catalogo-import');
const MODE = has('blob') ? 'blob' : 'local';

const LEAGUES = {
  'Seleções (FIFA)': 'Seleções', 'Premier League (Inglaterra)': 'Premier League', 'La Liga (Espanha)': 'La Liga', 'Serie A (Itália)': 'Serie A', 'Bundesliga (Alemanha)': 'Bundesliga',
  'Ligue 1 (França)': 'Ligue 1', 'Brasileirão (Brasil)': 'Brasileirão', 'Primeira Liga (Portugal)': 'Primeira Liga', 'Outros - Europa': 'Outras Ligas da Europa',
  'Major League Soccer - MLS (EUA / Canadá)': 'MLS', 'Major League Soccer - MLS (EUA ': 'MLS', 'Liga Profissional (Argentina)': 'Liga Profissional (Argentina)', 'MX (México)': 'Liga MX',
  'Outros - Asia e África': 'Ásia e África', 'Outro - América': 'Outras Ligas da América',
};
const CATS = { TORCEDOR: 'torcedor', JOGADOR: 'player', 'RETRÔ': 'retro', KIDS: 'infantil', FEMININO: 'feminina', 'MANGA LONGA': 'manga-longa', 'CORTA VENTO': 'agasalhos' };
const money = (s) => Math.round(parseFloat(String(s).replace(/[^\d,]/g, '').replace(',', '.')) * 100) || 0;
const titleCase = (s) => s;

async function main() {
  await init();
  const prods = fs.readFileSync(path.join(DIR, 'catalogo-produtos.tsv'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
  const T = JSON.parse(fs.readFileSync(path.join(DIR, 'teams.json'), 'utf8'));
  const teamBySlug = Object.fromEntries(T.teams.map((t) => [t[0], t]));
  const teamLeague = { 'colo-colo': 'Outras Ligas da América', 'universidad-catolica': 'Outras Ligas da América', aik: 'Outras Ligas da Europa', bodoglimt: 'Outras Ligas da Europa', rosenborg: 'Outras Ligas da Europa', 'independiente-rivadavia': 'Liga Profissional (Argentina)', 'costa-rica': 'Seleções' }; // ajustes manuais (times sem liga detectada)
  for (const r of prods) { const lg = LEAGUES[r[4]]; const ts = T.pt[r[0]]; if (lg && ts && !teamLeague[ts]) teamLeague[ts] = lg; }
  const imgExists = (rel) => fs.existsSync(path.join(DIR, rel));
  const usable = prods.filter((r) => imgExists(`img/p/${r[0]}/0.webp`));
  console.log(`produtos no arquivo: ${prods.length} • com foto baixada: ${usable.length} • times: ${T.teams.length}`);
  if (has('dry')) return;

  /* --- imagens: destino --- */
  let urlOf;
  if (MODE === 'blob') {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Defina BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob).');
    const { put } = await import('@vercel/blob');
    const map = {};
    const files = [];
    for (const r of usable) { files.push(`img/p/${r[0]}/0.webp`); if (imgExists(`img/p/${r[0]}/1.webp`)) files.push(`img/p/${r[0]}/1.webp`); }
    for (const t of T.teams) if (imgExists(`img/t/${t[0]}.webp`)) files.push(`img/t/${t[0]}.webp`);
    const cacheFile = path.join(DIR, 'blob-urls.json');
    if (fs.existsSync(cacheFile)) Object.assign(map, JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
    let i = 0, n = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (i < files.length) {
        const f = files[i++]; if (map[f]) continue;
        for (let a = 0; a < 3; a++) { try { const b = await put('catalog/' + f.replace(/^img\//, ''), fs.readFileSync(path.join(DIR, f)), { access: 'public', contentType: 'image/webp', addRandomSuffix: false, allowOverwrite: true }); map[f] = b.url; break; } catch (e) { if (a === 2) console.error('falha upload', f, e.message); else await new Promise((r) => setTimeout(r, 1000)); } }
        if (++n % 100 === 0) { console.log(`upload ${n}/${files.length}`); fs.writeFileSync(cacheFile, JSON.stringify(map)); }
      }
    }));
    fs.writeFileSync(cacheFile, JSON.stringify(map));
    urlOf = (rel) => map[rel] || null;
  } else {
    const dest = path.join(__dirname, '..', 'public', 'img', 'catalog');
    fs.cpSync(path.join(DIR, 'img'), dest, { recursive: true });
    urlOf = (rel) => '/img/catalog/' + rel.replace(/^img\//, '');
  }

  /* --- limpeza dos dados de demonstração --- */
  if (!has('keep-demo')) {
    await client.batch([
      'DELETE FROM products', "DELETE FROM entities WHERE type IN ('club','national_team','league') AND slug NOT LIKE 'nba-%' AND slug NOT LIKE 'nfl-%' AND slug NOT LIKE 'f1-%'",
    ], 'write');
    // times de NBA/NFL/F1 criados como 'club' ficam; ligas de futebol removidas acima
  }
  const maxEnt = (await q.get('SELECT COALESCE(MAX(id),0) m FROM entities')).m;
  let nextEnt = maxEnt, nextProd = (await q.get('SELECT COALESCE(MAX(id),0) m FROM products')).m;
  const ent = async (slug) => (await q.get('SELECT id FROM entities WHERE slug=?', slug) || {}).id;
  const futebol = await ent('futebol');
  const catId = {}; for (const s of new Set(Object.values(CATS))) catId[s] = await ent(s);
  const guides = Object.fromEntries((await q.all('SELECT id,name FROM size_guides')).map((g) => [g.name, g.id]));
  const guideFor = { torcedor: guides['Torcedor'], player: guides['Player (corte slim)'], feminina: guides['Feminina'], infantil: guides['Infantil'], retro: guides['Retrô'], 'manga-longa': guides['Torcedor'], agasalhos: guides['Torcedor'] };

  const ops = [];
  const op = (sql, args) => ops.push({ sql, args: (args || []).map((a) => (a === undefined ? null : a)) });
  const used = new Set((await q.all('SELECT slug FROM entities')).map((e) => e.slug));
  const uniq = (base) => { let s = slugify(base) || 'item', n = 2, c = s; while (used.has(c)) c = `${s}-${n++}`; used.add(c); return c; };

  /* ligas */
  const leagueId = {}; let lsort = 1;
  for (const name of [...new Set(Object.values(LEAGUES))]) {
    const id = ++nextEnt; leagueId[name] = id;
    op('INSERT INTO entities(id,type,name,slug,sort,show_in_menu,active) VALUES(?,?,?,?,?,1,1)', [id, 'league', name, uniq(name), lsort++]);
    op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', [futebol, id, lsort]);
  }
  /* times */
  const clubId = {}; let csort = 1;
  for (const t of T.teams) {
    const lg = teamLeague[t[0]]; if (!lg) continue;
    const id = ++nextEnt; clubId[t[0]] = id;
    const isNT = lg === 'Seleções';
    const logo = imgExists(`img/t/${t[0]}.webp`) ? urlOf(`img/t/${t[0]}.webp`) : null;
    op('INSERT INTO entities(id,type,name,slug,logo,sort,show_in_menu,active) VALUES(?,?,?,?,?,?,1,1)', [id, isNT ? 'national_team' : 'club', t[1], uniq(isNT ? 'selecao-' + t[1] : t[1]), logo, csort++]);
    op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', [leagueId[lg], id, csort]);
    op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', [futebol, id, 500]);
  }
  /* tamanhos usados */
  const sizeSet = new Set((await q.all('SELECT name FROM sizes')).map((s) => s.name)); let ssort = 500;
  for (const r of usable) for (const s of (r[5] || '').split(',').filter(Boolean)) if (!sizeSet.has(s)) { sizeSet.add(s); op('INSERT OR IGNORE INTO sizes(name,sort) VALUES(?,?)', [s, ssort++]); }

  /* produtos */
  let nProd = 0, noTeam = 0;
  for (const r of usable) {
    const [pid, name, price, catRaw, , sizes, pers, , ] = r;
    const ts = T.pt[pid]; const team = teamBySlug[ts]; const cid = clubId[ts];
    if (!cid) { noTeam++; continue; }
    const cslug = CATS[catRaw] || (/retro|retrô/i.test(name) ? 'retro' : /kid|infantil/i.test(name) ? 'infantil' : /long|manga/i.test(name) ? 'manga-longa' : /jacket|windbreaker|corta/i.test(name) ? 'agasalhos' : /woman|wmns|femin/i.test(name) ? 'feminina' : /player|jogador/i.test(name) ? 'player' : 'torcedor');
    const cents = money(price); if (!cents) continue;
    const id = ++nextProd; nProd++;
    const slug = uniq(name + '-' + pid.slice(0, 6));
    const desc = `${name}. Camisa de ${team ? team[1] : 'time'} (${({ torcedor: 'modelo torcedor', player: 'modelo jogador', retro: 'retrô', infantil: 'infantil', feminina: 'feminina', 'manga-longa': 'manga longa', agasalhos: 'corta-vento/agasalho' })[cslug]}). Escolha o tamanho e, se quiser, personalize com nome e número.`;
    op(`INSERT INTO products(id,slug,name,description,price_cents,fulfillment,stock,shipping_rule,origin,lead_min,lead_max,weight_g,customizable,custom_price_cents,size_guide_id,tags,sku,shape,active,sold,search_text,import_notes)
        VALUES(?,?,?,?,?,'import',0,'free','China',18,45,400,?,?,?,?,?,'jersey',1,0,?,NULL)`,
    [id, slug, name, desc, cents, pers ? 1 : 0, pers ? money(pers) : null, guideFor[cslug] || null, `camisa camiseta jersey ${cslug}`, 'SI-' + pid.slice(0, 8).toUpperCase(),
      norm([name, team && team[1], cslug, 'futebol camisa'].join(' '))]);
    for (const e of [futebol, cid, catId[cslug], leagueId[teamLeague[ts]]]) if (e) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', [id, e]);
    op('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', [id, urlOf(`img/p/${pid}/0.webp`), 'image', 0]);
    if (imgExists(`img/p/${pid}/1.webp`)) op('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', [id, urlOf(`img/p/${pid}/1.webp`), 'image', 1]);
    for (const s of (sizes || 'P,M,G,GG,2XG,3XG').split(',').filter(Boolean)) op('INSERT OR IGNORE INTO variants(product_id,size,stock) VALUES(?,?,0)', [id, s]);
  }
  console.log(`gravando ${ops.length} operações (${nProd} produtos; sem time: ${noTeam})...`);
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  await refreshSettings();
  const c = await q.get('SELECT (SELECT COUNT(*) FROM products) p,(SELECT COUNT(*) FROM entities WHERE type IN (\'club\',\'national_team\')) c,(SELECT COUNT(*) FROM product_images) i');
  console.log('OK', c);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
