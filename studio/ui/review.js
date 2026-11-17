// Review screen: live in-browser preview (same renderer as the server), a
// Lightroom-style panel, and quiet background saving. Re-renders the DOM only
// when you switch drafts; slider moves update canvases and labels in place.
import { applySettings, SLIDERS } from "/ui/renderer-core.js";

const SLIDER = Object.fromEntries(SLIDERS.map((s) => [s.key, s]));
const COLORS = ["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"];
const SWATCH = { Red: "#e5484d", Orange: "#f2994a", Yellow: "#f2c94c", Green: "#46a758", Aqua: "#2bb5c2", Blue: "#3e7bfa", Purple: "#8e4ec6", Magenta: "#d6409f" };
const RAINBOW = "linear-gradient(90deg,#e5484d,#f2c94c,#46a758,#2bb5c2,#3e7bfa,#8e4ec6,#d6409f,#e5484d)";
const SECTIONS = [
  { id: "basic", title: "Basic", open: true, keys: ["IncrementalTemperature", "IncrementalTint", "Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012", "Fade", "Vibrance", "Saturation"] },
  { id: "grade", title: "Colour grading", open: false, keys: ["ColorGradeShadowHue", "ColorGradeShadowSat", "ColorGradeMidtoneHue", "ColorGradeMidtoneSat", "ColorGradeHighlightHue", "ColorGradeHighlightSat", "ColorGradeBlending"] },
  { id: "mixer", title: "Colour mixer", open: false, mixer: true },
  { id: "effects", title: "Effects", open: false, keys: ["GrainAmount", "PostCropVignetteAmount"] },
];
const MAIN_W = 960;
const THUMB_W = 240;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const $ = (s, root = document) => root.querySelector(s);

// ---------- state ----------
const R = {
  ctx: null, // { api, toast, onChanged, taxonomy }
  draft: null,
  settings: {},
  baseline: {}, // settings when the draft was opened (for change dots / reset)
  photos: [],
  selected: 0,
  before: false,
  mixerTab: "Hue",
  images: new Map(), // url -> ImageData
  frame: 0,
  thumbTimer: 0,
  saveTimer: 0,
  saving: false,
  pendingSave: false,
};

// ---------- pixels ----------
function loadImageData(url, width) {
  const key = `${url}|${width}`;
  if (R.images.has(key)) return R.images.get(key);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const h = Math.round((img.naturalHeight / img.naturalWidth) * width);
      const c = document.createElement("canvas");
      c.width = width;
      c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, width, h);
      resolve(g.getImageData(0, 0, width, h));
    };
    img.onerror = reject;
    img.src = url;
  });
  R.images.set(key, p);
  return p;
}

function paint(canvas, base, settings, before) {
  if (!canvas || !base) return;
  if (canvas.width !== base.width) { canvas.width = base.width; canvas.height = base.height; }
  const out = new ImageData(new Uint8ClampedArray(base.data), base.width, base.height);
  if (!before) applySettings(out.data, base.width, base.height, 4, settings);
  canvas.getContext("2d").putImageData(out, 0, 0);
}

async function drawMain() {
  const p = R.photos[R.selected];
  if (!p) return;
  const base = await loadImageData(`/testphoto/${encodeURIComponent(p.file)}?w=${MAIN_W}`, MAIN_W);
  paint($("#rv-canvas"), base, R.settings, R.before);
}
function scheduleMain() {
  cancelAnimationFrame(R.frame);
  R.frame = requestAnimationFrame(drawMain);
}
async function drawThumbs() {
  const canvases = document.querySelectorAll("[data-thumb]");
  for (const c of canvases) {
    const p = R.photos[Number(c.dataset.thumb)];
    const base = await loadImageData(`/testphoto/${encodeURIComponent(p.file)}?w=${THUMB_W}`, THUMB_W);
    paint(c, base, R.settings, false);
  }
}
function scheduleThumbs() {
  clearTimeout(R.thumbTimer);
  R.thumbTimer = setTimeout(drawThumbs, 180);
}

