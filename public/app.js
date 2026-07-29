import { MONTHLY, FIXED_COSTS, SLOTS, WINDOW_LABEL, MACHINES } from "./data.js";
import { renderCloset } from "./closet.js";
import { apiFetch, setPass } from "./api.js";

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
    if(tab==="closet") renderCloset($("#closet"));
    window.scrollTo(0,0);
  };
});

// ---------- tiny SVG chart helpers ----------
function svg(w,h){ const s=document.createElementNS(SVGNS,"svg"); s.setAttribute("class","chart"); s.setAttribute("viewBox",`0 0 ${w} ${h}`); return s; }
function line(s,x1,y1,x2,y2,stroke,sw=1){ const l=document.createElementNS(SVGNS,"line"); l.setAttribute("x1",x1);l.setAttribute("y1",y1);l.setAttribute("x2",x2);l.setAttribute("y2",y2);l.setAttribute("stroke",stroke);l.setAttribute("stroke-width",sw); s.appendChild(l); return l; }
function txt(s,x,y,str,{fill="var(--muted)",size=11,anchor="middle",weight=400,tab=false}={}){ const t=document.createElementNS(SVGNS,"text"); t.setAttribute("x",x);t.setAttribute("y",y);t.setAttribute("fill",fill);t.setAttribute("font-size",size);t.setAttribute("text-anchor",anchor);t.setAttribute("font-weight",weight); if(tab)t.setAttribute("font-variant-numeric","tabular-nums"); t.textContent=str; s.appendChild(t); return t; }
function rrect(s,x,y,w,h,fill,r=3){ const p=document.createElementNS(SVGNS,"rect"); p.setAttribute("x",x);p.setAttribute("y",y);p.setAttribute("width",Math.max(0,w));p.setAttribute("height",Math.max(0,h));p.setAttribute("rx",r);p.setAttribute("fill",fill); s.appendChild(p); return p; }

// niceMax for axis
function niceMax(v){ const p=Math.pow(10,Math.floor(Math.log10(v))); const n=v/p; const step=n<=1?1:n<=2?2:n<=5?5:10; return step*p; }

// Line chart (single series) with area, gridlines, x labels
function lineChart(series, {yfmt=money, color="var(--s1)"}={}){
  const W=680,H=210, L=8,R=8,T=12,B=26;
  const s=svg(W,H);
  const vals=series.map(d=>d.v);
  const max=niceMax(Math.max(...vals)*1.1), min=0;
  const iw=W-L-R, ih=H-T-B;
  const xf=i=> L + (series.length===1?iw/2:(i/(series.length-1))*iw);
  const yf=v=> T + ih - ((v-min)/(max-min))*ih;
  // gridlines
  for(let g=0; g<=2; g++){ const yv=max*g/2; const y=yf(yv); line(s,L,y,W-R,y,"var(--grid)",1); txt(s,L,y-4,yfmt(yv),{anchor:"start",size:10}); }
  // area
  let dp=`M ${xf(0)} ${yf(vals[0])}`; series.forEach((d,i)=>dp+=` L ${xf(i)} ${yf(d.v)}`);
  const area=document.createElementNS(SVGNS,"path"); area.setAttribute("d",dp+` L ${xf(series.length-1)} ${yf(0)} L ${xf(0)} ${yf(0)} Z`); area.setAttribute("fill",color); area.setAttribute("opacity",".12"); s.appendChild(area);
  // line
  const p=document.createElementNS(SVGNS,"path"); p.setAttribute("d",dp); p.setAttribute("fill","none"); p.setAttribute("stroke",color); p.setAttribute("stroke-width",2); p.setAttribute("stroke-linejoin","round"); p.setAttribute("stroke-linecap","round"); s.appendChild(p);
  // end dot + label
  const li=series.length-1;
  const dot=document.createElementNS(SVGNS,"circle"); dot.setAttribute("cx",xf(li));dot.setAttribute("cy",yf(vals[li]));dot.setAttribute("r",4);dot.setAttribute("fill",color); s.appendChild(dot);
  // x labels (first, mid, last)
  [0, Math.floor(series.length/2), series.length-1].forEach(i=>txt(s,xf(i),H-8,series[i].m,{size:10}));
  return s;
}

// Grouped bars: money in vs out per month (last 12)
function inOutChart(rows){
  const W=680,H=220,L=8,R=8,T=12,B=28;
  const s=svg(W,H);
  const max=niceMax(Math.max(...rows.map(d=>Math.max(d.in,d.out)))*1.1);
  const iw=W-L-R, ih=H-T-B;
  const yf=v=>T+ih-(v/max)*ih;
  for(let g=0; g<=2; g++){ const yv=max*g/2; const y=yf(yv); line(s,L,y,W-R,y,"var(--grid)",1); txt(s,L,y-4,money(yv),{anchor:"start",size:10}); }
  const gw=iw/rows.length, bw=Math.min(11,(gw-6)/2);
  rows.forEach((d,i)=>{
    const cx=L+i*gw+gw/2;
    rrect(s,cx-bw-1,yf(d.in),bw,ih-(yf(d.in)-T),"var(--s3)",3);
    rrect(s,cx+1,yf(d.out),bw,ih-(yf(d.out)-T),"var(--s2)",3);
  });
  [0,Math.floor(rows.length/2),rows.length-1].forEach(i=>txt(s,L+i*gw+gw/2,H-9,rows[i].m,{size:10}));
  return s;
}

