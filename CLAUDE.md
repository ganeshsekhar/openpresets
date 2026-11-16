# OpenPresets

Free, open-source library of presets for Lightroom (openpresets.com).
Static Vite + TypeScript site, no backend. Presets are CSV rows (later the
published Google Sheet "Presets" tab); the browser generates `.xmp` on download.
Deployed to GitHub Pages from `main` (ganeshsekhar/openpresets).

## Legal protocol — always follow

Every task that touches preset generation, naming, preview images, site copy
or publishing must follow @docs/legal-protocol.md. Hard rules:

- References only from public pages: no accounts, no "I agree" clicks, no
  bypassing CAPTCHAs/Cloudflare/rate limits, respect robots.txt.
- Never copy or redistribute a vendor's embedded `.xmp`/metadata; always
  generate fresh files with a new `crs:UUID` and only OpenPresets naming.
- Process references locally only. Never commit vendor/reference images to
  this repo (add patterns to `.gitignore`, keep them outside the repo).
- No competitor, creator or pack names anywhere (names, files, copy, meta,
  alt text). Film stocks → descriptive codes (e.g. `KP-400 Warm`).
- Preview photos only from own photos, Unsplash, Pexels or Wikimedia CC0,
  each logged in `CREDITS.md`; before/after renders made with our own presets.
- Presets CC0, code MIT. Keep the clean-room/trademark disclaimer and a
  DMCA/contact email in the footer and README.
- If a takedown or dispute arrives: stop deleting related files and keep
  generation logs.
- User uploads (future): never ship without Phase 6 of the protocol —
  required ownership checkbox ("made it myself or free to share, not paid,
  purchased or bootlegged; released under CC0") with stored proof of consent,
  Terms of Service, registered DMCA agent + takedown/counter-notice process +
  repeat-infringer policy, metadata red-flag checks, fresh XMP regenerated
  from parsed values, and a moderation queue.

If a request would break one of these rules, say so and suggest the
compliant alternative instead of doing it.
