"""Trim rendered PNGs to their artwork, stamp 300 DPI, and build contact sheets on shirt colors.

usage: python3 preview.py [name-prefix] [sheet-label]
  no args        -> the core set (everything not starting with hol_)
  hol_ holiday   -> the holiday line
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
PRINT = os.path.join(HERE, 'print')      # trimmed, print-ready files
PREV = os.path.join(HERE, 'preview')     # previews on shirt colors
os.makedirs(PRINT, exist_ok=True)
os.makedirs(PREV, exist_ok=True)

PAD = 60  # px of transparent padding around the artwork at 300 DPI
SHIRT = {'dark-ink': (241, 237, 228), 'light-ink': (22, 22, 22)}
LABEL = {'dark-ink': (40, 40, 40), 'light-ink': (200, 200, 200)}
TITLES = {
    'wordmark': 'Bring Your Own Latina wordmark',
    'sheBroughtHerself': 'she brought herself',
    'admitOne': 'B.Y.O.L. admit one badge',
    'noLatinaNoParty': 'No Latina? No Party.',
    'catrina': 'Bring Your Own Catrina',
    'bailaConLosVivos': 'Baila con los vivos',
    'papelPicado': 'BYOL papel picado',
    'cempasuchil': 'cempasuchil season',
    'hol_back_calavera': 'BACK: calavera art (shared by every front)',
}
prefix = sys.argv[1] if len(sys.argv) > 1 else ''
label = sys.argv[2] if len(sys.argv) > 2 else 'core'

manifest = json.load(open(os.path.join(OUT, 'manifest.json')))
manifest = [m for m in manifest if (m['name'].startswith(prefix) if prefix else not m['name'].startswith('hol_'))]
names = []
for m in manifest:
    if m['name'] not in names:
        names.append(m['name'])
# backs first, then fronts, then the rest in manifest order
names.sort(key=lambda n: (0 if 'back' in n else 1 if 'front' in n else 2))

fp = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = ImageFont.truetype(fp, 26) if os.path.exists(fp) else ImageFont.load_default()

trimmed = {}
for m in manifest:
    im = Image.open(m['file']).convert('RGBA')
    bbox = im.getchannel('A').getbbox()
    art = im.crop(bbox)
    canvas = Image.new('RGBA', (art.width + 2 * PAD, art.height + 2 * PAD), (0, 0, 0, 0))
    canvas.paste(art, (PAD, PAD))
    out = os.path.join(PRINT, f"byol_{m['name']}__{m['scheme']}.png")
    canvas.save(out, dpi=(300, 300))
    trimmed[(m['name'], m['scheme'])] = canvas
    print(f"{m['name']:22s} {m['scheme']:10s} {canvas.width}x{canvas.height}px  = {canvas.width/300:.1f} x {canvas.height/300:.1f} in")

# contact sheets: one per scheme, 2 columns, portrait for a phone
TILE_W, TILE_H, GUT, LAB = 620, 700, 28, 48
for scheme in ('light-ink', 'dark-ink'):
    cols = 2
    rows = (len(names) + cols - 1) // cols
    W = cols * TILE_W + (cols + 1) * GUT
    H = rows * (TILE_H + LAB) + (rows + 1) * GUT
    sheet = Image.new('RGB', (W, H), SHIRT[scheme])
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(names):
        art = trimmed[(name, scheme)]
        r, c = divmod(i, cols)
        x0 = GUT + c * (TILE_W + GUT)
        y0 = GUT + r * (TILE_H + LAB + GUT)
        shade = tuple(max(0, min(255, v + (-10 if scheme == 'dark-ink' else 14))) for v in SHIRT[scheme])
        d.rounded_rectangle([x0, y0, x0 + TILE_W, y0 + TILE_H], radius=24, fill=shade)
        inner_w, inner_h = TILE_W - 60, TILE_H - 60
        # fronts are small chest hits: show them at true relative scale to the back (back fills the tile)
        s = min(inner_w / art.width, inner_h / art.height)
        if 'front' in name:
            s = min(s, 0.16)
        a = art.resize((max(1, int(art.width * s)), max(1, int(art.height * s))), Image.LANCZOS)
        ax = x0 + (TILE_W - a.width) // 2
        ay = y0 + (TILE_H - a.height) // 2
        sheet.paste(a, (ax, ay), a)
        title = TITLES.get(name, name.replace('hol_front_', 'FRONT: ').replace('_', ' '))
        d.text((x0 + 8, y0 + TILE_H + 10), f"{i+1}. {title}", fill=LABEL[scheme], font=font)
    p = os.path.join(PREV, f"byol_sheet_{label}__{scheme}.jpg")
    sheet.save(p, quality=90)
    print('sheet', p, sheet.size)
