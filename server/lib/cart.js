const { q, setting } = require('../db');
const { pricing } = require('./catalog');
const { HttpError, onlyDigits } = require('./util');

/* ---------- FRETE ----------
 * quoteStock() é o ponto único para trocar a estimativa por uma API real (Melhor Envio, Correios, Frenet…).
 * Aqui há uma tabela configurável por região (primeiro dígito do CEP) usada como fallback/estimativa.
 */
const REGION = { 0: 'SP', 1: 'SP', 2: 'RJES', 3: 'MG', 4: 'BASE', 5: 'NE', 6: 'N', 7: 'CO', 8: 'S', 9: 'S' };
const ZONES = { // distância entre regiões (0 = mesma)
  SP: { SP: 0, RJES: 1, MG: 1, S: 1, CO: 2, BASE: 2, NE: 3, N: 3 }, RJES: { SP: 1, RJES: 0, MG: 1, S: 2, CO: 2, BASE: 2, NE: 3, N: 3 },
  MG: { SP: 1, RJES: 1, MG: 0, S: 2, CO: 1, BASE: 2, NE: 3, N: 3 }, S: { SP: 1, RJES: 2, MG: 2, S: 0, CO: 2, BASE: 3, NE: 3, N: 3 },
  CO: { SP: 2, RJES: 2, MG: 1, S: 2, CO: 0, BASE: 2, NE: 3, N: 3 }, BASE: { SP: 2, RJES: 2, MG: 2, S: 3, CO: 2, BASE: 0, NE: 1, N: 3 },
  NE: { SP: 3, RJES: 3, MG: 3, S: 3, CO: 2, BASE: 1, NE: 0, N: 2 }, N: { SP: 3, RJES: 3, MG: 3, S: 3, CO: 3, BASE: 3, NE: 2, N: 0 },
};
function quoteStock(destCep, weightG) {
  const origin = onlyDigits(setting('origin_cep', '11010000'));
  const z = ZONES[REGION[origin[0]] || 'SP'][REGION[destCep[0]] || 'SP'];
  const kg = Math.max(0.3, weightG / 1000);
  const pac = Math.round((1290 + z * 450 + (kg - 0.3) * 600) / 10) * 10;
  const sedex = Math.round((1990 + z * 700 + (kg - 0.3) * 900) / 10) * 10;
  return [
    { id: 'pac', carrier: 'Correios PAC', price: pac, daysMin: 3 + z * 2, daysMax: 5 + z * 3 },
    { id: 'sedex', carrier: 'Correios SEDEX', price: sedex, daysMin: 1 + z, daysMax: 2 + z * 2 },
  ];
}

async function checkCoupon(code, lines, ctx) {
  const c = await q.get('SELECT * FROM coupons WHERE code=? AND active=1', String(code || '').trim().toUpperCase());
  if (!c) throw new HttpError(400, 'Cupom inválido.');
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if ((c.starts_at && c.starts_at > now) || (c.ends_at && c.ends_at < now)) throw new HttpError(400, 'Cupom fora da validade.');
  if (c.max_uses && c.uses >= c.max_uses) throw new HttpError(400, 'Cupom esgotado.');
  if (c.first_purchase) {
    const prior = ctx.userId
      ? await q.get("SELECT 1 x FROM orders WHERE user_id=? AND status NOT IN ('received','payment_pending','cancelled') LIMIT 1", ctx.userId)
      : null;
    if (!ctx.userId) throw new HttpError(400, 'Faça login para usar o cupom de primeira compra.');
    if (prior) throw new HttpError(400, 'Cupom válido somente na primeira compra.');
  }
  let eligible = lines;
  if (c.product_id) eligible = lines.filter((l) => l.productId === c.product_id);
  else if (c.entity_id) {
    const has = new Set((await q.all('SELECT product_id FROM product_entities WHERE entity_id=?', c.entity_id)).map((r) => r.product_id));
    eligible = lines.filter((l) => has.has(l.productId));
  }
  const base = eligible.reduce((a, l) => a + l.lineCents, 0);
  if ((c.product_id || c.entity_id) && base === 0) throw new HttpError(400, 'Cupom não se aplica aos itens do carrinho.');
  const subtotal = lines.reduce((a, l) => a + l.lineCents, 0);
  if (c.min_cents && subtotal < c.min_cents) throw new HttpError(400, `Pedido mínimo de R$ ${(c.min_cents / 100).toFixed(2).replace('.', ',')} para este cupom.`);
  let discount = 0;
  if (c.type === 'percent') discount = Math.round(base * (c.value / 100));
  else if (c.type === 'fixed') discount = Math.min(base, Math.round(c.value * 100));
  return { id: c.id, code: c.code, type: c.type, discount, freeShipping: c.type === 'free_shipping' };
}

