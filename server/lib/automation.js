/* ORDER AUTOMATION — camada que liga: pagamento aprovado → mensagem ao fornecedor (via WhatsApp Business da LOJA)
 * → respostas/rastreio do fornecedor (webhook) → status do pedido → aviso ao cliente (e-mail).
 *
 *   CLIENTE ↔ SPORT IMPERATIVO STORE ↔ FORNECEDOR   (nunca CLIENTE ↔ FORNECEDOR)
 *
 * Regras: idempotência (um envio por pedido/fornecedor), só dados necessários ao fornecedor, número do fornecedor
 * somente no backend/admin, log de toda a conversa por pedido. */
const { q, setting } = require('../db');
const wa = require('./whatsapp');
const mail = require('./mailer');
const { brl, onlyDigits } = require('./util');

const orderRef = (id) => 'SIS-' + (10000 + Number(id));
const parseRef = (text) => { const m = String(text || '').match(/SIS[-\s#_]*(\d{4,8})/i); return m ? Number(m[1]) - 10000 : null; };
const lazyOrders = () => require('./orders');

/* ---------- números ---------- */
function fmtPhone(p) {
  const d = onlyDigits(p); if (!d) return '-';
  if (d.length >= 12 && d.startsWith('55')) return `+55 (${d.slice(2, 4)}) ${d.slice(4, d.length - 4)}-${d.slice(-4)}`;
  if (d.length >= 10 && d.length <= 11) return `+55 (${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
  return '+' + d;
}
/** Número do fornecedor: variável de ambiente > cadastro do fornecedor (admin). Nunca é exposto a clientes. */
async function supplierNumber(supplierId) {
  if (process.env.WHATSAPP_SUPPLIER_NUMBER) return wa.digits(process.env.WHATSAPP_SUPPLIER_NUMBER);
  const s = supplierId ? await q.get('SELECT whatsapp FROM suppliers WHERE id=?', supplierId) : null;
  return wa.digits(s && s.whatsapp);
}
const storeNumber = () => wa.digits(setting('whatsapp', '5511917765409'));

/* ---------- mensagem ao fornecedor (somente o necessário) ---------- */
const addressLines = (a) => [a.street + ', ' + a.number + (a.complement ? ' - ' + a.complement : ''), a.district, `${a.city} - ${a.state}`, 'CEP: ' + String(a.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2'), 'Brasil'];
function itemsBlock(items) {
  return items.map((it) => [`Camisa/Produto: ${it.name}`, `Tamanho: ${it.size || '-'}`, `Quantidade: ${it.qty}`,
    (it.custom_name || it.custom_number) ? `Personalização: Nome ${it.custom_name || '-'} / Número ${it.custom_number || '-'}` : null, it.custom_extra || null].filter(Boolean).join('\n')).join('\n\n');
}
function supplierMessage(order, items) {
  const c = JSON.parse(order.customer), a = JSON.parse(order.address);
  const share = setting('supplier_share_phone', '1') !== '0';
  return ['NOVO PEDIDO — SPORT IMPERATIVO STORE', `Pedido: #${orderRef(order.id)}`, `Cliente: ${c.name}`, '', 'PRODUTO:', itemsBlock(items), '',
    'ENDEREÇO DE ENTREGA:', c.name, ...addressLines(a), ...(share ? ['', 'Telefone do cliente:', fmtPhone(c.whatsapp || c.phone)] : []), '',
    'VALOR DO PEDIDO:', brl(order.total_cents), '', 'Por favor, confirme o recebimento do pedido.', 'Sport Imperativo Store.'].join('\n');
}
function templateParams(order, items) {
  const c = JSON.parse(order.customer), a = JSON.parse(order.address);
  const share = setting('supplier_share_phone', '1') !== '0';
  return ['#' + orderRef(order.id), c.name,
    items.map((it) => `${it.qty}x ${it.name} (Tam. ${it.size || '-'})${(it.custom_name || it.custom_number) ? ` [Nome ${it.custom_name || '-'} Nº ${it.custom_number || '-'}]` : ''}${it.custom_extra ? ` [${it.custom_extra}]` : ''}`).join(' ; '),
    addressLines(a).join(', '), share ? fmtPhone(c.whatsapp || c.phone) : 'não informado', brl(order.total_cents)];
}

/* ---------- log da conversa ---------- */
const logComm = (orderId, so, direction, kind, body, waId, status) =>
  q.run('INSERT INTO comm_log(order_id,supplier_order_id,direction,kind,body,wa_message_id,status) VALUES(?,?,?,?,?,?,?)', orderId, so || null, direction, kind, body, waId || null, status || null);

/* ---------- envio ao fornecedor (idempotente) ---------- */
/** Envia a ordem de compra ao fornecedor pela API oficial. Seguro para chamar várias vezes: só envia uma vez. */
async function dispatchSupplierOrder(soId, { force = false } = {}) {
  const so = await q.get('SELECT * FROM supplier_orders WHERE id=?', soId);
  if (!so) return { error: 'ordem não encontrada' };
  if (!force && ['sent', 'confirmed'].includes(so.status)) return { skipped: 'já enviado' };           // idempotência
  const s = await q.get('SELECT * FROM suppliers WHERE id=?', so.supplier_id);
  const order = await q.get('SELECT * FROM orders WHERE id=?', so.order_id);
  const items = await q.all('SELECT * FROM order_items WHERE order_id=? AND supplier_id=?', so.order_id, so.supplier_id);
  const message = supplierMessage(order, items);
  await q.run('UPDATE supplier_orders SET message=? WHERE id=?', message, soId);

  // Canal webhook (integração própria do fornecedor)
  if (s && s.channel === 'webhook' && s.webhook_url) return dispatchWebhook(so, s, order, message);
  // Canal WhatsApp: precisa da API oficial configurada; senão fica no envio manual (fallback)
  const to = await supplierNumber(so.supplier_id);
  if (!(s && s.channel === 'whatsapp') || !wa.isConfigured() || !to) {
    await logComm(order.id, soId, 'out', 'manual', 'API oficial não configurada (ou número ausente): envio manual disponível no painel.', null, 'pending');
    return { manual: true };
  }
  // Reserva atômica: evita envio duplicado por webhooks/requisições concorrentes
  const claim = await q.run(force ? "UPDATE supplier_orders SET status='sending', attempts=attempts+1 WHERE id=?" : "UPDATE supplier_orders SET status='sending', attempts=attempts+1 WHERE id=? AND status IN ('awaiting','failed')", soId);
  if (!claim.changes) return { skipped: 'em andamento/já enviado' };
  try {
    const lastIn = await q.get("SELECT created_at FROM comm_log WHERE direction='in' AND order_id IN (SELECT order_id FROM supplier_orders WHERE supplier_id=?) ORDER BY id DESC LIMIT 1", so.supplier_id);
    const inWindow = lastIn && (Date.now() - new Date(lastIn.created_at.replace(' ', 'T') + 'Z').getTime()) < 23 * 3600e3;
    const id = inWindow ? await wa.sendText(to, message) : await wa.sendTemplate(to, wa.cfg().template, wa.cfg().lang, templateParams(order, items));
    await q.run("UPDATE supplier_orders SET status='sent', channel='whatsapp', sent_at=datetime('now'), wa_message_id=?, wa_status='sent', sent_to=?, error=NULL WHERE id=?", id, '+' + to, soId);
    await logComm(order.id, soId, 'out', inWindow ? 'text' : 'template', message, id, 'sent');
    await lazyOrders().setStatus(order.id, 'sent_supplier', 'Pedido enviado ao fornecedor');
    return { sent: true, id };
  } catch (e) {
    await q.run("UPDATE supplier_orders SET status='failed', error=? WHERE id=?", e.message.slice(0, 300), soId);
    await logComm(order.id, soId, 'out', 'error', e.message.slice(0, 300), null, 'failed');
    return { failed: true, error: e.message };
  }
}
async function dispatchWebhook(so, s, order, message) {
  try {
    const r = await fetch(s.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_ref: '#' + orderRef(order.id), supplier_order_id: so.id, message }), signal: AbortSignal.timeout(10000) });
    await logComm(order.id, so.id, 'out', 'webhook', `Webhook HTTP ${r.status}`, null, r.ok ? 'sent' : 'failed');
    if (r.ok) { await q.run("UPDATE supplier_orders SET status='sent', sent_at=datetime('now') WHERE id=?", so.id); await lazyOrders().setStatus(order.id, 'sent_supplier', 'Pedido enviado ao fornecedor'); return { sent: true }; }
    return { failed: true };
  } catch (e) { await logComm(order.id, so.id, 'out', 'error', e.message, null, 'failed'); return { failed: true, error: e.message }; }
}
/** Marcado manualmente pelo admin (fallback): registra e avança o status. */
async function markManualSent(soId, userNote = 'Enviado manualmente pelo WhatsApp da loja') {
  const so = await q.get('SELECT * FROM supplier_orders WHERE id=?', soId);
  await q.run("UPDATE supplier_orders SET status='sent', sent_at=datetime('now') WHERE id=? AND status!='confirmed'", soId);
  await logComm(so.order_id, soId, 'out', 'manual', userNote, null, 'sent');
  await lazyOrders().setStatus(so.order_id, 'sent_supplier', 'Pedido enviado ao fornecedor');
}

