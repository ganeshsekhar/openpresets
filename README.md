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

## License

Code: MIT. Presets: CC0. Not affiliated with or endorsed by Adobe. Lightroom is a trademark of Adobe Inc.
