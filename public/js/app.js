import { $, $$, e, brl, api, state, loadCart, saveCart, cartPayload, addToCart, cartKey, toast, modal, closeModal, icon, debounce, setMeta, toggleFav, renderCartCount } from './lib.js';

/* ================= Roteador ================= */
const routes = [];
export const route = (re, loader) => routes.push([re, loader]);
let navToken = 0;
export function go(url, replace = false) { history[replace ? 'replaceState' : 'pushState']({}, '', url); render(); }
export async function render() {
  const t = ++navToken;
  const u = new URL(location.href);
  closeOverlays();
  for (const [re, loader] of routes) {
    const m = (u.pathname.replace(/\/+$/, '') || '/').match(re);
    if (m) {
      try { const mod = await loader(); if (t !== navToken) return; await mod.default({ params: m.slice(1), query: u.searchParams, path: u.pathname }); }
      catch (err) { if (t === navToken) errorPage(err); }
      if (t === navToken) { window.scrollTo({ top: 0 }); $('#app').focus({ preventScroll: true }); markNav(); }
      return;
    }
  }
  const mod = await import('./views/catalog.js');
  if (t !== navToken) return;
  try { await mod.default({ params: [], query: u.searchParams, path: u.pathname, catalogPath: u.pathname }); } catch (err) { errorPage(err); }
  markNav(); window.scrollTo({ top: 0 });
}
function errorPage(err) {
  setMeta('Página não encontrada | Sport Imperativo Store');
  $('#app').innerHTML = `<div class="wrap empty"><h3>${err.status === 404 ? 'Página não encontrada' : 'Algo deu errado'}</h3><p>${e(err.message)}</p><p style="margin-top:16px"><a class="btn" href="/">Voltar à loja</a></p></div>`;
}
route(/^\/$/, () => import('./views/home.js'));
route(/^\/ofertas$/, () => import('./views/catalog.js').then((m) => ({ default: (c) => m.default({ ...c, offers: true }) })));
route(/^\/busca$/, () => import('./views/catalog.js').then((m) => ({ default: (c) => m.default({ ...c, search: true }) })));
route(/^\/produto\/([\w-]+)$/, () => import('./views/product.js'));
route(/^\/carrinho$/, () => import('./views/cart.js'));
route(/^\/checkout$/, () => import('./views/checkout.js'));
route(/^\/pedido\/(\d+)$/, () => import('./views/order.js'));
route(/^\/(login|cadastro)$/, () => import('./views/account.js').then((m) => ({ default: (c) => m.auth(c) })));
route(/^\/favoritos$/, () => import('./views/account.js').then((m) => ({ default: (c) => m.account({ ...c, params: ['favoritos'] }) })));
route(/^\/conta(?:\/([\w-]+))?$/, () => import('./views/account.js').then((m) => ({ default: (c) => m.account(c) })));
route(/^\/pagina\/([\w-]+)$/, () => import('./views/page.js'));
route(/^\/feedbacks$/, () => import('./views/feedbacks.js'));

document.addEventListener('click', (ev) => {
  const a = ev.target.closest('a[href]');
  if (a && !ev.defaultPrevented && ev.button === 0 && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !a.target && a.origin === location.origin && !a.hasAttribute('download') && !a.pathname.startsWith('/admin') && !a.pathname.startsWith('/api')) {
    ev.preventDefault();
    if (a.pathname + a.search !== location.pathname + location.search) history.pushState({}, '', a.pathname + a.search + a.hash);
    render();
    return;
  }
  const el = ev.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) { ev.preventDefault(); actions[el.dataset.action](el, ev); }
});
addEventListener('popstate', render);

