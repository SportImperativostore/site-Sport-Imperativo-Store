const express = require('express');
const { q, audit, setting } = require('../db');
const wa = require('../lib/whatsapp');
const A = require('../lib/automation');
const { wrap, HttpError } = require('../lib/util');

/* ================= Webhook público (Meta → loja) ================= */
const webhook = express.Router();
// Verificação inicial exigida pela Meta
webhook.get('/webhooks/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': tk, 'hub.challenge': ch } = req.query;
  const expected = wa.cfg().verifyToken;
  if (mode === 'subscribe' && expected && tk === expected) return res.status(200).type('text/plain').send(String(ch));
  res.sendStatus(403);
});
// Eventos: mensagens do fornecedor e recibos de entrega
webhook.post('/webhooks/whatsapp', wrap(async (req, res) => {
  const secured = !!wa.cfg().appSecret;
  const prod = process.env.NODE_ENV === 'production' || process.env.VERCEL;
  if (secured && !wa.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);   // assinatura inválida
  if (!secured && prod) return res.sendStatus(503);                                                              // em produção exige WHATSAPP_APP_SECRET
  const out = [];
  try {
    for (const entry of (req.body && req.body.entry) || []) for (const ch of entry.changes || []) {
      const v = ch.value || {};
      for (const m of v.messages || []) {
        const text = (m.text && m.text.body) || (m.button && m.button.text) || (m.interactive && ((m.interactive.button_reply || {}).title || (m.interactive.list_reply || {}).title)) || (m.image && m.image.caption) || `[${m.type}]`;
        out.push(await A.handleInbound({ id: m.id, from: m.from, text, replyTo: m.context && m.context.id }));
      }
      for (const st of v.statuses || []) await A.handleStatus({ id: st.id, status: st.status, errors: st.errors });
    }
  } catch (e) { console.error('whatsapp webhook', e); }
  res.sendStatus(200);    // sempre 200 para a Meta não reenviar em loop
}));

/* ================= Painel administrativo ================= */
const admin = express.Router();
const baseUrl = (req) => process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;

admin.get('/whatsapp/status', wrap(async (req, res) => {
  const c = wa.cfg(), env = wa.envStatus();
  const missing = Object.entries(env).filter(([k, v]) => !v && k !== 'WHATSAPP_API_URL').map(([k]) => k);
  let live = null;
  if (wa.isConfigured()) {
    try {
      const r = await fetch(`${c.api}/${c.phoneId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`, { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(8000) });
      const j = await r.json(); live = r.ok ? { ok: true, number: j.display_phone_number, name: j.verified_name, quality: j.quality_rating } : { ok: false, error: (j.error && j.error.message) || 'erro' };
    } catch (e) { live = { ok: false, error: e.message }; }
  }
  const sup = await q.all("SELECT id,name,whatsapp,channel FROM suppliers WHERE active=1");
  res.json({
    state: live && live.ok ? 'connected' : wa.isConfigured() ? 'error' : 'not_configured', live, env, missing,
    storeNumber: A.fmtPhone(A.storeNumber()), suppliers: sup.map((s) => ({ id: s.id, name: s.name, number: s.whatsapp ? A.fmtPhone(s.whatsapp) : null, channel: s.channel })),
    envSupplierNumber: !!process.env.WHATSAPP_SUPPLIER_NUMBER, webhookUrl: `${baseUrl(req)}/api/webhooks/whatsapp`, template: wa.TEMPLATE_DEFINITION(),
    emailConfigured: !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM), sharePhone: setting('supplier_share_phone', '1') !== '0',
  });
}));
// Teste de envio (usa o template real para um número que VOCÊ informa — nunca para o cliente)
admin.post('/whatsapp/test', wrap(async (req, res) => {
  const to = wa.digits((req.body || {}).to);
  if (to.length < 10) throw new HttpError(400, 'Informe o número com DDI e DDD.');
  if (!wa.isConfigured()) throw new HttpError(400, 'API não configurada: defina as variáveis de ambiente.');
  try {
    const id = await wa.sendTemplate(to, wa.cfg().template, wa.cfg().lang, ['#SIS-TESTE', 'Cliente Teste', '1x Camisa Exemplo (Tam. M)', 'Rua Exemplo, 100, São Paulo - SP, CEP 00000-000, Brasil', '+55 (11) 90000-0000', 'R$ 0,00']);
    await audit(req.user.id, 'whatsapp_test', to.slice(-4), req.ip);
    res.json({ ok: true, id });
  } catch (e) { res.status(400).json({ error: e.message }); }
}));
admin.get('/whatsapp/inbox', wrap(async (req, res) => {
  const all = req.query.all === '1';
  res.json(await q.all(`SELECT * FROM supplier_inbox ${all ? '' : "WHERE resolved=0 AND kind!='outro_remetente'"} ORDER BY id DESC LIMIT 200`));
}));
// "RASTREIO PRECISA DE IDENTIFICAÇÃO": admin associa a mensagem a um pedido (ou descarta)
admin.post('/whatsapp/inbox/:id/assign', wrap(async (req, res) => {
  const b = req.body || {}, it = await q.get('SELECT * FROM supplier_inbox WHERE id=?', +req.params.id);
  if (!it) throw new HttpError(404, 'Mensagem não encontrada.');
  if (b.action === 'dismiss') { await q.run('UPDATE supplier_inbox SET resolved=1 WHERE id=?', it.id); return res.json({ ok: true }); }
  const ref = String(b.order || '').trim(); const id = A.parseRef(ref) ?? (/^\d+$/.test(ref) ? Number(ref) : null);
  const order = id && await q.get('SELECT id FROM orders WHERE id=?', id);
  if (!order) throw new HttpError(400, 'Pedido não encontrado (use #SIS-10482).');
  await q.run('UPDATE supplier_inbox SET matched_order_id=? WHERE id=?', order.id, it.id);
  await A.logComm(order.id, null, 'in', it.kind, it.body, it.wa_message_id, 'assigned');
  const code = (b.tracking || it.tracking_code || '').trim();
  if (b.action === 'tracking' && code) await A.registerTracking(order.id, code.toUpperCase(), { source: 'admin' });
  else if (b.action === 'confirm') { await require('../lib/orders').setStatus(order.id, 'supplier_confirmed', 'Fornecedor confirmou'); await q.run("UPDATE supplier_orders SET status='confirmed', confirmed_at=datetime('now') WHERE order_id=?", order.id); }
  await q.run('UPDATE supplier_inbox SET resolved=1 WHERE id=?', it.id);
  await audit(req.user.id, 'inbox_assign', `${it.id}->${order.id}`, req.ip);
  res.json({ ok: true });
}));
// Registro manual de rastreio (digitado pelo admin)
admin.post('/orders/:id/tracking', wrap(async (req, res) => {
  const b = req.body || {}, id = +req.params.id, code = String(b.code || '').trim().toUpperCase();
  if (code.length < 6) throw new HttpError(400, 'Informe o código de rastreio.');
  if (!await q.get('SELECT id FROM orders WHERE id=?', id)) throw new HttpError(404, 'Pedido não encontrado.');
  const out = await A.registerTracking(id, code, { carrier: b.carrier || undefined, url: b.url || undefined, source: 'admin' });
  await audit(req.user.id, 'tracking_manual', `${id}:${code}`, req.ip);
  res.json(out);
}));
admin.get('/emails', wrap(async (_req, res) => res.json(await q.all('SELECT id,order_id,to_email,subject,status,error,created_at,sent_at FROM email_outbox ORDER BY id DESC LIMIT 100'))));

module.exports = { webhook, admin };
