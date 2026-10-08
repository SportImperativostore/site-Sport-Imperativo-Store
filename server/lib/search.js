/* Busca tolerante: sem acentos, parcial, sinônimos/apelidos (clubes, jogadores, termos de camisa) e correção de erros de digitação.
 * parse(q) devolve, para cada palavra da busca, as alternativas aceitas (OU); a busca exige todas as palavras (E). */
const { q } = require('../db');
const { norm } = require('./util');

// apelido → termos reais que existem nos produtos. Cada valor é uma lista de alternativas; cada alternativa é uma lista de palavras (E).
const A = (list, ...alts) => list.forEach((k) => (ALIASES[norm(k)] = alts.map((a) => norm(a).split(' '))));
const ALIASES = {};
// clubes
A(['manutd', 'man utd', 'mufc', 'man united', 'manchester u', 'red devils', 'diabos vermelhos'], 'manchester united');
A(['mancity', 'man city', 'mcfc', 'city'], 'manchester city');
A(['barca', 'barça', 'fcb', 'blaugrana'], 'barcelona');
A(['realmadrid', 'real', 'merengue', 'los blancos', 'rm'], 'real madrid');
A(['psg', 'paris', 'paris sg', 'parisien'], 'paris saint germain', 'psg');
A(['juve', 'vecchia signora'], 'juventus');
A(['inter', 'inter milan', 'internazionale', 'inter de milao'], 'inter de milao', 'inter milan', 'internazionale');
A(['acmilan', 'ac milan'], 'milan');
A(['atletico', 'atleti', 'atletico de madrid', 'atm'], 'atletico de madrid', 'atletico madrid');
A(['bayern', 'bayern munique', 'bayern munich'], 'bayern');
A(['dortmund', 'bvb', 'borussia'], 'borussia dortmund', 'dortmund');
A(['spurs', 'tottenham', 'totenham'], 'tottenham');
A(['gunners', 'arsenal'], 'arsenal');
A(['reds', 'liverpool'], 'liverpool');
A(['blues'], 'chelsea');
A(['fla', 'mengao', 'mengo', 'rubro negro'], 'flamengo');
A(['timao', 'coringao', 'corinthians'], 'corinthians');
A(['verdao', 'palmeiras', 'porco'], 'palmeiras');
A(['spfc', 'tricolor paulista', 'sp', 'soberano'], 'sao paulo');
A(['peixe', 'santos fc'], 'santos');
A(['fogao', 'glorioso'], 'botafogo');
A(['flu', 'tricolor carioca', 'fluminense'], 'fluminense');
A(['gremio', 'imortal', 'tricolor gaucho'], 'gremio');
A(['colorado', 'inter rs', 'inter de porto alegre'], 'internacional');
A(['galo', 'atletico mg', 'atletico mineiro'], 'atletico mineiro');
A(['raposa', 'cruzeiro'], 'cruzeiro');
A(['gigante da colina', 'vasco da gama'], 'vasco');
A(['leao', 'sport recife'], 'sport');
A(['nautico', 'timbu'], 'nautico');
A(['selecao', 'selecao brasileira', 'canarinho', 'cbf', 'brazil'], 'brasil');
A(['albiceleste', 'argentina'], 'argentina');
A(['lusitano', 'portugal'], 'portugal');
A(['franca', 'france', 'bleus'], 'franca', 'france');
A(['alemanha', 'germany', 'deutschland'], 'alemanha', 'germany');
A(['espanha', 'spain', 'la roja'], 'espanha', 'spain');
A(['inglaterra', 'england', 'three lions'], 'inglaterra', 'england');
A(['holanda', 'netherlands', 'laranja mecanica'], 'holanda', 'netherlands');
A(['italia', 'italy', 'azzurra', 'squadra azzurra'], 'italia', 'italy');
A(['eua', 'usa', 'estados unidos'], 'eua', 'usa');
A(['alnassr', 'al nassr', 'nassr'], 'al nassr');
A(['alhilal', 'al hilal', 'hilal'], 'al hilal');
A(['intermiami', 'inter miami', 'miami cf'], 'inter miami');
// jogadores → times/seleções onde são vendidos
A(['cr7', 'cristiano', 'ronaldo', 'cristiano ronaldo', 'siu'], 'portugal', 'al nassr', 'cristiano ronaldo');
A(['messi', 'lionel messi', 'leo messi'], 'argentina', 'inter miami', 'messi', 'barcelona');
A(['neymar', 'neymar jr', 'ney', 'njr'], 'brasil', 'santos', 'al hilal', 'neymar');
A(['mbappe', 'mbape', 'kylian'], 'real madrid', 'franca', 'france', 'mbappe');
A(['vini', 'vinicius', 'vini jr', 'vinicius jr'], 'real madrid', 'brasil', 'vinicius');
A(['haaland', 'erling'], 'manchester city', 'noruega', 'haaland');
A(['ronaldinho', 'r10', 'gaucho'], 'barcelona', 'brasil', 'ronaldinho');
A(['kaka'], 'milan', 'brasil', 'kaka');
A(['pele', 'rei pele'], 'santos', 'brasil', 'pele');
A(['zidane', 'zizou'], 'real madrid', 'franca', 'france', 'zidane');
A(['maradona', 'diego'], 'argentina', 'napoli', 'boca juniors', 'maradona');
A(['gabigol', 'gabi'], 'flamengo', 'gabigol');
A(['bellingham', 'jude'], 'real madrid', 'inglaterra', 'england', 'bellingham');
A(['yamal', 'lamine'], 'barcelona', 'espanha', 'spain', 'yamal');
A(['salah'], 'liverpool', 'egito', 'salah');
// NBA
A(['lebron', 'king james', 'lebron james', 'james'], 'lakers', 'cavaliers', 'miami heat', 'lebron');
A(['kobe', 'black mamba', 'bryant', 'mamba'], 'lakers', 'kobe');
A(['curry', 'stephen curry', 'steph'], 'warriors', 'curry');
A(['jordan', 'mj', 'air jordan', 'michael jordan'], 'bulls', 'jordan');
A(['durant', 'kd'], 'suns', 'warriors', 'durant');
A(['giannis', 'greek freak'], 'bucks', 'giannis');
A(['wemby', 'wembanyama'], 'spurs', 'wembanyama');
A(['jokic'], 'nuggets', 'jokic');
A(['luka', 'doncic'], 'mavericks', 'lakers', 'doncic');
A(['iverson', 'ai'], 'sixers', '76ers', 'iverson');
A(['sixers', '76ers'], 'philadelphia 76ers', '76ers');
A(['celtics', 'boston'], 'celtics');
A(['lakers'], 'lakers');
A(['warriors', 'gsw'], 'warriors');
A(['knicks'], 'knicks');
// NFL
A(['chiefs', 'kc', 'kansas'], 'kansas city chiefs', 'chiefs');
A(['cowboys', 'dallas'], 'dallas cowboys', 'cowboys');
A(['patriots', 'pats'], 'patriots');
A(['brady', 'tom brady'], 'patriots', 'buccaneers', 'brady');
A(['mahomes', 'patrick mahomes'], 'kansas city chiefs', 'mahomes');
A(['nfl', 'futebol americano'], 'nfl');
// F1
A(['f1', 'formula 1', 'formula um', 'formula1'], 'f1', 'formula 1');
A(['verstappen', 'max', 'redbull', 'red bull'], 'red bull', 'verstappen');
A(['hamilton', 'lewis'], 'ferrari', 'mercedes', 'hamilton');
A(['senna', 'ayrton'], 'senna', 'mclaren');
A(['ferrari', 'scuderia'], 'ferrari');
// termos de camisa
A(['titular', 'principal', 'home', 'casa', 'camisa 1'], 'titular', 'home');
A(['reserva', 'away', 'visitante', 'fora', 'camisa 2'], 'reserva', 'away');
A(['terceira', 'third', 'terceiro', 'camisa 3'], 'terceira', 'third');
A(['retro', 'retrô', 'antiga', 'antigas', 'classica', 'historica', 'vintage'], 'retro');
A(['jogador', 'player', 'versao jogador', 'authentic', 'autentica'], 'jogador', 'player');
A(['torcedor', 'fan', 'versao torcedor'], 'torcedor', 'fan');
A(['feminina', 'feminino', 'mulher', 'women', 'woman'], 'feminina');
A(['infantil', 'crianca', 'kids', 'kid', 'juvenil', 'menino'], 'infantil', 'kids');
A(['manga longa', 'mangalonga', 'long sleeve', 'long sleeves', 'ml'], 'manga longa', 'long');
A(['agasalho', 'moletom', 'jaqueta', 'casaco', 'corta vento', 'jacket', 'hoodie'], 'agasalho', 'jaqueta', 'jacket', 'hoodie', 'corta vento');
A(['conjunto', 'kit', 'uniforme'], 'conjunto', 'kit');
A(['short', 'shorts', 'calcao', 'calcoes', 'bermuda'], 'short', 'shorts', 'calcao');
A(['chuteira', 'chuteiras', 'tenis de futebol', 'botas', 'boots', 'cleats'], 'chuteira');
A(['camiseta', 'camisetas', 'camisas', 'jersey', 'jerseys', 'blusa'], 'camisa');
A(['regata', 'tank'], 'regata', 'camisa nba');
A(['society', 'grama sintetica', 'tf'], 'society', 'tf');
A(['futsal', 'quadra', 'salao', 'ic'], 'futsal', 'ic');
A(['campo', 'grama', 'fg'], 'campo', 'fg');

