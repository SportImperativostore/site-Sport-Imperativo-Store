/* Camada de pagamento. Cartão NUNCA passa por este servidor: o cliente é redirecionado ao checkout hospedado do gateway
 * (Mercado Pago Checkout Pro) ou, em modo de teste, simulado. Pix é gerado via API do gateway. */
const { q } = require('../db');
const { markPaid } = require('./orders');
const crypto = require('crypto');

// Sem token: modo de teste (pagamento simulado) — bloqueado em produção/Vercel, a menos que ALLOW_MOCK_PAYMENTS=1.
const provider = () => {
  if (process.env.MP_ACCESS_TOKEN) return 'mercadopago';
  const prod = process.env.NODE_ENV === 'production' || process.env.VERCEL;
  return prod && process.env.ALLOW_MOCK_PAYMENTS !== '1' ? 'none' : 'mock';
};
const MP = process.env.MP_API_URL || 'https://api.mercadopago.com';
const mpHeaders = (extra = {}) => ({ Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json', ...extra });

async function createPayment(order, baseUrl) {
  if (provider() === 'none') throw new Error('Gateway de pagamento não configurado (defina MP_ACCESS_TOKEN).');
  const customer = JSON.parse(order.customer);
  const method = order.payment_method;
  const amount = order.total_cents;
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
      method: 'POST', headers: mpHeaders({ 'X-Idempotency-Key': `order-${order.id}-pix` }),
      body: JSON.stringify({
        transaction_amount: amount / 100, description: `Pedido #${order.id} - Sport Imperativo Store`, payment_method_id: 'pix',
        external_reference: String(order.id), notification_url: `${baseUrl}/api/webhooks/mercadopago`, statement_descriptor: 'SPORTIMPERATIVO',
        payer: { email: customer.email, first_name: customer.name.split(' ')[0], last_name: customer.name.split(' ').slice(1).join(' ') || '-', identification: { type: 'CPF', number: customer.cpf } },
        additional_info: {
          items: its.map((i) => ({ id: String(i.product_id), title: String(i.name).slice(0, 120), description: String(i.name).slice(0, 120), category_id: 'fashion', quantity: i.qty, unit_price: Number(((i.unit_cents + (i.custom_cents || 0)) / 100).toFixed(2)) })),
          payer: { first_name: customer.name.split(' ')[0], last_name: customer.name.split(' ').slice(1).join(' ') || '-', phone: phone.length >= 10 ? { area_code: phone.slice(0, 2), number: phone.slice(2) } : undefined, address: addr.cep ? { zip_code: String(addr.cep).replace(/\D/g, ''), street_name: addr.street, street_number: String(addr.number || '') } : undefined },
          shipments: addr.cep ? { receiver_address: { zip_code: String(addr.cep).replace(/\D/g, ''), state_name: addr.state, city_name: addr.city, street_name: addr.street, street_number: String(addr.number || '') } } : undefined,
        },
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error('Gateway: ' + (j.message || res.status));
    const td = (j.point_of_interaction || {}).transaction_data || {};
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
module.exports = { createPayment, handleMercadoPagoWebhook, provider };
