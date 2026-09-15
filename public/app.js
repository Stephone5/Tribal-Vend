import { MACHINES, packageOf } from "./data.js";
import { renderCloset, closetTabHidden } from "./closet.js";
import { renderCompany } from "./company.js";
import { renderChat } from "./chat.js";
import { apiFetch, setPass } from "./api.js";

// Financial data loads from the server (behind the passcode), not the public bundle.
let MONTHLY=[], FIXED_COSTS=[], SLOTS=[], LOAN=null, WINDOW_LABEL="";
let financeLoaded=false;
async function loadFinance(){
  if(financeLoaded) return;
  try{
    const r=await apiFetch("/api/finance");
    if(r.ok){ const f=await r.json(); MONTHLY=f.monthly||[]; FIXED_COSTS=f.fixedCosts||[]; SLOTS=f.slots||[]; LOAN=f.loan; WINDOW_LABEL=f.windowLabel||""; financeLoaded=true; }
  }catch(e){}
}

const $ = (s, r=document) => r.querySelector(s);
const money = n => (n<0?"-$":"$") + Math.abs(n).toLocaleString("en-US",{maximumFractionDigits:0});
const money2 = n => (n<0?"-$":"$") + Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
const el = (html) => { const t=document.createElement("template"); t.innerHTML=html.trim(); return t.content.firstChild; };
// Escape any product/brain-sourced text before it goes into innerHTML.
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const SVGNS="http://www.w3.org/2000/svg";

// ---------- tab nav ----------
document.querySelectorAll("nav button").forEach(b=>{
  b.onclick = () => {
    document.querySelectorAll("nav button").forEach(x=>x.classList.toggle("on", x===b));
    const tab=b.dataset.tab;
    $("#company").hidden = tab!=="company";
    $("#runs").hidden = tab!=="runs";
    $("#closet").hidden = tab!=="closet";
    $("#chat").hidden = tab!=="chat";
    if(tab==="closet") renderCloset($("#closet")); else closetTabHidden();
    if(tab==="company") renderCompany($("#company"));
    if(tab==="chat") renderChat($("#chat"));
    // Chat manages its own scroll (opens at the bottom); everything else tops out.
    if(tab!=="chat") window.scrollTo(0,0);
  };
});

