# Legal protocol for preset generation and publishing

Operating rules for building and publishing OpenPresets with clean-room colour
extraction. The goal: only distribute unprotected mathematical colour
transforms, never protected creative expression or trademarks.

> This is the project's working protocol, not legal advice. If a real dispute
> or takedown arrives, talk to a lawyer before acting.

## Phase 1 — Sourcing reference pairs (input)

1. **Public pages only, no accounts.** Take before/after reference pairs only
   from public pages that need no login and no "I agree to the Terms" click.
   Never create an account on a vendor site to get references.
2. **Respect `robots.txt` and rate limits.** No scrapers that bypass
   Cloudflare, CAPTCHAs, IP limits or any other access barrier (CFAA /
   DMCA §1201 risk). Download manually or with slow, polite local scripts.
3. **Never reuse embedded vendor metadata.** If a vendor JPEG still contains
   its original `.xmp` block, do not copy or redistribute that XML. Every
   `.xmp`/`.cube` we publish is generated fresh by our own colour-matching code.

## Phase 2 — Local clean-room processing (generation)

1. **Process 100% locally** (e.g. Python `color-matcher`, OpenCV histogram
   matching, local HaldCLUT). No third-party cloud APIs for vendor references.
2. **Never commit reference images.** Vendor before/after images must never
   enter this Git repo (no branch, no history, no LFS). Keep them outside the
   repo folder and remove them once the preset is generated (see Notes below
   about disputes).
3. **Clean, generic XMP template.** Only standard Camera Raw boilerplate.
   `crs:Group`, `dc:creator`/`crs:Copyright` and names contain only OpenPresets
   naming. Every file gets a newly generated `crs:UUID`.

## Phase 3 — Naming and taxonomy (trademark)

1. **Zero brand mentions.** Never use competitor brands, creator names or
   pack names in preset names, filenames, site text, README, meta tags or
   alt text.
   - Banned: "Free Mastin Portra Alternative", "Archipelago LXC Clone".
   - Safe: "Warm 400 Film Emulation", "Muted Desaturated Greens 04",
     "Amber Shadow Cinema Grade".
2. **Film stock trademarks.** Kodak, Portra, Ektar, Fujifilm, Velvia,
   CineStill etc. are registered marks. Prefer descriptive codes
   (`KP-400 Warm`, `FJ-Classic Chrome`, `CS-800 Tungsten`) and keep the
   nominative fair-use disclaimer in the footer.

## Phase 4 — Preview images (copyright)

1. **Base photos only from:** our own camera roll, Unsplash, Pexels, or
   Wikimedia Commons CC0/public domain.
2. **Log every preview photo in `CREDITS.md`:** source URL, photographer,
   licence, date added. This audit trail answers any false DMCA claim.
3. **Render fresh pairs.** Apply our own generated preset to those photos and
   export new before/after images (WebP). Never use a vendor's preview images
   on the site.

## Phase 5 — Licensing and disclaimers (publishing)

1. **Licence:** presets CC0 1.0 Universal, code MIT.
2. **Footer + README disclaimer:**

   > All presets and color profiles in this repository are algorithmically
   > generated mathematical color transformations released into the public
   > domain under CC0. This project is independent and is not affiliated with,
   > endorsed by, or sponsored by Adobe Inc. or any third-party preset vendor or
   > film manufacturer. All preview photographs are original works or sourced
   > under Creative Commons Zero / Unsplash / Pexels licenses.

3. **Visible DMCA / contact email** on the site and in the README, so a
   creator contacts us directly before filing a takedown with the host.

## Notes and caveats

- *hiQ v. LinkedIn* mainly settled that scraping public pages isn't
  "unauthorized access" under the CFAA. hiQ still lost on breach of contract
  later, so the "no account, no Agree click" rule matters.
- Slider values and colour transforms are very likely not copyrightable;
  the main risks are copying a vendor's actual files, preview photos, or
  names, which this protocol avoids.
- **If a takedown, demand letter or dispute arrives, stop deleting related
  files.** Deleting material after a dispute is foreseeable can be treated as
  destroying evidence. Keep generation logs (which script, which parameters,
  when) so the clean-room process can be shown.
- When a preset is created from a user upload (future feature), the uploader
  must confirm they own it or have the right to share it.
