import { packageOf } from "./data.js";
import { renderCloset, closetTabHidden, refreshCloset } from "./closet.js";
import { renderCompany, refreshCompany } from "./company.js";
import { renderChat } from "./chat.js";
import { apiFetch, setPass } from "./api.js";
import { el, esc, icon, sheet, confirmDialog, snackbar, pullToRefresh, segmented, skel, haptic, setBackFallback, setAppbarSub, setTabSub, getTabSub } from "./ui.js";

const $ = (s, r = document) => r.querySelector(s);
// The app manages scroll per tab; the browser restoring it on back/forward fights that.
try { history.scrollRestoration = "manual"; } catch (e) {}

// ============================================================ shell
const TABS = {
  company: { title: "Business", render: () => renderCompany($("#company")), refresh: () => refreshCompany($("#company")) },
  runs:    { title: "Restock",  render: () => renderRuns(),                 refresh: () => renderRuns(true) },
  closet:  { title: "Inventory",render: () => renderCloset($("#closet")),   refresh: () => refreshCloset() },
  chat:    { title: "Ask",      render: () => renderChat($("#chat")),       refresh: null },
};
let current = "company";
const scrollByTab = {};
const rendered = new Set();
let tabEntry = false; // a history entry exists for "left the first tab"


function showTab(tab, { fromBack = false } = {}) {
  if (!TABS[tab]) return;
  if (tab === current && rendered.has(tab)) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  scrollByTab[current] = window.scrollY;
  document.querySelectorAll("nav.navbar button").forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle("on", on);
    on ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
  });
  Object.keys(TABS).forEach(k => { $("#" + k).hidden = k !== tab; });
  const sec = $("#" + tab);
  sec.classList.remove("screen-enter"); void sec.offsetWidth; sec.classList.add("screen-enter");
  current = tab;
  $("#abTitle").textContent = TABS[tab].title;
  setAppbarSub(getTabSub(tab));
  $("#abRefresh").hidden = !TABS[tab].refresh;
  if (tab !== "closet") closetTabHidden();
  const fab = $("#fillFab"); if (fab) fab.hidden = tab !== "runs";
  // Render each tab once; after that switching is instant and keeps your place.
  if (!rendered.has(tab) || tab === "closet" || tab === "chat") { rendered.add(tab); TABS[tab].render(); }
  window.scrollTo(0, tab === "chat" ? document.body.scrollHeight : (scrollByTab[tab] || 0));
  // Back gesture from another tab returns to Business, then leaves the app.
  if (!fromBack) {
    if (tab !== "company" && !tabEntry) { history.pushState({ tvTab: 1 }, ""); tabEntry = true; }
    else if (tab === "company" && tabEntry) { tabEntry = false; history.back(); }
  }
}
setBackFallback(() => { if (tabEntry) { tabEntry = false; showTab("company", { fromBack: true }); } });

document.querySelectorAll("nav.navbar button").forEach(b => b.onclick = () => { haptic(4); showTab(b.dataset.tab); });

// app bar: tonal fill once content scrolls under it
addEventListener("scroll", () => $("#appbar").classList.toggle("scrolled", scrollY > 4), { passive: true });

// app bar refresh
const abRefresh = $("#abRefresh");
abRefresh.innerHTML = icon("refresh");
abRefresh.onclick = async () => {
  const fn = TABS[current].refresh; if (!fn || abRefresh.classList.contains("spin")) return;
  abRefresh.classList.add("spin"); abRefresh.disabled = true;
  try { await fn(); } finally { abRefresh.classList.remove("spin"); abRefresh.disabled = false; }
};


// ============================================================ restock
let LIVE = null;
async function getLive(force = false) {
  if (LIVE && !force) return LIVE;
  try {
    const r = await apiFetch("/api/live" + (force ? "?refresh=1" : ""));
    if (r.ok) LIVE = await r.json();
  } catch (e) {}
  return LIVE;
}

// Rare, deliberate full re-read of AirVend (Business screen, confirmed by dialog).
window.tvResyncAirVend = async function () {
  try { localStorage.removeItem("tv_live_cache_v2"); } catch (e) {}
  LIVE = null;
  await getLive(true);
  rendered.clear(); rendered.add(current);
  await Promise.all([refreshCompany($("#company")), renderRuns()]);
};

export const cleanItem = p => {
  let s = String(p || "").replace(/^(Meals|Drinks|Crackers|Snacks|Candy)\s*[-:]\s*/i, "").replace(/^\d+(\.\d+)?\s*oz\s*[-:]\s*/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([a-zA-Z])(\d+(\.\d+)?\s*(oz|fl oz|ct|pk)\b)/gi, "$1 $2");  // "DrPepper12oz" → "Dr Pepper 12oz"
  const trimmed = s.replace(/,.*$/, "").replace(/\s*\d+(\.\d+)?\s*(oz|fl oz|ct|count|piece|pk)\b.*$/i, "").trim();
  return trimmed || s.replace(/,.*$/, "").trim() || s.trim();
};

