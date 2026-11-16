import "./style.css";
import { afterLayer, compareHTML, initCompare, layers } from "./compare";
import { config } from "./config";
import { loadPresets, type Preset } from "./data";
import { downloadPreset, downloadZip } from "./download";
import {
  activeCount,
  applyFilters,
  categoryCounts,
  filtersHash,
  readFilters,
  SORTS,
  tagCounts,
  type Filters,
  type Sort,
} from "./filters";
import { settingGroups } from "./labels";
import { esc, toast } from "./util";

const main = document.getElementById("main")!;
let presets: Preset[] = [];
let loadError: string | null = null;
let loaded = false;

const SITE_TITLE = "OpenPresets — Open-source Lightroom preset library";
const PAGE = 40; // presets rendered per batch; more load as you scroll

// ---------- persisted UI prefs ----------
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
type Layout = "grid" | "focus";
const mobileQuery = matchMedia("(max-width: 720px)");
const isMobile = () => mobileQuery.matches;
let layout: Layout = store.get("op-view") === "focus" ? "focus" : "grid";
let hintsSeen = store.get("op-compare-hint") === "seen";

let current: Preset[] = [];
let shown = 0;
let focusIndex = 0;

// ---------- routing ----------
interface Route {
  view: "library" | "preset" | "about";
  slug?: string;
  f: Filters;
}

function parseRoute(): Route {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  const f = readFilters(new URLSearchParams(query));
  const m = path.match(/^\/preset\/([^/]+)/);
  if (m) return { view: "preset", slug: decodeURIComponent(m[1]), f };
  if (path.startsWith("/about")) return { view: "about", f };
  return { view: "library", f };
}

const presetHref = (p: Preset) => `#/preset/${encodeURIComponent(p.slug)}`;
let lastLibraryHash = "#/";

function setFilters(next: Partial<Filters>) {
  const f = { ...parseRoute().f, ...next };
  history.replaceState(null, "", filtersHash(f));
  focusIndex = 0;
  render();
}

function render() {
  const route = parseRoute();
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === (route.view === "about" ? "about" : "library");
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (route.view !== "library") closePanel();
  if (route.view === "library") {
    lastLibraryHash = location.hash || "#/";
    document.title = SITE_TITLE;
    renderLibrary(route.f);
  } else if (route.view === "preset") renderPreset(route.slug!);
  else renderAbout();
}

