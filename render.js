// BYOL design engine: code-drawn, print-ready apparel graphics.
// Renders SVG templates with headless Chromium to transparent PNGs at 300 DPI
// (12 x 16 in canvas = 1200 x 1600 CSS px at deviceScaleFactor 3 = 3600 x 4800 px),
// then trims to the artwork. No AI image model involved, so text is always exact.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// ---------- ink schemes ----------
const SCHEMES = {
  dark: { // for light garments (white, cream, sand)
    name: 'dark-ink', P: '#121212', accent: '#E63946',
    marigold: ['#F4A21B', '#F97316', '#FBBF24', '#B45309'],
    magenta: '#D61C7B', purple: '#6D28D9', teal: '#0F9B8E', green: '#2F6B3A', gold: '#C99A2E',
  },
  light: { // for dark garments (black, charcoal, navy)
    name: 'light-ink', P: '#FFFFFF', accent: '#FF4D5A',
    marigold: ['#FFB020', '#FF7A1A', '#FFD23F', '#E8862B'],
    magenta: '#FF3E9A', purple: '#A78BFA', teal: '#2DD4BF', green: '#5FAF6C', gold: '#E2B650',
  },
};

// ---------- fonts (all installed locally, OFL / GUST licensed) ----------
const F = {
  cond: 'TeX Gyre Heros Cn',   // condensed grotesque, wordmarks
  geo: 'Poppins',              // geometric sans, small caps lines
  serif: 'Lora',               // serif with a good italic
  retro: 'TeX Gyre Bonum',     // Bookman-style, 70s flyer feel
  avant: 'TeX Gyre Adventor',  // Avant Garde-style geometric
};

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let uid = 0;
const id = (p) => `${p}${++uid}`;

// ---------- motif helpers ----------
function marigold(cx, cy, r, pal, seed = 0) {
  // cempasuchil: ruffled pompom built from layered petal rings
  const layers = [
    { rr: 1.0, n: 16, col: pal[0], rot: 0 },
    { rr: 0.78, n: 14, col: pal[1], rot: 12 },
    { rr: 0.56, n: 12, col: pal[2], rot: 5 },
    { rr: 0.36, n: 10, col: pal[0], rot: 20 },
  ];
  let s = `<g transform="translate(${cx} ${cy}) rotate(${seed})">`;
  for (const L of layers) {
    const R = r * L.rr;
    for (let i = 0; i < L.n; i++) {
      const a = (360 / L.n) * i + L.rot;
      s += `<ellipse cx="0" cy="${-R * 0.62}" rx="${R * 0.26}" ry="${R * 0.44}" fill="${L.col}" transform="rotate(${a})"/>`;
    }
  }
  s += `<circle r="${r * 0.14}" fill="${pal[3]}"/>`;
  s += `</g>`;
  return s;
}

function leaf(x, y, len, angle, col) {
  return `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M0 0 C ${len * 0.35} ${-len * 0.35}, ${len * 0.75} ${-len * 0.25}, ${len} 0 C ${len * 0.75} ${len * 0.25}, ${len * 0.35} ${len * 0.35}, 0 0 Z" fill="${col}"/><path d="M0 0 L ${len} 0" stroke="${col}" stroke-width="3" opacity="0.5"/></g>`;
}

function candle(x, y, h, P, flameCol) {
  const w = h * 0.34;
  return `<g transform="translate(${x} ${y})">
    <rect x="${-w / 2}" y="0" width="${w}" height="${h}" rx="${w * 0.12}" fill="${P}"/>
    <rect x="${-w * 0.06}" y="${-h * 0.12}" width="${w * 0.12}" height="${h * 0.14}" fill="${P}"/>
    <path d="M0 ${-h * 0.42} C ${w * 0.55} ${-h * 0.18}, ${w * 0.45} ${-h * 0.05}, 0 ${-h * 0.02} C ${-w * 0.45} ${-h * 0.05}, ${-w * 0.55} ${-h * 0.18}, 0 ${-h * 0.42} Z" fill="${flameCol}"/>
  </g>`;
}

function sparkle(cx, cy, r, col) {
  const k = r * 0.22;
  return `<path d="M${cx} ${cy - r} C ${cx + k} ${cy - k}, ${cx + k} ${cy - k}, ${cx + r} ${cy} C ${cx + k} ${cy + k}, ${cx + k} ${cy + k}, ${cx} ${cy + r} C ${cx - k} ${cy + k}, ${cx - k} ${cy + k}, ${cx - r} ${cy} C ${cx - k} ${cy - k}, ${cx - k} ${cy - k}, ${cx} ${cy - r} Z" fill="${col}"/>`;
}

// papel picado banner with scalloped bottom edge and knocked-out (transparent) holes
function papel(x, y, w, h, col, opts = {}) {
  const m = id('pm');
  const scallops = 6, sw = w / scallops, sh = h * 0.09;
  let d = `M0 0 H${w} V${h - sh}`;
  for (let i = scallops; i > 0; i--) {
    const x1 = (i - 1) * sw;
    d += ` A ${sw / 2} ${sh} 0 0 1 ${x1} ${h - sh}`;
  }
  d += ' Z';
  let holes = '';
  // lace border of small diamonds and dots
  const cols = 7, rows = 3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const hx = w * (0.12 + (0.76 * c) / (cols - 1));
      const hy = h * (0.12 + r * 0.11);
      const s = w * 0.028;
      if (opts.letter && r > 0) continue; // keep the middle clear for the letter
      holes += r % 2 === 0
        ? `<rect x="${hx - s}" y="${hy - s}" width="${s * 2}" height="${s * 2}" transform="rotate(45 ${hx} ${hy})" fill="#000"/>`
        : `<circle cx="${hx}" cy="${hy}" r="${s * 0.8}" fill="#000"/>`;
    }
  }
  // bottom row of dots above scallops
  for (let c = 0; c < cols; c++) {
    const hx = w * (0.12 + (0.76 * c) / (cols - 1));
    holes += `<circle cx="${hx}" cy="${h * 0.82}" r="${w * 0.02}" fill="#000"/>`;
  }
  if (opts.letter) {
    holes += `<text x="${w / 2}" y="${h * 0.66}" text-anchor="middle" font-family="${F.cond}" font-weight="bold" font-size="${h * 0.62}" fill="#000">${esc(opts.letter)}</text>`;
  }
  return `<defs><mask id="${m}"><rect x="0" y="0" width="${w}" height="${h}" fill="#fff"/>${holes}</mask></defs>
  <g transform="translate(${x} ${y})"><path d="${d}" fill="${col}" mask="url(#${m})"/></g>`;
}

// ribbon banner with text knocked out
function ribbon(cx, cy, w, h, col, text, font = F.geo, fs = 44, ls = 10) {
  const m = id('rm');
  const x = cx - w / 2, y = cy - h / 2, n = h * 0.5;
  return `<defs><mask id="${m}"><rect x="${x - 20}" y="${y - 20}" width="${w + 40}" height="${h + 40}" fill="#fff"/>
    <text x="${cx}" y="${cy + fs * 0.36}" text-anchor="middle" font-family="${font}" font-weight="bold" font-size="${fs}" letter-spacing="${ls}" fill="#000">${esc(text)}</text></mask></defs>
  <polygon points="${x},${y} ${x + w},${y} ${x + w - n},${cy} ${x + w},${y + h} ${x},${y + h} ${x + n},${cy}" fill="${col}" mask="url(#${m})"/>`;
}

// ---------- designs ----------
// Each returns SVG inner markup. Elements with class "fit" get their font-size fitted to data-w.
// Groups with data-stack="gap" get their direct children stacked vertically (per-child data-gap overrides).
const T = (attrs, txt) => `<text ${attrs}>${esc(txt)}</text>`;

