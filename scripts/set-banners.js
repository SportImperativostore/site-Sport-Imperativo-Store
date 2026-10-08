/* Troca os banners do carrossel pelos novos (arte em public/img/banners/<nome>.webp e <nome>-m.webp). Uso: node --env-file=.env scripts/set-banners.js */
const { q, client, init } = require('../server/db');
const B = [
  ['clubes', 'AQUI VOCÊ VESTE O ESPORTE.', 'Camisas de clubes e seleções, retrô, NBA, NFL, F1 e chuteiras.', 'COMPRAR AGORA', '/futebol'],
  ['cr7', 'A CAMISA DO SEU ÍDOLO', 'Portugal, Al-Nassr e as camisas dos craques que marcaram época.', 'VER CAMISAS', '/busca?q=cr7'],
  ['retro-era', 'CAMISAS QUE MARCARAM UMA ERA', 'Retrôs históricos de clubes e seleções.', 'VER RETRÔS', '/futebol/retro'],
  ['selecoes', 'A SELEÇÃO NO PEITO', 'Camisas de seleções para torcer em grande estilo.', 'VER SELEÇÕES', '/futebol/camisas-de-futebol/selecoes'],
  ['nba-lebron', 'VISTA O SEU TIME DA NBA', 'Lakers, Warriors, Heat e muito mais: jerseys, regatas e camisetas.', 'VER NBA', '/nba'],
  ['nba-bulls', 'O LEGADO DE CHICAGO', 'Bulls, Jordan Brand e jerseys retrô Mitchell & Ness.', 'VER BULLS', '/busca?q=bulls'],
  ['nfl', 'VIVA O FUTEBOL AMERICANO', 'Dallas Cowboys, Kansas City Chiefs e as camisas da NFL.', 'VER NFL', '/nfl'],
  ['f1', 'FÓRMULA 1', 'Ferrari, Mercedes, McLaren e Red Bull: camisetas, polos e jaquetas.', 'VER F1', '/f1'],
  ['chuteiras', 'ENTRE EM CAMPO PREPARADO', 'Nike, Adidas, Puma e Mizuno: campo, society e futsal.', 'VER CHUTEIRAS', '/chuteiras'],
  ['agasalhos', 'AGASALHOS E CONJUNTOS', 'Corta-ventos, jaquetas e conjuntos de treino dos seus times.', 'VER AGASALHOS', '/futebol/agasalhos'],
  ['infantil', 'PARA OS PEQUENOS CRAQUES', 'Kits infantis de clubes e seleções.', 'VER INFANTIL', '/futebol/infantil-futebol'],
];
(async () => {
  await init();
  const ops = [{ sql: 'DELETE FROM banners', args: [] }];
  B.forEach(([n, t, s, c, l], i) => ops.push({ sql: 'INSERT INTO banners(title,subtitle,cta_text,link,image_desktop,image_mobile,sort,active) VALUES(?,?,?,?,?,?,?,1)', args: [t, s, c, l, `/img/banners/${n}.webp`, `/img/banners/${n}-m.webp`, (i + 1) * 10] }));
  await client.batch(ops, 'write');
  console.log('banners atualizados:', B.length); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
