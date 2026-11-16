/*
 * OpenPresets — save 5 random stills from one film-grab.com film as local references.
 *
 * How to use
 *   1. Open ONE film page you picked, e.g. https://film-grab.com/2026/11/16/fantasia/
 *   2. Open the browser console (Cmd+Option+J in Chrome), paste this whole file, press Enter.
 *   3. Allow "download multiple files" if the browser asks.
 *   4. Files land in your Downloads folder: 5 random stills named by their gallery number
 *      (e.g. <film>_07.jpg, <film>_23.jpg …) plus <film>.json (film info + sources).
 *      Move them to ~/OpenPresets-data/refs/film-grab/<film>/ (Studio will import from there).
 *   Stop at any time:  window.__opStop = true
 *
 * Rules (docs/legal-protocol.md + docs/studio-plan.md)
 *   - Picked films only, one film per run. Never loop over the whole site.
 *   - Slow: one image every DELAY_MS. Do not lower it below 3 seconds.
 *   - Stills are LOCAL REFERENCES ONLY: never publish, share, or commit them.
 *     Film titles and credits never go into preset names or site copy.
 */
(async () => {
  const PER_FILM = 5; // random stills to take from this film
  const DELAY_MS = 3500; // polite pace; keep >= 3000

  if (!/(^|\.)film-grab\.com$/.test(location.hostname)) {
    console.warn("[OpenPresets] Run this on a film-grab.com film page.");
    return;
  }
  window.__opStop = false;

  // --- film info -----------------------------------------------------------
  const title = (document.querySelector("h1")?.innerText || document.title).trim();
  const slug =
    location.pathname.split("/").filter(Boolean).pop() ||
    title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const content = document.querySelector(".entry-content") || document.querySelector("article") || document.body;
  const meta = {};
  for (const el of content.querySelectorAll("p, li")) {
    const m = el.innerText.trim().match(/^([A-Z][A-Za-z /&]+):\s*(.+)$/);
    if (m && m[1].length < 40) meta[m[1].trim()] = m[2].trim();
  }

  // --- full-size stills (skip thumbnails, dedupe cache-busting query) -------
  const seen = new Set();
  const urls = [];
  for (const a of document.querySelectorAll('a[href*="/wp-content/uploads/photo-gallery/"]')) {
    const href = a.href;
    if (href.includes("/thumb/")) continue;
    const clean = href.split("?")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    urls.push(href);
  }
  if (!urls.length) {
    console.warn("[OpenPresets] No gallery stills found on this page.");
    return;
  }
  // Pick PER_FILM random stills; keep their original gallery numbers.
  const order = urls.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const picks = order.slice(0, Math.min(PER_FILM, urls.length)).sort((a, b) => a - b);
  console.log(`[OpenPresets] ${title}: taking ${picks.length} random of ${urls.length} stills (#${picks.map((i) => i + 1).join(", #")}), ~${Math.round((picks.length * DELAY_MS) / 1000)}s. Stop with window.__opStop = true`);

  const save = (blob, name) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // --- download one at a time ----------------------------------------------
  const files = [];
  for (let k = 0; k < picks.length; k++) {
    if (window.__opStop) {
      console.warn("[OpenPresets] Stopped.");
      break;
    }
    const i = picks[k];
    const url = urls[i];
    const ext = (url.split("?")[0].match(/\.(jpe?g|png|webp)$/i)?.[1] || "jpg").toLowerCase();
    const name = `${slug}_${String(i + 1).padStart(2, "0")}.${ext}`;
    try {
      const res = await fetch(url, { credentials: "omit" });
      if (res.status === 429 || res.status >= 500) {
        console.warn(`[OpenPresets] Server said ${res.status}. Stopping to be polite; try again later.`);
        break;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      save(await res.blob(), name);
      files.push({ file: name, source: url.split("?")[0], still: i + 1 });
      console.log(`[OpenPresets] ${k + 1}/${picks.length} ${name}`);
    } catch (e) {
      console.warn(`[OpenPresets] Skipped ${url}: ${e.message}`);
    }
    if (k < picks.length - 1) await sleep(DELAY_MS);
  }

  // --- provenance file ------------------------------------------------------
  const record = {
    site: "film-grab.com",
    page: location.href.split("#")[0],
    title,
    slug,
    meta,
    totalStills: urls.length,
    fetchedAt: new Date().toISOString(),
    files,
    note: "Local colour reference only. Not for publication. See docs/legal-protocol.md.",
  };
  save(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }), `${slug}.json`);
  console.log(`[OpenPresets] Done: ${files.length} stills + ${slug}.json saved to Downloads.`);
})();