// ---------- light / dark theme ----------
(function(){
  const btn = document.getElementById("themeBtn");
  if(!btn) return;
  const MOON = `<svg viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`;
  const SUN = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>`;
  const paint = () => { btn.innerHTML = document.documentElement.getAttribute("data-theme")==="dark" ? SUN : MOON; };
  btn.onclick = () => {
    const next = document.documentElement.getAttribute("data-theme")==="dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try{ localStorage.setItem("tv_theme", next); }catch(e){}
    const tc = document.querySelector('meta[name="theme-color"]'); if(tc) tc.setAttribute("content", next==="dark" ? "#141417" : "#282828");
    paint();
  };
  paint();
})();

// ---------- Runs section ----------
let LIVE=null;
async function getLive(){
  if(LIVE) return LIVE;
  try{ const r=await apiFetch("/api/live"); if(r.ok) LIVE=await r.json(); }catch(e){}
  return LIVE;
}

// Deliberate, rare full re-read of AirVend — forces the server to re-pull the
// live planogram (pars, prices, swapped products, on-hand), clears every client
// cache, and re-renders both tabs. Triggered only from the double-confirm button.
window.tvResyncAirVend = async function(){
  try{ localStorage.removeItem("tv_live_cache_v2"); }catch(e){}
  LIVE=null;
  try{ await apiFetch("/api/live?refresh=1"); }catch(e){}
  LIVE=null; // ensure the fresh pull is fetched, not a stale in-memory copy
  renderCompany($("#company"));
  renderRuns();
  renderCloset($("#closet")); // re-pull the closet too so no tab is left stale
};

const cleanItem = p => {
  let s = String(p||"").replace(/^(Meals|Drinks|Crackers|Snacks|Candy)\s*[-:]\s*/i,"").replace(/^\d+(\.\d+)?\s*oz\s*[-:]\s*/i,"");
  const trimmed = s.replace(/,.*$/,"").replace(/\s*\d+(\.\d+)?\s*(oz|fl oz|ct|count|piece|pk)\b.*$/i,"").trim();
  return trimmed || s.replace(/,.*$/,"").trim() || s.trim(); // never blank
};

async function renderRuns(){
  const root=$("#runs"); root.innerHTML=`<h2>Refill to par</h2><div class="empty">Reading the machines from AirVend…</div>`;
  const live=await getLive();
  root.innerHTML="";
  root.appendChild(el(`<h2>Refill to par</h2>`));

  const machines = (live && live.machines && live.machines.length) ? live.machines : null;
  if(!machines){
    root.appendChild(el(`<div class="empty">Couldn't reach AirVend to read on-hand counts.</div>`));
    const rb=el(`<button class="btn ghost">Retry</button>`); rb.onclick=()=>{LIVE=null;renderRuns();}; root.appendChild(rb);
    return;
  }

  const pick=el(`<div class="field"><label>Machine</label><select id="mpick"></select></div>`);
  const sel=pick.querySelector("select");
  machines.forEach(m=>sel.appendChild(el(`<option value="${m.id}">${m.name}</option>`)));
  root.appendChild(pick);

  const out=el(`<div id="refillout"></div>`);
  root.appendChild(out);

  function paint(){
    const m = machines.find(x=>String(x.id)===String(sel.value)) || machines[0];
    out.innerHTML="";
    const slots=(m.slots||[]).map(s=>({slot:s.slot, item:cleanItem(s.product), raw:s.product, onHand:Number(s.onHand)||0, par:Number(s.max)||0}))
      .map(s=>({...s, need:Math.max(0, s.par - s.onHand)}));
    const need=slots.filter(s=>s.need>0).sort((a,b)=>(+a.slot)-(+b.slot));
    const totalUnits=need.reduce((a,s)=>a+s.need,0);

    if(!(m.slots||[]).length){ out.appendChild(el(`<div class="empty">Couldn't load this machine's slots.</div>`)); return; }
    if(!need.length){ out.appendChild(el(`<div class="note good"><b>Full to par.</b> Nothing to refill on ${m.name}.</div>`)); return; }

    // ONE list — grouped by package (how you buy it), with the per-slot fill
    // detail nested underneath. All Sun Chips / Miss Vickie's / Snyder's /
    // Gatorade collapse into a single line (Arizona flavors stay separate); the
    // number on the right is the package total, the sub-line is where each unit
    // goes. Fixes the Bring-vs-By-slot split and the "listed twice" problem.
    const groups={};
    need.forEach(s=>{ const g=packageOf(s.raw); if(!groups[g.key])groups[g.key]={label:g.label,total:0,slots:[]}; groups[g.key].total+=s.need; groups[g.key].slots.push(s); });
    // Spiral order, highest slot number first (walk the machine top-down).
    const topSlot=g=>Math.max(...g.slots.map(s=>+s.slot));
    const glist=Object.values(groups).sort((a,b)=>topSlot(b)-topSlot(a));
    const fullCount=slots.length-need.length;
    const c=el(`<div class="card buy"><div class="ct">Refill list · ${m.name}</div><div class="cs">${totalUnits} units to buy across ${need.length} slots · ${fullCount} already at par</div></div>`);
    const rows=el(`<div class="rows"></div>`);
    glist.forEach(g=>{
      const detail=g.slots.slice().sort((a,b)=>(+b.slot)-(+a.slot)).map(s=>`#${s.slot} ${s.onHand}/${s.par} (+${s.need})`).join(" · ");
      rows.appendChild(el(`<div class="row"><div class="nm">${esc(g.label)}<div class="mt">${detail}</div></div><div class="val">+${g.total}</div></div>`));
    });
    c.appendChild(rows); out.appendChild(c);

    // 3) optional: turn it into a Sam's whole-case list via the brain
    const gen=el(`<button class="btn ghost" style="margin-top:12px">Turn into a Sam's case list →</button>`);
    const bout=el(`<div></div>`);
    gen.onclick=()=>buildBuyListFromNeeds(m.name, need, bout, gen);
    out.appendChild(gen); out.appendChild(bout);

    // --- After filling: push actual on-hand back to AirVend ---
    const upd=el(`<div style="margin-top:20px"></div>`);
    const updBtn=el(`<button class="btn">✓ I filled it — update AirVend on-hand</button>`);
    const updBody=el(`<div hidden style="margin-top:12px"></div>`);
    upd.appendChild(updBtn); upd.appendChild(updBody);
    let upBuilt=false;
    updBtn.onclick=()=>{ updBody.hidden=!updBody.hidden; updBtn.textContent=updBody.hidden?"✓ I filled it — update AirVend on-hand":"Hide"; if(upBuilt||updBody.hidden)return; upBuilt=true; buildUpdatePanel(m, updBody); };
    out.appendChild(upd);
  }
  sel.onchange=paint; paint();

  const rb=el(`<button class="btn ghost" style="margin-top:16px">↻ Refresh from AirVend</button>`);
  rb.onclick=async()=>{ rb.textContent="Refreshing…"; rb.disabled=true; try{ await apiFetch("/api/live?refresh=1"); }catch(e){} LIVE=null; renderRuns(); };
  root.appendChild(rb);
}