// ---------- icons ----------
const ICON = {
  search: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  filter: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  sort: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 4v16m0 0l-3-3m3 3l3-3M17 20V4m0 0l-3 3m3-3l3 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="currentColor"/></svg>`,
  focus: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 4h10v16H3zM15 4h6v4h-6zM15 10h6v4h-6zM15 16h6v4h-6z" fill="currentColor"/></svg>`,
  download: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  share: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  coffee: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8zm13 1h1.5a2.5 2.5 0 0 1 0 5H17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 3.5c0 1 1 1 1 2M12 3.5c0 1 1 1 1 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  mark: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>`,
};

// ---------- library ----------
function shellHTML(): string {
  return `<div data-view="library">
    <section class="hero">
      <div>
        <p class="eyebrow"><span class="dot"></span>Open-source Lightroom preset library</p>
        <h1><span>Free presets,</span> <span style="animation-delay:.08s"><i>simply</i> made.</span></h1>
        <p class="lede" id="lede"></p>
        <div class="hero-cta">
          <a class="coffee" href="${esc(config.donateUrl)}" target="_blank" rel="noopener">${ICON.coffee}Buy me a coffee</a>
          <span class="note">Free forever, funded by people like you. No paywall, no sign-up — just one 10-second wait per visit.</span>
        </div>
      </div>
      <div class="stats" id="stats"></div>
    </section>
    <div id="bar-sentinel" aria-hidden="true"></div>
    <div class="bar glass" id="bar">
      <label class="search">${ICON.search}
        <input id="search" type="search" placeholder="Search looks — warm, film, moody…" autocomplete="off" aria-label="Search presets">
        <button class="clear" id="clear-search" type="button" aria-label="Clear search" hidden>${ICON.close}</button>
        <kbd>/</kbd>
      </label>
      <button class="tool" id="open-filters" type="button" aria-haspopup="dialog">${ICON.filter}<span>Filters</span><span class="n" id="fcount" hidden></span></button>
      <label class="tool sort-tool">${ICON.sort}<select id="sort" aria-label="Sort">${SORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join("")}</select></label>
      <div class="views" role="group" aria-label="Layout">
        <button type="button" data-layout="grid" aria-pressed="false">${ICON.grid}<span>Grid</span></button>
        <button type="button" data-layout="focus" aria-pressed="false">${ICON.focus}<span>Focus</span></button>
      </div>
    </div>
    <div class="quick" id="quick"></div>
    <div class="result-meta"><p class="muted small" id="count" aria-live="polite"></p><button class="btn btn-ghost small" id="zip" type="button" hidden></button></div>
    <div id="results"></div>
    <section class="band">
      <div><h2>Missing a <i>look?</i></h2><p>Request a preset, or share one you made. The library is open source.</p></div>
      <div class="band-actions">
        <a class="btn btn-primary" href="${esc(config.requestFormUrl)}" target="_blank" rel="noopener">Request a preset</a>
        <a class="btn btn-ghost" href="#/about">How to contribute</a>
      </div>
    </section>
  </div>`;
}

// The toolbar gets a more solid pane once it is stuck over content (see .bar.stuck).
const stuckObserver = new IntersectionObserver(
  ([e]) => main.querySelector("#bar")?.classList.toggle("stuck", !e.isIntersecting && e.boundingClientRect.top < 0),
  { rootMargin: "-12px 0px 0px 0px" },
);

function renderLibrary(f: Filters) {
  if (!main.querySelector("[data-view=library]")) {
    main.innerHTML = shellHTML();
    stuckObserver.disconnect();
    stuckObserver.observe(main.querySelector("#bar-sentinel")!);
  }
  const $ = <T extends HTMLElement>(s: string) => main.querySelector<T>(s)!;

  const search = $<HTMLInputElement>("#search");
  if (document.activeElement !== search) search.value = f.q;
  $("#clear-search").hidden = !f.q;
  $<HTMLSelectElement>("#sort").value = f.sort;
  const n = activeCount(f);
  $("#fcount").hidden = !n;
  $("#fcount").textContent = String(n);
  main.querySelectorAll<HTMLButtonElement>("[data-layout]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layout === layout)));

  $("#lede").innerHTML = isMobile()
    ? `Every look tested on real photos. Tap any photo to compare before and after. No sign-up, no email.`
    : `Every look is tested on real photos before it's published. Hover any photo to compare before and after. No sign-up, no email, free for commercial use.`;
  $("#stats").innerHTML = `<div><b>${loaded ? presets.length : "—"}</b><span>Presets</span></div><div><b>CC0</b><span>Free forever</span></div><div><b>MIT</b><span><a href="${esc(config.githubUrl)}" target="_blank" rel="noopener">On GitHub</a></span></div>`;

  const results = $("#results");
  const count = $("#count");
  const zip = $<HTMLButtonElement>("#zip");

  if (!loaded) {
    results.innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(10)}</div>`;
    count.textContent = "Loading presets…";
    return;
  }
  if (loadError) {
    results.innerHTML = `<div class="empty"><h2>Couldn't load presets</h2><p>${esc(loadError)}. Check your connection and try again.</p><button class="btn btn-primary" type="button" onclick="location.reload()">Retry</button></div>`;
    count.textContent = "";
    zip.hidden = true;
    return;
  }

  current = applyFilters(presets, f);
  $("#quick").innerHTML = quickHTML(f);
  count.textContent = `${current.length.toLocaleString()} preset${current.length === 1 ? "" : "s"}${f.q ? ` for “${f.q}”` : ""}`;
  zip.hidden = current.length < 2 || current.length > 200;
  zip.textContent = `Download ${current.length === presets.length ? "all" : "these"} ${current.length} (.zip)`;
  if (panelOpen()) paintPanel();

  if (!current.length) {
    results.innerHTML = `<div class="empty">
      <h2>No looks match${f.q ? ` “${esc(f.q)}”` : " these filters"}</h2>
      <p>We don't have that one yet. Ask for it and it could be next.</p>
      <div class="band-actions" style="justify-content:center">
        <a class="btn btn-primary" href="${esc(config.requestFormUrl)}" target="_blank" rel="noopener">Request this preset</a>
        ${activeCount(f) || f.q ? `<button class="btn btn-ghost" type="button" data-clear-all>Clear filters</button>` : ""}
      </div>
    </div>`;
    return;
  }

  shown = Math.min(PAGE, current.length);
  const slice = current.slice(0, shown);
  if (isMobile()) results.innerHTML = `<div class="feed${hintsSeen ? " hints-off" : ""}" id="items">${slice.map(postHTML).join("")}</div>`;
  else if (layout === "focus") {
    focusIndex = Math.min(focusIndex, current.length - 1);
    results.innerHTML = `<div class="focus"><aside class="stage" id="stage" aria-live="polite"></aside>
      <div class="mini" id="items"><p class="mini-hint muted small">Hover to preview · <kbd>←</kbd> <kbd>→</kbd> step · <kbd>D</kbd> download · <kbd>Enter</kbd> open</p>${slice.map(tileHTML).join("")}</div></div>`;
    selectFocus(focusIndex, false);
  } else results.innerHTML = `<div class="grid" id="items">${slice.map(cardHTML).join("")}</div>`;
  results.insertAdjacentHTML("beforeend", `<div class="sentinel" id="sentinel"></div>`);
  pager.observe(main.querySelector("#sentinel")!);
}

