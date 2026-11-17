import { renderReview, flushReview } from "/ui/review.js";
import { tabs } from "/ui/tabs.js";
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  route: "refs",
  films: [],
  summary: null,
  // references screen
  refs: [],
  film: "",
  showExcluded: false,
  // categorize screen
  cat: { status: null, taxonomy: [], refs: [], tag: "", unclear: false, tab: "tags", looks: null },
  // lightbox
  lb: { list: [], i: -1 },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { "content-type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let toastTimer = 0;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

const filmOf = (id) => state.films.find((f) => f.id === id) ?? { title: "Unknown", meta: {} };
function metaLine(meta = {}) {
  const parts = [];
  if (meta.Year) parts.push(meta.Year);
  if (meta["Director of Photography"]) parts.push(`DoP ${meta["Director of Photography"]}`);
  if (meta.Director) parts.push(`Dir. ${meta.Director}`);
  return parts.join(" · ");
}
const tagClass = (t) => (t.source === "claude" ? "claude" : t.source === "owner" ? "owner" : "");
const GROUP_ORDER = ["goodFor", "mood", "light", "color"];
const sortTags = (tags) => [...tags].sort((a, b) => GROUP_ORDER.indexOf(a.grp) - GROUP_ORDER.indexOf(b.grp) || b.confidence - a.confidence);

// =====================================================================
// References
// =====================================================================
function renderSummary() {
  const s = state.summary;
  if (!s) return;
  $("#stats").textContent = `${s.refs} stills · ${s.films} films${s.excluded ? ` · ${s.excluded} excluded` : ""}${
    s.lastImport ? ` · last import ${new Date(s.lastImport.at + "Z").toLocaleString()}` : ""
  }`;
  $("#folder").innerHTML = `Folder: <span class="folder-path" title="Click to copy" data-copy="${esc(s.refsDir)}">${esc(s.refsDir)}</span>`;
}

function renderFilmSelect() {
  const sel = $("#film");
  sel.innerHTML =
    `<option value="">All films (${state.films.length})</option>` +
    state.films.map((f) => `<option value="${f.id}">${esc(f.title)} (${f.count})</option>`).join("");
  sel.value = state.film;
}

function tileHTML(r, i, list) {
  return `<div class="tile${r.excluded ? " excluded" : ""}" data-list="${list}" data-i="${i}">
    <img src="/thumb/${r.sha256}.webp" alt="" loading="lazy" />
    ${r.stillNo != null ? `<span class="no">#${r.stillNo}</span>` : ""}
    <button class="x" type="button" data-exclude="${r.id}" title="${r.excluded ? "Include again" : "Exclude"}" aria-label="${r.excluded ? "Include again" : "Exclude"}">${r.excluded ? "↺" : "✕"}</button>
    ${list === "cat" && !r.excluded ? `<button class="add-batch" type="button" data-queue-still="${r.id}">+ Batch</button>` : ""}
  </div>`;
}

function renderRefs() {
  const content = $("#content");
  if (!state.refs.length) {
    const s = state.summary;
    content.innerHTML = `<div class="empty">
      <h2>${s?.refs ? "Nothing to show" : "No references yet"}</h2>
      ${
        s?.refs
          ? `<p>Every still here is excluded. Tick “Show excluded” to see them.</p>`
          : `<p>Put film stills into this folder, one subfolder per film, then click <b>Import from folder</b>.</p>
             <p><code>${esc(s?.refsDir ?? "~/OpenPresets-data/refs")}/&lt;film-name&gt;/still.jpg</code></p>
             <p class="small">Loose images go to “Unsorted”. Stills stay on this Mac and are never published.</p>`
      }
    </div>`;
    return;
  }
  const byFilm = new Map();
  state.refs.forEach((r, i) => {
    if (!byFilm.has(r.filmId)) byFilm.set(r.filmId, []);
    byFilm.get(r.filmId).push([r, i]);
  });
  content.innerHTML = [...byFilm]
    .map(([filmId, items]) => {
      const f = filmOf(filmId);
      return `<section class="film">
        <div class="film-head"><h2>${esc(f.title)}</h2><span class="muted small">${esc(metaLine(f.meta))}</span>
          <span class="muted small">${items.length} still${items.length === 1 ? "" : "s"}</span></div>
        <div class="grid">${items.map(([r, i]) => tileHTML(r, i, "refs")).join("")}</div>
      </section>`;
    })
    .join("");
}

async function loadRefs() {
  const qs = new URLSearchParams();
  if (state.film) qs.set("film", state.film);
  if (state.showExcluded) qs.set("excluded", "1");
  [state.summary, state.films, state.refs] = await Promise.all([api("/api/summary"), api("/api/films"), api(`/api/refs?${qs}`)]);
  renderSummary();
  renderFilmSelect();
  renderRefs();
}

// =====================================================================
// Categorize
// =====================================================================
function renderCatStatus() {
  const s = state.cat.status;
  if (!s) return;
  $("#cat-stats").textContent = s.analyzed
    ? `${s.analyzed}/${s.total} stills analysed · ${s.unclear} unclear · ${s.lookGroups} look groups${s.dupCopies ? ` · ${s.dupCopies} near-duplicate copies` : ""}${
        s.lastRun ? ` · last run ${new Date(s.lastRun.at + "Z").toLocaleString()}` : ""
      }`
    : `${s.total} stills, not analysed yet. Click “Analyse & tag” — it's free and takes a few seconds.`;
  const claude = $("#claude");
  claude.disabled = !s.unclear || !!s.job;
  claude.textContent = s.unclear ? `Ask Claude about ${s.unclear} unclear (${s.sheetsNeeded} sheet${s.sheetsNeeded === 1 ? "" : "s"})` : "Ask Claude";
  $("#categorize").disabled = !!s.job;
  const job = $("#job");
  if (s.job) {
    job.hidden = false;
    job.textContent = `${s.job.label}… ${s.job.progress || ""}`;
  } else if (s.lastClaude) {
    const c = s.lastClaude;
    job.hidden = false;
    job.textContent = `Last Claude pass: ${c.tagged} stills tagged in ${c.sheets} sheet${c.sheets === 1 ? "" : "s"}${c.failed ? `, ${c.failed} failed (${c.errors[0] ?? ""})` : ""}.`;
  } else job.hidden = true;
}

function renderFacets() {
  const { taxonomy, tag, unclear, status } = state.cat;
  $("#facets").innerHTML =
    `<div><button class="facet" type="button" data-facet="" aria-pressed="${!tag && !unclear}"><span>All stills</span><span class="n">${status?.total ?? ""}</span></button>
      <button class="facet" type="button" data-unclear aria-pressed="${unclear}"><span>Unclear only</span><span class="n">${status?.unclear ?? 0}</span></button></div>` +
    taxonomy
      .map(
        (g) => `<div><h3>${esc(g.label)}</h3>${g.values
          .map((v) => {
            const key = `${g.grp}:${v.value}`;
            return `<button class="facet${v.n ? "" : " zero"}" type="button" data-facet="${esc(key)}" aria-pressed="${tag === key}"><span>${esc(v.value)}</span><span class="n">${v.n}</span></button>`;
          })
          .join("")}</div>`,
      )
      .join("");
}

function renderCatGrid() {
  const list = state.cat.refs;
  const grid = $("#cat-grid");
  if (!state.cat.status?.analyzed) {
    grid.innerHTML = `<div class="empty"><h2>Not analysed yet</h2><p>Click <b>Analyse &amp; tag (free)</b>. It measures each still's colour grading on this Mac, tags it, and groups similar looks. No AI, no cost.</p></div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty"><h2>No stills match</h2><p>Pick another tag or show all stills.</p></div>`;
    return;
  }
  grid.innerHTML = `<div class="grid">${list
    .map((r, i) => {
      const chips = sortTags(r.tags).filter((t) => t.grp !== "color").slice(0, 4);
      return `<div class="card">
        ${tileHTML(r, i, "cat").replace('<span class="no">', `${r.unclear ? '<span class="flag unclear">Unclear</span>' : r.lookGroup ? '<span class="flag">Look group</span>' : ""}<span class="no">`)}
        <div class="chips">${chips.map((t) => `<span class="chip ${tagClass(t)}">${esc(t.value)}</span>`).join("") || '<span class="chip">No tags</span>'}</div>
      </div>`;
    })
    .join("")}</div>`;
}

function renderLooks() {
  const data = state.cat.looks;
  if (!data) return;
  const slider = $("#look-threshold");
  if (document.activeElement !== slider) slider.value = data.threshold;
  $("#look-value").textContent = Number(slider.value).toFixed(2);
  $("#looks").innerHTML = data.groups.length
    ? data.groups
        .map(
          (g, gi) => `<section class="look"><div class="look-head">Look ${gi + 1} · ${g.members.length} stills
            <button class="btn" type="button" style="margin-left:8px;padding:4px 10px;font-size:12px" data-queue-look="${g.members.map((m) => m.id).join(",")}">+ Add group to batch</button></div>
          <div class="look-row">${g.members
            .map(
              (m) => `<figure><div class="tile" data-look-ref="${m.id}"><img src="/thumb/${m.sha256}.webp" alt="" loading="lazy" />
                <button class="x" type="button" data-unlook="${m.id}" title="Remove from this group" aria-label="Remove from group">✕</button></div>
                <figcaption>${esc(m.title)}${m.stillNo != null ? ` #${m.stillNo}` : ""}</figcaption></figure>`,
            )
            .join("")}</div></section>`,
        )
        .join("")
    : `<div class="empty"><h2>No look groups</h2><p>No stills are close enough at this setting. Move the slider towards “Looser” and click Regroup, or run Analyse &amp; tag first.</p></div>`;
}

async function loadCategorize() {
  const qs = new URLSearchParams();
  if (state.cat.tag) qs.set("tag", state.cat.tag);
  if (state.cat.unclear) qs.set("unclear", "1");
  const [status, taxonomy, refs, films, looks] = await Promise.all([
    api("/api/categorize/status"),
    api("/api/tags"),
    api(`/api/refs?${qs}`),
    api("/api/films"),
    api("/api/looks"),
  ]);
  Object.assign(state.cat, { status, taxonomy, refs, looks });
  state.films = films;
  renderCatStatus();
  renderFacets();
  renderCatGrid();
  renderLooks();
  if (status.job) pollJob();
}

let polling = false;
async function pollJob() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const s = await api("/api/categorize/status");
      state.cat.status = s;
      renderCatStatus();
      if (!s.job) break;
    }
    await loadCategorize();
    const c = state.cat.status?.lastClaude;
    if (c) toast(c.failed ? `Claude: ${c.tagged} tagged, ${c.failed} failed` : `Claude tagged ${c.tagged} stills`);
  } finally {
    polling = false;
  }
}

