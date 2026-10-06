import { $, $$, e, api, state, productCard, setMeta, skeletonGrid, pager, debounce } from '../lib.js';
import { actions } from '../app.js';

const GROUPS = [['category', 'Categoria'], ['club', 'Time'], ['national_team', 'Seleção'], ['league', 'Liga'], ['competition', 'Campeonato'], ['country', 'País'], ['brand', 'Marca'], ['model', 'Modelo'], ['driver', 'Piloto'], ['modality', 'Modalidade']];
const SORTS = [['relevance', 'Mais relevantes'], ['price_asc', 'Menor preço'], ['price_desc', 'Maior preço'], ['newest', 'Lançamentos'], ['rating', 'Melhor avaliados'], ['discount', 'Maiores descontos']];

const lum = (h) => { const n = parseInt((h || '#000000').slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
// Mantém o texto branco legível: usa sempre uma cor escura como base do banner do clube.
function bannerColors(m) {
  const a = m.color1, b = m.color2 || '#0636a8';
  if (lum(a) < 0.6) return `${a},${lum(b) < 0.75 ? b : '#0636a8'}`;
  return `${lum(b) < 0.6 ? b : '#0b1a33'},#0636a8`;
}
let ac = null;
export default async function catalog(ctx) {
  if (ac) ac.abort(); ac = new AbortController();
  const segs = ctx.search || ctx.offers ? [] : ctx.path.split('/').filter(Boolean);
  const mode = ctx.offers ? 'offers' : ctx.search ? 'search' : 'catalog';
  let query = new URLSearchParams(ctx.query);
  let meta = null, entTypes = {}, pathSegs = segs;

  $('#app').innerHTML = `<div class="wrap"><div class="skeleton" style="height:110px;margin:20px 0"></div>${skeletonGrid(8)}</div>`;

  const apiParams = () => {
    const p = new URLSearchParams(query);
    if (mode === 'offers') p.set('sale', '1');
    return p;
  };
  async function fetchData() {
    const p = apiParams();
    if (mode === 'catalog') { p.set('path', pathSegs.join('/')); return api('/catalog?' + p); }
    p.set('facets', '1'); return api('/products?' + p);
  }
  const url = () => (mode === 'catalog' ? '/' + pathSegs.join('/') : mode === 'offers' ? '/ofertas' : '/busca') + (query.toString() ? '?' + query : '');
  const selected = () => (query.get('e') || '').split(',').filter(Boolean);

  async function load(first) {
    const area = $('#results'); if (area) area.classList.add('loading');
    let d;
    try { d = await fetchData(); } catch (err) { throw err; }
    if (first) { meta = d; }
    for (const [t, list] of Object.entries(d.facets.entities)) for (const x of list) entTypes[x.slug] = t;
    paint(d, first);
  }

  function filtersHtml(d) {
    const sel = selected(), f = d.facets;
    const out = [];
    for (const [type, title] of GROUPS) {
      const list = (f.entities[type] || []).filter((x) => !pathSegs.includes(x.slug) && !(mode === 'catalog' && type === 'category' && false));
      if (list.length < 1) continue;
      const open = list.some((x) => sel.includes(x.slug)) || ['category', 'club'].includes(type);
      out.push(`<details class="fgroup" ${open ? 'open' : ''}><summary>${title}</summary><div class="opts">${list.slice(0, 40).map((x) => `<label><input type="checkbox" data-ent="${e(x.slug)}" data-type="${type}" ${sel.includes(x.slug) ? 'checked' : ''}>${e(x.name)}<small>${x.n}</small></label>`).join('')}</div></details>`);
    }
    if (f.sizes.length) out.push(`<details class="fgroup" ${query.get('size') ? 'open' : ''}><summary>Tamanho</summary><div class="sizes" style="margin-top:10px">${f.sizes.map((s) => `<button class="size ${query.get('size') === s.size ? 'on' : ''}" data-size="${e(s.size)}" style="min-width:46px;height:38px">${e(s.size)}</button>`).join('')}</div></details>`);
    out.push(`<details class="fgroup" open><summary>Preço</summary><div class="price-in"><input type="number" inputmode="numeric" placeholder="Mín." id="pmin" value="${e(query.get('min') || '')}"><input type="number" inputmode="numeric" placeholder="Máx." id="pmax" value="${e(query.get('max') || '')}"></div></details>`);
    out.push(`<details class="fgroup" open><summary>Tipo de envio</summary>
      <label><input type="radio" name="ship" value="" ${!query.get('ship') ? 'checked' : ''}>Todos</label>
      <label><input type="radio" name="ship" value="stock" ${query.get('ship') === 'stock' ? 'checked' : ''}>Pronta entrega<small>${(f.ship.find((x) => x.fulfillment === 'stock') || {}).n || 0}</small></label>
      <label><input type="radio" name="ship" value="import" ${query.get('ship') === 'import' ? 'checked' : ''}>Importado / sob encomenda<small>${(f.ship.find((x) => x.fulfillment === 'import') || {}).n || 0}</small></label></details>`);
    out.push(`<details class="fgroup" open><summary>Mais filtros</summary>
      <label><input type="checkbox" data-flag="avail" ${query.get('avail') === '1' ? 'checked' : ''}>Disponíveis</label>
      <label><input type="checkbox" data-flag="custom" ${query.get('custom') === '1' ? 'checked' : ''}>Personalizáveis<small>${f.custom}</small></label>
      ${mode !== 'offers' ? `<label><input type="checkbox" data-flag="sale" ${query.get('sale') === '1' ? 'checked' : ''}>Em oferta</label>` : ''}
      <label><input type="checkbox" data-flag="rating" ${query.get('rating') === '4' ? 'checked' : ''}>4★ ou mais</label></details>`);
    return out.join('');
  }

  function tabsHtml(d) {
    if (mode !== 'catalog' || !d.categoryTabs) return '';
    const catSlugs = d.categoryTabs.map((c) => c.slug);
    const cur = pathSegs.find((s) => catSlugs.includes(s));
    const base = pathSegs.filter((s) => !catSlugs.includes(s));
    const mk = (slug) => '/' + [...base, ...(slug ? [slug] : [])].join('/');
    return `<div class="tabs" role="tablist"><a href="${mk('')}" class="${!cur ? 'on' : ''}">Todas</a>${d.categoryTabs.map((c) => `<a href="${mk(c.slug)}" class="${cur === c.slug ? 'on' : ''}">${e(c.name)}</a>`).join('')}</div>`;
  }

  function paint(d, first) {
    const page = parseInt(query.get('page'), 10) || 1;
    const title = mode === 'catalog' ? d.title : mode === 'offers' ? 'Ofertas' : `Resultados para “${query.get('q') || ''}”`;
    if (first) {
      setMeta(`${title} | Sport Imperativo Store`);
      const crumbs = mode === 'catalog' ? d.breadcrumbs : [{ name: title, path: '' }];
      const m = d.main || {};
      const banner = mode === 'catalog'
        ? `<div class="cat-banner" style="${m.color1 ? `background:linear-gradient(120deg,${bannerColors(m)})` : ''}${m.banner ? `;background-image:url(${e(m.banner)});background-size:cover` : ''}">${m.logo ? `<img class="shield" src="${e(m.logo)}" alt="" style="padding:10px;object-fit:contain">` : (['club', 'national_team'].includes(m.type) ? `<div class="shield" style="color:${e(m.color1 || '#0b5cff')}">${e(d.title.replace('Seleção ', '').split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase())}</div>` : '')}<div style="position:relative;z-index:1"><h1>${m.type === 'club' || m.type === 'national_team' ? 'Camisas ' + (m.type === 'club' ? 'do ' : 'da ') : ''}${e(d.title)}</h1>${m.description ? `<p>${e(m.description)}</p>` : ''}</div></div>`
        : `<h1 class="page-h" style="margin-top:6px">${e(title)}</h1>`;
      $('#app').innerHTML = `<div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Início</a>${crumbs.map((c, i) => `<i>›</i>${c.path && i < crumbs.length - 1 ? `<a href="${e(c.path)}">${e(c.name)}</a>` : `<span>${e(c.name)}</span>`}`).join('')}</nav>
        ${banner}<div id="tabs"></div>
        ${mode === 'catalog' && d.children && d.children.length ? `<div class="tabs" style="margin-top:-6px">${d.children.map((c) => `<a href="/${pathSegs.join('/')}/${e(c.slug)}">${e(c.name)}</a>`).join('')}</div>` : ''}
        <div class="layout"><aside class="filters" id="filters"></aside><div><div class="toolbar"><div><button class="btn sm ghost only-m" id="open-filters">Filtros</button> <span id="count" style="color:var(--mut)"></span></div>
          <label style="display:flex;gap:8px;align-items:center;font-size:14px">Ordenar<select id="sort">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label></div><div id="results"></div></div></div></div>`;
      $('#sort').value = query.get('sort') || 'relevance';
      $('#sort').addEventListener('change', (ev) => { setQ('sort', ev.target.value === 'relevance' ? '' : ev.target.value); });
      $('#open-filters').addEventListener('click', () => { $('#filters').classList.add('open'); document.body.style.overflow = 'hidden'; });
      bindFilters();
    }
    $('#tabs').innerHTML = tabsHtml(d);
    $('#filters').innerHTML = `<div class="only-m" style="justify-content:space-between;align-items:center;margin-bottom:8px;display:none"><b>FILTROS</b></div>` + filtersHtml(d) + `<div class="only-m" style="margin-top:14px;gap:8px"><button class="btn block" data-fclose>Ver ${d.total} produtos</button></div>`;
    if (matchMedia('(max-width:860px)').matches) $$('#filters .only-m').forEach((x) => { x.style.display = 'flex'; });
    $('#count').textContent = `${d.total} produto${d.total === 1 ? '' : 's'}`;
    const active = activeChips(d);
    $('#results').classList.remove('loading');
    $('#results').innerHTML = (active ? `<div class="tabs" style="padding-top:0">${active}<a href="#" data-clear style="color:var(--bad);border-color:transparent">Limpar filtros</a></div>` : '') +
      (d.items.length ? `<div class="grid" style="grid-template-columns:repeat(3,1fr)" id="grid">${d.items.map(productCard).join('')}</div>${pager(d.total, page, d.per)}`
        : `<div class="empty"><h3>Nenhum produto encontrado</h3><p>Tente remover filtros ou buscar por outro termo.</p></div>`);
    if (matchMedia('(max-width:560px)').matches) $('#grid') && ($('#grid').style.gridTemplateColumns = 'repeat(2,1fr)');
  }
  function activeChips(d) {
    const chips = [];
    for (const s of selected()) chips.push(`<a href="#" class="on" data-rm-ent="${e(s)}">${e(nameOf(d, s))} ✕</a>`);
    if (query.get('ship')) chips.push(`<a href="#" class="on" data-rm="ship">${query.get('ship') === 'stock' ? 'Pronta entrega' : 'Importado'} ✕</a>`);
    if (query.get('size')) chips.push(`<a href="#" class="on" data-rm="size">Tam. ${e(query.get('size'))} ✕</a>`);
    if (query.get('min') || query.get('max')) chips.push(`<a href="#" class="on" data-rm="min,max">R$ ${e(query.get('min') || 0)}–${e(query.get('max') || '∞')} ✕</a>`);
    for (const [k, l] of [['custom', 'Personalizáveis'], ['avail', 'Disponíveis'], ['rating', '4★+'], ['sale', 'Em oferta']]) if (query.get(k) && !(k === 'sale' && mode === 'offers')) chips.push(`<a href="#" class="on" data-rm="${k}">${l} ✕</a>`);
    return chips.join('');
  }
  const nameOf = (d, slug) => { for (const list of Object.values(d.facets.entities)) { const x = list.find((y) => y.slug === slug); if (x) return x.name; } return slug; };

  function setQ(k, v, push = false) {
    if (v === '' || v == null) query.delete(k); else query.set(k, v);
    if (k !== 'page') query.delete('page');
    history[push ? 'pushState' : 'replaceState']({}, '', url());
    load(false);
    if (k === 'page') window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function bindFilters() {
    const root = $('#app');
    const sig = { signal: ac.signal };
    root.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t.dataset.ent) {
        let cur = selected().filter((s) => entTypes[s] !== t.dataset.type); // um item por tipo (evita interseção vazia)
        if (t.checked) cur.push(t.dataset.ent);
        setQ('e', cur.join(','));
      } else if (t.name === 'ship') setQ('ship', t.value);
      else if (t.dataset.flag) setQ(t.dataset.flag, t.checked ? (t.dataset.flag === 'rating' ? '4' : '1') : '');
    }, sig);
    const price = debounce(() => { query.delete('page'); const mn = $('#pmin').value, mx = $('#pmax').value; mn ? query.set('min', mn) : query.delete('min'); mx ? query.set('max', mx) : query.delete('max'); history.replaceState({}, '', url()); load(false); }, 500);
    root.addEventListener('input', (ev) => { if (ev.target.id === 'pmin' || ev.target.id === 'pmax') price(); }, sig);
    root.addEventListener('click', (ev) => {
      const t = ev.target;
      const sz = t.closest('[data-size]'); if (sz && sz.closest('#filters')) { ev.stopPropagation(); setQ('size', query.get('size') === sz.dataset.size ? '' : sz.dataset.size); return; }
      if (t.closest('[data-fclose]')) { $('#filters').classList.remove('open'); document.body.style.overflow = ''; return; }
      const re = t.closest('[data-rm-ent]'); if (re) { ev.preventDefault(); setQ('e', selected().filter((s) => s !== re.dataset.rmEnt).join(',')); return; }
      const rm = t.closest('[data-rm]'); if (rm) { ev.preventDefault(); rm.dataset.rm.split(',').forEach((k) => query.delete(k)); history.replaceState({}, '', url()); load(false); return; }
      if (t.closest('[data-clear]')) { ev.preventDefault(); query = new URLSearchParams(mode === 'search' ? { q: query.get('q') || '' } : ''); history.replaceState({}, '', url()); load(false); return; }
      const pg = t.closest('[data-action=page]'); if (pg) { ev.stopPropagation(); setQ('page', pg.dataset.page === '1' ? '' : pg.dataset.page, true); }
    }, { capture: true, signal: ac.signal });
  }
  await load(true);
}
