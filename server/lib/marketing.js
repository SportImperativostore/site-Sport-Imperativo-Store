/* E-mail marketing: contatos que aceitaram (LGPD), campanhas criadas no admin, fila enviada em lotes pela tarefa agendada.
 * Só envia para quem tem opted_in_at e não saiu (unsub_at) nem está em email_optout. Respeita limite diário (MARKETING_DAILY_LIMIT, padrão 80). */
const { q } = require('../db');
const cat = require('./catalog');
const mail = require('./mailer');
const { token, validEmail, brl } = require('./util');

const BATCH = 40, DAILY = () => Math.max(1, parseInt(process.env.MARKETING_DAILY_LIMIT || '80', 10));
const lower = (e) => String(e || '').toLowerCase().trim();

/* ---------- contatos ---------- */
async function optIn({ email, name, source }) {
  const e = lower(email); if (!validEmail(e)) return { skipped: true };
  const c = await q.get('SELECT email FROM marketing_contacts WHERE email=?', e);
  if (c) await q.run("UPDATE marketing_contacts SET opted_in_at=COALESCE(opted_in_at, datetime('now')), unsub_at=NULL, name=COALESCE(NULLIF(?, ''), name), source=COALESCE(source, ?) WHERE email=?", String(name || '').slice(0, 100), source || 'site', e);
  else await q.run("INSERT INTO marketing_contacts(email,name,source,token,opted_in_at) VALUES(?,?,?,?,datetime('now'))", e, String(name || '').slice(0, 100), source || 'site', token(18));
  await q.run('DELETE FROM email_optout WHERE email=?', e);       // quem aceita de novo volta a poder receber
  return { ok: true };
}
async function unsubscribeByToken(tk) {
  const c = await q.get('SELECT email FROM marketing_contacts WHERE token=?', String(tk || '')); if (!c) return false;
  await q.run("UPDATE marketing_contacts SET unsub_at=datetime('now') WHERE email=?", c.email);
  await q.run('INSERT OR IGNORE INTO email_optout(email) VALUES(?)', c.email);
  await q.run("UPDATE mkt_queue SET status='skipped' WHERE email=? AND status='queued'", c.email);
  return true;
}
async function confirmByToken(tk) {            // link do convite: o cliente confirma que quer receber ofertas
  const c = await q.get('SELECT email,name FROM marketing_contacts WHERE token=?', String(tk || '')); if (!c) return false;
  return !!(await optIn({ email: c.email, name: c.name, source: 'convite' })).ok;
}

/* ---------- público ---------- */
const OK_WHERE = "c.opted_in_at IS NOT NULL AND c.unsub_at IS NULL AND NOT EXISTS (SELECT 1 FROM email_optout o WHERE o.email=c.email)";
const BUYER = "EXISTS (SELECT 1 FROM orders od WHERE json_extract(od.customer,'$.email')=c.email AND od.status NOT IN ('cancelled','payment_pending','received'))";
async function audienceRows(audience) {
  if (audience === 'buyers') return q.all(`SELECT c.email,c.name,c.token FROM marketing_contacts c WHERE ${OK_WHERE} AND ${BUYER}`);
  if (audience === 'nonbuyers') return q.all(`SELECT c.email,c.name,c.token FROM marketing_contacts c WHERE ${OK_WHERE} AND NOT ${BUYER}`);
  if (audience === 'invite') return inviteCandidates();
  return q.all(`SELECT c.email,c.name,c.token FROM marketing_contacts c WHERE ${OK_WHERE}`);
}
/** Clientes já cadastrados/compradores que ainda não estão na lista: recebem UM convite para aceitar ofertas. */
async function inviteCandidates() {
  const rows = await q.all(`SELECT lower(email) email, name FROM users WHERE deleted_at IS NULL AND email NOT LIKE 'removido-%'
    UNION SELECT lower(json_extract(customer,'$.email')) email, json_extract(customer,'$.name') name FROM orders WHERE json_extract(customer,'$.email') IS NOT NULL`);
  const known = new Set((await q.all('SELECT email FROM marketing_contacts')).map((r) => r.email));
  const out = new Set(); const res = [];
  for (const r of rows) { if (!r.email || known.has(r.email) || out.has(r.email) || !validEmail(r.email)) continue; out.add(r.email); res.push(r); }
  return res;
}
async function overview() {
  const c = async (w) => (await q.get(`SELECT COUNT(*) n FROM marketing_contacts c WHERE ${w}`)).n;
  const sentToday = (await q.get("SELECT COUNT(*) n FROM mkt_queue WHERE status='sent' AND date(sent_at)=date('now')")).n;
  return { opted: await c(OK_WHERE), buyers: await c(`${OK_WHERE} AND ${BUYER}`), unsub: await c('c.unsub_at IS NOT NULL'), invite: (await inviteCandidates()).length, dailyLimit: DAILY(), sentToday };
}

