// Pushes the flag line to Printful as sync products (tee + hoodie per country).
// Idempotent: state/products.json remembers what already exists.
// Needs: PRINTFUL_TOKEN (env), and print files reachable at PUBLIC_BASE/print/<file>.png
//   PUBLIC_BASE defaults to the raw GitHub URL of this repo (set in the workflow).
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.PRINTFUL_TOKEN;
const PUBLIC_BASE = process.env.PUBLIC_BASE; // e.g. https://raw.githubusercontent.com/<user>/<repo>/main
const DRY = process.argv.includes('--dry');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').replace('--only=', '');
if (!TOKEN && !DRY) { console.error('PRINTFUL_TOKEN missing'); process.exit(1); }
if (!PUBLIC_BASE && !DRY) { console.error('PUBLIC_BASE missing'); process.exit(1); }

const API = 'https://api.printful.com';
async function pf(method, url, body) {
  const r = await fetch(API + url, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j.result;
}

// garments: Printful catalog product ids. 71 = Bella + Canvas 3001 unisex tee, 146 = Gildan 18500 hoodie.
const GARMENTS = [
  { key: 'tee', productId: 71, color: 'Black', sizes: ['S', 'M', 'L', 'XL', '2XL'], price: '32.00', label: 'Unisex Tee' },
  { key: 'hoodie', productId: 146, color: 'Black', sizes: ['S', 'M', 'L', 'XL', '2XL'], price: '60.00', label: 'Unisex Hoodie' },
];

const listings = JSON.parse(fs.readFileSync(path.join(__dirname, 'listings.json'), 'utf8'));
const STATE = path.join(__dirname, 'state', 'products.json');
fs.mkdirSync(path.dirname(STATE), { recursive: true });
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};

// print placement (Printful DTG area is 1800 x 2400 = 12 x 16 in at 150 dpi)
function pngSize(file) { const b = fs.readFileSync(path.join(__dirname, 'print', file)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; }
function placement(file, kind) {
  const { w, h } = pngSize(file);
  const A = { area_width: 1800, area_height: 2400 };
  if (kind === 'chest') { // left chest, 4.2 in wide incl. padding, wearer's left = right side of the area
    const width = Math.round(4.2 * 150), height = Math.round((h / w) * width);
    return { ...A, width, height, top: 330, left: 1800 - width - 330 };
  }
  const width = Math.round(11.4 * 150), height = Math.round((h / w) * width); // back, 11.4 in
  return { ...A, width, height, top: 220, left: Math.round((1800 - width) / 2) };
}

const variantCache = {};
async function variantIds(g) {
  if (variantCache[g.productId]) return variantCache[g.productId];
  const p = await pf('GET', `/products/${g.productId}`);
  const ids = {};
  for (const v of p.variants) if (v.color === g.color && g.sizes.includes(v.size)) ids[v.size] = v.id;
  const missing = g.sizes.filter((s) => !ids[s]);
  if (missing.length) throw new Error(`product ${g.productId}: no ${g.color} variant for sizes ${missing.join(',')}`);
  return (variantCache[g.productId] = ids);
}

async function main() {
  const report = [];
  for (const L of listings) {
    if (ONLY && L.code !== ONLY) continue;
    const front = `byol_fl2_front_${L.code}__light-ink.png`, back = `byol_fl2_back_${L.code}__light-ink.png`;
    for (const g of GARMENTS) {
      const key = `${L.code}:${g.key}`;
      if (state[key]) { report.push(`${key}: exists (${state[key]})`); continue; }
      const name = L.code === "latina" ? `Bring Your Own Latina ${g.label}` : `Bring Your Own Latina ${L.word} ${g.label}`;
      const files = (variant) => [
        { type: 'front', url: `${PUBLIC_BASE}/print/${front}`, position: placement(front, 'chest') },
        { type: 'back', url: `${PUBLIC_BASE}/print/${back}`, position: placement(back, 'back') },
      ];
      if (DRY) { report.push(`${key}: would create "${name}" with ${g.sizes.length} sizes at $${g.price}`); continue; }
      const ids = await variantIds(g);
      const body = {
        sync_product: { name, thumbnail: `${PUBLIC_BASE}/preview/byol_flag_v2_${L.code}.jpg` },
        sync_variants: g.sizes.map((size) => ({ variant_id: ids[size], retail_price: g.price, files: files(size) })),
      };
      const res = await pf('POST', '/store/products', body);
      state[key] = res.id;
      fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
      report.push(`${key}: created ${res.id}`);
      await new Promise((r) => setTimeout(r, 1200)); // be polite to the rate limit
    }
  }
  const out = `# push report ${new Date().toISOString()}\n` + report.join('\n') + '\n';
  fs.mkdirSync(path.join(__dirname, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'reports', 'latest.md'), out);
  console.log(out);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
