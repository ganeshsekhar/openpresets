// Library (M4): every approved preset, what is on the site, and the publish flow
//   choose → Stage (writes repo files) → Preview locally → Publish live (push).
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const $ = (s) => document.querySelector(s);
const STATE = {
  new: ["New", "Goes live on publish"],
  updated: ["Updated", "Changes go live on publish"],
  live: ["Live", "On openpresets.com"],
  removing: ["Removing", "Taken down on publish"],
  off: ["Not on site", "Approved, not listed"],
};
const FILTERS = [["all", "All"], ["site", "On site"], ["ready", "Ready to add"], ["changes", "Changes"]];

const L = { ctx: null, data: null, filter: "all", editing: null, picks: [], polling: false };

export async function loadLibrary(ctx) {
  L.ctx = ctx;
  L.data = await ctx.api("/api/library");
  render();
  if (L.data.job) poll();
}

function counts(items) {
  return {
    all: items.length,
    site: items.filter((i) => i.state === "live" || i.state === "updated" || i.state === "new").length,
    ready: items.filter((i) => i.state === "off").length,
    changes: items.filter((i) => ["new", "updated", "removing"].includes(i.state)).length,
  };
}

function publishBar() {
  const d = L.data;
  const items = d.items;
  const n = (s) => items.filter((i) => i.state === s).length;
  const live = n("live") + n("updated");
  const staged = d.staged.length > 0;
  if (d.job) {
    return `<div class="pub-bar busy"><span class="spinner" aria-hidden="true"></span><div><b>${esc(d.job.label)}…</b><span class="muted small">${esc(d.job.progress ?? "")}</span></div></div>`;
  }
  const last = d.lastPublish && !d.lastPublish.ok ? `<p class="pub-error" role="alert">${esc(d.lastPublish.message)}</p>` : "";
  const changes = [n("new") && `${n("new")} new`, n("updated") && `${n("updated")} updated`, n("removing") && `${n("removing")} to remove`].filter(Boolean).join(" · ");
  const steps = `<ol class="pub-steps">
      <li class="${d.pending ? "current" : "done"}"><b>1</b>Choose</li>
      <li class="${staged ? (d.pending && !staged ? "current" : "done") : d.pending ? "current" : ""}"><b>2</b>Stage &amp; preview</li>
      <li class="${staged ? "current" : ""}"><b>3</b>Publish live</li></ol>`;
  if (!d.pending && !staged) {
    return `<div class="pub-bar calm"><div><b>Site is up to date</b><span class="muted small">${live ? `${live} preset${live === 1 ? "" : "s"} live on openpresets.com` : "Nothing published yet. Add approved presets to the site below."}</span></div>${steps}</div>${last}`;
  }
  return `<div class="pub-bar">
      <div><b>${changes || "Staged files ready"}</b><span class="muted small">${staged
        ? "Written into the repo on this Mac, not live yet. Preview it, then publish."
        : "Stage writes the site files (presets list, before/after images, credits) into the repo. Nothing goes live yet."}</span></div>
      ${steps}
      <div class="pub-actions">
        ${staged ? `<button class="btn sm ghost" type="button" data-lib="discard">Discard</button>` : ""}
        ${staged ? `<button class="btn sm" type="button" data-lib="preview">Preview site locally ↗</button>` : ""}
        <button class="btn sm ${staged ? "" : "primary"}" type="button" data-lib="stage">${staged ? "Stage again" : "Stage changes"}</button>
        ${staged ? `<button class="btn sm primary" type="button" data-lib="publish">Publish live</button>` : ""}
      </div>
    </div>${last}`;
}