/* ================= Ações globais ================= */
export const actions = {
  'menu-open': () => openDrawer('menu-drawer'), 'cart-open': () => { openCartDrawer(); },
  'drawer-close': closeOverlays, 'modal-close': closeModal,
  fav: (el) => toggleFav(+el.dataset.id, el),
  'quick-add': (el) => quickAdd(el.dataset.slug, el),
  'acc-toggle': (el) => { const s = el.nextElementSibling; s.hidden = !s.hidden; el.querySelector('i').textContent = s.hidden ? '+' : '−'; },
  'cart-remove': (el) => { state.cart.splice(+el.dataset.i, 1); saveCart(); openCartDrawer(); },
  'cart-qty': (el) => { const it = state.cart[+el.dataset.i]; it.qty = Math.max(1, Math.min(20, it.qty + +el.dataset.d)); saveCart(); openCartDrawer(); },
  'cookie-accept': () => { try { localStorage.setItem('si_cookie', 'all'); } catch { /* ignore */ } $('#cookie').hidden = true; },
  'cookie-essential': () => { try { localStorage.setItem('si_cookie', 'essential'); } catch { /* ignore */ } $('#cookie').hidden = true; },
  logout: async () => { await api('/auth/logout', { method: 'POST' }); state.user = null; state.favorites = new Set(); renderAccountLink(); toast('Você saiu da conta.'); go('/'); },
};
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { closeOverlays(); closeModal(); hideMega(); } });
$('#modal').addEventListener('mousedown', (ev) => { if (ev.target.id === 'modal') closeModal(); });
$('#drawer-bg').addEventListener('click', closeOverlays);

function openDrawer(id) { $('#drawer-bg').hidden = false; const d = $('#' + id); d.hidden = false; requestAnimationFrame(() => d.classList.add('open')); document.body.style.overflow = 'hidden'; }
export function closeOverlays() {
  $$('.drawer').forEach((d) => { d.classList.remove('open'); setTimeout(() => { if (!d.classList.contains('open')) d.hidden = true; }, 300); });
  $('#drawer-bg').hidden = true; document.body.style.overflow = ''; hideMega();
  $('#suggest').hidden = true;
}

/* ---------- Carrinho lateral ---------- */
export async function openCartDrawer() {
  const d = $('#cart-drawer');
  if (d.hidden || !d.classList.contains('open')) openDrawer('cart-drawer');
  const head = `<header>Carrinho <button class="x" data-action="drawer-close" aria-label="Fechar">${icon.x}</button></header>`;
  if (!state.cart.length) { d.innerHTML = head + '<div class="dbody empty"><h3>Seu carrinho está vazio</h3><p>Explore as categorias e encontre seu próximo uniforme.</p><p style="margin-top:14px"><a class="btn" href="/futebol">VER FUTEBOL</a></p></div>'; return; }
  d.innerHTML = head + '<div class="dbody"><div class="skeleton" style="height:200px;margin-top:14px"></div></div>';
  try {
    const c = await api('/cart/price', { method: 'POST', body: cartPayload() });
    d.innerHTML = head + `<div class="dbody">${c.lines.map((l) => { const idx = state.cart.findIndex((i) => cartKey(i) === l.key);
      return `<div class="line"><a href="/produto/${e(l.slug)}"><img src="${e(l.image)}" alt="" loading="lazy"></a><div><a class="nm" href="/produto/${e(l.slug)}">${e(l.name)}</a><div class="sub">${l.size ? 'Tam. ' + e(l.size) : ''}${l.custom ? ` • ${e(l.custom.name)} ${e(l.custom.number)}` : ''}</div>
      <div class="sub">${l.fulfillment === 'import' ? 'Importado / sob encomenda' : 'Pronta entrega'}</div>
      <div class="row" style="display:flex;gap:10px;align-items:center;margin-top:6px"><div class="qty" style="height:34px"><button data-action="cart-qty" data-i="${idx}" data-d="-1" aria-label="Menos">−</button><span>${l.qty}</span><button data-action="cart-qty" data-i="${idx}" data-d="1" aria-label="Mais">+</button></div><button class="rm" data-action="cart-remove" data-i="${idx}">Remover</button></div></div><b>${brl(l.lineCents)}</b></div>`; }).join('')}</div>
      <footer><div class="sum"><div><span>Subtotal</span><b>${brl(c.subtotal)}</b></div><div class="sub" style="font-size:12.5px;color:var(--mut)">Frete e cupom calculados no carrinho.</div></div>
      <a class="btn block" href="/checkout" style="margin-top:10px">FINALIZAR COMPRA</a><a class="btn ghost block" href="/carrinho" style="margin-top:8px">VER CARRINHO</a></footer>`;
  } catch (err) {
    d.innerHTML = head + `<div class="dbody"><div class="alert err">${e(err.message)}</div><p><a class="btn sm" href="/carrinho">Revisar carrinho</a></p></div>`;
  }
}