// ---------- saving ----------
function setStatus(text, kind = "") {
  const el = $("#rv-save");
  if (!el) return;
  el.textContent = text;
  el.className = `save-status ${kind}`;
}
function scheduleSave() {
  setStatus("Unsaved changes…", "pending");
  clearTimeout(R.saveTimer);
  R.saveTimer = setTimeout(save, 600);
}
async function save() {
  if (R.saving) { R.pendingSave = true; return; }
  R.saving = true;
  setStatus("Saving…", "pending");
  try {
    const clean = Object.fromEntries(Object.entries(R.settings).filter(([, v]) => v !== 0 && v !== "" && v != null));
    const d = await R.ctx.api(`/api/drafts/${R.draft.id}`, { method: "POST", body: { settings: clean } });
    R.draft = { ...R.draft, ...d };
    setStatus(`Saved · v${d.version}`, "ok");
    refreshVersions();
    R.ctx.onChanged?.(d);
  } catch (e) {
    setStatus(`Not saved: ${e.message}`, "err");
  } finally {
    R.saving = false;
    if (R.pendingSave) { R.pendingSave = false; save(); }
  }
}
async function refreshVersions() {
  try {
    const full = await R.ctx.api(`/api/drafts/${R.draft.id}`);
    const box = $("#rv-versions");
    if (box) box.innerHTML = versionsHTML(full);
  } catch {}
}

// ---------- sliders ----------
function trackStyle(key) {
  const k = key;
  if (k === "IncrementalTemperature") return "linear-gradient(90deg,#3e7bfa,#d9d9d9,#f2c94c)";
  if (k === "IncrementalTint") return "linear-gradient(90deg,#46a758,#d9d9d9,#d6409f)";
  if (/^ColorGrade\w+Hue$/.test(k)) return RAINBOW;
  if (/^ColorGrade(\w+)Sat$/.test(k)) {
    const zone = k.match(/^ColorGrade(\w+)Sat$/)[1];
    const hue = Number(R.settings[`ColorGrade${zone}Hue`] ?? 0);
    return `linear-gradient(90deg,#9a9a9a,hsl(${hue} 85% 55%))`;
  }
  const m = k.match(/^(Hue|Saturation|Luminance)Adjustment(\w+)$/);
  if (m) {
    const c = SWATCH[m[2]];
    if (m[1] === "Hue") {
      const i = COLORS.indexOf(m[2]);
      return `linear-gradient(90deg,${SWATCH[COLORS[(i + 7) % 8]]},${c},${SWATCH[COLORS[(i + 1) % 8]]})`;
    }
    if (m[1] === "Saturation") return `linear-gradient(90deg,#9a9a9a,${c})`;
    return `linear-gradient(90deg,#1a1a1a,${c},#fafafa)`;
  }
  if (k === "Exposure2012" || k === "Whites2012" || k === "Highlights2012" || k === "Shadows2012" || k === "Blacks2012") return "linear-gradient(90deg,#1a1a1a,#fafafa)";
  return "";
}

const fmt = (key, v) => {
  const s = SLIDER[key];
  if (key.endsWith("Hue")) return `${Math.round(v)}°`;
  return s.step < 1 ? (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2)) : v > 0 && s.min < 0 ? `+${Math.round(v)}` : String(Math.round(v));
};
const val = (key) => Number(R.settings[key] ?? 0) || 0;

function sliderRow(key, label) {
  const s = SLIDER[key];
  const v = val(key);
  const changed = v !== (Number(R.baseline[key] ?? 0) || 0);
  const track = trackStyle(key);
  return `<div class="ls${changed ? " changed" : ""}" data-row="${key}">
    <label for="ls-${key}" title="Double-click to reset">${esc(label ?? s.label)}</label>
    <input class="ls-num" type="text" inputmode="decimal" value="${fmt(key, v)}" data-num="${key}" aria-label="${esc(s.label)} value" />
    <input id="ls-${key}" class="ls-range${track ? " tracked" : ""}" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" data-key="${key}" style="${track ? `--track:${track}` : ""}" />
  </div>`;
}

function sectionHTML(sec) {
  const mono = String(R.settings.ConvertToGrayscale ?? "").toLowerCase() === "true";
  if (mono && (sec.id === "grade" || sec.id === "mixer")) return "";
  let body;
  if (sec.mixer) {
    const kind = R.mixerTab;
    body = `<div class="seg" role="tablist">${["Hue", "Saturation", "Luminance"].map((t) => `<button type="button" role="tab" aria-selected="${t === kind}" data-mixer="${t}">${t}</button>`).join("")}</div>
      ${COLORS.map((c) => sliderRow(`${kind}Adjustment${c}`, c)).join("")}`;
  } else body = sec.keys.map((k) => sliderRow(k)).join("");
  return `<details class="lsec" data-sec="${sec.id}" ${R.openSecs.has(sec.id) ? "open" : ""}><summary>${esc(sec.title)}</summary>${body}</details>`;
}

