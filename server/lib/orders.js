const { q, tx, setting } = require('../db');
const { token, onlyDigits, brl } = require('./util');

const STATUS = {
  received: 'Pedido recebido', payment_pending: 'Aguardando pagamento', paid: 'Pagamento aprovado', awaiting_supplier: 'Aguardando fornecedor',
  sent_supplier: 'Enviado ao fornecedor', supplier_confirmed: 'Fornecedor confirmou', preparing: 'Em preparação', shipped: 'Enviado',
  in_transit: 'Em trânsito', delivered: 'Entregue', cancelled: 'Cancelado',
};
// Linha do tempo exibida ao cliente
const TIMELINE = ['received', 'paid', 'sent_supplier', 'preparing', 'shipped', 'in_transit', 'delivered'];
const TL_LABEL = { received: 'Pedido recebido', paid: 'Pagamento aprovado', sent_supplier: 'Enviado ao fornecedor', preparing: 'Em preparação', shipped: 'Enviado', in_transit: 'Em trânsito', delivered: 'Entregue' };
const TL_INDEX = { received: 0, payment_pending: 0, paid: 1, awaiting_supplier: 1, sent_supplier: 2, supplier_confirmed: 2, preparing: 3, shipped: 4, in_transit: 5, delivered: 6 };

function setStatus(orderId, status, note) {
  q.run("UPDATE orders SET status=?, updated_at=datetime('now') WHERE id=?", status, orderId);
  q.run('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)', orderId, status, note || null);
}

function createOrder({ cart, customer, address, userId, paymentMethod, installments, importAck }) {
  return tx(() => {
    const accessToken = token(18);
    const r = q.run(
      `INSERT INTO orders(user_id,access_token,status,customer,address,subtotal_cents,discount_cents,shipping_cents,total_cents,coupon_code,payment_method,installments,shipping_info,import_ack)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      userId || null, accessToken, 'payment_pending', JSON.stringify(customer), JSON.stringify(address), cart.subtotal, cart.discount, cart.shipping,
      paymentMethod === 'pix' ? cart.pixTotal : cart.total, cart.coupon ? cart.coupon.code : null, paymentMethod, installments || 1,
      JSON.stringify(cart.groups.map((g) => ({ id: g.id, title: g.title, origin: g.origin, carrier: g.selected && g.selected.carrier, price: g.priceCents, daysMin: g.selected && g.selected.daysMin, daysMax: g.selected && g.selected.daysMax }))),
      importAck ? 1 : 0);
    const orderId = Number(r.lastInsertRowid);
    for (const l of cart.lines) {
      q.run(`INSERT INTO order_items(order_id,product_id,name,size,qty,unit_cents,custom_name,custom_number,custom_cents,fulfillment,supplier_id,supplier_sku,image) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, l.productId, l.name, l.size, l.qty, l.unitCents, l.custom ? l.custom.name : null, l.custom ? l.custom.number : null, l.customCents, l.fulfillment, l.supplierId, l.supplierSku, l.image);
    }
    q.run('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)', orderId, 'received', 'Pedido criado');
    return { id: orderId, accessToken };
  });
}

/** Idempotente: só processa a primeira aprovação. Baixa estoque, registra e dispara fornecedores. */
function markPaid(orderId, paymentId) {
  const ord = q.get('SELECT * FROM orders WHERE id=?', orderId);
  if (!ord || ['paid', 'awaiting_supplier', 'sent_supplier', 'supplier_confirmed', 'preparing', 'shipped', 'in_transit', 'delivered'].includes(ord.status)) return false;
  tx(() => {
    if (paymentId) q.run("UPDATE payments SET status='approved', paid_at=datetime('now') WHERE id=?", paymentId);
    setStatus(orderId, 'paid', 'Pagamento aprovado');
    for (const it of q.all('SELECT * FROM order_items WHERE order_id=?', orderId)) {
      if (!it.product_id) continue;
      q.run('UPDATE products SET sold=sold+? WHERE id=?', it.qty, it.product_id);
      if (it.fulfillment === 'stock') {
        if (it.size) q.run('UPDATE variants SET stock=MAX(0,stock-?) WHERE product_id=? AND size=?', it.qty, it.product_id, it.size);
        q.run('UPDATE products SET stock=MAX(0,stock-?) WHERE id=?', it.qty, it.product_id);
      }
    }
    if (ord.coupon_code) q.run('UPDATE coupons SET uses=uses+1 WHERE code=?', ord.coupon_code);
    for (const g of JSON.parse(ord.shipping_info || '[]')) q.run('INSERT INTO shipments(order_id,grp,status) VALUES(?,?,?)', orderId, g.id, 'pending');
  });
  createSupplierOrders(orderId).catch((e) => console.error('supplier dispatch', e));
  return true;
}

function buildSupplierMessage(order, items) {
  const a = JSON.parse(order.address), c = JSON.parse(order.customer);
  const lines = ['*NOVO PEDIDO — SPORT IMPERATIVO STORE*', `Pedido: #${order.id}`, ''];
  items.forEach((it, i) => {
    lines.push(`Produto${items.length > 1 ? ' ' + (i + 1) : ''}:`, it.name + (it.supplier_sku ? ` (SKU ${it.supplier_sku})` : ''), 'Tamanho:', it.size || '-', 'Personalização:',
      it.custom_name || it.custom_number ? `Nome: ${it.custom_name || '-'}\nNúmero: ${it.custom_number || '-'}` : 'Sem personalização', 'Quantidade:', String(it.qty), '');
  });
  lines.push('Cliente:', c.name, 'Destino:', `${a.city}/${a.state}`, 'CEP:', a.cep, 'Observações:', order.notes || '-');
  return lines.join('\n');
}