// =====================================================================
// Lightbox (shared) with tag editor
// =====================================================================
const listFor = (name) => (name === "cat" ? state.cat.refs : state.refs);

function renderLbTags(r) {
  const box = $("#lb-tags");
  if (!r.tags || !state.cat.taxonomy.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = state.cat.taxonomy
    .map((g) => {
      const have = r.tags.filter((t) => t.grp === g.grp);
      const missing = g.values.filter((v) => !have.some((t) => t.value === v.value));
      return `<div><h4>${esc(g.label)}</h4>${have
        .map((t) => `<button class="t ${tagClass(t)}" type="button" data-untag="${esc(g.grp)}|${esc(t.value)}" title="${esc(t.source)} · ${Math.round(t.confidence * 100)}% · click to remove">${esc(t.value)} ×</button>`)
        .join("")}<select data-addtag="${esc(g.grp)}"><option value="">+ add</option>${missing.map((v) => `<option>${esc(v.value)}</option>`).join("")}</select></div>`;
    })
    .join("");
}

function openLb(listName, i) {
  const list = listFor(listName);
  const r = list[i];
  if (!r) return closeLb();
  state.lb = { list: listName, i };
  const f = filmOf(r.filmId);
  $("#lb-img").src = `/full/${r.id}`;
  $("#lb-title").textContent = f.title;
  $("#lb-meta").textContent = [r.stillNo != null ? `#${r.stillNo}` : "", r.width && `${r.width}×${r.height}`, metaLine(f.meta), r.unclear ? "unclear" : ""]
    .filter(Boolean)
    .join(" · ");
  const src = $("#lb-source");
  src.hidden = !r.sourceUrl;
  if (r.sourceUrl) src.href = r.sourceUrl;
  $("#lb-exclude").textContent = r.excluded ? "Include again" : "Exclude";
  renderLbTags(r);
  $("#lightbox").hidden = false;
}
const closeLb = () => {
  state.lb.i = -1;
  $("#lightbox").hidden = true;
};
const stepLb = (d) => {
  const list = listFor(state.lb.list);
  if (list.length) openLb(state.lb.list, (state.lb.i + d + list.length) % list.length);
};

async function setTag(r, grp, value, on) {
  await api(`/api/refs/${r.id}/tags`, { method: "POST", body: { grp, value, on } });
  r.tags = r.tags.filter((t) => !(t.grp === grp && t.value === value));
  if (on) {
    r.tags.push({ grp, value, confidence: 1, source: "owner" });
    r.unclear = 0;
  }
  renderLbTags(r);
}

// =====================================================================
// Shared actions
// =====================================================================
async function setExcluded(id, excluded) {
  await api(`/api/refs/${id}`, { method: "POST", body: { excluded } });
  toast(excluded ? "Excluded from batches" : "Included again");
  await reload();
}

async function reload() {
  if (state.route === "categorize") await loadCategorize();
  else if (state.route === "batches") await loadBatches();
  else await loadRefs();
}

function route() {
  flushReview().catch(() => {});
  const h = location.hash.slice(1);
  if (h.startsWith("batches") || h.startsWith("review")) return location.replace(`#processing${h.includes("/") ? h.slice(h.indexOf("/")) : ""}`);
  state.route = h === "categorize" ? "categorize" : h.startsWith("processing") ? "batches" : "refs";
  state.reviewId = Number(h.split("/")[1]) || null;
  for (const v of ["refs", "categorize", "batches"]) $(`#view-${v}`).hidden = state.route !== v;
  document.querySelectorAll("[data-route]").forEach((a) =>
    a.dataset.route === state.route ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"),
  );
  closeLb();
  reload().catch((e) => toast(`Could not reach Studio: ${e.message}`));
}

$("#import").addEventListener("click", async () => {
  const btn = $("#import");
  btn.disabled = true;
  btn.textContent = "Importing…";
  try {
    const { result } = await api("/api/import", { method: "POST" });
    const bits = [`${result.added} new`];
    if (result.duplicates) bits.push(`${result.duplicates} duplicates skipped`);
    if (result.moved) bits.push(`${result.moved} moved`);
    if (result.missing) bits.push(`${result.missing} missing`);
    if (result.errors.length) bits.push(`${result.errors.length} unreadable`);
    toast(`Import done: ${bits.join(", ")}`);
    await loadRefs();
  } catch (e) {
    toast(`Import failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Import from folder";
  }
});

$("#categorize").addEventListener("click", async () => {
  const btn = $("#categorize");
  btn.disabled = true;
  btn.textContent = "Analysing…";
  try {
    const { result } = await api("/api/categorize", { method: "POST", body: {} });
    toast(`Done: ${result.tagged} tagged, ${result.unclear} unclear, ${result.lookGroups} look groups`);
    await loadCategorize();
  } catch (e) {
    toast(`Failed: ${e.message}`);
  } finally {
    btn.textContent = "Analyse & tag (free)";
    btn.disabled = false;
  }
});

$("#claude").addEventListener("click", async () => {
  const s = state.cat.status;
  if (!s?.unclear) return;
  if (!confirm(`Send ${s.unclear} unclear stills to Claude as ${s.sheetsNeeded} contact sheet(s)?\n\nThis uses your Claude plan via Claude Code on this Mac. The sheets stay on this Mac except for what Claude reads.`)) return;
  try {
    await api("/api/categorize/claude", { method: "POST" });
    toast("Claude is tagging…");
    state.cat.status = await api("/api/categorize/status");
    renderCatStatus();
    pollJob();
  } catch (e) {
    toast(`Could not start: ${e.message}`);
  }
});

$("#film").addEventListener("change", (e) => {
  state.film = e.target.value;
  loadRefs();
});
$("#show-excluded").addEventListener("change", (e) => {
  state.showExcluded = e.target.checked;
  loadRefs();
});
$("#look-threshold").addEventListener("input", (e) => ($("#look-value").textContent = Number(e.target.value).toFixed(2)));
$("#look-apply").addEventListener("click", async () => {
  const btn = $("#look-apply");
  btn.disabled = true;
  try {
    const { result } = await api("/api/looks/settings", { method: "POST", body: { threshold: Number($("#look-threshold").value) } });
    toast(`${result.lookGroups} look groups covering ${result.grouped} stills`);
    await loadCategorize();
  } catch (e) {
    toast(`Failed: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
});

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.closest("[data-queue-still], [data-queue-look]")) return; // handled by the batch queue listener
  const tab = t.closest("[data-tab]");
  if (tab) {
    state.cat.tab = tab.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === tab)));
    $("#tab-tags").hidden = state.cat.tab !== "tags";
    $("#tab-looks").hidden = state.cat.tab !== "looks";
    return;
  }
  const facet = t.closest("[data-facet]");
  if (facet) {
    state.cat.tag = facet.dataset.facet;
    state.cat.unclear = false;
    return loadCategorize();
  }
  if (t.closest("[data-unclear]")) {
    state.cat.unclear = !state.cat.unclear;
    state.cat.tag = "";
    return loadCategorize();
  }
  const unlook = t.closest("[data-unlook]");
  if (unlook) {
    e.stopPropagation();
    await api(`/api/looks/remove/${unlook.dataset.unlook}`, { method: "POST" });
    toast("Removed from group");
    return loadCategorize();
  }
  const ex = t.closest("[data-exclude]");
  if (ex) {
    e.stopPropagation();
    const id = Number(ex.dataset.exclude);
    const r = [...state.refs, ...state.cat.refs].find((x) => x.id === id);
    return setExcluded(id, !r?.excluded);
  }
  const untag = t.closest("[data-untag]");
  if (untag) {
    const r = listFor(state.lb.list)[state.lb.i];
    const [grp, value] = untag.dataset.untag.split("|");
    if (r) await setTag(r, grp, value, false);
    return;
  }
  const copy = t.closest("[data-copy]");
  if (copy) {
    await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
    return toast("Folder path copied");
  }
  const tile = t.closest(".tile[data-i]");
  if (tile) return openLb(tile.dataset.list, Number(tile.dataset.i));
  const lb = t.closest("[data-lb]");
  if (lb) {
    const a = lb.dataset.lb;
    if (a === "close") closeLb();
    else if (a === "prev") stepLb(-1);
    else if (a === "next") stepLb(1);
    else if (a === "exclude") {
      const r = listFor(state.lb.list)[state.lb.i];
      if (!r) return;
      const { list, i } = state.lb;
      await setExcluded(r.id, !r.excluded);
      const now = listFor(list);
      if (now.length) openLb(list, Math.min(i, now.length - 1));
      else closeLb();
    }
    return;
  }
  if (t.id === "lightbox") closeLb();
});

