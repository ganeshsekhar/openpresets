import type { GalleryPair, Preset } from "./data";
import { previewStyle } from "./preview";
import { esc } from "./util";

type ImgOpts = { eager?: boolean; pair?: GalleryPair };

const loading = (o: ImgOpts) => (o.eager ? "eager" : "lazy");
/** The pair to draw: an explicit one, else the cover. */
const pairOf = (p: Preset, o: ImgOpts): GalleryPair => o.pair ?? p.gallery[0] ?? { subject: "", before: p.beforeUrl, after: p.afterUrl };
const subjectAlt = (pair: GalleryPair) => (pair.subject ? ` (${esc(pair.subject)})` : "");

/** Pairs to page through: the gallery, or the cover alone. */
export const pairsOf = (p: Preset): GalleryPair[] => (p.gallery.length ? p.gallery : [pairOf(p, {})]);

/** The "after" layer: a real export if we have one, else a CSS approximation of the settings. */
export function afterLayer(p: Preset, o: ImgOpts = {}): string {
  const pair = pairOf(p, o);
  const alt = esc(p.name) + subjectAlt(pair);
  if (pair.after) {
    return `<div class="lyr after"><img src="${esc(pair.after)}" alt="${alt}, after" loading="${loading(o)}" decoding="async"></div>`;
  }
  const s = previewStyle(p.settings);
  const fade = Math.round(s.fade * 255);
  return `<div class="lyr after">
    <img src="${esc(pair.before)}" alt="${alt}, after (approximate preview)" loading="${loading(o)}" decoding="async" style="filter:${s.filter}">
    ${s.fade > 0 ? `<div class="lyr-fade" style="background:rgb(${fade},${fade},${fade})"></div>` : ""}
    ${s.tint ? `<div class="lyr-tint" style="background:${s.tint}"></div>` : ""}
    ${s.vignette > 0 ? `<div class="lyr-vignette" style="opacity:${s.vignette.toFixed(2)}"></div>` : ""}
  </div>`;
}

export function beforeLayer(p: Preset, o: ImgOpts = {}): string {
  const pair = pairOf(p, o);
  return `<img class="lyr before" src="${esc(pair.before)}" alt="${esc(p.name)}${subjectAlt(pair)}, before" loading="${loading(o)}" decoding="async">`;
}

export const layers = (p: Preset, o: ImgOpts = {}) => beforeLayer(p, o) + afterLayer(p, o);

/** Large draggable comparison (detail page and focus stage). */
export function compareHTML(p: Preset, o: ImgOpts = {}): string {
  return `<div class="compare" data-compare>
    ${layers(p, o)}
    <span class="handle"></span>
    <span class="tag l">Before</span><span class="tag r">After</span>
    <input class="compare-range" type="range" min="0" max="100" value="50" aria-label="Before and after comparison for ${esc(p.name)}${subjectAlt(pairOf(p, o))}">
  </div>`;
}

