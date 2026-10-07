import { $, e, api, state, setMeta, starsHtml } from '../lib.js';
import { storiesStrip } from './stories.js';

const igEmbed = (url) => { const m = String(url || '').match(/instagram\.com\/(?:[\w.]+\/)?(reel|reels|p|tv)\/([\w-]+)/); return m ? `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed` : null; };

function card(t) {
  const ig = t.kind === 'instagram' ? igEmbed(t.link) : null;
  let media = '';
  if (t.kind === 'video' && t.media_url) media = `<video src="${e(t.media_url)}#t=0.5" controls preload="metadata" playsinline></video>`;
  else if (t.kind === 'photo' && t.media_url) media = `<img src="${e(t.media_url)}" alt="Foto de ${e(t.name)}" loading="lazy">`;
  else if (ig) media = `<iframe src="${ig}" title="Instagram" loading="lazy" allowfullscreen scrolling="no"></iframe>`;
  return `<article class="fb-card">${media ? `<div class="fb-media${ig ? ' ig' : ''}">${media}</div>` : ''}
    <div class="fb-body"><b>${e(t.name || 'Cliente')}</b>${t.stars ? `<div>${starsHtml(t.stars)}</div>` : ''}${t.body ? `<p>${e(t.body)}</p>` : ''}
    ${t.product_name ? `<small>${t.product_slug ? `<a href="/produto/${e(t.product_slug)}">${e(t.product_name)}</a>` : e(t.product_name)}</small>` : ''}
    ${t.link && !ig ? `<a class="btn sm" href="${e(t.link)}" target="_blank" rel="noopener">Ver no Instagram</a>` : ''}</div></article>`;
}

export default async function feedbacks() {
  setMeta('Feedbacks de clientes | Sport Imperativo Store');
  const list = await api('/testimonials');
  const s = (state.config && state.config.settings) || {};
  const ig = s.instagram_feedback_url || s.instagram;
  $('#app').innerHTML = `<div class="wrap"><nav class="crumbs"><a href="/">Início</a><i>›</i><span>Feedbacks</span></nav>
    <h1 class="page-h">❤️ Feedbacks de clientes</h1>
    <p style="max-width:640px;color:#51607a">Veja o que quem já comprou na Sport Imperativo Store está falando: vídeos, fotos e relatos reais.</p>
    ${list.length ? `${storiesStrip('fbpage', list)}<div class="fb-grid">${list.map(card).join('')}</div>` : '<p class="empty">Em breve, novos feedbacks de clientes.</p>'}
    ${ig ? `<p style="text-align:center;margin:24px 0"><a class="btn" href="${e(ig)}" target="_blank" rel="noopener">VER MAIS NO INSTAGRAM</a></p>` : ''}</div>`;
}
