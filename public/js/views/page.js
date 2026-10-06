import { $, e, api, setMeta } from '../lib.js';
export default async function page({ params }) {
  const p = await api('/pages/' + params[0]);
  setMeta(p.title + ' | Sport Imperativo Store');
  // O conteúdo é editado apenas por administradores (confiável) no painel.
  $('#app').innerHTML = `<div class="wrap"><nav class="crumbs"><a href="/">Início</a><i>›</i><span>${e(p.title)}</span></nav><h1 class="page-h">${e(p.title)}</h1><div class="prose">${p.body || ''}</div></div>`;
}
