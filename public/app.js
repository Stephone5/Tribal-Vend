import { MACHINES, packageOf } from "./data.js";
import { renderCloset } from "./closet.js";
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
    if(tab==="closet") renderCloset($("#closet"));
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

    // 1) What to bring — package roll-up (how you actually buy it)
    const groups={};
    need.forEach(s=>{ const g=packageOf(s.raw); if(!groups[g.key])groups[g.key]={label:g.label,units:0,slots:[]}; groups[g.key].units+=s.need; groups[g.key].slots.push(s.slot); });
    const glist=Object.values(groups).sort((a,b)=>b.units-a.units);
    const bring=el(`<div class="card buy"><div class="ct">Bring to the machine</div><div class="cs">${totalUnits} units · ${need.length} slots short · summed how you buy</div></div>`);
    const brows=el(`<div class="rows"></div>`);
    glist.forEach(g=>{ const many=g.slots.length>1; brows.appendChild(el(`<div class="row"><div class="nm">${g.label}<div class="mt">${many?`slots ${g.slots.join(", ")}`:`slot ${g.slots[0]}`}</div></div><div class="val">${g.units}</div></div>`)); });
    bring.appendChild(brows); out.appendChild(bring);

    // 2) By slot — exactly like AirVend's Refill to Par
    const c=el(`<div class="card"><div class="ct">By slot</div><div class="cs">Refill = par − on hand · live from AirVend</div></div>`);
    const wrap=el(`<div class="scrollx"></div>`);
    const tbl=el(`<table class="tbl"><thead><tr><th>Slot</th><th>Item</th><th>On&nbsp;hand</th><th>Par</th><th>Refill</th></tr></thead><tbody></tbody></table>`);
    const tb=tbl.querySelector("tbody");
    need.forEach(s=>tb.appendChild(el(`<tr><td><b>${s.slot}</b></td><td style="text-align:left">${s.item}</td><td>${s.onHand}</td><td>${s.par}</td><td class="pos">${s.need}</td></tr>`)));
    wrap.appendChild(tbl); c.appendChild(wrap); out.appendChild(c);

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
  (m.slots||[]).slice().sort((a,b)=>(+a.slot)-(+b.slot)).forEach(s=>{
    const par=Number(s.max)||0;
    rows.appendChild(el(`<div class="row"><div class="nm">${cleanItem(s.product)}<div class="mt">slot ${s.slot} · par ${par} · now ${s.onHand}</div></div><input class="uq" inputmode="numeric" value="${par}" data-slot="${s.slot}" data-par="${par}" style="width:56px;height:40px;text-align:center;font-size:17px;font-weight:800;background:var(--surface-2);border:1.5px solid var(--line);border-radius:11px;color:var(--ink)"></div>`));
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
  changes.forEach(p=>rows.appendChild(el(`<div class="row"><div class="nm">${cleanItem(p.product)}<div class="mt">slot ${p.slot}</div></div><div class="val">${p.from} → <b>${p.to}</b></div></div>`)));
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
  out.innerHTML=""; out.appendChild(el(`<div class="note good"><b>Done — AirVend updated.</b> On-hand set for ${res.wrote} slots on ${m.name}. Open AirVend to confirm it took, then hit Refresh here.</div>`));
  LIVE=null;
}

async function buildBuyList(sel, list, out, gen){
  const shorts=[...list.querySelectorAll("input")].map(i=>({slot:i.dataset.slot,item:i.dataset.item,missing:parseInt(i.value,10)})).filter(x=>!isNaN(x.missing)&&x.missing>0);
  const machine = sel.options[sel.selectedIndex]?.textContent.split(" — ")[0] || "unknown";
  out.innerHTML="";
  if(!shorts.length){ out.appendChild(el(`<div class="empty">Nothing entered — machine's full to par. Nothing to buy.</div>`)); return; }
  try{ localStorage.setItem("tv_lastrun", JSON.stringify({at:Date.now(),machine,shorts})); }catch(e){}

  // Deterministic package roll-up — how it's actually ordered. Variant slots
  // (all Miss Vickie's, all Sun Chips, all Snyder's, all Gatorade) sum into one
  // line; Arizona flavors and everything else stay on their own. Always shown,
  // brain or not.
  renderPackages(out, shorts);

  gen.disabled=true; gen.textContent="Thinking…";
  let res, body;
  try{
    res = await apiFetch("/api/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({machine,shorts})});
    body = await res.json();
  }catch(e){
    gen.disabled=false; gen.textContent="Generate buy list →";
    return renderLocalList(out, shorts, "Couldn't reach the server. Showing your raw counts.");
  }
  gen.disabled=false; gen.textContent="Generate buy list →";

  if(res.status===503 || body.error==="no_key"){
    return renderLocalList(out, shorts, body.message || "The brain isn't connected yet.");
  }
  if(!res.ok || body.error){
    return renderLocalList(out, shorts, body.message || "The brain hit an error.");
  }
  renderBrain(out, body, { machineId: sel.value, machine, gaps: shorts });
}

// Package roll-up: sum the missing units by how the product is bought.
function renderPackages(out, shorts){
  const groups={};
  shorts.forEach(x=>{
    const g=packageOf(x.item);
    if(!groups[g.key]) groups[g.key]={label:g.label,units:0,slots:[]};
    groups[g.key].units+=x.missing;
    groups[g.key].slots.push(x.slot);
  });
  const list=Object.values(groups).sort((a,b)=>b.units-a.units);
  const totalUnits=list.reduce((a,g)=>a+g.units,0);
  out.appendChild(el(`<h2 style="margin-top:24px">To buy <span class="pill warn">${list.length}</span></h2>`));
  const c=el(`<div class="card buy"><div class="ct">By package</div><div class="cs">${totalUnits} units short · summed how you order them</div></div>`);
  const rows=el(`<div class="rows"></div>`);
  list.forEach(g=>{
    const many=g.slots.length>1;
    const sub=many?`slots ${g.slots.join(", ")} · ${g.slots.length} flavors`:`slot ${g.slots[0]}`;
    rows.appendChild(el(`<div class="row"><div class="nm">${g.label}<div class="mt">${sub}</div></div><div class="val">${g.units}</div></div>`));
  });
  c.appendChild(rows); out.appendChild(c);
}

// Raw fallback: just the counts entered, shown clearly, with why the brain didn't run.
function renderLocalList(out, shorts, why){
  out.appendChild(el(`<div class="note">${why} The package roll-up above is your buy list. Once the brain's connected, this also gets cases, reconciliation, and change orders.</div>`));
}

// Full brain result: summary, reconciliation, buy list in cases, change orders.
function renderBrain(out, b, ctx){
  if(b.summary) out.appendChild(el(`<div class="note" style="border-left-color:var(--good);margin-top:24px">${b.summary}</div>`));

  if(b.buyList && b.buyList.length){
    out.appendChild(el(`<h2>Buy list <span class="pill warn">${b.buyList.length}</span></h2>`));
    const c=el(`<div class="card buy"><div class="ct">Bring to next refill</div><div class="cs">Whole cases · Sam's links attach when the catalog is wired</div></div>`);
    const rows=el(`<div class="rows"></div>`);
    b.buyList.forEach(x=>rows.appendChild(el(`<div class="row"><div class="nm">${x.item}<div class="mt">slot ${x.slot} · ${x.reason||""}</div></div><div class="val">${x.cases}× case${x.cases===1?"":"s"}</div></div>`)));
    c.appendChild(rows); out.appendChild(c);
  }

  if(b.changeOrders && b.changeOrders.length){
    out.appendChild(el(`<h2>Change orders <span class="pill warn">${b.changeOrders.length}</span></h2>`));
    const c=el(`<div class="card"><div class="ct">Worth doing this cycle</div><div class="cs">Pricing, planogram, and par moves</div></div>`);
    const rows=el(`<div class="rows"></div>`);
    b.changeOrders.forEach(x=>rows.appendChild(el(`<div class="row"><div class="nm">${x.item}<div class="mt">slot ${x.slot} · ${x.type} · ${x.reason||""}</div></div><div class="val">${x.from} → ${x.to}</div></div>`)));
    c.appendChild(rows); out.appendChild(c);
  }

  if(b.reconciliation) out.appendChild(el(`<div class="note">${b.reconciliation}</div>`));

  if(ctx && ctx.machineId) renderAirvendSync(out, ctx);
}

// Two-step AirVend push: Preview (safe, writes nothing) → Confirm & write.
function renderAirvendSync(out, ctx){
  out.appendChild(el(`<h2>Update AirVend</h2>`));
  const card=el(`<div class="card"><div class="ct">Set ${ctx.machine}'s inventory to match</div><div class="cs">Full to par, minus what you marked missing</div></div>`);
  const btn=el(`<button class="btn ghost" style="margin-top:12px">Preview the update →</button>`);
  const area=el(`<div></div>`);
  card.appendChild(btn); card.appendChild(area);
  out.appendChild(card);

  btn.onclick=async()=>{
    btn.disabled=true; btn.textContent="Checking AirVend…"; area.innerHTML="";
    let res, body;
    try{
      res=await apiFetch("/api/airvend/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({machineId:ctx.machineId,gaps:ctx.gaps})});
      body=await res.json();
    }catch(e){ btn.disabled=false; btn.textContent="Preview the update →"; area.appendChild(el(`<div class="note">Couldn't reach the server.</div>`)); return; }
    btn.disabled=false; btn.textContent="Preview the update →";
    if(!res.ok||body.error){ area.appendChild(el(`<div class="note">${body.message||"Couldn't reach AirVend. Nothing was changed."}</div>`)); return; }
    renderAirvendPlan(area, ctx, body.plan||[]);
  };
}

function renderAirvendPlan(area, ctx, plan){
  area.innerHTML="";
  const changed=plan.filter(p=>p.from!==p.to);
  area.appendChild(el(`<div class="note" style="border-left-color:var(--warn)">Preview only — nothing sent yet. ${changed.length} slot${changed.length===1?"":"s"} would change; the rest already match.</div>`));
  const rows=el(`<div class="rows"></div>`);
  (changed.length?changed:plan.slice(0,6)).forEach(p=>rows.appendChild(el(`<div class="row"><div class="nm">${p.product}<div class="mt">slot ${p.slot}</div></div><div class="val">${p.from} → ${p.to}</div></div>`)));
  area.appendChild(rows);
  const confirm=el(`<button class="btn" style="margin-top:14px">Confirm & write to AirVend</button>`);
  area.appendChild(confirm);
  confirm.onclick=async()=>{
    confirm.disabled=true; confirm.textContent="Writing to AirVend…";
    let res, body;
    try{
      res=await apiFetch("/api/airvend/write",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({machineId:ctx.machineId,gaps:ctx.gaps})});
      body=await res.json();
    }catch(e){ confirm.disabled=false; confirm.textContent="Confirm & write to AirVend"; area.appendChild(el(`<div class="note">Couldn't reach the server.</div>`)); return; }
    if(!res.ok||body.error){ confirm.disabled=false; confirm.textContent="Confirm & write to AirVend"; area.appendChild(el(`<div class="note">${body.message||"AirVend rejected the update. Nothing was changed."}</div>`)); return; }
    confirm.replaceWith(el(`<div class="note" style="border-left-color:var(--good)">Done — AirVend now shows ${body.wrote} slots at their true counts for ${ctx.machine}.</div>`));
  };
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
