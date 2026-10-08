/* Limpeza das chuteiras/NBA importadas do Yupoo (idempotente):
 *  - remove duplicados reais (mesma foto principal) e itens que não são chuteiras (Air Max, SB Gato);
 *  - chuteiras de futebol americano (Vapor Edge) saem de Chuteiras e vão para NFL;
 *  - corrige marcas "Outras" (GX3, YF, Copa Pure...), nomeia cada chuteira com a cor (detectada na foto) e liga às cores.
 * Uso: node --env-file=.env scripts/yp-cleanup.js [--dry] */
const path = require('path');
const { client, q, init } = require('../server/db');
const { slugify } = require('../server/lib/util');
const colors = require('./yupoo/colors.json');
const dups = new Set(require('./yupoo/dups.json'));
const DRY = process.argv.includes('--dry');

const CW = '(?:Preta|Branca|Azul marinho|Azul claro|Azul|Vermelha|Vinho|Amarela|Verde limão|Verde escura|Verde|Laranja|Rosa|Cinza|Prata|Marrom|Roxa|Turquesa|Multicolor)';
const COLOR_TAIL = new RegExp('\\s+' + CW + '(?: e ' + CW + ')?$');
const baseColor = (n) => n.replace(/ (marinho|claro|limão|escura)$/, '').replace('Turquesa', 'Azul').replace('Vinho', 'Vermelha');
const brandOf = (n) => (/copa|predator|f50|crazy|adidas/i.test(n) ? 'Adidas' : /phantom|gx|mercurial|tiempo|vapor|zoom|nike|legend|streetgato|reactgato|ligera/i.test(n) ? 'Nike' : /ultra|future|king|puma/i.test(n) ? 'Puma' : /morelia|alpha|mizuno/i.test(n) ? 'Mizuno' : /furon|tekela|new balance/i.test(n) ? 'New Balance' : null);

(async () => {
  await init();
  const ent = async (slug) => (await q.get('SELECT id FROM entities WHERE slug=?', slug) || {}).id;
  let nextEnt = (await q.get('SELECT COALESCE(MAX(id),0) m FROM entities')).m;
  const ops = []; const op = (sql, ...args) => ops.push({ sql, args });
  const del = (id) => { for (const t of ['product_entities', 'product_images', 'variants']) op(`DELETE FROM ${t} WHERE product_id=?`, id); op('DELETE FROM products WHERE id=?', id); };

  const chut = await ent('chuteiras'), nfl = await ent('nfl'), outrosNfl = await ent('outros-nfl'), cores = await ent('cores-chuteiras'), outras = await ent('outras');
  const brandIds = {}; for (const b of ['Nike', 'Adidas', 'Puma', 'Mizuno', 'New Balance']) brandIds[b] = await ent(slugify(b));
  const colorIds = {};
  const colorEnt = async (name) => {
    name = baseColor(name); const slug = 'cor-' + slugify(name); if (colorIds[slug]) return colorIds[slug];
    let id = await ent(slug);
    if (!id) { id = ++nextEnt; op('INSERT INTO entities(id,type,name,slug,sort,show_in_menu,active) VALUES(?,?,?,?,?,1,1)', id, 'color', name, slug, 50); if (cores) op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', cores, id, 50); }
    return (colorIds[slug] = id);
  };
  const colorLinks = (await q.all("SELECT id FROM entities WHERE type='color'")).map((r) => r.id);

  const prods = await q.all("SELECT id,sku,name FROM products WHERE sku LIKE 'YP-%'");
  const used = new Map(); let nDel = 0, nMove = 0, nRen = 0;
  const boots = prods.filter((p) => p.name.startsWith('Chuteira')).sort((a, b) => a.id - b.id);
  for (const p of prods) {
    const aid = p.sku.slice(3);
    if (dups.has(aid)) { del(p.id); nDel++; continue; }
  }
  for (const p of boots) {
    const aid = p.sku.slice(3);
    if (dups.has(aid)) continue;
    let base = p.name.replace(/\s*\((Cor|Opção)? ?\d+\)\s*$/, '').replace(COLOR_TAIL, '').trim();
    base = base.replace(/ (FG|TF|SG|IC|AG) didas /, ' ');
    if (/air\s?max|\bSB\b|supreme/i.test(base)) { del(p.id); nDel++; continue; }
    if (/vapor edge/i.test(base)) { // futebol americano → NFL
      op('DELETE FROM product_entities WHERE product_id=? AND entity_id!=?', p.id, nfl || 0); for (const e of [nfl, outrosNfl]) if (e) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', p.id, e);
      op('UPDATE products SET name=?, tags=? WHERE id=?', 'Chuteira de Futebol Americano Nike Vapor Edge 360', 'nfl futebol americano chuteira nike vapor edge', p.id); nMove++; continue;
    }
    let brand = null;
    if (/^Chuteira Outras/.test(base)) {
      const m = base.replace(/^Chuteira Outras\s*/, '');
      const mod = (m.match(/\b(FG|TF|AG|IC|SG)\b/) || [])[1];
      if (/^GX3/.test(m)) base = 'Chuteira Nike Phantom GX III' + (mod ? ' ' + mod : ''); else if (/^YF/.test(m)) base = 'Chuteira Nike Mercurial 17' + (mod ? ' ' + mod : ''); else base = 'Chuteira ' + m;
    }
    brand = brandOf(base);
    if (/^Chuteira (FG|TF) COPA|^Chuteira Outras (FG|TF) COPA/i.test(p.name)) base = 'Chuteira Adidas ' + base.replace(/^Chuteira (Outras )?(FG|TF) /, '').replace(/ BOOTS$/i, ' ' + (/ TF /.test(p.name) ? 'TF' : 'FG'));
    brand = brandOf(base) || brand;
    // modalidade a partir do nome
    const color = colors[aid];
    const full = color ? `${base} ${color}` : base;
    const k = full.toLowerCase(); const n = (used.get(k) || 0) + 1; used.set(k, n);
    const name = n > 1 ? `${full} (${n})` : full;
    if (name !== p.name) { op('UPDATE products SET name=?, search_text=? || \' \' || COALESCE(search_text, \'\') WHERE id=?', name, require('../server/lib/util').norm(name), p.id); nRen++; }
    if (brand && brandIds[brand]) { if (outras) op('DELETE FROM product_entities WHERE product_id=? AND entity_id=?', p.id, outras); op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', p.id, brandIds[brand]); }
    if (color) {
      if (colorLinks.length) op(`DELETE FROM product_entities WHERE product_id=? AND entity_id IN (${colorLinks.join(',')})`, p.id);
      for (const c of [...new Set(color.split(' e ').map(baseColor))]) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', p.id, await colorEnt(c));
    }
  }
  console.log(`removidos: ${nDel} • movidos para NFL: ${nMove} • renomeados: ${nRen} • operações: ${ops.length}`);
  if (DRY) return process.exit(0);
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