// Horizontal bars (top earners / losers)
function hbars(items, {color="var(--s1)", neg=false}={}){
  const rowH=30, W=680, L=118, R=54, T=6;
  const H=T+items.length*rowH+4;
  const s=svg(W,H);
  const max=Math.max(...items.map(d=>Math.abs(d.v)));
  const iw=W-L-R;
  items.forEach((d,i)=>{
    const y=T+i*rowH;
    txt(s,L-8,y+rowH/2+4,d.k,{anchor:"end",size:12,fill:"var(--ink-2)",weight:600});
    const w=(Math.abs(d.v)/max)*iw;
    rrect(s,L,y+6,w,rowH-14,d.v<0?"var(--bad)":color,3);
    txt(s,L+w+7,y+rowH/2+4,money(d.v),{anchor:"start",size:12,fill:"var(--ink)",weight:700,tab:true});
  });
  return s;
}

// ---------- Company section ----------
function renderCompany(){
  const root=$("#company"); root.innerHTML="";

  // derived numbers
  const cardTotal = MONTHLY.reduce((a,d)=>a+d.card,0);
  const last = MONTHLY[MONTHLY.length-1], prev = MONTHLY[MONTHLY.length-2];
  const rev = d => d.card + d.cash;
  const revLast = rev(last), revPrev = rev(prev);
  const revDelta = revPrev ? Math.round((revLast-revPrev)/revPrev*100) : 0;
  const fixed = FIXED_COSTS.reduce((a,d)=>a+d.amount,0);
  const slotProfit = SLOTS.reduce((a,d)=>a+d.profit,0);
  const unitsMo = SLOTS.reduce((a,d)=>a+d.sold,0);

  // aggregate slots -> products
  const byProduct = {};
  SLOTS.forEach(d=>{ byProduct[d.item]=(byProduct[d.item]||0)+d.profit; });
  const prods = Object.entries(byProduct).map(([k,v])=>({k,v})).sort((a,b)=>b.v-a.v);
  const top = prods.slice(0,8);
  const losers = prods.filter(p=>p.v<0).sort((a,b)=>a.v-b.v);

  // --- tiles ---
  root.appendChild(el(`<h2>Snapshot</h2>`));
  const tiles=el(`<div class="tiles"></div>`);
  tiles.appendChild(el(`<div class="tile"><div class="k">Revenue · ${last.m}</div><div class="v">${money(revLast)}</div><div class="d ${revDelta>=0?'up':'down'}">${revDelta>=0?'▲':'▼'} ${Math.abs(revDelta)}% vs ${prev.m}</div></div>`));
  tiles.appendChild(el(`<div class="tile"><div class="k">Cash on hand</div><div class="v">${money(last.balance)}</div><div class="d" style="color:var(--muted)">bank balance</div></div>`));
  tiles.appendChild(el(`<div class="tile"><div class="k">Fixed costs / mo</div><div class="v">${money(fixed)}</div><div class="d ${fixed>250?'down':''}">QuickBooks climbing</div></div>`));
  tiles.appendChild(el(`<div class="tile"><div class="k">Meals machine margin</div><div class="v">${money(slotProfit)}</div><div class="d" style="color:var(--muted)">${unitsMo} units · window</div></div>`));
  root.appendChild(tiles);

  // --- revenue trend ---
  const revCard=el(`<div class="card"><div class="ct">Revenue trend</div><div class="cs">Card + cash deposits per month · ${MONTHLY[2].m}–${last.m}</div></div>`);
  revCard.appendChild(lineChart(MONTHLY.slice(2).map(d=>({m:d.m,v:rev(d)})), {color:"var(--s1)"}));
  root.appendChild(revCard);

  // --- money in vs out (last 12) ---
  const io=MONTHLY.slice(-12).map(d=>({m:d.m,in:rev(d),out:d.debits}));
  const ioCard=el(`<div class="card"><div class="ct">Money in vs out</div><div class="cs">Last 12 months</div></div>`);
  ioCard.appendChild(inOutChart(io));
  ioCard.appendChild(el(`<div class="legend"><span><i style="background:var(--s3)"></i>In (sales)</span><span><i style="background:var(--s2)"></i>Out (spend)</span></div>`));
  root.appendChild(ioCard);

  // --- top earners ---
  root.appendChild(el(`<h2>What's making money</h2>`));
  const teCard=el(`<div class="card"><div class="ct">Top earners</div><div class="cs">Gross margin $ · Meals & Drinks · ${WINDOW_LABEL}</div></div>`);
  teCard.appendChild(hbars(top));
  root.appendChild(teCard);

  // --- losers ---
  const loCard=el(`<div class="card"><div class="ct">Losing money right now <span class="pill bad">fix</span></div><div class="cs">Priced below cost — every sale loses</div></div>`);
  const lr=el(`<div class="rows"></div>`);
  losers.forEach(p=>{
    const s=SLOTS.find(x=>x.item===p.k);
    lr.appendChild(el(`<div class="row"><div class="nm">${p.k}<div class="mt">costs ${money2(s.cost)} · sells ${money2(s.price)}</div></div><div class="val down">${money2(p.v)}</div></div>`));
  });
  loCard.appendChild(lr);
  root.appendChild(loCard);

  // --- fixed costs ---
  root.appendChild(el(`<h2>Where the money goes</h2>`));
  const fcCard=el(`<div class="card"><div class="ct">Fixed monthly costs</div><div class="cs">Same every month, before any product</div></div>`);
  const fr=el(`<div class="rows"></div>`);
  FIXED_COSTS.forEach(c=>{
    fr.appendChild(el(`<div class="row"><div class="nm">${c.name}${c.note?`<div class="mt">${c.note}</div>`:""}</div><div class="val">${money2(c.amount)}</div></div>`));
  });
  fr.appendChild(el(`<div class="row"><div class="nm" style="font-weight:700">Total</div><div class="val">${money2(fixed)}</div></div>`));
  fcCard.appendChild(fr);
  root.appendChild(fcCard);
}