/** Cria uma ordem de compra por fornecedor e dispara pelo canal configurado. */
async function createSupplierOrders(orderId) {
  const order = q.get('SELECT * FROM orders WHERE id=?', orderId);
  const items = q.all("SELECT * FROM order_items WHERE order_id=? AND supplier_id IS NOT NULL AND fulfillment='import'", orderId);
  // Itens com fornecedor associado (importados e também pronta entrega com fornecedor dropship)
  const all = q.all('SELECT * FROM order_items WHERE order_id=? AND supplier_id IS NOT NULL', orderId);
  const bySup = {};
  for (const it of (all.length ? all : items)) (bySup[it.supplier_id] ||= []).push(it);
  if (!Object.keys(bySup).length) return;
  for (const [sid, its] of Object.entries(bySup)) {
    const s = q.get('SELECT * FROM suppliers WHERE id=?', +sid);
    if (!s) continue;
    const message = buildSupplierMessage(order, its);
    const wa = onlyDigits(s.whatsapp);
    const link = s.channel === 'whatsapp' && wa ? `https://wa.me/${wa.length <= 11 ? '55' + wa : wa}?text=${encodeURIComponent(message)}` : null;
    const so = q.run('INSERT INTO supplier_orders(order_id,supplier_id,status,channel,message,link,log) VALUES(?,?,?,?,?,?,?)', orderId, s.id, 'awaiting', s.channel, message, link, '[]');
    const soId = Number(so.lastInsertRowid);
    setStatus(orderId, 'awaiting_supplier', `Ordem de compra criada para ${s.name}`);
    await dispatchSupplierOrder(soId);
  }
}
async function dispatchSupplierOrder(soId) {
  const so = q.get('SELECT * FROM supplier_orders WHERE id=?', soId);
  const s = q.get('SELECT * FROM suppliers WHERE id=?', so.supplier_id);
  const log = JSON.parse(so.log || '[]');
  let sent = false;
  try {
    if (so.channel === 'webhook' && s.webhook_url) {
      const r = await fetch(s.webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: so.order_id, supplier_order_id: so.id, message: so.message }), signal: AbortSignal.timeout(10000) });
      log.push({ at: new Date().toISOString(), note: `Webhook HTTP ${r.status}` });
      sent = r.ok;
    } else {
      // WhatsApp (link wa.me pré-preenchido) e e-mail ficam como envio assistido no painel até haver integração de API/SMTP.
      log.push({ at: new Date().toISOString(), note: `Aguardando envio manual via ${so.channel} (use o botão no painel).` });
    }
  } catch (e) { log.push({ at: new Date().toISOString(), note: 'Falha: ' + e.message }); }
  q.run('UPDATE supplier_orders SET log=?, status=?, sent_at=CASE WHEN ? THEN datetime(\'now\') ELSE sent_at END WHERE id=?', JSON.stringify(log), sent ? 'sent' : so.status, sent ? 1 : 0, soId);
  if (sent) setStatus(so.order_id, 'sent_supplier', 'Pedido enviado ao fornecedor (' + s.name + ')');
}
function markSupplierSent(soId) {
  const so = q.get('SELECT * FROM supplier_orders WHERE id=?', soId);
  const log = JSON.parse(so.log || '[]'); log.push({ at: new Date().toISOString(), note: 'Marcado como enviado pelo administrador' });
  q.run("UPDATE supplier_orders SET status='sent', sent_at=datetime('now'), log=? WHERE id=?", JSON.stringify(log), soId);
  setStatus(so.order_id, 'sent_supplier', 'Pedido enviado ao fornecedor');
}

function orderView(o) {
  const items = q.all('SELECT * FROM order_items WHERE order_id=?', o.id);
  const shipments = q.all('SELECT grp,carrier,code,url,status FROM shipments WHERE order_id=?', o.id);
  const events = q.all('SELECT status,note,created_at FROM order_events WHERE order_id=? ORDER BY id', o.id);
  const pay = q.get('SELECT method,status,pix_code,pix_qr,checkout_url FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1', o.id);
  return {
    id: o.id, status: o.status, statusLabel: STATUS[o.status], created_at: o.created_at, subtotal: o.subtotal_cents, discount: o.discount_cents, shipping: o.shipping_cents, total: o.total_cents,
    coupon: o.coupon_code, paymentMethod: o.payment_method, installments: o.installments, shipping_info: JSON.parse(o.shipping_info || '[]'), address: JSON.parse(o.address),
    items, shipments, events, payment: pay,
    timeline: o.status === 'cancelled' ? null : TIMELINE.map((s, i) => ({ status: s, label: TL_LABEL[s], done: i <= (TL_INDEX[o.status] ?? 0), current: i === (TL_INDEX[o.status] ?? 0) })),
  };
}
module.exports = { STATUS, setStatus, createOrder, markPaid, orderView, createSupplierOrders, dispatchSupplierOrder, markSupplierSent, buildSupplierMessage };