let vocab = null, vocabAt = 0, vocabP = null;
async function loadVocab() {
  if (vocab && Date.now() - vocabAt < 5 * 60 * 1000) return vocab;
  vocabP ||= (async () => {
    const rows = await q.all('SELECT search_text FROM products WHERE active=1');
    const freq = new Map();
    for (const r of rows) for (const w of new Set(String(r.search_text || '').split(/[^a-z0-9]+/))) if (w.length >= 3) freq.set(w, (freq.get(w) || 0) + 1);
    vocab = [...freq.entries()]; vocabAt = Date.now(); vocabP = null; return vocab;
  })();
  return vocabP;
}
function dl(a, b, max) { // Damerau-Levenshtein com corte
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
function correct(t, words) {
  if (t.length < 4) return [];
  if (words.some(([w]) => w.includes(t))) return []; // já aparece (parcial)
  const max = t.length <= 5 ? 1 : 2;
  let best = [], bd = max + 1;
  for (const [w, n] of words) {
    if (w.length < 3) continue;
    // compara com o início da palavra também (ex.: "mancheste" ≈ "manchester")
    const d = Math.min(dl(t, w, max), w.length > t.length ? dl(t, w.slice(0, t.length), max) : max + 1);
    if (d < bd) { bd = d; best = [[w, n]]; } else if (d === bd && d <= max) best.push([w, n]);
  }
  return bd <= max ? best.sort((x, y) => y[1] - x[1]).slice(0, 3).map(([w]) => w) : [];
}

/** → [{ alts: [[palavra,...], ...] }, ...]  (cada item = uma palavra da busca; alts = alternativas, cada uma uma lista de palavras exigidas) */
async function parse(raw) {
  const toks = norm(String(raw || '')).split(/[^a-z0-9]+/).filter(Boolean);
  if (!toks.length) return [];
  const words = await loadVocab();
  const out = [];
  for (let i = 0; i < toks.length; i++) {
    const two = toks[i + 1] && ALIASES[toks[i] + ' ' + toks[i + 1]];
    if (two) { out.push({ alts: [[toks[i], toks[i + 1]], ...two] }); i++; continue; }
    const t = toks[i];
    const alts = [[t]];
    if (ALIASES[t]) alts.push(...ALIASES[t]);
    for (const c of correct(t, words)) alts.push([c]);
    out.push({ alts });
  }
  return out;
}
const likeEsc = (s) => s.replace(/[%_]/g, '');
/** Gera o trecho SQL (E de OU) sobre p.search_text. */
function toSql(parsed) {
  const where = [], args = [];
  for (const { alts } of parsed) {
    const parts = alts.map((words) => { words.forEach((w) => args.push('%' + likeEsc(w) + '%')); return '(' + words.map(() => 'p.search_text LIKE ?').join(' AND ') + ')'; });
    where.push('(' + parts.join(' OR ') + ')');
  }
  return { where, args };
}
module.exports = { parse, toSql, correct, ALIASES, loadVocab };

/** Estrelas: se o produto é de um time ligado ao jogador, devolve os termos para buscar outras camisas dele. */
const STARS = ['cr7', 'messi', 'neymar', 'mbappe', 'vini', 'haaland', 'ronaldinho', 'lebron', 'kobe', 'curry', 'jordan', 'brady', 'mahomes'];
function starTerms(searchText) {
  const t = String(searchText || '');
  const out = [];
  for (const k of STARS) {
    const alts = ALIASES[k]; if (!alts) continue;
    const teamAlts = alts.filter((a) => a.length === 1 || a.join(' ') !== k).map((a) => a.join(' '));
    const has = (a) => a.split(' ').every((w) => t.includes(w));
    if (teamAlts.some(has)) out.push(...teamAlts.filter((a) => !has(a)));
  }
  return [...new Set(out)];
}
module.exports.starTerms = starTerms;
