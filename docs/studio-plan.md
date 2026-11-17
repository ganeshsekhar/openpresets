# OpenPresets Studio — plan

The local admin dashboard plus the agents that turn film stills into presets.
Runs on the owner's Mac (later the Mac mini). Never deployed. Everything is
started by a button; nothing runs on a schedule.

Status: M1 (References), M2 (Categorize) and M3 (Batches + Review) built. M4+ planned. Decisions below were made with the owner on
2026-11-16.

## Decisions

| Topic | Decision |
|---|---|
| Sources | film-grab.com, **picked films only** (no full-site crawl). frameset.app is off-limits (blocks bots, `/api/` disallowed). |
| References | Movie/TV stills. Local only, never published, never committed. |
| Output | One preset per reference still. Batches of 10. |
| Triggering | Manual buttons for every step. A batch runs, waits for review, publishes approved presets, stops. |
| Data | Studio's local SQLite database is the source of truth. Google Sheet dropped. Publishing writes files to this repo and pushes. |
| Test / preview photos | CC0 / Unsplash set, each logged in `CREDITS.md`. |
| Verification | Studio previews (own renderer) for now; owner has no Lightroom yet. Presets marked "not verified in Lightroom" until checked. |
| Claude | The owner's Claude plan via headless Claude Code (`claude -p`). No paid API. |
| Audience | Cafés & restaurants, influencers & lifestyle, travel, brands & marketing, portraits & people, night & city, everyday phone photos; photographers last. |

## Pipeline

```
[Sources]   Load film list (1 index page) → owner ticks films → [Fetch picked]
              → stills + film metadata saved locally → exits
[Categorize] free code analysis + page metadata + rules → Claude contact
              sheets only for low-confidence stills → tags saved → exits
[Pick batch] owner picks 10 stills (or "suggest 10" that fill tag gaps)
[Run batch]  per still: measure → map to sliders → render on test photos →
              Claude compares & adjusts (2–3 rounds) → name + tags → draft
              → stops, waits for review
[Review]     approve · edit sliders · note ("softer blacks") → regenerate · reject
[Publish]    approved drafts → preset rows + before/after previews + credits
              → commit + push → site redeploys → batch closed
```

A **Stop** button halts any running step; finished work is kept.

## Pieces

### 1. Scraper (no AI) — replaced for now

The owner downloads stills manually into `~/OpenPresets-data/refs/<film>/`.
Studio imports whatever is there. The notes below apply only if a scraper is
added later.

- **film-grab only, per picked film.** Reads the Films A–Z index once to list
  films. The owner ticks films in Studio; the scraper fetches only those film
  pages and their gallery images.
- **Polite:** one request every 4 seconds, identifiable user agent
  (`OpenPresetsStudio/0.1 (+https://github.com/ganeshsekhar/openpresets)`),
  backs off on 429/5xx, re-checks robots.txt each run, daily cap, resumable.
- **Never** uses the gallery zip download, logins, or anything robots.txt
  disallows. Any site that answers 403/blocks bots is dropped, not bypassed.
- **Saves:** full-size stills + per-film metadata from the page (title, year,
  director, director of photography, and when present camera, lenses, aspect
  ratio, film stock, genre). Film info stays local: provenance and grouping
  only, never in preset names or site copy.
- Dedupe by file hash; near-duplicates by perceptual hash.

### 2. Categorizer (free first, Claude last)

1. **Code analysis (free):** warmth, tint, brightness, contrast, black/white
   points, saturation, per-hue saturation, palette (teal-orange, pastel,
   earthy, neon, mono), shadow/highlight colour, grain estimate, skin tones
   present, faces/people present.
2. **Page metadata (free):** genre, year, film stock, interior/exterior hints.
3. **Rules (free):** measurements → tag guesses with a confidence score.
4. **Clustering (free):** near-identical stills grouped; best one kept as the
   representative.
5. **Claude (plan usage):** only low-confidence stills, as contact sheets of
   ~20 small thumbnails per request.

### 3. Style agent (preset generator)

1. Measure the still (same analysis as above).
2. Map measurements to starting Lightroom slider values (code, no AI).
3. Render the draft onto 3–5 CC0 test photos with Studio's renderer.
4. Claude sees the still + renders, returns adjusted slider JSON. Repeat 2–3
   rounds; stop early when it says the match is good.
5. Claude proposes a name (checked by the name linter), "Good for" and mood
   tags, and a one-line description.
6. Re-tag the **finished preset** from the renders (does it keep skin natural?
   does food stay appetising?), since the still alone can't tell.

Runs via `claude -p` with `--output-format stream-json`, so Studio shows live
progress. If the plan's usage limit is hit, the batch pauses and can resume.