/* ---------- Adicionar rápido (escolha de tamanho) ---------- */
export async function quickAdd(slug, btn) {
  try {
    const { product: p } = await api('/products/' + slug);
    const hasSizes = p.variants.length > 0;
    if (!hasSizes && !p.customization) return finishAdd(p, null, btn);
    modal(`<h3>${e(p.name)} <button class="x" data-action="modal-close" aria-label="Fechar">${icon.x}</button></h3>
      <div class="optlabel">Escolha o tamanho</div><div class="sizes" id="qa-sizes">${p.variants.map((v) => `<button class="size ${p.fulfillment === 'stock' && v.stock <= 0 ? 'off' : ''}" ${p.fulfillment === 'stock' && v.stock <= 0 ? 'disabled' : ''} data-size="${e(v.size)}">${e(v.size)}</button>`).join('')}</div>
      <p class="inst" style="margin:10px 0">Quer personalizar? <a href="/produto/${e(p.slug)}">Abra a página do produto</a>.</p>
      <button class="btn block" id="qa-go" disabled>ADICIONAR AO CARRINHO</button>`);
    let sel = null;
    $('#qa-sizes').addEventListener('click', (ev) => { const b = ev.target.closest('.size'); if (!b || b.disabled) return; $$('#qa-sizes .size').forEach((x) => x.classList.remove('on')); b.classList.add('on'); sel = b.dataset.size; $('#qa-go').disabled = false; });
    $('#qa-go').addEventListener('click', () => { closeModal(); finishAdd(p, sel, btn); });
  } catch (err) { toast(err.message, { err: true }); }
}
function finishAdd(p, size, btn) {
  addToCart({ productId: p.id, size, qty: 1, custom: null, m: { name: p.name, image: p.image, slug: p.slug } });
  if (btn && btn.classList) { const t = btn.textContent; btn.classList.add('done'); btn.textContent = '✓ ADICIONADO'; setTimeout(() => { btn.classList.remove('done'); btn.textContent = t; }, 1600); }
  toast('Produto adicionado ao carrinho', { link: { href: '/carrinho', text: 'Ver carrinho' } });
}

