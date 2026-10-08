import { $, $$, e, brl, api, state, saveCart, cartPayload, toast, setMeta, maskCPF, maskCEP, maskPhone } from '../lib.js';
import { go } from '../app.js';
import { cctx, saveCtx, summaryHtml, groupsHtml } from './cart.js';

const DRAFT = 'si_checkout_draft';
const STEPS = ['Dados', 'Endereço', 'Entrega', 'Pagamento'];

export default async function checkout() {
  setMeta('Finalizar compra | Sport Imperativo Store');
  if (!state.cart.length) return go('/carrinho', true);
  // Identificador de segurança do dispositivo (Mercado Pago) — melhora a aprovação do pagamento.
  if (!document.getElementById('mp-security')) { const sc = document.createElement('script'); sc.id = 'mp-security'; sc.src = 'https://www.mercadopago.com/v2/security.js'; sc.setAttribute('view', 'checkout'); sc.async = true; document.head.appendChild(sc); }
  let draft = {};
  try { draft = JSON.parse(sessionStorage.getItem(DRAFT) || '{}'); } catch { /* ignore */ }
  const u = state.user || {};
  const d = { name: u.name || '', cpf: u.cpf ? maskCPF(u.cpf) : '', email: u.email || '', phone: u.phone ? maskPhone(u.phone) : '', whatsapp: u.whatsapp ? maskPhone(u.whatsapp) : '',
    cep: cctx.cep ? maskCEP(cctx.cep) : '', street: '', number: '', complement: '', district: '', city: '', state: '', paymentMethod: 'pix', installments: 1, ack: false, ...draft };
  let step = 1, cart = null, saved = [];
  if (state.user) { try { saved = await api('/account/addresses'); if (saved[0] && !d.street) Object.assign(d, { cep: maskCEP(saved[0].cep), street: saved[0].street, number: saved[0].number, complement: saved[0].complement, district: saved[0].district, city: saved[0].city, state: saved[0].state }); } catch { /* ignore */ } }

  async function reprice() {
    const cep = d.cep.replace(/\D/g, '') || cctx.cep;
    cart = await api('/cart/price', { method: 'POST', body: cartPayload({ cep, method: cctx.method, coupon: cctx.coupon }) });
  }
  const persist = () => { try { sessionStorage.setItem(DRAFT, JSON.stringify({ ...d, ack: false })); } catch { /* ignore */ } };
  const val = {
    1: () => { if (d.name.trim().split(/\s+/).length < 2) return 'Informe seu nome completo.'; if (d.cpf.replace(/\D/g, '').length !== 11) return 'CPF inválido.'; if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return 'E-mail inválido.'; if (d.phone.replace(/\D/g, '').length < 10) return 'Telefone inválido.'; },
    2: () => { if (d.cep.replace(/\D/g, '').length !== 8) return 'CEP inválido.'; if (!d.street || !d.number || !d.district || !d.city || !/^[A-Za-z]{2}$/.test(d.state)) return 'Preencha o endereço completo.'; },
    3: () => { if (cart.needCep) return 'Não foi possível calcular o frete para este CEP.'; if (cart.hasImport && !d.ack) return 'Confirme que está ciente das condições de envio dos produtos importados.'; },
  };

  async function paint(err) {
    const stepsHtml = `<div class="steps">${STEPS.map((s, i) => `<div class="step ${i + 1 === step ? 'on' : i + 1 < step ? 'done' : ''}"><i>${i + 1 < step ? '✓' : i + 1}</i><span>${s}</span></div>`).join('')}</div>`;
    let body = '';
    const f = (id, label, extra = '', full = false) => `<div class="field ${full ? 'full' : ''}"><label for="${id}">${label}</label><input id="${id}" name="${id}" value="${e(d[id] ?? '')}" ${extra}></div>`;
    if (step === 1) body = `<h3>Seus dados</h3><div class="fgrid">${f('name', 'Nome completo', 'autocomplete="name" required', true)}${f('cpf', 'CPF', 'inputmode="numeric" maxlength="14" autocomplete="off" placeholder="000.000.000-00"')}${f('email', 'E-mail', 'type="email" autocomplete="email"')}${f('phone', 'Telefone', 'inputmode="tel" autocomplete="tel" placeholder="(11) 90000-0000"')}${f('whatsapp', 'WhatsApp (opcional)', 'inputmode="tel" placeholder="(11) 90000-0000"')}</div>
      ${state.user ? '' : `<p class="inst" style="margin-top:12px">Já tem conta? <a href="/login?next=/checkout" style="color:var(--blue);font-weight:700">Entrar</a> para usar endereços salvos e acompanhar pedidos.</p>`}`;
    if (step === 2) body = `<h3>Endereço de entrega</h3>${saved.length ? `<div class="field" style="margin-bottom:12px"><label>Endereços salvos</label><select id="saved"><option value="">Usar outro endereço</option>${saved.map((a, i) => `<option value="${i}">${e(a.label || 'Endereço')} — ${e(a.street)}, ${e(a.number)}</option>`).join('')}</select></div>` : ''}<div class="fgrid">
      ${f('cep', 'CEP', 'inputmode="numeric" maxlength="9" autocomplete="postal-code"')}<div></div>${f('street', 'Rua', 'autocomplete="address-line1"', true)}${f('number', 'Número', 'autocomplete="off"')}${f('complement', 'Complemento', 'autocomplete="address-line2"')}${f('district', 'Bairro')}${f('city', 'Cidade')}${f('state', 'Estado (UF)', 'maxlength="2" style="text-transform:uppercase"')}</div>`;
    if (step === 3) body = `<h3>Entrega</h3>${groupsHtml(cart)}
      ${cart.hasImport ? `<div class="alert warn"><b>Produto importado / sob encomenda.</b> Este produto é enviado do exterior; o prazo é maior que o de pronta entrega. Informações sobre tributos/taxas de importação conforme a legislação e a modalidade da compra: ${e(state.config.settings.import_notice)}</div><label class="check"><input type="checkbox" id="ack" ${d.ack ? 'checked' : ''}><span>Li e estou ciente do prazo maior de entrega, de que o produto é importado e de que podem existir tributos/taxas de importação.</span></label>` : ''}`;
    if (step === 4) body = `<h3>Pagamento</h3>
      <label class="pay-opt"><input type="radio" name="pm" value="pix" ${d.paymentMethod === 'pix' ? 'checked' : ''}><span style="flex:1"><b>Pix</b><small>Aprovação imediata • <b class="g">${brl(cart.pixTotal)}</b> (${cart.pixPct}% de desconto)</small></span></label>
      <label class="pay-opt"><input type="radio" name="pm" value="card" ${d.paymentMethod === 'card' ? 'checked' : ''}><span style="flex:1"><b>Cartão de crédito</b><small>Em até ${cart.installments.max}x • ${brl(cart.total)} (parcelas com juros conforme o meio de pagamento, informados antes de você confirmar). Você digita os dados do cartão em ambiente seguro do meio de pagamento.</small></span></label>
      ${d.paymentMethod === 'card' ? `<div class="field" style="margin:0 0 12px"><label>Parcelamento</label><select id="inst">${Array.from({ length: cart.installments.n }, (_, i) => `<option value="${i + 1}" ${d.installments == i + 1 ? 'selected' : ''}>${i + 1}x</option>`).join('')}</select></div>` : ''}
      <div class="alert info" style="font-size:13px">${cart.hasImport ? 'Confirmamos: pedido com produto(s) importado(s) — prazos e condições já informados na etapa de entrega.<br>' : ''}Ao finalizar você concorda com os <a href="/pagina/termos-de-uso" target="_blank" style="text-decoration:underline">Termos de Uso</a> e a <a href="/pagina/politica-de-privacidade" target="_blank" style="text-decoration:underline">Política de Privacidade</a>.</div>`;
    $('#app').innerHTML = `<div class="wrap"><h1 class="page-h">Finalizar compra</h1>${stepsHtml}<div class="two-col"><div class="panel" id="stepbox">${err ? `<div class="alert err" role="alert">${e(err)}</div>` : ''}${body}
      <div style="display:flex;gap:10px;margin-top:18px;justify-content:space-between">${step > 1 ? '<button class="btn ghost" id="back">VOLTAR</button>' : '<a class="btn ghost" href="/carrinho">VOLTAR AO CARRINHO</a>'}<button class="btn" id="next">${step === 4 ? 'FINALIZAR PEDIDO' : 'CONTINUAR'}</button></div></div>
      <aside class="sticky"><div class="panel"><h3>Resumo</h3>${cart.lines.map((l) => `<div style="display:flex;gap:10px;margin-bottom:10px;font-size:13.5px"><img src="${e(l.image)}" alt="" style="width:48px;height:50px;border-radius:8px;object-fit:cover"><span style="flex:1">${e(l.name)}<br><small style="color:var(--mut)">${l.size ? 'Tam. ' + e(l.size) + ' • ' : ''}${l.qty}x${l.custom ? ' • ' + e(l.custom.name) + ' ' + e(l.custom.number) : ''}</small></span><b>${brl(l.lineCents)}</b></div>`).join('')}${summaryHtml(cart)}</div></aside></div></div>`;
    bind();
  }
  function collect() { $$('#stepbox input[name],#stepbox select').forEach((el) => { if (el.name && el.name !== 'pm' && el.name !== 'ship-method') d[el.name] = el.value; }); if ($('#ack')) d.ack = $('#ack').checked; if ($('#inst')) d.installments = +$('#inst').value; const pm = $('input[name=pm]:checked'); if (pm) d.paymentMethod = pm.value; }
  function bind() {
    const mask = (id, fn) => $('#' + id) && $('#' + id).addEventListener('input', (ev) => { ev.target.value = fn(ev.target.value); });
    mask('cpf', maskCPF); mask('phone', maskPhone); mask('whatsapp', maskPhone); mask('cep', maskCEP);
    $('#saved') && $('#saved').addEventListener('change', (ev) => { const a = saved[+ev.target.value]; if (!a) return; Object.assign(d, { cep: maskCEP(a.cep), street: a.street, number: a.number, complement: a.complement, district: a.district, city: a.city, state: a.state }); paint(); });
    $('#cep') && $('#cep').addEventListener('input', async (ev) => {
      const v = ev.target.value.replace(/\D/g, ''); if (v.length !== 8) return;
      try { const r = await api('/cep/' + v); if (r.street || r.city) { collect(); Object.assign(d, { street: r.street || d.street, district: r.district || d.district, city: r.city, state: r.state }); paint(); $('#number') && $('#number').focus(); } } catch (er) { toast(er.message, { err: true }); }
    });
    $('#stepbox').addEventListener('change', async (ev) => {
      if (ev.target.name === 'ship-method') { cctx.method = ev.target.value; saveCtx(); collect(); await reprice(); paint(); }
      if (ev.target.name === 'pm') { collect(); paint(); }
    });
    $('#back') && $('#back').addEventListener('click', () => { collect(); step--; paint(); });
    $('#next').addEventListener('click', async (ev) => {
      collect(); persist();
      const m = val[step] && val[step]();
      if (m) return paint(m);
      if (step === 2) { cctx.cep = d.cep.replace(/\D/g, ''); saveCtx(); try { await reprice(); } catch (er) { return paint(er.message); } }
      if (step < 4) { step++; return paint(); }
      const btn = ev.currentTarget; btn.disabled = true; btn.textContent = 'PROCESSANDO...';
      try {
        const r = await api('/checkout', { method: 'POST', body: { items: cartPayload().items, coupon: cctx.coupon, method: cctx.method, importAck: d.ack, deviceId: window.MP_DEVICE_SESSION_ID || '',
          customer: { name: d.name, cpf: d.cpf, email: d.email, phone: d.phone, whatsapp: d.whatsapp || d.phone },
          address: { cep: d.cep, street: d.street, number: d.number, complement: d.complement, district: d.district, city: d.city, state: d.state }, paymentMethod: d.paymentMethod, installments: d.installments } });
        state.cart = []; saveCart(); delete cctx.coupon; saveCtx(); try { sessionStorage.removeItem(DRAFT); } catch { /* ignore */ }
        go(`/pedido/${r.orderId}?t=${encodeURIComponent(r.token)}`);
      } catch (er) { paint(er.message); }
    });
  }
  try { await reprice(); } catch (er) { toast(er.message, { err: true }); return go('/carrinho', true); }
  paint();
}
