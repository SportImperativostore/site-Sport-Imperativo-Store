/* Aponta as fotos/escudos do banco para os arquivos hospedados no próprio site (public/img/catalog).
 * Só troca o que tem arquivo local. Uso: node --env-file=.env scripts/localize-images.js [--dry] */
const fs = require('fs');
const path = require('path');
const { q, client, init } = require('../server/db');
const ROOT = path.join(__dirname, '..', 'public', 'img', 'catalog');
(async () => {
  await init();
  const ops = []; let np = 0, nt = 0, skip = 0;
  const rows = await q.all("SELECT id,product_id,url FROM product_images WHERE url LIKE 'https://cdn.meukatalogo.com/products/%' ORDER BY product_id, sort, id");
  const seen = {};
  for (const r of rows) {
    const m = r.url.match(/\/products\/([0-9a-f-]{36})\//); if (!m) { skip++; continue; }
    const i = seen[r.product_id] = (seen[r.product_id] ?? -1) + 1;
    if (i > 1 || !fs.existsSync(path.join(ROOT, 'p', m[1], i + '.webp'))) { skip++; continue; }
    ops.push({ sql: 'UPDATE product_images SET url=? WHERE id=?', args: [`/img/catalog/p/${m[1]}/${i}.webp`, r.id] }); np++;
  }
  for (const e of await q.all("SELECT id,slug FROM entities WHERE logo LIKE 'https://cdn.meukatalogo.com/teams/%'")) {
    const s = [e.slug, e.slug.replace(/^selecao-/, '')].find((x) => fs.existsSync(path.join(ROOT, 't', x + '.webp')));
    if (!s) { skip++; continue; }
    ops.push({ sql: 'UPDATE entities SET logo=? WHERE id=?', args: [`/img/catalog/t/${s}.webp`, e.id] }); nt++;
  }
  console.log(`produtos: ${np} • escudos: ${nt} • mantidos no CDN: ${skip}`);
  if (process.argv.includes('--dry')) return process.exit(0);
  for (let i = 0; i < ops.length; i += 250) await client.batch(ops.slice(i, i + 250), 'write');
  console.log('atualizado.'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
