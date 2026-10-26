/* Camada de pagamento. Cartão NUNCA passa por este servidor: o cliente é redirecionado ao checkout hospedado do gateway
 * (Mercado Pago Checkout Pro) ou, em modo de teste, simulado. Pix é gerado via API do gateway. */
const { q, setting } = require('../db');
const { markPaid } = require('./orders');
const crypto = require('crypto');

// Sem token: modo de teste (pagamento simulado) — bloqueado em produção/Vercel, a menos que ALLOW_MOCK_PAYMENTS=1.
const IP_API = 'https://api.checkout.infinitepay.io';
const ipHandle = () => String(process.env.INFINITEPAY_HANDLE || setting('infinitepay_handle', '') || '').replace(/^$/, '').trim();
const provider = () => {
  if (ipHandle()) return 'infinitepay';
  if (process.env.MP_ACCESS_TOKEN) return 'mercadopago';
  const prod = process.env.NODE_ENV === 'production' || process.env.VERCEL;
  return prod && process.env.ALLOW_MOCK_PAYMENTS !== '1' ? 'none' : 'mock';
};
const MP = process.env.MP_API_URL || 'https://api.mercadopago.com';
const mpHeaders = (extra = {}) => ({ Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...extra });

async function createPayment(order, baseUrl, deviceId) {
  if (order.payment_method === 'pix' && asaasOn()) { try { return await createAsaasPix(order); } catch (e) { console.error('asaas pix falhou, usa o meio principal:', e.message); } }
  if (provider() === 'none') throw new Error('Gateway de pagamento não configurado (defina MP_ACCESS_TOKEN).');
  const customer = JSON.parse(order.customer);
  const method = order.payment_method;
  const amount = order.total_cents;
  if (provider() === 'infinitepay') return createInfinitePay(order, customer, baseUrl);
  if (provider() === 'mock') {
    const code = method === 'pix' ? '00020126580014BR.GOV.BCB.PIX0136mock-' + crypto.randomBytes(8).toString('hex') + '5204000053039865802BR5920SPORT IMPERATIVO STORE6009SAO PAULO62070503***6304ABCD' : null;
    const r = await q.run('INSERT INTO payments(order_id,provider,method,status,amount_cents,pix_code,checkout_url) VALUES(?,?,?,?,?,?,?)', order.id, 'mock', method, 'pending', amount, code, method === 'pix' ? null : `${baseUrl}/pedido/${order.id}?t=${order.access_token}&mock=card`);
    return q.get('SELECT * FROM payments WHERE id=?', Number(r.lastInsertRowid));
  }
  if (method === 'pix') {
    // Dados completos do comprador e dos itens ajudam a análise antifraude do Mercado Pago a aprovar o Pix.
    const addr = (() => { try { return JSON.parse(order.address) || {}; } catch { return {}; } })();
    const its = await q.all('SELECT product_id,name,qty,unit_cents,custom_cents FROM order_items WHERE order_id=?', order.id);
    const phone = String(customer.phone || '').replace(/\D/g, '');
    const res = await fetch(`${MP}/v1/payments`, {
      method: 'POST', headers: mpHeaders({ 'X-Idempotency-Key': `order-${order.id}-pix`, ...(deviceId ? { 'X-meli-session-id': deviceId } : {}) }),
      body: JSON.stringify({
        transaction_amount: amount / 100, description: `Pedido #${order.id} - Sport Imperativo Store`, payment_method_id: 'pix',
        external_reference: String(order.id), notification_url: `${baseUrl}/api/webhooks/mercadopago`, statement_descriptor: 'SPORTIMPERATIVO',
        payer: { email: customer.email, first_name: customer.name.split(' ')[0], last_name: customer.name.split(' ').slice(1).join(' ') || '-', identification: { type: 'CPF', number: customer.cpf },
          address: addr.cep ? { zip_code: String(addr.cep).replace(/\D/g, ''), street_name: addr.street, street_number: String(addr.number || ''), neighborhood: addr.district, city: addr.city, federal_unit: addr.state } : undefined },
        additional_info: {
          items: its.map((i) => ({ id: String(i.product_id), title: String(i.name).slice(0, 120), description: String(i.name).slice(0, 120), category_id: 'fashion', quantity: i.qty, unit_price: Number(((i.unit_cents + (i.custom_cents || 0)) / 100).toFixed(2)) })),
          payer: { first_name: customer.name.split(' ')[0], last_name: customer.name.split(' ').slice(1).join(' ') || '-', phone: phone.length >= 10 ? { area_code: phone.slice(0, 2), number: phone.slice(2) } : undefined, address: addr.cep ? { zip_code: String(addr.cep).replace(/\D/g, ''), street_name: addr.street, street_number: String(addr.number || '') } : undefined },
          shipments: addr.cep ? { receiver_address: { zip_code: String(addr.cep).replace(/\D/g, ''), state_name: addr.state, city_name: addr.city, street_name: addr.street, street_number: String(addr.number || '') } } : undefined,
        },
      }),
    });
    const j = await res.json();
    if (!res.ok) { const err = new Error('Gateway: ' + (j.message || res.status)); if (/without key enabled/i.test(j.message || '')) err.userMessage = 'O Pix está temporariamente indisponível. Pague com cartão de crédito (até 12x) ou tente o Pix mais tarde.'; throw err; }
    const td = (j.point_of_interaction || {}).transaction_data || {};
    // O antifraude pode recusar logo após criar o código: confere antes de mostrar um Pix que já nasceu cancelado.
    let st = j.status, detail = j.status_detail;
    if (!st || st === 'pending') {
      await new Promise((r) => setTimeout(r, 1500));
      try { const c = await (await fetch(`${MP}/v1/payments/${j.id}`, { headers: mpHeaders() })).json(); if (c && c.status) { st = c.status; detail = c.status_detail; } } catch { /* mantém o estado inicial */ }
    }
    if (['rejected', 'cancelled'].includes(st)) {
      console.error('pix recusado pelo gateway', j.id, st, detail);
      await q.run('INSERT INTO payments(order_id,provider,method,status,external_id,amount_cents,raw) VALUES(?,?,?,?,?,?,?)', order.id, 'mercadopago', 'pix', 'rejected', String(j.id), amount, JSON.stringify({ status: st, detail }));
      const err = new Error('Pix recusado: ' + detail); err.userMessage = 'O Pix foi recusado por segurança pelo meio de pagamento. Tente pagar com cartão ou tente novamente em alguns minutos.'; throw err;
    }
    const r = await q.run('INSERT INTO payments(order_id,provider,method,status,external_id,amount_cents,pix_code,pix_qr,raw) VALUES(?,?,?,?,?,?,?,?,?)', order.id, 'mercadopago', 'pix', 'pending', String(j.id), amount, td.qr_code, td.qr_code_base64, JSON.stringify({ status: j.status }));
    return await q.get('SELECT * FROM payments WHERE id=?', Number(r.lastInsertRowid));
  }
  // Cartão e demais métodos: Checkout Pro (página segura do gateway)
  const items = await q.all('SELECT * FROM order_items WHERE order_id=?', order.id);
  const res = await fetch(`${MP}/checkout/preferences`, {
    method: 'POST', headers: mpHeaders(),
    body: JSON.stringify({
      items: [{ title: `Pedido #${order.id} - Sport Imperativo Store (${items.length} item/ns)`, quantity: 1, currency_id: 'BRL', unit_price: amount / 100 }],
      external_reference: String(order.id), notification_url: `${baseUrl}/api/webhooks/mercadopago`,
      back_urls: { success: `${baseUrl}/pedido/${order.id}?t=${order.access_token}`, failure: `${baseUrl}/pedido/${order.id}?t=${order.access_token}`, pending: `${baseUrl}/pedido/${order.id}?t=${order.access_token}` },
      auto_return: 'approved', payment_methods: { installments: order.installments || 12 },
      payer: { email: customer.email, name: customer.name },
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Gateway: ' + (j.message || res.status));
  const r = await q.run('INSERT INTO payments(order_id,provider,method,status,external_id,amount_cents,checkout_url) VALUES(?,?,?,?,?,?,?)', order.id, 'mercadopago', method, 'pending', j.id, amount, j.init_point);
  return await q.get('SELECT * FROM payments WHERE id=?', Number(r.lastInsertRowid));
}

/* Asaas: Pix dentro do site (QR Code e copia-e-cola gerados por API). Ativa quando ASAAS_API_KEY existe; o cartão segue na InfinitePay. */
const asaasOn = () => !!process.env.ASAAS_API_KEY;
const ASAAS = () => (process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3');
const asaas = async (method, url, body) => {
  const res = await fetch(ASAAS() + url, { method, headers: { 'Content-Type': 'application/json', access_token: process.env.ASAAS_API_KEY, 'User-Agent': 'SportImperativoStore' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let j = {}; try { j = JSON.parse(text); } catch { /* não-JSON */ }
  if (!res.ok) throw new Error('Asaas ' + res.status + ' ' + text.slice(0, 200));
  return j;
};
async function createAsaasPix(order) {
  const c = JSON.parse(order.customer);
  const cus = await asaas('POST', '/customers', { name: c.name, cpfCnpj: c.cpf, email: c.email, mobilePhone: String(c.phone || '').replace(/D/g, '').replace(/^55/, '') || undefined, externalReference: 'order-' + order.id, notificationDisabled: true });
  const due = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const pay = await asaas('POST', '/payments', { customer: cus.id, billingType: 'PIX', value: order.total_cents / 100, dueDate: due, externalReference: String(order.id), description: `Pedido SIS-${10000 + order.id} - Sport Imperativo Store` });
  const qr = await asaas('GET', `/payments/${pay.id}/pixQrCode`);
  const r = await q.run('INSERT INTO payments(order_id,provider,method,status,external_id,amount_cents,pix_code,pix_qr,raw) VALUES(?,?,?,?,?,?,?,?,?)', order.id, 'asaas', 'pix', 'pending', pay.id, order.total_cents, qr.payload, qr.encodedImage, JSON.stringify({ status: pay.status }));
  return await q.get('SELECT * FROM payments WHERE id=?', Number(r.lastInsertRowid));
}
/** Webhook Asaas: confere o token do aviso e consulta a cobrança na API antes de aprovar o pedido (nunca confia no corpo). */
async function handleAsaasWebhook(headers, body) {
  const want = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!asaasOn() || (want && headers['asaas-access-token'] !== want)) return;
  const pid = body && body.payment && body.payment.id; if (!pid || !/^(PAYMENT_RECEIVED|PAYMENT_CONFIRMED)$/.test(String(body.event))) return;
  const p = await asaas('GET', '/payments/' + encodeURIComponent(pid));
  const orderId = parseInt(p.externalReference, 10); if (!orderId) return;
  const order = await q.get('SELECT * FROM orders WHERE id=?', orderId); if (!order) return;
  const pay = await q.get("SELECT * FROM payments WHERE order_id=? AND provider='asaas' ORDER BY id DESC LIMIT 1", orderId);
  if (['RECEIVED', 'CONFIRMED'].includes(p.status) && Math.round(p.value * 100) >= order.total_cents) await markPaid(orderId, pay && pay.id);
}

/* InfinitePay: checkout hospedado (Pix e cartão em até 12x). O cartão nunca passa por este servidor. */
async function createInfinitePay(order, customer, baseUrl) {
  const phone = String(customer.phone || '').replace(/D/g, '');
  const back = `${baseUrl}/pedido/${order.id}?t=${order.access_token}`;
  const body = {
    handle: ipHandle(), order_nsu: String(order.id), redirect_url: back, webhook_url: `${baseUrl}/api/webhooks/infinitepay`,
    items: [{ quantity: 1, price: order.total_cents, description: `Pedido SIS-${10000 + order.id} - Sport Imperativo Store` }],
    customer: { name: customer.name, email: customer.email, ...(phone.length >= 10 ? { phone_number: '+55' + phone.replace(/^55/, '') } : {}) },
  };
  // Endereço já informado na loja: segue preenchido na página de pagamento (o cliente não digita de novo).
  try { const ad = JSON.parse(order.address); if (ad && ad.cep) body.address = { cep: String(ad.cep), street: ad.street, neighborhood: ad.district, number: String(ad.number || ''), complement: ad.complement || '' }; } catch { /* endereço é opcional */ }
  const send = async () => { const r = await fetch(IP_API + '/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return [r, await r.text()]; };
  let [res, text] = await send();
  // Telefone fora do padrão que a InfinitePay aceita: refaz sem o telefone (ele é só um dado opcional do comprador).
  if (res.status === 422 && /phone_number/.test(text)) { delete body.customer.phone_number; [res, text] = await send(); }
  if (res.status === 422 && /address/.test(text)) { delete body.address; [res, text] = await send(); }
  let j = {}; try { j = JSON.parse(text); } catch { /* resposta não-JSON */ }
  const url = j.url || j.link || j.checkout_url || j.payment_url || (j.data && (j.data.url || j.data.link));
  if (!res.ok || !url) throw new Error('Gateway InfinitePay: ' + res.status + ' ' + text.slice(0, 160));
  const r = await q.run('INSERT INTO payments(order_id,provider,method,status,external_id,amount_cents,checkout_url,raw) VALUES(?,?,?,?,?,?,?,?)', order.id, 'infinitepay', order.payment_method, 'pending', String(order.id), order.total_cents, url, text.slice(0, 500));
  return await q.get('SELECT * FROM payments WHERE id=?', Number(r.lastInsertRowid));
}

/** Webhook InfinitePay: não confia no corpo; confirma no payment_check antes de dar o pedido como pago. */
async function handleInfinitePayWebhook(b) {
  b = b || {}; const orderId = parseInt(b.order_nsu, 10);
  if (!orderId || provider() !== 'infinitepay') return;
  const order = await q.get('SELECT * FROM orders WHERE id=?', orderId); if (!order) return;
  const res = await fetch(IP_API + '/payment_check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: ipHandle(), order_nsu: String(orderId), transaction_nsu: b.transaction_nsu, slug: b.invoice_slug || b.slug }) });
  if (!res.ok) return;
  const c = await res.json();
  const pay = await q.get('SELECT * FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1', orderId);
  if (pay) await q.run('UPDATE payments SET raw=? WHERE id=?', JSON.stringify({ paid: c.paid, amount: c.amount, paid_amount: c.paid_amount, installments: c.installments, capture_method: c.capture_method }), pay.id);
  if (c.success !== false && c.paid && Number(c.amount || c.paid_amount) >= order.total_cents) await markPaid(orderId, pay && pay.id);
}

/** Webhook: nunca confia no corpo; consulta o pagamento direto na API do gateway. */
async function handleMercadoPagoWebhook(body, query) {
  const id = (body && body.data && body.data.id) || query['data.id'] || query.id;
  if (!id || provider() !== 'mercadopago') return;
  const res = await fetch(`${MP}/v1/payments/${encodeURIComponent(id)}`, { headers: mpHeaders() });
  if (!res.ok) return;
  const p = await res.json();
  const orderId = parseInt(p.external_reference, 10);
  const pay = await q.get('SELECT * FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1', orderId);
  if (!pay) return;
  await q.run('UPDATE payments SET external_id=?, raw=? WHERE id=?', String(p.id), JSON.stringify({ status: p.status, detail: p.status_detail }), pay.id);
  const order = await q.get('SELECT * FROM orders WHERE id=?', orderId);
  if (p.status === 'approved' && Math.round(p.transaction_amount * 100) >= order.total_cents) await markPaid(orderId, pay.id);
  else if (['rejected', 'cancelled'].includes(p.status)) await q.run("UPDATE payments SET status=? WHERE id=?", p.status, pay.id);
}
module.exports = { createPayment, handleMercadoPagoWebhook, handleInfinitePayWebhook, handleAsaasWebhook, provider };
