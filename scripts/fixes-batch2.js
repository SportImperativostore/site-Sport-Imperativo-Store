/* Correções pedidas (idempotente): preços da F1 e dos calções, chuteiras "Gato" = futsal, Instagram da loja,
 * e retirada do ar das camisas NFL cujas fotos/fornecedor ainda não foram confirmados. Uso: node --env-file=.env scripts/fixes-batch2.js */
const { q, client, init, refreshSettings } = require('../server/db');
(async () => {
  await init();
  const ops = []; const op = (sql, ...args) => ops.push({ sql, args });
  const ent = async (slug) => (await q.get('SELECT id FROM entities WHERE slug=?', slug) || {}).id;

  /* 1) F1: camiseta/polo R$ 299 · moletom/jaqueta R$ 419 */
  op("UPDATE products SET price_cents=29900 WHERE active=1 AND (name LIKE 'Camiseta F1%' OR name LIKE 'Polo F1%')");
  op("UPDATE products SET price_cents=41900 WHERE active=1 AND (name LIKE 'Moletom F1%' OR name LIKE 'Jaqueta F1%')");

  /* 2) Calções: R$ 160 · versão jogador (Player Version/Jogador/Authentic) R$ 185 */
  op("UPDATE products SET price_cents=16000 WHERE name LIKE 'Calção%'");
  op("UPDATE products SET price_cents=18500 WHERE name LIKE 'Calção%' AND (name LIKE '%Player Version%' OR name LIKE '%Jogador%' OR name LIKE '%Authentic%')");

  /* 3) Chuteiras Gato (Streetgato, Reactgato, Gato IC, SB Gato...) são de FUTSAL */
  const fut = await ent('futsal'), campo = await ent('campo'), soc = await ent('society');
  if (fut) {
    op("INSERT OR IGNORE INTO product_entities(product_id,entity_id) SELECT id, ? FROM products WHERE name LIKE '%gato%'", fut);
    op(`DELETE FROM product_entities WHERE entity_id IN (${[campo, soc].filter(Boolean).join(',') || 0}) AND product_id IN (SELECT id FROM products WHERE name LIKE '%gato%')`);
    op("UPDATE products SET tags = COALESCE(tags,'') || ' futsal' WHERE name LIKE '%gato%' AND COALESCE(tags,'') NOT LIKE '%futsal%'");
    op("UPDATE products SET description = REPLACE(description, 'Chuteira de campo importada', 'Chuteira de futsal importada') WHERE name LIKE '%gato%'");
  }

  /* 4) Instagram da loja (o destaque de feedback continua em instagram_feedback_url) */
  op("INSERT INTO settings(key,value) VALUES('instagram','https://www.instagram.com/sportimperativostore2/') ON CONFLICT(key) DO UPDATE SET value=excluded.value");

  /* 5) NFL: fotos da lojanfl.com.br sem confirmação de licença nem de que o fornecedor entrega o mesmo modelo → fora do ar */
  op("UPDATE products SET active=0 WHERE sku LIKE 'YP-nfl-%'");

  for (let i = 0; i < ops.length; i += 100) await client.batch(ops.slice(i, i + 100), 'write');
  await refreshSettings();
  const r = await q.get("SELECT SUM(price_cents=29900) a FROM products WHERE name LIKE '% F1 %' AND active=1");
  console.log('ok •', ops.length, 'operações • F1 a R$ 299:', r.a);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
