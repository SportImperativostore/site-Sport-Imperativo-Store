/* Cotação de frete real pelo SuperFrete (aba "Pronta Entrega"). Nenhum valor é inventado: sem token ou com a API fora do ar a cotação falha
 * e o checkout mostra "cálculo indisponível". Token: variável SUPERFRETE_TOKEN (Vercel); ambiente de testes: SUPERFRETE_ENV=sandbox.
 * Formato da chamada (POST /api/v0/calculator): from/to.postal_code, services, options, package{height,width,length,weight(kg)}; a resposta
 * é uma lista de serviços com id, name, price, delivery_time/delivery_range e, quando o serviço não atende, error. */
const { setting } = require('../db');

const BASE = () => (process.env.SUPERFRETE_ENV === 'sandbox' ? 'https://sandbox.superfrete.com' : 'https://api.superfrete.com');
const enabled = () => !!process.env.SUPERFRETE_TOKEN;
const num = (k, d) => { const v = parseFloat(setting(k, String(d))); return Number.isFinite(v) && v > 0 ? v : d; };

class FreightError extends Error { constructor(m) { super(m); this.freight = true; } }

/** Embalagem de camisas: comprimento/largura fixos e altura somando 3 cm por peça (limites mínimos dos Correios respeitados). */
function packageFor(pieces, weightG) {
  const n = Math.max(1, pieces);
  return {
    height: Math.min(100, Math.max(2, num('pe_pkg_height', 4) + (n - 1) * num('pe_pkg_extra', 3))),
    width: Math.max(11, num('pe_pkg_width', 20)), length: Math.max(16, num('pe_pkg_length', 28)),
    weight: Math.max(0.1, Math.round((weightG / 1000) * 100) / 100),
  };
}

async function quote({ originCep, destCep, pieces, weightG, insuranceCents = 0 }) {
  if (!enabled()) throw new FreightError('SuperFrete não configurado (SUPERFRETE_TOKEN ausente).');
  const body = {
    from: { postal_code: String(originCep).replace(/\D/g, '') }, to: { postal_code: String(destCep).replace(/\D/g, '') },
    services: String(setting('superfrete_services', '1,2,17')),
    options: { own_hand: false, receipt: false, insurance_value: insuranceCents ? Math.round(insuranceCents) / 100 : 0, use_insurance_value: !!insuranceCents },
    package: packageFor(pieces, weightG),
  };
  let res, text;
  try {
    res = await fetch(BASE() + '/api/v0/calculator', {
      method: 'POST', signal: AbortSignal.timeout(12000),
      headers: { Authorization: 'Bearer ' + process.env.SUPERFRETE_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'SportImperativoStore (' + (process.env.SUPERFRETE_CONTACT || 'contato@sportimperativostore.com.br') + ')' },
      body: JSON.stringify(body),
    });
    text = await res.text();
  } catch (e) { throw new FreightError('SuperFrete indisponível: ' + e.message); }
  let j; try { j = JSON.parse(text); } catch { j = null; }
  if (res.status === 400 && /destination_postcode/.test(text)) { const e = new FreightError('CEP de destino inválido.'); e.badCep = true; throw e; }
  if (!res.ok || !j) throw new FreightError('SuperFrete respondeu ' + res.status + ': ' + String(text).slice(0, 160));
  const list = Array.isArray(j) ? j : (j.services || j.data || []);
  const opts = list.filter((s) => s && !s.error && Number(s.price) > 0).map((s) => {
    const rng = s.delivery_range || {};
    const max = Number(rng.max || s.delivery_time || 0), min = Number(rng.min || max || 0);
    return { id: 'sf' + s.id, carrier: String(s.name || ('Serviço ' + s.id)).replace(/^\s+|\s+$/g, ''), price: Math.round(Number(s.price) * 100), daysMin: min, daysMax: max, unit: 'dias úteis' };
  }).sort((a, b) => a.price - b.price);
  if (!opts.length) throw new FreightError('Nenhuma modalidade de envio disponível para este CEP.');
  return opts;
}

module.exports = { quote, enabled, FreightError, packageFor };
