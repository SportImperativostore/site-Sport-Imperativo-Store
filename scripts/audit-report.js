/* Relatório somente-leitura do catálogo: preço, categoria, imagens, variações, descrição e estoque. Uso: node --env-file=.env scripts/audit-report.js */
const { q, init } = require('../server/db');
(async () => {
  await init();
  const one = async (sql) => (await q.get(sql)).n;
  const total = await one('SELECT COUNT(*) n FROM products WHERE active=1');
  const r = {
    ativos: total,
    semPreco: await one('SELECT COUNT(*) n FROM products WHERE active=1 AND (price_cents IS NULL OR price_cents<=0)'),
    semImagem: await one('SELECT COUNT(*) n FROM products p WHERE active=1 AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id=p.id)'),
    semVariacoes: await one('SELECT COUNT(*) n FROM products p WHERE active=1 AND NOT EXISTS (SELECT 1 FROM variants v WHERE v.product_id=p.id)'),
    semDescricao: await one("SELECT COUNT(*) n FROM products WHERE active=1 AND (description IS NULL OR TRIM(description)='')"),
    semCategoria: await one("SELECT COUNT(*) n FROM products p WHERE active=1 AND NOT EXISTS (SELECT 1 FROM product_entities pe JOIN entities e ON e.id=pe.entity_id WHERE pe.product_id=p.id AND e.type!='sport')"),
    sobEncomendaSemEstoque: await one("SELECT COUNT(*) n FROM products WHERE active=1 AND fulfillment='import'"),
    prontaEntregaSemEstoque: await one("SELECT COUNT(*) n FROM products p WHERE active=1 AND fulfillment='stock' AND stock<=0 AND NOT EXISTS (SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.stock>0)"),
    nomesDuplicados: await one('SELECT COUNT(*) n FROM (SELECT LOWER(name) k FROM products WHERE active=1 GROUP BY LOWER(name) HAVING COUNT(*)>1)'),
    imagemPrincipalExterna: await one("SELECT COUNT(*) n FROM products p WHERE active=1 AND (SELECT url FROM product_images i WHERE i.product_id=p.id ORDER BY sort,id LIMIT 1) LIKE 'http%'"),
  };
  console.log(r);
  const prices = await q.all('SELECT price_cents p, COUNT(*) n FROM products WHERE active=1 GROUP BY price_cents ORDER BY n DESC LIMIT 14');
  console.log('preços:', prices.map((x) => `R$ ${x.p / 100} × ${x.n}`).join(' | '));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