function card(i) {
  const [label, hint] = STATE[i.state];
  const cover = i.gallery[0];
  const editing = L.editing === i.id;
  return `<article class="lib-card ${i.state}${editing ? " editing" : ""}" data-id="${i.id}">
    <div class="lib-cover">${cover ? `<img src="/render/${i.id}/${encodeURIComponent(cover)}?w=480&h=${i.hash}" alt="${esc(i.name)} on a test photo" loading="lazy" />` : ""}
      <span class="lib-state ${i.state}" title="${esc(hint)}">${label}</span>
      <span class="lib-count" title="Photos shown on the site">${i.gallery.length} photo${i.gallery.length === 1 ? "" : "s"}</span></div>
    <div class="lib-body">
      <div class="lib-title"><b>${esc(i.name)}</b>${i.presetId ? `<span class="muted small">${esc(i.presetId)}</span>` : ""}</div>
      <div class="lib-chips">${[...i.goodFor.slice(0, 2), ...i.mood.slice(0, 1)].map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
      <div class="lib-meta muted small">${i.lrVerified ? "✓ Checked in Lightroom" : "Not checked in Lightroom"}</div>
      <div class="lib-actions">
        ${i.listed && i.status === "approved"
          ? `<button class="btn sm ghost" type="button" data-lib="unlist">Remove from site</button>`
          : i.status === "approved" ? `<button class="btn sm primary" type="button" data-lib="list">Add to site</button>` : `<span class="muted small">Rejected after publishing</span>`}
        <button class="btn sm ghost" type="button" data-lib="photos" aria-expanded="${editing}">Photos</button>
        <a class="btn sm ghost" href="/api/drafts/${i.id}/xmp" title="Download the .xmp to check it in Lightroom">.xmp</a>
      </div>
    </div>
    ${editing ? pickerHTML(i) : ""}
  </article>`;
}

function pickerHTML(i) {
  const photos = L.data.photos;
  return `<div class="lib-picker">
    <p class="small">Pick up to ${L.data.galleryMax} photos for the site. <b>1</b> is the cover.</p>
    <div class="pick-grid">${photos.map((p) => {
      const n = L.picks.indexOf(p.file);
      return `<button type="button" class="pick ${n >= 0 ? "on" : ""}" data-pick-file="${esc(p.file)}" aria-pressed="${n >= 0}" title="${esc(p.subject)}">
        <img src="/render/${i.id}/${encodeURIComponent(p.file)}?w=240&h=${i.hash}" alt="" loading="lazy" />${n >= 0 ? `<span>${n + 1}</span>` : ""}</button>`;
    }).join("")}</div>
    <div class="pick-actions"><button class="btn sm ghost" type="button" data-lib="photos-cancel">Cancel</button>
      <button class="btn sm primary" type="button" data-lib="photos-save" ${L.picks.length ? "" : "disabled"}>Save photos</button></div>
  </div>`;
}

function render() {
  const root = $("#library");
  if (!root || !L.data) return;
  const items = L.data.items;
  const c = counts(items);
  const f = L.filter;
  const shown = items.filter((i) => f === "all" || (f === "site" ? ["live", "updated", "new"].includes(i.state) : f === "ready" ? i.state === "off" : ["new", "updated", "removing"].includes(i.state)));
  const ready = items.filter((i) => i.state === "off" && i.status === "approved");
  root.innerHTML = `
    ${publishBar()}
    <div class="lib-toolbar">
      <div class="seg" role="group" aria-label="Show">${FILTERS.map(([v, l]) => `<button type="button" data-lib-filter="${v}" aria-pressed="${f === v}">${l} <span class="muted">${c[v]}</span></button>`).join("")}</div>
      <span class="grow"></span>
      ${ready.length ? `<button class="btn sm" type="button" data-lib="list-all">Add all ${ready.length} ready</button>` : ""}
    </div>
    ${shown.length ? `<div class="lib-grid">${shown.map(card).join("")}</div>` : emptyHTML(f, items.length)}`;
}

function emptyHTML(f, total) {
  if (!total) return `<div class="empty-start"><h2>No presets yet</h2><p class="muted">Approve drafts in Processing and they show up here, ready to add to the site.</p>
    <div class="es-actions"><a class="btn primary" href="#processing">Go to Processing</a></div></div>`;
  return `<div class="empty"><h2>Nothing here</h2><p class="muted">${f === "ready" ? "Every approved preset is already on the site." : f === "changes" ? "No changes waiting." : "Nothing on the site yet."}</p></div>`;
}