/* ================= Header: menu, mega menu, busca ================= */
const NAV_EMOJI = { futebol: '⚽', chuteiras: '👟', nba: '🏀', nfl: '🏈' };
function buildNav() {
  const items = state.menu.map((s) => ({ ...s, label: s.name.toUpperCase() }));
  $('#nav-list').innerHTML = items.map((s) => `<li data-slug="${e(s.slug)}"><a href="${e(s.path)}">${e(s.label)}</a></li>`).join('') + '<li><a href="/ofertas" class="hot">OFERTAS</a></li>';
  const nav = $('#mainnav'), mega = $('#mega');
  let openT, closeT, cur = null;
  const cancel = () => { clearTimeout(openT); clearTimeout(closeT); };
  const scheduleClose = () => { clearTimeout(closeT); closeT = setTimeout(() => { hideMega(); cur = null; }, 380); }; // tolerância ao sair do menu
  // Abre/troca só depois de uma pequena intenção de hover; dentro do painel nada é trocado nem fechado.
  $('#nav-list').addEventListener('mouseover', (ev) => {
    const li = ev.target.closest('li'); if (!li) return;
    clearTimeout(closeT); clearTimeout(openT);
    if (!li.dataset.slug) { scheduleClose(); return; }
    if (li.dataset.slug === cur && !mega.hidden) return;
    openT = setTimeout(() => { cur = li.dataset.slug; showMega(cur); }, mega.hidden ? 70 : 180);
  });
  $('#nav-list').addEventListener('mouseleave', () => { clearTimeout(openT); if (!mega.hidden) scheduleClose(); else cancel(); });
  mega.addEventListener('mouseenter', cancel);
  mega.addEventListener('mouseleave', scheduleClose);
  nav.addEventListener('focusin', (ev) => { const li = ev.target.closest('li[data-slug]'); if (li) { cancel(); cur = li.dataset.slug; showMega(cur); } });
  nav.addEventListener('focusout', (ev) => { if (!nav.contains(ev.relatedTarget)) scheduleClose(); });
}
function hideMega() { const m = $('#mega'); if (m) { m.hidden = true; $$('#nav-list a.on').forEach((a) => a.classList.remove('on')); } }
/* Painel em colunas: cada nível (departamento → grupo → liga → clube) abre a próxima coluna ao passar o mouse. */
function showMega(slug) {
  const s = state.menu.find((x) => x.slug === slug), m = $('#mega');
  if (!s || !s.items.length) { hideMega(); return; }
  $$('#nav-list a').forEach((a) => a.classList.toggle('on', a.parentElement.dataset.slug === slug));
  const trail = [];                       // índice escolhido em cada coluna
  const defaults = (nodes, d) => { if (d > 2 || !nodes.length) return; const i = nodes.findIndex((n) => n.children.length); if (i < 0) return; trail[d] = i; defaults(nodes[i].children, d + 1); };
  defaults(s.items, 0);
  const render = () => {
    const cols = []; let nodes = s.items, parent = { name: s.name, path: s.path };
    for (let d = 0; d <= trail.length; d++) {
      if (!nodes || !nodes.length) break;
      cols.push(`<div class="mcol" data-d="${d}"><h5>${e(parent.name.toUpperCase())}</h5>${nodes.map((n, i) => `<a href="${e(n.path)}" data-d="${d}" data-i="${i}" class="${trail[d] === i ? 'on' : ''}">${e(n.name)}${n.children.length ? icon.chev : ''}</a>`).join('')}<a class="more" href="${e(parent.path)}">Ver tudo →</a></div>`);
      const sel = nodes[trail[d]]; if (!sel || !sel.children.length) break;
      parent = sel; nodes = sel.children;
    }
    m.innerHTML = `<div class="mega-in">${cols.join('')}</div>`;
  };
  render(); m.hidden = false;
  let lt;
  m.onmouseover = (ev) => {
    const a = ev.target.closest('a[data-i]'); if (!a) return;
    const d = +a.dataset.d, i = +a.dataset.i; if (trail[d] === i) return;
    clearTimeout(lt);
    lt = setTimeout(() => { trail.length = d; trail[d] = i; render(); }, 70);
  };
  m.onmouseleave = () => clearTimeout(lt);
}
function buildMobileMenu() {
  const tree = (nodes) => nodes.map((n) => n.children.length
    ? `<div class="acc-item"><button data-action="acc-toggle" style="font-size:14.5px;padding:10px 6px;font-weight:600"><span>${e(n.name)}</span><i>+</i></button><div class="sub" hidden><a href="${e(n.path)}" class="lg">Ver tudo — ${e(n.name)}</a>${tree(n.children)}</div></div>`
    : `<a href="${e(n.path)}">${e(n.name)}</a>`).join('');
  const d = $('#menu-drawer');
  d.innerHTML = `<header>Menu <button class="x" data-action="drawer-close" aria-label="Fechar">${icon.x}</button></header><div class="dbody">
  ${state.menu.map((s) => `<div class="acc-item"><button data-action="acc-toggle"><span>${NAV_EMOJI[s.slug] || ''} ${e(s.name.toUpperCase())}</span><i>+</i></button><div class="sub" hidden><a href="${e(s.path)}" class="lg">Ver tudo de ${e(s.name)}</a>${tree(s.items)}</div></div>`).join('')}
  <div class="acc-item"><a href="/ofertas" style="color:var(--bad)">🔥 OFERTAS</a></div>
  <div class="acc-item"><a href="/feedbacks">❤️ FEEDBACKS</a></div><div class="acc-item"><a href="/conta">Minha conta</a></div><div class="acc-item"><a href="/favoritos">Favoritos</a></div></div>`;
}
function buildFooter() {
  const s = state.config.settings;
  const wa = (s.whatsapp || '').replace(/\D/g, '');
  $('#footer').innerHTML = `<div class="wrap"><div class="f-grid">
    <div class="brand"><b>SPORT IMPERATIVO</b><p>${e(s.slogan || 'Aqui você veste o esporte.')}</p>
      <div style="font-size:13px">Pix com desconto • Cartão em até ${e(s.max_installments)}x (juros do meio de pagamento)</div></div>
    <div><h4>ATENDIMENTO</h4>${wa ? `<a href="https://wa.me/55${wa.replace(/^55/, '')}" target="_blank" rel="noopener">WhatsApp</a>` : ''}<a href="${e(s.instagram)}" target="_blank" rel="noopener">Instagram</a><a href="mailto:${e(s.email)}">${e(s.email)}</a></div>
    <div><h4>INSTITUCIONAL</h4><a href="/pagina/sobre-nos">Sobre nós</a><a href="/pagina/contato">Contato</a><a href="/pagina/politica-de-privacidade">Política de privacidade</a><a href="/pagina/termos-de-uso">Termos de uso</a><a href="/pagina/politica-de-cookies">Política de cookies</a><a href="/pagina/trocas-e-devolucoes">Trocas e devoluções</a></div>
    <div><h4>AJUDA</h4><a href="/pagina/como-comprar">Como comprar</a><a href="/pagina/formas-de-pagamento">Formas de pagamento</a><a href="/pagina/prazo-de-entrega">Prazo de entrega</a><a href="/pagina/rastreamento">Rastreamento</a><a href="/pagina/tabela-de-medidas">Tabela de medidas</a></div>
    <div><h4>REDES SOCIAIS</h4><a href="${e(s.instagram)}" target="_blank" rel="noopener">Instagram</a><a href="${e(s.tiktok)}" target="_blank" rel="noopener">TikTok</a><a href="${e(s.youtube)}" target="_blank" rel="noopener">YouTube</a></div></div>
    <div class="f-bottom"><span>© ${new Date().getFullYear()} ${e(s.company_name || 'Sport Imperativo Store')}${s.cnpj ? ' • CNPJ ' + e(s.cnpj) : ''}. Todos os direitos reservados.</span><span>Compra segura • Seus dados protegidos (LGPD)</span></div></div>`;
  const w = $('#wa-float'); if (wa) { w.href = `https://wa.me/55${wa.replace(/^55/, '')}`; w.hidden = false; }
}
export function renderAccountLink() { const a = $('#acc-link .lbl'); if (a) a.textContent = state.user ? state.user.name.split(' ')[0] : 'Entrar'; }

