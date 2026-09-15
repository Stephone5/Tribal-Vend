// Closet — the in-app inventory tracker that replaces Sortly.
// Four folders, items with an image, quantity (add/subtract), a low threshold,
// unit price, total value, a change history, and rollups. Stored on the phone
// (localStorage); export/import gives you a backup file so nothing's ever stuck.

import { apiFetch } from "./api.js";

const FOLDERS = ["Snacks", "Candy", "Cold Food", "Drinks"];
const LSK = "tv_closet_v1";

const $c = (s, r=document) => r.querySelector(s);
const elc = (h) => { const t=document.createElement("template"); t.innerHTML=h.trim(); return t.content.firstChild; };
const uid = () => "i" + Math.random().toString(36).slice(2, 9);
const usd = n => "$" + (Number(n)||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

// STATE is the working copy. The server is the source of truth (synced across
// devices); localStorage is an offline cache so the app works with no signal.
let STATE = { items: [], hist: [] };
let saveTimer = null;

const DIRTYK = "tv_closet_dirty";
const SAVEDK = "tv_closet_saved";
// SAVED = the inventory exactly as the server last had it. Unsaved = any count differs from it.
let SAVED = (()=>{ try { return JSON.parse(localStorage.getItem(SAVEDK)); } catch { return null; } })();
let DIRTY = false;
const qtyKey = d => JSON.stringify((d && d.items || []).map(i => [i.id, Number(i.qty)||0]));
function computeDirty(){ DIRTY = !!(SAVED && qtyKey(STATE) !== qtyKey(SAVED)); return DIRTY; }
function setSaved(d){
  SAVED = JSON.parse(JSON.stringify(d));
  try { localStorage.setItem(SAVEDK, JSON.stringify(SAVED)); localStorage.removeItem(DIRTYK); } catch(e){}
}

function load(){ return STATE; }
// Count edits are held on this phone until you tap Save. Nothing half-saves.
function stage(d){
  STATE = d;
  // Back to exactly what's saved: drop the in-between history too, nothing to save.
  if (!computeDirty() && SAVED) STATE = JSON.parse(JSON.stringify(SAVED));
  STATE.__unsaved = DIRTY;
  try { localStorage.setItem(LSK, JSON.stringify(STATE)); } catch(e){}
  paintSaveBar();
}
function cancelEdits(){
  if (!SAVED) return;
  STATE = JSON.parse(JSON.stringify(SAVED)); DIRTY = false;
  try { localStorage.setItem(LSK, JSON.stringify(STATE)); } catch(e){}
  repaintInPlace();
}
async function saveNow(){
  const bar = document.getElementById("cl-savebar");
  const btn = bar && bar.querySelector(".save");
  const msg = bar && bar.querySelector(".m");
  const cancel = bar && bar.querySelector(".cancel"); if (cancel) cancel.hidden = true;
  if (btn){ btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    delete STATE.__unsaved;
    const r = await apiFetch("/api/closet", { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(STATE) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    delete STATE.__unsaved; setSaved(STATE); DIRTY = false;
    await pull(); repaintInPlace();
    const b2 = document.getElementById("cl-savebar");
    if (b2){
      b2.hidden = false; b2.classList.add("ok");
      b2.querySelector(".m").textContent = "Saved. This is your new count.";
      b2.querySelector(".save").hidden = true; b2.querySelector(".cancel").hidden = true;
      setTimeout(()=>{ if(!DIRTY) paintSaveBar(); }, 2000);
    }
  } catch(e) {
    if (btn){ btn.disabled = false; btn.textContent = "Try again"; }
    if (cancel) cancel.hidden = false;
    if (msg) msg.textContent = "Didn't save. Couldn't reach the server. Your counts are still on this phone.";
    if (bar) bar.classList.add("err");
  }
}
function paintSaveBar(){
  let bar = document.getElementById("cl-savebar");
  if (!bar) {
    bar = elc(`<div id="cl-savebar" hidden><div class="m"></div><button class="cancel">Cancel</button><button class="save">Save</button></div>`);
    bar.querySelector(".save").onclick = saveNow;
    bar.querySelector(".cancel").onclick = cancelEdits;
    document.body.appendChild(bar);
  }
  const onInventory = ROOT && !ROOT.hidden;
  computeDirty();
  bar.hidden = !(onInventory && DIRTY);
  bar.classList.remove("err","ok");
  const save = bar.querySelector(".save"), cancel = bar.querySelector(".cancel");
  save.hidden = false; cancel.hidden = false; save.disabled = false; save.textContent = "Save";
  bar.querySelector(".m").textContent = "Unsaved changes";
}
export function closetTabHidden(){
  const bar = document.getElementById("cl-savebar");
  if (bar) bar.hidden = true;
}

function save(d){
  STATE = d;
  try { localStorage.setItem(LSK, JSON.stringify(STATE)); } catch(e){}
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    // Item add/edit/delete and backup import save straight away (they have their own Save).
    apiFetch("/api/closet", { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify(STATE) })
      .then(r => { if (r.ok) { setSaved(STATE); paintSaveBar(); } else alert("That change didn't save to the server. Try again."); })
      .catch(() => alert("That change didn't save. No connection to the server."));
  }, 600);
}
async function pull(){
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(LSK)); } catch {}
  try {
    const r = await apiFetch("/api/closet");
    if (r.ok) {
      const server = await r.json();
      setSaved(server);
      // Unsaved counts on this phone win until you tap Save or Cancel.
      if (cached && cached.__unsaved && cached.items) { cached.live = server.live; cached.countedAt = server.countedAt; STATE = cached; computeDirty(); return; }
      // Safety: if the server came back empty but this device has data, keep the
      // device's copy and push it back up — a server hiccup can't erase your closet.
      if ((!server.items || !server.items.length) && cached && cached.items && cached.items.length) {
        STATE = cached; save(STATE); return;
      }
      STATE = server; try { localStorage.setItem(LSK, JSON.stringify(STATE)); } catch(e){} return;
    }
  } catch(e){}
  STATE = cached || {items:[],hist:[]};
}

