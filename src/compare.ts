import type { Preset } from "./data";
import { previewStyle } from "./preview";
import { esc } from "./util";

type ImgOpts = { eager?: boolean };

const loading = (o: ImgOpts) => (o.eager ? "eager" : "lazy");

/** The "after" layer: a real export if we have one, else a CSS approximation of the settings. */
export function afterLayer(p: Preset, o: ImgOpts = {}): string {
  const alt = esc(p.name);
  if (p.afterUrl) {
    return `<div class="lyr after"><img src="${esc(p.afterUrl)}" alt="${alt}, after" loading="${loading(o)}" decoding="async"></div>`;
  }
  const s = previewStyle(p.settings);
  const fade = Math.round(s.fade * 255);
  return `<div class="lyr after">
    <img src="${esc(p.beforeUrl)}" alt="${alt}, after (approximate preview)" loading="${loading(o)}" decoding="async" style="filter:${s.filter}">
    ${s.fade > 0 ? `<div class="lyr-fade" style="background:rgb(${fade},${fade},${fade})"></div>` : ""}
    ${s.tint ? `<div class="lyr-tint" style="background:${s.tint}"></div>` : ""}
    ${s.vignette > 0 ? `<div class="lyr-vignette" style="opacity:${s.vignette.toFixed(2)}"></div>` : ""}
  </div>`;
}

export function beforeLayer(p: Preset, o: ImgOpts = {}): string {
  return `<img class="lyr before" src="${esc(p.beforeUrl)}" alt="${esc(p.name)}, before" loading="${loading(o)}" decoding="async">`;
}

export const layers = (p: Preset, o: ImgOpts = {}) => beforeLayer(p, o) + afterLayer(p, o);

/** Large draggable comparison (detail page and focus stage). */
export function compareHTML(p: Preset, o: ImgOpts = {}): string {
  return `<div class="compare" data-compare>
    ${layers(p, o)}
    <span class="handle"></span>
    <span class="tag l">Before</span><span class="tag r">After</span>
    <input class="compare-range" type="range" min="0" max="100" value="50" aria-label="Before and after comparison for ${esc(p.name)}">
  </div>`;
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