/** Calcula carrinho completo no servidor (nunca confiar em preços vindos do cliente). */
async function priceCart({ items, cep, method, coupon, userId }) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Carrinho vazio.');
  if (items.length > 50) throw new HttpError(400, 'Itens demais no carrinho.');
  const lines = [], warnings = [];
  const persCents = parseInt(setting('personalization_cents', '2500'), 10);
  for (const it of items) {
    const p = await q.get('SELECT * FROM products WHERE id=? AND active=1', +it.productId);
    if (!p) { warnings.push('Um produto não está mais disponível e foi removido.'); continue; }
    const qty = Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1));
    const price = pricing(p);
    let size = it.size ? String(it.size).slice(0, 20) : null;
    const variants = await q.all('SELECT size,stock FROM variants WHERE product_id=?', p.id);
    if (variants.length) {
      const v = variants.find((x) => x.size === size);
      if (!v) throw new HttpError(400, `Selecione o tamanho de "${p.name}".`);
      if (p.fulfillment === 'stock' && v.stock < qty) throw new HttpError(400, `"${p.name}" (${size}): apenas ${v.stock} em estoque.`);
    } else if (p.fulfillment === 'stock' && p.stock < qty) throw new HttpError(400, `"${p.name}": apenas ${p.stock} em estoque.`);
    let custom = null, customCents = 0;
    if (it.custom && (it.custom.name || it.custom.number)) {
      if (!p.customizable) throw new HttpError(400, `"${p.name}" não aceita personalização.`);
      const name = String(it.custom.name || '').toUpperCase().replace(/[^A-Z0-9 .'\-ÁÀÂÃÉÊÍÓÔÕÚÇ]/gi, '').slice(0, 14);
      const number = String(it.custom.number || '').replace(/\D/g, '').slice(0, 2);
      custom = { name, number };
      customCents = p.custom_price_cents ?? persCents;
    }
    const unit = price.final + customCents;
    const img = await q.get("SELECT url FROM product_images WHERE product_id=? AND kind='image' ORDER BY sort,id LIMIT 1", p.id);
    lines.push({
      key: `${p.id}|${size || ''}|${custom ? custom.name + '#' + custom.number : ''}`, productId: p.id, slug: p.slug, name: p.name, image: img ? img.url : `/img/p/${p.id}.svg`,
      size, qty, unitCents: price.final, customCents, custom, lineCents: unit * qty, pixLineCents: Math.round(price.final * (1 - price.pixPct / 100)) * qty + customCents * qty,
      fulfillment: p.fulfillment, rule: p.shipping_rule, fixed: p.shipping_fixed_cents || 0, weight: (p.weight_g || 400) * qty,
      leadMin: p.lead_min, leadMax: p.lead_max, origin: p.origin, customizable: !!p.customizable, supplierId: p.supplier_id, supplierSku: p.supplier_sku,
      listUnit: price.original,
    });
  }
  if (!lines.length) throw new HttpError(400, 'Nenhum item válido no carrinho.');
  const subtotal = lines.reduce((a, l) => a + l.lineCents, 0);

  // Frete por grupo de envio (pronta entrega x importado)
  const cepD = onlyDigits(cep);
  const groups = [];
  const stockLines = lines.filter((l) => l.fulfillment === 'stock');
  const importLines = lines.filter((l) => l.fulfillment === 'import');
  const freeOver = parseInt(setting('free_shipping_over_cents', '0'), 10);
  let needCep = false;
  if (stockLines.length) {
    const cepLines = stockLines.filter((l) => l.rule === 'cep' || l.rule === 'custom');
    const fixedCents = stockLines.filter((l) => l.rule === 'fixed').reduce((a, l) => a + l.fixed, 0);
    const g = { id: 'stock', title: 'Pronta entrega', origin: 'Enviado do Brasil', items: stockLines.map((l) => l.key), options: [], selected: null, priceCents: 0, note: null };
    if (cepLines.length) {
      if (cepD.length !== 8) { needCep = true; g.note = 'Informe o CEP para calcular o frete.'; }
      else {
        const opts = quoteStock(cepD, cepLines.reduce((a, l) => a + l.weight, 0));
        const stockSub = stockLines.reduce((a, l) => a + l.lineCents, 0);
        if (freeOver && stockSub >= freeOver) { opts[0].price = 0; g.note = 'Frete grátis por valor mínimo (PAC).'; }
        g.options = opts.map((o) => ({ ...o, price: o.price + fixedCents }));
        g.selected = g.options.find((o) => o.id === method) || g.options[0];
        g.priceCents = g.selected.price;
      }
    } else {
      const free = stockLines.every((l) => l.rule === 'free');
      g.priceCents = free ? 0 : fixedCents;
      g.selected = { id: 'fixed', carrier: free ? 'Frete grátis' : 'Frete fixo', price: g.priceCents, daysMin: 3, daysMax: 10 };
      g.options = [g.selected];
    }
    groups.push(g);
  }
  if (importLines.length) {
    const fixedCents = importLines.filter((l) => l.rule === 'fixed' || l.rule === 'custom').reduce((a, l) => a + l.fixed, 0);
    const cepPaid = importLines.some((l) => l.rule === 'cep');
    let price = fixedCents;
    if (cepPaid) { if (cepD.length !== 8) needCep = true; else price += quoteStock(cepD, importLines.filter((l) => l.rule === 'cep').reduce((a, l) => a + l.weight, 0))[0].price; }
    const lmin = Math.min(...importLines.map((l) => l.leadMin || 15)), lmax = Math.max(...importLines.map((l) => l.leadMax || 40));
    const opt = { id: 'import', carrier: price === 0 ? 'Frete grátis / promocional (internacional)' : 'Envio internacional', price, daysMin: lmin, daysMax: lmax, unit: 'dias úteis' };
    groups.push({ id: 'import', title: 'Importado / sob encomenda', origin: [...new Set(importLines.map((l) => l.origin || 'Exterior'))].join(', '), items: importLines.map((l) => l.key), options: [opt], selected: opt, priceCents: price,
      note: setting('import_notice') });
  }
  const shippingRaw = groups.reduce((a, g) => a + g.priceCents, 0);

  let coup = null, discount = 0, shipping = shippingRaw;
  if (coupon) {
    coup = await checkCoupon(coupon, lines, { userId });
    discount = coup.discount;
    if (coup.freeShipping) { discount = shippingRaw; shipping = 0; }
  }
  discount = Math.min(discount, subtotal + shipping);
  const total = subtotal - (coup && coup.freeShipping ? 0 : discount) + shipping;
  const pixPct = parseFloat(setting('pix_pct', '5'));
  const pixTotal = Math.max(0, Math.round(total - (lines.reduce((a, l) => a + l.lineCents, 0) - lines.reduce((a, l) => a + l.pixLineCents, 0))));
  const maxInst = parseInt(setting('max_installments', '12'), 10), minInst = parseInt(setting('min_installment_cents', '3000'), 10);
  return {
    lines, subtotal, discount: coup && coup.freeShipping ? shippingRaw : discount, shipping, shippingRaw, total, pixTotal, pixPct,
    installments: { n: Math.max(1, Math.min(maxInst, Math.floor(total / minInst))), max: maxInst }, groups, coupon: coup, needCep, warnings,
    hasImport: importLines.length > 0, hasStock: stockLines.length > 0,
  };
}
module.exports = { priceCart, quoteStock };
