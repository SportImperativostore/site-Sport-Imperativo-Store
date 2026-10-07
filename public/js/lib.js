// Utilitários compartilhados: API, estado, carrinho, componentes pequenos.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const maskCPF = (v) => v.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
export const maskCEP = (v) => v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2');
export const maskPhone = (v) => v.replace(/\D/g, '').slice(0, 11).replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2');

export const state = { config: null, sizes: [], menu: [], user: null, favorites: new Set(), cart: [] };

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data = null;
  try { data = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) { const err = new Error((data && data.error) || 'Erro de conexão. Tente novamente.'); err.status = res.status; throw err; }
  return data;
}

/* ---------- Carrinho (local, validado/precificado no servidor) ---------- */
const CK = 'si_cart_v1';
export function loadCart() { try { state.cart = JSON.parse(localStorage.getItem(CK) || '[]'); } catch { state.cart = []; } renderCartCount(); }
export function saveCart() { try { localStorage.setItem(CK, JSON.stringify(state.cart)); } catch { /* ignore */ } renderCartCount(); }
export const cartKey = (i) => `${i.productId}|${i.size || ''}|${i.custom ? i.custom.name + '#' + i.custom.number : ''}`;
export const cartQty = () => state.cart.reduce((a, i) => a + i.qty, 0);
export function addToCart(item) {
  const k = cartKey(item), ex = state.cart.find((i) => cartKey(i) === k);
  if (ex) ex.qty = Math.min(20, ex.qty + item.qty); else state.cart.push(item);
  saveCart();
  const c = $('#cart-count'); if (c) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
}
export function renderCartCount() {
  const c = $('#cart-count'); if (!c) return;
  const n = cartQty(); c.textContent = n; c.hidden = !n;
}
export const cartPayload = (extra = {}) => ({ items: state.cart.map((i) => ({ productId: i.productId, size: i.size, qty: i.qty, custom: i.custom })), ...extra });

/* ---------- UI ---------- */
export function toast(msg, { err = false, link } = {}) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.innerHTML = `<span>${e(msg)}</span>${link ? `<a href="${e(link.href)}">${e(link.text)}</a>` : ''}`;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 5000 : 3500);
}
export function modal(html, { onClose } = {}) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false; document.body.style.overflow = 'hidden';
  m._onClose = onClose;
  const first = $('input,select,button.btn', m); if (first) first.focus?.();
}
export function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; document.body.style.overflow = ''; if (m._onClose) m._onClose(); }
export const icon = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.6 4.6 0 018-3 4.6 4.6 0 018 3c0 5.8-8 11-8 11z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  truck: '<svg viewBox="0 0 24 24"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  pix: '<svg viewBox="0 0 24 24"><path d="M12 3l4 4-4 4-4-4zM12 13l4 4-4 4-4-4zM3 12l4-4M17 8l4 4-4 4M3 12l4 4"/></svg>',
  card: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.300 11l7.400-4M8.300 13l7.400 4"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v.01M12 11v5"/></svg>',
  chev: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M9 6l6 6-6 6"/></svg>',
};
export function starsHtml(avg, count) {
  const full = Math.round(avg || 0);
  return `<span class="stars" aria-label="${avg || 0} de 5">${'★'.repeat(full)}<span style="color:#d6deec">${'★'.repeat(5 - full)}</span>${count !== undefined ? `<small>${count ? `(${count})` : 'Sem avaliações'}</small>` : ''}</span>`;
}
export function priceBlock(p, big = false) {
  const pr = p.pricing;
  return `${pr.onSale ? `<div class="price-old">${brl(pr.original)}</div>` : '<div class="price-old">&nbsp;</div>'}
  <div><span class="price">${brl(pr.final)}</span>${pr.discountPct ? `<span class="pct">-${pr.discountPct}%</span>` : ''}</div>
  <div class="pix">${brl(pr.pix)} <span style="font-weight:600">no Pix</span></div>
  <div class="inst">ou em até ${pr.installments.n}x no cartão</div>`;
}
export function productCard(p) {
  const fav = state.favorites.has(p.id);
  const badge = p.badge ? `<span class="badge b-${p.badge.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-')}">${e(p.badge)}</span>` : '';
  return `<article class="card">
    <a href="/produto/${e(p.slug)}" class="img ${p.image2 ? 'two' : 'one'}" aria-label="${e(p.name)}">${badge}<span class="pair"><img class="i1" src="${e(p.image)}" alt="${e(p.name)}" loading="lazy" decoding="async" width="600" height="600">${p.image2 ? `<img class="i2" src="${e(p.image2)}" alt="" loading="lazy" decoding="async" width="600" height="600">` : ''}</span>${p.image2 ? '<span class="ind" aria-hidden="true"><i class="on"></i><i></i></span>' : ''}</a>
    <button class="fav ${fav ? 'on' : ''}" data-action="fav" data-id="${p.id}" aria-label="Favoritar" aria-pressed="${fav}">${icon.heart}</button>
    <div class="body">
      <div class="meta">${e(p.category)}${p.club ? ' • ' + e(p.club) : ''}</div>
      <a class="nm" href="/produto/${e(p.slug)}">${e(p.name)}</a>
      ${starsHtml(p.rating.avg, p.rating.count)}
      <div>${priceBlock(p)}</div>
      <div class="avail ${p.availability.code}">${e(p.availability.label)}</div>
      <div class="more-info">${p.fulfillment === 'import' ? 'Importado • frete grátis' : 'Envio imediato do Brasil'}${p.customizable ? ' • Personalizável' : ''}</div>
      <button class="add" data-action="quick-add" data-id="${p.id}" data-slug="${e(p.slug)}">ADICIONAR AO CARRINHO</button>
    </div></article>`;
}
export const skeletonGrid = (n = 8) => `<div class="grid">${Array.from({ length: n }, () => '<div class="skeleton" style="aspect-ratio:1/1.5"></div>').join('')}</div>`;

export async function toggleFav(id, btn) {
  if (!state.user) { toast('Entre na sua conta para salvar favoritos.', { link: { href: '/login?next=' + encodeURIComponent(location.pathname), text: 'Entrar' } }); return; }
  try {
    const r = await api('/account/favorites/' + id, { method: 'POST' });
    r.favorite ? state.favorites.add(id) : state.favorites.delete(id);
    $$(`.fav[data-id="${id}"]`).forEach((b) => { b.classList.toggle('on', r.favorite); b.setAttribute('aria-pressed', r.favorite); });
  } catch (err) { toast(err.message, { err: true }); }
}
export function setMeta(title, desc) {
  document.title = title;
  if (desc) { const m = $('meta[name=description]'); if (m) m.content = desc; }
}
export function pager(total, page, per, make) {
  const pages = Math.ceil(total / per);
  if (pages <= 1) return '';
  const nums = [];
  for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 2) nums.push(i); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return `<div class="pager">${nums.map((n) => (n === '…' ? '<span>…</span>' : `<button class="${n === page ? 'on' : ''}" data-action="page" data-page="${n}">${n}</button>`)).join('')}</div>`;
}