async function buildBuyListFromNeeds(machine, need, out, gen){
  const shorts=need.map(s=>({slot:s.slot, item:s.item, missing:s.need}));
  out.innerHTML=""; gen.disabled=true; gen.textContent="Thinking…";
  let res, body;
  try{
    res=await apiFetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({machine,shorts})});
    body=await res.json();
  }catch(e){ gen.disabled=false; gen.textContent="Turn into a Sam's case list →"; out.appendChild(el(`<div class="note">Couldn't reach the brain — the list above is your refill.</div>`)); return; }
  gen.disabled=false; gen.textContent="Turn into a Sam's case list →";
  if(res.status===503 || body.error==="no_key" || !res.ok || body.error){
    out.appendChild(el(`<div class="note">${body.message||"The brain isn't connected yet."} The refill list above is what you need.</div>`)); return;
  }
  renderBrain(out, body, {machine});
}

// Build the "update AirVend on-hand" panel: one input per slot pre-set to par
// (= what you filled to). Change only the slots you filled short, then preview.
function buildUpdatePanel(m, body){
  body.appendChild(el(`<div class="note warn">Sets AirVend's <b>on-hand</b> to what you actually filled — the same as Edit → <b>Update on hand</b> in AirVend (not "quantity added"). Every slot defaults to <b>par</b>; change only the ones you filled short. Nothing is written until you preview and confirm.</div>`));
  const rows=el(`<div class="rows" style="margin-top:10px"></div>`);
  (m.slots||[]).slice().sort((a,b)=>(+b.slot)-(+a.slot)).forEach(s=>{
    const par=Number(s.max)||0;
    rows.appendChild(el(`<div class="row"><div class="nm">${esc(cleanItem(s.product))}<div class="mt">slot ${s.slot} · par ${par} · now ${s.onHand}</div></div><input class="uq" inputmode="numeric" pattern="[0-9]*" enterkeyhint="next" value="${par}" data-slot="${s.slot}" data-par="${par}" style="width:56px;height:40px;text-align:center;font-size:17px;font-weight:800;background:var(--surface-2);border:1.5px solid var(--line);border-radius:11px;color:var(--ink)"></div>`));
  });
  body.appendChild(rows);
  const prev=el(`<button class="btn ghost" style="margin-top:12px">Preview what changes →</button>`);
  const planOut=el(`<div></div>`);
  prev.onclick=()=>previewWrite(m, body, planOut, prev);
  body.appendChild(prev); body.appendChild(planOut);
}

function collectGaps(body){
  return [...body.querySelectorAll(".uq")].map(i=>{
    const par=+i.dataset.par; let v=parseInt(i.value,10); if(isNaN(v)) v=par; v=Math.max(0,Math.min(par,v));
    return { slot:i.dataset.slot, missing:par-v };
  }).filter(g=>g.missing>0);
}

