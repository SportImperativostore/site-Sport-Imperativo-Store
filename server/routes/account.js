const express = require('express');
const { q, tx, audit } = require('../db');
const A = require('../lib/auth');
const cat = require('../lib/catalog');
const { priceCart } = require('../lib/cart');
const orders = require('../lib/orders');
const pay = require('../lib/payments');
const { wrap, HttpError, validEmail, validCPF, onlyDigits, rateLimit } = require('../lib/util');

const r = express.Router();
const lim = rateLimit('auth', 20, 10 * 60 * 1000);

r.post('/auth/register', lim, wrap(async (req, res) => {
  const { name, email, password, cpf, phone, consent } = req.body || {};
  if (!name || String(name).trim().length < 3) throw new HttpError(400, 'Informe seu nome completo.');
  if (!validEmail(email)) throw new HttpError(400, 'E-mail inválido.');
  if (!password || String(password).length < 8) throw new HttpError(400, 'A senha deve ter ao menos 8 caracteres.');
  if (cpf && !validCPF(cpf)) throw new HttpError(400, 'CPF inválido.');
  if (!consent) throw new HttpError(400, 'É necessário aceitar a Política de Privacidade e os Termos de Uso.');
  const mail = String(email).toLowerCase().trim();
  if (await q.get('SELECT 1 x FROM users WHERE email=?', mail)) throw new HttpError(409, 'Este e-mail já está cadastrado.');
  const id = Number((await q.run('INSERT INTO users(name,email,password_hash,cpf,phone,consent_at) VALUES(?,?,?,?,?,datetime(\'now\'))', String(name).trim().slice(0, 100), mail, A.hashPassword(String(password)), onlyDigits(cpf) || null, onlyDigits(phone) || null)).lastInsertRowid);
  await A.startSession(res, id);
  res.json({ user: await q.get('SELECT id,name,email,cpf,phone,whatsapp,role FROM users WHERE id=?', id) });
}));
r.post('/auth/login', lim, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const u = await q.get('SELECT * FROM users WHERE email=? AND deleted_at IS NULL', String(email || '').toLowerCase().trim());
  if (!u || !A.verifyPassword(String(password || ''), u.password_hash)) { await audit(null, 'login_fail', email, req.ip); throw new HttpError(401, 'E-mail ou senha incorretos.'); }
  await A.startSession(res, u.id);
  await audit(u.id, 'login', '', req.ip);
  res.json({ user: { id: u.id, name: u.name, email: u.email, cpf: u.cpf, phone: u.phone, whatsapp: u.whatsapp, role: u.role } });
}));
r.post('/auth/logout', async (req, res) => { await A.endSession(req, res); res.json({ ok: true }); });
r.get('/auth/me', async (req, res) => {
  const favs = req.user ? (await q.all('SELECT product_id FROM favorites WHERE user_id=?', req.user.id)).map((x) => x.product_id) : [];
  res.json({ user: req.user, favorites: favs });
});

/* ---------- Conta ---------- */
r.put('/account/profile', A.requireUser, wrap(async (req, res) => {
  const { name, phone, whatsapp, cpf } = req.body || {};
  if (cpf && !validCPF(cpf)) throw new HttpError(400, 'CPF inválido.');
  await q.run('UPDATE users SET name=?, phone=?, whatsapp=?, cpf=? WHERE id=?', String(name || req.user.name).slice(0, 100), onlyDigits(phone) || null, onlyDigits(whatsapp) || null, onlyDigits(cpf) || null, req.user.id);
  res.json({ user: await q.get('SELECT id,name,email,cpf,phone,whatsapp,role FROM users WHERE id=?', req.user.id) });
}));
r.put('/account/password', A.requireUser, lim, wrap(async (req, res) => {
  const { current, next } = req.body || {};
  const u = await q.get('SELECT password_hash FROM users WHERE id=?', req.user.id);
  if (!A.verifyPassword(String(current || ''), u.password_hash)) throw new HttpError(400, 'Senha atual incorreta.');
  if (!next || String(next).length < 8) throw new HttpError(400, 'A nova senha deve ter ao menos 8 caracteres.');
  await q.run('UPDATE users SET password_hash=? WHERE id=?', A.hashPassword(String(next)), req.user.id);
  await q.run('DELETE FROM sessions WHERE user_id=?', req.user.id);
  await A.startSession(res, req.user.id);
  res.json({ ok: true });
}));
r.get('/account/addresses', A.requireUser, async (req, res) => res.json(await q.all('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id', req.user.id)));
r.post('/account/addresses', A.requireUser, wrap(async (req, res) => {
  const a = req.body || {};
  if (onlyDigits(a.cep).length !== 8 || !a.street || !a.number || !a.city || !a.state) throw new HttpError(400, 'Preencha o endereço completo.');
  if (a.is_default) await q.run('UPDATE addresses SET is_default=0 WHERE user_id=?', req.user.id);
  await q.run('INSERT INTO addresses(user_id,label,cep,street,number,complement,district,city,state,is_default) VALUES(?,?,?,?,?,?,?,?,?,?)', req.user.id, a.label || 'Casa', onlyDigits(a.cep), a.street, a.number, a.complement || '', a.district || '', a.city, String(a.state).toUpperCase().slice(0, 2), a.is_default ? 1 : 0);
  res.json({ ok: true });
}));
r.delete('/account/addresses/:id', A.requireUser, async (req, res) => { await q.run('DELETE FROM addresses WHERE id=? AND user_id=?', +req.params.id, req.user.id); res.json({ ok: true }); });

