/* Troca fotos hospedadas em site externo pelas cópias locais (public/img/catalog/p/ext-<id>/). Uso: node --env-file=.env scripts/localize-external.js */
const fs = require('fs');
const path = require('path');
const { client, q, init } = require('../server/db');
const map = require('./yupoo/ext-images.json');
(async () => {
  await init();
  const ops = []; let n = 0;
  for (const list of Object.values(map)) for (const m of list) {
    if (!fs.existsSync(path.join(__dirname, '..', 'public', m.to))) continue;
    ops.push({ sql: 'UPDATE product_images SET url=? WHERE url=?', args: [m.to, m.from] }); n++;
  }
  for (let i = 0; i < ops.length; i += 100) await client.batch(ops.slice(i, i + 100), 'write');
  console.log('fotos trocadas:', n); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
