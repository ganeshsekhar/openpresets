import type { Preset } from "./data";
import { previewStyle } from "./preview";
import { esc } from "./util";

/** Markup for a before/after slider. `href` makes a tap (not a drag) open the preset. */
export function compareHTML(p: Preset, opts: { href?: string; eager?: boolean } = {}): string {
  const loading = opts.eager ? "eager" : "lazy";
  const alt = esc(p.name);
  let after: string;
  if (p.afterUrl) {
    after = `<img src="${esc(p.afterUrl)}" alt="${alt}, after" loading="${loading}" decoding="async">`;
  } else {
    const s = previewStyle(p.settings);
    const fade = Math.round(s.fade * 255);
    after = `<img src="${esc(p.beforeUrl)}" alt="${alt}, after (approximate preview)" loading="${loading}" decoding="async" style="filter:${s.filter}">
      ${s.fade > 0 ? `<div class="compare-fade" style="background:rgb(${fade},${fade},${fade})"></div>` : ""}
      ${s.tint ? `<div class="compare-tint" style="background:${s.tint}"></div>` : ""}
      ${s.vignette > 0 ? `<div class="compare-vignette" style="opacity:${s.vignette.toFixed(2)}"></div>` : ""}`;
  }
  return `<div class="compare"${opts.href ? ` data-href="${esc(opts.href)}"` : ""}>
    <img src="${esc(p.beforeUrl)}" alt="${alt}, before" loading="${loading}" decoding="async">
    <div class="compare-after">${after}</div>
    <div class="compare-handle"></div>
    <span class="compare-label before">Before</span><span class="compare-label after">After</span>
    <input class="compare-range" type="range" min="0" max="100" value="50" aria-label="Before and after comparison for ${alt}">
  </div>`;
}

function setPos(el: HTMLElement, pct: number) {
  const v = Math.max(0, Math.min(100, pct));
  el.style.setProperty("--pos", `${v}%`);
  const range = el.querySelector<HTMLInputElement>(".compare-range");
  if (range) range.value = String(Math.round(v));
}

function pctFromEvent(el: HTMLElement, e: PointerEvent) {
  const r = el.getBoundingClientRect();
  return ((e.clientX - r.left) / r.width) * 100;
}

/** One set of delegated listeners handles every slider on the page. */
export function initCompare(onNavigate: (href: string) => void) {
  let active: HTMLElement | null = null;
  let startX = 0;
  let dragging = false;

  document.addEventListener("pointerdown", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".compare");
    if (!el || e.button !== 0) return;
    active = el;
    startX = e.clientX;
    dragging = false;
    // Large view: jump straight to the pointer. Cards wait for a drag so taps can open them.
    if (!el.dataset.href) {
      dragging = true;
      setPos(el, pctFromEvent(el, e));
    }
  });

  document.addEventListener("pointermove", (e) => {
    if (active) {
      if (!dragging && Math.abs(e.clientX - startX) > 6) {
        dragging = true;
        active.setPointerCapture?.(e.pointerId);
      }
      if (dragging) setPos(active, pctFromEvent(active, e));
      return;
    }
    // Desktop hover preview on cards.
    if (e.pointerType === "mouse") {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".compare[data-href]");
      if (el) setPos(el, pctFromEvent(el, e));
    }
  });

  const end = () => {
    if (active && !dragging && active.dataset.href) onNavigate(active.dataset.href);
    active = null;
    dragging = false;
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", () => {
    active = null;
    dragging = false;
  });

  document.addEventListener(
    "pointerleave",
    (e) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLElement && el.matches?.(".compare[data-href]") && !active) setPos(el, 50);
    },
    true,
  );

  // Keyboard: the hidden range input drives the slider.
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains("compare-range")) {
      const el = t.closest<HTMLElement>(".compare");
      if (el) setPos(el, Number((t as HTMLInputElement).value));
    }
  });
}
