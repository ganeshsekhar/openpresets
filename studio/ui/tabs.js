// Accessible tabs (WAI-ARIA tabs pattern). Panels are existing elements found
// by id; the component only toggles them. Arrow keys / Home / End move focus
// and select, like native tab bars.
//
//   const t = tabs(el, { items: [{ id, label, panel, badge?, tone?, disabled? }], active, onChange });
//   t.update({ items, active });  t.select(id);  t.active

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function tabs(el, { items = [], active, onChange } = {}) {
  let list = items;
  let cur = active ?? list[0]?.id;

  function draw() {
    el.classList.add("tabs");
    el.setAttribute("role", "tablist");
    el.innerHTML = list.map((t) => {
      const on = t.id === cur;
      return `<button type="button" role="tab" id="tab-${esc(t.id)}" data-tab="${esc(t.id)}" aria-controls="${esc(t.panel)}"
        aria-selected="${on}" tabindex="${on ? 0 : -1}" ${t.disabled ? 'aria-disabled="true"' : ""}>
        <span>${esc(t.label)}</span>${t.badge ? `<b class="tab-badge ${esc(t.tone ?? "")}">${esc(t.badge)}</b>` : ""}</button>`;
    }).join("");
    for (const t of list) {
      const p = document.getElementById(t.panel);
      if (!p) continue;
      p.hidden = t.id !== cur;
      p.setAttribute("role", "tabpanel");
      p.setAttribute("aria-labelledby", `tab-${t.id}`);
    }
  }

  function select(id, focus = false) {
    const t = list.find((x) => x.id === id);
    if (!t || t.disabled) return;
    const changed = id !== cur;
    cur = id;
    draw();
    if (focus) el.querySelector(`[data-tab="${CSS.escape(id)}"]`)?.focus();
    if (changed) onChange?.(id);
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) select(b.dataset.tab);
  });
  el.addEventListener("keydown", (e) => {
    const enabled = list.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.id === cur);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: enabled.length - 1 }[e.key];
    if (to === undefined || !enabled.length) return;
    e.preventDefault();
    select(enabled[(to + enabled.length) % enabled.length].id, true);
  });

  draw();
  return {
    update(next = {}) {
      if (next.items) list = next.items;
      if (next.active) cur = next.active;
      if (list.find((t) => t.id === cur)?.disabled) cur = list.find((t) => !t.disabled)?.id ?? cur;
      draw();
    },
    select,
    get active() { return cur; },
  };
}
