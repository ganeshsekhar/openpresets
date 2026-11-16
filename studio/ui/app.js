const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = { films: [], refs: [], film: "", showExcluded: false, summary: null, lb: -1 };

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

function metaLine(meta) {
  const parts = [];
  if (meta.Year) parts.push(meta.Year);
  if (meta["Director of Photography"]) parts.push(`DoP ${meta["Director of Photography"]}`);
  if (meta.Director) parts.push(`Dir. ${meta.Director}`);
  return parts.join(" · ");
}

function renderSummary() {
  const s = state.summary;
  if (!s) return;
  $("#stats").textContent = `${s.refs} stills · ${s.films} films${s.excluded ? ` · ${s.excluded} excluded` : ""}${
    s.lastImport ? ` · last import ${new Date(s.lastImport.at + "Z").toLocaleString()}` : ""
  }`;
  $("#folder").innerHTML = `Folder: <span class="folder-path" title="Click to copy" data-copy="${esc(s.refsDir)}">${esc(s.refsDir)}</span>`;
}

function renderFilms() {
  const sel = $("#film");
  sel.innerHTML =
    `<option value="">All films (${state.films.length})</option>` +
    state.films.map((f) => `<option value="${f.id}">${esc(f.title)} (${f.count})</option>`).join("");
  sel.value = state.film;
}

function renderGrid() {
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
    byFilm.get(r.filmId).push({ ...r, i });
  });
  content.innerHTML = [...byFilm]
    .map(([filmId, refs]) => {
      const f = state.films.find((x) => x.id === filmId) ?? { title: "Unknown", meta: {} };
      return `<section class="film">
        <div class="film-head"><h2>${esc(f.title)}</h2><span class="muted small">${esc(metaLine(f.meta))}</span>
          <span class="muted small">${refs.length} still${refs.length === 1 ? "" : "s"}</span></div>
        <div class="grid">${refs
          .map(
            (r) => `<div class="tile${r.excluded ? " excluded" : ""}" data-i="${r.i}">
              <img src="/thumb/${r.sha256}.webp" alt="" loading="lazy" />
              ${r.stillNo != null ? `<span class="no">#${r.stillNo}</span>` : ""}
              <button class="x" type="button" data-exclude="${r.id}" title="${r.excluded ? "Include again" : "Exclude"}" aria-label="${r.excluded ? "Include again" : "Exclude"}">${r.excluded ? "↺" : "✕"}</button>
            </div>`,
          )
          .join("")}</div>
      </section>`;
    })
    .join("");
}

async function load() {
  const qs = new URLSearchParams();
  if (state.film) qs.set("film", state.film);
  if (state.showExcluded) qs.set("excluded", "1");
  [state.summary, state.films, state.refs] = await Promise.all([api("/api/summary"), api("/api/films"), api(`/api/refs?${qs}`)]);
  renderSummary();
  renderFilms();
  renderGrid();
}

async function setExcluded(id, excluded) {
  await api(`/api/refs/${id}`, { method: "POST", body: { excluded } });
  const r = state.refs.find((x) => x.id === id);
  if (r) r.excluded = excluded ? 1 : 0;
  if (!state.showExcluded && excluded) state.refs = state.refs.filter((x) => x.id !== id);
  state.summary = await api("/api/summary");
  state.films = await api("/api/films");
  renderSummary();
  renderFilms();
  renderGrid();
  toast(excluded ? "Excluded from batches" : "Included again");
}

// ---------- lightbox ----------
function openLb(i) {
  state.lb = i;
  const r = state.refs[i];
  if (!r) return closeLb();
  const f = state.films.find((x) => x.id === r.filmId) ?? { title: "", meta: {} };
  $("#lb-img").src = `/full/${r.id}`;
  $("#lb-title").textContent = f.title;
  $("#lb-meta").textContent = [r.stillNo != null ? `#${r.stillNo}` : "", r.width && `${r.width}×${r.height}`, metaLine(f.meta)].filter(Boolean).join(" · ");
  const src = $("#lb-source");
  src.hidden = !r.sourceUrl;
  if (r.sourceUrl) src.href = r.sourceUrl;
  $("#lb-exclude").textContent = r.excluded ? "Include again" : "Exclude";
  $("#lightbox").hidden = false;
}
const closeLb = () => {
  state.lb = -1;
  $("#lightbox").hidden = true;
};
const stepLb = (d) => state.refs.length && openLb((state.lb + d + state.refs.length) % state.refs.length);

// ---------- events ----------
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
    if (result.errors.length) console.warn("Import errors", result.errors);
    await load();
  } catch (e) {
    toast(`Import failed: ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "Import from folder";
  }
});

$("#film").addEventListener("change", (e) => {
  state.film = e.target.value;
  load();
});
$("#show-excluded").addEventListener("change", (e) => {
  state.showExcluded = e.target.checked;
  load();
});

document.addEventListener("click", async (e) => {
  const t = e.target;
  const ex = t.closest("[data-exclude]");
  if (ex) {
    e.stopPropagation();
    const r = state.refs.find((x) => x.id === Number(ex.dataset.exclude));
    return setExcluded(Number(ex.dataset.exclude), !r?.excluded);
  }
  const copy = t.closest("[data-copy]");
  if (copy) {
    await navigator.clipboard?.writeText(copy.dataset.copy).catch(() => {});
    return toast("Folder path copied");
  }
  const tile = t.closest(".tile");
  if (tile) return openLb(Number(tile.dataset.i));
  const lb = t.closest("[data-lb]");
  if (lb) {
    const a = lb.dataset.lb;
    if (a === "close") closeLb();
    else if (a === "prev") stepLb(-1);
    else if (a === "next") stepLb(1);
    else if (a === "exclude") {
      const r = state.refs[state.lb];
      if (!r) return;
      const idx = state.lb;
      await setExcluded(r.id, !r.excluded);
      if (state.refs.length) openLb(Math.min(idx, state.refs.length - 1));
      else closeLb();
    }
    return;
  }
  if (t.id === "lightbox") closeLb();
});

document.addEventListener("keydown", (e) => {
  if ($("#lightbox").hidden) return;
  if (e.key === "Escape") closeLb();
  else if (e.key === "ArrowRight") stepLb(1);
  else if (e.key === "ArrowLeft") stepLb(-1);
  else if (e.key.toLowerCase() === "x") $("#lb-exclude").click();
});

load().catch((e) => {
  $("#stats").textContent = `Could not reach Studio: ${e.message}`;
});
