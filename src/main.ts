import "./style.css";
import { afterLayer, compareHTML, initCompare, initPeek, layers } from "./compare";
import { config } from "./config";
import { loadPresets, type Preset } from "./data";
import { downloadPreset, downloadZip } from "./download";
import { settingGroups } from "./labels";
import { esc } from "./util";

const main = document.getElementById("main")!;
let presets: Preset[] = [];
let loadError: string | null = null;
let loaded = false;

const CATEGORY_ORDER = ["Portrait", "Film", "Moody", "Travel", "Black & White"];
const SITE_TITLE = "OpenPresets — free, open-source presets for Lightroom";

// ---------- view mode ----------
type Layout = "grid" | "focus";
const mobileQuery = matchMedia("(max-width: 720px)");
const isMobile = () => mobileQuery.matches;
let layout: Layout = "grid";
try {
  if (localStorage.getItem("op-view") === "focus") layout = "focus";
} catch {}
let focusIndex = 0;
let current: Preset[] = []; // presets currently shown in the library

// ---------- routing ----------
interface Route {
  view: "library" | "preset" | "about";
  slug?: string;
  q: string;
  cat: string;
}

function parseRoute(): Route {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  const q = params.get("q") ?? "";
  const cat = params.get("cat") ?? "";
  const m = path.match(/^\/preset\/([^/]+)/);
  if (m) return { view: "preset", slug: decodeURIComponent(m[1]), q, cat };
  if (path.startsWith("/about")) return { view: "about", q, cat };
  return { view: "library", q, cat };
}

function libraryHash(q: string, cat: string) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (cat) p.set("cat", cat);
  const s = p.toString();
  return `#/${s ? `?${s}` : ""}`;
}

const presetHref = (p: Preset) => `#/preset/${encodeURIComponent(p.slug)}`;
let lastLibraryHash = "#/";

