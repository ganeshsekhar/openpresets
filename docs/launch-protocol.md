# Launch protocol

Everything that must be done before OpenPresets launches publicly. Add items as
they come up; tick them off when done. Nothing launches with an open item
unless the owner explicitly waives it here.

Started 2026-11-16.

## 1. Stop bots and scripts from bulk-downloading presets (reading stays open)

**Goal:** search engines and AI crawlers can read every page (SEO), but
scripts and automated agents can't harvest the whole library by fetching
data or downloads in bulk.

**Is a CAPTCHA enough? No.** A CAPTCHA only guards the button. Today a
script doesn't need the button at all:

- the full library sits in one public file (`/presets.csv`), and
- the `.xmp` files are built in the browser from it, with code that is
  open source.

So a bot can download the CSV once and generate every preset offline. Real
protection needs layers:

- [ ] **Decide the open-data question first.** Presets are CC0 and the code is
      MIT, so copying is legally allowed; technical limits only make bulk
      harvesting harder and slower. Decide whether the preset data itself stays
      public in the repo (anyone can clone it) or only the site's code does,
      with preset data served through the download service below.
- [ ] **Move downloads behind a small server function** (e.g. Cloudflare
      Worker / Pages Function): the site asks for one preset at a time and
      gets the `.xmp` back. No public file with all presets.
- [ ] **Invisible human check on download only** (e.g. Cloudflare
      Turnstile): runs in the background, only challenges suspicious
      visitors, never on page views, so browsing and SEO are unaffected.
      Short-lived signed download tokens so a passed check can't be replayed.
- [ ] **Rate limits per visitor** on the download function (e.g. 30 per hour,
      100 per day) and on "Download all" (limit or remove it). The existing
      10-second first-download wait already slows scripts down.
- [ ] **Bot management at the edge:** put the site behind Cloudflare (or move
      to Cloudflare Pages), turn on bot protection and WAF rate-limit rules for
      the download path, while allowing verified search engine bots.
- [ ] **robots.txt:** allow all pages; disallow the download/data paths
      (polite crawlers respect it, bad bots don't, so it's a signal, not a
      guard). Keep AI crawlers' read access to pages unless decided otherwise.
- [ ] **Monitor:** log download counts per visitor, alert on spikes, keep a
      way to block an abusive source.

## 2. Optimise SEO

- [ ] A real HTML page per preset (`/presets/<name>/`) generated at build
      time, with its own title, description, before/after image and text
      (today everything is one page and `#` URLs, which search engines ignore).
- [ ] Style and tag landing pages (`/presets/film/`, `/presets/warm/` …) to
      match how people search ("cafe presets", "free film presets").
- [ ] `sitemap.xml` and `robots.txt` generated at build; submit to Google
      Search Console and Bing Webmaster Tools.
- [ ] Open Graph / social share cards with a before/after image per preset.
- [ ] Structured data (free, CC0 licence, image, breadcrumbs, site search box).
- [ ] Use the custom domain `openpresets.com` with canonical URLs.
- [ ] Host preview images ourselves (resized WebP, descriptive file names and
      alt text) for image search and speed.
- [ ] Content pages: "How to install presets in Lightroom (desktop/mobile)",
      FAQ (commercial use, CC0), a short "best for" note on each preset.
- [ ] Links in: GitHub README, Product Hunt, relevant communities, Pinterest
      boards of before/afters.

## 3. Placeholders and setup (already known)

- [ ] Real Buy Me a Coffee link (`donateUrl` in `src/config.ts`).
- [ ] Real request form (`requestFormUrl`).
- [ ] DMCA / contact email (`contactEmail`), or keep the GitHub issue form.
- [ ] Replace placeholder presets and picsum preview photos with real,
      Studio-made presets and our own before/after renders; update
      `CREDITS.md`.
- [ ] Check a sample of published presets in real Lightroom.

## Waived items

(none)
