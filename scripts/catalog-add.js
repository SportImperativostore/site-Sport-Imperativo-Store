/* Acrescenta produtos/times ao catálogo já importado (sem apagar nada) a partir de um JSON levantado do catálogo.
 * Uso: node --env-file=.env scripts/catalog-add.js <arquivo.json> [--dir=D:/loja/catalogo-import] [--dry]
 * JSON: { crests: { slug: urlDoEscudo }, rows: [[id, nome, preço, categoria, timeSlug, tamanhos, personalização, imagens...]] }
 */
const fs = require('fs');
const path = require('path');
const { client, q, init, refreshSettings } = require('../server/db');
const { slugify, norm } = require('../server/lib/util');
const { translate } = require('./translate-names');

const file = process.argv[2];
const DIR = (process.argv.find((a) => a.startsWith('--dir=')) || '--dir=D:/loja/catalogo-import').slice(6);
const DRY = process.argv.includes('--dry');
const sharp = require(path.join(DIR, 'node_modules', 'sharp'));
const CDN = 'https://cdn.meukatalogo.com/';
const money = (s) => Math.round(parseFloat(String(s).replace(/[^\d,]/g, '').replace(',', '.')) * 100) || 0;
const CATS = { TORCEDOR: 'torcedor', JOGADOR: 'player', 'RETRÔ': 'retro', KIDS: 'infantil', FEMININO: 'feminina', 'MANGA LONGA': 'manga-longa', 'CORTA VENTO': 'agasalhos' };
// time → { liga (slug), nome, seleção? }
const TEAMS = { flamengo: { league: 'brasileirao', name: 'Flamengo' }, nautico: { league: 'brasileirao', name: 'Náutico' }, brasil: { league: 'selecoes', name: 'Brasil', nt: true } };

async function toWebp(url, size) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (SportImperativoStore import)' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
  return sharp(Buffer.from(await res.arrayBuffer())).rotate().flatten({ background: '#ffffff' }).resize(size, size, { fit: 'contain', background: '#ffffff' }).webp({ quality: 80 }).toBuffer();
}
async function blob(pathname, buf) {
  const { put } = await import('@vercel/blob');
  return (await put(pathname, buf, { access: 'public', contentType: 'image/webp', addRandomSuffix: false, allowOverwrite: true })).url;
}

function loadData(f) {
  const raw = fs.readFileSync(f, 'utf8');
  let seg = raw.slice(raw.indexOf('DATA_START') + 10, raw.indexOf('DATA_END'));
  for (let k = 0; k < 4; k++) { try { return JSON.parse(seg); } catch { seg = JSON.parse('"' + seg + '"'); } }
  throw new Error('JSON ilegível');
}

