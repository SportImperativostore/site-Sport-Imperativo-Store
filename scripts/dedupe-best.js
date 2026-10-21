/* Remove produtos repetidos mantendo o de MELHORES FOTOS (nitidez, tamanho, nº de fotos, sem marca d'água).
 *  1) cópias "(2)", "(3)"… do mesmo produto (camisas e chuteiras);  2) retrô anterior a 2021 em "Player Version" + versão normal (uma só versão);
 *  3) retrô anterior a 2021 só em "Player Version": tira "Player Version" do nome.
 * Só mexe em produto SEM pedidos. Uso: node --env-file=.env scripts/dedupe-best.js [--go] */
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('D:/loja/catalogo-import/node_modules/sharp'); sharp.cache(false);
const { strip, dot } = require('D:/loja/audit/wm.js');
const T = Float32Array.from(JSON.parse(fs.readFileSync('D:/loja/audit/wm-template.json', 'utf8')));
const { client, q, init } = require('../server/db');
const cat = require('../server/lib/catalog');
const PUB = path.join(__dirname, '..', 'public'), TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-'));
const GO = process.argv.includes('--go');
const pc = (x) => { let n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; };
async function dh(buf) { const { data } = await sharp(buf).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true }); let h = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) h += data[y * 9 + x] > data[y * 9 + x + 1] ? '1' : '0'; return BigInt('0b' + h); }
const plain = (n) => n.replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim();
async function load(url) { if (/^https?:/.test(url)) { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw 0; return Buffer.from(await r.arrayBuffer()); } return fs.readFileSync(path.join(PUB, url)); }
async function sharp1(buf) { const { data } = await sharp(buf).rotate().greyscale().resize(256, 256, { fit: 'inside' }).convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], scale: 1, offset: 128 }).raw().toBuffer({ resolveWithObject: true }); let m = 0; for (const v of data) m += v; m /= data.length; let s = 0; for (const v of data) s += (v - m) * (v - m); return s / data.length; }
async function score(id) {
  const imgs = await q.all("SELECT url FROM product_images WHERE product_id=? AND kind='image' ORDER BY sort,id LIMIT 4", id);
  let sc = 0, wm = 0, n = 0, main = 0, hash = null;
  for (const [i, im] of imgs.entries()) {
    try {
      const buf = await load(im.url); n++;
      const f = path.join(TMP, id + '_' + i + '.webp'); fs.writeFileSync(f, buf);
      let w = 0; try { w = dot(await strip(f), T) > 0.08 ? 1 : 0; } catch { /* sem checagem */ } fs.rmSync(f, { force: true });
      const sh = Math.min(1, (await sharp1(buf)) / 400), q1 = Math.min(1, buf.length / 45000);
      if (i === 0) { main = sh * 2 + q1; hash = await dh(buf); }
      wm += w; sc += sh + q1;
    } catch { /* foto indisponível */ }
  }
  return { id, score: sc + main * 1.5 + n * 0.6 - wm * 4, n, wm, hash };
}
(async () => {
  await init();
  const groups = JSON.parse(fs.readFileSync('D:/loja/yupoo/dups-visual.json', 'utf8'));
  const names = new Map((await q.all('SELECT id,name FROM products WHERE active=1')).map((p) => [p.id, p.name]));
  const orders = new Map((await q.all('SELECT product_id,COUNT(*) n FROM order_items GROUP BY product_id')).map((r) => [r.product_id, r.n]));
  const plan = [];                                   // { keep, drop:[ids], rename }
  const pvAll = (await q.all("SELECT id,name FROM products WHERE active=1 AND name LIKE '%Player Version%' AND name LIKE '%Retr%'")).filter((p) => { const y = +((p.name.match(/(\d{4})/) || [])[1] || 0); return y && y < 2021; });
  const byName = new Map([...names].map(([id, n]) => [n, id]));
  const done = new Set();
  // 1) cópias (n)
  for (const g of groups) {
    const ids = g.map((x) => x.id).filter((id) => names.has(id));
    if (ids.length < 2 || !ids.every((id) => plain(names.get(id)) === plain(names.get(ids[0])))) continue;
    if (!/^(Camisa|Kit Infantil)/.test(names.get(ids[0]))) continue;   // só camisas: chuteiras, jaquetas, polos e conjuntos com '(n)' são peças diferentes          // chuteiras com "(n)" são modelos diferentes da mesma cor, não cópias
    plan.push({ kind: 'copia', ids }); ids.forEach((i) => done.add(i));
  }
  // 2) PV x normal (retrô < 2021)
  for (const pv of pvAll) {
    if (done.has(pv.id)) continue;
    const base = byName.get(pv.name.replace(' Player Version', ''));
    if (base && !done.has(base)) plan.push({ kind: 'pv', ids: [pv.id, base], baseName: pv.name.replace(' Player Version', '') });
    else if (!base) plan.push({ kind: 'renomear', ids: [pv.id], baseName: pv.name.replace(' Player Version', '') });
  }
  console.log('copias:', plan.filter((p) => p.kind === 'copia').length, '| pv x normal:', plan.filter((p) => p.kind === 'pv').length, '| renomear:', plan.filter((p) => p.kind === 'renomear').length);
  const del = [], ren = [], detail = [];
  let k = 0;
  const work = plan.map((p) => async () => {
    if (p.kind === 'renomear') { ren.push({ id: p.ids[0], name: p.baseName, jog: true }); return; }
    const sc = []; for (const id of p.ids) sc.push(await score(id));
    sc.sort((a, b) => b.score - a.score);
    const win = sc[0];
    // cópia só é removida se a foto principal for praticamente a mesma (senão são produtos diferentes)
    const losers = sc.slice(1).filter((s) => !orders.get(s.id) && (p.kind !== 'copia' || (win.hash != null && s.hash != null && pc(win.hash ^ s.hash) <= 5)));
    if (orders.get(win.id) === undefined || true) for (const l of losers) del.push(l.id);
    detail.push({ win: win.id, lose: losers.map((l) => l.id), kind: p.kind });
    const finalName = p.kind === 'pv' ? p.baseName : plain(names.get(win.id));
    if (names.get(win.id) !== finalName) ren.push({ id: win.id, name: finalName, jog: p.kind === 'pv' });
    if (++k % 50 === 0) console.log('avaliados', k, '/', plan.length);
  });
  let i = 0; await Promise.all(Array.from({ length: 3 }, async () => { while (i < work.length) { const f = work[i++]; await f(); } }));
  console.log('remover:', del.length, '| renomear:', ren.length);
  fs.writeFileSync('D:/loja/yupoo/dedupe-plan.json', JSON.stringify({ del, ren, detail }));
  if (!GO) return process.exit(0);
  const delSet = new Set(del), ops = [];
  for (const id of del) { for (const t of ['product_entities', 'product_images', 'variants']) ops.push({ sql: `DELETE FROM ${t} WHERE product_id=?`, args: [id] }); ops.push({ sql: 'DELETE FROM products WHERE id=?', args: [id] }); }
  for (let j = 0; j < ops.length; j += 200) await client.batch(ops.slice(j, j + 200), 'write');
  const slugUsed = new Set((await q.all('SELECT slug FROM products')).map((p) => p.slug));
  const nameUsed = new Set((await q.all('SELECT name FROM products WHERE active=1')).map((p) => p.name));
  const jogId = (await q.get("SELECT id FROM entities WHERE slug='jogadores'") || {}).id;
  const ops2 = [];
  for (const r of ren) { if (nameUsed.has(r.name)) continue; nameUsed.add(r.name); ops2.push({ sql: 'UPDATE products SET name=? WHERE id=?', args: [r.name, r.id] }); if (r.jog && jogId) ops2.push({ sql: 'DELETE FROM product_entities WHERE product_id=? AND entity_id=?', args: [r.id, jogId] }); }
  for (let j = 0; j < ops2.length; j += 200) await client.batch(ops2.slice(j, j + 200), 'write');
  for (const r of ren) { try { await cat.reindexProduct(r.id); } catch { /* ok */ } }
  console.log('feito. removidos:', del.length, 'renomeados:', ops2.filter((o) => o.sql.startsWith('UPDATE')).length);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