async function poll() {
  if (L.polling) return;
  L.polling = true;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1200));
      L.data = await L.ctx.api("/api/library");
      if (location.hash.startsWith("#library")) render();
      if (!L.data.job) break;
    }
    const lp = L.data.lastPublish;
    if (lp) L.ctx.toast(lp.ok ? (lp.kind === "live" ? `Published · ${lp.message}. The site updates in a minute or two.` : lp.message) : `Failed: ${lp.message}`);
    L.ctx.refreshNav();
  } finally {
    L.polling = false;
  }
}

async function act(name, card) {
  const id = card ? Number(card.dataset.id) : null;
  const item = L.data.items.find((i) => i.id === id);
  const api = L.ctx.api;
  switch (name) {
    case "list": case "unlist":
      await api("/api/library/list", { method: "POST", body: { ids: [id], listed: name === "list" } });
      break;
    case "list-all": {
      const ids = L.data.items.filter((i) => i.state === "off" && i.status === "approved").map((i) => i.id);
      await api("/api/library/list", { method: "POST", body: { ids, listed: true } });
      break;
    }
    case "photos":
      L.editing = L.editing === id ? null : id;
      L.picks = [...(item?.gallery ?? [])];
      return render();
    case "photos-cancel":
      L.editing = null;
      return render();
    case "photos-save":
      await api(`/api/library/${L.editing}/gallery`, { method: "POST", body: { files: L.picks } });
      L.editing = null;
      L.ctx.toast("Photos saved");
      break;
    case "stage":
      await api("/api/library/stage", { method: "POST" });
      L.data.job = { label: "Staging site files", progress: "Starting…" };
      render();
      return poll();
    case "discard":
      if (!confirm("Discard the staged site files? This restores presets.csv, previews and CREDITS.md in the repo to the last published version. Your presets in Studio are not affected.")) return;
      await api("/api/library/discard", { method: "POST" });
      L.ctx.toast("Staged files discarded");
      break;
    case "preview": {
      const w = window.open("about:blank", "_blank");
      const { url } = await api("/api/library/preview", { method: "POST" });
      if (w) w.location = url; else L.ctx.toast(`Site preview: ${url}`);
      return;
    }
    case "publish": {
      const n = (s) => L.data.items.filter((i) => i.state === s).map((i) => i.name);
      const lines = [...n("new").map((x) => `+ ${x}`), ...n("updated").map((x) => `~ ${x}`), ...n("removing").map((x) => `− ${x}`)];
      const firstTime = !L.data.items.some((i) => i.publishedAt);
      if (!confirm(`Publish to openpresets.com?\n\n${lines.join("\n") || "Refresh staged files"}${firstTime ? "\n\nFirst publish: the 24 placeholder presets are removed from the site." : ""}\n\nThis checks the site builds, commits presets.csv, previews and CREDITS.md, and pushes to main. The site updates in a minute or two.`)) return;
      await api("/api/library/publish", { method: "POST" });
      L.data.job = { label: "Publishing", progress: "Starting…" };
      render();
      return poll();
    }
  }
  L.data = await api("/api/library");
  render();
  L.ctx.refreshNav();
}

document.addEventListener("click", async (e) => {
  if (!e.target.closest?.("#library")) return;
  const f = e.target.closest("[data-lib-filter]");
  if (f) { L.filter = f.dataset.libFilter; return render(); }
  const pick = e.target.closest("[data-pick-file]");
  if (pick) {
    const file = pick.dataset.pickFile;
    const i = L.picks.indexOf(file);
    if (i >= 0) L.picks.splice(i, 1);
    else if (L.picks.length < L.data.galleryMax) L.picks.push(file);
    else return L.ctx.toast(`Up to ${L.data.galleryMax} photos. Remove one first.`);
    return render();
  }
  const b = e.target.closest("[data-lib]");
  if (!b || b.disabled) return;
  try {
    b.disabled = true;
    await act(b.dataset.lib, b.closest("[data-id]"));
  } catch (err) {
    L.ctx.toast(err.message);
    loadLibrary(L.ctx);
  }
});