document.addEventListener("change", async (e) => {
  const sel = e.target.closest?.("[data-addtag]");
  if (!sel || !sel.value) return;
  const r = listFor(state.lb.list)[state.lb.i];
  if (r) await setTag(r, sel.dataset.addtag, sel.value, true);
});

document.addEventListener("keydown", (e) => {
  if ($("#lightbox").hidden || e.target.closest?.("select")) return;
  if (e.key === "Escape") closeLb();
  else if (e.key === "ArrowRight") stepLb(1);
  else if (e.key === "ArrowLeft") stepLb(-1);
  else if (e.key.toLowerCase() === "x") $("#lb-exclude").click();
});

window.addEventListener("hashchange", route);
// Taxonomy is needed by the tag editor on both screens.
api("/api/tags").then((t) => (state.cat.taxonomy = t)).catch(() => {});
route();

// =====================================================================
// Batches (M3)
// =====================================================================
async function loadBatches() {
  const [b, tp] = await Promise.all([api("/api/batch"), api("/api/testphotos")]);
  state.batch = b;
  state.tp = tp;
  renderBatches();
  await renderOpenReview();
  if (b.job) pollBatchJob();
}

let procTabs = null;
function renderBatches() {
  const b = state.batch, tp = state.tp;
  const photosReady = tp.photos.length >= 3;
  const updateAvailable = !!(tp.missingDefaults || tp.retired.length) && tp.photos.length > 0;
  const hasQueue = b.queue.length > 0;
  const open = b.open;
  const toReview = open ? open.drafts.filter((d) => d.status === "draft").length : 0;
  const busy = !!b.job;

  // Test photos: one-time setup, so a banner when missing and a small chip after.
  const setup = $("#tp-setup");
  setup.hidden = photosReady;
  if (!photosReady) setup.innerHTML = `<div><b>One-time setup: test photos</b>
      <span class="muted small">Every draft is previewed on ${tp.defaults} curated photos (portrait, café, food, travel, city…), which also become the public before/after images.</span></div>
      <button class="btn primary" type="button" data-act="download-tp" ${busy ? "disabled" : ""}>${tp.photos.length ? "Finish setup" : `Download ${tp.defaults} photos`}</button>`;
  const chip = $("#tp-chip");
  chip.hidden = !photosReady;
  chip.innerHTML = `Test photos · ${tp.photos.length}${updateAvailable ? ' <b class="tab-badge hot">update</b>' : ""}`;
  $("#tp-update").innerHTML = updateAvailable
    ? `<p class="small">${tp.missingDefaults} new photo${tp.missingDefaults === 1 ? "" : "s"} available${tp.retired.length ? `, ${tp.retired.length} to retire` : ""}. <button class="btn" type="button" data-act="download-tp" ${busy ? "disabled" : ""}>Update set</button></p>`
    : "";

  // Tabs: Choose → Run → Review. Follow the workflow when the stage changes,
  // otherwise keep whichever tab the owner picked.
  const stage = open ? "review" : busy || hasQueue ? "run" : "choose";
  if (state.reviewId && open) state.procTab = "review";
  else if (state.procStage !== stage) state.procTab = stage;
  state.procStage = stage;
  const items = [
    { id: "choose", label: "1 · Choose stills", panel: "panel-choose", badge: open ? "locked" : hasQueue ? `${b.queue.length}/${b.size}` : "", tone: "" },
    { id: "run", label: "2 · Run batch", panel: "panel-run", badge: busy ? "running" : !open && hasQueue ? "ready" : "", tone: busy || (!open && hasQueue) ? "hot" : "" },
    { id: "review", label: "3 · Review", panel: "panel-review", badge: open ? (toReview ? `${toReview} to review` : "done") : "", tone: toReview ? "hot" : "" },
  ];
  if (!procTabs) procTabs = tabs($("#proc-tabs"), { items, active: state.procTab, onChange: (id) => (state.procTab = id) });
  else procTabs.update({ items, active: state.procTab });

  const job = $("#batch-job");
  if (!busy && b.lastBatch?.errors.length) { job.hidden = false; job.textContent = `Last run: ${b.lastBatch.drafts} drafts, ${b.lastBatch.errors.length} failed (${b.lastBatch.errors[0]}).`; }
  else job.hidden = true;

  // 1 · Choose: actions in the header row, slots always visible so capacity is obvious.
  const left = b.size - b.queue.length;
  $("#queue-title").textContent = open ? "Next batch is locked" : "Next batch";
  $("#queue-note").textContent = open ? "" : `${b.queue.length} of ${b.size} chosen`;
  $("#queue-actions").innerHTML = open ? "" : `
    <a class="btn sm" href="#categorize">Pick in Categorize</a>
    <button class="btn sm ${hasQueue ? "" : "primary"}" type="button" data-act="suggest" ${!photosReady || busy || !left ? "disabled" : ""}
      title="${!photosReady ? "Set up test photos first" : !left ? "Batch is full" : "Picks varied stills and look groups you haven't used yet, clearest first"}">${hasQueue ? `Fill ${left} with suggestions` : `Suggest ${b.size}`}</button>
    ${hasQueue ? `<button class="btn sm primary" type="button" data-act="goto-run">Next: run →</button>` : ""}`;
  $("#queue").innerHTML = open
    ? `<p class="muted">Batch #${open.id} is still in review. Approve or reject every draft, then choose the next ${b.size}.</p>`
    : `<div class="queue-grid">${b.queue.map((q, i) => `<div class="q-card">
          <div class="q-img" style="--n:${Math.min(3, q.refs.length)}">${q.refs.slice(0, 3).map((r) => `<img src="/thumb/${r.sha256}.webp" alt="" loading="lazy" />`).join("")}</div>
          <span class="q-kind">${q.kind === "look" ? `Look · ${q.refs.length}` : "Still"}</span>
          <button class="q-x" type="button" data-unqueue="${q.id}" aria-label="Remove from batch">×</button>
          <div class="q-meta"><b>${esc(q.refs[0]?.title ?? "")}${q.refs[0]?.stillNo != null ? ` #${q.refs[0].stillNo}` : ""}</b>
            <span class="muted">${q.kind === "look" ? `${q.refs.length} similar stills → 1 preset` : `Preset ${i + 1}`}</span></div>
        </div>`).join("")}${Array.from({ length: left }, (_, i) => `<div class="q-slot"><span>${b.queue.length + i + 1}</span></div>`).join("")}</div>
      ${hasQueue ? "" : `<p class="muted small hint">Suggest fills all ${b.size} slots with varied stills you haven't used. To choose yourself, hover a still in Categorize and click “+ Batch”.</p>`}`;

  // 2 · Run
  const runText = busy ? `${esc(b.job.label)}… ${esc(b.job.progress || "")}`
    : open ? `Batch #${open.id} is drafted. Review it before running the next one.`
    : hasQueue ? `Drafts ${b.queue.length} preset${b.queue.length === 1 ? "" : "s"} from your chosen stills (free, about 2 s each), then stops for review.`
    : "Choose stills first.";
  $("#run-box").innerHTML = `<div class="run-row"><p>${runText}</p>
    ${open ? `<button class="btn primary" type="button" data-act="goto-review">Go to review</button>`
      : `<button class="btn primary" type="button" data-act="run" ${b.blockers.length || busy ? "disabled" : ""} title="${esc(b.blockers[0] ?? "")}">${busy ? "Running…" : `Run batch${hasQueue ? ` (${b.queue.length})` : ""}`}</button>`}</div>
    ${!open && !busy && b.blockers.length ? `<p class="muted small">${esc(b.blockers[0])}</p>` : ""}`;
  $("#closed-sec").hidden = !b.closed.length;
  $("#closed").innerHTML = b.closed.map((c) => `<div class="muted small">Batch #${c.id} · ${c.approved} approved · ${c.rejected} rejected · closed ${new Date(c.closedAt + "Z").toLocaleString()}</div>`).join("");

  // 3 · Review (workspace rendered by renderOpenReview)
  if (!open) $("#review").innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>Nothing to review</h2><p class="muted">Run a batch and its drafts appear here.</p></div>`;

  // Test photos detail
  $("#tp-note").textContent = `${tp.photos.length} photos${tp.photos.filter((p) => !p.credit).length ? ` · ${tp.photos.filter((p) => !p.credit).length} missing a credit` : ""}`;
  $("#tp-folder").textContent = tp.folder;
  $("#tp-folder").dataset.copy = tp.folder;
  $("#tp-row").innerHTML = tp.photos.length
    ? tp.photos.map((p) => `<figure><img src="/testphoto/${encodeURIComponent(p.file)}?w=320" alt="" loading="lazy" /><figcaption>${esc(p.subject)} · ${p.credit ? esc(p.credit.author) : '<span class="warn">no credit</span>'}</figcaption></figure>`).join("")
    : "";
  refreshNav();
}

let batchPolling = false;
async function pollBatchJob() {
  if (batchPolling) return;
  batchPolling = true;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const b = await api("/api/batch");
      state.batch = b;
      if (state.route === "batches") renderBatches();
      if (!b.job) break;
    }
    if (state.route === "batches") await loadBatches();
    const lb = state.batch.lastBatch;
    if (lb) toast(lb.errors.length ? `Batch: ${lb.drafts} drafts, ${lb.errors.length} failed` : `Batch ready: ${lb.drafts} drafts to review`);
  } finally {
    batchPolling = false;
  }
}

// =====================================================================
// Review inside Processing (live preview lives in review.js)
// =====================================================================
async function renderOpenReview(fresh = false) {
  const open = state.batch.open;
  if (!open) return;
  const drafts = open.drafts;
  const id = drafts.some((d) => d.id === state.reviewId) ? state.reviewId : drafts.find((d) => d.status === "draft")?.id ?? drafts[0]?.id;
  if (!id) return;
  const draft = await api(`/api/drafts/${id}`);
  renderReview($("#review"), {
    drafts, draft, photos: state.tp.photos, fresh,
    ctx: {
      api, toast,
      onChanged: () => refreshNav(),
      reload: async (advance, keepId) => {
        const wasOpen = state.batch.open;
        const b = await api("/api/batch");
        state.batch = b;
        if (!b.open && wasOpen) toast("Batch closed: every draft is decided. Run the next batch when ready.");
        let next = keepId ?? id;
        if (advance && b.open) next = b.open.drafts.find((d) => d.status === "draft" && d.id !== id)?.id ?? id;
        state.reviewId = next;
        if (location.hash !== `#processing/${next}`) history.replaceState(null, "", `#processing/${next}`);
        renderBatches();
        await renderOpenReview(true);
      },
    },
  });
}

