/* Cliente da WhatsApp Business Platform (Cloud API oficial da Meta).
 * TODAS as credenciais ficam em variáveis de ambiente do servidor — nunca vão ao frontend.
 *   WHATSAPP_ACCESS_TOKEN            token permanente (usuário do sistema)
 *   WHATSAPP_PHONE_NUMBER_ID         ID do número da loja (+55 11 91776-5409) na plataforma
 *   WHATSAPP_BUSINESS_ACCOUNT_ID     WABA ID
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN    texto secreto escolhido por você (verificação do webhook)
 *   WHATSAPP_APP_SECRET              "App Secret" do app da Meta (valida a assinatura dos webhooks)
 *   WHATSAPP_API_URL                 padrão https://graph.facebook.com/v21.0
 *   WHATSAPP_SUPPLIER_TEMPLATE       nome do template aprovado (padrão: novo_pedido_fornecedor)
 *   WHATSAPP_TEMPLATE_LANG           idioma do template (padrão: pt_BR)
 *   WHATSAPP_SUPPLIER_NUMBER         (opcional) número do fornecedor; senão usa o cadastrado em Fornecedores
 * Nenhuma automação de WhatsApp Web/Selenium/Puppeteer/QR Code é usada — apenas a API oficial. */
const crypto = require('crypto');

const cfg = () => ({
  token: process.env.WHATSAPP_ACCESS_TOKEN || '',
  phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
  verifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
  appSecret: process.env.WHATSAPP_APP_SECRET || '',
  api: (process.env.WHATSAPP_API_URL || 'https://graph.facebook.com/v21.0').replace(/\/+$/, ''),
  template: process.env.WHATSAPP_SUPPLIER_TEMPLATE || 'novo_pedido_fornecedor',
  lang: process.env.WHATSAPP_TEMPLATE_LANG || 'pt_BR',
});
const digits = (p) => String(p || '').replace(/\D/g, '');
const isConfigured = () => { const c = cfg(); return !!(c.token && c.phoneId); };
/** Quais variáveis estão definidas (apenas sim/não — nunca os valores). */
const envStatus = () => { const c = cfg(); return { WHATSAPP_ACCESS_TOKEN: !!c.token, WHATSAPP_PHONE_NUMBER_ID: !!c.phoneId, WHATSAPP_BUSINESS_ACCOUNT_ID: !!c.wabaId, WHATSAPP_WEBHOOK_VERIFY_TOKEN: !!c.verifyToken, WHATSAPP_APP_SECRET: !!c.appSecret, WHATSAPP_API_URL: !!process.env.WHATSAPP_API_URL }; };

async function post(body) {
  const c = cfg();
  if (!isConfigured()) throw new Error('WhatsApp Business API não configurada.');
  const res = await fetch(`${c.api}/${c.phoneId}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', ...body }), signal: AbortSignal.timeout(15000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const er = j.error || {}; const e = new Error(`WhatsApp API ${res.status}: ${er.message || 'erro'}${er.code ? ' (código ' + er.code + ')' : ''}`); e.code = er.code; e.status = res.status; throw e; }
  return (j.messages && j.messages[0] && j.messages[0].id) || null;
}
/** Texto livre — só funciona dentro da janela de 24 h após uma mensagem recebida do destinatário. */
const sendText = (to, text) => post({ to: digits(to), type: 'text', text: { body: String(text).slice(0, 4000), preview_url: false } });
/** Mensagem de template aprovado (única forma de iniciar conversa). Parâmetros do corpo: sem quebras de linha. */
const clean = (s) => String(s ?? '-').replace(/[\r\n\t]+/g, ' | ').replace(/ {4,}/g, '   ').trim().slice(0, 900) || '-';
const sendTemplate = (to, name, lang, params = []) => post({ to: digits(to), type: 'template', template: { name, language: { code: lang }, components: params.length ? [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: clean(t) })) }] : [] } });

/** Valida X-Hub-Signature-256 do webhook com o App Secret (corpo bruto). */
function verifySignature(raw, header) {
  const secret = cfg().appSecret;
  if (!secret || !header || !raw) return false;
  const exp = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(exp), b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Definição do template que precisa ser criado/aprovado no WhatsApp Manager (categoria UTILITY). */
const TEMPLATE_DEFINITION = () => ({
  name: cfg().template, language: cfg().lang, category: 'UTILITY',
  components: [{
    type: 'BODY',
    text: 'NOVO PEDIDO — SPORT IMPERATIVO STORE\nPedido: {{1}}\nCliente: {{2}}\n\nPRODUTOS: {{3}}\n\nENDEREÇO DE ENTREGA: {{4}}\nTelefone do cliente: {{5}}\n\nVALOR DO PEDIDO: {{6}}\n\nPor favor, confirme o recebimento do pedido.\nSport Imperativo Store.',
    example: { body_text: [['#SIS-10482', 'João Silva', '1x Camisa Brasil 2026 (M)', 'Rua Exemplo, 100 - São Paulo/SP - CEP 00000-000 - Brasil', '+55 11 90000-0000', 'R$ 219,90']] },
  }],
});
module.exports = { cfg, digits, isConfigured, envStatus, sendText, sendTemplate, verifySignature, TEMPLATE_DEFINITION };
