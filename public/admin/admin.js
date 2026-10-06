const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brlv = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dt = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR') : '');
const toast = (m, err) => { const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = m; $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3500); };

async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch('/api' + path, { method, headers: raw ? { 'X-Requested-With': 'fetch', 'Content-Type': raw.type } : { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: raw ? raw : body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await res.json(); } catch { /* sem corpo */ }
  if (!res.ok) throw new Error((j && j.error) || 'Erro');
  return j;
}
const S = { user: null, sizes: [], entities: [], suppliers: [], guides: [] };
const ENT_TYPES = [['sport', 'Esporte / seção'], ['category', 'Categoria'], ['country', 'País'], ['league', 'Liga'], ['competition', 'Competição'], ['club', 'Clube / time / equipe'], ['national_team', 'Seleção'], ['brand', 'Marca'], ['model', 'Modelo'], ['modality', 'Modalidade'], ['driver', 'Piloto'], ['collection', 'Coleção']];
const ENT_LABEL = Object.fromEntries(ENT_TYPES);

/* ---------- Layout ---------- */
const NAV = [['dashboard', 'Dashboard'], ['orders', 'Pedidos'], ['supplier-orders', 'Ordens a fornecedores'], ['products', 'Produtos'], ['entities', 'Categorias, clubes e ligas'], ['suppliers', 'Fornecedores'], ['coupons', 'Cupons'], ['banners', 'Banners'], ['reviews', 'Avaliações'], ['testimonials', 'Prova social'], ['sizes', 'Tamanhos'], ['size_guides', 'Guias de tamanho'], ['pages', 'Páginas e políticas'], ['settings', 'Configurações'], ['users', 'Clientes'], ['audit', 'Logs / Backup']];
function shell(active, html) {
  $('#root').innerHTML = `<div class="app"><nav class="side"><a class="logo" href="#/dashboard"><img src="/img/logo.png" alt="Sport Imperativo"></a>${NAV.map(([k, n]) => `<a href="#/${k}" class="${active === k ? 'on' : ''}">${n}</a>`).join('')}<small>CONTA</small><a href="/" target="_blank">Ver loja ↗</a><a href="#" id="out">Sair</a></nav><main>${html}</main></div>`;
  $('#out').onclick = async (ev) => { ev.preventDefault(); await api('/auth/logout', { method: 'POST' }); S.user = null; boot(); };
}
async function loadRefs() {
  const [ents, sup, sz, g] = await Promise.all([api('/admin/entities'), api('/admin/suppliers'), api('/admin/sizes'), api('/admin/size_guides')]);
  S.entities = ents; S.suppliers = sup; S.sizes = sz; S.guides = g;
}

/* ---------- Campos genéricos ---------- */
function fieldHtml(f, v) {
  const val = v ?? '';
  const id = 'f_' + f.k, cls = f.full ? 'f full' : 'f';
  let inp;
  switch (f.t) {
    case 'textarea': case 'html': inp = `<textarea id="${id}" ${f.t === 'html' ? 'style="min-height:240px;font-family:monospace"' : ''}>${e(val)}</textarea>`; break;
    case 'bool': return `<div class="${cls}"><label class="chk"><input type="checkbox" id="${id}" ${val === 1 || val === true || val === '1' ? 'checked' : ''}> ${e(f.l)}</label>${f.help ? `<small>${e(f.help)}</small>` : ''}</div>`;
    case 'select': inp = `<select id="${id}">${(typeof f.opts === 'function' ? f.opts() : f.opts).map(([o, l]) => `<option value="${e(o)}" ${String(o) === String(val) ? 'selected' : ''}>${e(l)}</option>`).join('')}</select>`; break;
    case 'date': inp = `<input type="datetime-local" id="${id}" value="${e(String(val).replace(' ', 'T').slice(0, 16))}">`; break;
    case 'color': inp = `<input type="color" id="${id}" value="${/^#[0-9a-f]{6}$/i.test(val) ? val : '#0b5cff'}" style="height:38px;padding:2px"><label class="chk"><input type="checkbox" id="${id}_off" ${val ? '' : 'checked'}> sem cor</label>`; break;
    case 'image': inp = `<div style="display:flex;gap:8px"><input id="${id}" value="${e(val)}" placeholder="URL ou envie um arquivo"><input type="file" data-up="${id}" accept="image/*,video/mp4,video/webm" style="width:auto"></div>${val ? (/.(mp4|webm)$/i.test(val) ? `<video class="thumb" src="${e(val)}" muted style="margin-top:6px"></video>` : `<img class="thumb" src="${e(val)}" alt="" style="margin-top:6px">`) : ''}`; break;
    case 'number': case 'money': inp = `<input id="${id}" type="number" step="${f.t === 'money' ? '0.01' : 'any'}" value="${e(val)}">`; break;
    default: inp = `<input id="${id}" value="${e(val)}" ${f.ph ? `placeholder="${e(f.ph)}"` : ''}>`;
  }
  return `<div class="${cls}"><label for="${id}">${e(f.l)}</label>${inp}${f.help ? `<small>${e(f.help)}</small>` : ''}</div>`;
}
function readFields(fields) {
  const o = {};
  for (const f of fields) {
    const el = $('#f_' + f.k); if (!el) continue;
    if (f.t === 'bool') o[f.k] = el.checked ? 1 : 0;
    else if (f.t === 'color') o[f.k] = $('#f_' + f.k + '_off').checked ? '' : el.value;
    else o[f.k] = el.value;
  }
  return o;
}
function bindUploads(root = document) {
  $$('[data-up]', root).forEach((inp) => inp.addEventListener('change', async () => {
    const file = inp.files[0]; if (!file) return;
    try { const r = await api('/admin/upload', { method: 'POST', raw: new Blob([file], { type: file.type }) }); const t = $('#' + inp.dataset.up); t.value = r.url; t.dispatchEvent(new Event('input')); toast('Arquivo enviado.'); } catch (err) { toast(err.message, true); }
  }));
}

/* ---------- Recursos CRUD genéricos ---------- */
const yn = (v) => (v ? '<span class="pill g">sim</span>' : '<span class="pill r">não</span>');
const RES = {
  suppliers: { title: 'Fornecedores', cols: [['name', 'Nome'], ['channel', 'Canal'], ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['active', 'Ativo', yn]],
    fields: [{ k: 'name', l: 'Nome do fornecedor' }, { k: 'channel', l: 'Método de envio da ordem de compra', t: 'select', opts: [['whatsapp', 'WhatsApp (link com mensagem pronta)'], ['email', 'E-mail'], ['webhook', 'Webhook / API']] }, { k: 'contact', l: 'Contato / canal' }, { k: 'whatsapp', l: 'WhatsApp do fornecedor', ph: '5511999999999', help: 'Com DDI+DDD, só números.' }, { k: 'email', l: 'E-mail do fornecedor' }, { k: 'link', l: 'Link do fornecedor' }, { k: 'webhook_url', l: 'URL do webhook (canal Webhook/API)', full: true }, { k: 'notes', l: 'Observações internas', t: 'textarea', full: true }, { k: 'active', l: 'Ativo', t: 'bool' }] },
  coupons: { title: 'Cupons', cols: [['code', 'Código'], ['type', 'Tipo'], ['value', 'Valor'], ['uses', 'Usos'], ['max_uses', 'Limite'], ['ends_at', 'Validade'], ['active', 'Ativo', yn]],
    fields: [{ k: 'code', l: 'Código' }, { k: 'type', l: 'Tipo', t: 'select', opts: [['percent', 'Percentual (%)'], ['fixed', 'Valor fixo (R$)'], ['free_shipping', 'Frete grátis']] }, { k: 'value', l: 'Valor (% ou R$)', t: 'number' }, { k: 'min_cents', l: 'Valor mínimo do pedido (R$)', t: 'money' },
      { k: 'product_id', l: 'Produto específico (ID)', t: 'number', help: 'Opcional' }, { k: 'entity_id', l: 'Categoria/clube específico (ID da entidade)', t: 'number', help: 'Opcional — veja o ID na lista de entidades' }, { k: 'first_purchase', l: 'Somente primeira compra', t: 'bool' }, { k: 'is_public', l: 'Exibir na área do cliente', t: 'bool' },
      { k: 'description', l: 'Descrição', full: true }, { k: 'starts_at', l: 'Início', t: 'date' }, { k: 'ends_at', l: 'Fim', t: 'date' }, { k: 'max_uses', l: 'Limite de usos', t: 'number' }, { k: 'active', l: 'Ativo', t: 'bool' }] },
  banners: { title: 'Banners', cols: [['sort', 'Ordem'], ['title', 'Título'], ['link', 'Link'], ['starts_at', 'Início'], ['ends_at', 'Fim'], ['active', 'Ativo', yn]],
    fields: [{ k: 'title', l: 'Título', full: true }, { k: 'subtitle', l: 'Subtítulo / texto', full: true }, { k: 'cta_text', l: 'Texto do botão' }, { k: 'link', l: 'Link (ex.: /futebol)' }, { k: 'image_desktop', l: 'Imagem desktop (1920×600)', t: 'image' }, { k: 'image_mobile', l: 'Imagem mobile (900×900)', t: 'image' }, { k: 'starts_at', l: 'Data de início', t: 'date' }, { k: 'ends_at', l: 'Data de término', t: 'date' }, { k: 'sort', l: 'Ordem', t: 'number' }, { k: 'active', l: 'Ativo', t: 'bool' }] },
  testimonials: { title: 'Prova social ("Quem compra, recomenda")', cols: [['sort', 'Ordem'], ['kind', 'Tipo'], ['name', 'Cliente'], ['product_name', 'Produto'], ['stars', '★'], ['active', 'Ativo', yn]],
    fields: [{ k: 'kind', l: 'Tipo', t: 'select', opts: [['text', 'Depoimento'], ['photo', 'Foto'], ['video', 'Vídeo'], ['instagram', 'Instagram / Reels (link)']] }, { k: 'name', l: 'Nome do cliente' }, { k: 'product_name', l: 'Produto comprado (texto)' }, { k: 'product_id', l: 'ID do produto (opcional)', t: 'number', help: 'Vincula o relato ao produto: aparece na página dele e o story leva até ele. Veja o ID na lista de produtos (URL ao editar).' }, { k: 'stars', l: 'Estrelas (1-5)', t: 'number' }, { k: 'body', l: 'Depoimento', t: 'textarea', full: true }, { k: 'media_url', l: 'Foto ou vídeo (envie arquivo ou cole URL)', t: 'image', help: 'Vídeos MP4/WebM: use o mesmo campo; para vídeo, escolha o tipo Vídeo.' }, { k: 'link', l: 'Link do Reel/post do Instagram (tipo Instagram)', full: true, help: 'Ex.: https://www.instagram.com/reel/XXXX/ — Stories comuns expiram em 24h e não podem ser incorporados: baixe o vídeo do story e envie como Vídeo.' }, { k: 'sort', l: 'Ordem', t: 'number' }, { k: 'active', l: 'Ativo', t: 'bool' }] },
  sizes: { title: 'Tamanhos', cols: [['sort', 'Ordem'], ['name', 'Tamanho']], fields: [{ k: 'name', l: 'Nome do tamanho (ex.: 3XG, Infantil 14, 45)' }, { k: 'sort', l: 'Ordem de exibição', t: 'number' }] },
};
const money = ['min_cents'];
async function listPage(key) {
  const r = RES[key]; const rows = await api('/admin/' + key);
  shell(key, `<h1>${r.title}<a class="btn" href="#/${key}/new">+ Novo</a></h1><div class="tw"><table><thead><tr>${r.cols.map(([, l]) => `<th>${l}</th>`).join('')}<th></th></tr></thead><tbody>${rows.map((x) => `<tr>${r.cols.map(([k, , fmt]) => `<td>${fmt ? fmt(x[k]) : e(x[k] ?? '')}</td>`).join('')}<td style="white-space:nowrap"><a class="btn sm ghost" href="#/${key}/${x.id}">Editar</a> <button class="btn sm red" data-del="${x.id}">Excluir</button></td></tr>`).join('') || `<tr><td colspan="9">Nada cadastrado.</td></tr>`}</tbody></table></div>`);
  $$('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('Excluir este item?')) { try { await api(`/admin/${key}/${b.dataset.del}`, { method: 'DELETE' }); listPage(key); } catch (err) { toast(err.message, true); } } });
}
async function formPage(key, id) {
  const r = RES[key]; const row = id === 'new' ? {} : await api(`/admin/${key}/${id}`);
  shell(key, `<h1>${id === 'new' ? 'Novo' : 'Editar'} — ${r.title}</h1><form class="card form" id="form">${r.fields.map((f) => fieldHtml(f, row[f.k])).join('')}<div class="full"><button class="btn">Salvar</button> <a class="btn ghost" href="#/${key}">Cancelar</a></div></form>`);
  bindUploads();
  $('#form').onsubmit = async (ev) => { ev.preventDefault(); try { await api(`/admin/${key}${id === 'new' ? '' : '/' + id}`, { method: id === 'new' ? 'POST' : 'PUT', body: readFields(r.fields) }); toast('Salvo.'); location.hash = `#/${key}`; } catch (err) { toast(err.message, true); } };
}

/* ---------- Dashboard ---------- */
async function dashboard() {
  const d = await api('/admin/dashboard'); const max = Math.max(1, ...d.daily.map((x) => x.rev));
  shell('dashboard', `<h1>Dashboard</h1><div class="kpis">
    <div class="kpi"><span>Faturamento (total)</span><b>${brl(d.revenue)}</b></div><div class="kpi"><span>Pedidos pagos</span><b>${d.orders}</b></div><div class="kpi"><span>Ticket médio</span><b>${brl(d.ticket)}</b></div><div class="kpi"><span>Produtos vendidos</span><b>${d.itemsSold}</b></div>
    <div class="kpi"><span>Últimos 30 dias</span><b>${brl(d.last30.rev)}</b><span>${d.last30.n} pedidos</span></div><div class="kpi"><span>Últimos 7 dias</span><b>${brl(d.last7.rev)}</b><span>${d.last7.n} pedidos</span></div>
    <div class="kpi"><span>Clientes</span><b>${d.customers}</b></div><div class="kpi"><span>Avaliações pendentes</span><b>${d.pendingReviews}</b></div>
    <a class="kpi" href="#/orders?status=awaiting_supplier"><span>Aguardando fornecedor</span><b style="color:var(--warn)">${d.awaitingSupplier}</b></a><a class="kpi" href="#/orders?status=payment_pending"><span>Pagamento pendente</span><b>${d.pendingPayment}</b></a></div>
  <div class="grid2"><div class="card"><b>Faturamento — últimos 14 dias</b><div class="bars" style="margin:14px 0 24px">${d.daily.map((x) => `<div style="height:${(x.rev / max) * 100}%" title="${x.d}: ${brl(x.rev)}"><span>${x.d.slice(8)}</span></div>`).join('') || '<span style="color:var(--mut)">Sem vendas ainda</span>'}</div></div>
  <div class="card"><b>Pedidos por status</b><table style="margin-top:8px">${d.byStatus.map((s) => `<tr><td>${e(s.label)}</td><td>${s.n}</td></tr>`).join('') || '<tr><td>—</td></tr>'}</table></div>
  <div class="card"><b>Estoque baixo</b><table style="margin-top:8px">${d.lowStock.map((p) => `<tr><td><a href="#/products/${p.id}">${e(p.name)}</a></td><td><span class="pill r">${p.stock}</span></td></tr>`).join('') || '<tr><td>Tudo certo ✔</td></tr>'}</table></div>
  <div class="card"><b>Mais vendidos</b><table style="margin-top:8px">${d.top.map((p) => `<tr><td>${e(p.name)}</td><td>${p.sold}</td></tr>`).join('')}</table></div></div>`);
}

/* ---------- Pedidos ---------- */
const STAT_PILL = { delivered: 'g', cancelled: 'r', payment_pending: 'y', awaiting_supplier: 'y', received: 'y' };
async function ordersList(qs) {
  const p = new URLSearchParams(qs || '');
  const rows = await api('/admin/orders?' + p);
  const ST = [['', 'Todos'], ['payment_pending', 'Pagamento pendente'], ['paid', 'Pagamento aprovado'], ['awaiting_supplier', 'Aguardando fornecedor'], ['sent_supplier', 'Enviado ao fornecedor'], ['supplier_confirmed', 'Fornecedor confirmou'], ['preparing', 'Em preparação'], ['shipped', 'Enviado'], ['in_transit', 'Em trânsito'], ['delivered', 'Entregue'], ['cancelled', 'Cancelado']];
  shell('orders', `<h1>Pedidos</h1><div class="toolbar"><select id="st">${ST.map(([v, l]) => `<option value="${v}" ${p.get('status') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><input id="q" placeholder="Nº do pedido ou cliente" value="${e(p.get('q') || '')}"><button class="btn" id="go">Filtrar</button></div>
  <div class="tw"><table><thead><tr><th>#</th><th>Data</th><th>Cliente</th><th>Itens</th><th>Total</th><th>Pgto</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((o) => `<tr><td><b>#${o.id}</b></td><td>${dt(o.created_at)}</td><td>${e(o.customer)}</td><td>${o.items || 0}</td><td>${brl(o.total)}</td><td>${e(o.method || '')}</td><td><span class="pill ${STAT_PILL[o.status] || ''}">${e(o.statusLabel)}</span></td><td><a class="btn sm ghost" href="#/orders/${o.id}">Abrir</a></td></tr>`).join('') || '<tr><td colspan="8">Nenhum pedido.</td></tr>'}</tbody></table></div>`);
  $('#go').onclick = () => { location.hash = `#/orders?status=${$('#st').value}&q=${encodeURIComponent($('#q').value)}`; };
}
async function orderPage(id) {
  const o = await api('/admin/orders/' + id); const c = o.customer, a = o.address;
  shell('orders', `<h1>Pedido #${o.id} <span class="pill ${STAT_PILL[o.status] || ''}">${e(o.statusLabel)}</span></h1>
  <div class="grid2"><div class="card"><b>Cliente</b><p>${e(c.name)}<br>CPF ${e(c.cpf)} • ${e(c.email)}<br>Tel ${e(c.phone)} • WhatsApp ${e(c.whatsapp || '')}</p><b style="display:block;margin-top:10px">Entrega</b><p>${e(a.street)}, ${e(a.number)} ${e(a.complement || '')}<br>${e(a.district)} — ${e(a.city)}/${e(a.state)} • CEP ${e(a.cep)}</p>
    <p style="margin-top:8px">${o.shipping_info.map((g) => `<span class="pill ${g.id === 'import' ? 'y' : 'g'}">${e(g.title)}: ${e(g.carrier || '')} ${g.price ? brl(g.price) : 'grátis'}</span>`).join(' ')}</p></div>
  <div class="card"><b>Alterar status</b><div class="toolbar" style="margin-top:8px"><select id="newst">${Object.entries(o.statuses).map(([k, l]) => `<option value="${k}" ${k === o.status ? 'selected' : ''}>${e(l)}</option>`).join('')}</select><button class="btn" id="setst">Atualizar</button></div>
    <b>Pagamento</b>${o.payments.map((p) => `<p>${e(p.provider)} • ${e(p.method)} • <span class="pill ${p.status === 'approved' ? 'g' : 'y'}">${e(p.status)}</span> • ${brl(p.amount_cents)} ${p.paid_at ? '• ' + dt(p.paid_at) : ''}</p>`).join('')}
    <p>Subtotal ${brl(o.subtotal)} • Desc. ${brl(o.discount)} • Frete ${brl(o.shipping)} • <b>Total ${brl(o.total)}</b> ${o.coupon ? '• Cupom ' + e(o.coupon) : ''}</p></div></div>
  <div class="card"><b>Itens</b><div class="tw"><table><thead><tr><th>Produto</th><th>Tam.</th><th>Qtd</th><th>Personalização</th><th>Envio</th><th>Fornecedor / SKU</th><th>Valor</th></tr></thead><tbody>${o.items.map((i) => `<tr><td>${e(i.name)}</td><td>${e(i.size || '')}</td><td>${i.qty}</td><td>${i.custom_name || i.custom_number ? `<b>${e(i.custom_name || '')}</b> #${e(i.custom_number || '')}` : '—'}</td><td>${i.fulfillment === 'import' ? '<span class="pill y">Importado</span>' : '<span class="pill g">Pronta entrega</span>'}</td><td>${e(i.supplier_name || '—')} ${e(i.supplier_sku || '')}</td><td>${brl((i.unit_cents + (i.custom_cents || 0)) * i.qty)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="card"><b>Ordens de compra ao fornecedor</b>${o.supplierOrders.map((s) => `<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:10px"><p><b>${e(s.supplier_name || '—')}</b> • canal ${e(s.channel)} • <span class="pill ${s.status === 'confirmed' ? 'g' : s.status === 'sent' ? '' : 'y'}">${e({ awaiting: 'Aguardando envio', sent: 'Enviado ao fornecedor', confirmed: 'Fornecedor confirmou' }[s.status] || s.status)}</span> ${s.sent_at ? '• enviado ' + dt(s.sent_at) : ''}</p>
    <pre class="msg">${e(s.message)}</pre><div class="toolbar">${s.link ? `<a class="btn sm green" target="_blank" rel="noopener" href="${e(s.link)}" data-sent="${s.id}">Abrir WhatsApp com mensagem pronta</a>` : ''}<button class="btn sm ghost" data-copy="${s.id}">Copiar mensagem</button><button class="btn sm dark" data-auto="${s.id}">Reenviar (webhook/API)</button><button class="btn sm ghost" data-marksent="${s.id}">Marcar como enviado</button><button class="btn sm" data-conf="${s.id}">Fornecedor confirmou</button></div>
    <small style="color:var(--mut)">${s.log.map((l) => dt(l.at.replace('T', ' ').slice(0, 19)) + ' — ' + e(l.note)).join('<br>')}</small></div>`).join('') || '<p style="color:var(--mut)">Nenhuma ordem de compra (ainda não pago ou sem fornecedor associado).</p>'}</div>
  <div class="card"><b>Rastreamento</b>${o.shipments.map((s) => `<form class="form" data-ship="${s.id}" style="margin-top:8px"><div class="f"><label>Grupo</label><input disabled value="${s.grp === 'import' ? 'Importado' : 'Pronta entrega'}"></div><div class="f"><label>Transportadora</label><input name="carrier" value="${e(s.carrier || '')}"></div><div class="f"><label>Código</label><input name="code" value="${e(s.code || '')}"></div><div class="f"><label>Link de rastreio</label><input name="url" value="${e(s.url || '')}"></div><div class="f"><label>&nbsp;</label><button class="btn">Salvar rastreio</button></div></form>`).join('') || '<p style="color:var(--mut)">Os envios aparecem após a aprovação do pagamento.</p>'}</div>
  <div class="card"><b>Observações internas / ao fornecedor</b><textarea id="notes" style="margin-top:6px">${e(o.notes || '')}</textarea><button class="btn sm" id="savenotes" style="margin-top:6px">Salvar</button></div>
  <div class="card"><b>Histórico</b><table style="margin-top:8px">${o.events.slice().reverse().map((ev) => `<tr><td>${dt(ev.created_at)}</td><td>${e(ev.note || ev.status)}</td></tr>`).join('')}</table></div>
  <a class="btn ghost" href="#/orders">← Voltar</a>`);
  const act = (sel, fn) => $$(sel).forEach((b) => b.addEventListener('click', async (ev) => { try { await fn(b, ev); } catch (err) { toast(err.message, true); } }));
  $('#setst').onclick = async () => { await api(`/admin/orders/${id}/status`, { method: 'PUT', body: { status: $('#newst').value } }); toast('Status atualizado.'); orderPage(id); };
  act('[data-copy]', async (b) => { await navigator.clipboard.writeText(o.supplierOrders.find((s) => s.id == b.dataset.copy).message); toast('Mensagem copiada.'); });
  act('[data-auto]', async (b) => { await api(`/admin/supplier-orders/${b.dataset.auto}/send`, { method: 'POST' }); toast('Tentativa registrada.'); orderPage(id); });
  act('[data-marksent]', async (b) => { await api(`/admin/supplier-orders/${b.dataset.marksent}/mark-sent`, { method: 'POST' }); orderPage(id); });
  act('[data-conf]', async (b) => { await api(`/admin/supplier-orders/${b.dataset.conf}/confirm`, { method: 'POST' }); orderPage(id); });
  act('[data-sent]', async (b) => { setTimeout(async () => { if (confirm('Você enviou a mensagem ao fornecedor? Marcar a ordem como enviada?')) { await api(`/admin/supplier-orders/${b.dataset.sent}/mark-sent`, { method: 'POST' }); orderPage(id); } }, 800); });
  $$('[data-ship]').forEach((f) => f.onsubmit = async (ev) => { ev.preventDefault(); try { await api('/admin/shipments/' + f.dataset.ship, { method: 'PUT', body: Object.fromEntries(new FormData(f)) }); toast('Rastreio salvo.'); orderPage(id); } catch (err) { toast(err.message, true); } });
  $('#savenotes').onclick = async () => { await api(`/admin/orders/${id}/notes`, { method: 'PUT', body: { notes: $('#notes').value } }); toast('Salvo.'); };
}
async function supplierOrders() {
  const rows = await api('/admin/supplier-orders');
  shell('supplier-orders', `<h1>Ordens a fornecedores</h1><div class="tw"><table><thead><tr><th>#</th><th>Pedido</th><th>Fornecedor</th><th>Canal</th><th>Status</th><th>Criada</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr><td>${s.id}</td><td>#${s.order_id}</td><td>${e(s.supplier || '')}</td><td>${e(s.channel)}</td><td><span class="pill ${s.status === 'confirmed' ? 'g' : s.status === 'sent' ? '' : 'y'}">${e({ awaiting: 'Pendente', sent: 'Enviada', confirmed: 'Confirmada' }[s.status] || s.status)}</span></td><td>${dt(s.created_at)}</td><td><a class="btn sm ghost" href="#/orders/${s.order_id}">Abrir pedido</a></td></tr>`).join('') || '<tr><td colspan="7">Nenhuma.</td></tr>'}</tbody></table></div>`);
}

/* ---------- Entidades ---------- */
async function entitiesList(qs) {
  const p = new URLSearchParams(qs || ''); const type = p.get('type') || '';
  const rows = await api('/admin/entities?' + new URLSearchParams({ type, q: p.get('q') || '' }));
  shell('entities', `<h1>Categorias, clubes, ligas e mais<a class="btn" href="#/entities/new${type ? '?type=' + type : ''}">+ Novo</a></h1><div class="toolbar"><select id="t"><option value="">Todos os tipos</option>${ENT_TYPES.map(([v, l]) => `<option value="${v}" ${v === type ? 'selected' : ''}>${l}</option>`).join('')}</select><input id="q" placeholder="Buscar nome" value="${e(p.get('q') || '')}"><button class="btn" id="go">Filtrar</button></div>
  <div class="tw"><table><thead><tr><th>ID</th><th>Tipo</th><th>Nome</th><th>Slug (URL)</th><th>Menu</th><th>Ativo</th><th></th></tr></thead><tbody>${rows.map((x) => `<tr><td>${x.id}</td><td>${ENT_LABEL[x.type] || x.type}</td><td><b>${e(x.name)}</b></td><td>${e(x.slug)}</td><td>${yn(x.show_in_menu)}</td><td>${yn(x.active)}</td><td style="white-space:nowrap"><a class="btn sm ghost" href="#/entities/${x.id}">Editar</a> <button class="btn sm red" data-del="${x.id}">Excluir</button></td></tr>`).join('')}</tbody></table></div>`);
  $('#go').onclick = () => { location.hash = `#/entities?type=${$('#t').value}&q=${encodeURIComponent($('#q').value)}`; };
  $$('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('Excluir? Produtos perdem esta relação.')) { await api('/admin/entities/' + b.dataset.del, { method: 'DELETE' }); entitiesList(qs); } });
}
async function entityForm(id, qs) {
  const row = id === 'new' ? { type: new URLSearchParams(qs || '').get('type') || 'club', active: 1, show_in_menu: 1, sort: 100, parents: [] } : await api('/admin/entities/' + id);
  const countries = S.entities.filter((x) => x.type === 'country');
  const fields = [{ k: 'type', l: 'Tipo', t: 'select', opts: ENT_TYPES }, { k: 'name', l: 'Nome' }, { k: 'slug', l: 'Slug (URL)', help: 'Deixe em branco para gerar automaticamente.' }, { k: 'country_id', l: 'País', t: 'select', opts: [['', '—'], ...countries.map((c) => [c.id, c.name])] },
    { k: 'logo', l: 'Escudo / logo', t: 'image' }, { k: 'banner', l: 'Banner da página', t: 'image' }, { k: 'color1', l: 'Cor principal', t: 'color' }, { k: 'color2', l: 'Cor secundária', t: 'color' }, { k: 'description', l: 'Descrição', t: 'textarea', full: true }, { k: 'sort', l: 'Ordem', t: 'number' }, { k: 'show_in_menu', l: 'Mostrar no menu', t: 'bool' }, { k: 'active', l: 'Ativo', t: 'bool' }];
  const parentCandidates = S.entities.filter((x) => x.id != id && ['sport', 'league', 'competition', 'club', 'brand', 'category'].includes(x.type));
  shell('entities', `<h1>${id === 'new' ? 'Nova' : 'Editar'} entidade</h1><form class="card form" id="form">${fields.map((f) => fieldHtml(f, row[f.k])).join('')}
    <div class="f full"><label>Aparece dentro de (relações — ex.: um clube dentro de uma liga e do esporte)</label><input id="pfilter" placeholder="Filtrar..." style="margin-bottom:6px"><div class="ents" id="parents">${ENT_TYPES.map(([t, l]) => { const list = parentCandidates.filter((x) => x.type === t); return list.length ? `<h4>${l}</h4>${list.map((x) => `<label data-n="${e(x.name.toLowerCase())}"><input type="checkbox" value="${x.id}" ${row.parents.includes(x.id) ? 'checked' : ''}>${e(x.name)}</label>`).join('')}` : ''; }).join('')}</div></div>
    <div class="full"><button class="btn">Salvar</button> <a class="btn ghost" href="#/entities">Cancelar</a></div></form>`);
  bindUploads();
  $('#pfilter').oninput = (ev) => $$('#parents label').forEach((l) => l.hidden = !l.dataset.n.includes(ev.target.value.toLowerCase()));
  $('#form').onsubmit = async (ev) => { ev.preventDefault(); const b = readFields(fields); b.parents = $$('#parents input:checked').map((c) => +c.value); try { await api(`/admin/entities${id === 'new' ? '' : '/' + id}`, { method: id === 'new' ? 'POST' : 'PUT', body: b }); toast('Salvo.'); await loadRefs(); location.hash = '#/entities'; } catch (err) { toast(err.message, true); } };
}

/* ---------- Produtos ---------- */
async function productsList(qs) {
  const p = new URLSearchParams(qs || ''); const rows = await api('/admin/products?' + new URLSearchParams({ q: p.get('q') || '' }));
  shell('products', `<h1>Produtos<a class="btn" href="#/products/new">+ Novo produto</a></h1><div class="toolbar"><input id="q" placeholder="Buscar por nome ou SKU" value="${e(p.get('q') || '')}"><button class="btn" id="go">Buscar</button></div>
  <div class="tw"><table><thead><tr><th></th><th>Produto</th><th>SKU</th><th>Preço</th><th>Promo</th><th>Estoque</th><th>Tipo</th><th>Vendidos</th><th>Ativo</th><th></th></tr></thead><tbody>${rows.map((x) => `<tr><td><img class="thumb" style="width:44px;height:44px" src="${e(x.image)}" alt=""></td><td><b>${e(x.name)}</b></td><td>${e(x.sku || '')}</td><td><input data-q="price" data-id="${x.id}" type="number" step="0.01" value="${x.price}" style="width:100px"></td><td><input data-q="sale" data-id="${x.id}" type="number" step="0.01" value="${x.sale ?? ''}" style="width:100px"></td><td>${x.fulfillment === 'stock' ? `<input data-q="stock" data-id="${x.id}" type="number" value="${x.stock}" style="width:70px">` : '—'}</td><td>${x.fulfillment === 'import' ? '<span class="pill y">Importado</span>' : '<span class="pill g">Pronta entrega</span>'}</td><td>${x.sold}</td><td><input type="checkbox" data-q="active" data-id="${x.id}" ${x.active ? 'checked' : ''}></td><td style="white-space:nowrap"><a class="btn sm ghost" href="#/products/${x.id}">Editar</a> <button class="btn sm ghost" data-dup="${x.id}">Duplicar</button> <button class="btn sm red" data-del="${x.id}">Excluir</button></td></tr>`).join('')}</tbody></table></div>`);
  $('#go').onclick = () => { location.hash = `#/products?q=${encodeURIComponent($('#q').value)}`; };
  $$('[data-q]').forEach((i) => i.addEventListener('change', async () => { const k = i.dataset.q; try { await api(`/admin/products/${i.dataset.id}/quick`, { method: 'PATCH', body: { [k]: k === 'active' ? i.checked : i.value } }); toast('Atualizado.'); } catch (err) { toast(err.message, true); } }));
  $$('[data-dup]').forEach((b) => b.onclick = async () => { const r = await api(`/admin/products/${b.dataset.dup}/duplicate`, { method: 'POST' }); toast('Duplicado (inativo).'); location.hash = '#/products/' + r.id; });
  $$('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('Excluir produto?')) { await api('/admin/products/' + b.dataset.del, { method: 'DELETE' }); productsList(qs); } });
}
async function productForm(id) {
  const row = id === 'new' ? { fulfillment: 'stock', shipping_rule: 'cep', active: 1, shape: 'jersey', weight_g: 400, entity_ids: [], variants: [], images: [] } : await api('/admin/products/' + id);
  const F = (a) => a.map((f) => fieldHtml(f, row[f.k])).join('');
  const sup = [['', '— sem fornecedor (estoque próprio) —'], ...S.suppliers.map((s) => [s.id, s.name])];
  const guides = [['', '—'], ...S.guides.map((g) => [g.id, g.name])];
  shell('products', `<h1>${id === 'new' ? 'Novo produto' : 'Editar produto'}</h1><form class="card form" id="form">
  <div class="sec">Básico</div>${F([{ k: 'name', l: 'Nome do produto', full: true }, { k: 'sku', l: 'SKU interno' }, { k: 'badge', l: 'Selo', t: 'select', opts: [['', 'Nenhum'], ['OFERTA', 'OFERTA'], ['MAIS VENDIDO', 'MAIS VENDIDO'], ['NOVO', 'NOVO'], ['ÚLTIMAS UNIDADES', 'ÚLTIMAS UNIDADES']] }, { k: 'description', l: 'Descrição', t: 'textarea', full: true }, { k: 'tags', l: 'Tags de busca (separadas por espaço)', full: true }, { k: 'active', l: 'Produto ativo (visível na loja)', t: 'bool' }])}
  <div class="sec">Preços</div>${F([{ k: 'price_cents', l: 'Preço original (R$)', t: 'money' }, { k: 'sale_price_cents', l: 'Preço promocional (R$)', t: 'money' }, { k: 'sale_starts', l: 'Promoção início', t: 'date' }, { k: 'sale_ends', l: 'Promoção fim', t: 'date' }, { k: 'pix_pct', l: '% desconto Pix', t: 'number', help: 'Vazio = padrão da loja' }, { k: 'max_installments', l: 'Máx. de parcelas', t: 'number', help: 'Vazio = padrão da loja' }])}
  <div class="sec">Tipo de envio, estoque e frete</div>${F([{ k: 'fulfillment', l: 'TIPO DE ENVIO', t: 'select', opts: [['stock', 'PRONTA ENTREGA (estoque próprio no Brasil)'], ['import', 'SOB ENCOMENDA / IMPORTADO (fornecedor no exterior)']] }, { k: 'stock', l: 'Estoque total (pronta entrega)', t: 'number', help: 'Se houver tamanhos abaixo, é a soma deles.' }, { k: 'shipping_rule', l: 'Regra de frete', t: 'select', opts: [['cep', 'Calculado pelo CEP'], ['free', 'Frete grátis'], ['fixed', 'Frete fixo'], ['custom', 'Personalizado (valor fixo + observação)']] }, { k: 'shipping_fixed_cents', l: 'Valor do frete fixo/personalizado (R$)', t: 'money' }, { k: 'weight_g', l: 'Peso (g)', t: 'number' },
    { k: 'origin', l: 'Origem (importado)', ph: 'China' }, { k: 'lead_min', l: 'Prazo mínimo (dias úteis)', t: 'number' }, { k: 'lead_max', l: 'Prazo máximo (dias úteis)', t: 'number' }, { k: 'import_notes', l: 'Informações adicionais de importação (vazio = aviso padrão)', t: 'textarea', full: true }])}
  <div class="f full"><label>Tamanhos e estoque por tamanho</label><div id="vars"></div><div class="toolbar"><select id="vsel" style="min-width:140px">${S.sizes.map((s) => `<option>${e(s.name)}</option>`).join('')}</select><button type="button" class="btn sm ghost" id="addv">+ Adicionar tamanho</button><button type="button" class="btn sm ghost" id="addstd">+ P a XGG</button></div><small>Para importados o estoque é ignorado (sob encomenda).</small></div>
  <div class="sec">Fornecedor (interno — nunca exibido ao cliente)</div>${F([{ k: 'supplier_id', l: 'Fornecedor', t: 'select', opts: sup }, { k: 'supplier_sku', l: 'SKU do fornecedor' }, { k: 'supplier_link', l: 'Link do produto no fornecedor' }, { k: 'supplier_cost_cents', l: 'Custo (R$)', t: 'money' }, { k: 'supplier_notes', l: 'Observações', t: 'textarea', full: true }])}
  <div class="sec">Personalização e guia de tamanhos</div>${F([{ k: 'customizable', l: 'Permite personalizar (nome e número)', t: 'bool' }, { k: 'custom_price_cents', l: 'Custo da personalização (R$)', t: 'money', help: 'Vazio = padrão da loja' }, { k: 'size_guide_id', l: 'Guia de tamanhos', t: 'select', opts: guides }])}
  <div class="sec">Categorias, clubes, ligas, países, marcas…</div>
  <div class="f full"><input id="efilter" placeholder="Filtrar entidades..." style="margin-bottom:6px"><div class="ents" id="ents">${ENT_TYPES.map(([t, l]) => { const list = S.entities.filter((x) => x.type === t); return list.length ? `<h4>${l}</h4>${list.map((x) => `<label data-n="${e(x.name.toLowerCase())}"><input type="checkbox" value="${x.id}" ${row.entity_ids.includes(x.id) ? 'checked' : ''}>${e(x.name)}</label>`).join('')}` : ''; }).join('')}</div><small>Ao marcar um clube, a liga e o país relacionados são adicionados automaticamente. Um produto pode pertencer a várias categorias, clubes, coleções…</small></div>
  <div class="sec">Fotos e vídeo</div><div class="f full"><div class="imgs" id="imgs"></div><div class="toolbar" style="margin-top:8px"><input type="file" id="upl" accept="image/*,video/mp4,video/webm" multiple style="width:auto"><input id="imgurl" placeholder="ou cole URL (imagem, YouTube ou MP4)"><button type="button" class="btn sm ghost" id="addurl">Adicionar</button></div><small>A primeira imagem é a principal. Sem fotos, a loja usa uma ilustração gerada.</small></div>
  ${F([{ k: 'video_url', l: 'Vídeo (YouTube ou MP4)', full: true }])}
  <div class="sec">Ilustração gerada (usada só se não houver fotos)</div>${F([{ k: 'shape', l: 'Modelo', t: 'select', opts: [['jersey', 'Camisa'], ['tank', 'Regata'], ['boot', 'Chuteira']] }, { k: 'style', l: 'Padrão', t: 'select', opts: [['plain', 'Liso'], ['stripes', 'Listras'], ['hoops', 'Faixas horizontais'], ['sash', 'Faixa diagonal'], ['half', 'Metade']] }, { k: 'color1', l: 'Cor 1', t: 'color' }, { k: 'color2', l: 'Cor 2', t: 'color' }])}
  <div class="sec">SEO</div>${F([{ k: 'slug', l: 'Slug (URL)', help: 'Vazio = gerado do nome' }, { k: 'meta_title', l: 'Meta title' }, { k: 'meta_description', l: 'Meta description', t: 'textarea', full: true }])}
  <div class="full"><button class="btn">Salvar produto</button> <a class="btn ghost" href="#/products">Cancelar</a></div></form>`);
  let vars = row.variants.map((v) => ({ ...v })), imgs = row.images.map((i) => ({ ...i }));
  const drawVars = () => { $('#vars').innerHTML = vars.map((v, i) => `<div class="var-row"><input value="${e(v.size)}" disabled><input type="number" min="0" value="${v.stock}" data-vs="${i}" aria-label="Estoque ${e(v.size)}"><button type="button" class="btn sm red" data-vd="${i}">×</button></div>`).join('') || '<small>Sem tamanhos (produto de tamanho único).</small>'; $$('[data-vs]').forEach((i) => i.oninput = () => { vars[+i.dataset.vs].stock = +i.value; }); $$('[data-vd]').forEach((b) => b.onclick = () => { vars.splice(+b.dataset.vd, 1); drawVars(); }); };
  const drawImgs = () => { $('#imgs').innerHTML = imgs.map((m, i) => `<div class="it">${m.kind === 'video' ? '<div class="thumb" style="display:grid;place-items:center">▶</div>' : `<img class="thumb" src="${e(m.url)}" alt="">`}<button type="button" data-id="${i}" aria-label="Remover">×</button></div>`).join(''); $$('[data-id]', $('#imgs')).forEach((b) => b.onclick = () => { imgs.splice(+b.dataset.id, 1); drawImgs(); }); };
  drawVars(); drawImgs();
  $('#addv').onclick = () => { const s = $('#vsel').value; if (!vars.find((v) => v.size === s)) vars.push({ size: s, stock: 5 }); drawVars(); };
  $('#addstd').onclick = () => { ['P', 'M', 'G', 'GG', 'XGG'].forEach((s) => { if (!vars.find((v) => v.size === s)) vars.push({ size: s, stock: 5 }); }); drawVars(); };
  $('#efilter').oninput = (ev) => $$('#ents label').forEach((l) => l.hidden = !l.dataset.n.includes(ev.target.value.toLowerCase()));
  $('#upl').onchange = async (ev) => { for (const file of ev.target.files) { try { const r = await api('/admin/upload', { method: 'POST', raw: new Blob([file], { type: file.type }) }); imgs.push({ url: r.url, kind: file.type.startsWith('video') ? 'video' : 'image' }); drawImgs(); } catch (err) { toast(file.name + ': ' + err.message, true); } } ev.target.value = ''; };
  $('#addurl').onclick = () => { const u = $('#imgurl').value.trim(); if (!u) return; imgs.push({ url: u, kind: /youtu|\.mp4|\.webm/i.test(u) ? 'video' : 'image' }); $('#imgurl').value = ''; drawImgs(); };
  $('#form').onsubmit = async (ev) => {
    ev.preventDefault();
    const allFields = ['name', 'sku', 'badge', 'description', 'tags', 'active', 'price_cents', 'sale_price_cents', 'sale_starts', 'sale_ends', 'pix_pct', 'max_installments', 'fulfillment', 'stock', 'shipping_rule', 'shipping_fixed_cents', 'weight_g', 'origin', 'lead_min', 'lead_max', 'import_notes', 'supplier_id', 'supplier_sku', 'supplier_link', 'supplier_cost_cents', 'supplier_notes', 'customizable', 'custom_price_cents', 'size_guide_id', 'video_url', 'shape', 'style', 'color1', 'color2', 'slug', 'meta_title', 'meta_description'];
    const bools = ['active', 'customizable'], colors = ['color1', 'color2'];
    const b = {};
    for (const k of allFields) { const el = $('#f_' + k); if (!el) continue; b[k] = bools.includes(k) ? (el.checked ? 1 : 0) : colors.includes(k) ? ($('#f_' + k + '_off').checked ? '' : el.value) : el.value; }
    b.entity_ids = $$('#ents input:checked').map((c) => +c.value); b.variants = vars; b.images = imgs;
    try { const r = await api(`/admin/products${id === 'new' ? '' : '/' + id}`, { method: id === 'new' ? 'POST' : 'PUT', body: b }); toast('Produto salvo.'); location.hash = '#/products'; void r; } catch (err) { toast(err.message, true); }
  };
}

/* ---------- Avaliações, guias, páginas, configurações, usuários, logs ---------- */
async function reviews(qs) {
  const p = new URLSearchParams(qs || ''); const rows = await api('/admin/reviews?' + (p.get('status') ? 'status=' + p.get('status') : ''));
  shell('reviews', `<h1>Avaliações</h1><div class="toolbar"><a class="btn sm ghost" href="#/reviews">Todas</a><a class="btn sm ghost" href="#/reviews?status=pending">Pendentes</a><a class="btn sm ghost" href="#/reviews?status=approved">Aprovadas</a><a class="btn sm ghost" href="#/reviews?status=hidden">Ocultas</a></div>
  ${rows.map((r) => `<div class="card"><b>${e(r.product)}</b> • ${'★'.repeat(r.stars)} • ${e(r.author || '')} • ${dt(r.created_at)} <span class="pill ${r.status === 'approved' ? 'g' : r.status === 'pending' ? 'y' : 'r'}">${r.status}</span> ${r.featured ? '<span class="pill">destaque</span>' : ''}<p style="margin:6px 0">${e(r.body || '')}</p><div class="toolbar"><button class="btn sm green" data-s="approved" data-id="${r.id}">Aprovar</button><button class="btn sm ghost" data-s="hidden" data-id="${r.id}">Ocultar</button><button class="btn sm ghost" data-f="${r.featured ? 0 : 1}" data-id="${r.id}">${r.featured ? 'Remover destaque' : 'Destacar'}</button><button class="btn sm red" data-d="${r.id}">Excluir</button></div></div>`).join('') || '<p>Nenhuma avaliação.</p>'}`);
  $$('[data-s]').forEach((b) => b.onclick = async () => { await api('/admin/reviews/' + b.dataset.id, { method: 'PUT', body: { status: b.dataset.s } }); reviews(qs); });
  $$('[data-f]').forEach((b) => b.onclick = async () => { await api('/admin/reviews/' + b.dataset.id, { method: 'PUT', body: { featured: +b.dataset.f } }); reviews(qs); });
  $$('[data-d]').forEach((b) => b.onclick = async () => { if (confirm('Excluir avaliação?')) { await api('/admin/reviews/' + b.dataset.d, { method: 'DELETE' }); reviews(qs); } });
}
async function guidesList() {
  const rows = await api('/admin/size_guides');
  shell('size_guides', `<h1>Guias de tamanho<a class="btn" href="#/size_guides/new">+ Novo guia</a></h1><div class="tw"><table><thead><tr><th>Nome</th><th>Colunas</th><th>Linhas</th><th></th></tr></thead><tbody>${rows.map((g) => `<tr><td>${e(g.name)}</td><td>${JSON.parse(g.headers).length}</td><td>${JSON.parse(g.rows).length}</td><td><a class="btn sm ghost" href="#/size_guides/${g.id}">Editar</a> <button class="btn sm red" data-del="${g.id}">Excluir</button></td></tr>`).join('')}</tbody></table></div>`);
  $$('[data-del]').forEach((b) => b.onclick = async () => { if (confirm('Excluir guia?')) { await api('/admin/size_guides/' + b.dataset.del, { method: 'DELETE' }); await loadRefs(); guidesList(); } });
}
async function guideForm(id) {
  const g = id === 'new' ? { name: '', headers: '["Tamanho","Largura (cm)","Comprimento (cm)"]', rows: '[]', notes: '' } : await api('/admin/size_guides/' + id);
  const toTxt = (h, r) => [JSON.parse(h), ...JSON.parse(r)].map((l) => l.join(';')).join('\n');
  shell('size_guides', `<h1>${id === 'new' ? 'Novo' : 'Editar'} guia de tamanhos</h1><form class="card form" id="form"><div class="f full"><label>Nome (ex.: Torcedor, Player, Feminina, Infantil, Retrô, Chuteiras)</label><input id="n" value="${e(g.name)}"></div><div class="f full"><label>Tabela — uma linha por tamanho, colunas separadas por ponto e vírgula. A 1ª linha é o cabeçalho.</label><textarea id="t" style="min-height:200px;font-family:monospace">${e(toTxt(g.headers, g.rows))}</textarea></div><div class="f full"><label>Observações</label><textarea id="no">${e(g.notes || '')}</textarea></div><div class="full"><button class="btn">Salvar</button> <a class="btn ghost" href="#/size_guides">Cancelar</a></div></form>`);
  $('#form').onsubmit = async (ev) => { ev.preventDefault(); const lines = $('#t').value.split('\n').map((l) => l.split(';').map((c) => c.trim())).filter((l) => l.some(Boolean)); try { await api(`/admin/size_guides${id === 'new' ? '' : '/' + id}`, { method: id === 'new' ? 'POST' : 'PUT', body: { name: $('#n').value, headers: lines[0] || [], rows: lines.slice(1), notes: $('#no').value } }); await loadRefs(); toast('Salvo.'); location.hash = '#/size_guides'; } catch (err) { toast(err.message, true); } };
}
async function pages(slug) {
  const rows = await api('/admin/pages');
  if (!slug) { shell('pages', `<h1>Páginas e políticas</h1><div class="tw"><table><tbody>${rows.map((p) => `<tr><td>${e(p.title)}</td><td>/pagina/${p.slug}</td><td><a class="btn sm ghost" href="#/pages/${p.slug}">Editar</a></td></tr>`).join('')}</tbody></table></div><p style="margin-top:10px"><a class="btn ghost" href="#/pages/nova-pagina">+ Nova página</a></p><div class="card" style="margin-top:14px">⚠ Os textos de políticas (privacidade, termos, trocas) são <b>modelos</b>. Revise com assessoria jurídica antes de publicar.</div>`); return; }
  const p = rows.find((x) => x.slug === slug) || { slug, title: '', body: '' };
  shell('pages', `<h1>Editar página: ${e(slug)}</h1><form class="card form" id="form"><div class="f full"><label>Título</label><input id="t" value="${e(p.title)}"></div><div class="f full"><label>Conteúdo (HTML)</label><textarea id="b" style="min-height:320px;font-family:monospace">${e(p.body)}</textarea></div><div class="full"><button class="btn">Salvar</button> <a class="btn ghost" href="#/pages">Cancelar</a></div></form>`);
  $('#form').onsubmit = async (ev) => { ev.preventDefault(); await api('/admin/pages/' + slug, { method: 'PUT', body: { title: $('#t').value, body: $('#b').value } }); toast('Salvo.'); location.hash = '#/pages'; };
}
async function settings() {
  const s = await api('/admin/settings');
  const F = [{ k: 'store_name', l: 'Nome da loja' }, { k: 'slogan', l: 'Slogan' }, { k: 'whatsapp', l: 'WhatsApp da loja (só números, com DDD)' }, { k: 'instagram', l: 'Instagram (URL)' }, { k: 'tiktok', l: 'TikTok (URL)' }, { k: 'youtube', l: 'YouTube (URL)' }, { k: 'instagram_feedback_url', l: 'Link "Ver mais feedbacks" (Instagram)' }, { k: 'email', l: 'E-mail de atendimento' }, { k: 'company_name', l: 'Razão social' }, { k: 'cnpj', l: 'CNPJ' },
    { k: 'pix_pct', l: '% desconto Pix padrão', t: 'number' }, { k: 'max_installments', l: 'Máx. parcelas sem juros', t: 'number' }, { k: 'min_installment_cents', l: 'Parcela mínima (centavos)', t: 'number' }, { k: 'personalization_cents', l: 'Custo da personalização (centavos)', t: 'number' }, { k: 'free_shipping_over_cents', l: 'Frete grátis (pronta entrega) acima de (centavos; 0 = desativado)', t: 'number' }, { k: 'origin_cep', l: 'CEP de origem do estoque próprio' }, { k: 'low_stock_threshold', l: 'Alerta de estoque baixo (≤)', t: 'number' }, { k: 'import_notice', l: 'Aviso padrão de produto importado', t: 'textarea', full: true }];
  shell('settings', `<h1>Configurações</h1><form class="card form" id="form">${F.map((f) => fieldHtml(f, s[f.k])).join('')}<div class="full"><button class="btn">Salvar</button></div></form>`);
  $('#form').onsubmit = async (ev) => { ev.preventDefault(); try { await api('/admin/settings', { method: 'PUT', body: readFields(F) }); toast('Configurações salvas.'); } catch (err) { toast(err.message, true); } };
}
async function users() {
  const rows = await api('/admin/users');
  shell('users', `<h1>Clientes</h1><div class="tw"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Pedidos</th><th>Cadastro</th></tr></thead><tbody>${rows.map((u) => `<tr><td>${e(u.name)}</td><td>${e(u.email)}</td><td>${e(u.role)}</td><td>${u.orders}</td><td>${dt(u.created_at)}</td></tr>`).join('')}</tbody></table></div>`);
}
async function audit() {
  const rows = await api('/admin/audit');
  shell('audit', `<h1>Logs / Backup<a class="btn" href="/api/admin/backup" download>⬇ Baixar backup do banco</a></h1><div class="tw"><table><thead><tr><th>Data</th><th>Usuário</th><th>Ação</th><th>Detalhe</th><th>IP</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${dt(r.created_at)}</td><td>${r.user_id || ''}</td><td>${e(r.action)}</td><td>${e(r.detail || '')}</td><td>${e(r.ip || '')}</td></tr>`).join('')}</tbody></table></div>`);
}

/* ---------- Router + login ---------- */
async function router() {
  if (!S.user) return;
  const [, path = 'dashboard', arg] = location.hash.replace(/\?.*/, '').split('/'); const qs = location.hash.split('?')[1] || '';
  try {
    if (path === 'dashboard') await dashboard();
    else if (path === 'orders') arg ? await orderPage(arg) : await ordersList(qs);
    else if (path === 'supplier-orders') await supplierOrders();
    else if (path === 'products') arg ? await productForm(arg) : await productsList(qs);
    else if (path === 'entities') arg ? await entityForm(arg, qs) : await entitiesList(qs);
    else if (path === 'size_guides') arg ? await guideForm(arg) : await guidesList();
    else if (path === 'pages') await pages(arg);
    else if (path === 'reviews') await reviews(qs);
    else if (path === 'settings') await settings();
    else if (path === 'users') await users();
    else if (path === 'audit') await audit();
    else if (RES[path]) arg ? await formPage(path, arg) : await listPage(path);
    else await dashboard();
  } catch (err) { shell(path, `<h1>Erro</h1><div class="card">${e(err.message)}</div>`); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', router);
function loginView(msg) {
  $('#root').innerHTML = `<form class="login" id="lf"><h1>Painel Sport Imperativo</h1>${msg ? `<p style="color:var(--bad);margin-bottom:10px">${e(msg)}</p>` : ''}<div class="f"><label>E-mail</label><input name="email" type="email" autocomplete="username" required></div><div class="f" style="margin-top:10px"><label>Senha</label><input name="password" type="password" autocomplete="current-password" required></div><button class="btn" style="margin-top:14px;width:100%">Entrar</button></form>`;
  $('#lf').onsubmit = async (ev) => { ev.preventDefault(); try { const r = await api('/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(ev.target)) }); if (r.user.role !== 'admin') { await api('/auth/logout', { method: 'POST' }); return loginView('Esta conta não tem acesso administrativo.'); } boot(); } catch (err) { loginView(err.message); } };
}
async function boot() {
  const me = await api('/auth/me').catch(() => ({}));
  if (!me.user || me.user.role !== 'admin') return loginView();
  S.user = me.user; await loadRefs(); router();
}
boot();
