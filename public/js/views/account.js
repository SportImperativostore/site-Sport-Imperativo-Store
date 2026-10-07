import { $, $$, e, brl, api, state, toast, setMeta, productCard, maskCPF, maskCEP, maskPhone, icon } from '../lib.js';
import { go, renderAccountLink } from '../app.js';

export async function auth({ params, query }) {
  const mode = params[0] === 'cadastro' ? 'register' : 'login';
  const next = query.get('next') || '/conta';
  if (state.user) return go(next.startsWith('/') ? next : '/conta', true);
  setMeta((mode === 'login' ? 'Entrar' : 'Criar conta') + ' | Sport Imperativo Store');
  $('#app').innerHTML = `<div class="wrap"><div class="auth panel"><h1 class="page-h" style="margin-top:0;font-size:26px">${mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
    <form id="f" class="field" novalidate>
      ${mode === 'register' ? '<label>Nome completo</label><input name="name" autocomplete="name" required><label style="margin-top:10px">CPF (opcional)</label><input name="cpf" inputmode="numeric" maxlength="14" autocomplete="off"><label style="margin-top:10px">Telefone (opcional)</label><input name="phone" inputmode="tel" autocomplete="tel">' : ''}
      <label style="margin-top:10px">E-mail</label><input name="email" type="email" autocomplete="email" required>
      <label style="margin-top:10px">Senha${mode === 'register' ? ' (mín. 8 caracteres)' : ''}</label><input name="password" type="password" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}" required>
      ${mode === 'register' ? '<label class="check"><input type="checkbox" name="consent"><span>Li e aceito os <a href="/pagina/termos-de-uso" target="_blank" style="text-decoration:underline">Termos de Uso</a> e a <a href="/pagina/politica-de-privacidade" target="_blank" style="text-decoration:underline">Política de Privacidade</a> (LGPD).</span></label>' : ''}
      <div class="alert err" id="err" hidden role="alert"></div>
      <button class="btn block" style="margin-top:14px">${mode === 'login' ? 'ENTRAR' : 'CRIAR CONTA'}</button></form>
    <p class="inst" style="margin-top:14px;text-align:center">${mode === 'login' ? `Novo por aqui? <a href="/cadastro?next=${encodeURIComponent(next)}" style="color:var(--blue);font-weight:700">Criar conta</a>` : `Já tem conta? <a href="/login?next=${encodeURIComponent(next)}" style="color:var(--blue);font-weight:700">Entrar</a>`}</p></div></div>`;
  const f = $('#f');
  if (f.cpf) f.cpf.addEventListener('input', (ev) => { ev.target.value = maskCPF(ev.target.value); });
  if (f.phone) f.phone.addEventListener('input', (ev) => { ev.target.value = maskPhone(ev.target.value); });
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const body = Object.fromEntries(new FormData(f)); body.consent = !!f.consent?.checked;
    const btn = $('button', f); btn.disabled = true;
    try {
      const r = await api('/auth/' + (mode === 'login' ? 'login' : 'register'), { method: 'POST', body });
      state.user = r.user; const me = await api('/auth/me'); state.favorites = new Set(me.favorites); renderAccountLink();
      toast(`Olá, ${r.user.name.split(' ')[0]}!`);
      go(r.user.role === 'admin' && next === '/conta' ? '/conta' : (next.startsWith('/') && !next.startsWith('//') ? next : '/conta'), true);
    } catch (err) { const el = $('#err'); el.textContent = err.message; el.hidden = false; btn.disabled = false; }
  });
}

const SECTIONS = [['dados', 'Dados pessoais'], ['enderecos', 'Endereços'], ['pedidos', 'Pedidos'], ['favoritos', 'Favoritos'], ['avaliacoes', 'Avaliações'], ['cupons', 'Cupons'], ['seguranca', 'Segurança']];
export async function account({ params }) {
  if (!state.user) return go('/login?next=' + encodeURIComponent(location.pathname), true);
  const sec = params[0] || 'dados';
  setMeta('Minha conta | Sport Imperativo Store');
  $('#app').innerHTML = `<div class="wrap"><h1 class="page-h">${sec === 'favoritos' ? 'Meus favoritos' : sec === 'pedidos' ? 'Meus pedidos' : 'Minha conta'}</h1><div class="acc"><nav aria-label="Conta">${SECTIONS.map(([k, n]) => `<a href="/conta/${k}" class="${k === sec ? 'on' : ''}">${n}</a>`).join('')}${state.user.role === 'admin' ? '<a href="/admin/">Painel administrativo</a>' : ''}<a href="#" data-action="logout" style="color:var(--bad)">Sair</a></nav><div id="sec"><div class="skeleton" style="height:200px"></div></div></div></div>`;
  const box = $('#sec');
  const sections = { dados, enderecos, pedidos, favoritos, avaliacoes, cupons, seguranca };
  try { await (sections[sec] || dados)(box); } catch (err) { box.innerHTML = `<div class="alert err">${e(err.message)}</div>`; }
}

