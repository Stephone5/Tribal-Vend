// Leads — the two prospect lists, built for calling, not reading.
// Tap the number to dial, the address for directions, one tap to set status.

import { apiFetch } from "./api.js";
import { el, esc, icon, snackbar, pullToRefresh, setTabSub, skel, haptic } from "./ui.js";

let ROOT = null, ROWS = [], COUNTS = {}, injected = false, loadError = null;
const F = { anchor: "", status: "new", category: "", search: "", five: false };

function injectStyles() {
  if (injected) return; injected = true;
  document.head.appendChild(el(`<style>
    .lead{background:var(--surface-c-low); border-radius:var(--r-md); padding:16px; margin-top:12px; position:relative}
    .lead.done{opacity:.6}
    .lead .lt{font-size:18px; line-height:24px; font-weight:500; padding-right:56px}
    .lead .lm{font-size:14px; line-height:20px; color:var(--on-surface-variant); margin-top:2px}
    .lead .lnote{font-size:14px; line-height:20px; margin-top:8px}
    .lead .lscore{position:absolute; top:14px; right:14px; background:var(--secondary-container); color:var(--on-secondary-container); border-radius:var(--r-full); padding:4px 10px; font-size:13px; font-weight:600}
    .lead .lacts{display:flex; gap:8px; margin-top:12px; flex-wrap:wrap}
    .lead .lacts .btn{flex:1 1 auto; min-width:120px}
    .lead .lstat{display:flex; gap:6px; margin-top:8px; flex-wrap:wrap}
    .lead .lstat button{flex:1 1 0; min-width:72px; min-height:44px; border:0; border-radius:var(--r-full); background:var(--surface-c-high); color:var(--on-surface); font-size:13px; font-weight:500; cursor:pointer}
    .lead .lstat button.on{background:var(--primary); color:var(--on-primary)}
    .lead .lstat button.no.on{background:var(--error); color:var(--on-error)}
    .lbar{display:flex; gap:8px; overflow-x:auto; padding:4px 0 2px; margin:0 -16px; padding-left:16px; padding-right:16px; scrollbar-width:none}
    .lbar::-webkit-scrollbar{display:none}
    .lchip{flex:none; min-height:48px; padding:0 16px; border-radius:var(--r-full); border:1px solid var(--outline-variant); background:transparent; color:var(--on-surface); font-size:14px; font-weight:500; cursor:pointer; display:inline-flex; align-items:center; gap:6px}
    .lchip.on{background:var(--secondary-container); color:var(--on-secondary-container); border-color:transparent}
    .lsearch{width:100%; box-sizing:border-box; min-height:48px; border:0; border-radius:var(--r-full); background:var(--surface-c-high); color:var(--on-surface); padding:0 16px; font-size:16px; margin-top:12px}
  </style>`));
}

