const { q, tx, setting } = require('../db');
const { token, onlyDigits, brl } = require('./util');

const STATUS = {
  received: 'Pedido recebido', payment_pending: 'Aguardando pagamento', paid: 'Pagamento aprovado', awaiting_supplier: 'Aguardando fornecedor',
  sent_supplier: 'Enviado ao fornecedor', supplier_confirmed: 'Fornecedor confirmou', preparing: 'Em preparação', shipped: 'Enviado',
  in_transit: 'Em trânsito', delivered: 'Entregue', cancelled: 'Cancelado',
};
// Linha do tempo exibida ao cliente
const TIMELINE = ['received', 'paid', 'preparing', 'shipped', 'in_transit', 'delivered'];
const TL_LABEL = { received: 'Pedido recebido', paid: 'Pagamento aprovado', preparing: 'Em preparação', shipped: 'Enviado', in_transit: 'Em trânsito', delivered: 'Entregue' };
const TL_INDEX = { received: 0, payment_pending: 0, paid: 1, awaiting_supplier: 1, sent_supplier: 1, supplier_confirmed: 1, preparing: 2, shipped: 3, in_transit: 4, delivered: 5 };
// Rótulo de status visto pelo cliente (sem termos internos como 'fornecedor')
const CUSTOMER_LABEL = { payment_pending: 'Aguardando pagamento', received: 'Pedido recebido', paid: 'Pagamento aprovado', awaiting_supplier: 'Em processamento', sent_supplier: 'Em processamento', supplier_confirmed: 'Em processamento', preparing: 'Em preparação', shipped: 'Enviado', in_transit: 'Em trânsito', delivered: 'Entregue', cancelled: 'Cancelado' };
// Mensagens mostradas ao cliente em cada etapa (nunca mencionam fornecedor)
const CUSTOMER_MSG = { payment_pending: 'Aguardando a confirmação do pagamento.', received: 'Seu pedido foi recebido.', paid: 'Seu pedido foi recebido.', awaiting_supplier: 'Seu pedido está sendo preparado.', sent_supplier: 'Seu pedido está sendo preparado.',
  supplier_confirmed: 'Seu pedido está sendo preparado.', preparing: 'Seu pedido está sendo preparado.', shipped: 'Seu pedido foi enviado.', in_transit: 'Seu pedido está em trânsito.', delivered: 'Seu pedido foi entregue.', cancelled: 'Pedido cancelado.' };

async function setStatus(orderId, status, note, Q = q) {
  await Q.run("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?", status, orderId);
  await Q.run('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)', orderId, status, note || null);
}

async function createOrder({ cart, customer, address, userId, paymentMethod, installments, importAck }) {
  return tx(async (Q) => {
    const accessToken = token(18);
    const r = await Q.run(
      `INSERT INTO orders(user_id,access_token,status,customer,address,subtotal_cents,discount_cents,shipping_cents,total_cents,coupon_code,payment_method,installments,shipping_info,import_ack)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      userId || null, accessToken, 'payment_pending', JSON.stringify(customer), JSON.stringify(address), cart.subtotal, cart.discount, cart.shipping,
      paymentMethod === 'pix' ? cart.pixTotal : cart.total, cart.coupon ? cart.coupon.code : null, paymentMethod, installments || 1,
      JSON.stringify(cart.groups.map((g) => ({ id: g.id, title: g.title, origin: g.origin, carrier: g.selected && g.selected.carrier, price: g.priceCents, daysMin: g.selected && g.selected.daysMin, daysMax: g.selected && g.selected.daysMax }))),
      importAck ? 1 : 0);
    const orderId = Number(r.lastInsertRowid);
    for (const l of cart.lines) {
      await Q.run(`INSERT INTO order_items(order_id,product_id,name,size,qty,unit_cents,custom_name,custom_number,custom_cents,fulfillment,supplier_id,supplier_sku,image) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, l.productId, l.name, l.size, l.qty, l.unitCents, l.custom ? l.custom.name : null, l.custom ? l.custom.number : null, l.customCents, l.fulfillment, l.supplierId, l.supplierSku, l.image);
    }
    await Q.run('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)', orderId, 'received', 'Pedido criado');
    return { id: orderId, accessToken };
  });
}

/** Idempotente: só processa a primeira aprovação. Baixa estoque, registra e dispara fornecedores. */
async function markPaid(orderId, paymentId) {
  const ord = await q.get('SELECT * FROM orders WHERE id=?', orderId);
  if (!ord) return false;
  const won = await tx(async (Q) => {
    // Atualização condicional garante idempotência mesmo com webhooks simultâneos/repetidos.
    const u = await Q.run("UPDATE orders SET status='paid', updated_at=datetime('now') WHERE id=? AND status IN ('received','payment_pending','cancelled')", orderId);
    if (!u.changes) return false;
    if (paymentId) await Q.run("UPDATE payments SET status='approved', paid_at=datetime('now') WHERE id=?", paymentId);
    await Q.run('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)', orderId, 'paid', 'Pagamento aprovado');
    for (const it of await Q.all('SELECT * FROM order_items WHERE order_id=?', orderId)) {
      if (!it.product_id) continue;
      await Q.run('UPDATE products SET sold=sold+? WHERE id=?', it.qty, it.product_id);
      if (it.fulfillment === 'stock') {
        if (it.size) await Q.run('UPDATE variants SET stock=MAX(0,stock-?) WHERE product_id=? AND size=?', it.qty, it.product_id, it.size);
        await Q.run('UPDATE products SET stock=MAX(0,stock-?) WHERE id=?', it.qty, it.product_id);
      }
    }
    if (ord.coupon_code) await Q.run('UPDATE coupons SET uses=uses+1 WHERE code=?', ord.coupon_code);
    for (const g of JSON.parse(ord.shipping_info || '[]')) await Q.run('INSERT INTO shipments(order_id,grp,status) VALUES(?,?,?)', orderId, g.id, 'pending');
    return true;
  });
  if (!won) return false;
  // Em serverless é preciso concluir antes de responder (a função é congelada depois).
  try { await createSupplierOrders(orderId); } catch (e) { console.error('supplier dispatch', e); }
  return true;
}