const DESIGNS = {
  wordmark: (S) => `
    <g data-stack="42">
      ${T(`class="fit" data-w="1000" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="16" stroke-linejoin="round" paint-order="stroke"`, 'BRING')}
      ${T(`class="fit" data-w="1000" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="12" stroke-linejoin="round" paint-order="stroke"`, 'YOUR OWN')}
      ${T(`class="fit" data-w="1000" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="16" stroke-linejoin="round" paint-order="stroke"`, 'LATINA')}
      <rect x="100" y="0" width="1000" height="34" fill="${S.accent}" data-gap="54"/>
      ${T(`x="600" y="0" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="64" letter-spacing="26" fill="${S.P}"`, 'B.Y.O.L.')}
    </g>`,

  sheBroughtHerself: (S) => `
    <g data-stack="70">
      ${T(`x="600" y="0" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="46" letter-spacing="18" fill="${S.P}"`, 'BRING YOUR OWN LATINA')}
      ${T(`class="fit" data-w="1040" x="600" y="0" text-anchor="middle" font-family="${F.serif}" font-style="italic" font-weight="500" fill="${S.P}"`, 'she brought herself')}
      <g data-gap="0">${sparkle(500, 20, 22, S.accent)}${sparkle(600, 20, 30, S.accent)}${sparkle(700, 20, 22, S.accent)}</g>
    </g>`,

  admitOne: (S) => {
    const cx = 600, cy = 560;
    return `
    <defs>
      <path id="ringTop" d="M ${cx - 415} ${cy} A 415 415 0 1 1 ${cx + 415} ${cy}"/>
      <path id="ringBot" d="M ${cx - 462} ${cy} A 462 462 0 0 0 ${cx + 462} ${cy}"/>
    </defs>
    <g data-stack="60">
      <g>
        <circle cx="${cx}" cy="${cy}" r="500" fill="none" stroke="${S.P}" stroke-width="18"/>
        <circle cx="${cx}" cy="${cy}" r="470" fill="none" stroke="${S.P}" stroke-width="5"/>
        <circle cx="${cx}" cy="${cy}" r="395" fill="none" stroke="${S.P}" stroke-width="5"/>
        <text font-family="${F.geo}" font-weight="bold" font-size="52" letter-spacing="14" fill="${S.P}"><textPath href="#ringTop" startOffset="50%" text-anchor="middle">BRING YOUR OWN LATINA</textPath></text>
        <text font-family="${F.geo}" font-weight="bold" font-size="52" letter-spacing="14" fill="${S.P}"><textPath href="#ringBot" startOffset="50%" text-anchor="middle">ADMIT ONE</textPath></text>
        ${sparkle(cx - 430, cy, 16, S.P)}${sparkle(cx + 430, cy, 16, S.P)}
        ${T(`x="${cx}" y="${cy + 88}" text-anchor="middle" font-family="${F.cond}" font-weight="bold" font-size="250" fill="${S.P}" stroke="${S.P}" stroke-width="10" stroke-linejoin="round" paint-order="stroke"`, 'B.Y.O.L.')}
        <rect x="${cx - 150}" y="${cy + 128}" width="300" height="8" fill="${S.accent}"/>
        ${T(`x="${cx}" y="${cy + 195}" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="34" letter-spacing="12" fill="${S.P}"`, 'NO EXCEPTIONS')}
      </g>
      ${ribbon(600, 0, 1060, 96, S.accent, 'DANCE PARTNER NOT INCLUDED', F.geo, 38, 6)}
    </g>`;
  },

  noLatinaNoParty: (S) => `
    <g>
      <rect data-frame="rulesStack:120:110" rx="46" fill="none" stroke="${S.P}" stroke-width="20"/>
      <rect data-frame="rulesStack:90:80" rx="30" fill="none" stroke="${S.P}" stroke-width="6"/>
      <g data-stack="30" data-top="250" id="rulesStack">
        ${T(`x="600" y="0" text-anchor="middle" font-family="${F.avant}" font-weight="bold" font-size="40" letter-spacing="16" fill="${S.P}"`, 'HOUSE RULES')}
        <rect x="470" y="0" width="260" height="6" fill="${S.P}" data-gap="60"/>
        ${T(`class="fit" data-w="820" x="600" y="0" text-anchor="middle" font-family="${F.retro}" font-weight="bold" fill="${S.P}"`, 'NO LATINA?')}
        ${T(`class="fit" data-w="820" x="600" y="0" text-anchor="middle" font-family="${F.retro}" font-weight="bold" fill="${S.accent}"`, 'NO PARTY.')}
        <g data-gap="60">${sparkle(470, 16, 18, S.P)}${sparkle(600, 16, 26, S.accent)}${sparkle(730, 16, 18, S.P)}</g>
        ${T(`x="600" y="0" text-anchor="middle" font-family="${F.avant}" font-weight="bold" font-size="44" letter-spacing="14" fill="${S.P}"`, 'BRING YOUR OWN LATINA')}
      </g>
    </g>`,

  catrina: (S) => `
    <g data-stack="42" id="catStack">
      ${T(`class="fit" data-w="880" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="16" stroke-linejoin="round" paint-order="stroke"`, 'BRING')}
      ${T(`class="fit" data-w="880" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="12" stroke-linejoin="round" paint-order="stroke"`, 'YOUR OWN')}
      ${T(`class="fit" data-w="880" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="16" stroke-linejoin="round" paint-order="stroke"`, 'CATRINA')}
      <rect id="catBar" x="160" y="0" width="880" height="34" fill="${S.magenta}" data-gap="50"/>
      ${T(`x="600" y="0" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="40" letter-spacing="18" fill="${S.P}"`, 'DÍA DE MUERTOS')}
    </g>
    <g data-attach="catStack:tl">
      ${marigold(30, 26, 112, S.marigold, 0)}${marigold(-36, 156, 70, S.marigold, 30)}
    </g>
    <g data-attach="catBar:br">
      ${marigold(-20, -96, 112, S.marigold, 15)}${marigold(68, -4, 74, S.marigold, 40)}${marigold(-140, 24, 50, S.marigold, 70)}
    </g>`,

  bailaConLosVivos: (S) => {
    const cols = [S.marigold[1], S.magenta, S.purple, S.teal, S.marigold[0]];
    let banners = `<line x1="60" y1="0" x2="1140" y2="0" stroke="${S.P}" stroke-width="5"/>`;
    for (let i = 0; i < 5; i++) banners += papel(70 + i * 218, 6, 190, 150, cols[i]);
    let row = '';
    const y0 = 40;
    const xs = [150, 300, 450, 600, 750, 900, 1050];
    xs.forEach((x, i) => {
      row += i % 2 === 0 ? marigold(x, y0, 58, S.marigold, i * 17) : candle(x, y0 - 30, 78, S.P, S.marigold[2]);
    });
    return `
    <g data-stack="60">
      <g>${banners}</g>
      ${T(`class="fit" data-w="1000" x="600" y="0" text-anchor="middle" font-family="${F.serif}" font-weight="bold" fill="${S.P}"`, 'BAILA CON LOS VIVOS')}
      ${T(`class="fit" data-w="1000" x="600" y="0" text-anchor="middle" font-family="${F.serif}" font-weight="bold" fill="${S.marigold[0]}"`, 'HONRA A LOS MUERTOS')}
      <g>${row}</g>
      ${T(`x="600" y="0" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="40" letter-spacing="18" fill="${S.P}"`, 'B.Y.O.L.')}
    </g>`;
  },

  papelPicado: (S) => {
    const cols = [S.marigold[1], S.magenta, S.purple, S.teal];
    const letters = ['B', 'Y', 'O', 'L'];
    let g = `<line x1="40" y1="0" x2="1160" y2="0" stroke="${S.P}" stroke-width="6"/>`;
    for (let i = 0; i < 4; i++) g += papel(75 + i * 270, 8, 240, 330, cols[i], { letter: letters[i] });
    return `
    <g data-stack="70">
      <g>${g}</g>
      ${T(`x="600" y="0" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="46" letter-spacing="18" fill="${S.P}"`, 'BRING YOUR OWN LATINA')}
    </g>`;
  },

  cempasuchil: (S) => `
    <g data-stack="50">
      <g>
        <path d="M600 330 C 590 480, 640 560, 600 700" fill="none" stroke="${S.green}" stroke-width="14" stroke-linecap="round"/>
        ${leaf(603, 470, 150, 28, S.green)}${leaf(598, 560, 140, 200, S.green)}
        ${marigold(600, 200, 200, S.marigold, 0)}
      </g>
      ${T(`class="fit" data-w="900" x="600" y="0" text-anchor="middle" font-family="${F.serif}" font-style="italic" font-weight="500" fill="${S.P}"`, 'cempasúchil season')}
      ${T(`x="600" y="0" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="40" letter-spacing="18" fill="${S.P}"`, 'BRING YOUR OWN LATINA')}
    </g>`,

  // ---- holiday line: one word on the front, the calavera art on the back ----
  hol_back_calavera: (S) => {
    const bone = S.name === 'light-ink' ? '#FFFFFF' : '#FBF7EE';
    const line = '#121212';
    const pal = S.marigold;
    // sugar-skull silhouette, symmetric about x=0
    const skull = 'M0,-320 C190,-320 300,-200 300,-60 C300,40 262,92 236,122 C220,160 226,200 200,242 C170,292 110,322 0,322 C-110,322 -170,292 -200,242 C-226,200 -220,160 -236,122 C-262,92 -300,40 -300,-60 C-300,-200 -190,-320 0,-320 Z';
    const eye = (cx, cy) => {
      let s = '';
      for (let i = 0; i < 14; i++) s += `<ellipse cx="0" cy="-84" rx="17" ry="26" fill="${pal[i % 2 ? 1 : 0]}" transform="translate(${cx} ${cy}) rotate(${(360 / 14) * i})"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="76" fill="${line}"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="76" fill="none" stroke="${S.magenta}" stroke-width="7"/>`;
      s += `<circle cx="${cx}" cy="${cy}" r="58" fill="none" stroke="${S.teal}" stroke-width="4" stroke-dasharray="6 8"/>`;
      return s;
    };
    let teeth = `<rect x="-118" y="152" width="236" height="82" rx="26" fill="${bone}" stroke="${line}" stroke-width="7"/>`;
    for (const x of [-84, -56, -28, 0, 28, 56, 84]) teeth += `<line x1="${x}" y1="156" x2="${x}" y2="230" stroke="${line}" stroke-width="6"/>`;
    teeth += `<line x1="-114" y1="193" x2="114" y2="193" stroke="${line}" stroke-width="6"/>`;
    const swirl = (sx) => `<path d="M${sx * 48},-236 C${sx * 104},-254 ${sx * 150},-218 ${sx * 118},-194 C${sx * 102},-182 ${sx * 82},-196 ${sx * 94},-210" fill="none" stroke="${S.magenta}" stroke-width="9" stroke-linecap="round"/>`;
    const diamond = (x, y, s, col) => `<rect x="${x - s}" y="${y - s}" width="${2 * s}" height="${2 * s}" fill="${col}" transform="rotate(45 ${x} ${y})"/>`;
    let deco = swirl(1) + swirl(-1) + marigold(0, -238, 36, pal, 0);
    deco += diamond(-206, 80, 14, S.magenta) + diamond(206, 80, 14, S.magenta) + diamond(-176, 130, 9, S.teal) + diamond(176, 130, 9, S.teal);
    deco += `<circle cx="-236" cy="20" r="7" fill="${S.teal}"/><circle cx="236" cy="20" r="7" fill="${S.teal}"/>`;
    deco += diamond(-64, 272, 8, S.magenta) + diamond(64, 272, 8, S.magenta) + `<circle cx="0" cy="288" r="7" fill="${S.teal}"/>`;
    deco += diamond(-100, 258, 6, S.teal) + diamond(100, 258, 6, S.teal);
    // marigold crown along the top of the cranium
    const crown = [[-152, 46], [-128, 60], [-104, 74], [-90, 86], [-76, 74], [-52, 60], [-28, 46]].map(([a, r], i) => {
      const rad = (a * Math.PI) / 180;
      return marigold(300 * Math.cos(rad) * 0.98, -50 + 300 * Math.sin(rad) * 1.02, r, pal, i * 23);
    }).join('');
    const cols = [pal[1], S.magenta, S.purple, S.teal, pal[0], S.magenta, S.purple];
    let banners = `<line x1="-560" y1="-560" x2="560" y2="-560" stroke="${S.P}" stroke-width="5"/>`;
    for (let i = 0; i < 7; i++) banners += papel(-546 + i * 158, -556, 138, 108, cols[i]);
    return `
    <g transform="translate(600 760) scale(1.05)">
      ${banners}
      ${crown}
      <path d="${skull}" fill="${bone}" stroke="${line}" stroke-width="8" stroke-linejoin="round"/>
      ${eye(-115, -70)}${eye(115, -70)}
      <path d="M0,22 C22,52 48,58 42,90 C36,110 6,104 0,92 C-6,104 -36,110 -42,90 C-48,58 -22,52 0,22 Z" fill="${line}"/>
      ${teeth}
      ${deco}
      ${candle(-330, 348, 90, S.P, pal[2])}${candle(330, 348, 90, S.P, pal[2])}
      ${ribbon(0, 420, 640, 74, S.magenta, 'BAILA CON LOS VIVOS', F.geo, 30, 5)}
      ${T(`x="0" y="512" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="30" letter-spacing="14" fill="${S.P}"`, 'BRING YOUR OWN LATINA')}
    </g>`;
  },
};