async function previewWrite(m, body, out, prevBtn){
  const gaps=collectGaps(body);
  out.innerHTML=""; prevBtn.disabled=true; prevBtn.textContent="Reading AirVend…";
  let res;
  try{ res=await (await apiFetch("/api/airvend/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({machineId:m.id, gaps})})).json(); }
  catch(e){ prevBtn.disabled=false; prevBtn.textContent="Preview what changes →"; out.appendChild(el(`<div class="note bad">Couldn't reach AirVend to preview. Nothing changed.</div>`)); return; }
  prevBtn.disabled=false; prevBtn.textContent="Preview what changes →";
  if(res.error){ out.appendChild(el(`<div class="note bad">${res.message||"Preview failed."}</div>`)); return; }
  const changes=(res.plan||[]).filter(p=>Number(p.from)!==Number(p.to));
  if(!changes.length){ out.appendChild(el(`<div class="note">AirVend already matches — nothing to write.</div>`)); return; }
  const c=el(`<div class="card"><div class="ct">Preview · ${changes.length} slot${changes.length===1?"":"s"} change</div><div class="cs">Nothing has been written yet</div></div>`);
  const rows=el(`<div class="rows"></div>`);
  changes.forEach(p=>rows.appendChild(el(`<div class="row"><div class="nm">${esc(cleanItem(p.product))}<div class="mt">slot ${p.slot}</div></div><div class="val">${p.from} → <b>${p.to}</b></div></div>`)));
  c.appendChild(rows); out.appendChild(c);
  const conf=el(`<button class="btn" style="margin-top:12px;background:var(--bad);color:#fff">Confirm — write ${changes.length} to AirVend</button>`);
  conf.onclick=()=>confirmWrite(m, gaps, out, conf);
  out.appendChild(conf);
}

async function confirmWrite(m, gaps, out, btn){
  btn.disabled=true; btn.textContent="Writing to AirVend…";
  let res;
  try{ res=await (await apiFetch("/api/airvend/write",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({machineId:m.id, gaps})})).json(); }
  catch(e){ btn.disabled=false; btn.textContent="Confirm — write to AirVend"; out.appendChild(el(`<div class="note bad">Couldn't reach AirVend. Nothing changed.</div>`)); return; }
  if(res.error || res.dryRun){ btn.disabled=false; btn.textContent="Confirm — write to AirVend"; out.appendChild(el(`<div class="note bad">${res.message||"Write failed — nothing changed."}</div>`)); return; }
  out.innerHTML=""; out.appendChild(el(`<div class="note good"><b>Saved and checked.</b> I read AirVend back after writing: all ${res.wrote} slots on ${m.name} took. Refill date set to ${esc(res.refillDate||"now")}.${(res.soldSince&&res.soldSince.length)?`<br><br>Already sold since you saved: ${res.soldSince.map(x=>`slot ${esc(x.slot)} ${esc(cleanItem(x.product))} (${x.entered} → ${x.now})`).join(", ")}. That's a sale, not a missed save.`:""} Hit Refresh here to update the list.</div>`));
  LIVE=null;
}

// Full brain result: summary, reconciliation, buy list in cases, change orders.
// Everything here is Claude-generated JSON — escaped before it hits innerHTML.
function renderBrain(out, b){
  if(b.summary) out.appendChild(el(`<div class="note" style="border-left-color:var(--good);margin-top:24px">${esc(b.summary)}</div>`));

  if(b.buyList && b.buyList.length){
    out.appendChild(el(`<h2>Buy list <span class="pill warn">${b.buyList.length}</span></h2>`));
    const c=el(`<div class="card buy"><div class="ct">Bring to next refill</div><div class="cs">Whole cases · Sam's links attach when the catalog is wired</div></div>`);
    const rows=el(`<div class="rows"></div>`);
    b.buyList.forEach(x=>rows.appendChild(el(`<div class="row"><div class="nm">${esc(x.item)}<div class="mt">slot ${esc(x.slot)} · ${esc(x.reason||"")}</div></div><div class="val">${x.cases}× case${x.cases===1?"":"s"}</div></div>`)));
    c.appendChild(rows); out.appendChild(c);
  }

  if(b.changeOrders && b.changeOrders.length){
    out.appendChild(el(`<h2>Change orders <span class="pill warn">${b.changeOrders.length}</span></h2>`));
    const c=el(`<div class="card"><div class="ct">Worth doing this cycle</div><div class="cs">Pricing, planogram, and par moves</div></div>`);
    const rows=el(`<div class="rows"></div>`);
    b.changeOrders.forEach(x=>rows.appendChild(el(`<div class="row"><div class="nm">${esc(x.item)}<div class="mt">slot ${esc(x.slot)} · ${esc(x.type)} · ${esc(x.reason||"")}</div></div><div class="val">${esc(x.from)} → ${esc(x.to)}</div></div>`)));
    c.appendChild(rows); out.appendChild(c);
  }

  if(b.reconciliation) out.appendChild(el(`<div class="note">${esc(b.reconciliation)}</div>`));
}

// ---------- unlock gate (the #lock splash is painted first, from index.html) ----------
async function ensureUnlocked(){
  const lock = document.getElementById("lock");
  // Already have a passcode saved → trust it and open instantly. No network
  // probe on every launch (that was part of the slow start). If it's somehow
  // wrong, the data calls will 401 and show an error rather than blocking boot.
  if (localStorage.getItem("tv_pass")){ if(lock) lock.remove(); return; }

  let r;
  try { r = await apiFetch("/api/finance"); }
  catch(e){ if(lock) lock.remove(); return; } // offline → let cached UI load
  if (r.status !== 401){ if(lock) lock.remove(); return; } // open (no passcode set)

  // Locked and no passcode yet: show the form and wait for the right code.
  await new Promise(resolve=>{
    const inp=lock.querySelector("#pc"), err=lock.querySelector("#pcerr"), go=lock.querySelector("#pcgo");
    inp.focus();
    const tryIt=async()=>{
      setPass(inp.value.trim());
      go.disabled=true; go.textContent="Checking…"; err.textContent="";
      let rr;
      try{ rr=await apiFetch("/api/finance"); }catch(e){ err.textContent="Can't reach the server."; go.disabled=false; go.textContent="Unlock"; return; }
      if(rr.status===401){ err.textContent="Wrong passcode."; go.disabled=false; go.textContent="Unlock"; inp.select(); return; }
      lock.remove(); resolve();
    };
    go.onclick=tryIt;
    inp.onkeydown=(e)=>{ if(e.key==="Enter") tryIt(); };
  });
}

// ---------- install prompt (shown once, only when not already installed) ----------
let deferredInstall=null;
window.addEventListener("beforeinstallprompt", (e)=>{ e.preventDefault(); deferredInstall=e; });
function isInstalled(){
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function maybeShowInstall(){
  if(isInstalled()) return;                              // already downloaded → never show
  if(localStorage.getItem("tv_install_done")==="1") return;
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const banner = el(`<div style="position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:40;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.12);padding:14px 15px">
    <div style="font-weight:800;font-size:15px">Add Tribal Vend to your phone</div>
    <div style="color:var(--ink-2);font-size:13px;margin-top:3px;line-height:1.45">${iOS ? `Tap the Share button, then <b>Add to Home Screen</b> — it opens full-screen like an app.` : `Install it for one-tap access and notifications.`}</div>
    <div style="display:flex;gap:8px;margin-top:12px">
      ${iOS ? "" : `<button id="inst-go" class="btn" style="margin:0;flex:1;padding:12px">Install</button>`}
      <button id="inst-x" class="btn ghost" style="margin:0;flex:${iOS?"1":"0 0 auto"};padding:12px 16px">${iOS?"Got it":"Not now"}</button>
    </div>
  </div>`);
  document.body.appendChild(banner);
  const done=()=>{ localStorage.setItem("tv_install_done","1"); banner.remove(); };
  banner.querySelector("#inst-x").onclick=done;
  const go=banner.querySelector("#inst-go");
  if(go) go.onclick=async()=>{ if(deferredInstall){ deferredInstall.prompt(); await deferredInstall.userChoice.catch(()=>{}); deferredInstall=null; } done(); };
}

// ---------- boot ----------
(async ()=>{
  await ensureUnlocked();
  renderCompany($("#company"));
  renderRuns();
  maybeShowInstall();
})();

// Keyboard open: hide the bottom nav. Otherwise it rides up on the keyboard,
// covers the box being typed in, and the phone drags the page to recenter it.
// Chat has its own input bar, so it's left alone.
document.addEventListener("focusin", e => {
  const t = e.target;
  if (t.matches && t.matches("input:not([type=file]):not([type=checkbox]):not([type=radio]), textarea") && !t.closest("#chat")) document.body.classList.add("kbd");
});
document.addEventListener("focusout", () => setTimeout(() => {
  const a = document.activeElement;
  if (!(a && a.matches && a.matches("input, textarea"))) document.body.classList.remove("kbd");
}, 60));
// Count boxes: tapping selects the number so typing replaces it.
document.addEventListener("focusin", e => {
  const t = e.target;
  if (t.matches && t.matches("input.uq, #closet input.q")) setTimeout(() => t.select(), 0);
});
