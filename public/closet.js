// Inventory — the in-app stock tracker. Counts are edited on the phone and held
// until you tap Save (or Cancel). The server is the source of truth; the phone
// keeps an offline copy so nothing is lost without signal.

import { apiFetch } from "./api.js";
import { el, esc, icon, sheet, confirmDialog, snackbar, pullToRefresh, expander, segmented, skel, haptic, setTabSub } from "./ui.js";

const FOLDERS = ["Drinks", "Cold Food", "Snacks", "Candy"];
const LSK = "tv_closet_v1";
const SAVEDK = "tv_closet_saved";
const uid = () => "i" + Math.random().toString(36).slice(2, 9);
const usd = n => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const isLow = i => i.min != null && i.min !== "" && Number(i.qty) <= Number(i.min);

// ---------- state ----------
let STATE = { items: [], hist: [] };
let SAVED = (() => { try { return JSON.parse(localStorage.getItem(SAVEDK)); } catch { return null; } })();
const qtyKey = d => JSON.stringify((d && d.items || []).map(i => [i.id, Number(i.qty) || 0]));
const isDirty = () => !!(SAVED && qtyKey(STATE) !== qtyKey(SAVED));
const clone = o => JSON.parse(JSON.stringify(o));
function setSaved(d) { SAVED = clone(d); try { localStorage.setItem(SAVEDK, JSON.stringify(SAVED)); } catch (e) {} }
function keepLocal() { STATE.__unsaved = isDirty(); try { localStorage.setItem(LSK, JSON.stringify(STATE)); } catch (e) {} }

// Count edits: held on the phone; back to exactly what's saved = nothing to save.
function stage() {
  if (!isDirty() && SAVED) { const hist = SAVED.hist; STATE.hist = hist; }
  keepLocal();
  paintActionbar();
}

async function pull() {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(LSK)); } catch {}
  try {
    const r = await apiFetch("/api/closet");
    if (!r.ok) throw new Error();
    const server = await r.json();
    setSaved(server);
    if (cached && cached.__unsaved && cached.items) { cached.live = server.live; cached.countedAt = server.countedAt; STATE = cached; return "unsaved"; }
    // A server hiccup that returns nothing can't wipe the phone's copy.
    if ((!server.items || !server.items.length) && cached && cached.items && cached.items.length) { STATE = cached; return "cached"; }
    STATE = server; keepLocal(); return "server";
  } catch (e) {
    STATE = cached || { items: [], hist: [] };
    return "offline";
  }
}

