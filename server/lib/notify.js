/* Aviso ao dono quando entra um pedido pago. Sem dados do cliente (só número e valor).
 * Canais opcionais, ativados por variável de ambiente:
 *   NTFY_TOPIC                      app/site ntfy.sh (grátis, sem cadastro): tópico secreto escolhido pelo dono
 *   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID   bot do Telegram
 * Nunca quebra o pedido: erros só vão para o log. */
const { brl } = require('./util');

async function post(url, opts) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
  try { const r = await fetch(url, { ...opts, signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); } finally { clearTimeout(t); }
}

async function notifyPaidOrder(order, ref) {
  const base = (process.env.PUBLIC_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL : '')).replace(/\/+$/, '');
  const link = base ? `${base}/admin/#/orders/${order.id}` : '';
  const text = `Novo pedido pago #${ref}: ${brl(order.total_cents)}. Abra o admin e envie ao fornecedor.`;
  const jobs = [];
  if (process.env.NTFY_TOPIC) {
    const h = { Title: 'Novo pedido pago', Priority: 'high', Tags: 'moneybag' };
    if (link) h.Click = link;
    jobs.push(post(`https://ntfy.sh/${encodeURIComponent(process.env.NTFY_TOPIC)}`, { method: 'POST', headers: h, body: text }));
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    jobs.push(post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: link ? `${text}\n${link}` : text }) }));
  }
  const res = await Promise.allSettled(jobs);
  res.filter((r) => r.status === 'rejected').forEach((r) => console.error('notify', r.reason && r.reason.message));
  return jobs.length;
}
module.exports = { notifyPaidOrder };
