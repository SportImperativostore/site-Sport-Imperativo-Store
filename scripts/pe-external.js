/* Fontes externas da aba Pronta Entrega: MIC Camisas de Time (Shopify) e iFutz (WooCommerce).
 * Lê só o que cada loja publica (produtos e tamanhos DISPONÍVEIS; esgotado é ignorado), identifica o modelo pelo título
 * (time + temporada + camisa I/II/III + jogador/retrô/manga longa) e usa as FOTOS DO NOSSO CATÁLOGO (Yupoo) do modelo correspondente.
 * Sem correspondência segura no catálogo => vai para revisão (nunca usa foto de outro site). */
const { norm } = require('../server/lib/util');
const H = { 'User-Agent': 'Mozilla/5.0' };
const SZ = { PP: 'PP', P: 'P', M: 'M', G: 'G', GG: 'GG', XG: 'XGG', XGG: 'XGG', '2GG': '2XG', '3GG': '3XG', '4GG': '4XG', '5GG': '5XG', '2XG': '2XG', '3XG': '3XG', '4XG': '4XG', '5XG': '5XG', '2XL': '2XG', '3XL': '3XG', '4XL': '4XG', '5XL': '5XG' };
const sizeOf = (t) => SZ[String(t).toUpperCase().replace(/\s+/g, '').replace(/^TAMANHO:?/, '')] || null;

async function jget(url) { for (let i = 0; i < 3; i++) { try { const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(r.status); return { json: await r.json(), headers: r.headers }; } catch (e) { if (i === 2) throw e; await new Promise((r) => setTimeout(r, 1500)); } } }

/* ---------- MIC (Shopify: /products.json com disponibilidade por tamanho) ---------- */
async function fetchMic() {
  const out = [];
  for (let p = 1; p <= 20; p++) {
    const { json } = await jget('https://miccamisasdetime.com.br/products.json?limit=250&page=' + p);
    if (!json.products.length) break;
    for (const x of json.products) {
      const sizes = x.variants.filter((v) => v.available).map((v) => sizeOf(v.title)).filter(Boolean);
      out.push({ key: 'mic:' + x.handle, source: 'mic', title: x.title, sizes: [...new Set(sizes)], url: 'https://miccamisasdetime.com.br/products/' + x.handle });
    }
  }
  return out;
}
/* ---------- iFutz (WooCommerce Store API; disponibilidade por variação) ---------- */
async function fetchIfutz() {
  const prods = [];
  for (let p = 1; p <= 10; p++) { const { json } = await jget('https://ifutz.com.br/wp-json/wc/store/v1/products?per_page=100&page=' + p); if (!json.length) break; prods.push(...json); if (json.length < 100) break; }
  const out = [];
  for (const x of prods) {
    let sizes = [];
    if (x.is_in_stock) {
      const { json } = await jget('https://ifutz.com.br/wp-json/wc/store/v1/products?type=variation&parent=' + x.id + '&per_page=50');
      sizes = [...new Set(json.filter((v) => v.is_in_stock).map((v) => sizeOf(String(v.variation || '').replace(/^.*:\s*/, ''))).filter(Boolean))];
    }
    out.push({ key: 'ifutz:' + x.id, source: 'ifutz', title: x.name, sizes, url: x.permalink });
  }
  return out;
}