// ---------- Runs section ----------
function renderRuns(){
  const root=$("#runs"); root.innerHTML="";
  root.appendChild(el(`<h2>Service a machine</h2>`));

  const pick=el(`<div class="field"><label>Machine</label><select id="mpick"></select></div>`);
  const sel=pick.querySelector("select");
  MACHINES.forEach(m=>sel.appendChild(el(`<option value="${m.id}">${m.name} — refilled ${m.lastRefill}</option>`)));
  root.appendChild(pick);

  root.appendChild(el(`<div class="note">Everything's full to par unless you say otherwise. Find the few slots that came up short and enter <b>how many are missing</b>. Leave the rest blank — the app fills them to par.</div>`));

  root.appendChild(el(`<h2 style="margin-top:22px">Short slots <span style="text-transform:none;letter-spacing:0;color:var(--muted);font-weight:400">— enter how many are missing</span></h2>`));

  const seen=new Set(); const list=el(`<div class="parlist"></div>`);
  SLOTS.forEach(sl=>{
    const base=sl.slot.replace(/[a-z]/,"");
    if(seen.has(base)) return; seen.add(base);
    list.appendChild(el(`<div class="par"><div class="sl">${base}</div><div class="pi">${sl.item}</div><input type="text" inputmode="numeric" placeholder="missing" data-slot="${base}" data-item="${sl.item}"></div>`));
  });
  root.appendChild(list);

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

// ---------- unlock gate ----------
async function ensureUnlocked(){
  // Probe a locked endpoint. 401 → need a passcode. Anything else → we're in.
  let r;
  try { r = await apiFetch("/api/closet"); } catch(e){ return; } // offline → let cached UI load
  if (r.status !== 401) return;
  await new Promise(resolve=>{
    const ov = el(`<div style="position:fixed;inset:0;z-index:100;background:var(--plane);display:flex;align-items:center;justify-content:center;padding:24px">
      <div style="width:100%;max-width:340px;text-align:center">
        <div style="font-size:20px;font-weight:800;margin-bottom:6px">Tribal Vend</div>
        <div style="color:var(--muted);font-size:13px;margin-bottom:18px">Enter your passcode</div>
        <input id="pc" type="password" inputmode="numeric" style="width:100%;background:var(--surface-2);border:1px solid var(--border);color:var(--ink);border-radius:12px;padding:14px;font-size:18px;text-align:center" placeholder="••••">
        <div id="pcerr" style="color:var(--bad);font-size:12px;height:16px;margin-top:8px"></div>
        <button id="pcgo" class="btn" style="margin-top:6px">Unlock</button>
      </div></div>`);
    document.body.appendChild(ov);
    const inp=ov.querySelector("#pc"), err=ov.querySelector("#pcerr"), go=ov.querySelector("#pcgo");
    inp.focus();
    const tryIt=async()=>{
      setPass(inp.value.trim());
      go.disabled=true; go.textContent="Checking…"; err.textContent="";
      let rr;
      try{ rr=await apiFetch("/api/closet"); }catch(e){ err.textContent="Can't reach the server."; go.disabled=false; go.textContent="Unlock"; return; }
      if(rr.status===401){ err.textContent="Wrong passcode."; go.disabled=false; go.textContent="Unlock"; inp.select(); return; }
      ov.remove(); resolve();
    };
    go.onclick=tryIt;
    inp.onkeydown=(e)=>{ if(e.key==="Enter") tryIt(); };
  });
}

// ---------- boot ----------
(async ()=>{
  await ensureUnlocked();
  renderCompany();
  renderRuns();
})();