// Expose current closet for the brain (buy lists subtract what you already own).
export function closetSnapshot(){
  let s = STATE;
  if (!s.items || !s.items.length) { try { s = JSON.parse(localStorage.getItem(LSK)) || {items:[]}; } catch {} }
  return (s.items||[]).map(i => ({ name:i.name, folder:i.folder, qty:Number(i.qty)||0, price:Number(i.price)||0 }));
}

let injected = false;
function injectStyles(){
  if (injected) return; injected = true;
  document.head.appendChild(elc(`<style>
    .cl-sum{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:6px 0 4px}
    .cl-fold{margin-top:10px}
    .cl-fh{display:flex;align-items:baseline;justify-content:space-between;padding:10px 6px 6px;border-bottom:1px solid var(--line)}
    .cl-fh .n{font-weight:800;font-size:15px}
    .cl-fh .s{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
    .cl-item{display:flex;align-items:center;gap:11px;padding:11px 6px;border-top:1px solid var(--line)}
    .cl-item:first-child{border-top:0}
    .cl-thumb{width:42px;height:42px;border-radius:10px;object-fit:cover;background:var(--surface-2);flex:none;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:18px;font-weight:800}
    .cl-mid{flex:1;min-width:0}
    .cl-mid .nm{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cl-mid .mt{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
    .cl-low{display:inline-block;font-size:10px;font-weight:800;color:#8a6d0a;background:rgba(184,134,11,.16);padding:1px 6px;border-radius:99px;margin-left:6px}
    .cl-step{display:flex;align-items:center;gap:8px;flex:none}
    .cl-step button{width:34px;height:34px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);font-size:20px;font-weight:700;cursor:pointer;line-height:1}
    .cl-step .q{width:48px;height:36px;text-align:center;font-size:17px;font-weight:800;font-variant-numeric:tabular-nums;font-family:inherit;background:var(--surface-2);color:var(--ink);border:1.5px solid var(--line);border-radius:10px;padding:0}
    .cl-step .q:focus{outline:none;border-color:var(--ink);background:var(--surface)}
    #cl-savebar{position:fixed;left:12px;right:12px;bottom:calc(66px + env(safe-area-inset-bottom));z-index:40;display:flex;align-items:center;gap:10px;padding:10px 10px 10px 16px;border-radius:16px;background:var(--char);color:#fff;box-shadow:0 8px 28px rgba(0,0,0,.35)}
    #cl-savebar[hidden]{display:none}
    #cl-savebar .m{flex:1;font-size:14px;font-weight:700;line-height:1.3}
    #cl-savebar button{flex:none;height:44px;padding:0 22px;border-radius:12px;border:0;background:var(--gold);color:#282828;font-size:16px;font-weight:800;font-family:inherit;cursor:pointer}
    #cl-savebar button[hidden]{display:none}
    #cl-savebar .cancel{background:transparent;color:#fff;border:1.5px solid rgba(255,255,255,.35);padding:0 16px}
    #closet{padding-bottom:76px}
    .cl-log{margin-top:12px;padding:6px 14px}
    .cl-log summary{cursor:pointer;font-weight:800;font-size:15px;padding:10px 2px;list-style:none}
    .cl-log summary::-webkit-details-marker{display:none}
    .cl-log .h{display:grid;grid-template-columns:auto 1fr auto;gap:10px;font-size:13px;padding:8px 2px;border-top:1px solid var(--line);font-variant-numeric:tabular-nums}
    .cl-log .h .t{color:var(--muted);white-space:nowrap}
    .cl-log .h .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .cl-log .h .c{font-weight:800;white-space:nowrap}
    #cl-savebar.err{background:var(--bad)}
    #cl-savebar.ok{background:var(--good)}

    .cl-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;display:flex;align-items:flex-end;justify-content:center}
    .cl-sheet{background:var(--surface);width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:16px 16px calc(20px + env(safe-area-inset-bottom));max-height:92vh;overflow:auto}
    .cl-sheet h3{margin:2px 2px 12px;font-size:17px}
    .cl-seg{display:flex;flex-wrap:wrap;gap:7px;margin-top:7px}
    .cl-seg button{flex:1;min-width:70px;padding:10px 6px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);font-weight:700;font-size:12px;cursor:pointer}
    .cl-seg button.on{background:var(--char);color:#fff}
    .cl-row2{display:flex;gap:10px}
    .cl-row2 .field{flex:1}
    .cl-imgpick{display:flex;align-items:center;gap:12px;margin:12px 0 4px}
    .cl-imgpick img{width:56px;height:56px;border-radius:12px;object-fit:cover}
    .cl-del{color:#f08b8b;background:none;border:0;font-weight:700;font-size:14px;padding:10px;cursor:pointer;width:100%;margin-top:4px}
    .cl-hist{margin-top:10px;border-top:1px solid var(--line);padding-top:8px}
    .cl-hist .h{font-size:12px;color:var(--muted);display:flex;justify-content:space-between;padding:5px 2px;font-variant-numeric:tabular-nums}
    .cl-tools{display:flex;gap:8px;margin-top:12px}
    .cl-tools button{flex:1;padding:11px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink-2);font-weight:700;font-size:12px;cursor:pointer}
    /* collapsible folder dropdowns (Sortly-style) */
    .cl-fold{margin-top:12px;padding:6px 14px 6px}
    .cl-fhead{display:flex;align-items:center;gap:12px;padding:10px 2px;cursor:pointer}
    .cl-fgrid{width:46px;height:46px;flex:none;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:2px;border-radius:10px;overflow:hidden;background:var(--surface-2)}
    .cl-fgrid img{width:100%;height:100%;object-fit:cover}
    .cl-fgrid .ph{display:flex;align-items:center;justify-content:center;background:var(--surface-2);color:var(--muted);font-size:11px;font-weight:800}
    .cl-finfo{flex:1;min-width:0}
    .cl-finfo .fn{font-weight:800;font-size:16px}
    .cl-finfo .fs{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums;margin-top:2px}
    .cl-flow{color:var(--bad);font-weight:800}
    .cl-chev{color:var(--muted);font-size:20px;transition:transform .15s;flex:none;line-height:1}
    .cl-chev.open{transform:rotate(90deg)}
    .cl-items{border-top:1px solid var(--line);margin-top:2px}
    .cl-items[hidden]{display:none}
    /* item name line — chip stays put, name truncates */
    .cl-nmline{display:flex;align-items:center;gap:6px}
    .cl-nmtext{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600}
    .cl-low{flex:none}
  </style>`));
}

