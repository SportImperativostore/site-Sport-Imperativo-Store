/* Auditoria final do catálogo (idempotente): remove duplicados exatos, desativa produtos sem foto e esconde do menu categorias vazias.
 * Uso: node --env-file=.env scripts/catalog-audit.js [--dry] */
const fs = require('fs');
const path = require('path');
const { client, q, init } = require('../server/db');
const DRY = process.argv.includes('--dry');
const PUB = path.join(__dirname, '..', 'public');
const DUP_NAMES = ['Camisa Sao Paulo 2026 Third Feminina', 'Corta-Vento Sporting CP Lisbon 25/26'];

(async () => {
  await init();
  const ops = []; const op = (sql, ...args) => ops.push({ sql, args });
  const del = (id) => { for (const t of ['product_entities', 'product_images', 'variants']) op(`DELETE FROM ${t} WHERE product_id=?`, id); op('DELETE FROM products WHERE id=?', id); };
  const report = {};

  /* 1) duplicados exatos conhecidos (mesma foto e mesmo produto) */
  const dups = await q.all(`SELECT id,name FROM products WHERE name IN (${DUP_NAMES.map(() => '?').join(',')})`, ...DUP_NAMES);
  dups.forEach((d) => del(d.id)); report.duplicadosRemovidos = dups.length;

  /* 2) imagens locais que não existem → remove a linha; produto sem nenhuma foto → inativo */
  const imgs = await q.all('SELECT id,product_id,url FROM product_images');
  let broken = 0; const have = {};
  for (const i of imgs) {
    if (i.url.startsWith('/img/catalog/') && !fs.existsSync(path.join(PUB, i.url))) { op('DELETE FROM product_images WHERE id=?', i.id); broken++; continue; }
    have[i.product_id] = (have[i.product_id] || 0) + 1;
  }
  report.imagensQuebradas = broken;
  const noImg = (await q.all('SELECT id,name FROM products WHERE active=1')).filter((p) => !have[p.id]);
  noImg.forEach((p) => op('UPDATE products SET active=0 WHERE id=?', p.id)); report.produtosSemFotoInativados = noImg.length;

  /* 3) a foto principal nunca pode ser uma imagem "tabela de medidas": se a 1ª foto for repetida entre produtos e houver outra, troca a ordem (só Yupoo) — já tratado na importação */

  /* 4) produtos sem categoria além do esporte */
  const sports = (await q.all("SELECT id FROM entities WHERE type='sport'")).map((e) => e.id);
  const noCat = await q.all(`SELECT p.id,p.name FROM products p WHERE p.active=1 AND NOT EXISTS (SELECT 1 FROM product_entities pe WHERE pe.product_id=p.id AND pe.entity_id NOT IN (${sports.join(',') || 0}))`);
  report.produtosSemCategoria = noCat.length;

  /* 5) menu: esconde entidades sem produtos (times, ligas, cores, modelos, marcas...) e seções vazias */
  const cnt = Object.fromEntries((await q.all('SELECT entity_id,COUNT(*) n FROM product_entities pe JOIN products p ON p.id=pe.product_id AND p.active=1 GROUP BY entity_id')).map((r) => [r.entity_id, r.n]));
  const ents = await q.all("SELECT id,type,slug,show_in_menu FROM entities WHERE active=1");
  const kids = {}; for (const l of await q.all('SELECT parent_id,child_id FROM entity_links')) (kids[l.parent_id] ||= []).push(l.child_id);
  const byId = Object.fromEntries(ents.map((e) => [e.id, e]));
  const memo = {};
  const visible = (id, seen = new Set()) => { // tem produtos, ou algum filho visível
    if (memo[id] !== undefined) return memo[id]; if (seen.has(id)) return false; seen.add(id);
    const e = byId[id]; if (!e) return false;
    let v = (cnt[id] || 0) > 0; if (!v) for (const k of kids[id] || []) if (visible(k, seen)) { v = true; break; }
    return (memo[id] = v);
  };
  let hidden = 0, shown = 0;
  for (const e of ents) {
    if (e.type === 'sport') continue;
    const v = visible(e.id);
    if (!v && e.show_in_menu) { op('UPDATE entities SET show_in_menu=0 WHERE id=?', e.id); hidden++; }
    else if (v && !e.show_in_menu && !['version'].includes(e.type) && !/^(torcedor|feminina|infantil|manga-longa)$/.test(e.slug)) { op('UPDATE entities SET show_in_menu=1 WHERE id=?', e.id); shown++; }
  }
  report.entidadesEscondidas = hidden; report.entidadesReexibidas = shown;
  console.log(report, 'operações:', ops.length);
  if (noCat.length) console.log('sem categoria (amostra):', noCat.slice(0, 8).map((p) => p.name).join(' | '));
  if (DRY) return process.exit(0);
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
