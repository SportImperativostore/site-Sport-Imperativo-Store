// Gera imagens SVG ilustrativas (placeholders) para produtos sem foto. Fotos reais são enviadas pelo painel.
const { esc } = require('./util');

function hex(c, d) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c : d; }
function shade(h, amt) {
  const n = parseInt(h.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, v + amt));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
}
function lum(h) { const n = parseInt(h.slice(1), 16); return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; }

function render({ shape = 'jersey', c1, c2, style = 'plain', label = '', view = 0 }) {
  c1 = hex(c1, '#0b5cff'); c2 = hex(c2, '#ffffff');
  const dark = shade(c1, -40), ink = lum(c1) > 0.6 ? '#101826' : '#ffffff';
  let body = '', pat = '';
  const id = 'c' + Math.abs((c1 + c2 + style + shape).split('').reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7));
  if (shape === 'boot') {
    body = `<path d="M60 250 L60 150 Q60 120 95 118 L150 112 Q190 150 250 160 L330 178 Q352 184 352 206 L352 250 Z" fill="${c1}"/>
    <path d="M60 250 L352 250 L352 270 Q352 278 340 278 L72 278 Q60 278 60 270 Z" fill="${c2}"/>
    <path d="M150 112 Q190 150 250 160" stroke="${c2}" stroke-width="6" fill="none"/>
    <path d="M110 190 L150 172 M130 210 L180 190" stroke="${c2}" stroke-width="5" opacity=".8"/>
    ${[88, 130, 190, 250, 310].map((x) => `<rect x="${x}" y="278" width="12" height="14" rx="3" fill="${dark}"/>`).join('')}`;
  } else if (shape === 'tank') {
    body = `<path d="M130 60 Q150 110 200 110 Q250 110 270 60 L300 60 L310 120 L300 340 Q200 360 100 340 L90 120 L100 60 Z" fill="${id}" />`;
    body = `<path id="${id}p" d="M135 50 Q150 120 200 120 Q250 120 265 50 L300 56 Q312 160 300 345 Q200 362 100 345 Q88 160 100 56 Z" fill="${c1}"/>
    <path d="M135 50 Q150 120 200 120 Q250 120 265 50" fill="none" stroke="${c2}" stroke-width="9"/>
    <path d="M100 56 Q112 160 100 345" fill="none" stroke="${c2}" stroke-width="7"/><path d="M300 56 Q288 160 300 345" fill="none" stroke="${c2}" stroke-width="7"/>`;
  } else {
    // camisa/jersey padrão
    const outline = 'M120 50 L158 40 Q200 76 242 40 L280 50 L350 110 L318 160 L290 140 L292 340 Q200 360 108 340 L110 140 L82 160 L50 110 Z';
    if (style === 'stripes') for (let i = 0; i < 9; i++) pat += i % 2 ? `<rect x="${50 + i * 36}" y="30" width="36" height="340" fill="${c2}"/>` : '';
    if (style === 'hoops') for (let i = 0; i < 8; i++) pat += i % 2 ? `<rect x="40" y="${60 + i * 40}" width="330" height="40" fill="${c2}"/>` : '';
    if (style === 'sash') pat = `<polygon points="110,60 160,60 320,340 270,340" fill="${c2}"/>`;
    if (style === 'half') pat = `<rect x="200" y="30" width="170" height="340" fill="${c2}"/>`;
    body = `<clipPath id="${id}"><path d="${outline}"/></clipPath><path d="${outline}" fill="${c1}"/><g clip-path="url(#${id})">${pat}
      <path d="M50 110 L82 160 L110 140 L120 50 Z M350 110 L318 160 L290 140 L280 50 Z" fill="${dark}" opacity=".35"/></g>
      <path d="M158 40 Q200 76 242 40" fill="none" stroke="${c2}" stroke-width="10"/><path d="${outline}" fill="none" stroke="${shade(c1, -60)}" stroke-width="2"/>
      <circle cx="262" cy="104" r="11" fill="${c2}" opacity=".9"/>`;
  }
  const txt = label ? `<text x="200" y="${shape === 'boot' ? 320 : 392}" text-anchor="middle" font-family="Arial Black,Arial,sans-serif" font-size="15" fill="#6b7a90" letter-spacing="2">${esc(label.toUpperCase().slice(0, 28))}</text>` : '';
  const back = view === 1 && shape !== 'boot' ? `<text x="200" y="190" text-anchor="middle" font-family="Arial Black,Arial" font-size="26" fill="${ink}" opacity=".9">${esc(label.split(' ')[0].toUpperCase().slice(0, 9))}</text><text x="200" y="270" text-anchor="middle" font-family="Arial Black,Arial" font-size="90" fill="${ink}" opacity=".9">10</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 420"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3f6fb"/><stop offset="1" stop-color="#e3eaf5"/></linearGradient></defs>
<rect width="400" height="420" fill="url(#bg)"/><ellipse cx="200" cy="372" rx="130" ry="9" fill="#0b1a33" opacity=".08"/><g transform="translate(0,${shape === 'boot' ? 20 : 0})">${body}${back}</g>${txt}</svg>`;
}
module.exports = { render };