### 4. Renderer

One Python renderer implementing Lightroom's main controls (exposure,
contrast, highlights/shadows/whites/blacks, temperature/tint, vibrance/
saturation, HSL, colour grading, tone curve, grain, vignette). Used for:
Studio previews, live slider editing, and the **real before/after images on
the site** (CC0 test photo + our preset), replacing today's CSS approximation.
It approximates Lightroom; Lightroom checks remain the final word.

### 5. Name linter

Blocks film titles, director/DoP names, studio names, film-stock brands
(Kodak, Portra, Fujifilm, Velvia, CineStill…), preset vendors and packs.
Built from a blocklist plus every film title and credit in the local database.

## Taxonomy (multi-label)

- **Good for:** Cafés & restaurants · Influencers & lifestyle · Travel ·
  Brands & marketing · Portraits & people · Night & city · Everyday phone
  photos · Photographers
- **Mood:** Warm & cozy · Nostalgic · Moody · Dreamy & soft · Bright & airy ·
  Cinematic · Romantic · Vibrant · Calm · Melancholic · Gritty · Fresh & clean
- **Colour:** warm/cool/neutral · bright/dark/faded · palette
- **Light & season:** golden hour · overcast · night · summer · autumn · winter
- **Packs** = saved tag combinations (e.g. Cafés & restaurants + Warm & cozy).

## Studio screens

1. **Sources** — sites, robots status, film list with search, tick films,
   Fetch picked, progress.
2. **References** — grid of stills with tag/colour/film filters; exclude;
   select for a batch.
3. **Batches** — Run batch (disabled while one is open), live progress, Stop,
   plan-usage used.
4. **Review** — still vs renders, sliders with live preview, notes →
   regenerate, approve/reject, export .xmp, "verified in Lightroom" toggle.
5. **Presets** — live library: edit, unpublish, reorder, tags, packs.
6. **Test photos** — CC0 set with credits.
7. **Agent rules** — learned corrections ("greens oversaturate").
8. **Activity / provenance** — every fetch, analysis, version, approval.

## Data

- **Code:** `studio/` in this repo (MIT). Server: Node + TypeScript + SQLite.
  UI: Vite, reusing the site's design system. Analysis and renderer: Python.
- **Data:** `~/OpenPresets-data/` (outside the repo, never committed):
  `refs/<site>/<film>/`, `thumbs/`, `renders/`, `openpresets.sqlite`, `logs/`.
- **Tables:** sources, films, references, analyses, tags (value, confidence,
  source: rules/claude/owner), batches, drafts (versioned settings),
  presets, test_photos, rules, events (provenance).

## Publishing

Publish writes `public/presets.csv` (later JSON), renders before/after WebP
previews into `public/previews/`, updates `CREDITS.md`, commits and pushes.
The owner pressing Publish is the approval for that data push.

Site follow-up: switch browsing to "Good for" + Mood facets; migrate the 24
placeholder presets into Studio.

## Build order

1. **M1 — Studio skeleton + References (done):** local server, SQLite DB, UI
   shell, import from `~/OpenPresets-data/refs/` (one folder per film, optional
   `.json` info), dedupe by hash, thumbnails, moved/missing tracking, References
   screen with exclude and a full-size viewer. The owner downloads stills
   manually; no scraper.
2. **M2 — Categorize (done):** free CIELAB analysis with letterbox cropping,
   rule-based tags with confidence (Good for / Mood / Colour / Light), near-
   duplicates by dHash, look groups by complete-linkage clustering (default
   0.45, max 6, hard limits on warmth/tint/brightness/contrast, B&W never mixed
   with colour; adjustable), optional Claude pass on unclear stills via the
   local Claude Code CLI in contact sheets of 20, owner tag editing. Separate
   from preset creation.
3. **M3 — Batches + Review (done):** approximate Lightroom renderer (Node,
   no Python), 8-photo CC0/Unsplash test set downloaded on click with
   credits, free fitter (coordinate descent matching the reference's grade on
   the test photos; colour ~65% so lighting casts aren't copied), descriptive
   name generator + name check (brands, film titles from folders and file
   names, credits), queue of up to 10 stills/look groups with Suggest, Run
   batch → drafts → stops, Review with live sliders, versions, approve/reject,
   .xmp export, "checked in Lightroom" flag, optional Claude refine.
4. **M4 — Publish + site update:** export, previews, credits, push; site
   facets; migrate placeholders.
5. **M5 — Polish:** learned rules, usage display, phone-friendly review,
   move to the Mac mini.

## Open questions

- Confirm or adjust the "Good for" list.
- When to switch the site's browsing to "Good for" + Mood.
- Email film-grab's owner anyway (recommended, optional).