// shrink an uploaded image to a small thumbnail so localStorage stays light
function toThumb(file){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      const S=128, s=Math.min(S/img.width,S/img.height,1);
      const w=Math.round(img.width*s), h=Math.round(img.height*s);
      const cv=document.createElement("canvas"); cv.width=w; cv.height=h;
      cv.getContext("2d").drawImage(img,0,0,w,h);
      res(cv.toDataURL("image/jpeg",0.7));
    };
    img.onerror=()=>res(null);
    const fr=new FileReader(); fr.onload=()=>img.src=fr.result; fr.readAsDataURL(file);
  });
}

let ROOT=null;
const OPEN_FOLDERS = new Set();   // folders stay open when the page redraws
function repaintInPlace(){ const y = window.scrollY; paint(); window.scrollTo(0, y); }
export async function renderCloset(rootEl){
  injectStyles();
  ROOT = rootEl;
  ROOT.innerHTML = `<h2>Inventory</h2><div class="empty">Loading…</div>`;
  await pull();
  paint();
}

function logHist(d, item, delta){
  d.hist.unshift({ itemId:item.id, name:item.name, t:Date.now(), delta, qty:item.qty });
  d.hist = d.hist.slice(0, 400);
}

function paint(){
  paintSaveBar();
  const d = load();
  const root = ROOT; root.innerHTML = "";

  const totUnits = d.items.reduce((a,i)=>a+(Number(i.qty)||0),0);
  const totValue = d.items.reduce((a,i)=>a+(Number(i.qty)||0)*(Number(i.price)||0),0);

  root.appendChild(elc(`<h2>Inventory</h2>`));

  // LIVE count: what you counted at the last fill, minus everything sold since —
  // drops with every sale, resets when you recount. Falls back to the static
  // count if the sales feed isn't available.
  const live = d.live;
  let sum;
  if (live && live.baseline) {
    const liveUnits = live.liveUnits;
    const liveValue = totValue * (live.baseline ? liveUnits / live.baseline : 1);
    const dateTxt = new Date(live.countedAt + "T12:00:00").toLocaleDateString([], { month:"short", day:"numeric" });
    sum = elc(`<div class="cl-sum">
      <div class="tile"><div class="k">In stock now</div><div class="v">${liveUnits.toLocaleString()}</div><div class="d" style="color:var(--muted)">${live.soldSince} sold since ${dateTxt}</div></div>
      <div class="tile"><div class="k">Value in stock</div><div class="v">${usd(liveValue)}</div><div class="d" style="color:var(--muted)">of ${usd(totValue)} counted</div></div>
    </div>`);
    root.appendChild(sum);
    root.appendChild(elc(`<div class="note" style="margin-top:10px;font-size:12px">Counted <b>${live.baseline.toLocaleString()} units</b> at your ${dateTxt} fill. Drops with every sale; recount (edit any item or re-import) to reset the baseline.</div>`));
  } else {
    sum = elc(`<div class="cl-sum">
      <div class="tile"><div class="k">Total units</div><div class="v">${totUnits.toLocaleString()}</div><div class="d" style="color:var(--muted)">across all folders</div></div>
      <div class="tile"><div class="k">Total value</div><div class="v">${usd(totValue)}</div><div class="d" style="color:var(--muted)">at your unit prices</div></div>
    </div>`);
    root.appendChild(sum);
  }

  const add = elc(`<button class="btn" style="margin-top:8px">+ Add item</button>`);
  add.onclick = ()=>openEditor(null);
  root.appendChild(add);

  // One collapsible dropdown per folder — tap to open, like Sortly.
  for (const folder of FOLDERS){
    const items = d.items.filter(i=>i.folder===folder).sort((a,b)=>a.name.localeCompare(b.name));
    const fu = items.reduce((a,i)=>a+(Number(i.qty)||0),0);
    const fv = items.reduce((a,i)=>a+(Number(i.qty)||0)*(Number(i.price)||0),0);
    const lowCount = items.filter(i=>i.min!=null&&i.min!==""&&Number(i.qty)<=Number(i.min)).length;

    const card = elc(`<div class="cl-fold card"></div>`);
    const thumbs = items.slice(0,4).map(i=> i.img?`<img src="${i.img}" alt="">`:`<div class="ph">${(i.name||"?").slice(0,1).toUpperCase()}</div>`).join("");
    const filler = Array.from({length:Math.max(0,4-Math.min(4,items.length))}).map(()=>`<div class="ph"></div>`).join("");
    const head = elc(`<div class="cl-fhead">
      <div class="cl-fgrid">${thumbs}${filler}</div>
      <div class="cl-finfo"><div class="fn">${folder}</div><div class="fs">${items.length} item${items.length===1?"":"s"} · ${fu} units · ${usd(fv)}${lowCount?` · <span class="cl-flow">${lowCount} low</span>`:""}</div></div>
      <span class="cl-chev">›</span>
    </div>`);
    const list = elc(`<div class="cl-items" ${OPEN_FOLDERS.has(folder)?"":"hidden"}></div>`);
    if (OPEN_FOLDERS.has(folder)) head.querySelector(".cl-chev").classList.add("open");
    items.forEach(it=>list.appendChild(itemRow(it)));
    if(!items.length) list.appendChild(elc(`<div class="empty" style="padding:16px 4px">No items in ${folder} yet.</div>`));
    head.onclick = ()=>{ const open=list.hidden; list.hidden=!open; head.querySelector(".cl-chev").classList.toggle("open",open); open?OPEN_FOLDERS.add(folder):OPEN_FOLDERS.delete(folder); };
    card.appendChild(head); card.appendChild(list);
    root.appendChild(card);
  }

  // Every count change, newest first: when, what, by how much, and what it became.
  const hist = (d.hist || []);
  const log = elc(`<details class="card cl-log"><summary>Change history · ${hist.length} change${hist.length===1?"":"s"} ›</summary></details>`);
  if (!hist.length) log.appendChild(elc(`<div class="empty" style="padding:12px 2px">No changes logged yet.</div>`));
  hist.forEach(h => {
    const when = new Date(h.t);
    const t = when.toLocaleDateString([], {month:"short", day:"numeric"}) + " " + when.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
    log.appendChild(elc(`<div class="h"><span class="t">${t}</span><span class="n">${escapeHtml(h.name||"")}</span><span class="c">${h.delta>0?"+":""}${h.delta} → ${h.qty}</span></div>`));
  });
  root.appendChild(log);

  const tools = elc(`<div class="cl-tools"><button id="cl-exp">Export backup</button><button id="cl-imp">Import backup</button></div>`);
  root.appendChild(tools);
  tools.querySelector("#cl-exp").onclick = exportBackup;
  tools.querySelector("#cl-imp").onclick = importBackup;
}