// Quick chips: what's active (tap to remove), then the most useful next filters.
function quickHTML(f: Filters): string {
  const active: string[] = [];
  if (f.cat) active.push(`<button class="qchip on" type="button" data-cat="${esc(f.cat)}" aria-label="Remove ${esc(f.cat)}">${esc(f.cat)}</button>`);
  for (const t of f.tags) active.push(`<button class="qchip on" type="button" data-tag="${esc(t)}" aria-label="Remove ${esc(t)}">${esc(t)}</button>`);
  if (active.length > 1) active.push(`<button class="qchip reset" type="button" data-clear-all>Clear all</button>`);

  const suggestions: string[] = [];
  if (!f.cat) for (const [c, n] of categoryCounts(current).slice(0, 6)) suggestions.push(`<button class="qchip" type="button" data-cat="${esc(c)}">${esc(c)} <small>${n}</small></button>`);
  const tagLimit = isMobile() ? 8 : 10;
  for (const [t, n] of tagCounts(current).filter(([t, n]) => !f.tags.includes(t) && n < current.length).slice(0, tagLimit))
    suggestions.push(`<button class="qchip" type="button" data-tag="${esc(t)}">${esc(t)} <small>${n}</small></button>`);
  return active.join("") + suggestions.join("");
}

// Clickable chips: style first, then tags. Active filters are highlighted.
function tagChips(p: Preset, wrap = false): string {
  const f = parseRoute().f;
  const cat = `<button class="tagchip cat${f.cat === p.category ? " on" : ""}" type="button" data-cat="${esc(p.category)}">${esc(p.category)}</button>`;
  const tags = p.tags.filter((t) => t !== p.category.toLowerCase()).map((t) => `<button class="tagchip${f.tags.includes(t) ? " on" : ""}" type="button" data-tag="${esc(t)}">${esc(t)}</button>`);
  return `<div class="tagrow${wrap ? " multi" : ""}">${cat}${tags.join("")}</div>`;
}

const stagger = (i: number, step = 25) => `animation-delay:${Math.min(i % PAGE, 15) * step}ms`;

function cardHTML(p: Preset, i: number): string {
  return `<article class="card" data-slug="${esc(p.slug)}" style="${stagger(i)}">
    <div class="ba">${layers(p, { eager: i < 10 })}<span class="ba-rule"></span><span class="ba-label">Before ← → After</span>
      <button class="chip-dl" type="button" data-download="${esc(p.slug)}" aria-label="Download ${esc(p.name)} preset">${ICON.download}<span class="t">Download</span></button></div>
    <div class="cap"><h3><a href="${presetHref(p)}">${esc(p.name)}</a></h3>${tagChips(p)}</div>
  </article>`;
}

function tileHTML(p: Preset, i: number): string {
  return `<div class="tile" tabindex="0" role="button" data-k="${i}" aria-label="${esc(p.name)}" style="${stagger(i, 18)}">
    <div class="thumb">${afterLayer(p)}</div><b>${esc(p.name)}</b><small>${esc(p.category)}</small></div>`;
}