const dial = p => String(p || "").replace(/[^\d+]/g, "");
const mapUrl = r => r.lat && r.lon
  ? `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lon}`
  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([r.name, r.addr].filter(Boolean).join(" "))}`;

export async function renderLeads(root) {
  injectStyles();
  ROOT = root;
  pullToRefresh(root, () => load(true));
  if (!ROWS.length) root.innerHTML = `${skel(120, 12)}${skel(120, 12)}${skel(120, 12)}`;
  await load(false);
}
export const refreshLeads = () => load(true);

async function load(force) {
  const q = new URLSearchParams();
  if (F.anchor) q.set("anchor", F.anchor);
  if (F.status) q.set("status", F.status);
  if (F.category) q.set("category", F.category);
  if (F.search) q.set("search", F.search);
  q.set("limit", F.five ? "5" : "60");
  try {
    const r = await apiFetch("/api/leads?" + q.toString());
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.message || `HTTP ${r.status}`);
    ROWS = b.rows || []; COUNTS = b.counts || {}; loadError = null;
  } catch (e) { loadError = e.message; }
  paint();
  if (force) snackbar(loadError ? "Couldn't load leads" : "Leads updated");
}

function paint() {
  if (!ROOT) return;
  const y = window.scrollY;
  ROOT.innerHTML = "";
  const home = COUNTS.home || {}, shop = COUNTS.shop || {};
  setTabSub("leads", loadError ? "Offline" : `${(home.new || 0) + (shop.new || 0)} still to call`);

  if (loadError) {
    const e = el(`<div class="empty">${icon("warn")}Couldn't load your leads.<br>${esc(loadError)}</div>`);
    ROOT.appendChild(e);
    return;
  }

  // filters
  const bar1 = el(`<div class="lbar"></div>`);
  const chip = (label, on, onClick) => { const b = el(`<button class="lchip ${on ? "on" : ""}">${on ? icon("check") : ""}${esc(label)}</button>`); b.onclick = () => { haptic(4); onClick(); }; return b; };
  bar1.append(
    chip("Both", !F.anchor, () => { F.anchor = ""; load(); }),
    chip(`Near the house${home.total ? ` (${home.total})` : ""}`, F.anchor === "home", () => { F.anchor = "home"; load(); }),
    chip(`Near the shop${shop.total ? ` (${shop.total})` : ""}`, F.anchor === "shop", () => { F.anchor = "shop"; load(); }),
  );
  const bar2 = el(`<div class="lbar" style="margin-top:8px"></div>`);
  bar2.append(
    chip("To call", F.status === "new", () => { F.status = "new"; load(); }),
    chip("Interested", F.status === "interested", () => { F.status = "interested"; load(); }),
    chip("Called", F.status === "called", () => { F.status = "called"; load(); }),
    chip("Try later", F.status === "later", () => { F.status = "later"; load(); }),
    chip("No", F.status === "no", () => { F.status = "no"; load(); }),
    chip("All", !F.status, () => { F.status = ""; load(); }),
  );
  const bar3 = el(`<div class="lbar" style="margin-top:8px"></div>`);
  [["", "Any type"], ["clinic", "Clinics"], ["hospital", "Hospitals"], ["auto", "Auto & trade"], ["industrial", "Industrial"], ["office", "Offices"], ["hotel", "Hotels"], ["gym", "Gyms"], ["tier 1", "Big anchors"]]
    .forEach(([v, label]) => bar3.appendChild(chip(label, F.category === v, () => { F.category = v; load(); })));

  const five = el(`<button class="btn ${F.five ? "filled" : "tonal"}" style="margin-top:12px">${icon("check")}${F.five ? "Showing today's five" : "Give me today's five"}</button>`);
  five.onclick = () => { F.five = !F.five; if (F.five) { F.status = "new"; } load(); };

  const search = el(`<input class="lsearch" type="search" placeholder="Search a name or street" aria-label="Search leads" value="${esc(F.search)}">`);
  let t = null;
  search.oninput = () => { clearTimeout(t); t = setTimeout(() => { F.search = search.value.trim(); load(); }, 400); };

  ROOT.append(bar1, bar2, bar3, five, search);

  if (!ROWS.length) {
    ROOT.appendChild(el(`<div class="empty">Nothing here. Try a different filter.</div>`));
    window.scrollTo(0, y);
    return;
  }

  ROWS.forEach(r => ROOT.appendChild(card(r)));
  window.scrollTo(0, y);
}

function card(r) {
  const c = el(`<div class="lead ${r.status === "no" ? "done" : ""}">
    ${r.score != null ? `<span class="lscore">${r.score}</span>` : r.tier === 1 ? `<span class="lscore">Anchor</span>` : ""}
    <div class="lt">${esc(r.name)}</div>
    <div class="lm">${esc([r.category, r.headcount, r.miles != null ? `${r.miles} mi from the ${r.anchor === "home" ? "house" : "shop"}` : null, r.food_ft != null ? `food ${r.food_ft.toLocaleString()} ft away` : null].filter(Boolean).join(" · "))}</div>
    ${r.note ? `<div class="lnote">${esc(r.note)}</div>` : ""}
    ${r.my_note ? `<div class="lnote"><b>You:</b> ${esc(r.my_note)}</div>` : ""}
  </div>`);

  const acts = el(`<div class="lacts"></div>`);
  if (r.phone) acts.appendChild(el(`<a class="btn filled" href="tel:${esc(dial(r.phone))}">${icon("phone")}${esc(r.phone)}</a>`));
  if (r.addr || (r.lat && r.lon)) acts.appendChild(el(`<a class="btn outlined" href="${esc(mapUrl(r))}" target="_blank" rel="noopener">${icon("open")}Directions</a>`));
  if (acts.children.length) c.appendChild(acts);

  const stat = el(`<div class="lstat"></div>`);
  [["called", "Called"], ["interested", "Interested"], ["later", "Try later"], ["no", "No"]].forEach(([v, label]) => {
    const b = el(`<button class="${v} ${r.status === v ? "on" : ""}">${esc(label)}</button>`);
    b.onclick = async () => {
      haptic(6);
      const next = r.status === v ? "new" : v;
      try {
        const res = await apiFetch(`/api/leads/${r.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
        r.status = next;
        snackbar(next === "new" ? "Back on the list" : `Marked ${label.toLowerCase()}`);
        load();
      } catch (e) { snackbar("Couldn't save: " + e.message); }
    };
    stat.appendChild(b);
  });
  c.appendChild(stat);
  return c;
}
