import { $, $$, e, brl, api, state, saveCart, cartPayload, cartKey, toast, modal, closeModal, icon, setMeta, maskCEP } from '../lib.js';
import { go } from '../app.js';

const KEY = 'si_cartctx';
export const cctx = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();
export const saveCtx = () => { try { localStorage.setItem(KEY, JSON.stringify(cctx)); } catch { /* ignore */ } };

export function summaryHtml(c, { showCoupon = true } = {}) {
  return `<div class="sum"><div><span>Subtotal</span><span>${brl(c.subtotal)}</span></div>
    ${c.discount ? `<div class="disc"><span>Desconto${c.coupon ? ' (' + e(c.coupon.code) + ')' : ''}</span><span>-${brl(c.discount)}</span></div>` : ''}
    <div><span>Frete</span><span>${c.needCep ? 'a calcular' : c.shipping ? brl(c.shipping) : '<b style="color:var(--ok)">GRÁTIS</b>'}</span></div>
    <div class="tot"><span>Total</span><span>${brl(c.total)}</span></div>
    <div class="pix" style="text-align:right">${brl(c.pixTotal)} no Pix (${c.pixPct}% off)</div>
    <div class="inst" style="text-align:right">ou em até ${c.installments.n}x no cartão (juros conforme o meio de pagamento)</div></div>`;
}
export function groupsHtml(c, selectable = true) {
  return c.groups.map((g) => `<div class="ship-group ${g.id === 'import' ? 'imp' : ''}"><b><span>${g.id === 'import' ? icon.globe.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px"') : icon.truck.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px"')} ${e(g.title)}</span><span>${g.options.length ? (g.priceCents ? brl(g.priceCents) : '<span style="color:var(--ok)">GRÁTIS</span>') : ''}</span></b>
    <small>Origem: ${e(g.origin)}</small>
    ${g.options.length ? g.options.map((o) => `<label>${selectable && g.id === 'stock' && g.options.length > 1 ? `<input type="radio" name="ship-method" value="${e(o.id)}" ${g.selected && g.selected.id === o.id ? 'checked' : ''}>` : ''}<span style="flex:1">${e(o.carrier)}<br><small>${o.daysMin}–${o.daysMax} ${o.unit || 'dias úteis'}</small></span>${g.options.length > 1 ? `<b>${o.price ? brl(o.price) : 'GRÁTIS'}</b>` : ''}</label>`).join('') : `<small>${e(g.note || '')}</small>`}
    ${g.id === 'import' ? `<div class="alert warn" style="font-size:12.5px;margin:8px 0 0">${e(g.note || '')}</div>` : g.note ? `<small>${e(g.note)}</small>` : ''}</div>`).join('');
}

