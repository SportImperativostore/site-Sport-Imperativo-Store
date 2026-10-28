/* Sincroniza a aba "Pronta Entrega" com as pastas públicas do Google Drive dos fornecedores.
 * Uso:  node --env-file=.env scripts/pe-sync.js [--dry] [--limit=N]
 *   --dry    só lê e mostra o que faria (não altera o banco)
 * Regras: cada ARQUIVO (foto) do Drive é uma camisa; os tamanhos disponíveis estão no NOME do arquivo (ex.: "M/G/GG", "2 GG").
 * Preço fixo por categoria (settings pe_price_*); fotos do próprio Drive; duplicados entre catálogos são unidos pela imagem (dHash);
 * itens sem time identificável vão para revisão (não entram na loja). Só mexe em produtos criados por este script (SKU "PE-…"). */
const fs = require('fs'), path = require('path');
const sharp = require('D:/loja/catalogo-import/node_modules/sharp'); sharp.cache(false);
const { q, init, setting } = require('../server/db');
const { norm } = require('../server/lib/util');

const DRY = process.argv.includes('--dry');
const LIMIT = parseInt((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1], 10) || 0;
const OUT_DIR = process.env.YUPOO_DIR || 'D:\\loja\\yupoo';
const SOURCES = [
  { key: 'pe1', label: 'Pronta Entrega 1', id: '1kcnlriC-6rc-WSmT9FOgj3tFoZMimlwI', roots: null },
  { key: 'pe2', label: 'Pronta Entrega 2', id: '1NTYwkPACPJdmw6dpk2VqyAbuACcsQCqH', roots: null },   // pasta "TIMES" compartilhada diretamente (fotos sem time no nome: ver pe-overrides.json)
  { key: 'pe3', label: 'Pronta Entrega 3', id: '1yr7dN2zUcZ7-T-y0-PuetTxffUOrazZC', roots: /^(24\/25 BRASILEIROS|24\/25 EUROPEU|25\/27|PROMOÇÃO|RETRÔ)$/i },
];
const EXCLUDE = /(KIT INFANTIL|INFANTIL|FEMININ|FEEDBACK|BASQUETE|KIT DE TREINO|TENIS|TÊNIS|BERMUDA|BON[ÉE]|CHUTEIRA|COPO|OCULOS|ÓCULOS|CUECA|CAL[ÇC]A|MOLETOM|OVERSIZED|POLO|REGATA|CAMISAS DIVERSAS)/i;
const GENERIC = /^(TIMES.*|PLAYER|MANGA LONGA|PROMO.*)$/i;
let OVERRIDES = {}; try { OVERRIDES = JSON.parse(fs.readFileSync(path.join(__dirname, 'pe-overrides.json'), 'utf8')); } catch { /* sem correções manuais */ }
const H = { 'User-Agent': 'Mozilla/5.0' };
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, n = 4) { for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { if (i === n - 1) throw e; await sleep(1200 * (i + 1)); } } }