/* ---------- e-mail ---------- */
const p = (txt) => String(txt || '').split(/\n{2,}/).map((x) => `<p style="margin:0 0 12px">${mail.esc(x).replace(/\n/g, '<br>')}</p>`).join('');
const slugOf = (s) => { const m = String(s || '').match(/\/produto\/([a-z0-9-]+)/i); return m ? m[1] : /^[a-z0-9-]{6,}$/i.test(String(s || '').trim()) ? String(s).trim() : null; };
async function render(params, ct, kind = 'campanha') {
  const base = mail.base(); const abs = (u) => (/^https?:/.test(u || '') ? u : base + (u && u.startsWith('/') ? u : '/' + (u || '')));
  const slugs = String(params.products || '').split(/\s+/).map(slugOf).filter(Boolean).slice(0, 8);
  let prods = [];
  if (slugs.length) { const rows = await q.all(`SELECT * FROM products WHERE active=1 AND slug IN (${slugs.map(() => '?').join(',')})`, ...slugs); prods = await cat.cards(rows); }
  const cards = prods.map((c) => `<td style="width:50%;padding:6px;vertical-align:top"><a href="${mail.esc(base + '/produto/' + c.slug)}" style="text-decoration:none;color:#0d1b33"><img src="${mail.esc(abs(c.image))}" width="100%" style="border-radius:10px;display:block;object-fit:cover;max-height:260px" alt=""><div style="font-weight:700;margin-top:6px;font-size:14px">${mail.esc(c.name)}</div><div style="color:#0b5cff;font-weight:800">${mail.esc(brl((c.pricing && c.pricing.final) || 0))}</div></a></td>`);
  const grid = cards.length ? `<table style="width:100%;border-collapse:collapse;margin:8px 0">${cards.reduce((a, c, i) => (i % 2 ? (a[a.length - 1] += c + '</tr>') : a.push('<tr>' + c), a), []).map((r) => (r.endsWith('</tr>') ? r : r + '</tr>')).join('')}</table>` : '';
  const link = params.button_link ? (/^https?:/.test(params.button_link) ? params.button_link : abs(params.button_link)) : base;
  const unsub = kind === 'convite' ? '' : `<p style="color:#8a97ad;font-size:12px;margin-top:18px">Você recebe este e-mail porque aceitou receber ofertas da Sport Imperativo Store. <a href="${mail.esc(base + '/api/email/unsubscribe?m=' + ct)}" style="color:#8a97ad">Cancelar inscrição</a>.</p>`;
  const coupon = params.coupon ? `<div style="border:2px dashed #0b5cff;border-radius:12px;padding:12px;text-align:center;margin:14px 0"><div style="font-size:12px;color:#5b6b85">Use o cupom</div><div style="font-size:22px;font-weight:900;color:#0b5cff;letter-spacing:1px">${mail.esc(String(params.coupon).toUpperCase())}</div></div>` : '';
  const html = mail.layout(`${params.banner ? `<img src="${mail.esc(abs(params.banner))}" width="100%" style="border-radius:12px;display:block;margin-bottom:16px" alt="">` : ''}
    ${params.title ? `<h2 style="margin:0 0 10px">${mail.esc(params.title)}</h2>` : ''}${p(params.body)}${coupon}${grid}${params.button_text ? mail.button(link, params.button_text) : ''}${unsub}`);
  return html;
}
const headersFor = (ct) => (ct ? { 'List-Unsubscribe': `<${mail.base()}/api/email/unsubscribe?m=${ct}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined);

/* ---------- campanhas ---------- */
const parseP = (c) => { try { return JSON.parse(c.params || '{}'); } catch { return {}; } };
async function sendTest(params, subject, to) { return mail.sendMail({ orderId: null, to, subject: '[TESTE] ' + subject, html: await render(params, 'teste') }); }
async function start(id) {
  const c = await q.get('SELECT * FROM mkt_campaigns WHERE id=?', id); if (!c || c.status !== 'draft') return { error: 'Campanha não está em rascunho.' };
  const rows = await audienceRows(c.audience);
  if (c.audience === 'invite') for (const r of rows) await q.run('INSERT OR IGNORE INTO marketing_contacts(email,name,source,token,invited_at) VALUES(?,?,?,?,datetime(\'now\'))', r.email, String(r.name || '').slice(0, 100), 'convite', token(18));
  const list = c.audience === 'invite' ? await q.all("SELECT email,name,token FROM marketing_contacts WHERE source='convite' AND opted_in_at IS NULL AND unsub_at IS NULL AND invited_at >= datetime('now','-1 minutes')") : rows;
  for (const r of list) await q.run('INSERT OR IGNORE INTO mkt_queue(campaign_id,email,name,token) VALUES(?,?,?,?)', id, r.email, r.name || null, r.token);
  const total = (await q.get('SELECT COUNT(*) n FROM mkt_queue WHERE campaign_id=?', id)).n;
  await q.run("UPDATE mkt_campaigns SET status=?, total=?, started_at=datetime('now') WHERE id=?", total ? 'sending' : 'done', total, id);
  return { total };
}
async function cancel(id) { await q.run("UPDATE mkt_queue SET status='skipped' WHERE campaign_id=? AND status='queued'", id); await q.run("UPDATE mkt_campaigns SET status='cancelled', finished_at=datetime('now') WHERE id=? AND status IN ('sending','draft')", id); }

/** Chamado pela tarefa agendada: envia um lote respeitando o limite diário. */
async function processQueue() {
  if (process.env.MARKETING_ENABLED !== 'on') return { enabled: false };
  const sentToday = (await q.get("SELECT COUNT(*) n FROM mkt_queue WHERE status='sent' AND date(sent_at)=date('now')")).n;
  let room = Math.min(BATCH, DAILY() - sentToday); const out = { enabled: true, sent: 0, failed: 0, room };
  if (room <= 0) return out;
  const camps = await q.all("SELECT * FROM mkt_campaigns WHERE status='sending' ORDER BY id");
  for (const c of camps) {
    if (room <= 0) break;
    const params = parseP(c); const rows = await q.all("SELECT * FROM mkt_queue WHERE campaign_id=? AND status='queued' ORDER BY id LIMIT ?", c.id, room);
    for (const r of rows) {
      const ok = await q.get('SELECT 1 x FROM marketing_contacts c WHERE c.email=? AND (c.unsub_at IS NULL) AND NOT EXISTS (SELECT 1 FROM email_optout o WHERE o.email=c.email)', r.email);
      if (!ok) { await q.run("UPDATE mkt_queue SET status='skipped' WHERE id=?", r.id); continue; }
      try {
        const html = await render(params, r.token, c.audience === 'invite' ? 'convite' : 'campanha');
        const res = await mail.sendMail({ orderId: null, to: r.email, subject: c.subject, html, headers: c.audience === 'invite' ? undefined : headersFor(r.token) });
        if (res.sent) { await q.run("UPDATE mkt_queue SET status='sent', sent_at=datetime('now') WHERE id=?", r.id); await q.run('UPDATE mkt_campaigns SET sent=sent+1 WHERE id=?', c.id); out.sent++; room--; }
        else { await q.run("UPDATE mkt_queue SET status='failed', error=? WHERE id=?", res.queued ? 'e-mail não configurado' : 'falha no envio', r.id); await q.run('UPDATE mkt_campaigns SET failed=failed+1 WHERE id=?', c.id); out.failed++; }
      } catch (e) { await q.run("UPDATE mkt_queue SET status='failed', error=? WHERE id=?", String(e.message).slice(0, 200), r.id); out.failed++; }
    }
    const left = (await q.get("SELECT COUNT(*) n FROM mkt_queue WHERE campaign_id=? AND status='queued'", c.id)).n;
    if (!left) await q.run("UPDATE mkt_campaigns SET status='done', finished_at=datetime('now') WHERE id=?", c.id);
  }
  return out;
}
module.exports = { optIn, unsubscribeByToken, confirmByToken, overview, audienceRows, render, sendTest, start, cancel, processQueue, parseP, DAILY };
