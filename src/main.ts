import "./style.css";
import { compareHTML, initCompare } from "./compare";
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

function cardHTML(p: Preset, i: number): string {
  const href = `#/preset/${encodeURIComponent(p.slug)}`;
  return `<article class="card">
    ${compareHTML(p, { href, eager: i < 3 })}
    <div class="card-body">
      <div>
        <a class="card-title" href="${href}">${esc(p.name)}</a>
        <div class="card-sub">${esc(p.category)}${p.tags.length ? ` · ${esc(p.tags.slice(0, 3).join(", "))}` : ""}</div>
      </div>
      <button class="icon-btn" type="button" data-download="${esc(p.slug)}" aria-label="Download ${esc(p.name)} preset">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </article>`;
}

function requestBandHTML(): string {
  return `<section class="band">
    <div>
      <h2>Missing a look?</h2>
      <p>Request a preset, or share one you made. The library is open source.</p>
    </div>
    <div class="band-actions">
      <a class="btn btn-primary" href="${esc(config.requestFormUrl)}" target="_blank" rel="noopener">Request a preset</a>
      <a class="btn btn-ghost" href="#/about">How to contribute</a>
    </div>
  </section>`;
}

function renderLibrary(route: Route) {
  const existing = main.querySelector<HTMLElement>("[data-view=library]");
  if (!existing) {
    main.innerHTML = `<div data-view="library">
      <section class="hero">
        <h1>Free presets for Lightroom. <em>Open source.</em></h1>
        <p>Preview every look before and after, then download the .xmp file. No sign-up, no email, no catch.</p>
        <div class="hero-badges">
          <span class="badge">Free for personal &amp; commercial use</span>
          <span class="badge">Works in Classic, desktop &amp; mobile</span>
        </div>
      </section>
      <div class="toolbar">
        <label class="search">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="search" type="search" placeholder="Search presets, e.g. warm, film" autocomplete="off" aria-label="Search presets">
        </label>
        <div class="chips" id="chips" role="group" aria-label="Filter by category"></div>
      </div>
      <div class="result-meta">
        <p class="muted small" id="count" aria-live="polite"></p>
        <button class="btn btn-ghost" id="zip" type="button" hidden>Download all</button>
      </div>
      <div id="results"></div>
      ${requestBandHTML()}
    </div>`;
  }
  const search = main.querySelector<HTMLInputElement>("#search")!;
  if (document.activeElement !== search) search.value = route.q;

  const chips = main.querySelector<HTMLElement>("#chips")!;
  chips.innerHTML = ["", ...categories()]
    .map(
      (c) =>
        `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === route.cat}">${c ? esc(c) : "All"}</button>`,
    )
    .join("");

  const results = main.querySelector<HTMLElement>("#results")!;
  const count = main.querySelector<HTMLElement>("#count")!;
  const zip = main.querySelector<HTMLButtonElement>("#zip")!;

  if (!loaded) {
    results.innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(6)}</div>`;
    count.textContent = "Loading presets…";
    return;
  }
  if (loadError) {
    results.innerHTML = `<div class="empty"><h2>Couldn't load presets</h2><p>${esc(loadError)}. Check your connection and try again.</p><button class="btn btn-primary" type="button" onclick="location.reload()">Retry</button></div>`;
    count.textContent = "";
    zip.hidden = true;
    return;
  }
  const list = filterPresets(route.q, route.cat);
  count.textContent = `${list.length} preset${list.length === 1 ? "" : "s"}${route.cat ? ` in ${route.cat}` : ""}`;
  zip.hidden = list.length < 2;
  zip.textContent = `Download ${list.length === presets.length ? "all" : "these"} (${list.length}) as .zip`;

  if (!list.length) {
    results.innerHTML = `<div class="empty">
      <h2>No presets match “${esc(route.q || route.cat)}”</h2>
      <p>We don't have that look yet. Ask for it and it may be the next one we add.</p>
      <a class="btn btn-primary" href="${esc(config.requestFormUrl)}" target="_blank" rel="noopener">Request this preset</a>
    </div>`;
    return;
  }
  results.innerHTML = `<div class="grid">${list.map(cardHTML).join("")}</div>`;
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
  const groups = settingGroups(p.settings);
  const settingsHTML = groups
    .map(
      (g) =>
        `<h4>${esc(g.title)}</h4>` +
        g.items.map((it) => `<dt>${esc(it.label)}</dt><dd>${esc(it.value)}</dd>`).join(""),
    )
    .join("");
  const approx = !p.afterUrl;

  main.innerHTML = `<a class="back" href="${lastLibraryHash}">← All presets</a>
    <div class="detail">
      <div>
        ${compareHTML(p, { eager: true })}
        <p class="muted small" style="margin-top:10px">${approx ? "Preview is an approximation. Real before/after photos coming soon." : "Drag the slider to compare."}</p>
      </div>
      <aside class="detail-side">
        <div>
          <h1>${esc(p.name)}</h1>
          <p class="muted" style="margin-top:8px">${esc(p.description)}</p>
        </div>
        <div class="detail-meta">
          <a class="badge" href="${libraryHash("", p.category)}">${esc(p.category)}</a>
          ${p.tags.map((t) => `<a class="badge" href="${libraryHash(t, "")}">#${esc(t)}</a>`).join("")}
        </div>
        <div class="detail-actions">
          <button class="btn btn-primary btn-lg" type="button" data-download="${esc(p.slug)}">Download .xmp</button>
          <p class="hint">Free · CC0 · by ${esc(p.author || "OpenPresets")}</p>
        </div>
        <details class="panel">
          <summary>How to install</summary>
          <div class="panel-body">
            <ol class="steps">
              <li><strong>Lightroom Classic:</strong> Develop module → Presets panel → <em>+</em> → Import Presets → pick the .xmp.</li>
              <li><strong>Lightroom (desktop):</strong> File → Import Profiles &amp; Presets.</li>
              <li><strong>Lightroom mobile:</strong> open a photo → Presets → ⋯ menu → Import Presets.</li>
            </ol>
          </div>
        </details>
        <details class="panel">
          <summary>Settings in this preset</summary>
          <div class="panel-body"><dl class="settings">${settingsHTML}</dl></div>
        </details>
        <div class="panel" style="padding:14px 16px">
          <p class="small muted">Like this preset? OpenPresets is free and run by one person. <a href="${esc(config.donateUrl)}" target="_blank" rel="noopener">Buy me a coffee ☕</a></p>
        </div>
      </aside>
    </div>`;
}

// ---------- about ----------
function renderAbout() {
  window.scrollTo({ top: 0 });
  document.title = "About · OpenPresets";
  main.innerHTML = `<article class="prose">
    <h1>About OpenPresets</h1>
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

    <h2>Copyright concerns</h2>
    <p>If you believe something here infringes your rights, please <a href="${esc(legalContactHref())}"${config.contactEmail ? "" : ' target="_blank" rel="noopener"'}>contact us</a> first. We review every report and respond quickly.</p>

    <h2>Contribute</h2>
    <p>The whole site is on <a href="${esc(config.githubUrl)}" target="_blank" rel="noopener">GitHub</a>. Open an issue to suggest a preset or report a bug, or send a pull request. You can also <a href="${esc(config.requestFormUrl)}" target="_blank" rel="noopener">request a preset</a> without a GitHub account.</p>

    <h2>Roadmap</h2>
    <div class="roadmap">
      <div><span class="tag now">Now</span><span>Curated library with before/after previews and one-click downloads.</span></div>
      <div><span class="tag">Next</span><span>Upload your own .xmp. We read the settings and turn it into a shareable preset page.</span></div>
      <div><span class="tag">Later</span><span>Creator profiles, collections and favourites.</span></div>
    </div>

    <h2>Support the project</h2>
    <p>OpenPresets stays free. If it saves you time, you can help cover the domain and keep new presets coming.</p>
    <p><a class="btn btn-coffee" href="${esc(config.donateUrl)}" target="_blank" rel="noopener">☕ Buy me a coffee</a></p>

    <p class="small">Not affiliated with or endorsed by Adobe. Lightroom is a trademark of Adobe Inc.</p>
  </article>`;
}

// ---------- events ----------
function navigate(hash: string) {
  if (location.hash === hash) render();
  else location.hash = hash;
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

main.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const chip = t.closest<HTMLButtonElement>("[data-cat]");
  if (chip) {
    const r = parseRoute();
    const cat = chip.dataset.cat === r.cat ? "" : chip.dataset.cat!;
    history.replaceState(null, "", libraryHash(r.q, cat));
    render();
    return;
  }
  const dl = t.closest<HTMLButtonElement>("[data-download]");
  if (dl) {
    const p = presets.find((x) => x.slug === dl.dataset.download);
    if (p) downloadPreset(p);
    return;
  }
  if (t.closest("#zip")) {
    const r = parseRoute();
    const btn = t.closest<HTMLButtonElement>("#zip")!;
    btn.disabled = true;
    downloadZip(filterPresets(r.q, r.cat), r.cat ? r.cat.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "all")
      .finally(() => (btn.disabled = false));
  }
});

window.addEventListener("hashchange", () => {
  if (parseRoute().view === "library") document.title = "OpenPresets — free, open-source presets for Lightroom";
  render();
});

// Theme toggle
document.getElementById("theme-toggle")!.addEventListener("click", () => {
  const root = document.documentElement;
  const dark =
    root.dataset.theme === "dark" ||
    (!root.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "light" : "dark";
  try {
    localStorage.setItem("op-theme", root.dataset.theme);
  } catch {}
});

(document.getElementById("nav-github") as HTMLAnchorElement).href = config.githubUrl;
(document.getElementById("nav-donate") as HTMLAnchorElement).href = config.donateUrl;
(document.getElementById("foot-credits") as HTMLAnchorElement).href = config.creditsUrl;
const legalLink = document.getElementById("foot-legal") as HTMLAnchorElement;
legalLink.href = legalContactHref();
if (config.contactEmail) legalLink.removeAttribute("target");

function legalContactHref() {
  return config.contactEmail ? `mailto:${config.contactEmail}` : config.legalIssueUrl;
}

initCompare(navigate);
render();
loadPresets(config.presetsCsvUrl)
  .then((list) => (presets = list))
  .catch((err: Error) => (loadError = err.message))
  .finally(() => {
    loaded = true;
    render();
  });