let pickedMachine = null;
async function renderRuns(force = false) {
  const root = $("#runs");
  pullToRefresh(root, () => renderRuns(true));
  if (!LIVE || force) root.innerHTML = `${skel(48, 999, 12)}${skel(88, 12)}${skel(360, 12)}`;
  const live = await getLive(force);
  const machines = live && live.machines && live.machines.length ? live.machines : null;
  setTabSub("runs", live && live.at ? `AirVend · updated ${new Date(live.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "");
  root.innerHTML = "";
  if (!machines) {
    root.appendChild(el(`<div class="empty">${icon("warn")}Couldn't reach AirVend to read the machines.<br>Check your connection and try again.</div>`));
    const rb = el(`<button class="btn outlined">${icon("refresh")}Try again</button>`);
    rb.onclick = () => renderRuns(true); root.appendChild(rb);
    if (force) snackbar("Couldn't reach AirVend");
    return;
  }
  if (!pickedMachine || !machines.find(m => String(m.id) === String(pickedMachine))) pickedMachine = machines[0].id;

  root.appendChild(segmented(machines.map(m => [m.id, m.name]), pickedMachine, v => { pickedMachine = v; paint(); window.scrollTo({ top: 0 }); }));
  const out = el(`<div></div>`);
  root.appendChild(out);

  function paint() {
    const m = machines.find(x => String(x.id) === String(pickedMachine)) || machines[0];
    out.innerHTML = "";
    const slots = (m.slots || []).map(s => ({ slot: s.slot, item: cleanItem(s.product), raw: s.product, onHand: Number(s.onHand) || 0, par: Number(s.max) || 0 }))
      .map(s => ({ ...s, need: Math.max(0, s.par - s.onHand) }));
    if (!slots.length) { out.appendChild(el(`<div class="empty">${icon("info")}No slots came back for ${esc(m.name)}.</div>`)); return; }
    const need = slots.filter(s => s.need > 0);
    const totalUnits = need.reduce((a, s) => a + s.need, 0);

    out.appendChild(el(`<div class="tiles">
      <div class="tile"><div class="k">Units to load</div><div class="v">${totalUnits}</div><div class="d">${need.length} of ${slots.length} slots</div></div>
      <div class="tile"><div class="k">Already full</div><div class="v">${slots.length - need.length}</div><div class="d">at par</div></div>
    </div>`));

    if (!need.length) {
      out.appendChild(el(`<div class="note good"><b>Full to par.</b> Nothing to load for ${esc(m.name)}.</div>`));
    } else {
      // One line per package (how you buy it), highest slot number first — the order you walk the machine.
      const groups = {};
      need.forEach(s => { const g = packageOf(s.raw); (groups[g.key] = groups[g.key] || { label: g.label, total: 0, slots: [] }); groups[g.key].total += s.need; groups[g.key].slots.push(s); });
      const top = g => Math.max(...g.slots.map(s => +s.slot));
      const list = Object.values(groups).sort((a, b) => top(b) - top(a));
      const c = el(`<div class="card"><div class="ct">Load list</div><div class="cs">Highest slot first · number = units to bring</div><div class="rows"></div></div>`);
      const rows = c.querySelector(".rows");
      list.forEach(g => {
        const detail = g.slots.slice().sort((a, b) => b.slot - a.slot).map(s => `#${s.slot}: ${s.onHand}/${s.par}`).join(" · ");
        rows.appendChild(el(`<div class="row"><div class="nm">${esc(g.label)}<div class="mt">${detail}</div></div><div class="val">+${g.total}</div></div>`));
      });
      out.appendChild(c);
    }

    // Primary action floats above the tab bar so it's reachable without scrolling the list.
    let fab = document.getElementById("fillFab");
    if (!fab) { fab = el(`<button class="fab" id="fillFab">${icon("check")}I filled it</button>`); document.body.appendChild(fab); }
    fab.onclick = () => openFillSheet(m);
    fab.hidden = $("#runs").hidden;
    if (need.length) {
      const gen = el(`<button class="btn tonal">${icon("cart")}Make a Sam's Club case list</button>`);
      gen.onclick = () => buildCaseList(m.name, need, gen);
      out.appendChild(gen);
    }
  }
  paint();
}

