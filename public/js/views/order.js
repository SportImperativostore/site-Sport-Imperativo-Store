import { $, e, brl, api, state, toast, setMeta } from '../lib.js';

let timer;
export default async function order({ params, query }) {
  clearInterval(timer);
  const id = params[0], t = query.get('t') || '';
  setMeta(`Pedido #${id} | Sport Imperativo Store`);
  const mode = await api('/payment-mode').catch(() => ({ provider: 'mock' }));
  async function draw() {
    let o;
    try { o = await api(`/orders/${id}?t=${encodeURIComponent(t)}`); } catch (err) { $('#app').innerHTML = `<div class="wrap empty"><h3>Pedido não encontrado</h3><p>${e(err.message)}</p><p style="margin-top:14px"><a class="btn" href="/">Voltar à loja</a></p></div>`; clearInterval(timer); return; }
    const pending = o.status === 'payment_pending';
    const pay = o.payment || {};
    const addr = o.address;
    $('#app').innerHTML = `<div class="wrap"><h1 class="page-h">Pedido #${o.id}</h1>
    <div class="two-col"><div>
      ${pending ? `<div class="panel pixbox"><h3>${o.paymentMethod === 'pix' ? 'Pague com Pix' : 'Finalize o pagamento no cartão'}</h3>
        ${o.paymentMethod === 'pix' ? `<p class="inst">Valor: <b style="font-size:20px;color:var(--ink)">${brl(o.total)}</b></p>${pay.pix_qr ? `<img src="data:image/png;base64,${e(pay.pix_qr)}" alt="QR Code Pix" width="220" height="220" style="margin:10px auto">` : ''}
          <textarea id="pixcode" readonly aria-label="Pix copia e cola">${e(pay.pix_code || '')}</textarea><button class="btn" id="copy">COPIAR CÓDIGO PIX</button>
          <p class="inst" style="margin-top:10px">Abra o app do seu banco, escolha <b>Pix copia e cola</b> e cole o código. A confirmação é automática.</p>`
          : `${pay.checkout_url && !/mock=card/.test(pay.checkout_url) ? `<a class="btn" href="${e(pay.checkout_url)}">PAGAR COM CARTÃO</a><p class="inst" style="margin-top:8px">Você será levado ao ambiente seguro do gateway. Não armazenamos dados do cartão.</p>` : '<p class="inst">Ambiente de teste: o gateway real ainda não está configurado.</p>'}`}
        ${mode.provider === 'mock' ? `<div class="alert warn" style="text-align:left;margin-top:14px"><b>Modo de teste (sem gateway configurado).</b> Nenhuma cobrança real é feita.<br><button class="btn sm dark" id="simulate" style="margin-top:8px">Simular pagamento aprovado</button></div>` : ''}
        <p class="inst" style="margin-top:10px">Aguardando pagamento… esta página atualiza sozinha.</p></div>` : ''}
      <div class="panel"><h3>Status: <span class="pill">${e(o.statusLabel)}</span></h3>
      ${o.timeline ? `<div class="timeline">${o.timeline.map((s, i) => `<div class="tl ${s.done ? 'done' : ''} ${s.current ? 'cur' : ''}"><i>${s.done ? '✓' : i + 1}</i><span>${e(s.label)}</span></div>`).join('')}</div>` : '<div class="alert err">Pedido cancelado.</div>'}
      ${o.shipments.filter((s) => s.code).map((s) => `<div class="alert ok"><b>Rastreamento${s.grp === 'import' ? ' (importado)' : ''}:</b> ${e(s.carrier || '')} — <b>${e(s.code)}</b> ${s.url ? `<a href="${e(s.url)}" target="_blank" rel="noopener" style="text-decoration:underline">Rastrear</a>` : ''}</div>`).join('')}
      ${o.events.length ? `<details><summary style="cursor:pointer;color:var(--blue);font-weight:700">Histórico</summary><ul style="margin-top:8px;font-size:13.5px">${o.events.slice().reverse().map((ev) => `<li style="padding:4px 0">${new Date(ev.created_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')} — ${e(ev.note || ev.status)}</li>`).join('')}</ul></details>` : ''}</div>
      <div class="panel"><h3>Itens</h3>${o.items.map((l) => `<div class="line"><img src="${e(l.image || '')}" alt=""><div><div class="nm">${e(l.name)}</div><div class="sub">${l.size ? 'Tam. ' + e(l.size) + ' • ' : ''}${l.qty}x ${l.custom_name || l.custom_number ? '• ' + e(l.custom_name || '') + ' ' + e(l.custom_number || '') : ''}</div><div class="sub">${l.fulfillment === 'import' ? 'Importado / sob encomenda' : 'Pronta entrega'}</div></div><b>${brl((l.unit_cents + (l.custom_cents || 0)) * l.qty)}</b></div>`).join('')}</div></div>
    <aside><div class="panel sum"><h3>Resumo</h3><div><span>Subtotal</span><span>${brl(o.subtotal)}</span></div>${o.discount ? `<div class="disc"><span>Desconto</span><span>-${brl(o.discount)}</span></div>` : ''}<div><span>Frete</span><span>${o.shipping ? brl(o.shipping) : 'Grátis'}</span></div><div class="tot"><span>Total</span><span>${brl(o.total)}</span></div>
      <div class="inst">Pagamento: ${o.paymentMethod === 'pix' ? 'Pix' : 'Cartão em ' + o.installments + 'x'}</div></div>
      <div class="panel"><h3>Entrega</h3><p style="font-size:14px">${e(addr.street)}, ${e(addr.number)}${addr.complement ? ' - ' + e(addr.complement) : ''}<br>${e(addr.district)} — ${e(addr.city)}/${e(addr.state)}<br>CEP ${e(addr.cep)}</p>${o.shipping_info.map((g) => `<p class="inst" style="margin-top:6px">• ${e(g.title)}: ${e(g.carrier || '')} (${g.daysMin}–${g.daysMax} dias úteis)</p>`).join('')}</div>
      ${state.user ? '<a class="btn ghost block" href="/conta/pedidos">Meus pedidos</a>' : ''}</aside></div></div>`;
    const copy = $('#copy'); if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText($('#pixcode').value); toast('Código Pix copiado!'); } catch { $('#pixcode').select(); } };
    const sim = $('#simulate'); if (sim) sim.onclick = async () => { await api('/dev/pay/' + id, { method: 'POST', body: { t } }); toast('Pagamento simulado como aprovado.'); draw(); };
    if (!pending) clearInterval(timer);
  }
  await draw();
  timer = setInterval(async () => { if (!location.pathname.startsWith('/pedido/')) return clearInterval(timer); const o = await api(`/orders/${id}?t=${encodeURIComponent(t)}`).catch(() => null); if (o && o.status !== 'payment_pending') { draw(); } }, 5000);
}
