/* Detecta as cores dominantes da foto principal de cada produto e acrescenta como tags (tags + search_text + categoria de cor), para a busca achar
 * "manchester united azul", "camisa preta" etc. Só ACRESCENTA: nomes e produtos existentes não mudam.
 * Uso: node --env-file=.env scripts/colorize.js [--eval] [--go]   (--eval compara com as cores já escritas no nome) */
const fs = require('fs'), path = require('path');
const sharp = require('D:/loja/catalogo-import/node_modules/sharp'); sharp.cache(false);
const { client, q, init } = require('../server/db');
const { norm } = require('../server/lib/util');
const PUB = path.join(__dirname, '..', 'public');
const NAMES = ['Azul', 'Vermelha', 'Rosa', 'Amarela', 'Laranja', 'Verde', 'Preta', 'Cinza', 'Branca', 'Marrom', 'Roxa'];
const WORD = { Azul: 'azul', Vermelha: 'vermelha', Rosa: 'rosa', Amarela: 'amarela', Laranja: 'laranja', Verde: 'verde', Preta: 'preta', Cinza: 'cinza', Branca: 'branca', Marrom: 'marrom', Roxa: 'roxa' };
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
  return s < 0.35 && v > 0.8 ? 'Rosa' : (h < 330 ? 'Rosa' : 'Vermelha');
}
async function colorsOf(buf) {
  const S = 48;
  const { data } = await sharp(buf).rotate().resize(S, S, { fit: 'cover', position: 'top' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => { const i = (y * S + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  // cor do fundo = média das bordas
  let br = 0, bg = 0, bb = 0, n = 0;
  for (let i = 0; i < S; i++) for (const [x, y] of [[i, 0], [i, 1], [0, i], [S - 1, i], [1, i], [S - 2, i]]) { const p = px(x, y); br += p[0]; bg += p[1]; bb += p[2]; n++; }
  br /= n; bg /= n; bb /= n;
  const cnt = {}; let tot = 0;
  for (let y = Math.floor(S * 0.18); y < Math.floor(S * 0.78); y++) for (let x = Math.floor(S * 0.18); x < Math.floor(S * 0.82); x++) {
    const [r, g, b] = px(x, y);
    if (Math.abs(r - br) + Math.abs(g - bg) + Math.abs(b - bb) < 60) continue;      // fundo
    const k = bucket(r, g, b); cnt[k] = (cnt[k] || 0) + 1; tot++;
  }
  if (tot < 60) return [];
  const rank = Object.entries(cnt).sort((a, b) => b[1] - a[1]);
  const out = [rank[0][0]];
  for (const [k, c] of rank.slice(1, 3)) if (c / tot >= 0.2) out.push(k);
  return out;
}
(async () => {
  await init();
  const EVAL = process.argv.includes('--eval'), GO = process.argv.includes('--go');
  const ents = Object.fromEntries((await q.all("SELECT id,name FROM entities WHERE type='color'")).map((e) => [e.name, e.id]));
  const rows = await q.all("SELECT p.id,p.name,p.tags,p.search_text,(SELECT url FROM product_images i WHERE i.product_id=p.id AND kind='image' ORDER BY sort,id LIMIT 1) url FROM products p WHERE p.active=1");
  const pool = EVAL ? rows.filter((r) => NAMES.some((c) => norm(r.name).includes(norm(c)))).sort(() => Math.random() - 0.5).slice(0, 300) : rows;
  const res = []; let k = 0, fail = 0;
  const w = async () => { while (k < pool.length) { const r = pool[k++]; try { let buf; if (/^https?:/.test(r.url)) { const x = await fetch(r.url, { signal: AbortSignal.timeout(20000) }); if (!x.ok) throw 0; buf = Buffer.from(await x.arrayBuffer()); } else buf = fs.readFileSync(path.join(PUB, r.url)); res.push({ ...r, cores: await colorsOf(buf) }); } catch { fail++; } if (k % 1000 === 0) console.log(k, '/', pool.length); } };
  await Promise.all(Array.from({ length: 8 }, w));
  console.log('processados:', res.length, 'falhas:', fail);
  if (EVAL) {
    let ok = 0, tot = 0, any = 0;
    for (const r of res) { const named = NAMES.filter((c) => norm(r.name).includes(norm(c))); if (!named.length) continue; tot++; if (named.some((c) => r.cores.includes(c))) ok++; if (r.cores.length) any++; }
    if (process.argv.includes('--miss')) console.log(res.filter((r) => { const n = NAMES.filter((c) => norm(r.name).includes(norm(c))); return n.length && !n.some((c) => r.cores.includes(c)); }).slice(0, 25).map((r) => r.name.slice(0, 50) + ' => ' + r.cores.join('/')).join('\n'));
    console.log(`acerto (cor do nome entre as detectadas): ${ok}/${tot} = ${Math.round((ok / tot) * 100)}%`);
    return process.exit(0);
  }
  fs.writeFileSync('D:/loja/yupoo/colors-detected.json', JSON.stringify(res.map((r) => ({ id: r.id, cores: r.cores }))));
  const dist = {}; for (const r of res) for (const c of r.cores) dist[c] = (dist[c] || 0) + 1; console.log('distribuição:', JSON.stringify(dist), '| sem cor:', res.filter((r) => !r.cores.length).length);
  if (!GO) return process.exit(0);
  const ops = []; let touched = 0;
  for (const r of res) {
    if (!r.cores.length) continue;
    const have = norm(`${r.name} ${r.tags || ''} ${r.search_text || ''}`);
    // o nome já diz a cor (mais confiável que a foto): não acrescenta cores detectadas
    if (/\b(azul|vermelh[ao]|rosa|amarel[ao]|laranja|verde|pret[ao]|cinza|branc[ao]|marrom|rox[ao]|vinho|marinho|dourad[ao]|prata|turquesa|ciano|grafite|creme|bege|lima|limao)\b/.test(norm(r.name))) continue;
    const add = r.cores.filter((c) => !have.split(/[^a-z0-9]+/).includes(norm(WORD[c])));
    if (add.length) {
      const words = add.map((c) => WORD[c]).join(' ');
      ops.push({ sql: "UPDATE products SET tags=TRIM(COALESCE(tags,'') || ' ' || ?), search_text=TRIM(COALESCE(search_text,'') || ' ' || ?) WHERE id=?", args: [words, words, r.id] }); touched++;
    }
    for (const c of r.cores) if (ents[c]) ops.push({ sql: 'INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', args: [r.id, ents[c]] });
  }
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  console.log('tags de cor acrescentadas em', touched, 'produtos | operações', ops.length);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