// ---------- "I filled it": full sheet → review → save to AirVend ----------
function openFillSheet(m) {
  const slots = (m.slots || []).slice().sort((a, b) => b.slot - a.slot);
  const body = el(`<div>
    <p class="t-body-m muted" style="margin:0 0 8px">Every slot starts at par. Change only the ones you didn't fill all the way — type what's actually in the slot.</p>
    <div class="rows"></div>
  </div>`);
  const rows = body.querySelector(".rows");
  slots.forEach(s => {
    const par = Number(s.max) || 0;
    const row = el(`<div class="row">
      <div class="nm">${esc(cleanItem(s.product))}<div class="mt">Slot ${esc(s.slot)} · par ${par} · was ${Number(s.onHand) || 0}</div></div>
      <div class="stepper">
        <button class="icon-btn" data-d="-1" aria-label="One less">${icon("remove")}</button>
        <input class="uq" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" value="${par}" data-slot="${esc(s.slot)}" data-par="${par}" aria-label="Count in slot ${esc(s.slot)}">
        <button class="icon-btn" data-d="1" aria-label="One more">${icon("add")}</button>
      </div></div>`);
    const inp = row.querySelector("input");
    const mark = () => inp.classList.toggle("changed", String(inp.value) !== String(par));
    row.querySelectorAll("[data-d]").forEach(b => b.onclick = () => {
      const v = Math.max(0, Math.min(par, (parseInt(inp.value, 10) || 0) + Number(b.dataset.d)));
      inp.value = v; mark(); haptic(4); updateCount();
    });
    inp.oninput = () => { inp.value = inp.value.replace(/[^0-9]/g, ""); if (+inp.value > par) inp.value = par; mark(); updateCount(); };
    inp.onblur = () => { if (inp.value === "") { inp.value = par; mark(); updateCount(); } };
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); const all = [...rows.querySelectorAll("input")]; const nx = all[all.indexOf(inp) + 1]; nx ? nx.focus() : inp.blur(); } };
    rows.appendChild(row);
  });

  const gaps = () => [...rows.querySelectorAll("input")].map(i => {
    const par = +i.dataset.par; let v = parseInt(i.value, 10); if (isNaN(v)) v = par; v = Math.max(0, Math.min(par, v));
    return { slot: i.dataset.slot, missing: par - v };
  }).filter(g => g.missing > 0);

  let review;
  const sh = sheet({
    title: "Update AirVend", sub: m.name, body, full: true,
    actions: [{ label: "Review changes", kind: "filled", onClick: btn => doReview(btn) }],
  });
  function updateCount() {
    const n = gaps().length;
    const b = sh.footer.querySelector(".btn");
    b.textContent = n ? `Review · ${n} slot${n === 1 ? "" : "s"} not full` : "Review · all slots full";
  }
  updateCount();

  async function doReview(btn) {
    const g = gaps();
    btn.disabled = true; btn.textContent = "Reading AirVend…";
    let res;
    try { res = await (await apiFetch("/api/airvend/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineId: m.id, gaps: g }) })).json(); }
    catch (e) { res = { error: true, message: "Couldn't reach AirVend. Nothing was changed." }; }
    btn.disabled = false; updateCount();
    if (res.error) { snackbar(res.message || "Couldn't read AirVend. Nothing was changed."); return; }
    const changes = (res.plan || []).filter(p => Number(p.from) !== Number(p.to));
    if (!changes.length) { snackbar("AirVend already matches. Nothing to send."); return; }
    const list = changes.map(p => `<div class="row"><div class="nm">${esc(cleanItem(p.product))}<div class="mt">Slot ${esc(p.slot)}</div></div><div class="val">${p.from} → ${p.to}</div></div>`).join("");
    const ok = await confirmDialog({
      title: `Send ${changes.length} change${changes.length === 1 ? "" : "s"} to AirVend?`,
      body: `<div class="rows" style="margin:0 -24px;max-height:40dvh;overflow:auto">${list}</div><p class="t-body-m muted" style="margin-top:12px">This sets on-hand counts and today's refill date in AirVend.</p>`,
      confirm: "Send",
    });
    if (!ok) return;
    await doSave(g, btn);
  }

  async function doSave(g, btn) {
    btn.disabled = true; btn.textContent = "Saving to AirVend…";
    let res;
    try { res = await (await apiFetch("/api/airvend/write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineId: m.id, gaps: g }) })).json(); }
    catch (e) { res = { error: true, message: "Couldn't reach AirVend. Nothing was changed." }; }
    btn.disabled = false; updateCount();
    if (res.error || res.dryRun) {
      await confirmDialog({ title: "AirVend didn't save", body: esc(res.message || "Nothing was changed."), confirm: "OK", cancel: "" });
      return;
    }
    haptic(20);
    sh.close();
    const sold = res.soldSince && res.soldSince.length ? ` ${res.soldSince.length} already sold since.` : "";
    snackbar(`AirVend updated and checked · ${res.wrote} slots.${sold}`);
    LIVE = null; renderRuns(true);
  }
}

// ---------- Sam's case list (brain) ----------
async function buildCaseList(machine, need, btn) {
  btn.disabled = true; btn.innerHTML = `${icon("cart")}Building the list…`;
  let res, body;
  try {
    res = await apiFetch("/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machine, shorts: need.map(s => ({ slot: s.slot, item: s.item, missing: s.need })) }) });
    body = await res.json();
  } catch (e) { body = { error: true, message: "Couldn't reach the server." }; }
  btn.disabled = false; btn.innerHTML = `${icon("cart")}Make a Sam's Club case list`;
  if (!res || !res.ok || body.error) { snackbar(body.message || "Couldn't build the case list right now."); return; }
  const wrap = el(`<div></div>`);
  if (body.summary) wrap.appendChild(el(`<p class="t-body-m" style="margin:0 0 8px">${esc(body.summary)}</p>`));
  if (body.buyList && body.buyList.length) {
    const r = el(`<div class="rows"></div>`);
    body.buyList.forEach(x => r.appendChild(el(`<div class="row"><div class="nm">${esc(x.item)}<div class="mt">Slot ${esc(x.slot)}${x.reason ? " · " + esc(x.reason) : ""}</div></div><div class="val">${x.cases} case${x.cases === 1 ? "" : "s"}</div></div>`)));
    wrap.appendChild(r);
  }
  if (body.changeOrders && body.changeOrders.length) {
    wrap.appendChild(el(`<h2 class="sec-h">Worth changing</h2>`));
    const r = el(`<div class="rows"></div>`);
    body.changeOrders.forEach(x => r.appendChild(el(`<div class="row"><div class="nm">${esc(x.item)}<div class="mt">Slot ${esc(x.slot)} · ${esc(x.type)}${x.reason ? " · " + esc(x.reason) : ""}</div></div><div class="val">${esc(x.from)} → ${esc(x.to)}</div></div>`)));
    wrap.appendChild(r);
  }
  if (body.reconciliation) wrap.appendChild(el(`<div class="note">${esc(body.reconciliation)}</div>`));
  sheet({ title: "Sam's Club case list", sub: machine, body: wrap, actions: [{ label: "Done", kind: "tonal", onClick: (b, s) => s.close() }] });
}

// ============================================================ unlock
async function ensureUnlocked() {
  const lock = $("#lock");
  if (localStorage.getItem("tv_pass")) { lock && lock.remove(); return; }
  let r;
  try { r = await apiFetch("/api/finance"); } catch (e) { lock && lock.remove(); return; }
  if (r.status !== 401) { lock && lock.remove(); return; }
  await new Promise(resolve => {
    const inp = $("#pc"), err = $("#pcerr"), go = $("#pcgo");
    inp.focus();
    const tryIt = async () => {
      if (!inp.value.trim()) { err.textContent = "Enter your passcode."; return; }
      setPass(inp.value.trim());
      go.disabled = true; go.textContent = "Checking…"; err.textContent = "";
      let rr;
      try { rr = await apiFetch("/api/finance"); } catch (e) { err.textContent = "Can't reach the server."; go.disabled = false; go.textContent = "Unlock"; return; }
      if (rr.status === 401 || rr.status === 429) { err.textContent = rr.status === 429 ? "Too many tries. Wait a few minutes." : "Wrong passcode."; go.disabled = false; go.textContent = "Unlock"; inp.select(); haptic(30); return; }
      lock.remove(); resolve();
    };
    go.onclick = tryIt;
    inp.onkeydown = e => { if (e.key === "Enter") tryIt(); };
  });
}

// ============================================================ install
let deferredInstall = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; });
function maybeOfferInstall() {
  if (matchMedia("(display-mode: standalone)").matches) return;
  if (localStorage.getItem("tv_install_done") === "1") return;
  setTimeout(() => {
    if (!deferredInstall) return;
    snackbar("Install Tribal Vend on your home screen", {
      action: "Install",
      onAction: async () => { localStorage.setItem("tv_install_done", "1"); deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; },
    });
  }, 2500);
}

// ============================================================ keyboard
// While typing, the nav bar steps aside (Chrome resizes the page above the keyboard).
document.addEventListener("focusin", e => {
  const t = e.target;
  if (t.matches && t.matches("input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea") && !t.closest("#chat")) document.body.classList.add("kbd");
  if (t.matches && t.matches("input.uq, input.q, .num-in")) setTimeout(() => t.select(), 0); // tap = replace the number
});
document.addEventListener("focusout", () => setTimeout(() => {
  const a = document.activeElement;
  if (!(a && a.matches && a.matches("input, textarea"))) document.body.classList.remove("kbd");
}, 60));

// ============================================================ updates
addEventListener("tv-update", () => {
  snackbar("A new version of the app is ready", { action: "Reload", onAction: () => location.reload() });
});

// ============================================================ boot
(async () => {
  await ensureUnlocked();
  rendered.add("company");
  $("#abRefresh").hidden = false;
  renderCompany($("#company"));
  maybeOfferInstall();
})();