function postHTML(p: Preset, i: number): string {
  // Hint only on the first three posts, and only until the visitor has tried it once.
  const hint = i < 3 && !hintsSeen ? `<span class="tap-hint"><i></i>Tap to see the original</span>` : "";
  return `<article class="post" data-slug="${esc(p.slug)}" style="${stagger(i, 40)}">
    <header class="post-head">
      <span class="avatar">${ICON.mark}</span>
      <div><b>${esc(p.name)}</b><small>${esc(p.category)} · ${esc(p.id)}</small></div>
      <a class="more" href="${presetHref(p)}">Details</a>
    </header>
    <div class="post-media" data-slug="${esc(p.slug)}" role="button" tabindex="0" aria-pressed="false" aria-label="${esc(p.name)}: tap to switch between edited and original">
      ${layers(p, { eager: i < 2 })}<span class="wipe"></span>
      <span class="flip" aria-hidden="true"><span class="a">Edited</span><span class="b">Original</span></span>${hint}
    </div>
    <div class="post-actions">
      <button class="btn btn-primary grow" type="button" data-download="${esc(p.slug)}">${ICON.download} Download .xmp</button>
      <button class="icon" type="button" data-share="${esc(p.slug)}" aria-label="Share ${esc(p.name)}">${ICON.share}</button>
    </div>
    <p class="post-cap"><b>OpenPresets</b> ${esc(p.description)}</p>
    <div class="post-tags">${tagChips(p, true)}</div>
  </article>`;
}

// Infinite scroll: append the next page when the sentinel comes into view.
const pager = new IntersectionObserver(
  (entries) => {
    if (!entries.some((e) => e.isIntersecting) || shown >= current.length) return;
    const items = main.querySelector<HTMLElement>("#items");
    if (!items) return;
    const next = current.slice(shown, shown + PAGE);
    const tpl = isMobile() ? postHTML : items.classList.contains("mini") ? tileHTML : cardHTML;
    items.insertAdjacentHTML("beforeend", next.map((p, k) => tpl(p, shown + k)).join(""));
    shown += next.length;
  },
  { rootMargin: "800px 0px" },
);

// ---------- filter panel ----------
const scrim = document.createElement("div");
scrim.className = "fscrim";
const panel = document.createElement("div");
panel.className = "fpanel glass";
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Filters");
document.body.append(scrim, panel);
let tagQuery = "";
const panelOpen = () => panel.classList.contains("open");

function paintPanel() {
  const f = parseRoute().f;
  // Counts reflect everything except the facet itself, so options never dead-end.
  const forCats = applyFilters(presets, { ...f, cat: "" });
  const forTags = applyFilters(presets, { ...f, tags: [] });
  const cats = categoryCounts(forCats);
  const tags = tagCounts(forTags).filter(([t]) => !tagQuery || t.includes(tagQuery.toLowerCase()));
  const shownTags = [...f.tags.map((t) => [t, 0] as [string, number]), ...tags.filter(([t]) => !f.tags.includes(t)).slice(0, 40)];
  panel.innerHTML = `<header><h3>Filters</h3><button class="icon-btn" type="button" data-close-panel aria-label="Close">${ICON.close}</button></header>
    <div class="fbody">
      <section class="fgroup"><h4>Style</h4><div class="fopts">${cats
        .map(([c, n]) => `<button class="qchip${f.cat === c ? " on" : ""}" type="button" data-cat="${esc(c)}">${esc(c)} <small>${n}</small></button>`)
        .join("")}</div></section>
      <section class="fgroup"><h4>Tags</h4>
        <input class="fsearch" id="tag-search" placeholder="Find a tag…" value="${esc(tagQuery)}" autocomplete="off">
        <div class="fopts">${shownTags
          .map(([t, n]) => `<button class="qchip${f.tags.includes(t) ? " on" : ""}" type="button" data-tag="${esc(t)}">${esc(t)}${n ? ` <small>${n}</small>` : ""}</button>`)
          .join("") || '<span class="muted small">No tags match.</span>'}</div></section>
      <section class="fgroup"><h4>Sort</h4><div class="fopts">${SORTS.map(
        (s) => `<button class="qchip${f.sort === s.id ? " on" : ""}" type="button" data-sort="${s.id}">${s.label}</button>`,
      ).join("")}</div></section>
    </div>
    <div class="ffoot"><button class="btn btn-ghost" type="button" data-clear-all>Clear all</button>
      <button class="btn btn-primary" type="button" data-close-panel>Show ${current.length.toLocaleString()} preset${current.length === 1 ? "" : "s"}</button></div>`;
  const ts = panel.querySelector<HTMLInputElement>("#tag-search")!;
  ts.oninput = () => {
    tagQuery = ts.value;
    const pos = ts.selectionStart;
    paintPanel();
    const again = panel.querySelector<HTMLInputElement>("#tag-search")!;
    again.focus();
    again.setSelectionRange(pos, pos);
  };
}
function openPanel() {
  paintPanel();
  panel.classList.add("open");
  scrim.classList.add("open");
  (panel.querySelector("[data-close-panel]") as HTMLElement)?.focus({ preventScroll: true });
}
function closePanel() {
  panel.classList.remove("open");
  scrim.classList.remove("open");
}
scrim.addEventListener("click", closePanel);