function render() {
  const route = parseRoute();
  document.querySelectorAll<HTMLAnchorElement>("[data-nav]").forEach((a) => {
    const on = a.dataset.nav === (route.view === "about" ? "about" : "library");
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (route.view === "library") {
    lastLibraryHash = location.hash || "#/";
    document.title = SITE_TITLE;
    renderLibrary(route);
  } else if (route.view === "preset") {
    renderPreset(route.slug!);
  } else {
    renderAbout();
  }
}

// ---------- library ----------
function categories(): string[] {
  const set = new Set(presets.map((p) => p.category).filter(Boolean));
  return [...set].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
}

function filterPresets(q: string, cat: string): Preset[] {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return presets.filter((p) => {
    if (cat && p.category !== cat) return false;
    if (!terms.length) return true;
    const hay = [p.name, p.category, p.description, ...p.tags].join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

const ICON = {
  search: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" fill="currentColor"/></svg>`,
  focus: `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 4h10v16H3zM15 4h6v4h-6zM15 10h6v4h-6zM15 16h6v4h-6z" fill="currentColor"/></svg>`,
  download: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  share: `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  close: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  mark: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>`,
};

function requestBandHTML(): string {
  return `<section class="band">
    <div><h2>Missing a <i>look?</i></h2><p>Request a preset, or share one you made. The library is open source.</p></div>
    <div class="band-actions">
      <a class="btn btn-primary" href="${esc(config.requestFormUrl)}" target="_blank" rel="noopener">Request a preset</a>
      <a class="btn btn-ghost" href="#/about">How to contribute</a>
    </div>
  </section>`;
}

function renderLibrary(route: Route) {
  if (!main.querySelector("[data-view=library]")) {
    main.innerHTML = `<div data-view="library">
      <section class="hero">
        <h1><span>Free presets,</span> <span style="animation-delay:.08s"><i>simply</i> made.</span></h1>
        <p id="hero-sub"><b>Free looks</b> for Lightroom. Hover to compare, click to download. Open source, CC0, no sign-up.</p>
      </section>
      <div class="bar glass" id="bar">
        <div class="tabs" id="tabs" role="group" aria-label="Filter by category"><span class="pill"></span></div>
        <label class="search">${ICON.search}<input id="search" type="search" placeholder="Search looks" autocomplete="off" aria-label="Search presets"></label>
        <button class="search-toggle" id="search-toggle" type="button" aria-label="Search">${ICON.search}</button>
        <div class="views" role="group" aria-label="Layout">
          <button type="button" data-layout="grid" aria-pressed="false">${ICON.grid}<span>Grid</span></button>
          <button type="button" data-layout="focus" aria-pressed="false">${ICON.focus}<span>Focus</span></button>
        </div>
      </div>
      <div class="result-meta"><p class="muted small" id="count" aria-live="polite"></p><button class="btn btn-ghost small" id="zip" type="button" hidden></button></div>
      <div id="results"></div>
      ${requestBandHTML()}
    </div>`;
  }
  const search = main.querySelector<HTMLInputElement>("#search")!;
  if (document.activeElement !== search) search.value = route.q;
  if (route.q && isMobile()) main.querySelector("#bar")!.classList.add("searching");

  const tabs = main.querySelector<HTMLElement>("#tabs")!;
  const all = presets.length;
  tabs.querySelectorAll("button").forEach((b) => b.remove());
  tabs.insertAdjacentHTML(
    "beforeend",
    ["", ...categories()]
      .map((c) => {
        const n = c ? presets.filter((p) => p.category === c).length : all;
        return `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === route.cat}">${c ? esc(c) : "All"}${loaded ? `<sup>${n}</sup>` : ""}</button>`;
      })
      .join(""),
  );
  movePill();
  main.querySelectorAll<HTMLButtonElement>("[data-layout]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layout === layout)));

  const results = main.querySelector<HTMLElement>("#results")!;
  const count = main.querySelector<HTMLElement>("#count")!;
  const zip = main.querySelector<HTMLButtonElement>("#zip")!;

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

  current = filterPresets(route.q, route.cat);
  main.querySelector<HTMLElement>("#hero-sub")!.innerHTML = isMobile()
    ? `<b>${all} free looks</b> for Lightroom. Hold a photo to see the original, double-tap to download. Open source, CC0.`
    : `<b>${all} free looks</b> for Lightroom. Hover to compare, click to download. Open source, CC0, no sign-up.`;
  count.textContent = `${current.length} preset${current.length === 1 ? "" : "s"}${route.cat ? ` in ${route.cat}` : ""}${route.q ? ` matching “${route.q}”` : ""}`;
  zip.hidden = current.length < 2;
  zip.textContent = `Download ${current.length === all ? "all" : "these"} ${current.length} (.zip)`;

  if (!current.length) {
    results.innerHTML = `<div class="empty">
      <h2>No looks match “${esc(route.q || route.cat)}”</h2>
      <p>We don't have that one yet. Ask for it and it could be next.</p>
      <a class="btn btn-primary" href="${esc(config.requestFormUrl)}" target="_blank" rel="noopener">Request this preset</a>
    </div>`;
    return;
  }

  if (isMobile()) results.innerHTML = feedHTML(current);
  else if (layout === "focus") {
    focusIndex = Math.min(focusIndex, current.length - 1);
    results.innerHTML = focusHTML(current);
    selectFocus(focusIndex, false);
  } else results.innerHTML = gridHTML(current);
}

function movePill() {
  const tabs = main.querySelector<HTMLElement>("#tabs");
  const b = tabs?.querySelector<HTMLElement>('[aria-pressed="true"]');
  const pill = tabs?.querySelector<HTMLElement>(".pill");
  if (!b || !pill) return;
  pill.style.left = `${b.offsetLeft}px`;
  pill.style.width = `${b.offsetWidth}px`;
}

const stagger = (i: number, step = 25) => `animation-delay:${Math.min(i, 15) * step}ms`;

// Grid (Index)
function gridHTML(list: Preset[]): string {
  return `<div class="grid">${list
    .map(
      (p, i) => `<article class="card" data-slug="${esc(p.slug)}" style="${stagger(i)}">
      <div class="ba">${layers(p, { eager: i < 10 })}<span class="ba-rule"></span><span class="ba-label">Before ← → After</span>
        <button class="chip-dl glass" type="button" data-download="${esc(p.slug)}" aria-label="Download ${esc(p.name)}">↓ .xmp</button></div>
      <div class="cap"><h3><a href="${presetHref(p)}">${esc(p.name)}</a></h3><span>${esc(p.category)}</span></div>
    </article>`,
    )
    .join("")}</div>`;
}

// Focus (Split)
function focusHTML(list: Preset[]): string {
  return `<div class="focus">
    <aside class="stage" id="stage" aria-live="polite"></aside>
    <div class="mini">
      <p class="mini-hint muted small">Hover to preview · <kbd>←</kbd> <kbd>→</kbd> step · <kbd>D</kbd> download · <kbd>Enter</kbd> open</p>
      ${list
        .map(
          (p, i) => `<div class="tile" tabindex="0" role="button" data-k="${i}" aria-label="${esc(p.name)}" style="${stagger(i, 18)}">
          <div class="thumb">${afterLayer(p)}</div><b>${esc(p.name)}</b><small>${esc(p.category)}</small></div>`,
        )
        .join("")}
    </div>
  </div>`;
}

let swapTimer = 0;
function selectFocus(i: number, animate = true) {
  if (!current.length) return;
  focusIndex = (i + current.length) % current.length;
  const p = current[focusIndex];
  main.querySelectorAll<HTMLElement>(".tile").forEach((t) => t.setAttribute("aria-current", String(Number(t.dataset.k) === focusIndex)));
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

// Feed (mobile)
function feedHTML(list: Preset[]): string {
  return `<div class="feed">${list
    .map(
      (p, i) => `<article class="post" data-slug="${esc(p.slug)}" style="${stagger(i, 40)}">
      <header class="post-head">
        <span class="avatar">${ICON.mark}</span>
        <div><b>${esc(p.name)}</b><small>${esc(p.category)} · ${esc(p.id)}</small></div>
        <a class="more" href="${presetHref(p)}">Details</a>
      </header>
      <div class="post-media" data-slug="${esc(p.slug)}">${layers(p, { eager: i < 2 })}
        <span class="state"></span>${i === 0 ? '<span class="peek-chip">Hold to see original</span>' : ""}
      </div>
      <div class="post-actions">
        <button class="btn btn-primary grow" type="button" data-download="${esc(p.slug)}">${ICON.download} Download .xmp</button>
        <button class="icon" type="button" data-share="${esc(p.slug)}" aria-label="Share ${esc(p.name)}">${ICON.share}</button>
      </div>
      <p class="post-cap"><b>OpenPresets</b> ${esc(p.description)}</p>
      <div class="post-tags">${p.tags.map((t) => `<button type="button" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</div>
    </article>`,
    )
    .join("")}</div>`;
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
          <a class="chip" href="${libraryHash("", p.category)}">${esc(p.category)}</a>
          ${p.tags.map((t) => `<a class="chip" href="${libraryHash(t, "")}">#${esc(t)}</a>`).join("")}
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
        <p class="hint">Like it? OpenPresets is free and run by one person. <a href="${esc(config.donateUrl)}" target="_blank" rel="noopener" style="color:var(--ink);text-decoration:underline">Buy me a coffee ☕</a></p>
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

    <h2>Support the project</h2>
    <p>OpenPresets stays free. If it saves you time, you can help cover the domain and keep new presets coming.</p>
    <p><a class="btn btn-primary" style="color:var(--bg);text-decoration:none" href="${esc(config.donateUrl)}" target="_blank" rel="noopener">☕ Buy me a coffee</a></p>
  </article>`;
}

// ---------- events ----------
const bySlug = (slug?: string) => presets.find((x) => x.slug === slug);

function flashDownloaded(btn: HTMLElement) {
  if (!btn.classList.contains("chip-dl")) return;
  const label = btn.textContent;
  btn.classList.add("ok");
  btn.textContent = "✓ Saved";
  setTimeout(() => {
    btn.classList.remove("ok");
    btn.textContent = label;
  }, 1400);
}

function burst(media: HTMLElement) {
  const el = document.createElement("div");
  el.className = "dl-burst";
  el.innerHTML = `<span>↓</span>`;
  media.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

let searchTimer = 0;
main.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id !== "search") return;
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    const r = parseRoute();
    history.replaceState(null, "", libraryHash(t.value.trim(), r.cat));
    render();
  }, 120);
});

let lastTap = { slug: "", t: 0 };
main.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;

  const chip = t.closest<HTMLButtonElement>("[data-cat]");
  if (chip) {
    const r = parseRoute();
    const cat = chip.dataset.cat === r.cat ? "" : chip.dataset.cat!;
    history.replaceState(null, "", libraryHash(r.q, cat));
    focusIndex = 0;
    render();
    chip.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    return;
  }
  const lay = t.closest<HTMLButtonElement>("[data-layout]");
  if (lay) {
    layout = lay.dataset.layout as Layout;
    try {
      localStorage.setItem("op-view", layout);
    } catch {}
    render();
    return;
  }
  if (t.closest("#search-toggle")) {
    const bar = main.querySelector("#bar")!;
    const on = bar.classList.toggle("searching");
    if (on) main.querySelector<HTMLInputElement>("#search")!.focus();
    else if (parseRoute().q) {
      history.replaceState(null, "", libraryHash("", parseRoute().cat));
      render();
    }
    return;
  }
  const dl = t.closest<HTMLElement>("[data-download]");
  if (dl) {
    e.stopPropagation();
    const p = bySlug(dl.dataset.download);
    if (p) {
      downloadPreset(p);
      flashDownloaded(dl);
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
        (await import("./util")).toast("Link copied");
      }
    } catch {}
    return;
  }
  const tag = t.closest<HTMLElement>("[data-tag]");
  if (tag) {
    history.replaceState(null, "", libraryHash(tag.dataset.tag!, ""));
    window.scrollTo({ top: 0, behavior: "smooth" });
    render();
    return;
  }
  // Feed: double-tap a photo to download (like a double-tap like).
  const media = t.closest<HTMLElement>(".post-media");
  if (media) {
    const now = Date.now();
    if (lastTap.slug === media.dataset.slug && now - lastTap.t < 320) {
      const p = bySlug(media.dataset.slug);
      if (p) {
        burst(media);
        downloadPreset(p);
      }
      lastTap = { slug: "", t: 0 };
    } else lastTap = { slug: media.dataset.slug!, t: now };
    return;
  }
  const tile = t.closest<HTMLElement>(".tile");
  if (tile) {
    selectFocus(Number(tile.dataset.k));
    return;
  }
  const card = t.closest<HTMLElement>(".card");
  if (card && !t.closest("a")) location.hash = `#/preset/${encodeURIComponent(card.dataset.slug!)}`;
});

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
  if (!main.querySelector(".focus") || (e.target as HTMLElement).tagName === "INPUT") return;
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
window.addEventListener("resize", movePill);
window.addEventListener("hashchange", render);

// Theme toggle (cross-fade where supported)
document.getElementById("theme-toggle")!.addEventListener("click", () => {
  const root = document.documentElement;
  const dark = root.dataset.theme === "dark" || (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const flip = () => {
    root.dataset.theme = dark ? "light" : "dark";
    try {
      localStorage.setItem("op-theme", root.dataset.theme);
    } catch {}
  };
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.startViewTransition) d.startViewTransition(flip);
  else flip();
});

(document.getElementById("nav-github") as HTMLAnchorElement).href = config.githubUrl;
(document.getElementById("nav-donate") as HTMLAnchorElement).href = config.donateUrl;
(document.getElementById("foot-credits") as HTMLAnchorElement).href = config.creditsUrl;
const legalLink = document.getElementById("foot-legal") as HTMLAnchorElement;
legalLink.href = legalContactHref();
if (config.contactEmail) legalLink.removeAttribute("target");

// zip button
main.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("#zip");
  if (!btn) return;
  const r = parseRoute();
  btn.disabled = true;
  downloadZip(current, r.cat ? r.cat.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "all").finally(() => (btn.disabled = false));
});

initCompare();
initPeek();
render();
document.fonts?.ready.then(movePill);
loadPresets(config.presetsCsvUrl)
  .then((list) => (presets = list))
  .catch((err: Error) => (loadError = err.message))
  .finally(() => {
    loaded = true;
    render();
  });