export default async function cart() {
  setMeta('Carrinho | Sport Imperativo Store');
  if (!state.cart.length) { $('#app').innerHTML = '<div class="wrap empty"><h3>Seu carrinho está vazio</h3><p>Que tal escolher o próximo uniforme?</p><p style="margin-top:14px"><a class="btn" href="/futebol">COMEÇAR A COMPRAR</a></p></div>'; return; }
  const draw = async () => {
    let c;
    try { c = await api('/cart/price', { method: 'POST', body: cartPayload({ cep: cctx.cep, method: cctx.method, coupon: cctx.coupon }) }); }
    catch (err) {
      if (/Cupom|cupom|Pedido mínimo/.test(err.message)) { toast(err.message, { err: true }); delete cctx.coupon; saveCtx(); return draw(); }
      $('#app').innerHTML = `<div class="wrap"><h1 class="page-h">Carrinho</h1><div class="alert err">${e(err.message)}</div><p>Revise os itens e tente novamente.</p><button class="btn ghost" id="clear">Esvaziar carrinho</button></div>`;
      $('#clear').onclick = () => { state.cart = []; saveCart(); go('/carrinho', true); }; return;
    }
    // sincroniza itens removidos pelo servidor
    const valid = new Set(c.lines.map((l) => l.key)); const before = state.cart.length;
    state.cart = state.cart.filter((i) => valid.has(cartKey(i))); if (state.cart.length !== before) saveCart();
    c.warnings.forEach((w) => toast(w, { err: true }));
    $('#app').innerHTML = `<div class="wrap"><h1 class="page-h">Carrinho</h1><div class="two-col"><div>
      <div class="panel">${c.lines.map((l) => { const i = state.cart.findIndex((x) => cartKey(x) === l.key);
        return `<div class="line"><a href="/produto/${e(l.slug)}"><img src="${e(l.image)}" alt="" loading="lazy"></a><div><a class="nm" href="/produto/${e(l.slug)}">${e(l.name)}</a>
          <div class="sub">${l.size ? 'Tamanho: <b>' + e(l.size) + '</b>' : ''}</div>
          ${l.custom ? `<div class="sub">${l.custom.name || l.custom.number ? `Personalização: <b>${e(l.custom.name)} ${e(l.custom.number)}</b><br>` : ''}${l.custom.patch ? `Patch: <b>${e(l.custom.patch)}</b><br>` : ''}${l.custom.sponsor ? `Patrocinador: <b>${e(l.custom.sponsor)}</b><br>` : ''}(+${brl(l.customCents)} cada)</div>` : ''}
          <div class="sub">${l.fulfillment === 'import' ? '<span style="color:#a86b00">Importado / sob encomenda — prazo maior</span>' : '<span style="color:var(--ok)">Pronta entrega</span>'}</div>
          <div style="display:flex;gap:14px;align-items:center;margin-top:8px;flex-wrap:wrap"><div class="qty" style="height:36px"><button data-q="${i}" data-d="-1" aria-label="Menos">−</button><span>${l.qty}</span><button data-q="${i}" data-d="1" aria-label="Mais">+</button></div>
          <button class="rm" style="color:var(--blue)" data-edit="${i}">Alterar</button><button class="rm" data-rm="${i}">Remover</button></div></div>
          <div style="text-align:right"><div class="sub">${brl(l.unitCents + l.customCents)} un.</div><b style="font-size:17px">${brl(l.lineCents)}</b></div></div>`; }).join('')}</div>
      <div class="panel"><h3>Entrega</h3><div class="ship-calc field" style="max-width:360px"><input id="cep" inputmode="numeric" placeholder="Seu CEP" maxlength="9" value="${e(cctx.cep ? maskCEP(cctx.cep) : '')}"><button class="btn sm ghost" id="calc" style="height:42px">CALCULAR</button></div>
        <div id="groups">${groupsHtml(c)}</div></div>
      <p style="margin-top:14px"><a href="/futebol" style="color:var(--blue);font-weight:700">← Continuar comprando</a></p></div>
    <aside class="sticky"><div class="panel"><h3>Resumo do pedido</h3>
      <div class="coupon"><input id="coupon" placeholder="Cupom de desconto" value="${e(cctx.coupon || '')}" maxlength="30"><button class="btn sm" id="apply">${c.coupon ? 'TROCAR' : 'APLICAR'}</button></div>
      ${c.coupon ? `<div class="alert ok" style="margin:0 0 8px">Cupom <b>${e(c.coupon.code)}</b> aplicado. <a href="#" id="rm-coupon" style="color:var(--bad)">remover</a></div>` : ''}
      ${summaryHtml(c)}
      ${c.hasImport ? `<div class="alert warn" style="font-size:13px">Seu pedido contém produto(s) importado(s). Prazos e eventuais tributos serão exibidos novamente antes do pagamento.</div>` : ''}
      <a class="btn block" href="/checkout" style="margin-top:12px">FINALIZAR COMPRA</a></div></aside></div></div>`;
    const root = $('#app .wrap');
    root.addEventListener('click', async (ev) => {
      const t = ev.target;
      const q = t.closest('[data-q]'); if (q) { const it = state.cart[+q.dataset.q]; it.qty = Math.max(1, Math.min(20, it.qty + +q.dataset.d)); saveCart(); return draw(); }
      const rm = t.closest('[data-rm]'); if (rm) { state.cart.splice(+rm.dataset.rm, 1); saveCart(); if (!state.cart.length) return go('/carrinho', true); return draw(); }
      const ed = t.closest('[data-edit]'); if (ed) return editItem(+ed.dataset.edit, draw);
      if (t.closest('#calc')) { const v = $('#cep').value.replace(/\D/g, ''); if (v.length !== 8) return toast('CEP inválido.', { err: true }); cctx.cep = v; saveCtx(); return draw(); }
      if (t.closest('#apply')) { const v = $('#coupon').value.trim().toUpperCase(); if (!v) return; cctx.coupon = v; saveCtx(); return draw(); }
      if (t.closest('#rm-coupon')) { ev.preventDefault(); delete cctx.coupon; saveCtx(); return draw(); }
    });
    $('#cep').addEventListener('input', (ev) => { ev.target.value = maskCEP(ev.target.value); });
    $('#cep').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('#calc').click(); });
    $('#groups').addEventListener('change', (ev) => { if (ev.target.name === 'ship-method') { cctx.method = ev.target.value; saveCtx(); draw(); } });
  };
  await draw();
}