/* ---------- rastreio ---------- */
const TRACK_RE = [/\b[A-Z]{2}\d{9}[A-Z]{2}\b/, /\b(?:BR|LP|YT|UQ|SF|JT|JD|CN|NL|1Z)[A-Z0-9]{8,22}\b/];
function extractTracking(text) {
  const t = String(text || '').toUpperCase().replace(/SIS[-\s#_]*\d+/g, ' ');
  for (const re of TRACK_RE) { const m = t.match(re); if (m) return m[0]; }
  const kw = t.match(/(?:RASTREI\w*|TRACKING|TRACK|C[ÓO]DIGO|CODE)\D{0,12}([A-Z0-9]{8,30})/);
  if (kw && /\d/.test(kw[1])) return kw[1];
  const only = t.trim().match(/^([A-Z0-9]{9,30})$/); // mensagem contendo só o código
  return only && /\d/.test(only[1]) && /[A-Z]/.test(only[1]) ? only[1] : null;
}
const carrierOf = (c) => (/^BR|BR$/.test(c) ? 'Correios' : /^YT/.test(c) ? 'Yun Express' : /^LP/.test(c) ? 'Cainiao' : /^SF/.test(c) ? 'SF Express' : /^1Z/.test(c) ? 'UPS' : 'Transportadora internacional');

/** Registra rastreio (código, transportadora, data de envio), muda o status para "em trânsito" e avisa o cliente. */
async function registerTracking(orderId, code, { carrier, url, source = 'fornecedor' } = {}) {
  const O = lazyOrders();
  carrier = carrier || carrierOf(code);
  url = url || `https://t.17track.net/pt#nums=${encodeURIComponent(code)}`;
  let sh = await q.get("SELECT id FROM shipments WHERE order_id=? ORDER BY (grp='import') DESC, id LIMIT 1", orderId);
  if (sh) await q.run("UPDATE shipments SET carrier=?,code=?,url=?,status='shipped',shipped_at=datetime('now') WHERE id=?", carrier, code, url, sh.id);
  else await q.run("INSERT INTO shipments(order_id,grp,carrier,code,url,status,shipped_at) VALUES(?,?,?,?,?,'shipped',datetime('now'))", orderId, 'import', carrier, code, url);
  await logComm(orderId, null, 'in', 'tracking', `Rastreio registrado: ${code} (${carrier})`, null, 'ok');
  await O.setStatus(orderId, 'in_transit', 'Rastreio registrado');
  await notifyCustomer(orderId, 'tracking', { code, carrier });
  return { code, carrier };
}

/* ---------- avisos ao cliente (e-mail; WhatsApp do cliente não é usado) ---------- */
async function notifyCustomer(orderId, kind, d = {}) {
  const order = await q.get('SELECT * FROM orders WHERE id=?', orderId); if (!order) return;
  const c = JSON.parse(order.customer); const first = String(c.name || '').split(' ')[0];
  const link = `${mail.base()}/pedido/${order.id}?t=${order.access_token}`;
  if (kind === 'tracking') {
    const html = mail.layout(`<p>Olá, ${mail.esc(first)}!</p><p>Seu pedido <b>#${orderRef(order.id)}</b> foi enviado.</p><p>Código de rastreio:<br><b style="font-size:20px;letter-spacing:1px">${mail.esc(d.code)}</b><br><small>${mail.esc(d.carrier || '')}</small></p><p>Clique abaixo para acompanhar sua entrega.</p>${mail.button(link, 'ACOMPANHAR PEDIDO')}`);
    return mail.sendMail({ orderId, to: c.email, subject: `Seu pedido #${orderRef(order.id)} foi enviado`, html });
  }
  if (kind === 'received') {
    const html = mail.layout(`<p>Olá, ${mail.esc(first)}!</p><p>Recebemos o pagamento do pedido <b>#${orderRef(order.id)}</b>. Já estamos cuidando de tudo.</p>${mail.button(link, 'ACOMPANHAR PEDIDO')}`);
    return mail.sendMail({ orderId, to: c.email, subject: `Pedido #${orderRef(order.id)} confirmado`, html });
  }
}

/* ---------- webhook: mensagens do fornecedor ---------- */
const CONFIRM_RE = /(pedido\s+)?(recebid|confirmad|received|confirm|got it|ok\b|entendid|combinado)/i;
const PROCESS_RE = /(em\s+prepara|preparando|processando|processing|preparing|producing|em\s+produ)/i;
const SHIPPED_RE = /(enviado|despachad|shipped|sent out|dispatched)/i;

async function handleInbound(msg) {
  const O = lazyOrders();
  const text = msg.text || '';
  if (await q.get('SELECT id FROM supplier_inbox WHERE wa_message_id=?', msg.id)) return { duplicate: true };       // idempotência de entrega do webhook
  const from = wa.digits(msg.from);
  const suppliers = await q.all("SELECT id,whatsapp FROM suppliers WHERE whatsapp IS NOT NULL AND whatsapp!=''");
  const known = new Set(suppliers.map((s) => wa.digits(s.whatsapp)).concat(process.env.WHATSAPP_SUPPLIER_NUMBER ? [wa.digits(process.env.WHATSAPP_SUPPLIER_NUMBER)] : []));
  if (!known.has(from)) { await q.run('INSERT OR IGNORE INTO supplier_inbox(wa_from,wa_message_id,body,kind,resolved) VALUES(?,?,?,?,1)', from, msg.id, text.slice(0, 1000), 'outro_remetente'); return { ignored: true }; }   // só o fornecedor aciona automações
  const sup = suppliers.find((s) => wa.digits(s.whatsapp) === from) || suppliers[0];

  // Identifica o pedido: resposta direta a uma mensagem nossa > referência #SIS-xxxxx no texto > único pedido em aberto
  let orderId = null;
  if (msg.replyTo) { const r = await q.get('SELECT order_id FROM comm_log WHERE wa_message_id=?', msg.replyTo); if (r) orderId = r.order_id; }
  if (!orderId) { const id = parseRef(text); if (id && await q.get('SELECT id FROM orders WHERE id=?', id)) orderId = id; }
  if (!orderId && sup) {
    const open = await q.all("SELECT order_id FROM supplier_orders WHERE supplier_id=? AND status IN ('sent','confirmed') AND order_id IN (SELECT id FROM orders WHERE status IN ('sent_supplier','supplier_confirmed','preparing','paid','awaiting_supplier'))", sup.id);
    if (open.length === 1) orderId = open[0].order_id;
  }
  const code = extractTracking(text);
  const kind = code ? 'tracking' : CONFIRM_RE.test(text) ? 'confirm' : PROCESS_RE.test(text) ? 'processing' : SHIPPED_RE.test(text) ? 'shipped' : 'message';

  await q.run('INSERT INTO supplier_inbox(wa_from,wa_message_id,body,reply_to,kind,tracking_code,matched_order_id,resolved) VALUES(?,?,?,?,?,?,?,?)', from, msg.id, text.slice(0, 1000), msg.replyTo || null, kind, code, orderId, 0);
  const inboxId = (await q.get('SELECT id FROM supplier_inbox WHERE wa_message_id=?', msg.id)).id;
  if (orderId) await logComm(orderId, null, 'in', kind, text.slice(0, 1000), msg.id, 'received');

  if (!orderId) return { inbox: inboxId, unmatched: true };                                                       // vai para "RASTREIO PRECISA DE IDENTIFICAÇÃO"
  const so = await q.get('SELECT id FROM supplier_orders WHERE order_id=? AND supplier_id=?', orderId, sup && sup.id);
  if (kind === 'tracking') { await registerTracking(orderId, code); await q.run('UPDATE supplier_inbox SET resolved=1 WHERE id=?', inboxId); return { order: orderId, tracking: code }; }
  if (kind === 'confirm') { if (so) await q.run("UPDATE supplier_orders SET status='confirmed', confirmed_at=datetime('now') WHERE id=?", so.id); await O.setStatus(orderId, 'supplier_confirmed', 'Fornecedor confirmou'); }
  else if (kind === 'processing') await O.setStatus(orderId, 'preparing', 'Pedido em preparação');
  else if (kind === 'shipped') await O.setStatus(orderId, 'shipped', 'Fornecedor informou o envio');
  await q.run('UPDATE supplier_inbox SET resolved=1 WHERE id=?', inboxId);
  return { order: orderId, kind };
}

/** Recibos de entrega/leitura das mensagens que enviamos. */
async function handleStatus(st) {
  const row = await q.get('SELECT id,order_id FROM comm_log WHERE wa_message_id=? AND direction=?', st.id, 'out');
  if (!row) return;
  await q.run('UPDATE comm_log SET status=? WHERE id=?', st.status, row.id);
  await q.run('UPDATE supplier_orders SET wa_status=? WHERE wa_message_id=?', st.status, st.id);
  if (st.status === 'failed') {
    const err = (st.errors && st.errors[0] && (st.errors[0].message || st.errors[0].title)) || 'entrega falhou';
    await q.run("UPDATE supplier_orders SET status='failed', error=? WHERE wa_message_id=?", String(err).slice(0, 300), st.id);
    await logComm(row.order_id, null, 'out', 'error', 'Falha na entrega: ' + err, st.id, 'failed');
  }
}

module.exports = { orderRef, parseRef, fmtPhone, supplierNumber, storeNumber, supplierMessage, templateParams, logComm, dispatchSupplierOrder, markManualSent, extractTracking, registerTracking, notifyCustomer, handleInbound, handleStatus };