// ---------- events for batches + review ----------
document.addEventListener("click", async (e) => {
  const t = e.target;
  const qs = t.closest("[data-queue-still]");
  const ql = t.closest("[data-queue-look]");
  if (qs || ql) {
    e.stopPropagation();
    try {
      const body = qs ? { kind: "still", refIds: [Number(qs.dataset.queueStill)] } : { kind: "look", refIds: ql.dataset.queueLook.split(",").map(Number) };
      const r = await api("/api/queue", { method: "POST", body });
      toast(`Added to the next batch (${r.queued}/10)`);
    } catch (err) {
      toast(err.message);
    }
    return;
  }
  const un = t.closest("[data-unqueue]");
  if (un) {
    await api(`/api/queue/${un.dataset.unqueue}`, { method: "DELETE" });
    return loadBatches();
  }
});

// Claude refine for the open draft.
document.addEventListener("click", async (e) => {
  if (e.target.id !== "rv-refine" || !state.draft) return;
  const id = state.draft.id;
  const note = $("#rv-note")?.value ?? "";
  if (!confirm("Ask Claude to refine this draft? It sends the reference still(s) and three test renders to Claude via Claude Code on this Mac, using your plan.")) return;
  try {
    await api(`/api/drafts/${id}/refine`, { method: "POST", body: { note } });
    e.target.disabled = true;
    e.target.textContent = "Refining…";
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const j = await api("/api/job");
      if (!j.job) {
        if (j.lastRefine?.draftId === id) toast(j.lastRefine.ok ? `Claude: ${j.lastRefine.message}` : `Refine failed: ${j.lastRefine.message}`);
        break;
      }
    }
    if (state.route === "batches") { state.batch = await api("/api/batch"); await renderOpenReview(true); }
  } catch (err) {
    toast(err.message);
  }
});