function itemRow(it){
  const value = (Number(it.qty)||0)*(Number(it.price)||0);
  const low = it.min!=null && it.min!=="" && Number(it.qty)<=Number(it.min);
  const row = elc(`<div class="cl-item">
    ${it.img ? `<img class="cl-thumb" src="${it.img}" alt="">` : `<div class="cl-thumb">${(it.name||"?").slice(0,1).toUpperCase()}</div>`}
    <div class="cl-mid">
      <div class="cl-nmline"><span class="cl-nmtext">${escapeHtml(it.name)}</span>${low?`<span class="cl-low">LOW</span>`:""}</div>
      <div class="mt">${usd(it.price)} ea · ${usd(value)} total</div>
    </div>
    <div class="cl-step">
      <button data-a="minus">–</button>
      <input class="q" inputmode="numeric" pattern="[0-9]*" enterkeyhint="done" value="${Number(it.qty)||0}" aria-label="Count for ${escapeHtml(it.name)}">
      <button data-a="plus">+</button>
    </div>
  </div>`);
  const setQty = (next, log = true)=>{
    const d = load();
    const item = d.items.find(x=>x.id===it.id); if(!item) return;
    next = Math.max(0, Math.floor(Number(next)||0));
    const delta = next - (Number(item.qty)||0);
    if (!delta) return;
    item.qty = next;
    if (log) logHist(d, item, delta);
    stage(d);
    it.qty = item.qty;
    const qin = row.querySelector(".q"); if (document.activeElement !== qin) qin.value = item.qty;
    row.querySelector(".mt").textContent = `${usd(item.price)} ea · ${usd(item.qty*(Number(item.price)||0))} total`;
    const lowNow = item.min!=null && item.min!=="" && Number(item.qty)<=Number(item.min);
    const nm = row.querySelector(".cl-nmline");
    nm.innerHTML = `<span class="cl-nmtext">${escapeHtml(item.name)}</span>${lowNow?`<span class="cl-low">LOW</span>`:""}`;
    updateRollups();
  };
  const qi = row.querySelector(".q");
  row.querySelector('[data-a="minus"]').onclick = ()=>setQty((Number(it.qty)||0) - 1);
  row.querySelector('[data-a="plus"]').onclick = ()=>setQty((Number(it.qty)||0) + 1);
  // Update live while typing; log one history entry when you leave the box.
  qi.onfocus = ()=>{ qi.dataset.was = qi.value; };
  qi.oninput = ()=>{ qi.value = qi.value.replace(/[^0-9]/g,""); if (qi.value !== "") setQty(qi.value, false); };
  qi.onblur = ()=>{ if (qi.value === "") { qi.value = qi.dataset.was || "0"; setQty(qi.value, false); } };
  qi.onkeydown = e=>{ if (e.key === "Enter") qi.blur(); };
  qi.onchange = ()=>{
    if (qi.value === "") return;
    const was = Number(qi.dataset.was); const now = Number(qi.value);
    if (!isNaN(was) && !isNaN(now) && now !== was) {
      const d = load(); const item = d.items.find(x=>x.id===it.id);
      if (item) { logHist(d, item, now - was); stage(d); }
    }
  };
  row.querySelector(".cl-mid").onclick = ()=>openEditor(it);
  row.querySelector(".cl-thumb").onclick = ()=>openEditor(it);
  return row;
}