function setValue(key, raw) {
  const s = SLIDER[key];
  let v = Number(raw);
  if (!Number.isFinite(v)) return;
  if (key.endsWith("Hue")) v = ((Math.round(v) % 360) + 360) % 360;
  else v = Math.min(s.max, Math.max(s.min, v));
  v = s.step < 1 ? Math.round(v / s.step) * s.step : Math.round(v);
  R.settings[key] = Math.round(v * 100) / 100;
  // update just this row (and dependent sat tracks for grading hues)
  const row = document.querySelector(`[data-row="${key}"]`);
  if (row) {
    row.querySelector("[data-key]").value = R.settings[key];
    const num = row.querySelector("[data-num]");
    if (document.activeElement !== num) num.value = fmt(key, R.settings[key]);
    row.classList.toggle("changed", R.settings[key] !== (Number(R.baseline[key] ?? 0) || 0));
  }
  const zone = key.match(/^ColorGrade(\w+)Hue$/)?.[1];
  if (zone) {
    const sat = document.querySelector(`[data-key="ColorGrade${zone}Sat"]`);
    if (sat) sat.style.setProperty("--track", trackStyle(`ColorGrade${zone}Sat`));
  }
  scheduleMain();
  scheduleThumbs();
  scheduleSave();
}

// ---------- markup ----------
function versionsHTML(d) {
  return (d.versions ?? []).map((v) => `<button type="button" data-restore="${v.version}" ${v.version === d.version ? "disabled" : ""}>
    v${v.version} · ${esc(v.source === "fit" ? "first draft" : v.source)}${v.note ? ` · ${esc(v.note)}` : ""}${v.version === d.version ? " · current" : ""}</button>`).join("");
}

