// Shared Material 3 building blocks: bottom sheets, dialogs, snackbars,
// pull-to-refresh, expanders, segmented buttons, icons. Every screen uses these
// so the whole app behaves the same way. Spec: DESIGN.md.

export const el = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
export const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const haptic = (ms = 8) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

// ---------- icons (24px, Material Symbols style, outline) ----------
const P = {
  refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  expand: '<path d="M6 9l6 6 6-6"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  remove: '<path d="M5 12h14"/>',
  more: '<circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/>',
  send: '<path d="M4 12l16-8-6 16-3-7-7-1z"/>',
  moon: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a6.5 6.5 0 0 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  cart: '<path d="M3 4h2l2.4 11h10.2L20 7H6.2"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  warn: '<path d="M12 3l10 18H2L12 3zM12 10v5M12 18v.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  open: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  store: '<path d="M4 9l1-5h14l1 5M4 9h16v11H4zM9 20v-6h6v6"/>',
};
export const icon = (name, cls = "") => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ""}</svg>`;

// ---------- back gesture ----------
// Android's back gesture should close the topmost sheet/dialog, not leave the app.
const stack = [];
let backFallback = null;   // what back does when nothing is open (app.js: return to the first tab)
export const setBackFallback = fn => { backFallback = fn; };
let ignorePops = 0; // history.back() we triggered ourselves when closing with a button
window.addEventListener("popstate", () => {
  if (ignorePops > 0) { ignorePops--; return; }
  const top = stack[stack.length - 1];
  if (top) { top.fromBack = true; top.close(); }
  else if (backFallback) backFallback();
});
function pushLayer(layer) {
  stack.push(layer);
  try { history.pushState({ tvLayer: stack.length }, ""); } catch (e) {}
}
function popLayer(layer) {
  const i = stack.indexOf(layer);
  if (i < 0) return;
  stack.splice(i, 1);
  // Closed by a button/scrim: remove its history entry without closing the layer beneath.
  if (!layer.fromBack) { ignorePops++; try { history.back(); } catch (e) { ignorePops--; } }
}

// ---------- bottom sheet ----------
// sheet({ title, body: Node|string, actions: [{label, kind, onClick}], full, onClose })
export function sheet({ title = "", sub = "", body, actions = [], full = false, onClose } = {}) {
  const scrim = el(`<div class="scrim"></div>`);
  const s = el(`<section class="sheet ${full ? "full" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="handle" aria-hidden="true"></div>
    ${title ? `<header class="sheet-h"><div><h2 class="t-title-l">${esc(title)}</h2>${sub ? `<p class="t-body-m muted">${esc(sub)}</p>` : ""}</div>
      <button class="icon-btn" data-close aria-label="Close">${icon("close")}</button></header>` : ""}
    <div class="sheet-b"></div>
    ${actions.length ? `<footer class="sheet-f"></footer>` : ""}
  </section>`);
  const b = s.querySelector(".sheet-b");
  if (typeof body === "string") b.innerHTML = body; else if (body) b.appendChild(body);
  const f = s.querySelector(".sheet-f");
  actions.forEach(a => {
    const btn = el(`<button class="btn ${a.kind || "filled"}">${esc(a.label)}</button>`);
    btn.onclick = () => a.onClick && a.onClick(btn, api);
    f.appendChild(btn);
  });
  const layer = { close: () => close() };
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    document.removeEventListener("keydown", onKey);
    s.classList.remove("in"); scrim.classList.remove("in");
    popLayer(layer);
    const done = () => { s.remove(); scrim.remove(); document.body.classList.remove("no-scroll"); };
    matchMedia("(prefers-reduced-motion: reduce)").matches ? done() : setTimeout(done, 220);
    onClose && onClose();
  }
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  scrim.onclick = close;
  s.querySelector("[data-close]") && (s.querySelector("[data-close]").onclick = close);
  // drag the handle down to dismiss
  let y0 = null;
  const handle = s.querySelector(".handle");
  handle.addEventListener("pointerdown", e => { y0 = e.clientY; s.style.transition = "none"; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener("pointermove", e => { if (y0 == null) return; const dy = Math.max(0, e.clientY - y0); s.style.transform = `translateY(${dy}px)`; });
  handle.addEventListener("pointerup", e => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; s.style.transition = ""; s.style.transform = ""; if (dy > 90) close(); });
  document.body.append(scrim, s);
  document.body.classList.add("no-scroll");
  pushLayer(layer);
  requestAnimationFrame(() => { scrim.classList.add("in"); s.classList.add("in"); });
  const api = { el: s, body: b, footer: f, close };
  return api;
}

// ---------- dialog ----------
// await confirmDialog({ title, body, confirm: "Delete", danger: true }) → true/false
export function confirmDialog({ title, body = "", confirm = "OK", cancel = "Cancel", danger = false } = {}) {
  return new Promise(resolve => {
    const scrim = el(`<div class="scrim in"></div>`);
    const d = el(`<div class="dialog" role="alertdialog" aria-modal="true">
      <h2 class="t-headline-s">${esc(title)}</h2>
      ${body ? `<div class="t-body-m muted dialog-b">${body}</div>` : ""}
      <div class="dialog-a">${cancel ? `<button class="btn text" data-no>${esc(cancel)}</button>` : ""}<button class="btn text ${danger ? "danger" : ""}" data-yes>${esc(confirm)}</button></div>
    </div>`);
    const layer = { close: () => finish(false) };
    let done = false;
    function finish(v) {
      if (done) return; done = true;
      popLayer(layer); d.remove(); scrim.remove(); resolve(v);
    }
    const no = d.querySelector("[data-no]"); if (no) no.onclick = () => finish(false);
    d.querySelector("[data-yes]").onclick = () => { haptic(); finish(true); };
    scrim.onclick = () => finish(false);
    document.body.append(scrim, d);
    pushLayer(layer);
    requestAnimationFrame(() => d.classList.add("in"));
    d.querySelector("[data-yes]").focus();
  });
}

// ---------- snackbar ----------
let snackTimer = null;
export function snackbar(text, { action, onAction, duration = 4000 } = {}) {
  let s = document.getElementById("snack");
  if (!s) { s = el(`<div id="snack" role="status" aria-live="polite"><span class="snack-t"></span><button class="snack-a" hidden></button></div>`); document.body.appendChild(s); }
  s.querySelector(".snack-t").textContent = text;
  const a = s.querySelector(".snack-a");
  a.hidden = !action; a.textContent = action || "";
  a.onclick = () => { hide(); onAction && onAction(); };
  clearTimeout(snackTimer);
  s.classList.add("in");
  function hide() { s.classList.remove("in"); }
  // With an action it stays until acted on or replaced (M3 web accessibility guidance).
  if (!action) snackTimer = setTimeout(hide, duration);
  return { hide };
}

// ---------- pull to refresh ----------
// Pull down at the very top of a screen to refresh it. The browser's own
// pull-to-refresh is disabled in CSS so the two don't fight.
export function pullToRefresh(screen, onRefresh) {
  if (screen.__ptr) return; screen.__ptr = true;
  const ind = el(`<div class="ptr" aria-hidden="true"><div class="ptr-disc">${icon("refresh")}</div></div>`);
  document.body.appendChild(ind);
  let y0 = null, pulling = false, busy = false, dist = 0;
  const TH = 72;
  screen.addEventListener("touchstart", e => {
    if (busy || screen.hidden || window.scrollY > 0 || document.body.classList.contains("no-scroll")) { y0 = null; return; }
    y0 = e.touches[0].clientY; dist = 0;
  }, { passive: true });
  screen.addEventListener("touchmove", e => {
    if (y0 == null) return;
    dist = e.touches[0].clientY - y0;
    if (dist <= 0 || window.scrollY > 0) { pulling = false; ind.style.transform = ""; ind.classList.remove("show"); return; }
    pulling = true;
    const d = Math.min(dist * 0.5, TH + 24);
    ind.classList.add("show");
    ind.style.transform = `translateY(${d}px)`;
    ind.querySelector(".ptr-disc").style.transform = `rotate(${d * 4}deg)`;
    ind.classList.toggle("ready", d >= TH);
  }, { passive: true });
  screen.addEventListener("touchend", async () => {
    if (!pulling) { y0 = null; return; }
    pulling = false; y0 = null;
    if (Math.min(dist * 0.5, TH + 24) >= TH) {
      busy = true; haptic(); ind.classList.add("spin"); ind.style.transform = `translateY(${TH}px)`;
      try { await onRefresh(); } finally { busy = false; ind.classList.remove("spin", "ready", "show"); ind.style.transform = ""; }
    } else { ind.classList.remove("show", "ready"); ind.style.transform = ""; }
  });
}

// ---------- expander (M3 list item that opens a section) ----------
export function expander({ title, sub = "", lead = "", open = false, build }) {
  const w = el(`<div class="expander ${open ? "open" : ""}">
    <button class="exp-h" aria-expanded="${open}">
      ${lead ? `<span class="exp-lead">${lead}</span>` : ""}
      <span class="exp-text"><span class="t-title-m">${esc(title)}</span>${sub ? `<span class="t-body-m muted exp-sub">${sub}</span>` : ""}</span>
      ${icon("expand", "exp-chev")}
    </button>
    <div class="exp-b" ${open ? "" : "hidden"}></div>
  </div>`);
  const h = w.querySelector(".exp-h"), b = w.querySelector(".exp-b");
  let built = false;
  const set = v => { w.classList.toggle("open", v); h.setAttribute("aria-expanded", v); b.hidden = !v; if (v && !built && build) { built = true; build(b); } };
  if (open) set(true);
  h.onclick = () => set(b.hidden);
  w.setSub = html => { const s = w.querySelector(".exp-sub"); if (s) s.innerHTML = html; };
  return w;
}

// ---------- segmented button ----------
export function segmented(options, value, onChange) {
  const g = el(`<div class="seg ${options.length > 3 ? "compact" : ""}" role="radiogroup"></div>`);
  options.forEach(([v, label]) => {
    const b = el(`<button role="radio" aria-checked="${v === value}" class="${v === value ? "on" : ""}">${v === value ? icon("check") : ""}<span>${esc(label)}</span></button>`);
    b.onclick = () => {
      if (v === value) return;
      value = v; haptic(4);
      [...g.children].forEach((x, i) => {
        const on = options[i][0] === v;
        x.classList.toggle("on", on); x.setAttribute("aria-checked", on);
        x.innerHTML = `${on ? icon("check") : ""}<span>${esc(options[i][1])}</span>`;
      });
      onChange(v);
    };
    g.appendChild(b);
  });
  return g;
}

// ---------- skeleton ----------
export const skel = (h, r = 12, mt = 12) => `<div class="skel" style="height:${h}px;border-radius:${r}px;margin-top:${mt}px"></div>`;

// ---------- keep place when a screen redraws ----------
export function redrawInPlace(fn) { const y = window.scrollY; fn(); window.scrollTo(0, y); }

// ---------- app bar subtitle (each screen says how fresh its data is) ----------
const SUBS = {};
export function setAppbarSub(text) { const s = document.getElementById("abSub"); if (s) s.textContent = text || ""; }
// A screen records its subtitle; it shows only while that screen is on top.
export function setTabSub(tab, text) { SUBS[tab] = text; const sec = document.getElementById(tab); if (sec && !sec.hidden) setAppbarSub(text); }
export const getTabSub = tab => SUBS[tab] || "";