async function putServer(d) {
  const body = clone(d); delete body.__unsaved;
  const r = await apiFetch("/api/closet", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error("HTTP " + r.status);
}

// Item add/edit/delete/import: saved right away (they have their own Save button).
async function saveItemChange(msg) {
  try { await putServer(STATE); setSaved(STATE); keepLocal(); snackbar(msg); }
  catch (e) { keepLocal(); snackbar("Didn't save to the server. It's kept on this phone.", { action: "Retry", onAction: () => saveItemChange(msg) }); }
  paintActionbar();
}

// Expose current stock for the brain (buy lists subtract what you already own).
export function closetSnapshot() {
  let s = STATE;
  if (!s.items || !s.items.length) { try { s = JSON.parse(localStorage.getItem(LSK)) || { items: [] }; } catch {} }
  return (s.items || []).map(i => ({ name: i.name, folder: i.folder, qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
}

// ---------- action bar: Cancel / Save ----------
function paintActionbar() {
  let bar = document.getElementById("cl-bar");
  if (!bar) {
    bar = el(`<div class="actionbar" id="cl-bar" role="region" aria-label="Unsaved changes">
      <div class="ab-t"><div class="t-title-s" id="cl-bar-t">Unsaved changes</div><div class="t-body-s muted" id="cl-bar-s"></div></div>
      <button class="btn outlined" id="cl-cancel">Cancel</button>
      <button class="btn" id="cl-save">Save</button>
    </div>`);
    document.body.appendChild(bar);
    bar.querySelector("#cl-save").onclick = saveCounts;
    bar.querySelector("#cl-cancel").onclick = cancelCounts;
  }
  const onScreen = ROOT && !ROOT.hidden;
  const dirty = isDirty();
  bar.classList.toggle("in", !!(onScreen && dirty));
  if (dirty) {
    const n = STATE.items.filter(i => { const s = SAVED.items.find(x => x.id === i.id); return !s || Number(s.qty) !== Number(i.qty); }).length;
    bar.querySelector("#cl-bar-t").textContent = `${n} item${n === 1 ? "" : "s"} changed`;
    bar.querySelector("#cl-bar-s").textContent = "Not saved yet";
  }
}
export function closetTabHidden() { const bar = document.getElementById("cl-bar"); if (bar) bar.classList.remove("in"); }

async function saveCounts() {
  const btn = document.getElementById("cl-save"), cancel = document.getElementById("cl-cancel");
  btn.disabled = true; cancel.disabled = true; btn.textContent = "Saving…";
  try {
    await putServer(STATE);
    setSaved(STATE); keepLocal(); haptic(20);
    await pull();
    redraw();
    snackbar("Inventory saved. This is your new count.");
  } catch (e) {
    snackbar("Didn't save. No connection. Your counts are still on this phone.", { action: "Retry", onAction: saveCounts });
  } finally {
    btn.disabled = false; cancel.disabled = false; btn.textContent = "Save";
    paintActionbar();
  }
}
function cancelCounts() {
  if (!SAVED) return;
  STATE = clone(SAVED); keepLocal(); haptic(4);
  redraw();
  snackbar("Changes discarded");
}

// ---------- screen ----------
let ROOT = null;
const OPEN = new Set(["Drinks"]);
function redraw() { const y = window.scrollY; paint(); window.scrollTo(0, y); }

export async function renderCloset(rootEl) {
  injectStyles();
  ROOT = rootEl;
  pullToRefresh(ROOT, refreshCloset);
  if (!STATE.items.length) ROOT.innerHTML = `<div class="tiles" style="margin-top:0">${skel(104, 12)}${skel(104, 12)}</div>${skel(64, 12)}${skel(64, 12)}${skel(64, 12)}`;
  const src = await pull();
  if (ROOT.hidden) return;
  paint();
  if (src === "offline") snackbar("Offline. Showing the counts saved on this phone.");
}
export async function refreshCloset() {
  if (isDirty()) { snackbar("Save or cancel your changes before refreshing"); return; }
  const src = await pull();
  redraw();
  snackbar(src === "offline" ? "Couldn't reach the server" : "Inventory up to date");
}

function logHist(item, delta) {
  STATE.hist = STATE.hist || [];
  STATE.hist.unshift({ itemId: item.id, name: item.name, t: Date.now(), delta, qty: item.qty });
  STATE.hist = STATE.hist.slice(0, 400);
}

function paint() {
  const d = STATE, root = ROOT;
  root.innerHTML = "";
  paintActionbar();
  const totUnits = d.items.reduce((a, i) => a + (Number(i.qty) || 0), 0);
  const totValue = d.items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const live = d.live;
  const counted = live && live.countedAt ? new Date(live.countedAt + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" }) : null;
  setTabSub("closet", counted ? `Counted ${counted}` : `${d.items.length} items`);

  if (live && live.baseline) {
    const liveValue = totValue * (live.baseline ? live.liveUnits / live.baseline : 1);
    root.appendChild(el(`<div class="cl-sum" style="margin-top:0">
      <div class="tile"><div class="k">In stock now</div><div class="v">${live.liveUnits.toLocaleString()}</div><div class="d">${live.soldSince} sold since ${counted}</div></div>
      <div class="tile"><div class="k">Value in stock</div><div class="v">${usd(liveValue)}</div><div class="d">of ${usd(totValue)} counted</div></div>
    </div>`));
  } else {
    root.appendChild(el(`<div class="cl-sum" style="margin-top:0">
      <div class="tile"><div class="k">Total units</div><div class="v">${totUnits.toLocaleString()}</div><div class="d">across all folders</div></div>
      <div class="tile"><div class="k">Total value</div><div class="v">${usd(totValue)}</div><div class="d">at your unit costs</div></div>
    </div>`));
  }

  const add = el(`<button class="btn tonal">${icon("add")}Add item</button>`);
  add.onclick = () => openEditor(null);
  root.appendChild(add);

  for (const folder of FOLDERS) {
    const items = d.items.filter(i => i.folder === folder).sort((a, b) => a.name.localeCompare(b.name));
    const holder = {};   // an open folder builds its rows immediately, before x exists
    const x = expander({
      title: folder, sub: folderSub(items), open: OPEN.has(folder),
      build: body => {
        body.style.padding = "0";
        if (!items.length) { body.appendChild(el(`<div class="empty" style="padding:16px">No items in ${esc(folder)} yet.</div>`)); return; }
        const list = el(`<div class="cl-list"></div>`);
        items.forEach(it => list.appendChild(itemRow(it, holder)));
        body.appendChild(list);
      },
    });
    holder.el = x;
    x.dataset.folder = folder;
    x.querySelector(".exp-h").addEventListener("click", () => x.classList.contains("open") ? OPEN.add(folder) : OPEN.delete(folder));
    root.appendChild(x);
  }

  // Change history + backup, tucked away
  const hist = d.hist || [];
  root.appendChild(expander({
    title: "Change history", sub: `${hist.length} change${hist.length === 1 ? "" : "s"} logged`, lead: icon("history"),
    build: body => {
      if (!hist.length) { body.appendChild(el(`<div class="empty" style="padding:16px">No changes logged yet.</div>`)); return; }
      const list = el(`<div class="rows"></div>`);
      hist.slice(0, 200).forEach(h => {
        const w = new Date(h.t);
        list.appendChild(el(`<div class="row"><div class="nm">${esc(h.name || "")}<div class="mt">${w.toLocaleDateString([], { month: "short", day: "numeric" })}, ${w.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div></div><div class="val num">${h.delta > 0 ? "+" : ""}${h.delta} → ${h.qty}</div></div>`));
      });
      body.appendChild(list);
    },
  }));
  root.appendChild(expander({
    title: "Backup", sub: "Save a copy to your phone, or restore one", lead: icon("download"),
    build: body => {
      const row = el(`<div class="btn-row"><button class="btn outlined">${icon("download")}Export</button><button class="btn outlined">${icon("upload")}Import</button></div>`);
      const [ex, im] = row.querySelectorAll("button");
      ex.onclick = exportBackup; im.onclick = importBackup;
      body.appendChild(row);
    },
  }));
}

function folderSub(items) {
  const u = items.reduce((a, i) => a + (Number(i.qty) || 0), 0);
  const v = items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const low = items.filter(isLow).length;
  return `${items.length} item${items.length === 1 ? "" : "s"} · ${u} units · ${usd(v)}${low ? ` · <span style="color:var(--error)">${low} low</span>` : ""}`;
}

function itemRow(it, folderEl) {
  const row = el(`<div class="cl-item">
    <button class="cl-main" aria-label="Edit ${esc(it.name)}">
      ${it.img ? `<img class="cl-thumb" src="${it.img}" alt="">` : `<span class="cl-thumb">${esc((it.name || "?").slice(0, 1).toUpperCase())}</span>`}
      <span class="cl-text"><span class="cl-name">${esc(it.name)}</span><span class="cl-meta"></span></span>
    </button>
    <div class="stepper">
      <button class="icon-btn" data-d="-1" aria-label="One less ${esc(it.name)}">${icon("remove")}</button>
      <input class="q" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" value="${Number(it.qty) || 0}" aria-label="Count for ${esc(it.name)}">
      <button class="icon-btn" data-d="1" aria-label="One more ${esc(it.name)}">${icon("add")}</button>
    </div>
  </div>`);
  const qi = row.querySelector(".q");
  const meta = () => {
    const item = STATE.items.find(x => x.id === it.id) || it;
    const saved = SAVED && SAVED.items.find(x => x.id === it.id);
    const changed = saved && Number(saved.qty) !== Number(item.qty);
    row.querySelector(".cl-meta").innerHTML = `${isLow(item) ? `<span style="color:var(--error)">Low</span> · ` : ""}${changed ? `was ${saved.qty} · ` : ""}${usd(item.price)} each · ${usd((Number(item.qty) || 0) * (Number(item.price) || 0))}`;
    qi.classList.toggle("changed", !!changed);
    const folder = STATE.items.filter(i => i.folder === item.folder);
    if (folderEl.el) folderEl.el.setSub(folderSub(folder));
  };
  const setQty = (next, log) => {
    const item = STATE.items.find(x => x.id === it.id); if (!item) return;
    next = Math.max(0, Math.floor(Number(next) || 0));
    const delta = next - (Number(item.qty) || 0);
    if (!delta) return;
    item.qty = next;
    if (log) logHist(item, delta);
    stage();
    if (document.activeElement !== qi) qi.value = item.qty;
    meta(); updateTotals();
  };
  row.querySelectorAll("[data-d]").forEach(b => b.onclick = () => { haptic(4); setQty((Number(STATE.items.find(x => x.id === it.id).qty) || 0) + Number(b.dataset.d), true); });
  qi.onfocus = () => { qi.dataset.was = qi.value; };
  qi.oninput = () => { qi.value = qi.value.replace(/[^0-9]/g, "").slice(0, 4); if (qi.value !== "") setQty(qi.value, false); };
  qi.onblur = () => { if (qi.value === "") { qi.value = qi.dataset.was || "0"; setQty(qi.value, false); } };
  qi.onkeydown = e => { if (e.key === "Enter") qi.blur(); };
  qi.onchange = () => {
    if (qi.value === "") return;
    const was = Number(qi.dataset.was), now = Number(qi.value);
    if (!isNaN(was) && now !== was) { const item = STATE.items.find(x => x.id === it.id); if (item) { logHist(item, now - was); stage(); } }
  };
  row.querySelector(".cl-main").onclick = () => openEditor(STATE.items.find(x => x.id === it.id) || it);
  meta();
  return row;
}

function updateTotals() {
  const d = STATE;
  const totUnits = d.items.reduce((a, i) => a + (Number(i.qty) || 0), 0);
  const totValue = d.items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const v = ROOT.querySelectorAll(".cl-sum .v"), dd = ROOT.querySelectorAll(".cl-sum .d");
  if (d.live && d.live.baseline) { if (dd[1]) dd[1].textContent = `of ${usd(totValue)} counted`; }
  else { if (v[0]) v[0].textContent = totUnits.toLocaleString(); if (v[1]) v[1].textContent = usd(totValue); }
}

// ---------- add / edit item (bottom sheet) ----------
function openEditor(existing) {
  const it = existing ? clone(existing) : { id: uid(), folder: "Drinks", name: "", price: "", qty: 0, min: "", img: null };
  const body = el(`<div>
    <div class="field"><label for="ed-name">Item name</label><input id="ed-name" type="text" value="${esc(it.name)}" placeholder="e.g. Monster Energy" autocomplete="off"></div>
    <div class="field"><label>Folder</label><div class="ed-folder"></div></div>
    <div class="ed-3">
      <div class="field"><label for="ed-price">Cost each</label><input id="ed-price" type="text" inputmode="decimal" value="${it.price !== "" && it.price != null ? it.price : ""}" placeholder="0.00"></div>
      <div class="field"><label for="ed-qty">Count</label><input id="ed-qty" type="text" inputmode="numeric" value="${Number(it.qty) || 0}"></div>
      <div class="field"><label for="ed-min">Low at</label><input id="ed-min" type="text" inputmode="numeric" value="${it.min != null ? it.min : ""}" placeholder="None"></div>
    </div>
    <div class="ed-photo">
      ${it.img ? `<img class="cl-thumb lg" src="${it.img}" alt="">` : `<span class="cl-thumb lg">${esc((it.name || "?").slice(0, 1).toUpperCase())}</span>`}
      <label class="btn outlined" style="margin:0;flex:1">${icon("camera")}${it.img ? "Change photo" : "Add photo"}<input type="file" accept="image/*" capture="environment" hidden></label>
    </div>
    <div id="ed-err" class="t-body-s" role="alert" style="color:var(--error);min-height:16px;margin:8px 4px 0"></div>
    ${existing ? `<button class="btn text danger" id="ed-del" style="margin:8px auto 0;display:flex">${icon("trash")}Delete item</button>` : ""}
    ${existing && (STATE.hist || []).some(h => h.itemId === it.id) ? `<h2 class="sec-h" style="margin-top:16px">Recent changes</h2><div class="rows">${(STATE.hist || []).filter(h => h.itemId === it.id).slice(0, 6).map(h => `<div class="row"><div class="nm">${new Date(h.t).toLocaleDateString([], { month: "short", day: "numeric" })}<div class="mt">${new Date(h.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div></div><div class="val num">${h.delta > 0 ? "+" : ""}${h.delta} → ${h.qty}</div></div>`).join("")}</div>` : ""}
  </div>`);
  body.querySelector(".ed-folder").appendChild(segmented(FOLDERS.map(f => [f, f]), it.folder, v => { it.folder = v; }));
  body.querySelector(".ed-folder .seg").style.marginTop = "0";
  const $b = s => body.querySelector(s);
  $b(".ed-photo input").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const t = await toThumb(f);
    if (t) { it.img = t; $b(".ed-photo .cl-thumb").replaceWith(el(`<img class="cl-thumb lg" src="${t}" alt="">`)); }
  };
  const sh = sheet({
    title: existing ? "Edit item" : "Add item", body,
    actions: [
      { label: "Cancel", kind: "outlined", onClick: (b, s) => s.close() },
      { label: existing ? "Save" : "Add", kind: "filled", onClick: async (btn, s) => {
        const name = $b("#ed-name").value.trim();
        if (!name) { $b("#ed-err").textContent = "Give the item a name."; $b("#ed-name").focus(); return; }
        if (isDirty() && !existing) { /* count edits stay staged; adding an item is saved on its own */ }
        it.name = name;
        it.price = parseFloat($b("#ed-price").value) || 0;
        const newQty = parseInt($b("#ed-qty").value, 10) || 0;
        const old = STATE.items.find(x => x.id === it.id);
        if (old && Number(old.qty) !== newQty) logHist({ ...it, qty: newQty }, newQty - Number(old.qty));
        it.qty = newQty;
        it.min = $b("#ed-min").value.trim() === "" ? "" : (parseInt($b("#ed-min").value, 10) || 0);
        const idx = STATE.items.findIndex(x => x.id === it.id);
        if (idx >= 0) STATE.items[idx] = it; else STATE.items.push(it);
        OPEN.add(it.folder);
        s.close(); redraw();
        await saveItemChange(existing ? `${it.name} saved` : `${it.name} added`);
      } },
    ],
  });
  if (!existing) setTimeout(() => $b("#ed-name").focus(), 300);
  const del = $b("#ed-del");
  if (del) del.onclick = async () => {
    const ok = await confirmDialog({ title: `Delete ${it.name}?`, body: "This removes it from your inventory. The change history stays.", confirm: "Delete", danger: true });
    if (!ok) return;
    const removed = STATE.items.find(x => x.id === it.id);
    STATE.items = STATE.items.filter(x => x.id !== it.id);
    sh.close(); redraw();
    try { await putServer(STATE); setSaved(STATE); keepLocal(); snackbar(`${it.name} deleted`, { action: "Undo", onAction: async () => { STATE.items.push(removed); redraw(); await saveItemChange(`${it.name} restored`); } }); }
    catch (e) { keepLocal(); snackbar("Didn't save the delete. No connection.", { action: "Retry", onAction: () => saveItemChange(`${it.name} deleted`) }); }
    paintActionbar();
  };
}

function toThumb(file) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const S = 128, k = Math.min(S / img.width, S / img.height, 1);
      const cv = document.createElement("canvas"); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => res(null);
    const fr = new FileReader(); fr.onload = () => img.src = fr.result; fr.readAsDataURL(file);
  });
}

function exportBackup() {
  const data = JSON.stringify(STATE, null, 1);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = `tribal-vend-inventory-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  snackbar("Backup saved to your downloads");
}
function importBackup() {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json";
  inp.onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = async () => {
      let d;
      try { d = JSON.parse(fr.result); if (!d.items) throw 0; } catch { snackbar("That file isn't an inventory backup"); return; }
      const ok = await confirmDialog({ title: "Replace your inventory?", body: `Your current ${STATE.items.length} items will be replaced with the ${d.items.length} items in this backup.`, confirm: "Replace", danger: true });
      if (!ok) return;
      STATE = d; redraw(); await saveItemChange("Backup restored");
    };
    fr.readAsText(f);
  };
  inp.click();
}

let injected = false;
function injectStyles() {
  if (injected) return; injected = true;
  document.head.appendChild(el(`<style>
    .cl-list{box-shadow:inset 0 1px 0 var(--outline-variant)}
    .cl-item{display:flex; align-items:center; gap:4px; min-height:72px; padding:4px 8px 4px 0}
    .cl-item + .cl-item{box-shadow:inset 0 1px 0 var(--outline-variant)}
    .cl-main{flex:1; min-width:0; display:flex; align-items:center; gap:16px; padding:8px 0 8px 16px; background:none; border:0; text-align:left; cursor:pointer; color:var(--on-surface); border-radius:0 var(--r-md) var(--r-md) 0; min-height:64px}
    .cl-main:active{background:color-mix(in srgb, var(--on-surface) 8%, transparent)}
    .cl-thumb{width:40px; height:40px; flex:none; border-radius:var(--r-full); object-fit:cover; background:var(--primary-container); color:var(--on-primary-container); display:inline-flex; align-items:center; justify-content:center; font-size:16px; font-weight:500}
    .cl-thumb.lg{width:56px; height:56px; border-radius:var(--r-md); font-size:22px}
    .cl-text{min-width:0; display:flex; flex-direction:column}
    .cl-name{font-size:16px; line-height:24px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
    .cl-meta{font-size:14px; line-height:20px; color:var(--on-surface-variant); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums}
    .cl-item .stepper .q{width:52px}
    #closet{padding-bottom:88px}
    .ed-3{display:grid; grid-template-columns:repeat(3,1fr); gap:12px}
    .ed-photo{display:flex; align-items:center; gap:16px; margin-top:16px}
  </style>`));
}