/* ---------- Google Drive (visão incorporada da pasta pública, sem login) ---------- */
async function listFolder(id) {
  return withRetry(async () => {
    const r = await fetch('https://drive.google.com/embeddedfolderview?id=' + id, { headers: H, signal: AbortSignal.timeout(25000) });
    if (r.status === 404 || r.status === 403) return null;
    if (!r.ok) throw new Error('Drive ' + r.status);
    const t = await r.text();
    return [...t.matchAll(/<div class="flip-entry"[^>]*id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?class="flip-entry-title">([^<]*)</g)].map((m) => ({ id: m[1], folder: /\/folders\//.test(m[2]), name: dec(m[3]).trim() }));
  });
}
async function crawl(src) {
  const root = await listFolder(src.id);
  if (!root) return { ok: false, files: [] };
  const files = []; const queue = [];
  for (const it of root) {
    if (it.folder) { if (EXCLUDE.test(it.name)) continue; if (src.roots && !src.roots.test(it.name)) continue; queue.push({ id: it.id, path: [it.name] }); }
    else if (!src.roots) files.push({ id: it.id, name: it.name, path: [] });
  }
  let failed = false;
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      let items; try { items = await listFolder(f.id); } catch { failed = true; continue; }
      if (!items) { failed = true; continue; }
      for (const it of items) {
        if (it.folder) { if (!EXCLUDE.test(it.name)) queue.push({ id: it.id, path: [...f.path, it.name] }); }
        else files.push({ id: it.id, name: it.name, path: f.path });
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { ok: !failed, files };
}

/* ---------- tamanhos (e quantidades) no nome do arquivo ----------
 * Dois formatos nos catálogos: só tamanhos ("M/G/GG", "2GG" = 2XG) ou quantidade + tamanho com espaço ("4 GG - 1 G - 4 M - 3 P" = 4 unidades do GG...). */
const SZ = { PP: 'PP', P: 'P', M: 'M', G: 'G', GG: 'GG', XG: 'XGG', XGG: 'XGG', XXG: 'XGG', '2GG': '2XG', '3GG': '3XG', '4GG': '4XG', '5GG': '5XG', '2XG': '2XG', '3XG': '3XG', '4XG': '4XG', '5XG': '5XG', '2XL': '2XG', '3XL': '3XG', '4XL': '4XG', '5XL': '5XG' };
function parseStock(name) {
  const up = String(name).toUpperCase().replace(/\s+/g, ' ');
  const stock = {};
  const reQ = /(?:^|[^0-9A-Z])(\d{1,3})\s+(2XL|3XL|4XL|5XL|XXG|XGG|XG|PP|GG|G|M|P)(?![A-Z0-9])/g;
  let m, hasQ = false;
  while ((m = reQ.exec(up))) { hasQ = true; const k = SZ[m[2]]; if (k) stock[k] = (stock[k] || 0) + parseInt(m[1], 10); }
  if (!hasQ) {
    const s2 = up.replace(/[.,;/\\_|+&()–—-]/g, ' ').replace(/\b([2-5])\s*(GG|XG|XL)\b/g, '$1$2').replace(/\bG\s+G\b/g, 'GG');
    for (const t of s2.split(' ').filter(Boolean)) { const k = SZ[t]; if (k && !(k in stock)) stock[k] = 0; }   // 0 = quantidade não informada
  }
  return { sizes: Object.keys(stock), stock, qtyKnown: hasQ, patch: /PATCH/.test(up) };
}
const ORDER = ['PP', 'P', 'M', 'G', 'GG', 'XGG', '2XG', '3XG', '4XG', '5XG'];

/* ---------- cor dominante (só para nomear o modelo) ---------- */
function bucket(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, v = mx / 255, s = mx ? d / mx : 0;
  if (v < 0.2) return 'Preta';
  if (s < 0.16) return v > 0.8 ? 'Branca' : v > 0.38 ? 'Cinza' : 'Preta';
  let h = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
  if (h < 12 || h >= 345) return v < 0.4 && s < 0.7 ? 'Marrom' : 'Vermelha';
  if (h < 40) return v < 0.55 ? 'Marrom' : 'Laranja';
  if (h < 70) return v < 0.45 ? 'Marrom' : 'Amarela';
  if (h < 165) return 'Verde';
  if (h < 255) return 'Azul';
  if (h < 290) return 'Roxa';
  return h < 330 ? 'Rosa' : 'Vermelha';
}
async function analyze(buf) {
  const S = 48;
  const { data } = await sharp(buf).rotate().resize(S, S, { fit: 'cover', position: 'top' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * S + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  let br = 0, bg = 0, bb = 0, n = 0;
  for (let i = 0; i < S; i++) for (const [x, y] of [[i, 0], [i, 1], [0, i], [S - 1, i], [1, i], [S - 2, i]]) { const p = px(x, y); br += p[0]; bg += p[1]; bb += p[2]; n++; }
  br /= n; bg /= n; bb /= n;
  const cnt = {}; let tot = 0;
  for (let y = Math.floor(S * 0.18); y < Math.floor(S * 0.78); y++) for (let x = Math.floor(S * 0.18); x < Math.floor(S * 0.82); x++) {
    const [r, g, b] = px(x, y); if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) < 60) continue;
    const k = bucket(r, g, b); cnt[k] = (cnt[k] || 0) + 1; tot++;
  }
  const rank = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  const color = tot >= 60 && rank.length ? rank[0][0] : '';
  const g8 = (await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer());
  let hash = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash += g8[y * 9 + x] > g8[y * 9 + x + 1] ? '1' : '0';
  return { color, hash };
}
const ham = (a, b) => { let d = 0; for (let i = 0; i < 64; i++) if (a[i] !== b[i]) d++; return d; };
const thumb = (id, w) => `https://drive.google.com/thumbnail?id=${id}&sz=w${w}`;

/* ---------- time / categoria ---------- */
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s\-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\b(Fc|Sc|Psg|Psv|Rb|Usa|Ac|As|Ca)\b/g, (x) => x.toUpperCase());
function classify(file) {
  const parts = file.path, root = parts[0] || '';
  const team = [...parts].slice(1).reverse().find((p) => !GENERIC.test(p)) || (parts.length === 1 && !GENERIC.test(root) && !/^(24\/25|25\/27|RETR)/i.test(root) ? root : '');
  const joined = parts.join(' / ').toUpperCase();
  const retro = /RETR[ÔO]/.test(joined), player = /PLAYER/.test(joined), ml = /MANGA LONGA/.test(joined);
  const season = /24\/25/.test(root) ? '24/25' : /25\/27/.test(root) ? '25/27' : '';
  const ov = OVERRIDES[file.id] || {};
  return { exclude: ov.exclude || '', team: ov.team || (team ? titleCase(team) : ''), retro, player, ml, season, base: retro ? 'retro' : player ? 'jogador' : 'torcedor' };
}
const PRICE_KEY = { torcedor: 'pe_price_torcedor', jogador: 'pe_price_jogador', retro: 'pe_price_retro', torcedor_ml: 'pe_price_torcedor_ml', jogador_ml: 'pe_price_jogador_ml', retro_ml: 'pe_price_retro_ml' };
const PRICE_DEF = { torcedor: 22000, jogador: 26000, retro: 26000, torcedor_ml: 24000, jogador_ml: 29000, retro_ml: 29000 };
const priceOf = (cat) => parseInt(setting(PRICE_KEY[cat], String(PRICE_DEF[cat])), 10) || PRICE_DEF[cat];
const CAT_LABEL = { torcedor: 'Torcedor', jogador: 'Jogador', retro: 'Retrô' };

async function ensureEntity(type, name, slug, extra = {}) {
  let e = await q.get('SELECT id FROM entities WHERE slug=?', slug);
  if (!e) { const r = await q.run('INSERT INTO entities(type,name,slug,sort,active,show_in_menu) VALUES(?,?,?,?,1,?)', type, name, slug, extra.sort ?? 100, extra.menu ?? 1); e = { id: Number(r.lastInsertRowid) }; }
  return e.id;
}

(async () => {
  await init();
  const t0 = Date.now(); const report = { when: new Date().toISOString(), sources: {}, created: 0, updated: 0, removed: 0, review: [], duplicates: 0, products: 0 };
  // 1) varre as pastas
  const found = [];
  for (const s of SOURCES) {
    const r = await crawl(s);
    report.sources[s.key] = { label: s.label, accessible: r.ok || r.files.length > 0, partial: !r.ok && r.files.length > 0, files: r.files.length };
    if (!r.files.length && !r.ok) { console.log(`✗ ${s.label}: pasta inacessível (não é pública ou o link está incorreto)`); continue; }
    for (const f of r.files) found.push({ ...f, source: s.key });
    console.log(`✓ ${s.label}: ${r.files.length} arquivos${r.ok ? '' : ' (leitura parcial)'}`);
  }
  let items = found.map((f) => ({ ...f, ...classify(f), ...parseStock(f.name) }));
  if (LIMIT) items = items.slice(0, LIMIT);

  // 2) fotos: dHash + cor (só para arquivos novos; o resultado fica guardado)
  const known = new Map((await q.all('SELECT file_id,hash,color FROM pe_sync')).map((r) => [r.file_id, r]));
  const need = items.filter((i) => !known.get(i.id) || !known.get(i.id).hash);
  let k = 0, fail = 0;
  const w = async () => {
    while (k < need.length) {
      const it = need[k++];
      try { const buf = await withRetry(async () => { const r = await fetch(thumb(it.id, 400), { headers: H, signal: AbortSignal.timeout(25000) }); if (!r.ok) throw new Error('thumb ' + r.status); return Buffer.from(await r.arrayBuffer()); }); Object.assign(it, await analyze(buf)); }
      catch { fail++; }
    }
  };
  await Promise.all(Array.from({ length: 6 }, w));
  for (const it of items) { const kn = known.get(it.id); if (!it.hash && kn) { it.hash = kn.hash; it.color = kn.color; } }
  console.log(`fotos analisadas: ${need.length - fail}/${need.length}`);

  // 3) elegibilidade + duplicados (mesma foto em catálogos diferentes)
  const prio = { pe3: 0, pe2: 1, pe1: 2 };
  items.sort((a, b) => prio[a.source] - prio[b.source]);
  const canon = [];
  for (const it of items) {
    it.note = '';
    if (it.exclude) { it.state = 'review'; it.note = it.exclude; continue; }
    if (!it.sizes.length) { it.state = 'review'; it.note = 'sem tamanho identificável no nome do arquivo'; continue; }
    if (!it.team) { it.state = 'review'; it.note = 'time não identificado (arquivo fora de pasta de time)'; continue; }
    if (!it.hash) { it.state = 'review'; it.note = 'foto não pôde ser baixada'; continue; }
    const d = canon.find((c) => c.team === it.team && c.base === it.base && c.ml === it.ml && ham(c.hash, it.hash) <= 5);
    if (d) { it.state = 'dup'; it.dupOf = d; for (const z of it.sizes) d.stock[z] = Math.max(d.stock[z] || 0, it.stock[z] || 0); d.sizes = Object.keys(d.stock); report.duplicates++; continue; }
    it.state = 'active'; canon.push(it);
  }
  for (const it of items) if (it.state === 'review') report.review.push({ source: it.source, path: it.path.join('/'), file: it.name, motivo: it.note });
  // 3b) fontes externas (MIC e iFutz): tamanhos disponíveis; a foto é a do nosso catálogo Yupoo (modelo correspondente)
  const EXT = require('./pe-external'); const idx = await EXT.buildIndex(q);
  const extFound = [];
  for (const [key, label, fn] of [['mic', 'MIC Camisas de Time', EXT.fetchMic], ['ifutz', 'iFutz', EXT.fetchIfutz]]) {
    try { const l = await fn(); report.sources[key] = { label, accessible: true, files: l.length }; extFound.push(...l); console.log('✓ ' + label + ': ' + l.length + ' produtos'); }
    catch (e) { report.sources[key] = { label, accessible: false, error: String(e.message) }; console.log('✗ ' + label + ': ' + e.message); }
  }
  extFound.sort((a, b) => b.sizes.length - a.sizes.length);       // se dois fornecedores têm o mesmo modelo, fica o que tem mais tamanhos
  const byCat = new Map(); let soldout = 0;
  for (const x of extFound) {
    const p = EXT.parseTitle(x.title);
    const it = { id: x.key, source: x.source, name: x.title, path: [], hash: null, color: null, note: '', ...p, sizes: x.sizes, stock: Object.fromEntries(x.sizes.map((z) => [z, 0])) };
    items.push(it);
    if (!x.sizes.length) { it.state = 'soldout'; soldout++; continue; }
    const m = EXT.match(idx, p);
    if (!m.prod) { it.state = 'review'; it.note = m.note; report.review.push({ source: x.source, path: '', file: x.title, motivo: m.note }); continue; }
    it.catalog = m.prod; it.team = m.prod.name.replace(/^Camisa /, '').replace(/ \d{4}.*$/, '');
    const dupe = byCat.get(m.prod.id);
    if (dupe) { it.state = 'dup'; it.dupOf = dupe; report.duplicates++; continue; }
    it.state = 'active'; canon.push(it); byCat.set(m.prod.id, it);
  }
  console.log('externos esgotados (ignorados): ' + soldout);
  // retrô: no máximo até 2XG (regra da loja)
  for (const it of canon) { if (it.retro) for (const z of ['3XG', '4XG', '5XG']) delete it.stock[z]; it.sizes = Object.keys(it.stock).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)); }
  console.log(`candidatos: ${canon.length} • duplicados unidos: ${report.duplicates} • para revisão: ${report.review.length}`);
  if (DRY) {
    const by = {}; for (const c of canon) { const cat = c.base + (c.ml ? '_ml' : ''); by[cat] = (by[cat] || 0) + 1; }
    console.log('por categoria:', by);
    fs.writeFileSync(path.join(OUT_DIR, 'pe-sync-dry.json'), JSON.stringify({ report, amostra: canon.slice(0, 15).map((c) => ({ team: c.team, season: c.season, cat: c.base + (c.ml ? '_ml' : ''), cor: c.color, tamanhos: c.sizes, arquivo: c.name, caminho: c.path.join('/') })) }, null, 1));
    return process.exit(0);
  }

  // 4) grava: entidades, produtos, variantes
  const peId = await ensureEntity('sport', 'Pronta Entrega', 'pronta-entrega', { sort: 7 });
  const catIds = {};
  for (const [k2, label] of [['torcedor', 'Camisas Torcedor'], ['jogador', 'Camisas Jogador'], ['retro', 'Camisas Retrô'], ['ml', 'Manga Longa']]) {
    catIds[k2] = await ensureEntity('group', label, 'pe-' + k2, { menu: 1, sort: 10 });
    await q.run('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', peId, catIds[k2], 10);
  }
  const defStock = parseInt(setting('pe_default_stock', '1'), 10) || 1;
  const ON = setting('pe_enabled', '0') === '1' ? 1 : 0;          // a aba só vai ao ar quando pe_enabled=1 (depois de configurar o SuperFrete)
  const old = new Map((await q.all('SELECT file_id,product_id,sizes FROM pe_sync WHERE product_id IS NOT NULL')).map((r) => { let sz = {}; try { const j = JSON.parse(r.sizes || '{}'); sz = Array.isArray(j) ? Object.fromEntries(j.map((x) => [x, 0])) : j; } catch { /* vazio */ } return [r.file_id, { ...r, sizes: JSON.stringify(sz) }]; }));
  const nameCount = new Map();
  for (const it of canon) {
    const cat = it.base + (it.ml ? '_ml' : ''), price = priceOf(cat);
    let nm = it.catalog ? it.catalog.name + ' (Pronta Entrega)' : ['Camisa', it.team, it.season, it.color, it.retro ? 'Retrô' : it.player ? 'Jogador' : '', it.ml ? 'Manga Longa' : '', it.patch ? 'Com Patch' : ''].filter(Boolean).join(' ');
    const c = (nameCount.get(nm) || 0) + 1; nameCount.set(nm, c); if (c > 1) nm += ' ' + (['', '', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][c] || '#' + c);
    const prev = old.get(it.id);
    let pid = prev && prev.product_id;
    const sizesNow = it.sizes, before = prev && prev.sizes ? JSON.parse(prev.sizes) : {};
    const want = (sz) => (it.stock[sz] > 0 ? it.stock[sz] : defStock);      // quantidade do nome do arquivo; sem quantidade = estoque padrão
    if (!pid) {
      const slug = 'pe-' + (it.catalog ? require('crypto').createHash('md5').update(it.id).digest('hex').slice(0, 12) : it.id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)) + '-' + Math.random().toString(36).slice(2, 5);
      const desc = `${nm}. Pronta entrega: enviada do Brasil. Modelo ${CAT_LABEL[it.base].toLowerCase()}${it.ml ? ', manga longa' : ''}.`;
      const tags = norm(`pronta entrega camisa ${it.team} ${it.season} ${CAT_LABEL[it.base]} ${it.ml ? 'manga longa' : ''}`);
      const r = await q.run(`INSERT INTO products(slug,name,description,price_cents,fulfillment,stock,shipping_rule,origin,weight_g,customizable,tags,sku,shape,active,search_text)
        VALUES(?,?,?,?,'stock',?,'cep','Brasil',300,0,?,?, 'jersey',?,?)`, slug, nm, desc, price, sizesNow.reduce((x, z) => x + want(z), 0), tags, 'PE-' + (it.catalog ? require('crypto').createHash('md5').update(it.id).digest('hex').slice(0, 10) : it.id.slice(0, 10)), ON, norm(`${nm} ${tags} pronta entrega`));
      pid = Number(r.lastInsertRowid); report.created++;
      if (it.catalog) { let n = 0; for (const u of it.catalog.imgs) await q.run("INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?, 'image',?)", pid, u, n++); }
      else await q.run("INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?, 'image',0)", pid, thumb(it.id, 1000));
      await q.run('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', pid, peId);
      await q.run('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', pid, catIds[it.base]);
      if (it.ml) await q.run('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', pid, catIds.ml);
      const teamId = await ensureEntity('group', it.team, 'pe-time-' + norm(it.team).replace(/[^a-z0-9]+/g, '-'), { menu: 0 });
      await q.run('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', pid, teamId);
    } else {
      // preço fixo da aba é sempre reaplicado; o nome só é regravado se o produto ainda é o gerado por este script
      await q.run('UPDATE products SET price_cents=?, sale_price_cents=NULL, active=? WHERE id=?', price, ON, pid); report.updated++;
    }
    // variantes: o Drive manda quando o nome do arquivo muda; se não mudou, mantém o estoque local (as vendas já baixaram)
    const vs = await q.all('SELECT size,stock FROM variants WHERE product_id=?', pid);
    for (const sz of sizesNow) {
      const cur = vs.find((v) => v.size === sz);
      if (!cur) await q.run('INSERT INTO variants(product_id,size,stock) VALUES(?,?,?)', pid, sz, want(sz));
      else if (!(sz in before) || (before[sz] || 0) !== (it.stock[sz] || 0)) await q.run('UPDATE variants SET stock=? WHERE product_id=? AND size=?', want(sz), pid, sz);
    }
    for (const v of vs) if (!sizesNow.includes(v.size)) await q.run('UPDATE variants SET stock=0 WHERE product_id=? AND size=?', pid, v.size);
    await q.run('UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM variants WHERE product_id=?) WHERE id=?', pid, pid);
    it.productId = pid;
  }
  // 5) registro por arquivo + remoção do que saiu do Drive (só nas fontes lidas por completo)
  const seen = new Set();
  for (const it of items) {
    seen.add(it.id);
    if (it.state === 'soldout') { const pv = old.get(it.id); if (pv && pv.product_id) { await q.run('UPDATE products SET active=0, stock=0 WHERE id=?', pv.product_id); await q.run('UPDATE variants SET stock=0 WHERE product_id=?', pv.product_id); report.removed++; } }
    const pid = it.state === 'active' ? it.productId : it.state === 'dup' ? (it.dupOf.productId || null) : null;
    await q.run(`INSERT INTO pe_sync(file_id,source,path,name,sizes,category,hash,color,product_id,state,note,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(file_id) DO UPDATE SET source=excluded.source,path=excluded.path,name=excluded.name,sizes=excluded.sizes,category=excluded.category,hash=COALESCE(excluded.hash,pe_sync.hash),color=COALESCE(excluded.color,pe_sync.color),product_id=excluded.product_id,state=excluded.state,note=excluded.note,last_seen=excluded.last_seen`,
      it.id, it.source, it.path.join('/'), it.name, JSON.stringify(it.stock), it.base + (it.ml ? '_ml' : ''), it.hash || null, it.color || null, pid, it.state, it.note || null);
  }
  const okSources = Object.entries(report.sources).filter(([, v]) => v.accessible && !v.partial).map(([k]) => k);
  const gone = (await q.all("SELECT file_id,product_id,source FROM pe_sync WHERE state IN ('active','dup','review')")).filter((r) => !seen.has(r.file_id) && okSources.includes(r.source));
  if (!LIMIT) for (const g of gone) {
    await q.run("UPDATE pe_sync SET state='gone' WHERE file_id=?", g.file_id);
    if (g.product_id) { await q.run('UPDATE products SET active=0, stock=0 WHERE id=?', g.product_id); await q.run('UPDATE variants SET stock=0 WHERE product_id=?', g.product_id); report.removed++; }
  }
  // 6) a aba só aparece no menu quando há produto
  const n = (await q.get("SELECT COUNT(*) n FROM products WHERE sku LIKE 'PE-%' AND active=1")).n; report.products = n; report.enabled = !!ON;
  await q.run('UPDATE entities SET active=? WHERE id=?', ON && n > 0 ? 1 : 0, peId);
  report.seconds = Math.round((Date.now() - t0) / 1000);
  fs.writeFileSync(path.join(OUT_DIR, 'pe-sync-report.json'), JSON.stringify(report, null, 1));
  console.log(`pronto: ${report.created} criados, ${report.updated} atualizados, ${report.removed} removidos, ${report.products} ativos, ${report.review.length} p/ revisão (${report.seconds}s)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
