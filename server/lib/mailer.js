/* E-mails transacionais ao cliente. Usa o Resend (API HTTPS, funciona na Vercel) quando RESEND_API_KEY + MAIL_FROM estão definidos.
 * Sem configuração, o e-mail fica na caixa "email_outbox" (visível no painel) — o sistema nunca quebra por isso. */
const { q } = require('../db');

const base = () => (process.env.PUBLIC_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : '') || 'http://localhost:3000').replace(/\/+$/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sendMail({ orderId, to, subject, html }) {
  const key = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM;
  const r = await q.run('INSERT INTO email_outbox(order_id,to_email,subject,html,status) VALUES(?,?,?,?,?)', orderId || null, to, subject, html, 'queued');
  const id = r.lastInsertRowid;
  if (!key || !from) return { queued: true, id };
  try {
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject, html }), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('Resend HTTP ' + res.status);
    await q.run("UPDATE email_outbox SET status='sent', sent_at=datetime('now') WHERE id=?", id);
    return { sent: true, id };
  } catch (e) { await q.run("UPDATE email_outbox SET status='failed', error=? WHERE id=?", e.message, id); return { failed: true, id }; }
}
const button = (href, label) => `<p style="margin:24px 0"><a href="${esc(href)}" style="background:#0b5cff;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:12px;display:inline-block">${esc(label)}</a></p>`;
const layout = (inner) => `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#0d1b33;line-height:1.5">${inner}<p style="color:#5b6b85;font-size:13px">Sport Imperativo Store<br>Aqui você veste o esporte.</p></div>`;

module.exports = { sendMail, base, esc, button, layout };
