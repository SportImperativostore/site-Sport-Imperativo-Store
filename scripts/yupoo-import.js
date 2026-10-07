/* Importa chuteiras e NBA (levantados do Yupoo) como produtos sob encomenda. Idempotente (SKU YP-<álbum>).
 * Fotos já otimizadas em public/img/catalog/p/yp-<álbum>/{0,1}.webp.
 * Uso: node --env-file=.env scripts/yupoo-import.js [--dry] */
const fs = require('fs');
const path = require('path');
const { client, q, init, refreshSettings } = require('../server/db');
const { slugify } = require('../server/lib/util');
const D = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'yupoo', f), 'utf8'));
const DRY = process.argv.includes('--dry');
const PRICE = { boot: 55000, nba: 26500 };
const CJK = /[㐀-鿿＀-￯]/;
const clean = (s) => s.replace(/&amp;/g, '&').replace(/&#x3D;/g, '=').replace(/\s+/g, ' ').trim();

/* ---------- chuteiras ---------- */
const BRANDS = [['耐克', 'Nike'], ['阿迪达斯', 'Adidas'], ['美津浓', 'Mizuno'], ['彪马', 'Puma'], ['新百伦', 'New Balance'], ['亚瑟士', 'Asics'], ['茵宝', 'Umbro'], ['安德玛', 'Under Armour'], ['乔玛', 'Joma']];
const BRAND_EN = ['Nike', 'Adidas', 'Mizuno', 'Puma', 'New Balance', 'Asics', 'Umbro', 'Under Armour', 'Joma'];
const FAMILIES = ['Mercurial', 'Phantom', 'Tiempo', 'Zoom Superfly', 'Superfly', 'Vapor', 'F50', 'Predator', 'Copa', 'Deportivo', 'X Crazyfast', 'Ultra', 'Future', 'King', 'Morelia', 'Rebula', 'Furon', 'Tekela', 'Luna'];
const reEsc = (b) => b.replace(/ /g, '\\s');
function bootInfo(title) {
  const t = clean(title);
  const brand = (BRANDS.find(([c]) => t.includes(c)) || [])[1] || BRAND_EN.find((b) => new RegExp('\\b' + reEsc(b) + '\\b', 'i').test(t)) || 'Outras';
  const m = t.match(/(\d{2})\s*-\s*(\d{2})/);
  const sizes = [];
  const lo = m ? Math.max(37, +m[1]) : 39, hi = m ? Math.min(45, +m[2]) : 45;
  for (let s = lo; s <= hi; s++) sizes.push(String(s));
  const latin = t.replace(/\d{2}\s*-\s*\d{2}/g, ' ').split(CJK).map((x) => x.replace(/[()（）]/g, ' ').trim()).filter((x) => /[A-Za-z]{2}/.test(x));
  const bre = new RegExp('\\b' + reEsc(brand) + '\\b', 'i');
  let model = clean(latin.filter((x) => bre.test(x)).sort((x, y) => y.length - x.length)[0] || latin.join(' '));
  model = model.replace(/\bsize\b/gi, ' ').replace(/\s+\d{2}\s*$/, '').replace(/\s+/g, ' ').trim();
  if (!model) return null;
  model = model.replace(/\badidas\b/gi, 'Adidas').replace(/\bNIKE\b/g, 'Nike').replace(/\bPUMA\b/g, 'Puma').replace(/\bMIZUNO\b/g, 'Mizuno').replace(/\bPHANTOM\b/g, 'Phantom').replace(/\bLUNA\b/g, 'Luna').replace(/\bELITE\b/g, 'Elite').replace(/\bTIEMPO\b/g, 'Tiempo').replace(/\bLEGEND\b/g, 'Legend').replace(/\bAIR\b/g, 'Air').replace(/\bHYPERFAST\b/g, 'Hyperfast');
  model = model.replace(/^(\w+) \w{2} didas\b/i, '$1');
  if (!new RegExp('^' + reEsc(brand), 'i').test(model)) model = brand + ' ' + model;
  const tok = model.split(' ').pop().toUpperCase();
  let mod = 'campo';
  if (/^(TF|TURF)$/.test(tok) || /碎钉|草钉/.test(t)) mod = 'society'; else if (/^(IC|IN|IND|FUTSAL)$/.test(tok) || /室内/.test(t)) mod = 'futsal';
  const fam = FAMILIES.find((f) => new RegExp('\\b' + reEsc(f) + '\\b', 'i').test(model)) || null;
  return { brand, model, sizes, mod, fam: ['Vapor', 'Zoom Superfly', 'Superfly'].includes(fam) ? 'Mercurial' : fam };
}

/* ---------- NBA ---------- */
const TEAMS = { 爵士: 'Utah Jazz', 尼克斯: 'New York Knicks', 老鹰: 'Atlanta Hawks', 奇才: 'Washington Wizards', 凯尔特人: 'Boston Celtics', 马刺: 'San Antonio Spurs', 湖人: 'Los Angeles Lakers', 热火: 'Miami Heat', '76人': 'Philadelphia 76ers', 公牛: 'Chicago Bulls', 步行者: 'Indiana Pacers', 鹈鹕: 'New Orleans Pelicans', 魔术: 'Orlando Magic', 活塞: 'Detroit Pistons', 勇士: 'Golden State Warriors', 火箭: 'Houston Rockets', 快船: 'Los Angeles Clippers', 雷霆: 'Oklahoma City Thunder', 掘金: 'Denver Nuggets', 灰熊: 'Memphis Grizzlies', 雄鹿: 'Milwaukee Bucks', 森林狼: 'Minnesota Timberwolves', 篮网: 'Brooklyn Nets', 黄蜂: 'Charlotte Hornets', 骑士: 'Cleveland Cavaliers', 独行侠: 'Dallas Mavericks', 国王: 'Sacramento Kings', 太阳: 'Phoenix Suns', 开拓者: 'Portland Trail Blazers', 猛龙: 'Toronto Raptors' };
const PLAYERS = { 特雷杨: 'Trae Young', 文班亚马: 'Wembanyama', 库兹马: 'Kuzma', 米切尔: 'Donovan Mitchell', 利拉德: 'Lillard', 伦纳德: 'Kawhi Leonard', 科比: 'Kobe Bryant', 希尔: 'Grant Hill', 艾佛森: 'Allen Iverson', 字母哥: 'Giannis', 詹姆斯: 'LeBron James', 英格拉姆: 'Brandon Ingram', 班凯罗: 'Banchero', 瓦格纳: 'Wagner', 麦迪: 'Tracy McGrady', 乔治: 'Paul George', 库里: 'Stephen Curry', 杜兰特: 'Kevin Durant', 哈登: 'James Harden', 东契奇: 'Doncic', 约基奇: 'Jokic', 恩比德: 'Embiid', 塔图姆: 'Tatum', 布克: 'Booker', 欧文: 'Kyrie Irving', 爱德华兹: 'Anthony Edwards', 莫兰特: 'Ja Morant', 锡安: 'Zion Williamson', 威廉森: 'Zion Williamson', 巴特勒: 'Jimmy Butler', 乔丹: 'Michael Jordan', 奥尼尔: "Shaquille O'Neal", 伯德: 'Larry Bird', 加内特: 'Kevin Garnett', 邓肯: 'Tim Duncan', 罗斯: 'Derrick Rose', 皮蓬: 'Scottie Pippen', 罗德曼: 'Dennis Rodman', 卡特: 'Vince Carter', 福克斯: "De'Aaron Fox", 马克西: 'Maxey', 哈利伯顿: 'Haliburton', 亚历山大: 'Shai Gilgeous-Alexander', 浓眉: 'Anthony Davis', 戴维斯: 'Anthony Davis', 汤普森: 'Klay Thompson', 格林: 'Draymond Green', 保罗: 'Chris Paul', 韦德: 'Dwyane Wade', 奥拉朱旺: 'Hakeem Olajuwon', 马龙: 'Karl Malone', 斯托克顿: 'John Stockton', 皮尔斯: 'Paul Pierce', 比尔: 'Bradley Beal', 杰伦布朗: 'Jaylen Brown', 阿德托昆博: 'Giannis', 贾巴尔: 'Kareem Abdul-Jabbar', 魔术师: 'Magic Johnson' };
const COLORS = [['浅蓝色', 'Azul claro'], ['深蓝色', 'Azul marinho'], ['蓝色', 'Azul'], ['紫色', 'Roxa'], ['白橙', 'Branca e laranja'], ['白色', 'Branca'], ['黑色', 'Preta'], ['红色', 'Vermelha'], ['黄色', 'Amarela'], ['绿色', 'Verde'], ['橙色', 'Laranja'], ['金色', 'Dourada'], ['灰色', 'Cinza'], ['粉色', 'Rosa']];
function nbaInfo(title) {
  const t = clean(title);
  const team = Object.keys(TEAMS).sort((a, b) => b.length - a.length).find((k) => t.includes(k)); if (!team) return null;
  const num = (t.match(/(\d{1,2})\s*号/) || [])[1];
  const player = Object.keys(PLAYERS).sort((a, b) => b.length - a.length).find((k) => t.includes(k));
  const color = (COLORS.find(([c]) => t.includes(c)) || [])[1];
  const season = (t.match(/(\d{2})\s*赛季/) || [])[1];
  const kind = /短裤/.test(t) ? 'Shorts' : /外套|开衫|夹克/.test(t) ? 'Jaqueta' : /背心/.test(t) ? 'Regata de treino' : /短袖/.test(t) && !/球衣/.test(t) ? 'Camiseta' : /童装|青年|儿童/.test(t) ? 'Camisa Infantil' : /女款/.test(t) ? 'Camisa Feminina' : 'Camisa';
  const jersey = /^Camisa/.test(kind);
  const special = /全明星/.test(t) ? 'All-Star' : /城市版/.test(t) ? 'City Edition' : /飞人/.test(t) ? 'Jordan Brand' : /复古|Mitchell|M&N|MN/.test(t) ? 'Retrô Mitchell & Ness' : /荣耀版/.test(t) ? 'Edição Honra' : /联名/.test(t) ? 'Colaboração' : /球员版/.test(t) ? 'Versão Jogador' : null;
  return { team: TEAMS[team], num, player: player && PLAYERS[player], color, season, kind, jersey, special };
}

(async () => {
  await init();
  const photos = D('photos.json');
  const have = new Set((await q.all("SELECT sku FROM products WHERE sku LIKE 'YP-%'")).map((p) => p.sku));
  const ent = async (slug) => (await q.get('SELECT id FROM entities WHERE slug=?', slug) || {}).id;
  let nextEnt = (await q.get('SELECT COALESCE(MAX(id),0) m FROM entities')).m, nextProd = (await q.get('SELECT COALESCE(MAX(id),0) m FROM products')).m;
  const ops = []; const op = (sql, args) => ops.push({ sql, args: args.map((a) => (a === undefined ? null : a)) });
  const newEnt = async (slug, type, name, parents, sort = 500, menu = 1) => {
    let id = await ent(slug); if (id) return id;
    id = ++nextEnt; op('INSERT INTO entities(id,type,name,slug,sort,show_in_menu,active) VALUES(?,?,?,?,?,?,1)', [id, type, name, slug, sort, menu]);
    for (const p of parents) op('INSERT OR IGNORE INTO entity_links(parent_id,child_id,sort) VALUES(?,?,?)', [p, id, sort]);
    return id;
  };
  const chut = await ent('chuteiras'), nba = await ent('nba');
  const marcas = await ent('marcas-chuteiras'), modelsDept = await newEnt('modelos-chuteiras', 'department', 'Modelos', [chut], 2);
  const guideBoot = (await q.get("SELECT id FROM size_guides WHERE name='Chuteiras'") || {}).id, guideNba = (await q.get("SELECT id FROM size_guides WHERE name='Torcedor'") || {}).id;
  const sizeSet = new Set((await q.all('SELECT name FROM sizes')).map((s) => s.name));
  const used = new Set((await q.all('SELECT slug FROM products')).map((p) => p.slug));
  const uniq = (b) => { let s = slugify(b), n = 2, c = s; while (used.has(c)) c = `${s}-${n++}`; used.add(c); return c; };
  const entCache = {};
  const getEnt = async (key, mk) => (entCache[key] ||= await mk());
  const nameCount = {};
  let nb = 0, nn = 0, skipped = 0;
  const deptId = { jerseys: await ent('jerseys-nba'), jogadores: await ent('jogadores-nba'), edicoes: await ent('edicoes-especiais-nba'), outros: await ent('outros-nba') };

  function addProduct({ pid, name, desc, price, sizes, guide, ents, tags, shape }) {
    const id = ++nextProd, n = photos[pid];
    op(`INSERT INTO products(id,slug,name,description,price_cents,fulfillment,stock,shipping_rule,origin,lead_min,lead_max,weight_g,customizable,custom_price_cents,size_guide_id,tags,sku,shape,active,sold,search_text)
        VALUES(?,?,?,?,?,'import',0,'free','China',15,30,?,0,NULL,?,?,?,?,1,0,?)`,
    [id, uniq(name + '-' + String(pid).slice(-5)), name, desc, price, shape === 'boot' ? 900 : 400, guide || null, tags, 'YP-' + pid, shape === 'boot' ? 'boot' : 'jersey', (name + ' ' + tags).toLowerCase()]);
    for (const e of new Set(ents.filter(Boolean))) op('INSERT OR IGNORE INTO product_entities(product_id,entity_id) VALUES(?,?)', [id, e]);
    for (let i = 0; i < n; i++) op('INSERT INTO product_images(product_id,url,kind,sort) VALUES(?,?,?,?)', [id, `/img/catalog/p/yp-${pid}/${i}.webp`, 'image', i]);
    for (const s of sizes) { if (!sizeSet.has(s)) { sizeSet.add(s); op('INSERT OR IGNORE INTO sizes(name,sort) VALUES(?,?)', [s, 400]); } op('INSERT OR IGNORE INTO variants(product_id,size,stock) VALUES(?,?,0)', [id, s]); }
  }

  for (const a of D('boots.json')) {
    if (have.has('YP-' + a.id) || !photos[a.id]) { skipped++; continue; }
    const info = bootInfo(a.title); if (!info) { skipped++; continue; }
    const base = 'Chuteira ' + info.model; const k = base.toLowerCase(); nameCount[k] = (nameCount[k] || 0) + 1;
    const name = nameCount[k] > 1 ? `${base} (Cor ${nameCount[k]})` : base;
    const bslug = slugify(info.brand);
    const brandId = await getEnt('b:' + bslug, async () => (await ent(bslug)) || newEnt(bslug, 'brand', info.brand, [marcas], 800));
    const modId = await getEnt('m:' + info.mod, () => ent(info.mod));
    const famId = info.fam ? await getEnt('f:' + info.fam, () => newEnt('modelo-' + slugify(info.fam), 'model', info.fam, [modelsDept], 500)) : null;
    addProduct({ pid: a.id, name, desc: `${name}. Chuteira ${info.mod === 'campo' ? 'de campo' : info.mod === 'society' ? 'society' : 'de futsal'} importada. Consulte a tabela de numeração e escolha seu tamanho.`, price: PRICE.boot, sizes: info.sizes, guide: guideBoot, ents: [chut, brandId, modId, famId], tags: `chuteira ${info.brand} ${info.fam || ''} ${info.mod}`, shape: 'boot' });
    nb++;
  }
  for (const a of D('nba.json')) {
    if (have.has('YP-' + a.id) || !photos[a.id]) { skipped++; continue; }
    const i = nbaInfo(a.title); if (!i) { skipped++; continue; }
    const parts = [i.kind, 'NBA', i.team, i.color, i.special, i.season && `${i.season}/${+i.season + 1}`, i.num && `#${i.num}`, i.player].filter(Boolean);
    const base = parts.join(' '); const k = base.toLowerCase(); nameCount[k] = (nameCount[k] || 0) + 1;
    const name = nameCount[k] > 1 ? `${base} (Opção ${nameCount[k]})` : base;
    const teamId = await ent('nba-' + slugify(i.team));
    const dept = !i.jersey ? deptId.outros : deptId.jerseys;
    const ents = [nba, dept, teamId, i.player && deptId.jogadores, i.special && deptId.edicoes];
    addProduct({ pid: a.id, name, desc: `${name}. Importado, qualidade premium. Escolha o tamanho na tabela de medidas.`, price: PRICE.nba, sizes: ['P', 'M', 'G', 'GG', 'XGG', '2XG'], guide: guideNba, ents, tags: `nba basquete ${i.team} ${i.kind} ${i.player || ''}`, shape: 'jersey' });
    nn++;
  }
  console.log(`chuteiras: ${nb} • NBA: ${nn} • ignorados: ${skipped} • operações: ${ops.length}`);
  if (DRY) { console.log(ops.filter((o) => o.sql.startsWith('INSERT INTO products')).filter((_, i) => i % 35 === 0).map((o) => o.args[2]).join('\n')); return process.exit(0); }
  for (let i = 0; i < ops.length; i += 200) await client.batch(ops.slice(i, i + 200), 'write');
  await refreshSettings();
  console.log('importação concluída'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