async function editItem(i, done) {
  const it = state.cart[i];
  const { product: p } = await api('/products/' + (it.m ? it.m.slug : ''));
  modal(`<h3>Alterar item <button class="x" data-action="modal-close">${icon.x}</button></h3><p><b>${e(p.name)}</b></p>
    ${p.variants.length ? `<div class="optlabel">Tamanho</div><div class="sizes" id="ed-sizes">${p.variants.map((v) => { const off = p.fulfillment === 'stock' && v.stock <= 0; return `<button class="size ${v.size === it.size ? 'on' : ''} ${off ? 'off' : ''}" ${off ? 'disabled' : ''} data-size="${e(v.size)}">${e(v.size)}</button>`; }).join('')}</div>` : ''}
    ${p.customization ? `<div class="optlabel">Personalização (+${brl(p.customization.priceCents)})</div><div class="custom-box"><div class="two" style="display:grid;grid-template-columns:1fr 100px;gap:10px"><div class="field"><label>Nome</label><input id="ed-name" maxlength="14" value="${e(it.custom ? it.custom.name : '')}" style="text-transform:uppercase"></div><div class="field"><label>Número</label><input id="ed-num" maxlength="2" inputmode="numeric" value="${e(it.custom ? it.custom.number : '')}"></div></div><small style="color:var(--mut)">Deixe em branco para remover.</small></div>` : ''}
    <button class="btn block" id="ed-save" style="margin-top:16px">SALVAR</button>`);
  let size = it.size;
  $('#ed-sizes') && $('#ed-sizes').addEventListener('click', (ev) => { const b = ev.target.closest('.size'); if (!b || b.disabled) return; $$('#ed-sizes .size').forEach((x) => x.classList.toggle('on', x === b)); size = b.dataset.size; });
  $('#ed-save').addEventListener('click', () => {
    it.size = size;
    if ($('#ed-name')) { const n = $('#ed-name').value.trim().toUpperCase(), nu = $('#ed-num').value.replace(/\D/g, ''); const old = it.custom || {}; it.custom = n || nu || old.patch || old.sponsor ? { name: n, number: nu, patch: old.patch || '', sponsor: old.sponsor || '' } : null; }
    // une itens idênticos
    const k = cartKey(it); const dup = state.cart.findIndex((x, j) => j !== i && cartKey(x) === k);
    if (dup >= 0) { state.cart[dup].qty = Math.min(20, state.cart[dup].qty + it.qty); state.cart.splice(i, 1); }
    saveCart(); closeModal(); done();
  });
}