r.get('/account/orders', A.requireUser, async (req, res) => res.json(await Promise.all((await q.all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', req.user.id)).map(orders.orderView))));
r.get('/orders/:id', wrap(async (req, res) => {
  const o = await q.get('SELECT * FROM orders WHERE id=?', +req.params.id);
  const okToken = o && req.query.t && o.access_token === String(req.query.t);
  if (!o || !(okToken || (req.user && (req.user.id === o.user_id || req.user.role === 'admin')))) throw new HttpError(404, 'Pedido não encontrado.');
  res.json(await orders.orderView(o));
}));

r.get('/account/favorites', A.requireUser, async (req, res) => res.json(await cat.cards(await q.all('SELECT p.* FROM favorites f JOIN products p ON p.id=f.product_id WHERE f.user_id=? AND p.active=1', req.user.id))));
r.post('/account/favorites/:id', A.requireUser, async (req, res) => {
  const id = +req.params.id;
  const has = await q.get('SELECT 1 x FROM favorites WHERE user_id=? AND product_id=?', req.user.id, id);
  if (has) await q.run('DELETE FROM favorites WHERE user_id=? AND product_id=?', req.user.id, id);
  else if (await q.get('SELECT 1 x FROM products WHERE id=?', id)) await q.run('INSERT INTO favorites(user_id,product_id) VALUES(?,?)', req.user.id, id);
  res.json({ favorite: !has });
});
r.get('/account/coupons', A.requireUser, async (_req, res) => res.json(await q.all("SELECT code,type,value,min_cents,ends_at,description,first_purchase FROM coupons WHERE active=1 AND is_public=1 AND (ends_at IS NULL OR ends_at='' OR ends_at>=datetime('now'))")));
r.get('/account/reviews', A.requireUser, async (req, res) => res.json(await q.all('SELECT r.id,r.stars,r.body,r.status,r.created_at,p.name product FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.user_id=? ORDER BY r.id DESC', req.user.id)));
r.post('/products/:id/reviews', A.requireUser, wrap(async (req, res) => {
  const pid = +req.params.id;
  const bought = await q.get(`SELECT 1 x FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.user_id=? AND i.product_id=? AND o.status IN ('paid','awaiting_supplier','sent_supplier','supplier_confirmed','preparing','shipped','in_transit','delivered')`, req.user.id, pid);
  if (!bought) throw new HttpError(403, 'Apenas clientes que compraram o produto podem avaliar.');
  const { stars, body } = req.body || {};
  const s = Math.round(+stars);
  if (!(s >= 1 && s <= 5)) throw new HttpError(400, 'Escolha de 1 a 5 estrelas.');
  if (await q.get('SELECT 1 x FROM reviews WHERE user_id=? AND product_id=?', req.user.id, pid)) throw new HttpError(409, 'Você já avaliou este produto.');
  const photos = (Array.isArray(req.body.photos) ? req.body.photos : []).filter((u) => /^\/uploads\/[\w.\-]+$/.test(u)).slice(0, 4);
  await q.run('INSERT INTO reviews(product_id,user_id,author,stars,body,photos,video_url,status) VALUES(?,?,?,?,?,?,?,?)', pid, req.user.id, req.user.name.split(' ')[0], s, String(body || '').slice(0, 1500), JSON.stringify(photos), null, 'pending');
  res.json({ ok: true, message: 'Obrigado! Sua avaliação será publicada após moderação.' });
}));

// LGPD: exportação e exclusão (anonimização) de dados
r.get('/account/export', A.requireUser, async (req, res) => {
  const id = req.user.id;
  res.attachment('meus-dados-sport-imperativo.json').json({
    usuario: await q.get('SELECT id,name,email,cpf,phone,whatsapp,created_at,consent_at FROM users WHERE id=?', id), enderecos: await q.all('SELECT * FROM addresses WHERE user_id=?', id),
    pedidos: await q.all('SELECT * FROM orders WHERE user_id=?', id), favoritos: await q.all('SELECT product_id FROM favorites WHERE user_id=?', id), avaliacoes: await q.all('SELECT * FROM reviews WHERE user_id=?', id),
  });
});
r.post('/account/delete', A.requireUser, wrap(async (req, res) => {
  const u = await q.get('SELECT password_hash FROM users WHERE id=?', req.user.id);
  if (!A.verifyPassword(String((req.body || {}).password || ''), u.password_hash)) throw new HttpError(400, 'Senha incorreta.');
  await tx(async (Q) => {
    await Q.run("UPDATE users SET name='Usuário removido', email=?, cpf=NULL, phone=NULL, whatsapp=NULL, password_hash='x', deleted_at=datetime('now') WHERE id=?", `removido-${req.user.id}@invalid.local`, req.user.id);
    await Q.run('DELETE FROM addresses WHERE user_id=?', req.user.id); await Q.run('DELETE FROM favorites WHERE user_id=?', req.user.id); await Q.run('DELETE FROM sessions WHERE user_id=?', req.user.id);
  });
  await audit(req.user.id, 'account_deleted', '', req.ip);
  await A.endSession(req, res); res.json({ ok: true });
}));

/* ---------- Checkout ---------- */
r.post('/checkout', rateLimit('checkout', 30, 10 * 60 * 1000), wrap(async (req, res) => {
  const b = req.body || {};
  const c = b.customer || {}, a = b.address || {};
  if (!c.name || String(c.name).trim().split(/\s+/).length < 2) throw new HttpError(400, 'Informe seu nome completo.');
  if (!validCPF(c.cpf)) throw new HttpError(400, 'CPF inválido.');
  if (!validEmail(c.email)) throw new HttpError(400, 'E-mail inválido.');
  if (onlyDigits(c.phone).length < 10) throw new HttpError(400, 'Telefone inválido.');
  if (onlyDigits(a.cep).length !== 8 || !a.street || !a.number || !a.district || !a.city || !/^[A-Za-z]{2}$/.test(a.state || '')) throw new HttpError(400, 'Endereço incompleto.');
  if (!['pix', 'card'].includes(b.paymentMethod)) throw new HttpError(400, 'Escolha a forma de pagamento.');
  const cart = await priceCart({ items: b.items, cep: a.cep, method: b.method, coupon: b.coupon, userId: req.user && req.user.id });
  if (cart.needCep) throw new HttpError(400, 'Não foi possível calcular o frete.');
  if (cart.hasImport && !b.importAck) throw new HttpError(400, 'Confirme que está ciente das condições de envio de produtos importados.');
  const customer = { name: String(c.name).trim().slice(0, 100), cpf: onlyDigits(c.cpf), email: String(c.email).toLowerCase().trim(), phone: onlyDigits(c.phone), whatsapp: onlyDigits(c.whatsapp || c.phone) };
  const address = { cep: onlyDigits(a.cep), street: String(a.street).slice(0, 120), number: String(a.number).slice(0, 12), complement: String(a.complement || '').slice(0, 60), district: String(a.district).slice(0, 80), city: String(a.city).slice(0, 80), state: String(a.state).toUpperCase() };
  const inst = Math.max(1, Math.min(cart.installments.max, parseInt(b.installments, 10) || 1));
  const order = await orders.createOrder({ cart, customer, address, userId: req.user && req.user.id, paymentMethod: b.paymentMethod, installments: inst, importAck: !!b.importAck });
  if (req.user && !req.user.cpf) await q.run('UPDATE users SET cpf=? WHERE id=?', customer.cpf, req.user.id);
  const baseUrl = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const row = await q.get('SELECT * FROM orders WHERE id=?', order.id);
  try { await pay.createPayment(row, baseUrl); } catch (e) { console.error('payment', e.message); await orders.setStatus(order.id, 'cancelled', 'Falha ao criar pagamento'); throw new HttpError(e.userMessage ? 422 : 502, e.userMessage || 'Não foi possível iniciar o pagamento. Tente novamente.'); }
  res.json({ orderId: order.id, token: order.accessToken });
}));

// Webhook do gateway
r.post('/webhooks/mercadopago', wrap(async (req, res) => { try { await pay.handleMercadoPagoWebhook(req.body, req.query); } catch (e) { console.error('webhook', e.message); } res.sendStatus(200); }));
// Simulação de pagamento (SOMENTE modo mock, sem credenciais de gateway configuradas)
r.post('/dev/pay/:id', wrap(async (req, res) => {
  if (pay.provider() !== 'mock') throw new HttpError(404, 'Indisponível.');
  const o = await q.get('SELECT * FROM orders WHERE id=?', +req.params.id);
  if (!o || o.access_token !== String((req.body || {}).t || '')) throw new HttpError(404, 'Pedido não encontrado.');
  const p = await q.get('SELECT * FROM payments WHERE order_id=? ORDER BY id DESC LIMIT 1', o.id);
  await orders.markPaid(o.id, p && p.id);
  res.json({ ok: true });
}));
r.get('/payment-mode', async (_req, res) => res.json({ provider: pay.provider() }));
module.exports = r;