function render(root, args) {
  const { drafts, draft, photos, ctx } = args;
  R.ctx = ctx;
  const switching = args.fresh || !R.draft || R.draft.id !== draft.id;
  R.draft = draft;
  R.photos = photos;
  if (switching) {
    R.settings = { ...draft.settings };
    R.baseline = { ...draft.settings };
    R.selected = Math.min(R.selected, Math.max(0, photos.length - 1));
    R.openSecs ??= new Set(SECTIONS.filter((s) => s.open).map((s) => s.id));
  }
  const status = draft.status;
  root.innerHTML = `
    <nav class="rv-list" aria-label="Drafts in this batch">${drafts.map((x) => `<a href="#processing/${x.id}" ${x.id === draft.id ? 'aria-current="page"' : ""}>
        <span>${esc(x.name)}</span><span class="dot-status ${x.status}" title="${x.status}"></span></a>`).join("")}</nav>

    <section class="rv2-main">
      <header class="rv2-head">
        <div><h1>${esc(draft.name)}</h1><p class="muted small">${esc(draft.description)}</p></div>
        <span class="pill ${status}">${status === "draft" ? "To review" : status === "approved" ? "Approved" : "Rejected"}</span>
      </header>

      <div class="rv2-compare">
        <figure class="rv2-ref">
          <figcaption>Reference</figcaption>
          ${draft.refs.map((r) => `<img src="/thumb/${r.sha256}.webp" alt="Reference still" />`).join("")}
          <span class="muted small">${esc(draft.refs.map((r) => `${r.title}${r.stillNo != null ? ` #${r.stillNo}` : ""}`).join(" · "))}</span>
        </figure>
        <figure class="rv2-preview">
          <div class="rv2-toolbar">
            <span class="muted small">${esc(photos[R.selected]?.subject ?? "")} · live preview</span>
            <div class="seg small-seg" role="group" aria-label="Before or after">
              <button type="button" data-ba="after" aria-pressed="${!R.before}">After</button>
              <button type="button" data-ba="before" aria-pressed="${R.before}">Before</button>
            </div>
          </div>
          <canvas id="rv-canvas" aria-label="Preview of the preset on a test photo"></canvas>
          <p class="muted small">Hold the photo or press <kbd>\\</kbd> to compare. Approximation of Lightroom.</p>
        </figure>
      </div>

      <div class="filmstrip" role="listbox" aria-label="Test photos">${photos.map((p, i) => `<button type="button" role="option" aria-selected="${i === R.selected}" data-pick="${i}" title="${esc(p.subject)}">
          <canvas data-thumb="${i}"></canvas><span>${esc(p.subject)}</span></button>`).join("")}</div>
    </section>

    <aside class="rv2-side">
      <div class="rv2-card">
        <div class="rv2-actions">
          <button class="btn primary" type="button" data-status="approved" ${status === "approved" ? "disabled" : ""}>${status === "approved" ? "Approved ✓" : "Approve"}</button>
          <button class="btn" type="button" data-status="rejected" ${status === "rejected" ? "disabled" : ""}>Reject</button>
        </div>
        <div class="rv2-row"><span class="save-status" id="rv-save">Saved · v${draft.version}</span>
          ${status !== "draft" ? `<button class="link" type="button" data-status="draft">Undo</button>` : ""}</div>
        ${draft.nameIssues?.length ? `<p class="issue">Name contains “${esc(draft.nameIssues[0])}” (film, credit or brand). Rename it under More.</p>` : ""}
      </div>

      <div class="rv2-card tools">
        <div class="tools-head"><b>Adjust</b><span class="grow"></span>
          <button class="link" type="button" data-reset-all title="Back to how it was when you opened this draft">Reset</button></div>
        ${SECTIONS.map(sectionHTML).join("")}
      </div>

      <details class="rv2-card more"${draft.nameIssues?.length ? " open" : ""}>
        <summary><b>More</b> <span class="muted small">name, export, Claude, versions</span></summary>
        <label class="f">Name<input type="text" id="rv-name" value="${esc(draft.name)}" maxlength="60" /></label>
        <label class="f">Description<textarea id="rv-desc" rows="2" maxlength="300">${esc(draft.description)}</textarea></label>
        <div class="rv2-row"><label class="check small"><input type="checkbox" id="rv-lr" ${draft.lrVerified ? "checked" : ""} /> Checked in Lightroom</label>
          <span class="grow"></span><a class="link" href="/api/drafts/${draft.id}/xmp">Export .xmp</a></div>
        <div class="more-block"><b class="small">Refine with Claude</b>
          <textarea id="rv-note" rows="2" placeholder="e.g. softer blacks, less green, keep skin natural"></textarea>
          <button class="btn" type="button" id="rv-refine">Refine</button>
          <p class="muted small">Uses your Claude plan via Claude Code on this Mac. Only when you click.</p></div>
        <div class="more-block"><b class="small">Versions</b><div class="versions" id="rv-versions">${versionsHTML(draft)}</div></div>
      </details>
    </aside>`;
  drawMain();
  drawThumbs();
}

