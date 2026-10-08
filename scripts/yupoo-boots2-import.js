/* Importa mais chuteiras de futebol (fornecedores Yupoo dachang88 e yhc) como produtos sob encomenda. Idempotente (SKU YP-<álbum>).
 * Fotos em public/img/catalog/p/yp-<álbum>/. Só entram chuteiras de futebol (nada de tênis, corrida, meias, bolsas).
 * Uso: node --env-file=.env scripts/yupoo-boots2-import.js [--dry] */
const { client, q, init, refreshSettings } = require('../server/db');
const { slugify, norm } = require('../server/lib/util');
const fs = require('fs');
const path = require('path');
const rows = require('./yupoo/boots2.json');
const ROOT = path.join(__dirname, '..', 'public', 'img', 'catalog', 'p');
const DRY = process.argv.includes('--dry');
const PRICE = 55000;
const MOD_LABEL = { campo: 'de campo', society: 'society', futsal: 'de futsal' };
const baseColor = (n) => n.replace(/ (marinho|claro|limão|escura)$/, '').replace('Turquesa', 'Azul').replace('Vinho', 'Vermelha');
const joinColors = (c) => (c.length <= 1 ? c[0] : c.length === 2 ? c.join(' e ') : c.slice(0, -1).join(', ') + ' e ' + c[c.length - 1]);

(async () => {
  await init();
  const have = new Set((await q.all("SELECT sku FROM products WHERE sku LIKE 'YP-%'")).map((p) => p.sku));
  const ent = async (slug) => (await q.get('SELECT id FROM entities WHERE slug=?', slug) || {}).id;
  let nextEnt = (await q.get('SELECT COALESCE(MAX(id),0) m FROM entities')).m, nextProd = (await q.get('SELECT COALESCE(MAX(id),0) m FROM products')).m;
  const ops = []; const op = (sql, ...args) => ops.push({ sql, args: args.map((a) => (a === undefined ? null : a)) });
  const newEnt = async (slug, type, name, parents, sort = 500) => {
    let id = await ent(slug); if (id) return id;
    id = ++nextEnt; op('INSERT INTO entities(id,type,name,slug,sort,show_in_menu,active) VALUES(?,?,?,?,?,1,1)', id, type, name, slug, sort);
    for (const p of parents) if (p) op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', p, id, sort);
    return id;
  };
  const chut = await ent('chuteiras'), marcas = await ent('marcas-chuteiras'), modelos = await ent('modelos-chuteiras'), cores = await ent('cores-chuteiras');
  const guide = (await q.get("SELECT id FROM size_guides WHERE name='Chuteiras'") || {}).id;
  const sizeSet = new Set((await q.all('SELECT name FROM sizes')).map((s) => s.name));
  const used = new Set((await q.all('SELECT slug FROM products')).map((p) => p.slug));
  const names = new Map(); for (const p of await q.all("SELECT name FROM products WHERE name LIKE 'Chuteira%'")) names.set(p.name.toLowerCase(), 1);
  const uniq = (b) => { let s = slugify(b), n = 2, c = s; while (used.has(c)) c = `${s}-${n++}`; used.add(c); return c; };
  const cache = {}; const get = async (k, mk) => (cache[k] ||= await mk());
  let added = 0;
  for (const r of rows) {
    if (have.has('YP-' + r.id)) continue;
    const dir = path.join(ROOT, 'yp-' + r.id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d+\.webp$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b)) : [];
    if (!files.length) continue;
    const colors = r.cols && r.cols.length ? r.cols : (r.imgcolor ? r.imgcolor.split(' e ') : []);
    const base = 'Chuteira ' + r.model.replace(/\s+/g, ' ').trim();
    const full = colors.length ? `${base} ${joinColors(colors)}` : base;
    let name = full, n = 1; while (names.has(name.toLowerCase())) name = `${full} (${++n})`; names.set(name.toLowerCase(), 1);
    const brandId = await get('b:' + r.brand, async () => (await ent(slugify(r.brand))) || newEnt(slugify(r.brand), 'brand', r.brand, [marcas], 800));
    const modId = await get('m:' + r.mod, () => ent(r.mod));
    const famId = r.fam ? await get('f:' + r.fam, async () => (await ent('modelo-' + slugify(r.fam))) || newEnt('modelo-' + slugify(r.fam), 'model', r.fam, [modelos], 500)) : null;
    const colorIds = [];
    for (const c of [...new Set(colors.map(baseColor))]) colorIds.push(await get('c:' + c, async () => (await ent('cor-' + slugify(c))) || newEnt('cor-' + slugify(c), 'color', c, [cores], 50)));
    const id = ++nextProd;
    op(`INSERT INTO products(id,slug,name,description,price_cents,fulfillment,stock,shipping_rule,origin,lead_min,lead_max,weight_g,customizable,custom_price_cents,size_guide_id,tags,sku,shape,active,sold,search_text)
        VALUES(?,?,?,?,?,'import',0,'free','China',15,30,900,0,NULL,?,?,?,'boot',1,0,?)`,
    id, uniq(name + '-' + String(r.id).slice(-5)), name, `${name}. Chuteira ${MOD_LABEL[r.mod]} importada. Consulte a tabela de numeração e escolha seu tamanho.`, PRICE, guide || null, `chuteira ${r.brand} ${r.fam || ''} ${r.mod} ${colors.join(' ')}`, 'YP-' + r.id, norm(`${name} chuteira ${r.brand} ${r.fam || ''} ${r.mod} ${colors.join(' ')}`));
    for (const e of new Set([chut, brandId, modId, famId, ...colorIds].filter(Boolean))) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', id, e);
    files.forEach((f, i) => op('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', id, `/img/catalog/p/yp-${r.id}/${f}`, 'image', i));
    for (const s of r.sizes) { if (!sizeSet.has(s)) { sizeSet.add(s); op('INSERT OR IGNORE INTO sizes(name,sort) VALUES(?,?)', s, 400); } op('INSERT OR IGNORE INTO variants(product_id,size,stock) VALUES(?,?,0)', id, s); }
    added++;
  }
  console.log(`chuteiras novas: ${added} • operações: ${ops.length}`);
  if (DRY) return process.exit(0);
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  await refreshSettings();
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
