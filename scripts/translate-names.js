/* Traduz os nomes dos produtos importados para português. Uso: node --env-file=.env scripts/translate-names.js [--dry] */
const { q, client, init } = require('../server/db');
const { norm } = require('../server/lib/util');

const MAP = [
  [/\bHome\b/gi, 'Titular'], [/\bAway\b/gi, 'Reserva'], [/\bThird\b/gi, 'Terceira'], [/\bFourth\b/gi, 'Quarta'],
  [/\bFan\b/gi, 'Torcedor'], [/\bPlayer\b/gi, 'Jogador'], [/\bRetro\b/gi, 'Retrô'], [/\bKids?\b/gi, 'Infantil'], [/\bWom[ae]n'?s?\b/gi, 'Feminina'], [/\bFemale\b/gi, 'Feminina'],
  [/\bLong\s+Sleeves?\b/gi, 'Manga Longa'], [/\bLong\b/gi, 'Manga Longa'],  [/\bGoal\s?keeper\b/gi, 'Goleiro'], [/\bGK\b/g, 'Goleiro'], [/\bTraining\b/gi, 'Treino'], [/\bPre-?Match\b/gi, 'Pré-Jogo'], [/\bWindbreaker\b/gi, 'Corta-Vento'],
  [/\bTrack\s+Jacket\b/gi, 'Jaqueta de Treino'], [/\bJacket\b/gi, 'Jaqueta'], [/\bFull\s+Zipper\b/gi, 'Zíper Completo'], [/\bReversible\b/gi, 'Reversível'],
  [/\bSpecial\s+Edition\b/gi, 'Edição Especial'], [/\bEdition\b/gi, 'Edição'], [/\bAnniversary\b/gi, 'Aniversário'], [/\bYears?\b/gi, 'Anos'], [/\bSleeve\b/gi, 'Manga'], [/\bSponsors\b/gi, 'Patrocínios'],
  [/\bVersion\b/gi, 'Versão'], [/\bWorld\s+Cup\b/gi, 'Copa do Mundo'], [/\bCup\b/gi, 'Copa'], [/\bFinal\b/gi, 'Final'], [/\bTank\s+Top\b/gi, 'Regata'], [/\bSinglet\b/gi, 'Regata'], [/\bShorts?\b/gi, 'Short'],
  [/\bBlack\b/gi, 'Preta'], [/\bWhite\b/gi, 'Branca'], [/\bRed\b/gi, 'Vermelha'], [/\bBlue\b/gi, 'Azul'], [/\bGreen\b/gi, 'Verde'], [/\bYellow\b/gi, 'Amarela'], [/\bGold\b/gi, 'Dourada'],
  [/\bPink\b/gi, 'Rosa'], [/\bOrange\b/gi, 'Laranja'], [/\bPurple\b/gi, 'Roxa'], [/\bGr[ae]y\b/gi, 'Cinza'], [/\bNavy\b/gi, 'Marinho'], [/\bSilver\b/gi, 'Prata'], [/\bBrown\b/gi, 'Marrom'],
  [/\bAnniversa?r?y\b/gi, 'Aniversário'], [/\bCentenary\b/gi, 'Centenário'], [/\bChampion\b/gi, 'Campeão'], [/\bJersey\b/gi, ''], [/\bS[r]?ipe\b/gi, 'Listrada'], [/\bStripe\b/gi, 'Listrada'],
  [/\bSpecial\b/gi, 'Especial'], [/\bEdição Especial\s+Especial\b/gi, 'Edição Especial'],
  [/\bInter Milan\b/g, 'Inter de Milão'], [/\bBayern Munich\b/g, 'Bayern de Munique'], [/\bAtletico Madrid\b/g, 'Atlético de Madrid'], [/\bBrazil\b/g, 'Brasil'], [/\bSpain\b/g, 'Espanha'], [/\bGermany\b/g, 'Alemanha'],
  [/\bFrance\b/g, 'França'], [/\bEngland\b/g, 'Inglaterra'], [/\bItaly\b/g, 'Itália'], [/\bNetherlands\b/g, 'Holanda'], [/\bJapan\b/g, 'Japão'], [/\bMorocco\b/g, 'Marrocos'], [/\bSwitzerland\b/g, 'Suíça'], [/\bCroatia\b/g, 'Croácia'],
];
const NO_PREFIX = /^(camisa|conjunto|jaqueta|kit|corta|short|regata|calça|calca|moletom|casaco|bermuda|agasalho)\b/i;
function translate(name) {
  let n = String(name).replace(/\s+/g, ' ').trim();
  for (const [re, to] of MAP) n = n.replace(re, to);
  n = n.replace(/\bAll\s+Preta\b/g, 'Toda Preta').replace(/\bAll\s+Branca\b/g, 'Toda Branca').replace(/\b(Manga Longa)(\s+Manga Longa)+/g, '$1').replace(/\bPreta\s+Azul\s+Branca\b/g, 'Preta, Azul e Branca').replace(/\s+/g, ' ');
  if (/\bRegata\b/.test(n) && !/^regata/i.test(n)) n = 'Regata ' + n.replace(/\bRegata\s*/, '');
  const JK = /^(.*?)\s*\b(Corta-Vento|Jaqueta de Treino|Jaqueta)\b\s*(.*)$/;
  const jk = n.replace(/^Camisa\s+/i, '').match(JK);
  if (jk) n = (jk[2] + ' ' + jk[1] + ' ' + jk[3]).replace(/\s+/g, ' ').trim();
  if (!NO_PREFIX.test(n)) n = 'Camisa ' + n;
  return n.replace(/\s+/g, ' ').trim();
}

module.exports = { translate };
if (require.main === module) (async () => {
  await init();
  const rows = await q.all('SELECT p.id,p.name,p.tags,p.search_text FROM products p');
  const ops = []; let changed = 0; const sample = [];
  for (const r of rows) {
    const nn = translate(r.name);
    if (nn === r.name) continue;
    changed++; if (sample.length < 14) sample.push(`${r.name}  →  ${nn}`);
    const team = (await Promise.resolve(null)); void team;
    ops.push({ sql: 'UPDATE products SET name=?, description=REPLACE(description, ?, ?), search_text=? WHERE id=?', args: [nn, r.name, nn, norm(nn + ' ' + r.name + ' ' + (r.search_text || '')), r.id] });
  }
  console.log(`${changed}/${rows.length} nomes alterados`); console.log(sample.join('\n'));
  if (process.argv.includes('--dry')) return process.exit(0);
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  console.log('gravado.'); process.exit(0);
})();