/* ---------- título -> modelo ---------- */
const COLORS = /\b(Preta|Preto|Branca|Branco|Azul|Vermelha|Vermelho|Verde|Amarela|Amarelo|Laranja|Listrada|Listrado|Tricolor|Dourada|Sol|Pampa|Rosa|Roxa|Roxo|Cinza|Bege|Marrom|Vinho|Escuro|Escura|Claro|Clara|Royal|Marinho|Off|White|Cor)\b/gi;
const ALIAS = { corinthiana: 'corinthians', 'atletico de madri': 'atletico de madrid', 'atletico mg': 'atletico mineiro', 'inter milao': 'inter de milao', 'man united': 'manchester united', 'man city': 'manchester city' };
const KIT = { I: 'Home', II: 'Away', III: 'Third', LII: 'Third' };
function parseTitle(t) {
  const s = String(t).replace(/\s+/g, ' ').trim();
  const bad = /(Kit |Regata|Cal[cç][aã]o|Infantil|Feminin|Treino|Pr[eé]-?Jogo|Baseball|Goleiro|Especial|Manchas|levemente|Patch|Patroc|Short|Moletom|Pol[oa])/i.exec(s);
  if (bad) return { exclude: 'tipo fora do escopo (' + bad[1].trim() + ')' };
  const flags = { ml: /Manga Longa/i.test(s), player: /\bJogador\b/i.test(s), retro: /\bRetr[oô]\b/i.test(s) };
  let season = null;
  const m1 = /(\d{2,4})\s*\/\s*(\d{2,4})/.exec(s), m2 = /\b(19\d{2}|20\d{2})\b/.exec(s);
  if (m1) { const a = m1[1].length === 2 ? '20' + m1[1] : m1[1]; season = a + '/' + m1[2].slice(-2); } else if (m2) season = m2[1];
  const kit = (/\b(III|II|I|lII)\b/.exec(s) || [])[1];
  let team = s.replace(/\b(Camisa|Jogador|Retr[oô]|Torcedor|Masculina|Manga|Longa|Cor \d)\b/gi, ' ').replace(/(\d{2,4})\s*\/\s*(\d{2,4})/g, ' ').replace(/\b(19\d{2}|20\d{2})\b/g, ' ').replace(/\b(III|II|I|lII)\b/g, ' ').replace(COLORS, ' ').replace(/[-–\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  const nt = norm(team); team = ALIAS[nt] || nt;
  return { team, season, kit: kit ? KIT[kit.toUpperCase()] : '', ...flags, base: flags.retro ? 'retro' : flags.player ? 'jogador' : 'torcedor' };
}

/* ---------- índice do catálogo Yupoo ---------- */
async function buildIndex(q) {
  const rows = await q.all("SELECT p.id,p.name,(SELECT group_concat(url,'|') FROM (SELECT url FROM product_images i WHERE i.product_id=p.id AND kind='image' ORDER BY sort,id LIMIT 3)) imgs FROM products p WHERE p.active=1 AND p.fulfillment='import' AND p.name LIKE 'Camisa %'");
  const idx = new Map();
  for (const r of rows) {
    const m = /^Camisa (.+?) (\d{4}(?:\/\d{2,4})?)(?: (Home|Away|Third|Fourth))?(.*)$/.exec(r.name); if (!m) continue;
    let rest = m[4] || '';
    const f = { player: /Player Version/.test(rest), ml: /Manga Longa/.test(rest), retro: /Retro/.test(rest) };
    rest = rest.replace(/Player Version|Manga Longa|Retro|\(\d+\)/g, '').trim();
    if (rest) continue;                                   // Goleiro, Feminina, Classic, cores... não servem de base
    const season = m[2].includes('/') ? m[2].split('/')[0] + '/' + m[2].split('/')[1].slice(-2) : m[2];
    const key = [norm(m[1]), season, m[3] || '', f.player ? 'j' : '', f.ml ? 'ml' : '', f.retro ? 'r' : ''].join('|');
    if (!idx.has(key)) idx.set(key, { id: r.id, name: r.name, imgs: (r.imgs || '').split('|').filter(Boolean) });
  }
  return idx;
}
/** Acha o modelo do catálogo: retorna {prod} ou {note}. Retrô sem camisa I/II/III só casa se houver UM candidato. */
function match(idx, p) {
  if (p.exclude) return { note: p.exclude };
  if (!p.team || !p.season) return { note: 'título sem time ou temporada identificáveis' };
  const mk = (kit) => [p.team, p.season, kit, p.player ? 'j' : '', p.ml ? 'ml' : '', p.retro ? 'r' : ''].join('|');
  if (p.kit) { const h = idx.get(mk(p.kit)); return h ? { prod: h } : { note: `sem foto correspondente no catálogo Yupoo (${p.team} ${p.season} ${p.kit})` }; }
  const cands = [...idx.entries()].filter(([k]) => { const [t, s, , j, ml, r] = k.split('|'); return t === p.team && s === p.season && j === (p.player ? 'j' : '') && ml === (p.ml ? 'ml' : '') && r === (p.retro ? 'r' : ''); });
  if (cands.length === 1) return { prod: cands[0][1] };
  return { note: cands.length ? 'modelo ambíguo (mais de uma camisa do catálogo serve)' : `sem foto correspondente no catálogo Yupoo (${p.team} ${p.season})` };
}

module.exports = { fetchMic, fetchIfutz, parseTitle, buildIndex, match };
