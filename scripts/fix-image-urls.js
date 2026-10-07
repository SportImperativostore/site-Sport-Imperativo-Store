/* Troca URLs de imagem (Blob bloqueado) pelas fontes originais públicas (cdn.meukatalogo.com) ou por arquivos locais.
 * Uso: node --env-file=.env scripts/fix-image-urls.js [--dir=D:/loja/catalogo-import] [--dry] */
const fs = require('fs');
const path = require('path');
const { q, client, init } = require('../server/db');
const DIR = (process.argv.find((a) => a.startsWith('--dir=')) || '--dir=D:/loja/catalogo-import').slice(6);
const CDN = 'https://cdn.meukatalogo.com/';

function loadMiss(f) {
  const raw = fs.readFileSync(f, 'utf8');
  let seg = raw.slice(raw.indexOf('DATA_START') + 10, raw.indexOf('DATA_END'));
  for (let k = 0; k < 4; k++) { try { return JSON.parse(seg); } catch { seg = JSON.parse('"' + seg + '"'); } }
}
(async () => {
  await init();
  const orig = {};   // pid -> [primeira, segunda]
  const pick = (imgs) => {
    imgs = imgs.filter((u) => u && !/\.svg$/i.test(u));
    const byIdx = (n) => imgs.find((u) => new RegExp('_' + n + '\.\w+$').test(u));
    return imgs;
  };
  for (const l of fs.readFileSync(path.join(DIR, 'catalogo-produtos.tsv'), 'utf8').trim().split('\n')) {
    const r = l.split('\t'); const imgs = (r[8] || '').split(' ').filter((u) => u && !/\.svg$/i.test(u)); if (!imgs.length) continue;
    const first = imgs[0], folder = first.split('/')[0];
    const second = imgs.find((u, i) => i > 0 && u !== first && u.split('/')[0] === folder) || imgs[1];
    orig[r[0]] = [first, second];
  }
  const miss = loadMiss(path.join(DIR, 'miss.raw.json'));
  for (const r of miss.rows) {
    const imgs = (r[7] || '').split(' ').filter((u) => u && !/\.svg$/i.test(u)); if (!imgs.length) continue;
    const first = imgs.find((u) => /_0\.\w+$/.test(u)) || imgs[0], folder = first.split('/')[0];
    const second = imgs.find((u) => /_1\.\w+$/.test(u) && u.split('/')[0] === folder) || imgs.find((u) => u !== first);
    orig[r[0]] = [first, second];
  }
  const teams = JSON.parse(fs.readFileSync(path.join(DIR, 'teams.json'), 'utf8')).teams;
  const crest = Object.fromEntries(teams.filter((t) => t[2] && !/^https?:/.test(t[2])).map((t) => [t[0], CDN + 'teams/' + t[2]]));
  Object.assign(crest, Object.fromEntries(Object.entries(miss.crests).map(([k, v]) => [k, v])));

  const ops = []; let np = 0, nt = 0, skip = 0;
  for (const r of await q.all("SELECT id,url FROM product_images WHERE url LIKE '%blob.vercel-storage.com%'")) {
    const m = r.url.match(/\/catalog\/p\/([0-9a-f-]{36})\/(\d)\.webp/); const o = m && orig[m[1]]; const rel = o && o[+m[2]];
    if (!rel) { skip++; continue; }
    ops.push({ sql: 'UPDATE product_images SET url=? WHERE id=?', args: [`${CDN}products/${m[1]}/${rel}`, r.id] }); np++;
  }
  for (const e of await q.all("SELECT id,slug,logo FROM entities WHERE logo LIKE '%blob.vercel-storage.com%'")) {
    const m = e.logo.match(/\/catalog\/t\/([^/.]+)\.webp/); const u = m && (crest[m[1]] || crest[e.slug.replace(/^selecao-/, '')]);
    if (!u) { skip++; continue; }
    ops.push({ sql: 'UPDATE entities SET logo=? WHERE id=?', args: [u, e.id] }); nt++;
  }
  console.log(`produtos: ${np} • escudos: ${nt} • sem correspondência: ${skip}`);
  if (process.argv.includes('--dry')) return process.exit(0);
  for (let i = 0; i < ops.length; i += 250) await client.batch(ops.slice(i, i + 250), 'write');
  console.log('atualizado.'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
