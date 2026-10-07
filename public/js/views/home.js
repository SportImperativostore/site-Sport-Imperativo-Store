import { storiesStrip } from './stories.js';
import { $, e, api, state, productCard, setMeta, skeletonGrid, icon, starsHtml } from '../lib.js';

const EMO = { futebol: '⚽', nba: '🏀', nfl: '🏈', chuteiras: '👟' };
const TILES = [['futebol', 'Futebol', 't1', '/futebol', 'Clubes e seleções'], ['nba', 'NBA', 't2', '/nba', 'Camisas e regatas'], ['nfl', 'NFL', 't3', '/nfl', 'Jerseys dos times'], ['f1', 'F1', 't4', '/f1', 'Equipes e pilotos'],
  ['chuteiras', 'Chuteiras', 't5', '/chuteiras', 'Campo, society e futsal'], ['agasalhos', 'Agasalhos', 't6', '/futebol/agasalhos', 'Para o frio'], ['conjuntos', 'Conjuntos', 't7', '/futebol/conjuntos', 'Treino e passeio'], ['ofertas', 'Ofertas', 't8', '/ofertas', 'Até -30%']];

export default async function home() {
  setMeta('Sport Imperativo Store — Aqui você veste o esporte.');
  $('#app').innerHTML = `<div class="skeleton" style="height:420px"></div><div class="wrap">${skeletonGrid(4)}</div>`;
  const [h, fut] = await Promise.all([api('/home'), api('/catalog?path=futebol').catch(() => null)]);
  const banners = h.banners.length ? h.banners : [{ title: 'AQUI VOCÊ VESTE O ESPORTE.', subtitle: 'Camisas de futebol, NBA, NFL, F1, chuteiras e muito mais.', cta_text: 'COMPRAR AGORA', link: '/futebol' }];
  const fe = (t) => (fut && fut.facets.entities[t]) || [];
  const chips = (list, base = '/futebol/') => list.map((x) => `<a class="chip" href="${base}${e(x.slug)}">${e(x.name.replace(/^Seleção /, ''))}</a>`).join('');
  $('#app').innerHTML = `
  <section class="hero" aria-label="Destaques"><div class="slides" id="slides">${banners.map((b, i) => `
    <div class="slide ${b.image_desktop ? 'img' : ''}${i === 0 ? ' on' : ''}">${b.image_desktop ? `<picture><source media="(max-width:860px)" srcset="${e(b.image_mobile || b.image_desktop)}"><img src="${e(b.image_desktop)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" ${i ? 'loading="lazy"' : ''}></picture><span style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,19,46,.8),rgba(6,19,46,.15))"></span>` : '<div class="stripes"></div>'}
      <div class="wrap"><h1>${e(b.title)}</h1><p>${e(b.subtitle || '')}</p>${b.cta_text ? `<a class="btn white" href="${e(b.link || '/')}" style="height:52px;padding:0 32px;font-size:15px">${e(b.cta_text)}</a>` : ''}</div></div>`).join('')}</div>
    ${banners.length > 1 ? `<div class="dots">${banners.map((_, i) => `<button class="${i ? '' : 'on'}" data-i="${i}" aria-label="Banner ${i + 1}"></button>`).join('')}</div>` : ''}</section>
  <div class="trust">
    <div>${icon.pix}<span><b>Pix com desconto</b>${e(state.config.settings.pix_pct)}% off à vista</span></div>
    <div>${icon.card}<span><b>Até ${e(state.config.settings.max_installments)}x no cartão</b>juros conforme o meio de pagamento</span></div>
    <div>${icon.truck}<span><b>Enviamos para o mundo todo</b>pronta entrega e importados</span></div>
    <div>${icon.shield}<span><b>Compra segura</b>dados protegidos</span></div></div>
  <div class="wrap">
  <section class="block"><div class="sec-h"><h2>Mais <span>vendidos</span></h2><a href="/busca?q=">Ver todos →</a></div><div class="grid">${h.best.map(productCard).join('')}</div></section>
  <section class="block"><div class="sec-h"><h2>Compre por <span>categoria</span></h2></div><div class="big4">${h.showcase.map((t) => `<a class="big-tile k-${t.key}" href="${e(t.path)}" aria-label="${e(t.title)}">${t.image ? `<img class="ph" src="${e(t.image)}" alt="" loading="lazy" decoding="async">` : ''}${['nba', 'nfl'].includes(t.key) ? `<img class="lg" src="/img/logos/${t.key}.svg" alt="Logo ${e(t.title)}" loading="lazy">` : ''}<span class="cap"><b>${EMO[t.key] || ''} ${e(t.title.toUpperCase())}</b><small>${e(t.tagline)}</small><i>${t.count ? 'VER PRODUTOS →' : 'EM BREVE'}</i></span></a>`).join('')}</div></section>
  ${fut ? `<section class="block"><div class="sec-h"><h2>⚽ <span>Futebol</span></h2><a href="/futebol">Ver tudo →</a></div>
    <div class="panel"><h3>Camisas de Futebol</h3><div class="tabs" style="flex-wrap:wrap;overflow:visible">${chips((fut.categoryTabs || []).map((t) => ({ name: t.name, slug: t.slug })), '/futebol/')}</div><h3 style="margin-top:8px">Ligas</h3><div class="tabs" style="flex-wrap:wrap;overflow:visible">${chips(fe('league'))}</div><h3 style="margin-top:8px">Seleções</h3><div class="tabs" style="flex-wrap:wrap;overflow:visible"><a class="chip" href="/futebol/camisas-de-futebol/selecoes">Ver todas as seleções</a></div></div></section>` : ''}
  ${h.offers.length ? `<section class="block"><div class="sec-h"><h2>🔥 Ofertas da <span>temporada</span></h2><a href="/ofertas">Ver ofertas →</a></div><div class="grid">${h.offers.map(productCard).join('')}</div></section>` : ''}
  <section class="block"><div class="sec-h"><h2>Lançamentos</h2><a href="/futebol">Ver mais →</a></div><div class="grid">${h.news.slice(0, 4).map(productCard).join('')}</div></section></div>
  <section class="proof"><div class="wrap"><div class="sec-h"><h2>❤️ Quem compra, <span>recomenda.</span></h2><a href="${e(state.config.settings.instagram_feedback_url || state.config.settings.instagram)}" target="_blank" rel="noopener">VER MAIS FEEDBACKS →</a></div>
    ${storiesStrip('home', h.testimonials)}<div class="proof-grid">${h.testimonials.slice(0, 8).map((t) => `<div class="tcard">${t.kind === 'photo' && t.media_url ? `<img src="${e(t.media_url)}" alt="Foto de ${e(t.name)}" loading="lazy">` : t.kind === 'video' && t.media_url ? `<video src="${e(t.media_url)}#t=0.5" controls preload="metadata" playsinline></video>` : t.kind === 'instagram' && t.link ? `<a class="btn ghost sm" href="${e(t.link)}" target="_blank" rel="noopener">Ver no Instagram</a>` : ''}${starsHtml(t.stars)}<p>“${e(t.body || '')}”</p><small><b>${e(t.name)}</b>${t.product_name ? ' • ' + e(t.product_name) : ''}</small></div>`).join('')}</div>
    <p style="text-align:center;margin-top:20px"><a class="btn" href="${e(state.config.settings.instagram_feedback_url || state.config.settings.instagram)}" target="_blank" rel="noopener">VER MAIS FEEDBACKS</a></p></div></section>`;
  // Carrossel simples
  const slides = $('#slides'), dots = [...document.querySelectorAll('.dots button')];
  if (dots.length) {
    let i = 0, timer; const go = (n) => { i = (n + dots.length) % dots.length; slides.style.transform = `translateX(-${i * 100}%)`; [...slides.children].forEach((s, k) => s.classList.toggle('on', k === i)); dots.forEach((d, k) => d.classList.toggle('on', k === i)); };
    const start = () => { clearInterval(timer); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) timer = setInterval(() => { if (!document.hidden && $('#slides') === slides) go(i + 1); else if ($('#slides') !== slides) clearInterval(timer); }, 6000); };
    dots.forEach((d) => d.addEventListener('click', () => { go(+d.dataset.i); start(); }));
    let sx = 0; slides.addEventListener('touchstart', (ev) => { sx = ev.touches[0].clientX; }, { passive: true });
    slides.addEventListener('touchend', (ev) => { const dx = ev.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) { go(i + (dx < 0 ? 1 : -1)); start(); } });
    start();
  }
}
