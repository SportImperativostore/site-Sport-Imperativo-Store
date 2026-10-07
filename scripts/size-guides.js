/* Atualiza as tabelas de medidas com as do catálogo (Infantil, Feminina, Jogador, Torcedor). Uso: node --env-file=.env scripts/size-guides.js */
const { q, init } = require('../server/db');

const H = ['Tamanho', 'Comp. (cm)', 'Largura (cm)', 'Altura (cm)', 'Peso (kg)'];
const NOTE = 'Medidas aproximadas, informadas pelo fabricante. Pode haver variação de 1 a 3 cm entre peças.';
const GUIDES = {
  Infantil: { headers: ['Tamanho', 'Idade', 'Altura (cm)', 'Comp. (cm)', 'Largura (cm)', 'Cintura (cm)'], rows: [
    ['14', '2-3', '85-95', '41', '33', '19-36'], ['16', '3-4', '95-105', '44', '35', '20-37'], ['18', '4-5', '105-115', '47', '37', '21-39'], ['20', '5-6', '115-125', '50', '39', '22-41'],
    ['22', '6-7', '125-135', '53', '41', '23-42'], ['24', '8-9', '135-145', '56', '43', '24-44'], ['26', '10-11', '145-155', '59', '45', '25-47'], ['28', '12-13', '155-165', '62', '47', '26-50']] },
  Feminina: { headers: ['Tamanho', 'Comp. (cm)', 'Largura (cm)', 'Altura (cm)'], rows: [
    ['P', '61-63', '40-41', '150-160'], ['M', '63-66', '41-44', '160-165'], ['G', '66-69', '44-47', '165-170'], ['GG', '69-71', '47-50', '170-175']] },
  Jogador: { headers: H, rows: [
    ['P', '67-69', '49-51', '162-170', '50-62'], ['M', '69-71', '51-53', '170-175', '62-75'], ['G', '71-73', '53-55', '175-180', '75-80'],
    ['GG', '73-76', '55-57', '180-185', '80-85'], ['2XG', '76-78', '57-60', '185-190', '85-90'], ['3XG', '78-79', '60-63', '190-195', '90-95']] },
  Torcedor: { headers: H, rows: [
    ['P', '69-71', '53-55', '162-170', '50-62'], ['M', '71-73', '55-57', '170-175', '62-78'], ['G', '71-75', '57-58', '176-182', '78-83'], ['GG', '75-78', '58-60', '182-190', '83-90'],
    ['2XG', '78-81', '60-62', '190-195', '90-97'], ['3XG', '81-83', '60-64', '192-197', '97-104'], ['4XG', '83-85', '60-65', '192-200', '104-110']] },
};

(async () => {
  await init();
  const existing = await q.all('SELECT id,name FROM size_guides');
  const byName = Object.fromEntries(existing.map((g) => [g.name, g.id]));
  const ids = {};
  for (const [name, g] of Object.entries(GUIDES)) {
    const oldName = name === 'Jogador' ? 'Player (corte slim)' : name;
    const id = byName[name] || byName[oldName];
    if (id) { await q.run('UPDATE size_guides SET name=?,headers=?,rows=?,notes=? WHERE id=?', name, JSON.stringify(g.headers), JSON.stringify(g.rows), NOTE, id); ids[name] = id; }
    else ids[name] = (await q.run('INSERT INTO size_guides(name,headers,rows,notes) VALUES(?,?,?,?)', name, JSON.stringify(g.headers), JSON.stringify(g.rows), NOTE)).lastInsertRowid;
  }
  // Produtos: guia conforme a categoria (retrô, manga longa e agasalhos usam a tabela Torcedor, como no catálogo)
  const cat = async (slug) => (await q.get('SELECT id FROM entities WHERE slug=?', slug) || {}).id;
  const map = { torcedor: 'Torcedor', player: 'Jogador', feminina: 'Feminina', infantil: 'Infantil', retro: 'Torcedor', 'manga-longa': 'Torcedor', agasalhos: 'Torcedor' };
  for (const [slug, guide] of Object.entries(map)) {
    const cid = await cat(slug); if (!cid) continue;
    await q.run('UPDATE products SET size_guide_id=? WHERE id IN (SELECT product_id FROM product_entities WHERE entity_id=?)', ids[guide], cid);
  }
  await q.run("DELETE FROM size_guides WHERE name='Retrô'");
  console.log('guias:', await q.all('SELECT id,name FROM size_guides'), 'produtos com guia:', (await q.get('SELECT COUNT(*) n FROM products WHERE size_guide_id IS NOT NULL')).n);
  process.exit(0);
})();