// Live reload: reload when Studio restarts with new code or its screens change.
(() => {
  let boot = null;
  const es = new EventSource("/api/live");
  es.onmessage = (e) => {
    if (boot && e.data !== boot) location.reload();
    boot = e.data;
  };
  es.addEventListener("reload", () => location.reload());
})();

// ---------- Batches actions (delegated) ----------
document.addEventListener("click", async (e) => {
  const act = e.target.closest?.("[data-act]");
  if (!act || act.disabled) return;
  const a = act.dataset.act;
  if (a === "goto-review" || a === "goto-run") { procTabs?.select(a === "goto-review" ? "review" : "run"); return; }
  if (a === "toggle-tp") { const d = $("#tp-sec"); d.hidden = !d.hidden; d.open = true; if (!d.hidden) d.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
  try {
    if (a === "suggest") {
      const r = await api("/api/queue/suggest", { method: "POST" });
      toast(r.added ? `Added ${r.added} varied items` : "Nothing left to suggest");
    } else if (a === "run") {
      await api("/api/batch/run", { method: "POST" });
      toast("Batch started");
      pollBatchJob();
    } else if (a === "download-tp") {
      const tp = state.tp;
      const msg = tp.photos.length
        ? `Update the test photos? ${tp.missingDefaults} new photo(s) will be downloaded from Unsplash via picsum.photos${tp.retired.length ? `, and ${tp.retired.join(", ")} moved to a “removed” subfolder` : ""}.`
        : `Download ${tp.defaults} test photos (about 5 MB) from Unsplash via picsum.photos into your test-photos folder, with their credits?`;
      if (!confirm(msg)) return;
      act.disabled = true;
      act.textContent = "Downloading…";
      const r = await api("/api/testphotos/default", { method: "POST" });
      toast(`Test photos: ${r.saved.length} added${r.retired.length ? `, ${r.retired.length} retired` : ""}`);
    }
    await loadBatches();
  } catch (err) {
    toast(err.message);
    loadBatches();
  }
});

// ---------- Sidebar counts ----------
async function refreshNav() {
  try {
    const n = await api("/api/nav");
    const set = (id, text, cls = "") => { const el = $(id); el.textContent = text; el.className = cls; };
    set("#nb-refs", n.refs ? String(n.refs) : "");
    set("#nb-categorize", n.unclear ? `${n.unclear} unclear` : "", n.unclear ? "warn" : "");
    set("#nb-batches", n.running ? "running" : n.toReview ? `${n.toReview} to review` : n.queued ? `${n.queued}/${n.size}` : "", n.running || n.toReview ? "hot" : "");
  } catch {}
}
refreshNav();
window.addEventListener("hashchange", refreshNav);