// ---------- events (bound once) ----------
let bound = false;
function bind() {
  if (bound) return;
  bound = true;
  const inReview = (e) => e.target.closest?.("#review");

  document.addEventListener("input", (e) => {
    if (!inReview(e)) return;
    const r = e.target.closest("[data-key]");
    if (r) setValue(r.dataset.key, r.value);
  });
  document.addEventListener("change", async (e) => {
    if (!inReview(e)) return;
    const n = e.target.closest("[data-num]");
    if (n) return setValue(n.dataset.num, String(n.value).replace(/[°+]/g, ""));
    if (e.target.id === "rv-lr") {
      await R.ctx.api(`/api/drafts/${R.draft.id}`, { method: "POST", body: { lrVerified: e.target.checked } });
      R.ctx.toast(e.target.checked ? "Marked as checked in Lightroom" : "Unmarked");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!document.querySelector("#rv-canvas")) return;
    const n = e.target.closest?.("[data-num]");
    if (n && e.key === "Enter") { n.blur(); return; }
    if (n && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const s = SLIDER[n.dataset.num];
      setValue(n.dataset.num, val(n.dataset.num) + (e.key === "ArrowUp" ? 1 : -1) * s.step * (e.shiftKey ? 10 : 1));
      return;
    }
    if (e.key === "\\" && !["INPUT", "TEXTAREA"].includes(e.target.tagName)) {
      R.before = !R.before;
      document.querySelectorAll("[data-ba]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.ba === "before") === R.before)));
      drawMain();
    }
  });
  document.addEventListener("dblclick", (e) => {
    if (!inReview(e)) return;
    const row = e.target.closest("[data-row]");
    if (row && !e.target.closest("[data-num]")) setValue(row.dataset.row, 0);
  });
  document.addEventListener("click", async (e) => {
    if (!inReview(e)) return;
    const t = e.target;
    const pick = t.closest("[data-pick]");
    if (pick) {
      R.selected = Number(pick.dataset.pick);
      document.querySelectorAll("[data-pick]").forEach((b) => b.setAttribute("aria-selected", String(b === pick)));
      const label = document.querySelector(".rv2-toolbar .muted");
      if (label) label.textContent = `${R.photos[R.selected].subject} · live preview`;
      return drawMain();
    }
    const ba = t.closest("[data-ba]");
    if (ba) {
      R.before = ba.dataset.ba === "before";
      document.querySelectorAll("[data-ba]").forEach((b) => b.setAttribute("aria-pressed", String(b === ba)));
      return drawMain();
    }
    const mx = t.closest("[data-mixer]");
    if (mx) {
      R.mixerTab = mx.dataset.mixer;
      const sec = document.querySelector('[data-sec="mixer"]');
      sec.outerHTML = sectionHTML(SECTIONS.find((s) => s.id === "mixer"));
      document.querySelector('[data-sec="mixer"]').open = true;
      return;
    }
    if (t.closest("[data-reset-all]")) {
      for (const k of new Set([...Object.keys(R.settings), ...Object.keys(R.baseline)])) {
        if (SLIDER[k]) setValue(k, Number(R.baseline[k] ?? 0));
      }
      return;
    }
    const st = t.closest("[data-status]");
    if (st) {
      clearTimeout(R.saveTimer);
      if (R.pendingSave || document.querySelector(".save-status.pending")) await save();
      const status = st.dataset.status;
      const rejectReason = status === "rejected" ? prompt("Why reject it? (optional, helps tune future drafts)") ?? "" : undefined;
      try {
        await R.ctx.api(`/api/drafts/${R.draft.id}`, { method: "POST", body: { status, rejectReason } });
        R.ctx.toast(status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Back to draft");
        R.ctx.reload(status !== "draft");
      } catch (err) {
        R.ctx.toast(err.message);
      }
      return;
    }
    const restore = t.closest("[data-restore]");
    if (restore) {
      const d = await R.ctx.api(`/api/drafts/${R.draft.id}`, { method: "POST", body: { restoreVersion: Number(restore.dataset.restore) } });
      R.ctx.toast(`Restored v${restore.dataset.restore}`);
      R.draft = null; // force a fresh open with the restored settings
      R.ctx.reload(false, d.id);
    }
  });
  document.addEventListener("focusout", async (e) => {
    if (!inReview(e) || !R.draft) return;
    const field = e.target.id === "rv-name" ? "name" : e.target.id === "rv-desc" ? "description" : null;
    if (!field) return;
    const v = e.target.value.trim();
    if (!v || v === R.draft[field]) return;
    try {
      const d = await R.ctx.api(`/api/drafts/${R.draft.id}`, { method: "POST", body: { [field]: v } });
      R.draft = { ...R.draft, ...d };
      if (field === "name") {
        document.querySelector(".rv2-head h1").textContent = d.name;
        document.querySelector('.rv-list [aria-current="page"] span').textContent = d.name;
      }
      R.ctx.toast(field === "name" ? "Name saved" : "Description saved");
    } catch (err) {
      R.ctx.toast(err.message);
    }
  });
  // Press and hold the preview to see the original.
  document.addEventListener("pointerdown", (e) => {
    if (e.target.id === "rv-canvas") { R.holding = true; paintHold(true); }
  });
  for (const ev of ["pointerup", "pointercancel"]) {
    document.addEventListener(ev, () => { if (R.holding) { R.holding = false; paintHold(false); } });
  }
  document.addEventListener("toggle", (e) => {
    const sec = e.target.closest?.("[data-sec]");
    if (sec) sec.open ? R.openSecs.add(sec.dataset.sec) : R.openSecs.delete(sec.dataset.sec);
  }, true);
}
async function paintHold(on) {
  const prev = R.before;
  R.before = on || prev;
  await drawMain();
  if (!on) { R.before = document.querySelector('[data-ba="before"]')?.getAttribute("aria-pressed") === "true"; await drawMain(); }
}

export function renderReview(root, args) {
  bind();
  render(root, args);
}

/** Save any pending change before leaving the page or switching drafts. */
export async function flushReview() {
  if (document.querySelector(".save-status.pending") && R.draft) {
    clearTimeout(R.saveTimer);
    await save();
  }
}