// ---------- focus view ----------
let swapTimer = 0;
function selectFocus(i: number, animate = true) {
  if (!current.length) return;
  focusIndex = (i + current.length) % current.length;
  // Make sure the selected tile is rendered (keyboard can step past the loaded page).
  while (focusIndex >= shown && shown < current.length) {
    const items = main.querySelector<HTMLElement>("#items");
    const next = current.slice(shown, shown + PAGE);
    items?.insertAdjacentHTML("beforeend", next.map((p, k) => tileHTML(p, shown + k)).join(""));
    shown += next.length;
  }
  const p = current[focusIndex];
  main.querySelectorAll<HTMLElement>(".tile[aria-current]").forEach((t) => t.removeAttribute("aria-current"));
  main.querySelector<HTMLElement>(`.tile[data-k="${focusIndex}"]`)?.setAttribute("aria-current", "true");
  const stage = main.querySelector<HTMLElement>("#stage");
  if (!stage) return;
  const paint = () => {
    stage.innerHTML = `${compareHTML(p, { eager: true })}
      <div class="stage-card">
        <div class="meta">${esc(p.id)} · ${esc(p.category)} · CC0</div>
        <h2>${esc(p.name).split(" ").map((w, k) => `<span class="w" style="animation-delay:${k * 45}ms">${w}</span>`).join(" ")}</h2>
        <p>${esc(p.description)}</p>
        <div class="row">
          <button class="btn btn-primary" type="button" data-download="${esc(p.slug)}">Download .xmp</button>
          <a class="btn btn-ghost" href="${presetHref(p)}">Details</a>
        </div>
      </div>`;
    stage.classList.remove("swapping");
  };
  clearTimeout(swapTimer);
  if (animate) {
    stage.classList.add("swapping");
    swapTimer = window.setTimeout(paint, 110);
  } else paint();
}