function dados(box) {
  const u = state.user;
  box.innerHTML = `<form class="panel field" id="pf"><div class="fgrid"><div class="full"><label>Nome</label><input name="name" value="${e(u.name)}"></div><div><label>E-mail</label><input value="${e(u.email)}" disabled></div><div><label>CPF</label><input name="cpf" value="${e(maskCPF(u.cpf || ''))}" maxlength="14"></div><div><label>Telefone</label><input name="phone" value="${e(maskPhone(u.phone || ''))}"></div><div><label>WhatsApp</label><input name="whatsapp" value="${e(maskPhone(u.whatsapp || ''))}"></div></div><button class="btn" style="margin-top:14px">SALVAR</button></form>`;
  const f = $('#pf'); f.cpf.oninput = (ev) => { ev.target.value = maskCPF(ev.target.value); };
  f.addEventListener('submit', async (ev) => { ev.preventDefault(); try { const r = await api('/account/profile', { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); state.user = r.user; renderAccountLink(); toast('Dados salvos.'); } catch (err) { toast(err.message, { err: true }); } });
}
async function enderecos(box) {
  const list = await api('/account/addresses');
  box.innerHTML = `${list.map((a) => `<div class="panel" style="display:flex;justify-content:space-between;gap:10px"><div><b>${e(a.label || 'Endereço')}</b>${a.is_default ? ' <span class="pill">Padrão</span>' : ''}<br>${e(a.street)}, ${e(a.number)} ${e(a.complement || '')}<br>${e(a.district)} — ${e(a.city)}/${e(a.state)} • CEP ${e(maskCEP(a.cep))}</div><button class="rm" style="color:var(--bad);font-weight:600" data-del="${a.id}">Excluir</button></div>`).join('') || '<p class="inst">Nenhum endereço salvo.</p>'}
  <form class="panel field" id="af" style="margin-top:14px"><h3>Novo endereço</h3><div class="fgrid"><div><label>Apelido</label><input name="label" placeholder="Casa"></div><div><label>CEP</label><input name="cep" maxlength="9" inputmode="numeric"></div><div class="full"><label>Rua</label><input name="street"></div><div><label>Número</label><input name="number"></div><div><label>Complemento</label><input name="complement"></div><div><label>Bairro</label><input name="district"></div><div><label>Cidade</label><input name="city"></div><div><label>UF</label><input name="state" maxlength="2"></div></div><label class="check"><input type="checkbox" name="is_default"> Definir como padrão</label><button class="btn">SALVAR ENDEREÇO</button></form>`;
  const f = $('#af');
  f.cep.addEventListener('input', async (ev) => { ev.target.value = maskCEP(ev.target.value); if (ev.target.value.length === 9) { try { const r = await api('/cep/' + ev.target.value.replace(/\D/g, '')); f.street.value = r.street || ''; f.district.value = r.district || ''; f.city.value = r.city || ''; f.state.value = r.state || ''; } catch { /* manual */ } } });
  f.addEventListener('submit', async (ev) => { ev.preventDefault(); const b = Object.fromEntries(new FormData(f)); b.is_default = !!f.is_default.checked; try { await api('/account/addresses', { method: 'POST', body: b }); toast('Endereço salvo.'); enderecos(box); } catch (err) { toast(err.message, { err: true }); } });
  box.addEventListener('click', async (ev) => { const d = ev.target.closest('[data-del]'); if (d) { await api('/account/addresses/' + d.dataset.del, { method: 'DELETE' }); enderecos(box); } });
}
async function pedidos(box) {
  const list = await api('/account/orders');
  if (!list.length) { box.innerHTML = '<div class="empty"><h3>Você ainda não fez pedidos</h3><p><a class="btn" href="/futebol" style="margin-top:12px">Ver produtos</a></p></div>'; return; }
  box.innerHTML = list.map((o) => `<div class="order"><header><div><b>Pedido #${e(o.ref)}</b> <span class="pill">${e(o.statusLabel)}</span><br><small style="color:var(--mut)">${new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR')} • ${o.paymentMethod === 'pix' ? 'Pix' : 'Cartão ' + o.installments + 'x'} • ${o.shipping_info.map((g) => e(g.carrier || g.title)).join(' + ')}</small></div><b>${brl(o.total)}</b></header>
    ${o.timeline ? `<div class="timeline">${o.timeline.map((s, i) => `<div class="tl ${s.done ? 'done' : ''} ${s.current ? 'cur' : ''}"><i>${s.done ? '✓' : i + 1}</i><span>${e(s.label)}</span></div>`).join('')}</div>` : ''}
    <div style="font-size:14px;font-weight:600;margin-bottom:6px">${e(o.customerMessage || '')}</div><div style="font-size:14px">${o.items.map((i) => `<div>${i.qty}x ${e(i.name)}${i.size ? ' (' + e(i.size) + ')' : ''}${i.custom_name || i.custom_number ? ' — ' + e(i.custom_name || '') + ' ' + e(i.custom_number || '') : ''}${i.custom_extra ? ' — ' + e(i.custom_extra) : ''}</div>`).join('')}</div>
    ${o.shipments.filter((s) => s.code).map((s) => `<div class="alert ok" style="margin-top:8px"><b>Rastreio:</b> ${e(s.carrier || '')} <b>${e(s.code)}</b> ${s.url ? `<a href="${e(s.url)}" target="_blank" rel="noopener" style="text-decoration:underline">Rastrear</a>` : ''}</div>`).join('')}
    <p style="margin-top:10px"><a class="btn sm ghost" href="/pedido/${o.id}">Ver detalhes${o.status === 'payment_pending' ? ' / pagar' : ''}</a></p></div>`).join('');
}
async function favoritos(box) {
  const list = await api('/account/favorites');
  box.innerHTML = list.length ? `<div class="grid" style="grid-template-columns:repeat(3,1fr)">${list.map(productCard).join('')}</div>` : '<div class="empty"><h3>Nenhum favorito ainda</h3><p>Toque no coração dos produtos para salvá-los aqui.</p></div>';
}
async function avaliacoes(box) {
  const list = await api('/account/reviews');
  box.innerHTML = list.map((r) => `<div class="panel"><b>${e(r.product)}</b> <span class="pill">${r.status === 'approved' ? 'Publicada' : r.status === 'pending' ? 'Em análise' : 'Oculta'}</span><div class="stars">${'★'.repeat(r.stars)}</div><p>${e(r.body || '')}</p></div>`).join('') || '<p class="inst">Você ainda não avaliou produtos. Após receber seu pedido, avalie na página do produto.</p>';
}
async function cupons(box) {
  const list = await api('/account/coupons');
  box.innerHTML = list.map((c) => `<div class="panel" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b style="font-size:18px;letter-spacing:1px">${e(c.code)}</b><br><small>${e(c.description || '')}${c.ends_at ? ' • válido até ' + new Date(c.ends_at.replace(' ', 'T')).toLocaleDateString('pt-BR') : ''}</small></div><button class="btn sm ghost" data-copy="${e(c.code)}">COPIAR</button></div>`).join('') || '<p class="inst">Nenhum cupom disponível no momento.</p>';
  box.addEventListener('click', (ev) => { const b = ev.target.closest('[data-copy]'); if (b) { navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Cupom copiado!')); } });
}
function seguranca(box) {
  box.innerHTML = `<form class="panel field" id="pw"><h3>Alterar senha</h3><label>Senha atual</label><input type="password" name="current" autocomplete="current-password"><label style="margin-top:10px">Nova senha</label><input type="password" name="next" autocomplete="new-password"><button class="btn" style="margin-top:14px">ALTERAR SENHA</button></form>
  <div class="panel"><h3>Seus dados (LGPD)</h3><p class="inst">Você pode baixar uma cópia dos seus dados ou solicitar a exclusão da sua conta. Pedidos já realizados são mantidos de forma anonimizada quando exigido por lei (fiscal).</p><p style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap"><a class="btn sm ghost" href="/api/account/export" download>BAIXAR MEUS DADOS</a><button class="btn sm dark" id="del" style="background:var(--bad)">EXCLUIR MINHA CONTA</button></p></div>`;
  $('#pw').addEventListener('submit', async (ev) => { ev.preventDefault(); try { await api('/account/password', { method: 'PUT', body: Object.fromEntries(new FormData(ev.target)) }); toast('Senha alterada.'); ev.target.reset(); } catch (err) { toast(err.message, { err: true }); } });
  $('#del').addEventListener('click', async () => { const pw = prompt('Confirme sua senha para excluir a conta definitivamente:'); if (!pw) return; try { await api('/account/delete', { method: 'POST', body: { password: pw } }); state.user = null; state.favorites = new Set(); renderAccountLink(); toast('Conta excluída.'); go('/'); } catch (err) { toast(err.message, { err: true }); } });
}
