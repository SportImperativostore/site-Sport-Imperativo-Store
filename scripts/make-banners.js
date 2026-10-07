// Gera os banners futuristas (SVG) em public/img/banners/. Uso: node scripts/make-banners.js
// O texto (título, subtítulo, botão) é HTML editável no admin; aqui só vai a arte de fundo.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'public', 'img', 'banners');
fs.mkdirSync(out, { recursive: true });

const JERSEY = 'M120 50 L158 40 Q200 76 242 40 L280 50 L350 110 L318 160 L290 140 L292 340 Q200 360 108 340 L110 140 L82 160 L50 110 Z';
const BOOT = 'M60 250 L60 150 Q60 120 95 118 L150 112 Q190 150 250 160 L330 178 Q352 184 352 206 L352 250 Z M60 250 L352 250 L352 270 Q352 278 340 278 L72 278 Q60 278 60 270 Z';

const rnd = (() => { let s = 11; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();

function grid(w, h, hy, color) {
  const lines = [];
  const vx = w * 0.62;
  for (let i = -14; i <= 14; i++) lines.push(`<line x1="${vx}" y1="${hy}" x2="${vx + i * w * 0.14}" y2="${h}"/>`);
  for (let k = 1; k <= 9; k++) { const y = hy + (h - hy) * Math.pow(k / 9, 2.1); lines.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${w}" y2="${y.toFixed(1)}"/>`); }
  return `<g stroke="${color}" stroke-width="1.2" opacity=".28" mask="url(#fadeUp)">${lines.join('')}</g>`;
}
function streaks(w, h, color, n = 16) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = rnd() * w * 1.1, y = rnd() * h, len = 140 + rnd() * 380, o = 0.08 + rnd() * 0.28, th = 1 + rnd() * 2.4;
    s += `<line x1="${x.toFixed(0)}" y1="${y.toFixed(0)}" x2="${(x - len).toFixed(0)}" y2="${(y + len * 0.36).toFixed(0)}" stroke="${color}" stroke-width="${th.toFixed(1)}" stroke-linecap="round" opacity="${o.toFixed(2)}"/>`;
  }
  return s;
}
function dots(w, h, n = 60) {
  let s = '';
  for (let i = 0; i < n; i++) s += `<circle cx="${(rnd() * w).toFixed(0)}" cy="${(rnd() * h).toFixed(0)}" r="${(0.8 + rnd() * 2).toFixed(1)}" fill="#bcd6ff" opacity="${(0.12 + rnd() * 0.5).toFixed(2)}"/>`;
  return s;
}
function hexRing(cx, cy, r, color, o = 0.5, sw = 2) {
  const pts = Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i + Math.PI / 6; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`; }).join(' ');
  return `<polygon points="${pts}" fill="none" stroke="${color}" stroke-width="${sw}" opacity="${o}"/>`;
}
const glowPath = (d, tx, ty, sc, c1, c2) => `
  <g transform="translate(${tx} ${ty}) scale(${sc})" filter="url(#glow)">
    <path d="${d}" fill="url(#shape)" fill-opacity=".16" stroke="${c1}" stroke-width="${(3 / sc).toFixed(2)}" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${c2}" stroke-width="${(1 / sc).toFixed(2)}" stroke-linejoin="round" transform="translate(${(8 / sc).toFixed(1)} ${(8 / sc).toFixed(1)})" opacity=".6"/>
  </g>`;

const MOTIFS = {
  jersey: (cx, cy, s, a, b) => glowPath(JERSEY, cx - 200 * s, cy - 210 * s, s, a, b) + `<g transform="translate(${cx} ${cy + 20 * s})" fill="${b}" opacity=".85" font-family="Arial Black,Arial" text-anchor="middle"><text y="${-20 * s}" font-size="${34 * s}" opacity=".5" letter-spacing="${4 * s}">SI</text><text y="${70 * s}" font-size="${130 * s}">10</text></g>`,
  boot: (cx, cy, s, a, b) => glowPath(BOOT, cx - 206 * s, cy - 150 * s, s, a, b) + `<g stroke="${b}" stroke-width="${2 * s}" opacity=".6" fill="none"><path d="M${cx - 80 * s} ${cy - 10 * s} l${70 * s} ${-26 * s} M${cx - 56 * s} ${cy + 22 * s} l${100 * s} ${-36 * s}"/></g>`,
  ball: (cx, cy, s, a, b) => `<g filter="url(#glow)"><circle cx="${cx}" cy="${cy}" r="${190 * s}" fill="url(#shape)" fill-opacity=".16" stroke="${a}" stroke-width="3"/>
      <g fill="none" stroke="${b}" stroke-width="2" opacity=".75"><path d="M${cx - 190 * s} ${cy} Q${cx} ${cy - 90 * s} ${cx + 190 * s} ${cy}"/><path d="M${cx - 190 * s} ${cy} Q${cx} ${cy + 90 * s} ${cx + 190 * s} ${cy}"/><path d="M${cx} ${cy - 190 * s} Q${cx - 100 * s} ${cy} ${cx} ${cy + 190 * s}"/><path d="M${cx} ${cy - 190 * s} Q${cx + 100 * s} ${cy} ${cx} ${cy + 190 * s}"/></g></g>`,
  car: (cx, cy, s, a, b) => `<g filter="url(#glow)" transform="translate(${cx - 260 * s} ${cy - 60 * s}) scale(${s})">
      <path d="M0 110 L90 96 L170 70 L250 60 L300 30 L360 28 L372 52 L470 66 L520 84 L520 110 L470 118 L470 140 L420 140 L420 118 L130 118 L130 140 L80 140 L80 118 L0 118 Z" fill="url(#shape)" fill-opacity=".16" stroke="${a}" stroke-width="${3 / s}" stroke-linejoin="round"/>
      <circle cx="105" cy="132" r="26" fill="none" stroke="${b}" stroke-width="${3 / s}"/><circle cx="445" cy="132" r="26" fill="none" stroke="${b}" stroke-width="${3 / s}"/></g>
      <g stroke="${b}" stroke-linecap="round" opacity=".55">${[0, 1, 2, 3, 4].map((i) => `<line x1="${cx - 300 * s - i * 40 * s}" y1="${cy + (10 + i * 22) * s}" x2="${cx - 60 * s - i * 14 * s}" y2="${cy + (10 + i * 22) * s}" stroke-width="${(3 - i * 0.4) * s}"/>`).join('')}</g>`,
  percent: (cx, cy, s, a, b) => `<g filter="url(#glow)" font-family="Arial Black,Arial" text-anchor="middle"><text x="${cx}" y="${cy + 110 * s}" font-size="${330 * s}" fill="none" stroke="${a}" stroke-width="3" opacity=".9">%</text>
      <text x="${cx}" y="${cy + 110 * s}" font-size="${330 * s}" fill="${b}" opacity=".10">%</text></g>`,
};

function banner({ name, w, h, motif, accent, accent2, c0 = '#040b1c', c1 = '#071a4d', c2 = '#0b4fe0', mobile = false }) {
  const hy = h * (mobile ? 0.72 : 0.66);
  const cx = mobile ? w * 0.62 : w * 0.73, cy = mobile ? h * 0.66 : h * 0.5;
  const s = mobile ? 1.15 : 1.25;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset=".55" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
  <radialGradient id="halo" cx="${mobile ? 0.62 : 0.74}" cy="${mobile ? 0.62 : 0.48}" r="${mobile ? 0.55 : 0.42}"><stop offset="0" stop-color="${accent}" stop-opacity=".55"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  <linearGradient id="shape" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent2}"/><stop offset="1" stop-color="${accent}"/></linearGradient>
  <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".35" stop-color="#fff" stop-opacity="1"/></linearGradient>
  <mask id="fadeUp"><rect width="${w}" height="${h}" fill="url(#fade)"/></mask>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${mobile ? 6 : 8}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="${w}" height="${h}" fill="url(#bg)"/>
<rect width="${w}" height="${h}" fill="url(#halo)"/>
${grid(w, h, hy, '#6aa3ff')}
${streaks(w, h, '#8fb8ff', mobile ? 10 : 18)}
${dots(w, h, mobile ? 36 : 70)}
<g opacity=".9">${hexRing(cx, cy, (mobile ? 250 : 300) * 1, accent2, 0.28, 1.5)}${hexRing(cx, cy, (mobile ? 330 : 400) * 1, accent2, 0.16, 1.5)}${hexRing(cx, cy, (mobile ? 410 : 500) * 1, accent2, 0.1, 1.5)}</g>
${MOTIFS[motif](cx, cy, s, accent2, '#ffffff')}
<rect y="${h - 4}" width="${w}" height="4" fill="url(#shape)" opacity=".85"/>
</svg>`;
  fs.writeFileSync(path.join(out, `${name}${mobile ? '-m' : ''}.svg`), svg);
}

const LIST = [
  { name: 'hero-futebol', motif: 'jersey', accent: '#1f6bff', accent2: '#7db3ff' },
  { name: 'ofertas', motif: 'percent', accent: '#ff3d5a', accent2: '#ff9aa9', c1: '#1a0a2e', c2: '#5a0f3a' },
  { name: 'chuteiras', motif: 'boot', accent: '#19c3ff', accent2: '#8ee7ff', c1: '#041a33', c2: '#06507a' },
  { name: 'nba', motif: 'ball', accent: '#ff8a1f', accent2: '#ffc27a', c1: '#14102a', c2: '#3d1f6e' },
  { name: 'f1', motif: 'car', accent: '#ff2b2b', accent2: '#ff8a8a', c1: '#12060a', c2: '#4a0a14' },
];
for (const b of LIST) { banner({ ...b, w: 1920, h: 640 }); banner({ ...b, w: 900, h: 900, mobile: true }); }
console.log('Banners gerados em', out);
