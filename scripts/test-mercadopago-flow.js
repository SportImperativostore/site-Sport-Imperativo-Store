/* Teste ponta a ponta do pagamento com um "Mercado Pago" simulado (nada é cobrado de verdade).
 * Uso: node scripts/test-mercadopago-flow.js <banco-clone.db> */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const DB = path.resolve(process.argv[2]);
const state = { payments: {}, prefs: [], calls: [] };
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    state.calls.push({ m: req.method, u: req.url, auth: req.headers.authorization });
    if (req.method === 'POST' && req.url === '/v1/payments') {
      const j = JSON.parse(b); const id = 9000 + Object.keys(state.payments).length;
      state.payments[id] = { id, status: state.rejectNext ? 'rejected' : 'pending', external_reference: j.external_reference, transaction_amount: j.transaction_amount, status_detail: state.rejectNext ? 'rejected_high_risk' : 'pending_waiting_transfer' };
      return res.end(JSON.stringify({ id, point_of_interaction: { transaction_data: { qr_code: '00020126MOCKPIX' + id, qr_code_base64: 'QVNE' } } }));
    }
    if (req.method === 'POST' && req.url === '/checkout/preferences') {
      const j = JSON.parse(b); state.prefs.push(j);
      return res.end(JSON.stringify({ id: 'PREF' + state.prefs.length, init_point: 'http://localhost:4020/checkout/PREF' + state.prefs.length }));
    }
    const m = req.url.match(/^\/v1\/payments\/(\d+)/);
    if (m && state.payments[m[1]]) return res.end(JSON.stringify(state.payments[m[1]]));
    res.statusCode = 404; res.end('{"message":"not found"}');
  });
}).listen(4020);

const env = { ...process.env, DB_FILE: DB, PORT: '3151', MP_ACCESS_TOKEN: 'TOKEN_MP_DE_TESTE', MP_API_URL: 'http://localhost:4020', WHATSAPP_ACCESS_TOKEN: '', TURSO_DATABASE_URL: '', DATABASE_URL: '' };
const srv = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));

let cookie = '';
const B = 'http://localhost:3151/api';
const call = async (p, m = 'GET', body, hdr = {}) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', cookie, ...hdr }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
};
let fails = 0; const ok = (c, msg) => { console.log((c ? '✔ ' : '✘ ') + msg); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const customer = { name: 'Maria Souza', cpf: '52998224725', email: 'maria@example.com', phone: '11987654321' };
const address = { cep: '01310100', street: 'Rua Exemplo', number: '100', district: 'Bela Vista', city: 'São Paulo', state: 'SP' };

(async () => {
  for (let i = 0; i < 30; i++) { try { const r = await fetch(B + '/menu'); if (r.ok) break; } catch { /* aguarda */ } await sleep(500); }
  await call('/auth/login', 'POST', { email: 'admin@local.test', password: 'teste12345' });
  const p = (await call('/products?ship=import&custom=1')).j.items[0];
  const pd = (await call('/products/' + p.slug)).j.product;
  const items = [{ productId: p.id, size: pd.variants[0].size, qty: 1, custom: { patch: 'Libertadores' } }];

  // 1) Pix
  const pix = await call('/checkout', 'POST', { items, importAck: true, customer, address, paymentMethod: 'pix', installments: 1 });
  ok(pix.s === 200 && pix.j.orderId, 'checkout Pix criado: pedido ' + pix.j.orderId);
  const o1 = (await call('/orders/' + pix.j.orderId + '?t=' + pix.j.token)).j;
  ok(JSON.stringify(o1).includes('MOCKPIX'), 'código Pix copia-e-cola veio do gateway');
  ok(state.calls.some((c) => c.u === '/v1/payments' && c.auth === 'Bearer TOKEN_MP_DE_TESTE'), 'token usado só no servidor (cabeçalho Authorization)');
  ok(o1.status === 'payment_pending', 'pedido aguardando pagamento antes da aprovação');
  // 2) webhook de pagamento aprovado
  const pid = Object.keys(state.payments)[0]; state.payments[pid].status = 'approved'; state.payments[pid].status_detail = 'accredited';
  const w = await call('/webhooks/mercadopago?data.id=' + pid + '&type=payment', 'POST', { type: 'payment', data: { id: pid } }); ok(w.s === 200, 'webhook respondeu 200');
  await sleep(500);
  const a1 = (await call('/admin/orders/' + pix.j.orderId)).j;
  ok(a1.status !== 'payment_pending' && a1.status !== 'cancelled', 'pedido pago após aprovação (status: ' + a1.status + ')');
  // 3) webhook repetido não duplica
  const evN = a1.events.length; await call('/webhooks/mercadopago?data.id=' + pid, 'POST', { data: { id: pid } }); await sleep(300);
  ok((await call('/admin/orders/' + pix.j.orderId)).j.events.length === evN, 'webhook repetido não duplica eventos');
  // 4) webhook falso (pagamento inexistente) não altera nada
  const fake = await call('/webhooks/mercadopago?data.id=123456789', 'POST', { data: { id: '123456789' } }); ok(fake.s === 200, 'webhook com id desconhecido é ignorado sem erro');
  // 5) valor menor que o do pedido NÃO aprova
  const pix2 = await call('/checkout', 'POST', { items, importAck: true, customer, address, paymentMethod: 'pix', installments: 1 });
  const pid2 = Object.keys(state.payments)[1]; state.payments[pid2].status = 'approved'; state.payments[pid2].transaction_amount = 1;
  await call('/webhooks/mercadopago?data.id=' + pid2, 'POST', { data: { id: pid2 } }); await sleep(400);
  ok((await call('/admin/orders/' + pix2.j.orderId)).j.status === 'payment_pending', 'pagamento com valor menor que o pedido não é aprovado');
  // 5b) Pix recusado pelo antifraude logo após criar → o cliente recebe mensagem clara (sem QR morto)
  state.rejectNext = true;
  const rej = await call('/checkout', 'POST', { items, importAck: true, customer, address, paymentMethod: 'pix', installments: 1 });
  state.rejectNext = false;
  ok(rej.s === 422 && /recusado/i.test(JSON.stringify(rej.j)), 'Pix recusado pelo gateway → mensagem clara ao cliente: ' + JSON.stringify(rej.j));
  // 6) cartão → Checkout Pro
  const card = await call('/checkout', 'POST', { items, importAck: true, customer, address, paymentMethod: 'card', installments: 6 });
  ok(card.s === 200, 'checkout cartão criado');
  const pref = state.prefs[0] || {};
  ok(/localhost:4020\/checkout\/PREF1/.test(JSON.stringify((await call('/orders/' + card.j.orderId + '?t=' + card.j.token)).j)) || card.j.checkoutUrl || card.j.redirect, 'cliente é levado ao checkout hospedado do Mercado Pago');
  ok(pref.payment_methods && pref.payment_methods.installments === 6 && /\/api\/webhooks\/mercadopago$/.test(pref.notification_url || ''), 'preferência com parcelas e URL de notificação');
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  srv.kill(); mock.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE', e, out.slice(-1500)); srv.kill(); mock.close(); process.exit(1); });
