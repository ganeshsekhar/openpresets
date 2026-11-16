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

## Phase 6 — User-uploaded presets (future feature)

A checkbox alone is not enough. Uploads are only safe with all of these:

1. **Required ownership checkbox** (unchecked by default, upload blocked until
   ticked):
   > I created this preset myself, or it was released free for redistribution
   > by its creator. It is not a paid or purchased preset, and I did not get it
   > from a leak or bootleg site. I release it under CC0 so anyone can use it.
2. **Store proof of consent:** user ID, timestamp, the exact checkbox wording
   (or terms version) agreed to, and the uploaded file's hash.
3. **Terms of Service** that say: uploader warrants they have the rights,
   grants the CC0 dedication, is responsible for what they upload, and that we
   remove infringing content and ban repeat infringers.
4. **DMCA safe harbor setup (US, 17 U.S.C. §512)** — this is what actually
   protects the site from liability for user uploads:
   - Register a DMCA designated agent with the U.S. Copyright Office
     (online, small fee, renew every 3 years) and list the agent on the site.
   - Notice-and-takedown process: remove reported content promptly, notify
     the uploader, accept counter-notices.
   - Written repeat-infringer policy, and actually enforce it.
   - Don't ignore obvious infringement once we know about it.
5. **Automatic red-flag checks on upload** (our XMP parser), hold for review if:
   - `crs:Copyright`, `crs:Group`, `crs:Name` or other metadata contains a
     brand, creator, shop or pack name, or a copyright string that isn't the
     uploader's;
   - the preset name or description mentions a known vendor or "paid",
     "premium", "leaked", "free download of";
   - the file is identical (same hash or same settings) to a file already
     reported or removed.
6. **Republish from parsed values, not the raw file.** Generate a fresh `.xmp`
   (new UUID, OpenPresets template) from the parsed sliders; never serve the
   uploader's original file or its metadata.
7. **Moderation queue at launch.** New uploaders' presets go live only after
   review, until there's enough trust/volume data to relax it.

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
- Slider values themselves are probably not copyrightable, but a paid preset
  is usually sold under a licence that forbids redistribution. Uploading it
  breaks that licence, which is why Phase 6 requires the ownership checkbox
  and safe harbor setup.
