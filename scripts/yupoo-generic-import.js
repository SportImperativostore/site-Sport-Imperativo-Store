/* Importador genérico de produtos já preparados (scripts/yupoo/<arquivo>.json) — idempotente por SKU.
 * Formato: { defs: [{slug,type,name,parents:[slug],sort,menu}], products: [{id,name,desc,price,sizes,tags,ents:[slug],customizable,custom_price,guide,shape,photos,fulfillment}] }
 * Fotos em public/img/catalog/p/yp-<id>/<n>.webp. Uso: node --env-file=.env scripts/yupoo-generic-import.js <arquivo.json> [--dry] */
const { client, q, init, refreshSettings } = require('../server/db');
const { slugify, norm } = require('../server/lib/util');
const fs = require('fs');
const path = require('path');
const file = process.argv[2];
const DRY = process.argv.includes('--dry');
const ROOT = path.join(__dirname, '..', 'public', 'img', 'catalog', 'p');

(async () => {
  if (!file) throw new Error('informe o arquivo JSON');
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'yupoo', file), 'utf8'));
  await init();
  const have = new Set((await q.all("SELECT sku FROM products WHERE sku LIKE 'YP-%'")).map((p) => p.sku));
  let nextEnt = (await q.get('SELECT COALESCE(MAX(id),0) m FROM entities')).m, nextProd = (await q.get('SELECT COALESCE(MAX(id),0) m FROM products')).m;
  const ops = []; const op = (sql, ...args) => ops.push({ sql, args: args.map((a) => (a === undefined ? null : a)) });
  const ID = {};
  const ent = async (slug) => { if (ID[slug]) return ID[slug]; const r = await q.get('SELECT id FROM entities WHERE slug=?', slug); if (r) ID[slug] = r.id; return ID[slug]; };
  for (const d of data.defs || []) {
    let id = await ent(d.slug);
    if (!id) { id = ++nextEnt; ID[d.slug] = id; op('INSERT INTO entities(id,type,name,slug,logo,sort,show_in_menu,active) VALUES(?,?,?,?,?,?,?,1)', id, d.type, d.name, d.slug, d.logo || null, d.sort ?? 500, d.menu === 0 ? 0 : 1); }
    else if (d.update) op('UPDATE entities SET type=?,name=?,show_in_menu=?,active=1 WHERE id=?', d.type, d.name, d.menu === 0 ? 0 : 1, id);
    for (const p of d.parents || []) { const pid = await ent(p); if (pid) op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', pid, id, d.sort ?? 500); }
  }
  const sizeSet = new Set((await q.all('SELECT name FROM sizes')).map((s) => s.name));
  const guides = Object.fromEntries((await q.all('SELECT id,name FROM size_guides')).map((g) => [g.name, g.id]));
  const used = new Set((await q.all('SELECT slug FROM products')).map((p) => p.slug));
  const names = new Set((await q.all('SELECT name FROM products')).map((p) => p.name.toLowerCase()));
  const uniq = (b) => { let s = slugify(b), n = 2, c = s; while (used.has(c)) c = `${s}-${n++}`; used.add(c); return c; };
  let added = 0, skipped = 0;
  for (const r of data.products) {
    if (have.has('YP-' + r.id)) { skipped++; continue; }
    const dir = path.join(ROOT, 'yp-' + r.id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d+\.webp$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b)) : [];
    if (!files.length) { skipped++; continue; }
    let name = r.name, n = 1; while (names.has(name.toLowerCase())) name = `${r.name} (${++n})`; names.add(name.toLowerCase());
    const id = ++nextProd;
    op(`INSERT INTO products(id,slug,name,description,price_cents,fulfillment,stock,shipping_rule,origin,lead_min,lead_max,weight_g,customizable,custom_price_cents,size_guide_id,tags,sku,shape,active,sold,search_text)
        VALUES(?,?,?,?,?,?,0,'free','China',15,30,?,?,?,?,?,?,?,1,0,?)`,
    id, uniq(name + '-' + String(r.id).slice(-5)), name, r.desc || `${name}. Importado, qualidade premium. Escolha o tamanho e consulte a tabela de medidas.`, r.price, r.fulfillment || 'import', r.weight || 400,
    r.customizable ? 1 : 0, r.customizable ? (r.custom_price || 6000) : null, guides[r.guide] || null, r.tags || '', 'YP-' + r.id, r.shape || 'jersey', norm(`${name} ${r.tags || ''}`));
    const eids = []; for (const s of r.ents || []) { const e = await ent(s); if (e) eids.push(e); }
    for (const e of new Set(eids)) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', id, e);
    files.forEach((f, i) => op('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', id, `/img/catalog/p/yp-${r.id}/${f}`, 'image', i));
    for (const s of r.sizes || []) { if (!sizeSet.has(s)) { sizeSet.add(s); op('INSERT OR IGNORE INTO sizes(name,sort) VALUES(?,?)', s, 600); } op('INSERT OR IGNORE INTO variants(product_id,size,stock) VALUES(?,?,0)', id, s); }
    added++;
  }
  console.log(`${file}: ${added} produtos novos • ${skipped} já existiam/sem foto • ${(data.defs || []).length} definições de categoria • operações: ${ops.length}`);
  if (DRY) return process.exit(0);
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  await refreshSettings();
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