// ---------- detail ----------
function renderPreset(slug: string) {
  window.scrollTo({ top: 0 });
  if (!loaded) {
    main.innerHTML = `<div class="detail" style="margin-top:56px"><div class="skeleton"></div></div>`;
    return;
  }
  const p = presets.find((x) => x.slug === slug);
  if (!p) {
    main.innerHTML = `<a class="back" href="${lastLibraryHash}">← All presets</a>
      <div class="empty"><h2>Preset not found</h2><p>It may have been renamed or removed.</p><a class="btn btn-primary" href="#/">Browse the library</a></div>`;
    return;
  }
  document.title = `${p.name} — free preset for Lightroom · OpenPresets`;
  const settingsHTML = settingGroups(p.settings)
    .map((g) => `<h4>${esc(g.title)}</h4>` + g.items.map((it) => `<dt>${esc(it.label)}</dt><dd>${esc(it.value)}</dd>`).join(""))
    .join("");

  main.innerHTML = `<a class="back" href="${lastLibraryHash}">← All presets</a>
    <div class="detail">
      <div>
        ${compareHTML(p, { eager: true })}
        <p class="hint" style="margin-top:10px">${p.afterUrl ? "Drag to compare." : "Drag to compare. Preview is an approximation until real before/after exports are added."}</p>
      </div>
      <aside class="side">
        <span class="muted small">${esc(p.id)} · ${esc(p.category)}</span>
        <h1>${esc(p.name)}</h1>
        <p class="muted">${esc(p.description)}</p>
        <div class="chips">
          <a class="chip" href="${filtersHash({ cat: p.category })}">${esc(p.category)}</a>
          ${p.tags.map((t) => `<a class="chip" href="${filtersHash({ tags: [t] })}">${esc(t)}</a>`).join("")}
        </div>
        <button class="btn btn-primary" style="padding:15px" type="button" data-download="${esc(p.slug)}">${ICON.download} Download .xmp — free</button>
        <p class="hint">CC0 · by ${esc(p.author || "OpenPresets")} · Classic, desktop &amp; mobile</p>
        <details class="panel">
          <summary>How to install</summary>
          <div class="panel-body"><ol class="steps">
            <li><strong>Lightroom Classic:</strong> Develop → Presets panel → <em>+</em> → Import Presets → pick the .xmp.</li>
            <li><strong>Lightroom (desktop):</strong> File → Import Profiles &amp; Presets.</li>
            <li><strong>Lightroom mobile:</strong> open a photo → Presets → ⋯ → Import Presets.</li>
          </ol></div>
        </details>
        <details class="panel">
          <summary>Settings in this preset</summary>
          <div class="panel-body"><dl class="settings">${settingsHTML}</dl></div>
        </details>
        <p class="hint">OpenPresets is open source and free forever, funded by people like you. <a href="${esc(config.donateUrl)}" target="_blank" rel="noopener" style="color:var(--ink);text-decoration:underline">Buy me a coffee ☕</a></p>
      </aside>
    </div>`;
}

// ---------- about ----------
function legalContactHref() {
  return config.contactEmail ? `mailto:${config.contactEmail}` : config.legalIssueUrl;
}

function renderAbout() {
  window.scrollTo({ top: 0 });
  document.title = "About · OpenPresets";
  const ext = config.contactEmail ? "" : ' target="_blank" rel="noopener"';
  main.innerHTML = `<article class="prose">
    <h1>About <i>OpenPresets</i></h1>
    <p>OpenPresets is a free, open-source library of presets for Lightroom. Every preset is tested on real photos before it's published, and every file is free to use in personal and commercial work.</p>

    <h2>How it works</h2>
    <ul>
      <li>Presets live as rows of slider values in a public spreadsheet.</li>
      <li>When you click Download, your browser turns that row into an .xmp file. There's no server and no tracking.</li>
      <li>Blank settings are left out, so a preset only touches what it needs to.</li>
    </ul>

    <h2>License</h2>
    <p><strong>Presets:</strong> CC0 1.0 Universal (public domain). Use them anywhere, no credit needed (but always welcome). <strong>Code:</strong> MIT.</p>

    <h2>How presets are made</h2>
    <p>Every preset is an algorithmically generated colour transformation, built and tested locally and written into a fresh .xmp file. We never copy or redistribute other creators' preset files, and we never use other brands', creators' or pack names. Film-inspired looks use descriptive names only.</p>

    <h2>Preview photos</h2>
    <p>Preview photos are our own or sourced under Creative Commons Zero, Unsplash or Pexels licenses. Every photo is logged with its source and photographer in <a href="${esc(config.creditsUrl)}" target="_blank" rel="noopener">CREDITS.md</a>.</p>

    <h2>Contribute</h2>
    <p>The whole site is on <a href="${esc(config.githubUrl)}" target="_blank" rel="noopener">GitHub</a>. Open an issue to suggest a preset or report a bug, or send a pull request. You can also <a href="${esc(config.requestFormUrl)}" target="_blank" rel="noopener">request a preset</a> without a GitHub account.</p>

    <h2>Roadmap</h2>
    <div class="roadmap">
      <div><span class="tag now">Now</span><span>Curated library with before/after previews and one-click downloads.</span></div>
      <div><span class="tag">Next</span><span>Upload your own .xmp. We read the settings and turn it into a shareable preset page.</span></div>
      <div><span class="tag">Later</span><span>Creator profiles, collections and favourites.</span></div>
    </div>

    <h2>Copyright concerns</h2>
    <p>If you believe something here infringes your rights, please <a href="${esc(legalContactHref())}"${ext}>contact us</a> first. We review every report and respond quickly.</p>

    <h2>Free forever, <i>funded by people like you</i></h2>
    <p>There are no ads, no accounts and no paid tier. Every preset, every line of code and every update is open. The project runs on small contributions from people who use it: a coffee covers the domain, keeps preset testing going and pays for new looks.</p>
    <p>The only "price" is a 10-second wait on your first download of each visit, while we say hello. Every download after that is instant, and supporters skip it entirely.</p>
    <p><a class="coffee" style="text-decoration:none" href="${esc(config.donateUrl)}" target="_blank" rel="noopener">${ICON.coffee}Buy me a coffee</a></p>
  </article>`;
}