function updateRollups(){
  const d = load();
  const totUnits = d.items.reduce((a,i)=>a+(Number(i.qty)||0),0);
  const totValue = d.items.reduce((a,i)=>a+(Number(i.qty)||0)*(Number(i.price)||0),0);
  const tiles = ROOT.querySelectorAll(".cl-sum .v");
  if (tiles[0]) tiles[0].textContent = totUnits.toLocaleString();
  if (tiles[1]) tiles[1].textContent = usd(totValue);
  // folder subtotals + low counts
  ROOT.querySelectorAll(".cl-fold").forEach(card=>{
    const fn = card.querySelector(".cl-finfo .fn"); if(!fn) return;
    const folder = fn.textContent;
    const items = d.items.filter(i=>i.folder===folder);
    const fu = items.reduce((a,i)=>a+(Number(i.qty)||0),0);
    const fv = items.reduce((a,i)=>a+(Number(i.qty)||0)*(Number(i.price)||0),0);
    const lowCount = items.filter(i=>i.min!=null&&i.min!==""&&Number(i.qty)<=Number(i.min)).length;
    const fs = card.querySelector(".cl-finfo .fs");
    if(fs) fs.innerHTML = `${items.length} item${items.length===1?"":"s"} · ${fu} units · ${usd(fv)}${lowCount?` · <span class="cl-flow">${lowCount} low</span>`:""}`;
  });
}