// ---- hoodie + sweats set: small chest marks, a leg mark, and a sleeve strip ----
DESIGNS.chest_lower = (S) => `
  <g data-stack="10">
    ${T(`class="fit" data-w="330" x="600" y="0" text-anchor="middle" font-family="${F.serif}" font-style="italic" font-weight="bold" fill="${S.P}"`, 'bring your own latina')}
    <rect x="565" y="0" width="70" height="4" fill="${S.accent}"/>
  </g>`;
DESIGNS.chest_byol = (S) => `
  <g data-stack="8">
    ${T(`class="fit" data-w="300" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="5" stroke-linejoin="round" paint-order="stroke"`, 'B.Y.O.L.')}
    <rect x="450" y="0" width="300" height="10" fill="${S.accent}" data-gap="12"/>
    ${T(`x="600" y="0" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="17" letter-spacing="7" fill="${S.P}"`, 'BRING YOUR OWN LATINA')}
  </g>`;
DESIGNS.chest_badge_mini = (S) => `
  <g transform="translate(400 200) scale(0.33)">${DESIGNS.admitOne(S)}</g>`;
DESIGNS.leg_byol = (S) => `
  <g data-stack="6">
    ${T(`class="fit" data-w="260" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`, 'B.Y.O.L.')}
    <rect x="470" y="0" width="260" height="8" fill="${S.accent}"/>
  </g>`;
DESIGNS.sleeve_strip = (S) => `
  <g transform="translate(600 900) rotate(-90)">
    ${T(`x="0" y="0" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="34" letter-spacing="14" fill="${S.P}"`, 'BRING YOUR OWN LATINA')}
    <rect x="-470" y="-52" width="14" height="70" fill="${S.accent}"/><rect x="456" y="-52" width="14" height="70" fill="${S.accent}"/>
  </g>`;