// ---------- events ----------
const bySlug = (slug?: string) => presets.find((x) => x.slug === slug);

function flashDownloaded(btn: HTMLElement) {
  const label = btn.querySelector<HTMLElement>(".t");
  if (!btn.classList.contains("chip-dl") || !label) return;
  btn.classList.add("ok");
  label.textContent = "Saved";
  clearTimeout(Number(btn.dataset.timer));
  btn.dataset.timer = String(
    setTimeout(() => {
      btn.classList.remove("ok");
      label.textContent = "Download";
    }, 1600),
  );
}

function toggleOriginal(media: HTMLElement) {
  const orig = media.classList.toggle("orig");
  media.setAttribute("aria-pressed", String(orig));
  media.classList.remove("flipping");
  void media.offsetWidth; // restart the wipe animation
  media.classList.add("flipping");
  setTimeout(() => media.classList.remove("flipping"), 600);
  navigator.vibrate?.(6);
  if (!hintsSeen) {
    hintsSeen = true;
    store.set("op-compare-hint", "seen");
    main.querySelector(".feed")?.classList.add("hints-off");
  }
}

let searchTimer = 0;
main.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id !== "search") return;
  main.querySelector<HTMLElement>("#clear-search")!.hidden = !t.value;
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => setFilters({ q: t.value.trim() }), 140);
});
main.addEventListener("change", (e) => {
  const t = e.target as HTMLSelectElement;
  if (t.id === "sort") setFilters({ sort: t.value as Sort });
});

