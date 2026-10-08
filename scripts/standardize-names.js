/* Padroniza os nomes das camisas: "Camisa {Time} {Temporada} {Home|Away|Third} {Manga Longa} {Retro} {Player Version}".
 * Mantém os slugs (links não mudam). Idempotente. Uso: node --env-file=.env scripts/standardize-names.js [--dry] */
const { client, q, init } = require('../server/db');
const { norm } = require('../server/lib/util');

const KEEP_UP = new Set(['PSG', 'FC', 'CP', 'AS', 'AC', 'SC', 'FA', 'FIFA', 'UEFA', 'USA', 'UANL', 'CD', 'CF', 'RC', 'SSC', 'VFB', 'VFL', 'FK', 'SK', 'BK', 'IF', 'NK', 'HNK', 'RB', 'AEK', 'PAOK', 'UNAM', 'LA', 'DC', 'NY', 'UD', 'SD', 'PSV', 'AZ', 'KRC', 'ES', 'RCD', 'CA', 'CR', 'EC', 'AA', 'GK', 'NBA', 'NFL', 'F1', 'MN', 'II', 'III', 'IV', 'XV', 'XVI', 'USMNT', 'LAFC', 'MLS', 'BSC', 'TSG', 'FSV', 'SV', 'KV', 'KAA', 'OGC', 'ASSE', 'SL', 'CSKA', 'SM', 'ACF', 'FCSB', 'CS', 'AIK', 'IFK', 'GAIS', 'GIF', 'RSC', 'US', 'UC', 'SS', 'SSD', 'TP']);
const SMALL = new Set(['de', 'da', 'do', 'dos', 'das', 'e', 'del', 'la', 'le', 'los', 'of', 'x']);
const cap = (w) => {
  if (/^[#\d]/.test(w)) return w;
  if (KEEP_UP.has(w.toUpperCase()) && (w === w.toUpperCase() || w.length <= 3)) return w.toUpperCase();
  return w.split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p)).join('-');
};
function season(s) {
  let m;
  if ((m = s.match(/^(\d{2})\/(\d{2})$/))) { const a = +m[1]; return (a >= 60 ? '19' : '20') + m[1] + '/' + m[2]; }
  if ((m = s.match(/^(\d{4})\/(\d{2})$/))) return s;
  if ((m = s.match(/^(\d{4})$/))) return s;
  return null;
}
const FIXES = [[/Vermelha Bulls/g, 'Red Bulls'], [/Vermelha Star/g, 'Red Star'], [/Libertard/g, 'Libertad'], [/Atletico Mineiro/g, 'Atlético Mineiro'], [/Atletico Madrid/g, 'Atlético de Madrid'], [/Koln/g, 'Köln']];
function standardize(name) {
  for (const [re, to] of FIXES) name = name.replace(re, to);
  if (!/^Camisa |^Kit Infantil /.test(name)) return name;
  if (/\b(NBA|NFL)\b/.test(name)) return name; // NBA/NFL já seguem padrão próprio
  let toks = name.replace(/^(Camisa|Kit Infantil)\s+/, '').split(/\s+/).filter(Boolean);
  let kit = null, retro = false, player = false, long = false, fem = false, kids = /^Kit Infantil /.test(name), gk = false, ses = null, fan = false;
  const rest = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], n = norm(t);
    const two = norm(toks[i] + ' ' + (toks[i + 1] || ''));
    if (two === 'manga longa') { long = true; i++; continue; }
    if (two === 'player version') { player = true; i++; continue; }
    if (['titular', 'home'].includes(n)) { kit ||= 'Home'; continue; }
    if (['reserva', 'away'].includes(n)) { kit ||= 'Away'; continue; }
    if (['terceira', 'third'].includes(n)) { kit ||= 'Third'; continue; }
    if (n === 'retro') { retro = true; continue; }
    if (n === 'jogador') { player = true; continue; }
    if (n === 'torcedor') { fan = true; continue; }
    if (n === 'infantil') { kids = true; continue; }
    if (n === 'feminina') { fem = true; continue; }
    if (n === 'goleiro' || n === 'gk') { gk = true; continue; }
    const s = season(t); if (s) { ses ||= s; continue; }
    if (/^\d{2}$/.test(t) && i === toks.length - 1 && retro) { ses = (+t >= 60 ? '19' : '20') + t; continue; }
    rest.push(t);
  }
  const team = rest.map((w) => (SMALL.has(w.toLowerCase()) ? w.toLowerCase() : cap(w))).join(' ');
  const parts = [kids ? 'Kit Infantil' : 'Camisa', team, ses, kit, long && 'Manga Longa', fem && 'Feminina', gk && 'Goleiro', retro && 'Retro', player && 'Player Version'].filter(Boolean);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
module.exports = { standardize };

if (require.main === module) (async () => {
  await init();
  const rows = await q.all("SELECT id,name,description,tags FROM products WHERE active=1");
  const ops = []; const sample = []; let n = 0;
  for (const r of rows) {
    const nn = standardize(r.name); if (nn === r.name) continue;
    n++; if (sample.length < 60 && (n % 25 === 0 || n < 5)) sample.push(r.name + '  →  ' + nn);
    ops.push({ sql: "UPDATE products SET name=?, description=REPLACE(description, ?, ?), search_text=? || ' ' || COALESCE(search_text, '') WHERE id=?", args: [nn, r.name, nn, norm(nn), r.id] });
  }
  console.log(`${n} nomes alterados de ${rows.length}`); console.log(sample.join('\n'));
  if (process.argv.includes('--dry')) return process.exit(0);
  for (let i = 0; i < ops.length; i += 250) await client.batch(ops.slice(i, i + 250), 'write');
  console.log('ok'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