const CHEV = (d: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** Dots that jump between pairs (empty for a single pair). */
export function galleryDots(p: Preset, active = 0): string {
  const pairs = pairsOf(p);
  if (pairs.length < 2) return "";
  return `<div class="gal-dots">${pairs
    .map(
      (g, i) =>
        `<button type="button" class="gal-dot" data-gal-go="${i}" data-subject="${esc(g.subject)}" aria-label="Photo ${i + 1} of ${pairs.length}${g.subject ? `: ${esc(g.subject)}` : ""}"${i === active ? ' aria-current="true"' : ""}></button>`,
    )
    .join("")}</div>`;
}

const subjectTag = (g: GalleryPair) => `<span class="gal-subject"${g.subject ? "" : " hidden"}>${esc(g.subject)}</span>`;
/** Subject label + dots, centred over the top of a gallery surface. */
export const galleryBar = (p: Preset, active = 0) => `<div class="gal-bar">${subjectTag(pairsOf(p)[active])}${galleryDots(p, active)}</div>`;

/**
 * Comparison with paging between gallery pairs (focus stage and detail page).
 * Non-cover pairs are hidden slides with lazy images, so the browser only
 * fetches them once they are shown.
 */
export function galleryCompareHTML(p: Preset, o: ImgOpts = {}): string {
  const pairs = pairsOf(p);
  if (pairs.length < 2) return `<div class="gal" data-gal data-i="0">${compareHTML(p, o)}${galleryBar(p)}</div>`;
  const slides = pairs
    .map((g, i) => `<div class="gal-slide" data-i="${i}"${i ? " hidden" : ""}>${compareHTML(p, { pair: g, eager: i === 0 && o.eager })}</div>`)
    .join("");
  return `<div class="gal multi" data-gal data-i="0" role="group" aria-roledescription="carousel" aria-label="${esc(p.name)} example photos">
    ${slides}${galleryBar(p)}
    <button type="button" class="gal-nav prev" data-gal-step="-1" aria-label="Previous photo">${CHEV("M15 5l-7 7 7 7")}</button>
    <button type="button" class="gal-nav next" data-gal-step="1" aria-label="Next photo">${CHEV("M9 5l7 7-7 7")}</button>
  </div>`;
}

/** Mark dot `k` current and show its subject label inside `root`. */
export function syncGalleryBar(root: HTMLElement, k: number) {
  const dots = [...root.querySelectorAll<HTMLElement>(".gal-dot")];
  dots.forEach((d, j) => (j === k ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current")));
  const tag = root.querySelector<HTMLElement>(".gal-subject");
  if (tag) {
    tag.textContent = dots[k]?.dataset.subject ?? "";
    tag.hidden = !tag.textContent;
  }
}

/** Show pair `i` of a [data-gal] gallery (wraps around). Keeps the split position. */
export function showGalleryPair(gal: HTMLElement, i: number) {
  const slides = [...gal.querySelectorAll<HTMLElement>(".gal-slide")];
  if (slides.length < 2) return;
  const n = slides.length;
  const k = ((i % n) + n) % n;
  const prev = slides[Number(gal.dataset.i) || 0];
  const split = prev?.querySelector<HTMLElement>("[data-compare]")?.style.getPropertyValue("--split");
  slides.forEach((s, j) => (s.hidden = j !== k));
  const cmp = slides[k].querySelector<HTMLElement>("[data-compare]");
  if (cmp && split) setSplit(cmp, parseFloat(split));
  gal.dataset.i = String(k);
  syncGalleryBar(gal, k);
}

function setSplit(el: HTMLElement, pct: number) {
  const v = Math.max(0, Math.min(100, pct));
  el.style.setProperty("--split", `${v}%`);
  const r = el.querySelector<HTMLInputElement>(".compare-range");
  if (r) r.value = String(Math.round(v));
}
const pctAt = (el: HTMLElement, x: number) => {
  const r = el.getBoundingClientRect();
  return ((x - r.left) / r.width) * 100;
};

/** Delegated pointer handling for every comparison surface on the page. */
export function initCompare() {
  let dragging: HTMLElement | null = null;

  document.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-compare]");
    if (!el || e.button !== 0) return;
    dragging = el;
    el.setPointerCapture?.(e.pointerId);
    setSplit(el, pctAt(el, e.clientX));
  });
  document.addEventListener("pointermove", (e) => {
    if (dragging) {
      setSplit(dragging, pctAt(dragging, e.clientX));
      return;
    }
    if (e.pointerType !== "mouse") return;
    // Grid thumbnails: the cursor reveals "before" to its left.
    const ba = (e.target as HTMLElement).closest?.<HTMLElement>(".ba");
    if (ba) setSplit(ba, pctAt(ba, e.clientX));
  });
  const stop = () => (dragging = null);
  document.addEventListener("pointerup", stop);
  document.addEventListener("pointercancel", stop);
  document.addEventListener(
    "pointerleave",
    (e) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLElement && el.classList?.contains("ba")) setSplit(el, 0);
    },
    true,
  );
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.classList?.contains("compare-range")) {
      const el = t.closest<HTMLElement>("[data-compare]");
      if (el) setSplit(el, Number(t.value));
    }
  });
}
