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
  const order = await q.get('SELECT * FROM orders WHERE id=?', orderId);
  // Itens com fornecedor associado (importados e também pronta entrega com fornecedor dropship)
  const all = await q.all('SELECT * FROM order_items WHERE order_id=? AND supplier_id IS NOT NULL', orderId);
  const bySup = {};
  for (const it of all) (bySup[it.supplier_id] ||= []).push(it);
  if (!Object.keys(bySup).length) return;
  for (const [sid, its] of Object.entries(bySup)) {
    const s = await q.get('SELECT * FROM suppliers WHERE id=?', +sid);
    if (!s) continue;
    const message = buildSupplierMessage(order, its);
    const wa = onlyDigits(s.whatsapp);
    const link = s.channel === 'whatsapp' && wa ? `https://wa.me/${wa.length <= 11 ? '55' + wa : wa}?text=${encodeURIComponent(message)}` : null;
    const so = await q.run('INSERT INTO supplier_orders(order_id,supplier_id,status,channel,message,link,log) VALUES(?,?,?,?,?,?,?)', orderId, s.id, 'awaiting', s.channel, message, link, '[]');
    const soId = Number(so.lastInsertRowid);
    await setStatus(orderId, 'awaiting_supplier', `Ordem de compra criada para ${s.name}`);
    await dispatchSupplierOrder(soId);
  }
}
async function dispatchSupplierOrder(soId) {
  const so = await q.get('SELECT * FROM supplier_orders WHERE id=?', soId);
  const s = await q.get('SELECT * FROM suppliers WHERE id=?', so.supplier_id);
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
  await q.run('UPDATE supplier_orders SET log=?, status=?, sent_at=CASE WHEN ? THEN datetime(\'now\') ELSE sent_at END WHERE id=?', JSON.stringify(log), sent ? 'sent' : so.status, sent ? 1 : 0, soId);
  if (sent) await setStatus(so.order_id, 'sent_supplier', 'Pedido enviado ao fornecedor (' + s.name + ')');
}
async function markSupplierSent(soId) {
  const so = await q.get('SELECT * FROM supplier_orders WHERE id=?', soId);
  const log = JSON.parse(so.log || '[]'); log.push({ at: new Date().toISOString(), note: 'Marcado como enviado pelo administrador' });
  await q.run("UPDATE supplier_orders SET status='sent', sent_at=datetime('now'), log=? WHERE id=?", JSON.stringify(log), soId);
  await setStatus(so.order_id, 'sent_supplier', 'Pedido enviado ao fornecedor');
}

async function orderView(o) {
  const [items, shipments, events, pay] = await Promise.all([q.all('SELECT * FROM order_items WHERE order_id=?', o.id), q.all('SELECT grp,carrier,code,url,status FROM shipments WHERE order_id=?', o.id), q.all('SELECT status,note,created_at FROM order_events WHERE order_id=? ORDER BY id', o.id), q.get('SELECT method,status,pix_code,pix_qr,checkout_url FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1', o.id)]);
  return {
    id: o.id, status: o.status, statusLabel: STATUS[o.status], created_at: o.created_at, subtotal: o.subtotal_cents, discount: o.discount_cents, shipping: o.shipping_cents, total: o.total_cents,
    coupon: o.coupon_code, paymentMethod: o.payment_method, installments: o.installments, shipping_info: JSON.parse(o.shipping_info || '[]'), address: JSON.parse(o.address),
    items, shipments, events, payment: pay,
    timeline: o.status === 'cancelled' ? null : TIMELINE.map((s, i) => ({ status: s, label: TL_LABEL[s], done: i <= (TL_INDEX[o.status] ?? 0), current: i === (TL_INDEX[o.status] ?? 0) })),
  };
}
module.exports = { STATUS, setStatus, createOrder, markPaid, orderView, createSupplierOrders, dispatchSupplierOrder, markSupplierSent, buildSupplierMessage };
