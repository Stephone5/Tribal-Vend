import { MACHINES } from "./data.js";
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
    window.scrollTo(0,0);
  };
});

// ---------- Runs section ----------
let LIVE=null;
async function getLive(){
  if(LIVE) return LIVE;
  try{ const r=await apiFetch("/api/live"); if(r.ok) LIVE=await r.json(); }catch(e){}
  return LIVE;
}

async function renderRuns(){
  const root=$("#runs"); root.innerHTML=`<h2>Service a machine</h2><div class="empty">Loading machines…</div>`;
  const live=await getLive();
  root.innerHTML="";
  root.appendChild(el(`<h2>Service a machine</h2>`));

  const machines = (live && live.machines) ? live.machines : MACHINES.map(m=>({id:m.id,name:m.name,slots:[]}));
  const pick=el(`<div class="field"><label>Machine</label><select id="mpick"></select></div>`);
  const sel=pick.querySelector("select");
  machines.forEach(m=>sel.appendChild(el(`<option value="${m.id}">${m.name}</option>`)));
  root.appendChild(pick);

  root.appendChild(el(`<div class="note">Everything's full to par unless you say otherwise. Find the few slots that came up short and enter <b>how many are missing</b>. Leave the rest blank — the app fills them to par.</div>`));
  root.appendChild(el(`<h2 style="margin-top:22px">Short slots <span style="text-transform:none;letter-spacing:0;color:var(--muted);font-weight:400">— enter how many are missing</span></h2>`));

  const list=el(`<div class="parlist"></div>`);
  root.appendChild(list);

  function paintSlots(){
    const m = machines.find(x=>String(x.id)===String(sel.value)) || machines[0];
    list.innerHTML="";
    (m.slots||[]).forEach(sl=>{
      const nm = String(sl.product||"").replace(/^(Meals|Drinks|Crackers)\s*[-:]\s*/i,"").slice(0,30);
      list.appendChild(el(`<div class="par"><div class="sl">${sl.slot}</div><div class="pi">${nm}</div><input type="text" inputmode="numeric" placeholder="missing" data-slot="${sl.slot}" data-item="${nm.replace(/"/g,'&quot;')}"></div>`));
    });
    if(!(m.slots||[]).length) list.appendChild(el(`<div class="empty">Couldn't load this machine's slots.</div>`));
  }
  sel.onchange=paintSlots; paintSlots();

  const gen=el(`<button class="btn">Generate →</button>`);
  const out=el(`<div id="buyout"></div>`);
  gen.onclick=()=>buildBuyList(sel,list,out,gen);
  root.appendChild(gen);
  root.appendChild(out);
}

async function buildBuyList(sel, list, out, gen){
  const shorts=[...list.querySelectorAll("input")].map(i=>({slot:i.dataset.slot,item:i.dataset.item,missing:parseInt(i.value,10)})).filter(x=>!isNaN(x.missing)&&x.missing>0);
  const machine = sel.options[sel.selectedIndex]?.textContent.split(" — ")[0] || "unknown";
  out.innerHTML="";
  if(!shorts.length){ out.appendChild(el(`<div class="empty">Nothing entered — machine's full to par. Nothing to buy.</div>`)); return; }
  try{ localStorage.setItem("tv_lastrun", JSON.stringify({at:Date.now(),machine,shorts})); }catch(e){}

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

// Raw fallback: just the counts entered, shown clearly, with why the brain didn't run.
function renderLocalList(out, shorts, why){
  out.appendChild(el(`<h2 style="margin-top:24px">Your counts <span class="pill warn">${shorts.length}</span></h2>`));
  const c=el(`<div class="card buy"><div class="ct">Reported par gaps</div><div class="cs">Saved on your phone</div></div>`);
  const rows=el(`<div class="rows"></div>`);
  shorts.forEach(x=>rows.appendChild(el(`<div class="row"><div class="nm">${x.item}<div class="mt">slot ${x.slot}</div></div><div class="val">${x.par}</div></div>`)));
  c.appendChild(rows); out.appendChild(c);
  out.appendChild(el(`<div class="note">${why} Once it is, this becomes a real buy list in cases with reconciliation and change orders.</div>`));
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
  let r;
  try { r = await apiFetch("/api/finance"); }
  catch(e){ if(lock) lock.remove(); return; } // offline → let cached UI load
  if (r.status !== 401){ if(lock) lock.remove(); return; } // open, or pass already valid

  // Locked: reveal the passcode form and wait for the right code.
  await new Promise(resolve=>{
    lock.querySelector("#lk-wait").style.display="none";
    const form=lock.querySelector("#lockform"); form.style.display="block";
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
  const banner = el(`<div style="position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:40;background:var(--surface);border:1px solid var(--border);border-radius:16px;box-shadow:0 8px 30px rgba(0,0,0,.12);padding:14px 15px">
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
