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
  else if (state.route === "review") await loadReview();
  else await loadRefs();
}

function route() {
  const h = location.hash.slice(1);
  state.route = h === "categorize" ? "categorize" : h === "batches" ? "batches" : h.startsWith("review") ? "review" : "refs";
  state.reviewId = Number(h.split("/")[1]) || null;
  for (const v of ["refs", "categorize", "batches", "review"]) $(`#view-${v}`).hidden = state.route !== v;
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
  if (b.job) pollBatchJob();
}

function renderBatches() {
  const b = state.batch, tp = state.tp;
  $("#batch-stats").textContent = `${b.queue.length}/${b.size} queued · ${b.testPhotos} test photos${b.open ? ` · batch #${b.open.id} open` : ""}`;
  const run = $("#run-batch");
  run.disabled = !!b.blockers.length || !!b.job;
  run.textContent = b.job ? "Running…" : `Run batch (${b.queue.length})`;
  $("#batch-blockers").innerHTML = b.blockers.map((x) => `<div class="blocker">${esc(x)}</div>`).join("");
  const job = $("#batch-job");
  if (b.job) { job.hidden = false; job.textContent = `${b.job.label}… ${b.job.progress || ""}`; }
  else if (b.lastBatch) { job.hidden = false; job.textContent = `Last run: ${b.lastBatch.drafts} drafts${b.lastBatch.errors.length ? `, ${b.lastBatch.errors.length} failed (${b.lastBatch.errors[0]})` : ""}.`; }
  else job.hidden = true;

  // test photos
  const missing = tp.photos.filter((p) => !p.credit).length;
  $("#tp-note").textContent = `${tp.photos.length} photos in ${tp.folder}${missing ? ` · ${missing} missing a credit` : ""}`;
  $("#tp-default").hidden = tp.photos.length >= tp.defaults;
  $("#tp-row").innerHTML = tp.photos.length
    ? tp.photos.map((p) => `<figure><img src="/testphoto/${encodeURIComponent(p.file)}?w=320" alt="" loading="lazy" /><figcaption>${esc(p.subject)} · ${p.credit ? esc(p.credit.author) : '<span class="warn">no credit</span>'}</figcaption></figure>`).join("")
    : `<div class="blocker">No test photos yet. “Download default set” fetches 8 photos (portrait, lifestyle, café, food, interior, travel, city, product; about 2 MB) from Unsplash via picsum.photos and records their credits. You can also add your own CC0/Unsplash photos to the folder.</div>`;

  // queue
  $("#queue-note").textContent = b.queue.length ? `${b.size - b.queue.length} slots free` : "Add stills or look groups from Categorize (+ Batch), or click Suggest.";
  $("#suggest").disabled = b.queue.length >= b.size;
  $("#queue").innerHTML = b.queue
    .map((q, i) => `<div class="q-item"><b>${i + 1}</b><div class="q-thumbs">${q.refs.map((r) => `<img src="/thumb/${r.sha256}.webp" alt="" />`).join("")}</div>
      <div class="grow"><div>${esc(q.refs.map((r) => `${r.title}${r.stillNo != null ? ` #${r.stillNo}` : ""}`).join(" · "))}</div>
      <div class="muted small">${q.kind === "look" ? `Look group · ${q.refs.length} stills → one preset` : "Single still"}</div></div>
      <button class="x-btn" type="button" data-unqueue="${q.id}" aria-label="Remove">×</button></div>`)
    .join("");

  // open batch
  $("#open-sec").hidden = !b.open;
  if (b.open) {
    const d = b.open.drafts;
    const left = d.filter((x) => x.status === "draft").length;
    $("#open-note").textContent = `${d.length} drafts · ${left} to review`;
    const first = tp.photos[0]?.file;
    $("#open-drafts").innerHTML = d
      .map((x) => `<a class="draft-card" href="#review/${x.id}">${first ? `<img src="/render/${x.id}/${encodeURIComponent(first)}?w=480&h=${x.hash}" alt="" loading="lazy" />` : ""}
        <div><b>${esc(x.name)}</b><span class="status ${x.status}">${x.status}</span></div></a>`)
      .join("");
  }
  $("#closed-sec").hidden = !b.closed.length;
  $("#closed").innerHTML = b.closed.map((c) => `<div class="muted small">Batch #${c.id} · ${c.approved} approved · ${c.rejected} rejected · closed ${new Date(c.closedAt + "Z").toLocaleString()}</div>`).join("");
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
// Review (M3)
// =====================================================================
async function loadReview() {
  const [b, tp, sliders, taxonomy] = await Promise.all([
    api("/api/batch"), api("/api/testphotos"), state.sliders ?? api("/api/sliders"), state.cat.taxonomy.length ? state.cat.taxonomy : api("/api/tags"),
  ]);
  Object.assign(state, { batch: b, tp, sliders });
  state.cat.taxonomy = taxonomy;
  const drafts = b.open?.drafts ?? [];
  const id = state.reviewId ?? drafts.find((d) => d.status === "draft")?.id ?? drafts[0]?.id;
  state.draft = id ? await api(`/api/drafts/${id}`) : null;
  renderReview();
}

function sliderValue(s, key) {
  const v = Number(state.draft.settings[key] ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function renderReview() {
  const box = $("#review");
  const drafts = state.batch.open?.drafts ?? [];
  const d = state.draft;
  if (!d) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1"><h2>Nothing to review</h2><p>Run a batch from <a href="#batches">Batches</a>. Drafts appear here until every one is approved or rejected.</p></div>`;
    return;
  }
  const photos = state.tp.photos;
  const groups = [...new Set(state.sliders.map((s) => s.group))];
  const mono = String(d.settings.ConvertToGrayscale ?? "").toLowerCase() === "true";
  box.innerHTML = `
    <nav class="rv-list">${drafts.map((x) => `<a href="#review/${x.id}" ${x.id === d.id ? 'aria-current="page"' : ""}><span>${esc(x.name)}</span><span class="status ${x.status}">${x.status === "draft" ? "•" : x.status === "approved" ? "✓" : "✕"}</span></a>`).join("")}</nav>
    <section class="rv-main">
      <h1>${esc(d.name)}</h1>
      <p class="muted">${esc(d.description)}</p>
      <div class="rv-refs">${d.refs.map((r) => `<figure><img src="/thumb/${r.sha256}.webp" alt="" /><figcaption>Reference · ${esc(r.title)}${r.stillNo != null ? ` #${r.stillNo}` : ""}</figcaption></figure>`).join("")}</div>
      <p class="muted small">Press and hold a photo to see it without the preset. Renders are an approximation of Lightroom.</p>
      <div class="renders">${photos.map((p) => `<div class="render" data-render>
          <img src="/render/${d.id}/${encodeURIComponent(p.file)}?w=640&h=${d.hash}" alt="" />
          <img class="before-img" src="/testphoto/${encodeURIComponent(p.file)}?w=640" alt="" />
          <span>${esc(p.subject)}</span></div>`).join("")}</div>
    </section>
    <aside class="rv-side">
      <label class="f">Name<input type="text" id="rv-name" value="${esc(d.name)}" maxlength="60" /></label>
      ${d.nameIssues.length ? `<div class="issue">Name contains “${esc(d.nameIssues[0])}” (film, credit or brand). Rename before approving.</div>` : ""}
      <label class="f">Description<textarea id="rv-desc" maxlength="300">${esc(d.description)}</textarea></label>
      <div class="chips">${d.tags.map((t) => `<span class="chip">${esc(t.value)}</span>`).join("")}</div>
      <div class="rv-actions">
        <button class="btn primary" type="button" data-rv="approved" ${d.status === "approved" ? "disabled" : ""}>${d.status === "approved" ? "Approved ✓" : "Approve"}</button>
        <button class="btn" type="button" data-rv="rejected" ${d.status === "rejected" ? "disabled" : ""}>${d.status === "rejected" ? "Rejected" : "Reject"}</button>
        <a class="btn" href="/api/drafts/${d.id}/xmp">Export .xmp</a>
        <button class="btn" type="button" data-rv="draft" ${d.status === "draft" ? "disabled" : ""}>Back to draft</button>
      </div>
      <label class="check small"><input type="checkbox" id="rv-lr" ${d.lrVerified ? "checked" : ""} /> Checked in Lightroom</label>
      <details class="sl-group"><summary>Refine with Claude (optional)</summary>
        <label class="f">Note for Claude (optional)<textarea id="rv-note" placeholder="e.g. softer blacks, less green, keep skin natural"></textarea></label>
        <button class="btn" type="button" id="rv-refine" style="margin-top:6px">Refine with Claude</button>
        <p class="muted small" id="rv-refine-msg">Uses your Claude plan via Claude Code on this Mac. Runs only when you click.</p>
      </details>
      <div>${groups.map((g, gi) => {
        const items = state.sliders.filter((s) => s.group === g);
        if (mono && (g === "Colour grading" || g === "Colour mixer")) return "";
        return `<details class="sl-group" ${gi < 3 ? "open" : ""}><summary>${esc(g)}</summary>${items.map((s) => {
          const v = sliderValue(d.settings, s.key);
          return `<div class="sl"><span>${esc(s.label)}</span><span class="v" id="v-${s.key}">${v}</span>
            <input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" data-slider="${s.key}" aria-label="${esc(s.label)}" /></div>`;
        }).join("")}</details>`;
      }).join("")}</div>
      <div><b class="small">Versions</b><div class="versions">${d.versions.map((v) => `<button type="button" data-restore="${v.version}" ${v.version === d.version ? "disabled" : ""}>v${v.version} · ${esc(v.source)}${v.note ? ` · ${esc(v.note)}` : ""}${v.version === d.version ? " (current)" : ""}</button>`).join("")}</div></div>
    </aside>`;
}

async function updateDraft(body, msg) {
  try {
    state.draft = { ...(await api(`/api/drafts/${state.draft.id}`, { method: "POST", body })), versions: state.draft.versions };
    state.draft = await api(`/api/drafts/${state.draft.id}`);
    const b = await api("/api/batch");
    state.batch = b.open ? b : { ...b, open: state.batch.open };
    renderReview();
    if (msg) toast(msg);
    if (!b.open && state.batch.open) toast("Batch closed: every draft is decided. Run the next batch when ready.");
  } catch (e) {
    toast(e.message);
  }
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
  const rv = t.closest("[data-rv]");
  if (rv) {
    const status = rv.dataset.rv;
    let rejectReason;
    if (status === "rejected") {
      rejectReason = prompt("Why reject it? (optional, helps tune future drafts)") ?? "";
    }
    return updateDraft({ status, rejectReason }, status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Back to draft");
  }
  const restore = t.closest("[data-restore]");
  if (restore) return updateDraft({ restoreVersion: Number(restore.dataset.restore) }, `Restored v${restore.dataset.restore}`);
});

$("#run-batch").addEventListener("click", async () => {
  try {
    await api("/api/batch/run", { method: "POST" });
    toast("Batch started");
    state.batch = await api("/api/batch");
    renderBatches();
    pollBatchJob();
  } catch (e) {
    toast(e.message);
  }
});
$("#suggest").addEventListener("click", async () => {
  const r = await api("/api/queue/suggest", { method: "POST" });
  toast(r.added ? `Added ${r.added} varied items` : "Nothing left to suggest");
  loadBatches();
});
$("#tp-default").addEventListener("click", async () => {
  if (!confirm("Download 8 test photos (about 2 MB) from Unsplash via picsum.photos into your test-photos folder, with their credits?")) return;
  const btn = $("#tp-default");
  btn.disabled = true;
  btn.textContent = "Downloading…";
  try {
    const r = await api("/api/testphotos/default", { method: "POST" });
    toast(`Test photos: ${r.saved.length} downloaded${r.skipped.length ? `, ${r.skipped.length} already there` : ""}`);
    await loadBatches();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Download default set";
  }
});

// Sliders: live value while dragging, save on release.
document.addEventListener("input", (e) => {
  const s = e.target.closest?.("[data-slider]");
  if (s) $(`#v-${s.dataset.slider}`).textContent = s.value;
});
document.addEventListener("change", (e) => {
  const s = e.target.closest?.("[data-slider]");
  if (s && state.draft) {
    const settings = { ...state.draft.settings, [s.dataset.slider]: Number(s.value) };
    if (Number(s.value) === 0) delete settings[s.dataset.slider];
    return updateDraft({ settings });
  }
  if (e.target.id === "rv-lr") return updateDraft({ lrVerified: e.target.checked }, e.target.checked ? "Marked as checked in Lightroom" : "");
});
document.addEventListener("focusout", (e) => {
  if (!state.draft) return;
  if (e.target.id === "rv-name" && e.target.value.trim() && e.target.value.trim() !== state.draft.name) updateDraft({ name: e.target.value.trim() }, "Name saved");
  if (e.target.id === "rv-desc" && e.target.value !== state.draft.description) updateDraft({ description: e.target.value }, "Description saved");
});
// Press and hold a render to compare with the original photo.
document.addEventListener("pointerdown", (e) => e.target.closest?.("[data-render]")?.classList.add("show-before"));
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) document.addEventListener(ev, () => document.querySelectorAll(".render.show-before").forEach((r) => r.classList.remove("show-before")), true);

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
    if (state.route === "review") await loadReview();
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