function buildSupplierMessage(order, items) { return require('./automation').supplierMessage(order, items); }

/** Cria uma ordem de compra por fornecedor e dispara pelo canal configurado (idempotente). */
async function createSupplierOrders(orderId) {
  const A = require('./automation');
  const order = await q.get('SELECT * FROM orders WHERE id=?', orderId);
  const all = await q.all('SELECT * FROM order_items WHERE order_id=? AND supplier_id IS NOT NULL', orderId);
  const bySup = {};
  for (const it of all) (bySup[it.supplier_id] ||= []).push(it);
  for (const [sid, its] of Object.entries(bySup)) {
    const s = await q.get('SELECT * FROM suppliers WHERE id=?', +sid);
    if (!s) continue;
    const message = A.supplierMessage(order, its);
    const wn = onlyDigits(s.whatsapp);
    const link = s.channel === 'whatsapp' && wn ? `https://wa.me/${wn.length <= 11 ? '55' + wn : wn}?text=${encodeURIComponent(message)}` : null;
    const ins = await q.run('INSERT OR IGNORE INTO supplier_orders(order_id,supplier_id,status,channel,message,link,log) VALUES(?,?,?,?,?,?,?)', orderId, s.id, 'awaiting', s.channel, message, link, '[]');
    if (!ins.changes) continue;                                                           // já existia: não cria nem envia de novo
    const so = await q.get('SELECT id FROM supplier_orders WHERE order_id=? AND supplier_id=?', orderId, s.id);
    await setStatus(orderId, 'awaiting_supplier', 'Ordem de compra criada');
    await A.logComm(orderId, so.id, 'out', 'created', 'Ordem criada para envio ao fornecedor', null, 'awaiting');
    await A.dispatchSupplierOrder(so.id);
  }
  try { await A.notifyCustomer(orderId, 'received'); } catch (e) { console.error('email', e.message); }
}
const dispatchSupplierOrder = (id, o) => require('./automation').dispatchSupplierOrder(id, o);
const markSupplierSent = (id) => require('./automation').markManualSent(id);
async function orderView(o) {
  const [itemsRaw, shipments, events, pay] = await Promise.all([q.all('SELECT name,size,qty,unit_cents,custom_name,custom_number,custom_cents,fulfillment,image FROM order_items WHERE order_id=?', o.id), q.all('SELECT grp,carrier,code,url,status,shipped_at FROM shipments WHERE order_id=?', o.id), q.all('SELECT status,created_at FROM order_events WHERE order_id=? ORDER BY id', o.id), q.get('SELECT method,status,pix_code,pix_qr,checkout_url FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1', o.id)]);
  const stepOf = (st) => (st === 'cancelled' || st === 'payment_pending' ? st : TIMELINE[TL_INDEX[st] ?? 0]);
  const ev = events.map((e) => ({ status: stepOf(e.status), label: CUSTOMER_MSG[e.status] || CUSTOMER_LABEL[e.status], created_at: e.created_at })).filter((e, i, a) => !i || a[i - 1].label !== e.label);
  const hasTracking = shipments.some((x) => x.code);
  return {
    id: o.id, ref: 'SIS-' + (10000 + o.id), status: stepOf(o.status), statusLabel: CUSTOMER_LABEL[o.status], customerMessage: CUSTOMER_MSG[o.status] + (hasTracking && ['in_transit', 'shipped'].includes(o.status) ? ' Seu código de rastreio está disponível.' : ''),
    created_at: o.created_at, subtotal: o.subtotal_cents, discount: o.discount_cents, shipping: o.shipping_cents, total: o.total_cents,
    coupon: o.coupon_code, paymentMethod: o.payment_method, installments: o.installments, shipping_info: JSON.parse(o.shipping_info || '[]'), address: JSON.parse(o.address),
    items: itemsRaw, shipments, events: ev, payment: pay,
    timeline: o.status === 'cancelled' ? null : TIMELINE.map((st, i) => ({ status: st, label: TL_LABEL[st], done: i <= (TL_INDEX[o.status] ?? 0), current: i === (TL_INDEX[o.status] ?? 0) })),
  };
}
module.exports = { STATUS, setStatus, createOrder, markPaid, orderView, createSupplierOrders, dispatchSupplierOrder, markSupplierSent, buildSupplierMessage };
