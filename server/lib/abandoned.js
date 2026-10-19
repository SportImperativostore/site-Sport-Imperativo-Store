/* Recuperação de carrinho abandonado: guarda e-mail + itens quando o cliente passa da etapa "Seus dados" do checkout.
 * Depois de ~1 h sem compra, envia UM e-mail de lembrete (só se ABANDONED_CART=on). Respeita descadastro (email_optout). */
const { q } = require('../db');
const cat = require('./catalog');
const mail = require('./mailer');
const { token, validEmail, brl } = require('./util');

const DELAY_MIN = 60, MAX_AGE_H = 48, BATCH = 30;
const clean = (items) => (Array.isArray(items) ? items : []).slice(0, 20).map((i) => ({ productId: +i.productId || 0, size: String(i.size || '').slice(0, 10), qty: Math.max(1, Math.min(20, +i.qty || 1)) })).filter((i) => i.productId);

async function capture({ email, name, items }) {
  const mailTo = String(email || '').toLowerCase().trim();
  const its = clean(items);
  if (!validEmail(mailTo) || !its.length) return { skipped: true };
  if (await q.get('SELECT 1 x FROM email_optout WHERE email=?', mailTo)) return { skipped: true };
  const open = await q.get("SELECT id FROM abandoned_carts WHERE email=? AND recovered=0 AND sent_at IS NULL AND created_at >= datetime('now', ?)", mailTo, `-${MAX_AGE_H} hours`);
  if (open) await q.run("UPDATE abandoned_carts SET items=?, name=?, updated_at=datetime('now') WHERE id=?", JSON.stringify(its), String(name || '').slice(0, 100), open.id);
  else await q.run('INSERT INTO abandoned_carts(email,name,items,token) VALUES(?,?,?,?)', mailTo, String(name || '').slice(0, 100), JSON.stringify(its), token(18));
  return { ok: true };
}
/** Compra concluída com o mesmo e-mail: não manda lembrete. */
const recover = (email) => q.run('UPDATE abandoned_carts SET recovered=1 WHERE email=? AND recovered=0', String(email || '').toLowerCase().trim());

async function render(cartRow, tokenValue) {
  const base = mail.base();
  const items = JSON.parse(cartRow.items || '[]');
  const prods = items.length ? await q.all(`SELECT * FROM products WHERE active=1 AND id IN (${items.map(() => '?').join(',')})`, ...items.map((i) => i.productId)) : [];
  if (!prods.length) return null;
  const cards = await cat.cards(prods); const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  const rows = items.map((i) => byId[i.productId] && { c: byId[i.productId], i }).filter(Boolean);
  if (!rows.length) return null;
  const abs = (u) => (/^https?:/.test(u || '') ? u : base + (u || ''));
  const lines = rows.map(({ c, i }) => `<tr><td style="padding:10px 10px 10px 0;width:72px"><img src="${mail.esc(abs(c.image))}" width="64" height="64" style="border-radius:8px;object-fit:cover" alt=""></td>
    <td style="padding:10px 0"><a href="${mail.esc(base + '/produto/' + c.slug)}" style="color:#0d1b33;text-decoration:none;font-weight:700">${mail.esc(c.name)}</a><br><span style="color:#5b6b85;font-size:13px">${i.size ? 'Tam. ' + mail.esc(i.size) + ' • ' : ''}${i.qty}x • ${mail.esc(brl((c.pricing && c.pricing.final) || c.price || 0))}</span></td></tr>`).join('');
  const first = (cartRow.name || '').trim().split(/\s+/)[0];
  const html = mail.layout(`<h2 style="margin:0 0 8px">${first ? mail.esc(first) + ', v' : 'V'}ocê esqueceu isso no carrinho</h2>
    <p>Separamos tudo aqui para você finalizar quando quiser:</p><table style="width:100%;border-collapse:collapse">${lines}</table>
    ${mail.button(base + '/carrinho', 'Voltar ao carrinho')}
    <p style="color:#5b6b85;font-size:13px">Pagando no <b>Pix</b> você tem desconto. Qualquer dúvida, é só responder este e-mail.</p>
    <p style="color:#8a97ad;font-size:12px">Você recebeu este lembrete porque iniciou uma compra em nossa loja. <a href="${mail.esc(base + '/api/email/unsubscribe?t=' + tokenValue)}" style="color:#8a97ad">Não quero receber mais lembretes</a>.</p>`);
  return { html, subject: 'Você esqueceu isso no carrinho — Sport Imperativo Store' };
}

/** Roda pela tarefa agendada. Só envia se ABANDONED_CART=on; com dry=true apenas conta. */
async function run({ dry = false } = {}) {
  const on = process.env.ABANDONED_CART === 'on';
  const due = await q.all("SELECT * FROM abandoned_carts WHERE recovered=0 AND sent_at IS NULL AND updated_at <= datetime('now', ?) AND created_at >= datetime('now', ?) ORDER BY id LIMIT ?", `-${DELAY_MIN} minutes`, `-${MAX_AGE_H} hours`, BATCH);
  const out = { enabled: on, due: due.length, sent: 0, skipped: 0 };
  for (const c of due) {
    const skip = async () => { await q.run("UPDATE abandoned_carts SET sent_at=datetime('now'), recovered=recovered WHERE id=?", c.id); out.skipped++; };
    if (await q.get('SELECT 1 x FROM email_optout WHERE email=?', c.email)) { if (!dry && on) await skip(); continue; }
    const bought = await q.get("SELECT 1 x FROM orders WHERE json_extract(customer,'$.email')=? AND created_at >= ?", c.email, c.created_at);
    if (bought) { if (!dry) await q.run('UPDATE abandoned_carts SET recovered=1 WHERE id=?', c.id); out.skipped++; continue; }
    if (!on || dry) continue;
    const m = await render(c, c.token); if (!m) { await skip(); continue; }
    const r = await mail.sendMail({ orderId: null, to: c.email, subject: m.subject, html: m.html });
    if (r.sent) { await q.run("UPDATE abandoned_carts SET sent_at=datetime('now') WHERE id=?", c.id); out.sent++; }
  }
  return out;
}
async function unsubscribe(tk) {
  const c = await q.get('SELECT email FROM abandoned_carts WHERE token=?', String(tk || ''));
  if (!c) return false;
  await q.run('INSERT OR IGNORE INTO email_optout(email) VALUES(?)', c.email);
  await q.run("UPDATE abandoned_carts SET sent_at=COALESCE(sent_at, datetime('now')) WHERE email=? AND sent_at IS NULL", c.email);
  return true;
}
/** Prévia: monta o e-mail com os primeiros produtos ativos e envia ao administrador. */
async function preview(to) {
  const p = await q.all('SELECT id FROM products WHERE active=1 ORDER BY sold DESC, id DESC LIMIT 2');
  const m = await render({ name: 'Cliente', items: JSON.stringify(p.map((x) => ({ productId: x.id, size: 'M', qty: 1 }))) }, 'preview');
  if (!m) return { failed: true };
  return mail.sendMail({ orderId: null, to, subject: '[PRÉVIA] ' + m.subject, html: m.html });
}
module.exports = { capture, recover, run, unsubscribe, preview };
