/* Cadastra as camisas NFL (colaboração clubes x NFL) do catálogo Yupoo. Idempotente (SKU YP-<álbum>).
 * Uso: node --env-file=.env scripts/nfl-import.js */
const fs = require('fs');
const path = require('path');
const { client, q, init, refreshSettings } = require('../server/db');
const { slugify } = require('../server/lib/util');
const PRICE = 29900;
const NAMES = { 207243465: 'Camisa Paris Saint-Germain x NFL', 207243204: 'Camisa Inter de Milão x NFL', 207242686: 'Camisa Chelsea x NFL' };
(async () => {
  await init();
  const photos = JSON.parse(fs.readFileSync(path.join(__dirname, 'yupoo', 'nfl-photos.json'), 'utf8'));
  const ent = async (slug) => (await q.get('SELECT id FROM entities WHERE slug=?', slug) || {}).id;
  const nfl = await ent('nfl'), jerseys = await ent('jerseys-nfl'), special = await ent('edicoes-especiais-nfl');
  const guide = (await q.get("SELECT id FROM size_guides WHERE name='Torcedor'") || {}).id;
  const have = new Set((await q.all("SELECT sku FROM products WHERE sku LIKE 'YP-%'")).map((p) => p.sku));
  let next = (await q.get('SELECT COALESCE(MAX(id),0) m FROM products')).m;
  const ops = []; const op = (sql, args) => ops.push({ sql, args });
  for (const [pid, name] of Object.entries(NAMES)) {
    if (have.has('YP-' + pid) || !photos[pid]) continue;
    const id = ++next;
    op(`INSERT INTO products(id,slug,name,description,price_cents,fulfillment,stock,shipping_rule,origin,lead_min,lead_max,weight_g,customizable,custom_price_cents,size_guide_id,tags,sku,shape,active,sold,search_text)
        VALUES(?,?,?,?,?,'import',0,'free','China',15,30,400,1,6000,?,?,?,'jersey',1,0,?)`,
    [id, slugify(name + '-' + pid.slice(-5)), name, `${name}. Camisa inspirada no futebol americano, importada. Escolha o tamanho e, se quiser, personalize com nome, número, patch e patrocinador.`, PRICE, guide || null, 'nfl futebol americano camisa', 'YP-' + pid, (name + ' nfl futebol americano').toLowerCase()]);
    for (const e of [nfl, jerseys, special]) if (e) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', [id, e]);
    for (let i = 0; i < photos[pid]; i++) op('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', [id, `/img/catalog/p/yp-${pid}/${i}.webp`, 'image', i]);
    for (const s of ['P', 'M', 'G', 'GG', 'XGG', '2XG']) op('INSERT OR IGNORE INTO variants(product_id,size,stock) VALUES(?,?,0)', [id, s]);
  }
  if (ops.length) await client.batch(ops, 'write');
  await refreshSettings();
  console.log('produtos NFL adicionados:', ops.filter((o) => o.sql.startsWith('INSERT INTO products')).length);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
