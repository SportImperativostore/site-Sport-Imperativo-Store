/* Atualiza a cor no nome (e nos filtros de cor) das chuteiras cuja foto principal foi trocada. Uso: node --env-file=.env scripts/recolor-products.js */
const { q, client, init } = require('../server/db');
const { slugify, norm } = require('../server/lib/util');
const map = require('./yupoo/recolor.json');
const CW = '(?:Preta|Branca|Azul marinho|Azul claro|Azul|Vermelha|Vinho|Amarela|Verde limão|Verde escura|Verde|Laranja|Rosa|Cinza|Prata|Marrom|Roxa|Turquesa|Multicolor)';
const TAIL = new RegExp('\s+' + CW + '(?: e ' + CW + ')?(?:\s*\(\d+\))?$');
const base = (n) => n.replace(/ (marinho|claro|limão|escura)$/, '').replace('Turquesa', 'Azul').replace('Vinho', 'Vermelha');
(async () => {
  await init(); const ops = []; let n = 0;
  const colorIds = (await q.all("SELECT id FROM entities WHERE type='color'")).map((r) => r.id);
  for (const [sku, cor] of Object.entries(map)) {
    const p = await q.get("SELECT id,name FROM products WHERE sku=? AND name LIKE 'Chuteira%'", sku); if (!p) continue;
    const name = p.name.replace(TAIL, '') + ' ' + cor;
    ops.push({ sql: "UPDATE products SET name=?, search_text=? || ' ' || COALESCE(search_text,'') WHERE id=?", args: [name, norm(name), p.id] });
    if (colorIds.length) ops.push({ sql: `DELETE FROM product_entities WHERE product_id=? AND entity_id IN (${colorIds.join(',')})`, args: [p.id] });
    for (const c of [...new Set(cor.split(' e ').map(base))]) { const e = await q.get('SELECT id FROM entities WHERE slug=?', 'cor-' + slugify(c)); if (e) ops.push({ sql: 'INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', args: [p.id, e.id] }); }
    n++;
  }
  for (let i = 0; i < ops.length; i += 100) await client.batch(ops.slice(i, i + 100), 'write');
  console.log('renomeados', n); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