// Shared handler for the page and the filter panel.
async function onClick(e: MouseEvent) {
  const t = e.target as HTMLElement;
  const f = parseRoute().f;

  if (t.closest("[data-close-panel]")) return closePanel();
  if (t.closest("#open-filters")) return panelOpen() ? closePanel() : openPanel();
  if (t.closest("[data-clear-all]")) {
    tagQuery = "";
    return setFilters({ q: "", cat: "", tags: [], sort: "featured" });
  }
  if (t.closest("#clear-search")) {
    e.preventDefault();
    return setFilters({ q: "" });
  }
  const cat = t.closest<HTMLElement>("[data-cat]");
  if (cat) return setFilters({ cat: f.cat === cat.dataset.cat ? "" : cat.dataset.cat! });
  const tag = t.closest<HTMLElement>("[data-tag]");
  if (tag) {
    const v = tag.dataset.tag!;
    const fromFeed = !!tag.closest(".post-tags");
    setFilters({ tags: f.tags.includes(v) ? f.tags.filter((x) => x !== v) : [...f.tags, v] });
    if (fromFeed) window.scrollTo({ top: main.querySelector<HTMLElement>("#bar")!.offsetTop - 8, behavior: "smooth" });
    return;
  }
  const sort = t.closest<HTMLElement>("[data-sort]");
  if (sort) return setFilters({ sort: sort.dataset.sort as Sort });
  const lay = t.closest<HTMLButtonElement>("[data-layout]");
  if (lay) {
    layout = lay.dataset.layout as Layout;
    store.set("op-view", layout);
    return render();
  }
  const dl = t.closest<HTMLElement>("[data-download]");
  if (dl) {
    e.stopPropagation();
    const p = bySlug(dl.dataset.download);
    if (p) {
      downloadPreset(p);
      // During the once-per-visit wait the card shows progress instead.
      if (!document.querySelector(".support-card")) flashDownloaded(dl);
    }
    return;
  }
  const share = t.closest<HTMLElement>("[data-share]");
  if (share) {
    const p = bySlug(share.dataset.share);
    if (!p) return;
    const url = `${location.origin}${location.pathname}${presetHref(p)}`;
    try {
      if (navigator.share) await navigator.share({ title: `${p.name} — free preset`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied");
      }
    } catch {}
    return;
  }
  const media = t.closest<HTMLElement>(".post-media");
  if (media) return toggleOriginal(media);
  if (t.closest("#zip")) {
    const btn = t.closest<HTMLButtonElement>("#zip")!;
    btn.disabled = true;
    return void downloadZip(current, f.cat ? f.cat.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "all").finally(() => (btn.disabled = false));
  }
  const tile = t.closest<HTMLElement>(".tile");
  if (tile) return selectFocus(Number(tile.dataset.k));
  const card = t.closest<HTMLElement>(".card");
  if (card && !t.closest("a")) location.hash = `#/preset/${encodeURIComponent(card.dataset.slug!)}`;
}
main.addEventListener("click", onClick);
panel.addEventListener("click", onClick);

// Focus view: hover and keyboard
main.addEventListener("pointerover", (e) => {
  const tile = (e.target as HTMLElement).closest<HTMLElement>(".tile");
  if (tile && (e as PointerEvent).pointerType === "mouse" && Number(tile.dataset.k) !== focusIndex) selectFocus(Number(tile.dataset.k));
});
main.addEventListener("focusin", (e) => {
  const tile = (e.target as HTMLElement).closest<HTMLElement>(".tile");
  if (tile && Number(tile.dataset.k) !== focusIndex) selectFocus(Number(tile.dataset.k));
});
document.addEventListener("keydown", (e) => {
  const typing = ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);
  if (e.key === "Escape" && panelOpen()) return closePanel();
  if (e.key === "/" && !typing && parseRoute().view === "library") {
    e.preventDefault();
    main.querySelector<HTMLInputElement>("#search")?.focus();
    return;
  }
  // Feed photos are buttons: Enter / Space flip them.
  const media = (e.target as HTMLElement).closest?.<HTMLElement>(".post-media");
  if (media && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    return toggleOriginal(media);
  }
  if (!main.querySelector(".focus") || typing || panelOpen()) return;
  const step = (d: number) => {
    selectFocus(focusIndex + d);
    main.querySelector<HTMLElement>(`.tile[data-k="${focusIndex}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  if (e.key === "ArrowRight" || e.key === "ArrowDown") (e.preventDefault(), step(1));
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") (e.preventDefault(), step(-1));
  else if (e.key.toLowerCase() === "d" && !e.metaKey && !e.ctrlKey) downloadPreset(current[focusIndex]);
  else if (e.key === "Enter" && current[focusIndex]) location.hash = presetHref(current[focusIndex]);
});

mobileQuery.addEventListener("change", () => parseRoute().view === "library" && render());
window.addEventListener("hashchange", render);

// Theme toggle (cross-fade where supported)
document.getElementById("theme-toggle")!.addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const flip = () => {
    root.dataset.theme = dark ? "light" : "dark";
    store.set("op-theme", root.dataset.theme);
  };
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.startViewTransition) d.startViewTransition(flip);
  else flip();
});

(document.getElementById("nav-github") as HTMLAnchorElement).href = config.githubUrl;
(document.getElementById("foot-credits") as HTMLAnchorElement).href = config.creditsUrl;
const legalLink = document.getElementById("foot-legal") as HTMLAnchorElement;
legalLink.href = legalContactHref();
if (config.contactEmail) legalLink.removeAttribute("target");

initCompare();
render();
// ?stress=1000 duplicates the sample data so large-library behaviour can be checked locally.
const stress = Number(new URLSearchParams(location.search).get("stress")) || 0;
loadPresets(config.presetsCsvUrl)
  .then((list) => {
    presets = list;
    for (let i = 0; presets.length < stress; i++) {
      const b = list[i % list.length];
      const n = presets.length + 1;
      presets.push({ ...b, id: `OP-${n}`, slug: `${b.slug}-${n}`, name: `${b.name} ${n}`, downloads: (n * 37) % 500 });
    }
  })
  .catch((err: Error) => (loadError = err.message))
  .finally(() => {
    loaded = true;
    render();
  });
