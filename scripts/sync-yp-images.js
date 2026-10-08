/* Sincroniza as imagens dos produtos importados do Yupoo (SKU YP-<álbum>) com os arquivos em public/img/catalog/p/yp-<álbum>/.
 * Produtos sem nenhuma foto ficam inativos. Uso: node --env-file=.env scripts/sync-yp-images.js [--dry] */
const fs = require('fs');
const path = require('path');
const { client, q, init } = require('../server/db');
const ROOT = path.join(__dirname, '..', 'public', 'img', 'catalog', 'p');
(async () => {
  await init();
  const ops = []; let upd = 0, off = 0;
  for (const p of await q.all("SELECT id,sku,active FROM products WHERE sku LIKE 'YP-%'")) {
    const dir = path.join(ROOT, 'yp-' + p.sku.slice(3));
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d+\.webp$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b)) : [];
    ops.push({ sql: 'DELETE FROM product_images WHERE product_id=?', args: [p.id] });
    if (!files.length) { ops.push({ sql: 'UPDATE products SET active=0 WHERE id=?', args: [p.id] }); off++; continue; }
    files.forEach((f, i) => ops.push({ sql: 'INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', args: [p.id, `/img/catalog/p/yp-${p.sku.slice(3)}/${f}`, 'image', i] }));
    upd++;
  }
  console.log(`produtos com imagens atualizadas: ${upd} • sem foto (inativados): ${off} • operações: ${ops.length}`);
  if (process.argv.includes('--dry')) return process.exit(0);
  for (let i = 0; i < ops.length; i += 250) await client.batch(ops.slice(i, i + 250), 'write');
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
