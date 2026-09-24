# bring your own latina: the machine

Everything here is code. No AI in the loop, no subscriptions.

- `render.js` draws every design (flags, holiday, streetwear) as print-ready PNGs. `node render.js flagline` renders the 18 flag fronts and backs.
- `preview.py` trims them to the artwork at 300 DPI (`print/`) and builds contact sheets (`preview/`).
- `mockup.js v2 <country>` puts a front and back on a tee and a hoodie.
- `listings.json` is the Etsy copy: title, 13 tags, description per country. Add a country here and in `FLAGS` in render.js.
- `push.js` creates the tee and hoodie for each listing in the Printful store (idempotent via `state/products.json`).
- `.github/workflows/machine.yml` runs all of it on GitHub Actions: on demand, on every change to the designs, and every Monday.

## one-time setup
1. Create a GitHub repo (public, so Printful can fetch the print files by raw URL) and push this folder.
2. Repo Settings, Secrets and variables, Actions: add `PRINTFUL_TOKEN`.
3. Actions tab, "byol machine", Run workflow with dry = true. Read `reports/latest.md`. Then run it for real.

Local: copy `keys.env` (never committed) and run `npm i && npm run render && npm run preview`.