/* ---- Busca com autocomplete ---- */
function initSearch() {
  const input = $('#search-input'), box = $('#suggest'), form = $('#search-form');
  let idx = -1;
  const run = debounce(async () => {
    const v = input.value.trim();
    if (v.length < 2) { box.hidden = true; return; }
    try {
      const r = await api('/search/suggest?q=' + encodeURIComponent(v));
      const TL = { club: 'Time', league: 'Liga', national_team: 'Seleção', brand: 'Marca', model: 'Modelo', country: 'País', competition: 'Competição', modality: 'Modalidade', driver: 'Piloto' };
      box.innerHTML = (r.entities.length ? '<h4>TIMES, LIGAS E MARCAS</h4>' + r.entities.map((x) => `<a href="/${e(x.sport_slug || 'futebol')}/${e(x.slug)}"><span><b>${e(x.name)}</b><small>${TL[x.type] || x.type}</small></span></a>`).join('') : '')
        + (r.products.length ? '<h4>PRODUTOS</h4>' + r.products.map((p) => `<a href="/produto/${e(p.slug)}"><img src="${e(p.image)}" alt="" width="44" height="46"><span><b>${e(p.name)}</b><small>${brl(p.pricing.final)} • Pix ${brl(p.pricing.pix)}</small></span></a>`).join('') : '')
        + `<a href="/busca?q=${encodeURIComponent(v)}"><b>Ver todos os resultados para “${e(v)}”</b></a>`;
      box.hidden = false; idx = -1;
    } catch { box.hidden = true; }
  }, 200);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (box.innerHTML && input.value.length > 1) box.hidden = false; });
  input.addEventListener('keydown', (ev) => {
    const links = $$('a', box); if (box.hidden || !links.length) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); idx = (idx + (ev.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length; links.forEach((l, i) => l.classList.toggle('on', i === idx)); }
    if (ev.key === 'Enter' && idx >= 0) { ev.preventDefault(); links[idx].click(); }
  });
  form.addEventListener('submit', (ev) => { ev.preventDefault(); const v = input.value.trim(); if (v) { box.hidden = true; input.blur(); go('/busca?q=' + encodeURIComponent(v)); } });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.search')) box.hidden = true; });
  box.addEventListener('click', () => { box.hidden = true; });
}
function markNav() {
  const first = location.pathname.split('/')[1];
  $$('#nav-list li>a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '/' + first));
}
function cookieBanner() {
  let v = null; try { v = localStorage.getItem('si_cookie'); } catch { /* ignore */ }
  if (v) return;
  const c = $('#cookie'); c.hidden = false;
  c.innerHTML = '<p>Usamos cookies essenciais para o funcionamento da loja (carrinho e login) e, com seu consentimento, para melhorar sua experiência. Veja a <a href="/pagina/politica-de-cookies" style="color:var(--blue);text-decoration:underline">Política de Cookies</a> e a <a href="/pagina/politica-de-privacidade" style="color:var(--blue);text-decoration:underline">Privacidade</a>.</p><button class="btn sm ghost" data-action="cookie-essential">Somente essenciais</button><button class="btn sm" data-action="cookie-accept">Aceitar todos</button>';
}

/* ---- Efeitos: sombra do cabeçalho e revelação ao rolar ---- */
function initFx() {
  const hd = $('#header');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SEL = '.card,.cat-tile,.sec-h,.tcard,.panel,.order,.trust>div,.cat-banner';
  let pending = false;
  // Revela os elementos que já entraram na tela (robusto mesmo com rolagem por salto)
  const sweep = () => {
    pending = false;
    hd.classList.toggle('scrolled', scrollY > 8);
    const lim = innerHeight * 0.94;
    for (const el of $$('.rv:not(.in)', $('#app'))) if (el.getBoundingClientRect().top < lim) el.classList.add('in');
  };
  const queue = () => { if (!pending) { pending = true; requestAnimationFrame(sweep); } };
  const scan = () => {
    if (!reduce) $$(SEL, $('#app')).forEach((el) => {
      if (el.classList.contains('rv')) return;
      const sib = el.parentElement ? [...el.parentElement.children].indexOf(el) : 0;
      el.classList.add('rv'); el.style.transitionDelay = Math.min(sib, 8) * 60 + 'ms';
    });
    queue();
  };
  addEventListener('scroll', queue, { passive: true }); addEventListener('resize', queue);
  new MutationObserver(scan).observe($('#app'), { childList: true, subtree: true });
  scan(); sweep();
  setInterval(sweep, 700); // rede de segurança
}

/* pair-ind: marcador da imagem atual ao arrastar o cartão (dispositivos de toque) */
document.addEventListener('scroll', (ev) => {
  const t = ev.target;
  if (!t || !t.classList || !t.classList.contains('pair')) return;
  const ind = t.parentElement.querySelector('.ind'); if (!ind) return;
  const k = t.scrollLeft > t.clientWidth / 2 ? 1 : 0;
  [...ind.children].forEach((d, i) => d.classList.toggle('on', i === k));
}, true);

/* ================= Boot ================= */
(async function boot() {
  loadCart();
  try {
    const [cfg, menu, me] = await Promise.all([api('/config'), api('/menu'), api('/auth/me')]);
    state.config = cfg; state.sizes = cfg.sizes; state.menu = menu; state.user = me.user; state.favorites = new Set(me.favorites);
  } catch (err) { $('#app').innerHTML = `<div class="wrap empty"><h3>Loja temporariamente indisponível</h3><p>${e(err.message)}</p></div>`; return; }
  buildNav(); buildMobileMenu(); buildFooter(); renderAccountLink(); initSearch(); cookieBanner(); renderCartCount(); initFx();
  render();
})();
