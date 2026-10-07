/* Aplica a tabela de preços da loja (em centavos) por tipo de produto. Uso: node --env-file=.env scripts/apply-prices.js [--dry] */
const { q, client, init } = require('../server/db');
const T = { torcedor: 18900, edicao: 20999, feminina: 17900, manga: 20999, retro: 22900, retroManga: 25000, player: 22900, infantil: 19900, conjunto: 41900, personalizacao: 6000 };
(async () => {
  await init();
  const slugsOf = {};
  for (const r of await q.all("SELECT pe.product_id id, e.slug FROM product_entities pe JOIN entities e ON e.id=pe.entity_id WHERE e.type IN ('group','department')")) (slugsOf[r.id] ||= new Set()).add(r.slug);
  const ops = []; const tally = {};
  for (const p of await q.all('SELECT id,name FROM products')) {
    const g = slugsOf[p.id] || new Set(), n = p.name.toLowerCase();
    const infantil = g.has('conjuntos-infantis') || /infantil/.test(n), manga = /manga longa/.test(n), retro = g.has('retro') || /retr[oô]/.test(n);
    let k;
    if (g.has('agasalhos-de-clubes') || g.has('agasalhos-de-selecoes') || g.has('jaquetas-e-conjuntos-de-agasalho') || /conjunto de agasalho|jaqueta/.test(n)) k = 'conjunto';
    else if (infantil) k = 'infantil';
    else if (retro && manga) k = 'retroManga';
    else if (manga) k = 'manga';
    else if (/feminin/.test(n)) k = 'feminina';
    else if (retro) k = 'retro';
    else if (g.has('jogadores') || /jogador|player/.test(n)) k = 'player';
    else if (g.has('edicoes-especiais')) k = 'edicao';
    else k = 'torcedor';
    tally[k] = (tally[k] || 0) + 1;
    ops.push({ sql: 'UPDATE products SET price_cents=?, custom_price_cents=? WHERE id=?', args: [T[k], T.personalizacao, p.id] });
  }
  console.log(tally);
  if (process.argv.includes('--dry')) return process.exit(0);
  for (let i = 0; i < ops.length; i += 250) await client.batch(ops.slice(i, i + 250), 'write');
  console.log('preços atualizados:', ops.length); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
