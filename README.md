# OpenPresets

A free, open-source library of presets for Lightroom — [openpresets.com](https://openpresets.com).

- Static site (Vite + TypeScript, no framework, no backend).
- Presets are rows in a CSV (later: the published Google Sheet "Presets" tab).
- The browser turns a row into an `.xmp` file on download. "Download all" builds a zip with JSZip.

## Develop

```bash
npm install
npm run dev      # local server
npm test         # XMP generator tests
npm run build    # static output in dist/
```

## Studio (local admin, never deployed)

```bash
npm --prefix studio install   # once
npm run studio                # http://127.0.0.1:4317
```

Put reference stills in `~/OpenPresets-data/refs/<film-name>/` and click **Import from folder**.
Everything Studio stores lives in `~/OpenPresets-data/`, outside this repo. See `docs/studio-plan.md`.

## Data format

One row per preset. Meta columns:

`ID, Name, Slug, Category, Tags, Author, Before Image URL, After Image URL, Description, Status, Date Added, Downloads`

Every other column is a Lightroom `crs:` setting with the header matching the crs name exactly
(`Exposure2012`, `Clarity2012`, `IncrementalTemperature`, `SaturationAdjustmentBlue`, `ColorGradeShadowHue`, …).

- Blank cell = setting left out of the preset.
- Only `Status = Live` rows show on the site.
- `ToneCurvePV2012` is written as `x,y;x,y;…` (0–255).
- Blank `After Image URL` = the site shows a rough CSS approximation until real exports are added.
- Values are clamped to valid slider ranges on export.

Regenerate the placeholder data: `node scripts/make-sample-csv.mjs`.

## Switching to the Google Sheet

Sheet → File → Share → Publish to web → Presets tab → CSV. Put that URL in `src/config.ts` → `presetsCsvUrl`.

## License and legal

- **Presets:** CC0 1.0 Universal (public domain). **Code:** MIT. See [LICENSE](LICENSE).
- **Preview photos:** logged with source and photographer in [CREDITS.md](CREDITS.md).
- **How presets are made:** see [docs/legal-protocol.md](docs/legal-protocol.md) (clean-room generation, naming and image rules).

> All presets and color profiles in this repository are algorithmically generated mathematical color
> transformations released into the public domain under CC0. This project is independent and is not
> affiliated with, endorsed by, or sponsored by Adobe Inc. or any third-party preset vendor or film
> manufacturer. All preview photographs are original works or sourced under Creative Commons Zero /
> Unsplash / Pexels licenses.

**Copyright / DMCA concerns:** please [open a Copyright / DMCA issue](https://github.com/ganeshsekhar/openpresets/issues/new?template=copyright-dmca.yml)
before filing a takedown. We review every report and respond quickly.
