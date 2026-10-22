/* Vigia o catálogo do fornecedor (Yupoo): lista os álbuns mais recentes e avisa no celular (ntfy) os que ainda não estão na loja.
 * Não altera a loja. Uso (agendado todo dia): node --env-file=.env scripts/yupoo-watch.js [--baseline]
 *   --baseline  marca tudo o que existe hoje como "visto" (rode uma vez antes de agendar).
 * Estado em D:\loja\yupoo\watch-state.json; relatório em D:\loja\yupoo\novidades.json. */
const fs = require('fs'), path = require('path');
const { createClient } = require('@libsql/client');

const DIR = process.env.YUPOO_DIR || 'D:\\loja\\yupoo';
const STATE = path.join(DIR, 'watch-state.json'), REPORT = path.join(DIR, 'novidades.json');
const SOURCES = [
  { name: 'minkang', base: 'https://minkang.x.yupoo.com/albums?uid=1' },
  { name: 'classic-fhirts052', base: 'https://classic-football-fhirts052.x.yupoo.com/albums?uid=1' },
  { name: 'xingkong', base: 'https://xingkong-sports.x.yupoo.com/albums?uid=1' },
  { name: 'dachang88', base: 'https://dachang88.x.yupoo.com/albums?uid=1' },
];
const PAGES = 2; // os álbuns novos aparecem primeiro
const H = { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'en' };
const rt = async (f) => { for (let i = 0; i < 4; i++) { try { return await f(); } catch { await new Promise((r) => setTimeout(r, 1500)); } } return ''; };

async function listSource(s) {
  const out = [];
  for (let p = 1; p <= PAGES; p++) {
    const t = await rt(async () => (await fetch(`${s.base}&page=${p}`, { headers: H })).text());
    for (const blk of t.split('class="album__main"').slice(1)) {
      const id = (blk.match(/href="\/albums\/(\d+)/) || [])[1], title = (blk.match(/title="([^"]*)"/) || [])[1];
      if (id) out.push({ id, title: (title || '').replace(/&amp;/g, '&'), src: s.name });
    }
  }
  return out;
}

(async () => {
  const baseline = process.argv.includes('--baseline');
  const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
  const have = new Set((await db.execute("SELECT supplier_sku FROM products WHERE supplier_sku IS NOT NULL AND supplier_sku != ''")).rows.map((r) => String(r.supplier_sku)));
  let seen = new Set(fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : []);
  const all = [];
  for (const s of SOURCES) { try { all.push(...await listSource(s)); } catch (e) { console.log('falha em', s.name, e.message); } }
  if (!all.length) { console.log('nenhum álbum lido (site fora do ar?)'); return; }
  const fresh = all.filter((a) => !have.has(a.id) && !seen.has(a.id));
  if (baseline) { for (const a of all) seen.add(a.id); fs.writeFileSync(STATE, JSON.stringify([...seen])); console.log('baseline:', seen.size, 'álbuns marcados como vistos'); return; }
  console.log('álbuns lidos', all.length, '| novos', fresh.length);
  if (!fresh.length) return;
  const prev = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : [];
  fs.writeFileSync(REPORT, JSON.stringify([...prev, ...fresh.map((a) => ({ ...a, found: new Date().toISOString() }))], null, 1));
  for (const a of fresh) seen.add(a.id);
  fs.writeFileSync(STATE, JSON.stringify([...seen]));
  const lines = fresh.slice(0, 15).map((a) => `• ${a.title}`).join('\n') + (fresh.length > 15 ? `\n… e mais ${fresh.length - 15}` : '');
  if (process.env.NTFY_TOPIC) {
    await fetch(`https://ntfy.sh/${encodeURIComponent(process.env.NTFY_TOPIC)}`, { method: 'POST', headers: { Title: `${fresh.length} novidades no fornecedor (Yupoo)`, Tags: 'package' }, body: lines }).catch(() => {});
  } else console.log('NTFY_TOPIC ausente no .env: sem aviso no celular.\n' + lines);
})();
