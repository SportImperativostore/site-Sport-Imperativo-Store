import { $, e, starsHtml } from '../lib.js';
import { actions } from '../app.js';

const lists = {};
const igEmbed = (url) => { const m = String(url || '').match(/instagram\.com\/(?:[\w.]+\/)?(reel|reels|p|tv)\/([\w-]+)/); return m ? `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed` : null; };
const initial = (n) => e((n || '?').trim()[0] || '?').toUpperCase();

/** Faixa de "stories" (bolinhas) com relatos de clientes. */
export function storiesStrip(id, items) {
  const list = items.filter((t) => t.media_url || t.link);
  lists[id] = list;
  if (!list.length) return '';
  return `<div class="stories" role="list">${list.map((t, i) => `<button class="story-dot" role="listitem" data-action="story" data-list="${id}" data-i="${i}" aria-label="Ver relato de ${e(t.name)}">
    <span class="ring">${t.kind === 'photo' && t.media_url ? `<img src="${e(t.media_url)}" alt="" loading="lazy">` : t.kind === 'video' && t.media_url ? `<video src="${e(t.media_url)}#t=0.5" muted preload="metadata" playsinline></video>` : `<b>${initial(t.name)}</b>`}<i class="play">${t.kind === 'photo' ? '' : '▶'}</i></span>
    <small>${e((t.name || '').split(' ')[0])}</small></button>`).join('')}</div>`;
}

function close() { const o = $('#story-ov'); if (o) { o.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', keys); clearTimeout(timer); } }
let timer, cur = { id: '', i: 0 };
const keys = (ev) => { if (ev.key === 'Escape') close(); if (ev.key === 'ArrowRight') step(1); if (ev.key === 'ArrowLeft') step(-1); };
function step(d) { const n = lists[cur.id].length, k = cur.i + d; if (k < 0) return; if (k >= n) return close(); show(cur.id, k); }

function show(id, i) {
  cur = { id, i }; clearTimeout(timer);
  const list = lists[id], t = list[i];
  let o = $('#story-ov');
  if (!o) { o = document.createElement('div'); o.id = 'story-ov'; o.className = 'story-ov'; document.body.appendChild(o); document.body.style.overflow = 'hidden'; document.addEventListener('keydown', keys); }
  const ig = t.kind === 'instagram' ? igEmbed(t.link) : null;
  let media;
  if (t.kind === 'video' && t.media_url) media = `<video src="${e(t.media_url)}" autoplay playsinline controls controlsList="nodownload" id="story-vid"></video>`;
  else if (t.kind === 'photo' && t.media_url) media = `<img src="${e(t.media_url)}" alt="Foto de ${e(t.name)}">`;
  else if (ig) media = `<iframe src="${ig}" title="Instagram" allowfullscreen scrolling="no" style="background:#fff"></iframe>`;
  else media = `<div class="story-txt"><p>“${e(t.body || '')}”</p>${t.link ? `<a class="btn white" href="${e(t.link)}" target="_blank" rel="noopener">Abrir no Instagram</a>` : ''}</div>`;
  o.innerHTML = `<div class="story-box">
    <div class="story-bars">${list.map((_, k) => `<span class="${k < i ? 'done' : k === i ? 'cur' : ''}"></span>`).join('')}</div>
    <div class="story-head"><span class="av">${initial(t.name)}</span><span><b>${e(t.name || 'Cliente')}</b><br><small>${t.product_name ? e(t.product_name) : 'Cliente Sport Imperativo'}</small></span><button class="x" data-sclose aria-label="Fechar" style="color:#fff;margin-left:auto">✕</button></div>
    <div class="story-media">${media}</div>
    <button class="story-nav prev" data-sstep="-1" aria-label="Anterior"></button><button class="story-nav next" data-sstep="1" aria-label="Próximo"></button>
    <div class="story-foot">${t.stars ? starsHtml(t.stars) : ''}${t.body && t.kind !== 'instagram' ? `<p>${e(t.body)}</p>` : ''}${t.product_slug ? `<a class="btn sm white" href="/produto/${e(t.product_slug)}" data-sclose>VER PRODUTO</a>` : ''}${t.link && t.kind === 'instagram' && !ig ? `<a class="btn sm white" href="${e(t.link)}" target="_blank" rel="noopener">Abrir no Instagram</a>` : ''}</div></div>`;
  o.onclick = (ev) => {
    if (ev.target.closest('[data-sclose]')) { close(); return; }
    const s = ev.target.closest('[data-sstep]'); if (s) step(+s.dataset.sstep); else if (ev.target === o) close();
  };
  const v = $('#story-vid');
  if (v) v.onended = () => step(1);
  else if (t.kind === 'photo' || (!ig && t.kind !== 'video')) timer = setTimeout(() => step(1), 6000);
}
actions.story = (el) => show(el.dataset.list, +el.dataset.i);