// ---- streetwear set: heavier treatments for hoodie backs ----
// worn-print mask (fractal noise thresholded to specks), chrome gradient, glow
function fxDefs(S, seed = 3) {
  return `<defs>
    <filter id="noiseF" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.035 0.05" numOctaves="4" seed="${seed}" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 3.4 -1.05" result="m"/>
      <feComponentTransfer><feFuncA type="linear" slope="1"/></feComponentTransfer>
    </filter>
    <mask id="worn"><rect x="-50" y="0" width="1300" height="1800" fill="#fff"/><rect x="-50" y="0" width="1300" height="1800" filter="url(#noiseF)" fill="#000"/></mask>
    <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.42" stop-color="#d9dde4"/><stop offset="0.5" stop-color="#5b6170"/>
      <stop offset="0.56" stop-color="#eef1f5"/><stop offset="0.8" stop-color="#b9c0cc"/><stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="18"/></filter>
    <radialGradient id="fade" cx="0.5" cy="0.5" r="0.5"><stop offset="0.55" stop-color="${S.P}" stop-opacity="1"/><stop offset="1" stop-color="${S.P}" stop-opacity="0"/></radialGradient>
  </defs>`;
}
function sunburst(cx, cy, r, n, col) {
  let s = `<g transform="translate(${cx} ${cy})">`;
  for (let i = 0; i < n; i++) {
    const a = (360 / n) * i, w = (180 / n) * 0.55;
    s += `<path d="M0 0 L${r * Math.sin(((a - w) * Math.PI) / 180)} ${-r * Math.cos(((a - w) * Math.PI) / 180)} L${r * Math.sin(((a + w) * Math.PI) / 180)} ${-r * Math.cos(((a + w) * Math.PI) / 180)} Z" fill="${col}"/>`;
  }
  return s + '</g>';
}
// tattoo-style rose: rings of cupped, outlined, overlapping petals around a spiral bud
function rose(cx, cy, r, fill, dark, line) {
  const petal = (w, h) => `M0 0 C${-w} ${-h * 0.35} ${-w * 1.1} ${-h * 0.85} ${-w * 0.3} ${-h} C${-w * 0.05} ${-h * 1.05} ${w * 0.05} ${-h * 1.05} ${w * 0.3} ${-h} C${w * 1.1} ${-h * 0.85} ${w} ${-h * 0.35} 0 0 Z`;
  const rings = [
    { n: 7, h: 1.0, w: 0.62, off: 0, col: fill },
    { n: 6, h: 0.74, w: 0.52, off: 30, col: fill },
    { n: 5, h: 0.5, w: 0.42, off: 10, col: dark === '#7A0F16' ? '#C81E2C' : fill },
  ];
  let s = `<g transform="translate(${cx} ${cy})">`;
  for (const R of rings) {
    for (let i = 0; i < R.n; i++) {
      const a = (360 / R.n) * i + R.off, w = r * R.w, h = r * R.h;
      s += `<g transform="rotate(${a})"><path d="${petal(w, h)}" fill="${R.col}" stroke="${line}" stroke-width="7" stroke-linejoin="round"/>
        <path d="M${-w * 0.45} ${-h * 0.3} C${-w * 0.6} ${-h * 0.55} ${-w * 0.55} ${-h * 0.8} ${-w * 0.3} ${-h * 0.92}" fill="none" stroke="${dark}" stroke-width="6" stroke-linecap="round"/></g>`;
    }
  }
  s += `<circle r="${r * 0.22}" fill="${dark}" stroke="${line}" stroke-width="6"/>
    <path d="M0 0 c 6 -4 12 2 8 8 c -5 7 -16 4 -16 -5 c 1 -12 17 -16 25 -6 c 8 11 -2 27 -16 24" fill="none" stroke="${line}" stroke-width="5" stroke-linecap="round" transform="scale(${r / 120})"/>`;
  return s + '</g>';
}
function roseLeaf(x, y, len, angle, fill, line) {
  return `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M0 0 C${len * 0.3} ${-len * 0.42}, ${len * 0.75} ${-len * 0.3}, ${len} 0 C${len * 0.75} ${len * 0.3}, ${len * 0.3} ${len * 0.42}, 0 0 Z" fill="${fill}" stroke="${line}" stroke-width="7" stroke-linejoin="round"/><path d="M${len * 0.1} 0 L${len * 0.9} 0" stroke="${line}" stroke-width="5" stroke-linecap="round"/></g>`;
}
function drips(x0, x1, y, col, seed = 1) {
  let s = '', r = seed;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let x = x0 + 18; x < x1 - 18; x += 34 + rnd() * 40) {
    const len = 30 + rnd() * 150, w = 16 + rnd() * 16;
    s += `<path d="M${x - w / 2} ${y - 2} V${y + len - w / 2} A${w / 2} ${w / 2} 0 0 0 ${x + w / 2} ${y + len - w / 2} V${y - 2} Z" fill="${col}"/>`;
  }
  return s;
}
const fat = (S, sw, extra = '') => `font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="${sw}" stroke-linejoin="round" paint-order="stroke" ${extra}`;

DESIGNS.sw_rose_arch = (S) => {
  const line = S.name === 'light-ink' ? '#000000' : '#121212';
  const rosefill = S.name === 'light-ink' ? '#E8323F' : '#D7262F', rosedark = '#7A0F16', leaf = S.name === 'light-ink' ? '#2F7A3C' : '#2A6A36';
  return `${fxDefs(S, 5)}
  <defs><path id="archTop" d="M 60 700 A 600 600 0 0 1 1140 700"/></defs>
  <g mask="url(#worn)">
    <text ${fat(S, 10)} font-size="138" letter-spacing="3" transform="translate(7 7)" fill="${S.accent}" stroke="${S.accent}"><textPath href="#archTop" startOffset="50%" text-anchor="middle">BRING YOUR OWN</textPath></text>
    <text ${fat(S, 10)} font-size="138" letter-spacing="3"><textPath href="#archTop" startOffset="50%" text-anchor="middle">BRING YOUR OWN</textPath></text>
    ${roseLeaf(470, 790, 230, 200, leaf, line)}${roseLeaf(730, 790, 230, -20, leaf, line)}${roseLeaf(500, 840, 170, 225, leaf, line)}${roseLeaf(700, 840, 170, -45, leaf, line)}
    ${rose(600, 700, 230, rosefill, rosedark, line)}
    ${sparkle(250, 620, 26, S.P)}${sparkle(950, 620, 26, S.P)}${sparkle(300, 930, 18, S.P)}${sparkle(900, 930, 18, S.P)}
    <text x="609" y="1279" text-anchor="middle" font-size="330" ${fat(S, 22)} fill="${S.accent}" stroke="${S.accent}">LATINA</text>
    <text x="600" y="1270" text-anchor="middle" font-size="330" ${fat(S, 22)}>LATINA</text>
    <rect x="130" y="1292" width="940" height="26" fill="${S.accent}"/>
    ${drips(130, 1070, 1316, S.accent, 11)}
    <text x="600" y="1500" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="34" letter-spacing="16" fill="${S.P}">NO EXCEPTIONS  ·  B.Y.O.L.</text>
  </g>`;
};

DESIGNS.sw_calavera_sunburst = (S) => {
  const line = S.name === 'light-ink' ? '#000000' : '#121212';
  const bone = S.name === 'light-ink' ? '#FFFFFF' : '#F7F3EA';
  const eye = (cx, cy) => {
    let s = '';
    for (let i = 0; i < 14; i++) s += `<ellipse cx="0" cy="-84" rx="17" ry="26" fill="${bone}" stroke="${line}" stroke-width="6" transform="translate(${cx} ${cy}) rotate(${(360 / 14) * i})"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="72" fill="${line}"/><circle cx="${cx}" cy="${cy}" r="72" fill="none" stroke="${bone}" stroke-width="6"/><circle cx="${cx}" cy="${cy}" r="52" fill="none" stroke="${bone}" stroke-width="4" stroke-dasharray="6 8"/>`;
    return s;
  };
  const skull = 'M0,-320 C190,-320 300,-200 300,-60 C300,40 262,92 236,122 C220,160 226,200 200,242 C170,292 110,322 0,322 C-110,322 -170,292 -200,242 C-226,200 -220,160 -236,122 C-262,92 -300,40 -300,-60 C-300,-200 -190,-320 0,-320 Z';
  let teeth = `<rect x="-118" y="152" width="236" height="82" rx="26" fill="${bone}" stroke="${line}" stroke-width="7"/>`;
  for (const x of [-84, -56, -28, 0, 28, 56, 84]) teeth += `<line x1="${x}" y1="156" x2="${x}" y2="230" stroke="${line}" stroke-width="6"/>`;
  teeth += `<line x1="-114" y1="193" x2="114" y2="193" stroke="${line}" stroke-width="6"/>`;
  const swirl = (sx) => `<path d="M${sx * 48},-236 C${sx * 104},-254 ${sx * 150},-218 ${sx * 118},-194 C${sx * 102},-182 ${sx * 82},-196 ${sx * 94},-210" fill="none" stroke="${line}" stroke-width="9" stroke-linecap="round"/>`;
  const diamond = (x, y, s) => `<rect x="${x - s}" y="${y - s}" width="${2 * s}" height="${2 * s}" fill="${S.accent}" transform="rotate(45 ${x} ${y})"/>`;
  const rosefill = S.name === 'light-ink' ? '#E8323F' : '#D7262F';
  return `${fxDefs(S, 9)}
  <defs><path id="cTop" d="M 95 760 A 505 505 0 0 1 1105 760"/><path id="cBot" d="M 70 760 A 530 530 0 0 0 1130 760"/></defs>
  <g mask="url(#worn)">
    <g opacity="0.92">${sunburst(600, 760, 440, 30, S.P)}</g>
    <circle cx="600" cy="760" r="560" fill="url(#fade)" opacity="0"/>
    <circle cx="600" cy="760" r="430" fill="${S.name === 'light-ink' ? '#000' : '#fff'}" opacity="0.001"/>
    <g transform="translate(600 770) scale(0.92)">
      <path d="${skull}" fill="${bone}" stroke="${line}" stroke-width="9" stroke-linejoin="round"/>
      ${eye(-115, -70)}${eye(115, -70)}
      <path d="M0,22 C22,52 48,58 42,90 C36,110 6,104 0,92 C-6,104 -36,110 -42,90 C-48,58 -22,52 0,22 Z" fill="${line}"/>
      ${teeth}${swirl(1)}${swirl(-1)}
      ${diamond(-206, 80, 14)}${diamond(206, 80, 14)}${diamond(-64, 272, 8)}${diamond(64, 272, 8)}<circle cx="0" cy="288" r="7" fill="${S.accent}"/>
      ${diamond(0, -250, 12)}
    </g>
    <text font-family="${F.cond}" font-weight="bold" font-size="104" letter-spacing="8" fill="${S.P}" stroke="${S.P}" stroke-width="8" paint-order="stroke" stroke-linejoin="round"><textPath href="#cTop" startOffset="50%" text-anchor="middle">BRING YOUR OWN LATINA</textPath></text>
    <text font-family="${F.cond}" font-weight="bold" font-size="96" letter-spacing="12" fill="${S.accent}" stroke="${S.accent}" stroke-width="8" paint-order="stroke" stroke-linejoin="round"><textPath href="#cBot" startOffset="50%" text-anchor="middle">BAILA CON LOS VIVOS</textPath></text>
  </g>`;
};

DESIGNS.sw_chrome_y2k = (S) => {
  const outline = S.name === 'light-ink' ? '#000000' : '#121212';
  return `${fxDefs(S, 2)}
  <g>
    <text x="600" y="820" text-anchor="middle" font-family="${F.cond}" font-weight="bold" font-size="520" fill="${S.magenta}" filter="url(#glow)" opacity="0.9">BYOL</text>
    <text x="600" y="820" text-anchor="middle" font-family="${F.cond}" font-weight="bold" font-size="520" fill="${outline}" stroke="${outline}" stroke-width="44" stroke-linejoin="round" paint-order="stroke"/>
    <text x="600" y="820" text-anchor="middle" font-family="${F.cond}" font-weight="bold" font-size="520" fill="url(#chrome)" stroke="${outline}" stroke-width="30" stroke-linejoin="round" paint-order="stroke">BYOL</text>
    <text x="600" y="820" text-anchor="middle" font-family="${F.cond}" font-weight="bold" font-size="520" fill="none" stroke="#ffffff" stroke-width="6" stroke-linejoin="round" opacity="0.9">BYOL</text>
    ${sparkle(190, 470, 34, '#fff')}${sparkle(1010, 560, 44, '#fff')}${sparkle(250, 930, 24, '#fff')}${sparkle(940, 380, 22, '#fff')}${sparkle(1040, 900, 28, '#fff')}
    <text x="600" y="960" text-anchor="middle" font-family="${F.serif}" font-style="italic" font-weight="bold" font-size="92" fill="${S.P}">bring your own latina</text>
    <text x="600" y="1040" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="30" letter-spacing="16" fill="${S.magenta}">EST. TONIGHT  ·  NO EXCEPTIONS</text>
  </g>`;
};

DESIGNS.sw_drip_stack = (S) => `${fxDefs(S, 4)}
  <g mask="url(#worn)">
    <text x="600" y="0" text-anchor="middle" class="fit" data-w="1000" ${fat(S, 18)} transform="translate(0 420)">BRING</text>
    <text x="600" y="0" text-anchor="middle" class="fit" data-w="1000" ${fat(S, 14)} transform="translate(0 640)">YOUR OWN</text>
    <text x="611" y="0" text-anchor="middle" class="fit" data-w="1000" font-family="${F.cond}" font-weight="bold" fill="${S.accent}" stroke="${S.accent}" stroke-width="18" stroke-linejoin="round" paint-order="stroke" transform="translate(0 931)">LATINA</text>
    <text x="600" y="0" text-anchor="middle" class="fit" data-w="1000" ${fat(S, 18)} transform="translate(0 920)">LATINA</text>
    <rect x="100" y="946" width="1000" height="30" fill="${S.accent}"/>
    ${drips(100, 1100, 976, S.accent, 23)}
    <text x="600" y="1230" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="36" letter-spacing="18" fill="${S.P}">B.Y.O.L.  ·  NO EXCEPTIONS</text>
  </g>`;


// heavier vintage distress: large worn patches + fine specks
function wornDefs(seed = 3, patch = -3.1, speck = -2.0) {
  return `<defs>
    <filter id="wornBig" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.010 0.018" numOctaves="3" seed="${seed}"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 6 ${patch}"/></filter>
    <filter id="wornSpeck" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.55 0.7" numOctaves="2" seed="${seed + 7}"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 5 ${speck}"/></filter>
    <mask id="worn2"><rect x="-50" y="0" width="1300" height="1800" fill="#fff"/><rect x="-50" y="0" width="1300" height="1800" filter="url(#wornBig)" fill="#000"/><rect x="-50" y="0" width="1300" height="1800" filter="url(#wornSpeck)" fill="#000"/></mask>
  </defs>`;
}
F.script = 'TeX Gyre Chorus';

// Chicano tattoo-flash back: calavera, roses, rays, script banner, aged cream ink
DESIGNS.sw_flash = (S) => {
  const light = S.name === 'light-ink';
  const ink = light ? '#F1E7D3' : '#121212';       // aged cream instead of pure white
  const line = light ? '#000000' : '#121212';
  const bone = light ? '#F1E7D3' : '#FBF7EE';
  const red = light ? '#C9303A' : '#B3232C', redDark = '#5E0B12', leaf = light ? '#3D6B3F' : '#2A5A32';
  const eye = (cx, cy) => {
    let e = '';
    for (let i = 0; i < 14; i++) e += `<ellipse cx="0" cy="-84" rx="17" ry="26" fill="${bone}" stroke="${line}" stroke-width="6" transform="translate(${cx} ${cy}) rotate(${(360 / 14) * i})"/>`;
    e += `<circle cx="${cx}" cy="${cy}" r="72" fill="${line}"/><circle cx="${cx}" cy="${cy}" r="72" fill="none" stroke="${bone}" stroke-width="6"/><circle cx="${cx}" cy="${cy}" r="52" fill="none" stroke="${bone}" stroke-width="4" stroke-dasharray="6 8"/>`;
    return e;
  };
  const skull = 'M0,-320 C190,-320 300,-200 300,-60 C300,40 262,92 236,122 C220,160 226,200 200,242 C170,292 110,322 0,322 C-110,322 -170,292 -200,242 C-226,200 -220,160 -236,122 C-262,92 -300,40 -300,-60 C-300,-200 -190,-320 0,-320 Z';
  let teeth = `<rect x="-118" y="152" width="236" height="82" rx="26" fill="${bone}" stroke="${line}" stroke-width="7"/>`;
  for (const x of [-84, -56, -28, 0, 28, 56, 84]) teeth += `<line x1="${x}" y1="156" x2="${x}" y2="230" stroke="${line}" stroke-width="6"/>`;
  teeth += `<line x1="-114" y1="193" x2="114" y2="193" stroke="${line}" stroke-width="6"/>`;
  const swirl = (sx) => `<path d="M${sx * 48},-236 C${sx * 104},-254 ${sx * 150},-218 ${sx * 118},-194 C${sx * 102},-182 ${sx * 82},-196 ${sx * 94},-210" fill="none" stroke="${line}" stroke-width="9" stroke-linecap="round"/>`;
  const heart = (x, y, sz, col) => `<path transform="translate(${x} ${y}) scale(${sz / 40})" d="M0 14 C -22 -4 -20 -30 -2 -30 C 4 -30 8 -26 0 -18 C -8 -26 -4 -30 2 -30 C 20 -30 22 -4 0 14 Z" fill="${col}"/>`;
  const web = (cx, cy, r, flip) => { // spider-web corner, classic flash filler
    let w = `<g transform="translate(${cx} ${cy}) scale(${flip} 1)">`;
    for (let i = 0; i <= 5; i++) { const a = (i * 90) / 5 * Math.PI / 180; w += `<line x1="0" y1="0" x2="${r * Math.cos(a)}" y2="${r * Math.sin(a)}" stroke="${ink}" stroke-width="4"/>`; }
    for (let k = 1; k <= 4; k++) { const rr = (r * k) / 4; let d = ''; for (let i = 0; i <= 5; i++) { const a = (i * 90) / 5 * Math.PI / 180, a2 = ((i + 0.5) * 90) / 5 * Math.PI / 180; d += (i === 0 ? 'M' : ` Q${rr * 0.86 * Math.cos(a2)} ${rr * 0.86 * Math.sin(a2)} `) + `${rr * Math.cos(a)} ${rr * Math.sin(a)}`; } w += `<path d="${d}" fill="none" stroke="${ink}" stroke-width="4"/>`; }
    return w + '</g>';
  };
  return `${wornDefs(11)}
  <defs><path id="fTop" d="M 90 780 A 510 510 0 0 1 1110 780"/></defs>
  <g mask="url(#worn2)">
    ${web(20, 150, 235, 1)}${web(1180, 150, 235, -1)}
    <g opacity="0.55">${sunburst(600, 740, 470, 36, ink)}</g>
    <g transform="translate(600 730) scale(0.9)">
      <path d="${skull}" fill="${bone}" stroke="${line}" stroke-width="9" stroke-linejoin="round"/>
      ${eye(-115, -70)}${eye(115, -70)}
      <path d="M0,22 C22,52 48,58 42,90 C36,110 6,104 0,92 C-6,104 -36,110 -42,90 C-48,58 -22,52 0,22 Z" fill="${line}"/>
      ${teeth}${swirl(1)}${swirl(-1)}
      ${heart(-205, 80, 30, red)}${heart(205, 80, 30, red)}${heart(0, -252, 26, red)}
      <circle cx="-64" cy="272" r="7" fill="${red}"/><circle cx="64" cy="272" r="7" fill="${red}"/><circle cx="0" cy="290" r="7" fill="${red}"/>
    </g>
    ${roseLeaf(250, 1080, 170, 205, leaf, line)}${roseLeaf(950, 1080, 170, -25, leaf, line)}${roseLeaf(400, 1180, 150, 150, leaf, line)}${roseLeaf(800, 1180, 150, 30, leaf, line)}
    ${rose(330, 1040, 150, red, redDark, line)}${rose(870, 1040, 150, red, redDark, line)}
    ${ribbon(600, 1215, 760, 104, ink, 'bring your own latina', F.script, 78, 2)}
    <text font-family="${F.cond}" font-weight="bold" font-size="92" letter-spacing="10" fill="${ink}" stroke="${ink}" stroke-width="8" paint-order="stroke" stroke-linejoin="round"><textPath href="#fTop" startOffset="50%" text-anchor="middle">DANCE PARTNER NOT INCLUDED</textPath></text>
    ${sparkle(150, 700, 26, ink)}${sparkle(1050, 700, 26, ink)}${sparkle(215, 900, 18, ink)}${sparkle(985, 900, 18, ink)}${sparkle(600, 1330, 16, ink)}
    <text x="600" y="1400" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="34" letter-spacing="16" fill="${red}">EST. TONIGHT  ·  NO EXCEPTIONS</text>
  </g>`;
};

// neon-sign script back (black garments): tube stroke + layered glow
DESIGNS.sw_neon = (S) => {
  const tube = S.magenta, core = '#FFE3F3', white = '#FFFFFF';
  const neon = (txt, x, y, fs, col = tube) => `
    <text x="${x}" y="${y}" text-anchor="middle" font-family="${F.script}" font-size="${fs}" fill="none" stroke="${col}" stroke-width="46" stroke-linejoin="round" stroke-linecap="round" filter="url(#g40)" opacity="0.55">${esc(txt)}</text>
    <text x="${x}" y="${y}" text-anchor="middle" font-family="${F.script}" font-size="${fs}" fill="none" stroke="${col}" stroke-width="24" stroke-linejoin="round" stroke-linecap="round" filter="url(#g14)" opacity="0.85">${esc(txt)}</text>
    <text x="${x}" y="${y}" text-anchor="middle" font-family="${F.script}" font-size="${fs}" fill="none" stroke="${col}" stroke-width="15" stroke-linejoin="round" stroke-linecap="round">${esc(txt)}</text>
    <text x="${x}" y="${y}" text-anchor="middle" font-family="${F.script}" font-size="${fs}" fill="none" stroke="${core}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${esc(txt)}</text>`;
  const neonRose = (cx, cy, r) => {
    const petal = (w, h) => `M0 0 C${-w} ${-h * 0.35} ${-w * 1.1} ${-h * 0.85} ${-w * 0.3} ${-h} C${-w * 0.05} ${-h * 1.05} ${w * 0.05} ${-h * 1.05} ${w * 0.3} ${-h} C${w * 1.1} ${-h * 0.85} ${w} ${-h * 0.35} 0 0 Z`;
    let paths = '';
    for (let i = 0; i < 6; i++) paths += `<path d="${petal(r * 0.6, r)}" transform="rotate(${i * 60})"/>`;
    for (let i = 0; i < 5; i++) paths += `<path d="${petal(r * 0.34, r * 0.56)}" transform="rotate(${i * 72 + 36})"/>`;
    paths += `<circle r="${r * 0.16}"/>`;
    const layer = (col, sw, extra = '') => `<g transform="translate(${cx} ${cy})" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round" ${extra}>${paths}</g>`;
    return layer(tube, 40, 'filter="url(#g40)" opacity="0.5"') + layer(tube, 20, 'filter="url(#g14)" opacity="0.85"') + layer(tube, 12) + layer(core, 4);
  };
  return `<defs>
    <filter id="g40" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="30"/></filter>
    <filter id="g14" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="11"/></filter>
  </defs>
  <g>
    ${neonRose(600, 420, 190)}
    ${neon('bring your own', 600, 820, 170)}
    ${neon('latina', 600, 1090, 300)}
    <g opacity="0.9">
      <text x="600" y="1230" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="36" letter-spacing="18" fill="none" stroke="${white}" stroke-width="10" filter="url(#g14)" opacity="0.6">OPEN ALL NIGHT · NO EXCEPTIONS</text>
      <text x="600" y="1230" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="36" letter-spacing="18" fill="${white}">OPEN ALL NIGHT · NO EXCEPTIONS</text>
    </g>
  </g>`;
};


// ---- flag line: a waving country flag with the demonym across it; the brand stays small ----
const FLAGS = {
  latina:       { word: 'LATINA',       kind: 'h', stripes: [['#F1E7D3', 1], ['#E63946', 1], ['#F1E7D3', 1]] },
  mexicana:     { word: 'MEXICANA',     kind: 'v', stripes: [['#006847', 1], ['#FFFFFF', 1], ['#CE1126', 1]] },
  boricua:      { word: 'BORICUA',      kind: 'tri', stripes: [['#E31B23', 1], ['#FFFFFF', 1], ['#E31B23', 1], ['#FFFFFF', 1], ['#E31B23', 1]], tri: '#0050F0', star: '#FFFFFF' },
  cubana:       { word: 'CUBANA',       kind: 'tri', stripes: [['#002A8F', 1], ['#FFFFFF', 1], ['#002A8F', 1], ['#FFFFFF', 1], ['#002A8F', 1]], tri: '#CF142B', star: '#FFFFFF' },
  dominicana:   { word: 'DOMINICANA',   kind: 'cross', blue: '#002D62', red: '#CE1126' },
  colombiana:   { word: 'COLOMBIANA',   kind: 'h', stripes: [['#FCD116', 2], ['#003893', 1], ['#CE1126', 1]] },
  venezolana:   { word: 'VENEZOLANA',   kind: 'h', stripes: [['#FFCC00', 1], ['#00247D', 1], ['#CF142B', 1]], starsArc: 8 },
  salvadorena:  { word: 'SALVADOREÑA',  kind: 'h', stripes: [['#0F47AF', 1], ['#FFFFFF', 1], ['#0F47AF', 1]] },
  guatemalteca: { word: 'GUATEMALTECA', kind: 'v', stripes: [['#4997D0', 1], ['#FFFFFF', 1], ['#4997D0', 1]] },
  hondurena:    { word: 'HONDUREÑA',    kind: 'h', stripes: [['#00BCE4', 1], ['#FFFFFF', 1], ['#00BCE4', 1]], starsX: '#00BCE4' },
  peruana:      { word: 'PERUANA',      kind: 'v', stripes: [['#D91023', 1], ['#FFFFFF', 1], ['#D91023', 1]] },
  ecuatoriana:  { word: 'ECUATORIANA',  kind: 'h', stripes: [['#FFDD00', 2], ['#034EA2', 1], ['#ED1C24', 1]] },
  argentina:    { word: 'ARGENTINA',    kind: 'h', stripes: [['#74ACDF', 1], ['#FFFFFF', 1], ['#74ACDF', 1]], sun: '#F6B40E' },
  chilena:      { word: 'CHILENA',      kind: 'chile', red: '#D52B1E', blue: '#0039A6' },
  brasilena:    { word: 'BRASILEÑA',    kind: 'brazil', green: '#009C3B', yellow: '#FFDF00', blue: '#002776' },
  panamena:     { word: 'PANAMEÑA',     kind: 'panama', red: '#DA121A', blue: '#005293' },
  nica:         { word: 'NICARAGÜENSE', kind: 'h', stripes: [['#0067C6', 1], ['#FFFFFF', 1], ['#0067C6', 1]] },
  tica:         { word: 'COSTARRICENSE', kind: 'h', stripes: [['#002B7F', 1], ['#FFFFFF', 1], ['#CE1126', 2], ['#FFFFFF', 1], ['#002B7F', 1]] },
};
function star5(cx, cy, r, col) {
  let pts = '';
  for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.42 : r, a = (Math.PI / 5) * i - Math.PI / 2; pts += `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)} `; }
  return `<polygon points="${pts}" fill="${col}"/>`;
}
function wavingFlag(def, W, H) {
  const A = 30, wave = (x) => A * Math.sin((2 * Math.PI * x) / (W * 1.05) - 0.6);
  const N = 48;
  // polygon for the region x0..x1, y0..y1 with every edge following the wave
  const band = (x0, x1, y0, y1, col) => {
    let d = '';
    for (let i = 0; i <= N; i++) { const x = x0 + ((x1 - x0) * i) / N; d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${(y0 + wave(x)).toFixed(1)} `; }
    for (let i = N; i >= 0; i--) { const x = x0 + ((x1 - x0) * i) / N; d += `L${x.toFixed(1)} ${(y1 + wave(x)).toFixed(1)} `; }
    return `<path d="${d}Z" fill="${col}"/>`;
  };
  let g = '';
  const total = (arr) => arr.reduce((a, s) => a + s[1], 0);
  if (def.kind === 'h' || def.kind === 'tri') {
    let y = 0; const T = total(def.stripes);
    for (const [col, w] of def.stripes) { const h = (H * w) / T; g += band(0, W, y, y + h, col); y += h; }
  } else if (def.kind === 'v') {
    let x = 0; const T = total(def.stripes);
    for (const [col, w] of def.stripes) { const ww = (W * w) / T; g += band(x, x + ww, 0, H, col); x += ww; }
  } else if (def.kind === 'cross') {
    g += band(0, W, 0, H, '#FFFFFF');
    const cw = W * 0.135, ch = H * 0.135, mx = W / 2, my = H / 2;
    g += band(0, mx - cw / 2, 0, my - ch / 2, def.blue) + band(mx + cw / 2, W, 0, my - ch / 2, def.red);
    g += band(0, mx - cw / 2, my + ch / 2, H, def.red) + band(mx + cw / 2, W, my + ch / 2, H, def.blue);
  } else if (def.kind === 'chile') {
    g += band(0, W, 0, H / 2, '#FFFFFF') + band(0, W, H / 2, H, def.red) + band(0, W / 3, 0, H / 2, def.blue);
    g += `<g transform="translate(0 ${wave(W / 6).toFixed(1)})">${star5(W / 6, H / 4, H * 0.13, '#FFFFFF')}</g>`;
  } else if (def.kind === 'brazil') {
    g += band(0, W, 0, H, def.green);
    const cx = W / 2, cy = H / 2, rx = W * 0.42, ry = H * 0.42, dy = wave(cx);
    g += `<polygon points="${cx - rx},${cy + dy} ${cx},${cy - ry + dy} ${cx + rx},${cy + dy} ${cx},${cy + ry + dy}" fill="${def.yellow}"/><circle cx="${cx}" cy="${cy + dy}" r="${H * 0.26}" fill="${def.blue}"/><path d="M${cx - H * 0.24} ${cy + dy + 10} Q${cx} ${cy + dy - 60} ${cx + H * 0.24} ${cy + dy + 20}" stroke="#FFFFFF" stroke-width="${H * 0.04}" fill="none"/>`;
  } else if (def.kind === 'panama') {
    g += band(0, W / 2, 0, H / 2, '#FFFFFF') + band(W / 2, W, 0, H / 2, def.red) + band(0, W / 2, H / 2, H, def.blue) + band(W / 2, W, H / 2, H, '#FFFFFF');
    g += `<g transform="translate(0 ${wave(W / 4).toFixed(1)})">${star5(W / 4, H / 4, H * 0.12, def.blue)}</g><g transform="translate(0 ${wave((3 * W) / 4).toFixed(1)})">${star5((3 * W) / 4, (3 * H) / 4, H * 0.12, def.red)}</g>`;
  }
  if (def.kind === 'tri') {
    const ax = H * 0.75;
    g += `<polygon points="0,${wave(0).toFixed(1)} ${ax.toFixed(1)},${(H / 2 + wave(ax)).toFixed(1)} 0,${(H + wave(0)).toFixed(1)}" fill="${def.tri}"/>`;
    g += `<g transform="translate(0 ${wave(ax * 0.36).toFixed(1)})">${star5(ax * 0.36, H / 2, H * 0.14, def.star)}</g>`;
  }
  if (def.starsArc) {
    for (let i = 0; i < def.starsArc; i++) { const a = Math.PI + (Math.PI * (i + 0.5)) / def.starsArc, x = W / 2 + W * 0.2 * Math.cos(a), y = H * 0.62 + H * 0.19 * Math.sin(a); g += `<g transform="translate(0 ${wave(x).toFixed(1)})">${star5(x, y, H * 0.03, '#FFFFFF')}</g>`; }
  }
  if (def.starsX) {
    const pts = [[W / 2, H / 2], [W / 2 - W * 0.09, H * 0.42], [W / 2 + W * 0.09, H * 0.42], [W / 2 - W * 0.09, H * 0.58], [W / 2 + W * 0.09, H * 0.58]];
    for (const [x, y] of pts) g += `<g transform="translate(0 ${wave(x).toFixed(1)})">${star5(x, y, H * 0.035, def.starsX)}</g>`;
  }
  if (def.sun) {
    const cx = W / 2, cy = H / 2 + wave(W / 2);
    g += sunburst(cx, cy, H * 0.16, 16, def.sun) + `<circle cx="${cx}" cy="${cy}" r="${H * 0.09}" fill="${def.sun}"/>`;
  }
  // fold shading and outline
  const fid = id('folds');
  g += `<defs><linearGradient id="${fid}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0.10"/><stop offset="0.14" stop-color="#000" stop-opacity="0"/><stop offset="0.28" stop-color="#000" stop-opacity="0.22"/>
      <stop offset="0.42" stop-color="#fff" stop-opacity="0.08"/><stop offset="0.56" stop-color="#000" stop-opacity="0"/><stop offset="0.72" stop-color="#000" stop-opacity="0.22"/>
      <stop offset="0.86" stop-color="#fff" stop-opacity="0.06"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/></linearGradient></defs>`;
  g += band(0, W, 0, H, `url(#${fid})`);
  g += band(0, W, 0, H, 'none').replace('fill="none"', 'fill="none" stroke="#000" stroke-width="8" stroke-linejoin="round"');
  return `<g>${g}</g>`;
}
for (const [code, def] of Object.entries(FLAGS)) {
  DESIGNS[`flag_${code}`] = (S) => {
    const W = 1000, H = 620, ink = S.name === 'light-ink' ? '#F1E7D3' : '#121212';
    return `${wornDefs(17, -3.3, -2.3)}
    <g mask="url(#worn2)">
      <text x="600" y="330" text-anchor="middle" font-family="${F.script}" font-size="150" fill="${ink}" stroke="${ink}" stroke-width="3">bring your own</text>
      <g transform="translate(100 420)">${wavingFlag(def, W, H)}</g>
      <g transform="rotate(-3 600 740)">
        <text x="600" y="0" text-anchor="middle" class="fit" data-w="${def.word.length > 10 ? 900 : 820}" font-family="${F.cond}" font-weight="bold" fill="#000" stroke="#000" stroke-width="44" stroke-linejoin="round" paint-order="stroke" transform="translate(0 800)">${def.word}</text>
        <text x="600" y="0" text-anchor="middle" class="fit" data-w="${def.word.length > 10 ? 900 : 820}" font-family="${F.cond}" font-weight="bold" fill="#FFFFFF" stroke="#000" stroke-width="18" stroke-linejoin="round" paint-order="stroke" transform="translate(0 800)">${def.word}</text>
      </g>
      <text x="600" y="1160" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="30" letter-spacing="14" fill="${ink}">BRING YOUR OWN LATINA</text>
    </g>`;
  };
}


// ---- flag line v2: front = brand text over a bar split into the flag colors; back = the flag with the demonym under it ----
function flagBarColors(def) {
  if (def.kind === 'h' || def.kind === 'v') return def.stripes.map(([c, w]) => [c, w]);
  if (def.kind === 'tri') return [[def.stripes[0][0], 1], ['#FFFFFF', 1], [def.tri, 1]];
  if (def.kind === 'cross') return [[def.blue, 1], ['#FFFFFF', 1], [def.red, 1]];
  if (def.kind === 'chile') return [[def.blue, 1], ['#FFFFFF', 1], [def.red, 1]];
  if (def.kind === 'brazil') return [[def.green, 1], [def.yellow, 1], [def.blue, 1]];
  if (def.kind === 'panama') return [[def.blue, 1], ['#FFFFFF', 1], [def.red, 1]];
  return [['#FFFFFF', 1]];
}
for (const [code, def] of Object.entries(FLAGS)) {
  DESIGNS[`fl2_front_${code}`] = (S) => {
    const cols = flagBarColors(def), total = cols.reduce((a, c) => a + c[1], 0);
    let x = 0, bar = '';
    for (const [c, w] of cols) { const ww = (380 * w) / total; bar += `<rect x="${410 + x}" y="0" width="${ww}" height="16" fill="${c === '#FFFFFF' ? (S.name === 'light-ink' ? '#FFFFFF' : '#FFFFFF') : c}" stroke="${S.name === 'dark-ink' && c === '#FFFFFF' ? '#121212' : 'none'}" stroke-width="2"/>`; x += ww; }
    return `<g data-stack="14">
      ${T(`class="fit" data-w="380" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="2" stroke-linejoin="round" paint-order="stroke"`, 'BRING YOUR OWN LATINA')}
      <g>${bar}</g>
    </g>`;
  };
  DESIGNS[`fl2_back_${code}`] = (S) => `
    <g data-stack="70">
      <g>${wavingFlag(def, 1000, 620)}</g>
      ${T(`class="fit" data-w="${def.word.length > 10 ? 900 : 760}" x="600" y="0" text-anchor="middle" font-family="${F.cond}" font-weight="bold" fill="${S.P}" stroke="${S.P}" stroke-width="10" stroke-linejoin="round" paint-order="stroke"`, def.word)}
    </g>`;
}

// front words for the holiday line: the word in a warm italic serif with one marigold accent
for (const word of ['bachata', 'salsa', 'cumbia', 'merengue', 'reggaeton']) {
  DESIGNS[`hol_front_${word}`] = (S) => `
    <g data-stack="14">
      ${T(`id="fw" class="fit" data-w="440" x="600" y="0" text-anchor="middle" font-family="${F.serif}" font-style="italic" font-weight="bold" fill="${S.P}"`, word)}
      ${T(`x="600" y="0" text-anchor="middle" font-family="${F.geo}" font-weight="bold" font-size="20" letter-spacing="9" fill="${S.P}"`, 'DÍA DE MUERTOS  ·  B.Y.O.L.')}
    </g>
    <g data-attach="fw:tl">${marigold(-34, 8, 30, S.marigold, 10)}</g>`;
}

// ---------- page template + in-page layout script ----------
function pageHtml(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:transparent}
    svg{display:block}
  </style></head><body>
  <svg id="art" xmlns="http://www.w3.org/2000/svg" width="1300" height="1800" viewBox="-50 0 1300 1800">${inner}</svg>
  </body></html>`;
}

const LAYOUT_SCRIPT = () => {
  const svg = document.getElementById('art');
  const cv = document.createElement('canvas').getContext('2d');
  // tight ink bounds: SVG getBBox() on text returns the whole em box, which leaves huge gaps
  const tight = (el) => {
    if (el.tagName === 'text' && !el.querySelector('textPath')) {
      const cs = getComputedStyle(el);
      cv.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = cv.measureText(el.textContent);
      const bb = el.getBBox();
      const baseline = parseFloat(el.getAttribute('y') || '0');
      const sw = parseFloat(el.getAttribute('stroke-width') || '0') / 2;
      return { x: bb.x - sw, y: baseline - m.actualBoundingBoxAscent - sw, width: bb.width + 2 * sw, height: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + 2 * sw };
    }
    return el.getBBox();
  };
  // 1) fit text to width
  svg.querySelectorAll('text.fit').forEach((t) => {
    const target = parseFloat(t.dataset.w);
    let fs = 100;
    t.setAttribute('font-size', fs);
    const w = t.getComputedTextLength();
    fs = (fs * target) / w;
    t.setAttribute('font-size', fs.toFixed(2));
  });
  // 2) stack children vertically
  svg.querySelectorAll('[data-stack]').forEach((g) => {
    const gap = parseFloat(g.dataset.stack);
    let y = g.dataset.top ? parseFloat(g.dataset.top) : 120;
    Array.from(g.children).forEach((c) => {
      if (c.tagName === 'defs') return;
      const b = tight(c);
      const prev = c.getAttribute('transform') || '';
      c.setAttribute('transform', `translate(0 ${(y - b.y).toFixed(2)}) ${prev}`);
      const after = c.dataset.gap !== undefined ? parseFloat(c.dataset.gap) : gap;
      y += b.height + after;
    });
  });
  // union of tight child boxes (with their stacking translate) for a group
  const groupTight = (g) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    Array.from(g.children).forEach((c) => {
      if (c.tagName === 'defs') return;
      const b = tight(c);
      const mt = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(c.getAttribute('transform') || '');
      const dx = mt ? parseFloat(mt[1]) : 0, dy = mt ? parseFloat(mt[2]) : 0;
      x0 = Math.min(x0, b.x + dx); y0 = Math.min(y0, b.y + dy);
      x1 = Math.max(x1, b.x + b.width + dx); y1 = Math.max(y1, b.y + b.height + dy);
    });
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  };
  // 2b) frames drawn around a group's content: data-frame="id:padX:padY"
  svg.querySelectorAll('[data-frame]').forEach((r) => {
    const [ref, px, py] = r.dataset.frame.split(':').map((v, i) => (i ? parseFloat(v) : v));
    const b = groupTight(document.getElementById(ref));
    r.setAttribute('x', (b.x - px).toFixed(2)); r.setAttribute('y', (b.y - py).toFixed(2));
    r.setAttribute('width', (b.width + 2 * px).toFixed(2)); r.setAttribute('height', (b.height + 2 * py).toFixed(2));
  });
  // 3) attach decorations to a group's corners: data-attach="id:tl|tr|bl|br"
  svg.querySelectorAll('[data-attach]').forEach((el) => {
    const [ref, corner] = el.dataset.attach.split(':');
    const refEl = document.getElementById(ref);
    const b = refEl.tagName === 'text' ? tight(refEl) : refEl.getBBox();
    // getBBox ignores the element's own transform, so add the stacking translate back
    const tr = refEl.getAttribute('transform') || '';
    const mt = /translate\(([-\d.]+)\s+([-\d.]+)\)/.exec(tr);
    const dx = mt ? parseFloat(mt[1]) : 0, dy = mt ? parseFloat(mt[2]) : 0;
    const x = (corner[1] === 'l' ? b.x : b.x + b.width) + dx;
    const y = (corner[0] === 't' ? b.y : b.y + b.height) + dy;
    el.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
  });
  const bb = svg.getBBox();
  return { x: bb.x, y: bb.y, width: bb.width, height: bb.height };
};

async function main() {
  let only = process.argv.slice(2);
  if (only.includes('flagline')) only = only.filter((n) => n !== 'flagline').concat(Object.keys(FLAGS).flatMap((c) => [`fl2_front_${c}`, `fl2_back_${c}`]));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1800 }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  const manifest = [];
  for (const [name, fn] of Object.entries(DESIGNS)) {
    if (only.length && !only.includes(name)) continue;
    for (const [key, S] of Object.entries(SCHEMES)) {
      uid = 0;
      await page.setContent(pageHtml(fn(S)));
      await page.evaluate(() => document.fonts.ready);
      const bbox = await page.evaluate(LAYOUT_SCRIPT);
      const file = path.join(OUT, `${name}__${S.name}.png`);
      await page.locator('#art').screenshot({ path: file, omitBackground: true });
      manifest.push({ name, scheme: S.name, file, bbox });
      console.log('rendered', name, S.name, JSON.stringify(bbox));
    }
  }
  // merge into the existing manifest so partial re-renders keep the rest of the set
  const mf = path.join(OUT, 'manifest.json');
  const prev = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : [];
  const key = (m) => `${m.name}__${m.scheme}`;
  const merged = new Map(prev.map((m) => [key(m), m]));
  manifest.forEach((m) => merged.set(key(m), m));
  fs.writeFileSync(mf, JSON.stringify([...merged.values()], null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
