/* Teste ponta a ponta do pós-venda com uma "API do WhatsApp" simulada (nada é enviado de verdade).
 * Uso: node scripts/test-whatsapp-flow.js <banco-clone.db> */
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const path = require('path');

const DB = path.resolve(process.argv[2]);
const sent = [];
// --- API simulada da Meta ---
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d));
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && /\/messages$/.test(req.url)) { const j = JSON.parse(b); sent.push({ auth: req.headers.authorization, ...j }); return res.end(JSON.stringify({ messages: [{ id: 'wamid.MOCK' + sent.length }] })); }
    res.end(JSON.stringify({ display_phone_number: '+55 11 91776-5409', verified_name: 'Sport Imperativo Store', quality_rating: 'GREEN' }));
  });
}).listen(4010);

const env = { ...process.env, DB_FILE: DB, PORT: '3150', WHATSAPP_ACCESS_TOKEN: 'TOKEN_DE_TESTE', WHATSAPP_PHONE_NUMBER_ID: 'PH1', WHATSAPP_API_URL: 'http://localhost:4010/v21.0', WHATSAPP_APP_SECRET: 'segredo', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'vt123', TURSO_DATABASE_URL: '', DATABASE_URL: '' };
const srv = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d));

let cookie = '';
const B = 'http://localhost:3150/api';
const call = async (p, m = 'GET', body, raw, hdr = {}) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', cookie, ...hdr }, body: raw || (body ? JSON.stringify(body) : undefined) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { s: r.status, j };
};
const hook = (payload, secret = 'segredo') => { const raw = JSON.stringify(payload); return call('/webhooks/whatsapp', 'POST', null, raw, { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex') }); };
const inbound = (id, text, replyTo) => ({ entry: [{ changes: [{ value: { messages: [{ id, from: '8613000000000', type: 'text', text: { body: text }, ...(replyTo ? { context: { id: replyTo } } : {}) }] } }] }] });
let fails = 0; const ok = (c, msg) => { console.log((c ? '✔ ' : '✘ ') + msg); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 30; i++) { try { const r = await fetch(B + '/menu'); if (r.ok) break; } catch { /* aguarda */ } await sleep(500); }
  const L = await call('/auth/login', 'POST', { email: 'admin@local.test', password: 'teste12345' }); ok(L.s === 200, 'login admin local');
  // fornecedor + produtos
  await call('/admin/suppliers/1', 'PUT', { name: 'Fornecedor (China)', channel: 'whatsapp', whatsapp: '+86 130 0000 0000', active: 1 });
  const prods = (await call('/products?ship=import')).j.items; const p = prods[0];
  const pd = (await call('/products/' + p.slug)).j.product;
  // marca o produto como do fornecedor (como o importador faz)
  const full = (await call('/admin/products/' + p.id)).j; full.supplier_id = 1; full.entity_ids = full.entity_ids || [];
  await call('/admin/products/' + p.id, 'PUT', full);
  // 1) compra → pagamento simulado
  const items = [{ productId: p.id, size: pd.variants[0].size, qty: 1, custom: { name: 'NEYMAR', number: '10' } }];
  const co = await call('/checkout', 'POST', { items, importAck: true, customer: { name: 'João Silva', cpf: '52998224725', email: 'joao@example.com', phone: '11987654321' }, address: { cep: '01310100', street: 'Rua Exemplo', number: '100', district: 'Bela Vista', city: 'São Paulo', state: 'SP' }, paymentMethod: 'pix', installments: 1 });
  ok(co.s === 200, 'checkout criado: pedido ' + co.j.orderId);
  const oid = co.j.orderId, tok = co.j.token, ref = 'SIS-' + (10000 + oid);
  await call('/dev/pay/' + oid, 'POST', { t: tok });
  await sleep(1200);
  ok(sent.length === 1, 'WhatsApp: 1 envio ao fornecedor após pagamento aprovado');
  const m = sent[0] || {}; if (process.env.DBG) console.log(JSON.stringify(m).slice(0,700));
  ok(m.to === '8613000000000' && m.type === 'template' && m.template && m.template.name === 'novo_pedido_fornecedor', 'enviado como template ao número do fornecedor (+86 130 0000 0000)');
  const params = ((m.template || {}).components || [{}])[0].parameters || [];
  ok(params[0] && params[0].text === '#' + ref && /João Silva/.test(params[1].text) && /NEYMAR/.test(params[2].text) && /Rua Exemplo/.test(params[3].text), 'mensagem contém pedido #' + ref + ', cliente, produto/personalização e endereço');
  ok(!params.some((x) => /\n/.test(x.text)), 'parâmetros do template sem quebras de linha');
  ok(m.auth === 'Bearer TOKEN_DE_TESTE', 'token enviado só no cabeçalho do servidor');
  // 2) idempotência
  const so = (await call('/admin/orders/' + oid)).j.supplierOrders[0];
  const again = await call('/admin/supplier-orders/' + so.id + '/send', 'POST', {});
  ok(again.j.skipped && sent.length === 1, 'reenvio bloqueado (idempotência): ' + JSON.stringify(again.j));
  // 3) o cliente NÃO vê dados do fornecedor
  const cv = (await call('/orders/' + oid + '?t=' + tok)).j; const raw = JSON.stringify(cv);
  ok(!/8613000000000|130 0000|fornecedor|supplier|Fornecedor/i.test(raw), 'resposta ao cliente sem número/nome/termos do fornecedor');
  ok(cv.ref === ref && /preparado/.test(cv.customerMessage), 'cliente vê "' + cv.customerMessage + '" (' + cv.statusLabel + ')');
  const cp = JSON.stringify((await call('/cart/price', 'POST', { items })).j); ok(!/supplier/i.test(cp), 'cart/price sem campos de fornecedor');
  // 4) webhook: verificação e assinatura
  const v = await fetch(B + '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=vt123&hub.challenge=777'); ok(v.status === 200 && (await v.text()) === '777', 'verificação do webhook (GET) ok');
  const bad = await hook(inbound('w1', 'oi'), 'errado'); ok(bad.s === 401, 'assinatura inválida rejeitada');
  // 5) fornecedor confirma (resposta à mensagem enviada)
  await hook(inbound('wamid.IN1', 'Pedido recebido.', 'wamid.MOCK1')); await sleep(300);
  let ad = (await call('/admin/orders/' + oid)).j; if (process.env.DBG) console.log(ad.status, JSON.stringify(ad.comm.slice(-3)));
  ok(ad.status === 'supplier_confirmed', 'status → fornecedor confirmou (por resposta à mensagem)');
  // 6) duplicidade do webhook
  await hook(inbound('wamid.IN1', 'Pedido recebido.', 'wamid.MOCK1')); const n1 = (await call('/admin/orders/' + oid)).j.comm.length; await sleep(100);
  ok((await call('/admin/orders/' + oid)).j.comm.length === n1, 'mensagem repetida do webhook não duplica');
  // 7) rastreio identificado
  await hook(inbound('wamid.IN2', 'BR123456789CN', 'wamid.MOCK1')); await sleep(400);
  ad = (await call('/admin/orders/' + oid)).j;
  ok(ad.status === 'in_transit' && ad.shipments.some((x) => x.code === 'BR123456789CN'), 'rastreio registrado → em trânsito');
  const mails = (await call('/admin/emails')).j; ok(mails.some((x) => x.order_id === oid && /foi enviado/.test(x.subject)), 'e-mail "pedido enviado" gerado para o cliente');
  // 8) rastreio sem identificação → caixa para o admin
  await hook(inbound('wamid.IN3', 'Tracking YT2612345678901234')); await sleep(300);
  const inbox = (await call('/admin/whatsapp/inbox')).j; ok(inbox.length >= 1, 'mensagem não identificada foi para "RASTREIO PRECISA DE IDENTIFICAÇÃO"');
  // 9) remetente desconhecido é ignorado
  const stranger = { entry: [{ changes: [{ value: { messages: [{ id: 'wamid.X', from: '5511999999999', type: 'text', text: { body: 'BR999999999CN' } }] } }] }] };
  await hook(stranger); ok(((await call('/admin/whatsapp/inbox')).j).every((i) => i.wa_from === '8613000000000'), 'mensagens de outros números não acionam automações');
  // 10) status da integração
  const st = (await call('/admin/whatsapp/status')).j; ok(st.state === 'connected', 'painel: WhatsApp conectado (API simulada)');
  ok(!JSON.stringify((await call('/config')).j).match(/8613000000000/), 'número do fornecedor não aparece na config pública');
  console.log(fails ? `\n${fails} FALHA(S)` : '\nTODOS OS TESTES PASSARAM');
  srv.kill(); mock.close(); process.exit(fails ? 1 : 0);
})().catch((e) => { console.error('ERRO NO TESTE', e, out.slice(-1500)); srv.kill(); mock.close(); process.exit(1); });