(async () => {
  await init();
  const data = loadData(file);
  const exist = new Set((await q.all('SELECT sku FROM products')).map((p) => p.sku));
  const rows = data.rows.filter((r) => !exist.has('SI-' + r[0].slice(0, 8).toUpperCase()));
  console.log(`${data.rows.length} lidos • ${rows.length} novos (os demais já existem)`);
  if (DRY) return;

  const ent = async (slug) => (await q.get('SELECT id FROM entities WHERE slug=?', slug) || {}).id;
  const futebol = await ent('futebol');
  const guides = Object.fromEntries((await q.all('SELECT id,name FROM size_guides')).map((g) => [g.name, g.id]));
  const guideFor = { torcedor: guides.Torcedor, player: guides.Jogador, feminina: guides.Feminina, infantil: guides.Infantil, retro: guides.Torcedor, 'manga-longa': guides.Torcedor, agasalhos: guides.Torcedor };
  const catId = {}; for (const s of new Set(Object.values(CATS))) catId[s] = await ent(s);
  let nextEnt = (await q.get('SELECT COALESCE(MAX(id),0) m FROM entities')).m, nextProd = (await q.get('SELECT COALESCE(MAX(id),0) m FROM products')).m;
  const ops = []; const op = (sql, args) => ops.push({ sql, args: args.map((a) => (a === undefined ? null : a)) });

  /* times */
  const clubId = {};
  for (const [slug, t] of Object.entries(TEAMS)) {
    if (!rows.some((r) => r[4] === slug)) continue;
    const leagueId = await ent(t.league);
    let id = await ent(t.nt ? 'selecao-' + slug : slug);
    if (!id) {
      id = ++nextEnt;
      let logo = null; const crest = data.crests[slug];
      if (crest) { try { logo = await blob(`catalog/t/${slug}.webp`, await toWebp(crest, 240)); } catch (e) { console.error('escudo', slug, e.message); } }
      op('INSERT INTO entities(id,type,name,slug,logo,sort,show_in_menu,active) VALUES(?,?,?,?,?,?,1,1)', [id, t.nt ? 'national_team' : 'club', t.name, t.nt ? 'selecao-' + slug : slug, logo, 900]);
      if (leagueId) op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', [leagueId, id, 900]);
      op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', [futebol, id, 900]);
    }
    clubId[slug] = { id, league: leagueId };
  }
  const used = new Set((await q.all('SELECT slug FROM products')).map((p) => p.slug));
  const uniq = (b) => { let s = slugify(b), n = 2, c = s; while (used.has(c)) c = `${s}-${n++}`; used.add(c); return c; };
  const sizeSet = new Set((await q.all('SELECT name FROM sizes')).map((s) => s.name));

  /* produtos + imagens */
  let ok = 0;
  for (const r of rows) {
    const [pid, rawName, price, catRaw, ts, sizes, pers, imgsStr] = r;
    const club = clubId[ts]; if (!club) continue;
    const imgs = (imgsStr || '').split(' ').filter((u) => u && !/\.svg$/i.test(u));
    const first = imgs.find((u) => /_0\.\w+$/.test(u)) || imgs[0]; if (!first) continue;
    const folder = first.split('/')[0];
    const second = imgs.find((u) => /_1\.\w+$/.test(u) && u.split('/')[0] === folder) || imgs.find((u) => u !== first);
    let u0, u1 = null;
    try {
      u0 = await blob(`catalog/p/${pid}/0.webp`, await toWebp(`${CDN}products/${pid}/${first}`, 720));
      if (second) u1 = await blob(`catalog/p/${pid}/1.webp`, await toWebp(`${CDN}products/${pid}/${second}`, 720));
    } catch (e) { console.error('imagem', pid, e.message); continue; }
    const name = translate(rawName);
    const cslug = CATS[catRaw] || 'torcedor'; const cents = money(price); if (!cents) continue;
    const id = ++nextProd; ok++;
    op(`INSERT INTO products(id,slug,name,description,price_cents,fulfillment,stock,shipping_rule,origin,lead_min,lead_max,weight_g,customizable,custom_price_cents,size_guide_id,tags,sku,shape,active,sold,search_text)
        VALUES(?,?,?,?,?,'import',0,'free','China',18,45,400,?,?,?,?,?,'jersey',1,0,?)`,
    [id, uniq(name + '-' + pid.slice(0, 6)), name, `${name}. Escolha o tamanho e, se quiser, personalize com nome e número.`, cents, pers ? 1 : 0, pers ? money(pers) : null, guideFor[cslug] || null, `camisa camiseta jersey ${cslug}`, 'SI-' + pid.slice(0, 8).toUpperCase(), norm([name, rawName, TEAMS[ts].name, cslug, 'futebol camisa'].join(' '))]);
    for (const e of [futebol, club.id, catId[cslug], club.league]) if (e) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', [id, e]);
    op('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', [id, u0, 'image', 0]);
    if (u1) op('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', [id, u1, 'image', 1]);
    for (const s of (sizes || 'P,M,G,GG,2XG,3XG,4XG').split(',').filter(Boolean)) {
      if (!sizeSet.has(s)) { sizeSet.add(s); op('INSERT OR IGNORE INTO sizes(name,sort) VALUES(?,?)', [s, 600]); }
      op('INSERT OR IGNORE INTO variants(product_id,size,stock) VALUES(?,?,0)', [id, s]);
    }
  }
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  await refreshSettings();
  console.log('produtos adicionados:', ok);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