function openEditor(existing){
  const d = load();
  const it = existing ? {...existing} : { id:uid(), folder:"Snacks", name:"", price:"", qty:0, min:"", img:null };
  const modal = elc(`<div class="cl-modal"></div>`);
  const sheet = elc(`<div class="cl-sheet"></div>`);
  modal.appendChild(sheet); document.body.appendChild(modal);
  modal.onclick = (e)=>{ if(e.target===modal) modal.remove(); };

  sheet.appendChild(elc(`<h3>${existing?"Edit item":"Add item"}</h3>`));

  const seg = elc(`<div><div style="font-size:13px;color:var(--ink-2);font-weight:600;margin-bottom:2px">Folder</div><div class="cl-seg">${FOLDERS.map(f=>`<button data-f="${f}" class="${f===it.folder?"on":""}">${f}</button>`).join("")}</div></div>`);
  seg.querySelectorAll("button").forEach(b=>b.onclick=()=>{ it.folder=b.dataset.f; seg.querySelectorAll("button").forEach(x=>x.classList.toggle("on",x===b)); });
  sheet.appendChild(seg);

  const nameF = elc(`<div class="field"><label>Item name</label><input type="text" value="${escapeAttr(it.name)}" placeholder="e.g. Monster Energy 24pk"></div>`);
  sheet.appendChild(nameF);

  const row2 = elc(`<div class="cl-row2">
    <div class="field"><label>Price each</label><input type="text" inputmode="decimal" value="${it.price!==""&&it.price!=null?it.price:""}" placeholder="0.00"></div>
    <div class="field"><label>Quantity</label><input type="text" inputmode="numeric" value="${Number(it.qty)||0}"></div>
    <div class="field"><label>Low at</label><input type="text" inputmode="numeric" value="${it.min!=null?it.min:""}" placeholder="—"></div>
  </div>`);
  sheet.appendChild(row2);
  const [priceI, qtyI, minI] = row2.querySelectorAll("input");

  const imgPick = elc(`<div class="cl-imgpick">
    ${it.img?`<img src="${it.img}" alt="">`:`<div class="cl-thumb">${(it.name||"?").slice(0,1).toUpperCase()}</div>`}
    <label class="btn ghost" style="margin:0;flex:1;text-align:center">Photo<input type="file" accept="image/*" capture="environment" hidden></label>
  </div>`);
  sheet.appendChild(imgPick);
  imgPick.querySelector("input").onchange = async (e)=>{
    const f=e.target.files[0]; if(!f) return;
    const t=await toThumb(f); if(t){ it.img=t; const cur=imgPick.querySelector("img,.cl-thumb"); const ni=elc(`<img src="${t}" alt="">`); cur.replaceWith(ni); }
  };

  const saveBtn = elc(`<button class="btn" style="margin-top:14px">${existing?"Save":"Add to inventory"}</button>`);
  saveBtn.onclick = ()=>{
    it.name = nameF.querySelector("input").value.trim();
    if(!it.name){ nameF.querySelector("input").focus(); return; }
    it.price = parseFloat(priceI.value)||0;
    it.qty = parseInt(qtyI.value,10)||0;
    it.min = minI.value.trim()===""?"":(parseInt(minI.value,10)||0);
    const dd = load();
    const idx = dd.items.findIndex(x=>x.id===it.id);
    if(idx>=0) dd.items[idx]=it; else dd.items.push(it);
    save(dd);
    modal.remove();
    paint();
  };
  sheet.appendChild(saveBtn);

  if (existing){
    const delBtn = elc(`<button class="cl-del">Delete item</button>`);
    delBtn.onclick = ()=>{
      if(!confirm(`Delete "${it.name}"?`)) return;
      const dd=load(); dd.items=dd.items.filter(x=>x.id!==it.id); save(dd); modal.remove(); paint();
    };
    sheet.appendChild(delBtn);

    const hist = d.hist.filter(h=>h.itemId===it.id).slice(0,8);
    if (hist.length){
      const hs = elc(`<div class="cl-hist"><div style="font-size:12px;color:var(--muted);font-weight:700;margin:2px">Recent changes</div></div>`);
      hist.forEach(h=>hs.appendChild(elc(`<div class="h"><span>${h.delta>0?"+":""}${h.delta} → ${h.qty}</span><span>${new Date(h.t).toLocaleDateString()} ${new Date(h.t).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span></div>`)));
      sheet.appendChild(hs);
    }
  }
}

function exportBackup(){
  const data = localStorage.getItem(LSK) || "{}";
  const blob = new Blob([data], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tribal-vend-closet-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}
function importBackup(){
  const inp = document.createElement("input"); inp.type="file"; inp.accept="application/json";
  inp.onchange = (e)=>{
    const f=e.target.files[0]; if(!f) return;
    const fr=new FileReader();
    fr.onload=()=>{ try{ const d=JSON.parse(fr.result); if(!d.items) throw 0; if(confirm("Replace your current closet with this backup?")){ save(d); paint(); } }catch{ alert("That doesn't look like a closet backup file."); } };
    fr.readAsText(f);
  };
  inp.click();
}

function escapeHtml(s){ return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }
