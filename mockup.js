// Draws hoodie / tee mockups in SVG and places the real print files on them.
// usage: node mockup.js v2 <country>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PRINT = path.join(__dirname, 'print');
const PREV = path.join(__dirname, 'preview');
const uri = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(PRINT, f)).toString('base64');
const size = (f) => { const b = fs.readFileSync(path.join(PRINT, f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };
function place(f, cx, cy, widthIn, ppi) {
  const { w, h } = size(f);
  const W = widthIn * ppi, H = (h / w) * W;
  return `<image href="${uri(f)}" x="${cx - W / 2}" y="${cy - H / 2}" width="${W}" height="${H}"/>`;
}
const G = { fill: '#1b1b1b', seam: '#2a2a2a', rib: '#151515', inside: '#0e0e0e', hi: '#242424' };

function hoodie(view, prints, ppi = 22) {
  const cx = 480, top = 200;
  const bw = 22 * ppi, bl = 28 * ppi;
  const x0 = cx - bw / 2, x1 = cx + bw / 2, hem = top + bl;
  const sleeve = (dir) => {
    const ang = (22 * Math.PI) / 180, L = 24 * ppi, halfShoulder = 3.9 * ppi, halfCuff = 2.1 * ppi;
    const sx = dir < 0 ? x0 + 6 : x1 - 6;
    const A = [sx, top + 4], B = [sx, top + 2 * halfShoulder], M = [sx, top + halfShoulder];
    const u = [dir * Math.sin(ang), Math.cos(ang)], n = [Math.cos(ang), -dir * Math.sin(ang)];
    const E = [M[0] + u[0] * L, M[1] + u[1] * L];
    const P = (base, k) => [base[0] + n[0] * k, base[1] + n[1] * k];
    let C = P(E, -halfCuff), D = P(E, halfCuff);
    if ((dir < 0 && C[0] > D[0]) || (dir > 0 && C[0] < D[0])) [C, D] = [D, C];
    const E2 = [E[0] - u[0] * 1.3 * ppi, E[1] - u[1] * 1.3 * ppi];
    let C2 = P(E2, -halfCuff), D2 = P(E2, halfCuff);
    if ((dir < 0 && C2[0] > D2[0]) || (dir > 0 && C2[0] < D2[0])) [C2, D2] = [D2, C2];
    const pt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    return `<polygon points="${pt(A)} ${pt(C)} ${pt(D)} ${pt(B)}" fill="${G.fill}"/>
      <polygon points="${pt(C2)} ${pt(C)} ${pt(D)} ${pt(D2)}" fill="${G.rib}"/>
      <line x1="${A[0]}" y1="${A[1]}" x2="${C[0]}" y2="${C[1]}" stroke="${G.seam}" stroke-width="3"/>`;
  };
  const body = `<path d="M${x0} ${top} L${x1} ${top} L${x1 + 8} ${hem} L${x0 - 8} ${hem} Z" fill="${G.fill}"/>
    <rect x="${x0 - 8}" y="${hem - 46}" width="${bw + 16}" height="46" fill="${G.rib}"/>
    ${Array.from({ length: 44 }, (_, i) => `<line x1="${x0 - 4 + i * (bw / 44) + 6}" y1="${hem - 42}" x2="${x0 - 4 + i * (bw / 44) + 6}" y2="${hem - 4}" stroke="${G.hi}" stroke-width="2"/>`).join('')}`;
  let hood, extras = '';
  if (view === 'front') {
    hood = `<path d="M${cx - 128} ${top + 14} C${cx - 150} ${top - 110}, ${cx + 150} ${top - 110}, ${cx + 128} ${top + 14} Z" fill="${G.fill}"/>
      <path d="M${cx - 96} ${top + 4} C${cx - 92} ${top + 96}, ${cx + 92} ${top + 96}, ${cx + 96} ${top + 4} C${cx + 50} ${top - 24}, ${cx - 50} ${top - 24}, ${cx - 96} ${top + 4} Z" fill="${G.inside}"/>
      <path d="M${cx - 96} ${top + 4} C${cx - 92} ${top + 96}, ${cx + 92} ${top + 96}, ${cx + 96} ${top + 4}" fill="none" stroke="${G.seam}" stroke-width="6"/>`;
    extras = `<path d="M${cx - 20} ${top + 66} C${cx - 28} ${top + 150}, ${cx - 24} ${top + 200}, ${cx - 26} ${top + 236}" stroke="#3c3c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M${cx + 20} ${top + 66} C${cx + 28} ${top + 150}, ${cx + 24} ${top + 200}, ${cx + 26} ${top + 236}" stroke="#3c3c3c" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M${x0 + 66} ${hem - 62} L${x0 + 66} ${top + 372} L${x0 + 128} ${top + 322} L${x1 - 128} ${top + 322} L${x1 - 66} ${top + 372} L${x1 - 66} ${hem - 62} Z" fill="#1f1f1f" stroke="#343434" stroke-width="4"/>`;
  } else {
    hood = `<path d="M${cx - 128} ${top + 14} C${cx - 165} ${top - 120}, ${cx + 165} ${top - 120}, ${cx + 128} ${top + 14} L${cx + 112} ${top + 104} C${cx + 60} ${top + 140}, ${cx - 60} ${top + 140}, ${cx - 112} ${top + 104} Z" fill="${G.fill}"/>
      <path d="M${cx - 112} ${top + 104} C${cx - 60} ${top + 140}, ${cx + 60} ${top + 140}, ${cx + 112} ${top + 104}" fill="none" stroke="${G.seam}" stroke-width="6"/>
      <line x1="${cx}" y1="${top - 86}" x2="${cx}" y2="${top + 124}" stroke="${G.seam}" stroke-width="5"/>`;
  }
  return `<g>${sleeve(-1)}${sleeve(1)}${body}${hood}${extras}
    <line x1="${x0}" y1="${top}" x2="${x0 - 8}" y2="${hem}" stroke="${G.seam}" stroke-width="3"/>
    <line x1="${x1}" y1="${top}" x2="${x1 + 8}" y2="${hem}" stroke="${G.seam}" stroke-width="3"/>
    ${prints.map((p) => place(p.file, cx + p.dx * ppi, top + p.dy * ppi, p.w, ppi)).join('')}
  </g>`;
}

function tee(view, prints, ppi = 22) {
  const cx = 480, top = 220, bw = 21 * ppi, bl = 28 * ppi;
  const x0 = cx - bw / 2, x1 = cx + bw / 2, hem = top + bl;
  const sleeve = (dir) => {
    const sx = dir < 0 ? x0 : x1;
    return `<polygon points="${sx},${top} ${sx + dir * 7.5 * ppi},${top + 5 * ppi} ${sx + dir * 5.6 * ppi},${top + 9 * ppi} ${sx},${top + 7.5 * ppi}" fill="${G.fill}"/>
      <line x1="${sx + dir * 7.5 * ppi}" y1="${top + 5 * ppi}" x2="${sx + dir * 5.6 * ppi}" y2="${top + 9 * ppi}" stroke="${G.rib}" stroke-width="10"/>`;
  };
  const neck = view === 'front'
    ? `<path d="M${cx - 80} ${top} C${cx - 70} ${top + 80}, ${cx + 70} ${top + 80}, ${cx + 80} ${top}" fill="${G.inside}" stroke="${G.rib}" stroke-width="14"/>`
    : `<path d="M${cx - 80} ${top} C${cx - 70} ${top + 26}, ${cx + 70} ${top + 26}, ${cx + 80} ${top}" fill="${G.inside}" stroke="${G.rib}" stroke-width="14"/>`;
  return `<g>${sleeve(-1)}${sleeve(1)}
    <path d="M${x0} ${top} L${x1} ${top} L${x1 + 4} ${hem} L${x0 - 4} ${hem} Z" fill="${G.fill}"/>${neck}
    <line x1="${x0 - 4}" y1="${hem - 8}" x2="${x1 + 4}" y2="${hem - 8}" stroke="${G.seam}" stroke-width="3"/>
    ${prints.map((p) => place(p.file, cx + p.dx * ppi, top + p.dy * ppi, p.w, ppi)).join('')}
  </g>`;
}

function panel(x, y, label, inner) {
  return `<g transform="translate(${x} ${y})"><rect x="20" y="20" width="920" height="1000" rx="28" fill="#f3f0ea"/>${inner}
    <text x="480" y="1062" text-anchor="middle" font-family="Poppins" font-weight="bold" font-size="26" fill="#333">${label}</text></g>`;
}

async function main() {
  const country = process.argv[3] || 'colombiana';
  const f = `byol_fl2_front_${country}__light-ink.png`, b = `byol_fl2_back_${country}__light-ink.png`;
  const panels = [
    panel(0, 0, 'TEE FRONT  ·  left chest, 3.8 in', tee('front', [{ file: f, dx: 3.6, dy: 6.2, w: 4.2 }])),
    panel(960, 0, 'TEE BACK  ·  flag 11 in', tee('back', [{ file: b, dx: 0, dy: 11, w: 11.4 }])),
    panel(0, 1090, 'HOODIE FRONT  ·  left chest, 3.8 in', hoodie('front', [{ file: f, dx: 4.3, dy: 7.2, w: 4.2 }])),
    panel(960, 1090, 'HOODIE BACK  ·  flag 11 in', hoodie('back', [{ file: b, dx: 0, dy: 13, w: 11.4 }])),
  ];
  const W = 1920, H = 2180, out = `byol_flag_v2_${country}.jpg`;
  const html = `<!doctype html><html><body style="margin:0;background:#e6e2da"><svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${panels.join('')}</svg></body></html>`;
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(PREV, out), type: 'jpeg', quality: 90 });
  await br.close();
  console.log('mockup written', out);
}
main().catch((e) => { console.error(e); process.exit(1); });
