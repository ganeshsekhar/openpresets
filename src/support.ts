// Ask for support at the moment of value.
//
// The first download of each visit waits 10 seconds behind a small card that
// tells the open-source story. Every later download in that visit is instant.
// Clicking "Buy me a coffee" during the wait starts the download right away and
// skips the wait for 30 days (honour system — we can't verify payments).
import { config } from "./config";
import { esc, toast } from "./util";

export const WAIT_SECONDS = 10;
const DAY = 86_400_000;
const KEY_SUPPORTED = "op-support-clicked"; // localStorage: timestamp of last coffee click
const KEY_WAITED = "op-waited"; // sessionStorage: the one wait for this visit has happened

const read = (s: () => Storage, k: string) => {
  try {
    return s().getItem(k);
  } catch {
    return null;
  }
};
const write = (s: () => Storage, k: string, v: string) => {
  try {
    s().setItem(k, v);
  } catch {}
};
const local = () => localStorage;
const session = () => sessionStorage;

const isSupporter = () => {
  const t = Number(read(local, KEY_SUPPORTED));
  return t > 0 && Date.now() - t < 30 * DAY;
};
const needsWait = () => !read(session, KEY_WAITED) && !isSupporter();

const COFFEE = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8zm13 1h1.5a2.5 2.5 0 0 1 0 5H17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 3.5c0 1 1 1 1 2M12 3.5c0 1 1 1 1 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

let card: HTMLElement | null = null;
let tick = 0;
let closeTimer = 0;

function removeCard() {
  clearInterval(tick);
  clearTimeout(closeTimer);
  const el = card;
  card = null;
  if (!el) return;
  el.classList.remove("show");
  setTimeout(() => el.remove(), 450);
}

function waitCard(what: string, run: () => void) {
  card?.remove();
  write(session, KEY_WAITED, "1"); // counts even if cancelled: one wait per visit, never two
  let left = WAIT_SECONDS;
  let done = false;

  const el = (card = document.createElement("aside"));
  el.className = "support-card glass";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Download starting");
  el.innerHTML = `
    <div class="sc-head">
      <span class="sc-ring" aria-hidden="true"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="${RING_R}" class="track"/><circle cx="18" cy="18" r="${RING_R}" class="bar" style="stroke-dasharray:${RING_C};stroke-dashoffset:0"/></svg><b>${left}</b></span>
      <p class="sc-done" aria-live="polite"><span class="sc-status">Preparing ${esc(what)}…</span></p>
    </div>
    <p class="sc-title">Free forever, <i>funded by people like you.</i></p>
    <p class="sc-body">This 10-second wait happens once per visit. That's the whole price: no paywall, no ads, no sign-up. Buy a coffee and skip the wait for 30 days.</p>
    <div class="sc-actions">
      <a class="coffee" href="${esc(config.donateUrl)}" target="_blank" rel="noopener" data-sc="coffee">${COFFEE}Buy me a coffee</a>
      <button class="btn btn-ghost" type="button" data-sc="cancel">Cancel</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  const ring = el.querySelector<SVGCircleElement>(".bar")!;
  const num = el.querySelector<HTMLElement>(".sc-ring b")!;
  const status = el.querySelector<HTMLElement>(".sc-status")!;
  const actions = el.querySelector<HTMLElement>(".sc-actions")!;

  const finish = (thanks: boolean) => {
    if (done) return;
    done = true;
    clearInterval(tick);
    run();
    num.textContent = "✓";
    ring.style.strokeDashoffset = String(RING_C);
    el.classList.add("finished");
    status.textContent = `${what} downloaded`;
    el.querySelector(".sc-title")!.innerHTML = thanks ? "Thank you. <i>Seriously.</i>" : "Enjoy the preset.";
    el.querySelector(".sc-body")!.textContent = thanks
      ? "Your support keeps OpenPresets free for everyone. Downloads are instant for you for the next 30 days."
      : "If it's useful, a coffee keeps OpenPresets free for everyone, and skips the wait next time.";
    actions.innerHTML = thanks
      ? `<button class="btn btn-ghost" type="button" data-sc="close">Close</button>`
      : `<a class="coffee" href="${esc(config.donateUrl)}" target="_blank" rel="noopener" data-sc="coffee-after">${COFFEE}Buy me a coffee</a><button class="btn btn-ghost" type="button" data-sc="close">Close</button>
         <button class="sc-again" type="button" data-sc="again">Didn't start? Download again</button>`;
    closeTimer = window.setTimeout(removeCard, 9000);
  };

  el.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-sc]");
    if (!t) return;
    const a = t.dataset.sc;
    if (a === "coffee") {
      write(local, KEY_SUPPORTED, String(Date.now()));
      finish(true); // the link still opens in a new tab
    } else if (a === "coffee-after") {
      write(local, KEY_SUPPORTED, String(Date.now()));
      removeCard();
    } else if (a === "cancel") {
      removeCard();
      toast("Download cancelled");
    } else if (a === "again") run();
    else if (a === "close") removeCard();
  });
  el.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  el.addEventListener("pointerleave", () => done && (closeTimer = window.setTimeout(removeCard, 5000)));

  // Drive the ring with a CSS transition; the number ticks every second.
  requestAnimationFrame(() => {
    ring.style.transition = `stroke-dashoffset ${WAIT_SECONDS}s linear`;
    ring.style.strokeDashoffset = String(RING_C);
  });
  tick = window.setInterval(() => {
    left -= 1;
    num.textContent = String(Math.max(left, 0));
    if (left <= 0) finish(false);
  }, 1000);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && card) removeCard();
});

/**
 * Run a download, waiting once per visit first. `what` names the download
 * (a preset name or e.g. "24 presets"); `run` actually saves the file.
 */
export function gateDownload(what: string, run: () => void) {
  if (card) return; // a wait is already in progress
  if (needsWait()) return waitCard(what, run);
  run();
  toast(`✓ ${what} downloaded`);
}
