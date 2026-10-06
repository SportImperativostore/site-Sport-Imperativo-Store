import { $, $$, e, brl, api, state, addToCart, toast, modal, closeModal, icon, starsHtml, productCard, setMeta, maskCEP, toggleFav } from '../lib.js';
import { openCartDrawer, go } from '../app.js';
import { storiesStrip } from './stories.js';

const ytEmbed = (u) => { const m = String(u).match(/(?:youtu\.be\/|v=|embed\/)([\w-]{11})/); return m ? `https://www.youtube.com/embed/${m[1]}` : null; };

export default async function product({ params }) {
  $('#app').innerHTML = '<div class="wrap"><div class="skeleton" style="height:520px;margin-top:24px"></div></div>';
  const { product: p, feedbacks, reviews, related, ratingDist, crumbPath } = await api('/products/' + params[0]);
  setMeta(p.meta.title || `${p.name} | Sport Imperativo Store`, p.meta.description || p.description);
  const pr = p.pricing, imp = p.fulfillment === 'import';
  const media = [...p.images.filter((i) => i.kind === 'image').map((i) => ({ t: 'img', url: i.url })), ...p.images.filter((i) => i.kind === 'video').map((i) => ({ t: 'vid', url: i.url }))];
  if (p.video) media.push({ t: 'vid', url: p.video });
  const sel = { size: null, qty: 1, custom: false };
  const fav = state.favorites.has(p.id);
  const sport = p.entities.find((x) => x.type === 'sport'), club = p.entities.find((x) => x.type === 'club' || x.type === 'national_team');
  const crumbs = [sport && [sport.name, '/' + sport.slug], club && sport && [club.name, '/' + sport.slug + '/' + club.slug]].filter(Boolean);

  const mediaView = (m) => {
    if (m.t === 'img') return `<img src="${e(m.url)}" alt="${e(p.name)}" width="800" height="832"><div class="zoom" style="background-image:url('${e(m.url)}')"></div>`;
    const y = ytEmbed(m.url);
    return y ? `<iframe src="${y}" title="Vídeo do produto" allowfullscreen loading="lazy"></iframe>` : `<video src="${e(m.url)}" controls playsinline></video>`;
  };
  $('#app').innerHTML = `<div class="wrap pdp-wrap">
  <nav class="crumbs"><a href="/">Início</a>${crumbs.map(([n, h]) => `<i>›</i><a href="${e(h)}">${e(n)}</a>`).join('')}<i>›</i><span>${e(p.name)}</span></nav>
  <div class="pdp">
    <div class="gallery"><div class="thumbs">${media.map((m, i) => `<button class="${i ? '' : 'on'}" data-m="${i}" aria-label="Mídia ${i + 1}">${m.t === 'img' ? `<img src="${e(m.url)}" alt="" loading="lazy">` : '<span style="display:grid;place-items:center;height:100%;font-size:22px">▶</span>'}</button>`).join('')}</div>
      <div class="mainimg" id="mainimg">${mediaView(media[0])}</div></div>
    <div>
      <div class="row" style="justify-content:space-between"><span class="meta" style="color:var(--mut);font-size:12px;letter-spacing:.7px;text-transform:uppercase;font-weight:700">${e(p.category)}${p.club ? ' • ' + e(p.club) : ''}</span>
        <div class="share"><button data-share aria-label="Compartilhar">${icon.share}</button><button class="fav ${fav ? 'on' : ''}" style="position:static;box-shadow:none;border:1.5px solid var(--line)" data-action="fav" data-id="${p.id}" aria-label="Favoritar">${icon.heart}</button></div></div>
      <h1>${e(p.name)}</h1>
      <div class="row" style="margin:6px 0">${starsHtml(p.rating.avg, p.rating.count)} ${p.badge ? `<span class="badge" style="position:static">${e(p.badge)}</span>` : ''}<span class="avail ${p.availability.code}">${e(p.availability.label)}</span></div>
      <div class="pbox">${pr.onSale ? `<div class="price-old">${brl(pr.original)}</div>` : ''}<div><span class="price">${brl(pr.final)}</span>${pr.discountPct ? `<span class="pct">-${pr.discountPct}%</span>` : ''}</div>
        <div class="pix"><b>${brl(pr.pix)}</b> no Pix (${pr.pixPct}% de desconto)</div><div class="inst">ou <b>${pr.installments.n}x de ${brl(pr.installments.value)}</b> sem juros no cartão</div>
        <div id="custom-total" class="inst" style="margin-top:6px" hidden></div></div>
      ${imp ? `<div class="info-box import">${icon.globe}<div><b>Produto importado / sob encomenda</b><br>Enviado do exterior (${e(p.shipping.origin)}). Prazo estimado: <b>${p.shipping.leadMin || 18}–${p.shipping.leadMax || 40} dias úteis</b>. ${p.shipping.rule === 'free' ? '<b>Frete grátis/promocional.</b> ' : ''}<br><small>${e(p.shipping.importNotice || '')}</small></div></div>`
        : `<div class="info-box stock">${icon.truck}<div><b>Pronta entrega</b> — enviado do Brasil. Frete calculado pelo CEP.${p.shipping.rule === 'free' ? ' <b>Frete grátis.</b>' : ''}</div></div>`}
      ${p.variants.length ? `<div class="optlabel"><span>Tamanho <span id="size-sel" style="color:var(--blue)"></span></span>${p.sizeGuide ? '<button data-guide>GUIA DE TAMANHOS</button>' : ''}</div>
        <div class="sizes" id="sizes">${p.variants.map((v) => { const off = !imp && v.stock <= 0; return `<button class="size ${off ? 'off' : ''}" ${off ? 'disabled' : ''} data-size="${e(v.size)}" title="${off ? 'Esgotado' : !imp && v.stock <= 3 ? 'Últimas unidades' : ''}">${e(v.size)}</button>`; }).join('')}</div><div class="err" id="size-err" style="color:var(--bad);font-size:13px;margin-top:6px" hidden>Selecione um tamanho.</div>` : ''}
      ${p.customization ? `<div class="optlabel">Personalização</div><div class="custom-box"><label class="check" style="margin:0"><input type="checkbox" id="cust-on"><span><b>PERSONALIZAR CAMISA</b> — custo da personalização: <b>${brl(p.customization.priceCents)}</b></span></label>
        <div class="two" id="cust-fields" hidden><div class="field"><label for="c-name">Nome</label><input id="c-name" maxlength="14" placeholder="Ex.: NEYMAR" autocomplete="off" style="text-transform:uppercase"></div><div class="field"><label for="c-num">Número</label><input id="c-num" inputmode="numeric" maxlength="2" placeholder="10" autocomplete="off"></div></div>
        <small style="color:var(--mut);display:block;margin-top:6px" id="cust-note" hidden>Produtos personalizados não podem ser trocados, exceto por defeito.</small></div>` : ''}
      <div class="buy"><div class="qty"><button data-q="-1" aria-label="Menos">−</button><span id="qty">1</span><button data-q="1" aria-label="Mais">+</button></div>
        <button class="btn" id="add" ${p.availability.code === 'out' ? 'disabled' : ''}>${p.availability.code === 'out' ? 'ESGOTADO' : 'ADICIONAR AO CARRINHO'}</button></div>
      <button class="btn dark block" id="buy-now" style="margin-top:10px" ${p.availability.code === 'out' ? 'disabled' : ''}>COMPRAR AGORA</button>
      <div class="optlabel">Calcular frete e prazo</div>
      <div class="ship-calc field"><input id="cep" inputmode="numeric" placeholder="00000-000" maxlength="9" autocomplete="postal-code"><button class="btn sm ghost" id="calc" style="height:42px">CALCULAR</button></div><div class="ship-res" id="ship-res"></div>
    </div></div>
  <div class="tabsx"><h2 class="sec-h" style="margin:22px 0 8px;font-size:20px;font-weight:900">Descrição</h2><p style="max-width:780px;white-space:pre-line">${e(p.description || '')}</p>
    <ul style="margin-top:10px;color:var(--mut);font-size:14px"><li>Origem: ${e(p.shipping.origin)}</li>${p.sku ? `<li>SKU: ${e(p.sku)}</li>` : ''}</ul></div>
  ${feedbacks.length ? `<section class="tabsx"><h2 class="sec-h" style="margin:22px 0 8px;font-size:20px;font-weight:900">Relatos de clientes</h2>${storiesStrip('pdp', feedbacks)}</section>` : ''}
  <section class="tabsx" id="reviews"><h2 class="sec-h" style="margin:22px 0 8px;font-size:20px;font-weight:900">Avaliações</h2>
    <div class="row" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><div style="font-size:42px;font-weight:900">${p.rating.avg || '–'}</div><div>${starsHtml(p.rating.avg)}<div class="inst">${p.rating.count} avaliação(ões)</div></div>
      <div style="flex:1;min-width:200px;max-width:320px">${[5, 4, 3, 2, 1].map((s) => { const n = (ratingDist.find((x) => x.stars === s) || {}).n || 0; return `<div style="display:flex;gap:8px;align-items:center;font-size:12px"><span>${s}★</span><div style="flex:1;height:6px;background:#e8edf6;border-radius:3px"><div style="width:${p.rating.count ? (n / p.rating.count) * 100 : 0}%;height:100%;background:#f5a623;border-radius:3px"></div></div><span>${n}</span></div>`; }).join('')}</div></div>
    ${reviews.map((r) => `<div class="rev">${starsHtml(r.stars)} ${r.featured ? '<span class="pill">Destaque</span>' : ''}<p>${e(r.body || '')}</p>${r.photos.length ? `<div style="display:flex;gap:8px;margin-top:6px">${r.photos.map((u) => `<img src="${e(u)}" alt="" style="width:74px;height:74px;object-fit:cover;border-radius:8px">`).join('')}</div>` : ''}<small>${e(r.author || 'Cliente')} • ${new Date(r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR')}</small></div>`).join('') || '<p class="inst" style="padding:12px 0">Seja o primeiro a avaliar este produto após a compra.</p>'}
    ${state.user ? `<details style="margin-top:14px"><summary style="cursor:pointer;font-weight:700;color:var(--blue)">Avaliar este produto</summary><form id="rev-form" class="field" style="max-width:480px;margin-top:10px"><label>Nota</label><select name="stars"><option value="5">★★★★★ Excelente</option><option value="4">★★★★ Bom</option><option value="3">★★★ Regular</option><option value="2">★★ Ruim</option><option value="1">★ Péssimo</option></select><label style="margin-top:8px">Comentário</label><textarea name="body" rows="3" maxlength="1500"></textarea><button class="btn sm" style="margin-top:10px">ENVIAR AVALIAÇÃO</button></form></details>` : ''}</section>
  ${related.length ? `<section class="block"><div class="sec-h"><h2>Você também <span>pode gostar</span></h2></div><div class="grid">${related.slice(0, 4).map(productCard).join('')}</div></section>` : ''}</div>
  <div class="mbar"><div class="p">${brl(pr.final)}<small>${brl(pr.pix)} no Pix</small></div><button class="btn" id="add-m" ${p.availability.code === 'out' ? 'disabled' : ''}>ADICIONAR</button></div>`;

  /* ---- interações ---- */
  const main = $('#mainimg');
  $('.thumbs').addEventListener('click', (ev) => { const b = ev.target.closest('[data-m]'); if (!b) return; $$('.thumbs button').forEach((x) => x.classList.toggle('on', x === b)); main.innerHTML = mediaView(media[+b.dataset.m]); });
  main.addEventListener('mousemove', (ev) => { const z = $('.zoom', main); if (!z) return; const r = main.getBoundingClientRect(); z.style.backgroundPosition = `${((ev.clientX - r.left) / r.width) * 100}% ${((ev.clientY - r.top) / r.height) * 100}%`; });
  main.addEventListener('click', () => { const img = $('img', main); if (img) modal(`<h3>${e(p.name)} <button class="x" data-action="modal-close">${icon.x}</button></h3><img src="${e(img.src)}" alt="" style="width:100%;border-radius:10px">`); });
  $('#sizes') && $('#sizes').addEventListener('click', (ev) => { const b = ev.target.closest('.size'); if (!b || b.disabled) return; $$('#sizes .size').forEach((x) => x.classList.toggle('on', x === b)); sel.size = b.dataset.size; $('#size-sel').textContent = '• ' + sel.size; $('#size-err').hidden = true; });
  $('[data-guide]') && $('[data-guide]').addEventListener('click', () => modal(`<h3>Guia de tamanhos — ${e(p.sizeGuide.name)} <button class="x" data-action="modal-close">${icon.x}</button></h3><table class="t"><thead><tr>${p.sizeGuide.headers.map((h) => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${p.sizeGuide.rows.map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>${p.sizeGuide.notes ? `<p class="inst" style="margin-top:10px">${e(p.sizeGuide.notes)}</p>` : ''}`));
  $$('[data-q]').forEach((b) => b.addEventListener('click', () => { sel.qty = Math.max(1, Math.min(20, sel.qty + +b.dataset.q)); $('#qty').textContent = sel.qty; }));
  const custom = () => { if (!sel.custom) return null; return { name: ($('#c-name').value || '').trim().toUpperCase(), number: ($('#c-num').value || '').replace(/\D/g, '') }; };
  const updateTotal = () => { const t = $('#custom-total'); if (!t) return; t.hidden = !sel.custom; if (sel.custom) t.innerHTML = `Com personalização: <b>${brl(pr.final + p.customization.priceCents)}</b> por unidade`; };
  $('#cust-on') && $('#cust-on').addEventListener('change', (ev) => { sel.custom = ev.target.checked; $('#cust-fields').hidden = $('#cust-note').hidden = !sel.custom; updateTotal(); });
  $('#c-num') && $('#c-num').addEventListener('input', (ev) => { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 2); });
  function addItem() {
    if (p.variants.length && !sel.size) { $('#size-err').hidden = false; $('#sizes').scrollIntoView({ behavior: 'smooth', block: 'center' }); return false; }
    const c = custom();
    if (sel.custom && !c.name && !c.number) { toast('Informe nome e/ou número da personalização.', { err: true }); return false; }
    addToCart({ productId: p.id, size: sel.size, qty: sel.qty, custom: c, m: { name: p.name, image: p.images[0].url, slug: p.slug } });
    return true;
  }
  const flash = (b) => { const t = b.textContent; b.classList.add('ok'); b.textContent = '✓ ADICIONADO'; setTimeout(() => { b.classList.remove('ok'); b.textContent = t; }, 1500); };
  const onAdd = (ev) => { if (addItem()) { flash(ev.currentTarget); openCartDrawer(); } };
  $('#add').addEventListener('click', onAdd); $('#add-m').addEventListener('click', onAdd);
  $('#buy-now').addEventListener('click', () => { if (addItem()) go('/checkout'); });
  $('[data-share]').addEventListener('click', async () => { try { if (navigator.share) await navigator.share({ title: p.name, url: location.href }); else { await navigator.clipboard.writeText(location.href); toast('Link copiado!'); } } catch { /* cancelado */ } });
  $('#cep').addEventListener('input', (ev) => { ev.target.value = maskCEP(ev.target.value); });
  const calc = async () => {
    const cep = $('#cep').value.replace(/\D/g, ''); const out = $('#ship-res');
    if (cep.length !== 8) { out.innerHTML = '<span style="color:var(--bad)">Informe um CEP válido.</span>'; return; }
    out.textContent = 'Calculando...';
    try {
      const r = await api('/cart/price', { method: 'POST', body: { items: [{ productId: p.id, size: sel.size || (p.variants[0] && p.variants[0].size), qty: sel.qty }], cep } });
      out.innerHTML = r.groups.map((g) => g.options.map((o) => `<div><span>${e(o.carrier)} <small style="color:var(--mut)">• ${o.daysMin}–${o.daysMax} ${o.unit || 'dias úteis'}</small></span><b>${o.price ? brl(o.price) : 'GRÁTIS'}</b></div>`).join('')).join('');
    } catch (err) { out.innerHTML = `<span style="color:var(--bad)">${e(err.message)}</span>`; }
  };
  $('#calc').addEventListener('click', calc);
  $('#cep').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') calc(); });
  const rf = $('#rev-form');
  if (rf) rf.addEventListener('submit', async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(rf)); try { const r = await api(`/products/${p.id}/reviews`, { method: 'POST', body: d }); toast(r.message); rf.reset(); } catch (err) { toast(err.message, { err: true }); } });
}
