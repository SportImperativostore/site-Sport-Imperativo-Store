import { $, $$, e, api, modal, icon } from '../lib.js';

const ORDER = ['Infantil', 'Feminina', 'Jogador', 'Torcedor'];
let cache = null;
async function guides() {
  if (!cache) {
    const g = await api('/size-guides');
    cache = g.sort((a, b) => { const ia = ORDER.indexOf(a.name), ib = ORDER.indexOf(b.name); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.id - b.id; });
  }
  return cache;
}
const table = (g) => `<div class="tw"><table class="t gt"><thead><tr>${g.headers.map((h) => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${g.rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${e(c)}</td>` : `<th scope="row">${e(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>${g.notes ? `<p class="inst" style="margin-top:10px">${e(g.notes)}</p>` : ''}`;

/** HTML com abas (Infantil · Feminina · Jogador · Torcedor…) e a tabela da aba ativa. */
export function guideTabs(list, active) {
  const cur = list.find((g) => g.name === active) || list.find((g) => g.name === 'Torcedor') || list[0];
  return `<div class="tabs gtabs" role="tablist">${list.map((g) => `<a href="#" role="tab" data-g="${g.id}" class="${g.id === cur.id ? 'on' : ''}">${e(g.name.toUpperCase())}</a>`).join('')}</div><div id="gbody">${table(cur)}</div>`;
}
export function bindGuide(root, list) {
  root.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-g]'); if (!a) return;
    ev.preventDefault();
    $$('.gtabs a', root).forEach((x) => x.classList.toggle('on', x === a));
    $('#gbody', root).innerHTML = table(list.find((g) => String(g.id) === a.dataset.g));
  });
}
export async function openGuide(active) {
  const list = await guides();
  modal(`<h3>Tabela de medidas <button class="x" data-action="modal-close" aria-label="Fechar">${icon.x}</button></h3>${guideTabs(list, active)}<p class="inst" style="margin-top:8px">Em dúvida entre dois tamanhos, escolha o maior.</p>`);
  bindGuide($('#modal'), list);
}
export async function guidePage(box) {
  const list = await guides();
  box.innerHTML = `<p class="inst">Escolha o tipo de camisa para ver as medidas.</p>${guideTabs(list, 'Torcedor')}`;
  bindGuide(box, list);
}
