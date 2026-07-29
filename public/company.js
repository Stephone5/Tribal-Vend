// Company view — the whole business, from live data.
// Products and prices come live from AirVend; costs from the verified catalog;
// velocity from the sales window; money from the bank statements.

import { apiFetch } from "./api.js";

const SVGNS = "http://www.w3.org/2000/svg";
const el = h => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => (n >= 0 ? "+" : "") + n.toFixed(0) + "%";

// ---------- chart helpers ----------
function svg(w, h) { const s = document.createElementNS(SVGNS, "svg"); s.setAttribute("class", "chart"); s.setAttribute("viewBox", `0 0 ${w} ${h}`); return s; }
function ln(s, x1, y1, x2, y2, stroke, sw = 1) { const l = document.createElementNS(SVGNS, "line"); l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2); l.setAttribute("stroke", stroke); l.setAttribute("stroke-width", sw); s.appendChild(l); }
function tx(s, x, y, str, o = {}) { const t = document.createElementNS(SVGNS, "text"); t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("fill", o.fill || "var(--muted)"); t.setAttribute("font-size", o.size || 10); t.setAttribute("text-anchor", o.anchor || "middle"); t.setAttribute("font-weight", o.weight || 400); if (o.tab !== false) t.setAttribute("font-variant-numeric", "tabular-nums"); t.textContent = str; s.appendChild(t); }
function rect(s, x, y, w, h, fill, r = 3) { const p = document.createElementNS(SVGNS, "rect"); p.setAttribute("x", x); p.setAttribute("y", y); p.setAttribute("width", Math.max(0, w)); p.setAttribute("height", Math.max(0, h)); p.setAttribute("rx", r); p.setAttribute("fill", fill); s.appendChild(p); return p; }
function path(s, d, stroke, sw = 2, fill = "none") { const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); p.setAttribute("fill", fill); p.setAttribute("stroke", stroke); p.setAttribute("stroke-width", sw); p.setAttribute("stroke-linejoin", "round"); p.setAttribute("stroke-linecap", "round"); s.appendChild(p); return p; }
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

// Line chart with optional second (average) series
function lineChart(series, { color = "var(--s1)", avg = null, fmt = money } = {}) {
  const W = 680, H = 200, L = 6, R = 6, T = 14, B = 24;
  const s = svg(W, H);
  const vals = series.map(d => d.v);
  const lo = Math.min(0, ...vals), hi = niceMax(Math.max(...vals) * 1.08);
  const iw = W - L - R, ih = H - T - B;
  const xf = i => L + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
  const yf = v => T + ih - ((v - lo) / (hi - lo || 1)) * ih;
  for (let g = 0; g <= 2; g++) { const yv = lo + (hi - lo) * g / 2; const y = yf(yv); ln(s, L, y, W - R, y, "var(--grid)"); tx(s, L, y - 4, fmt(yv), { anchor: "start" }); }
  if (lo < 0) ln(s, L, yf(0), W - R, yf(0), "var(--baseline)", 1.5);
  let d = `M ${xf(0)} ${yf(vals[0])}`; series.forEach((p, i) => d += ` L ${xf(i)} ${yf(p.v)}`);
  path(s, d + ` L ${xf(series.length - 1)} ${yf(lo)} L ${xf(0)} ${yf(lo)} Z`, "none", 0, color).setAttribute("opacity", ".10");
  path(s, d, color, 2);
  if (avg) { let a = `M ${xf(0)} ${yf(avg[0])}`; avg.forEach((v, i) => a += ` L ${xf(i)} ${yf(v)}`); const p = path(s, a, "var(--s2)", 1.5); p.setAttribute("stroke-dasharray", "4 3"); }
  const li = series.length - 1;
  const c = document.createElementNS(SVGNS, "circle"); c.setAttribute("cx", xf(li)); c.setAttribute("cy", yf(vals[li])); c.setAttribute("r", 4); c.setAttribute("fill", color); s.appendChild(c);
  [0, Math.floor(series.length / 2), li].forEach(i => tx(s, xf(i), H - 6, series[i].m));
  return s;
}

// Vertical bars, +/- aware (for net profit)
function barChart(series, { fmt = money } = {}) {
  const W = 680, H = 200, L = 6, R = 6, T = 14, B = 24;
  const s = svg(W, H);
  const vals = series.map(d => d.v);
  const hi = niceMax(Math.max(...vals, 0) * 1.1), lo = Math.min(0, ...vals) * 1.1;
  const iw = W - L - R, ih = H - T - B;
  const yf = v => T + ih - ((v - lo) / (hi - lo || 1)) * ih;
  for (let g = 0; g <= 2; g++) { const yv = lo + (hi - lo) * g / 2; const y = yf(yv); ln(s, L, y, W - R, y, "var(--grid)"); tx(s, L, y - 4, fmt(yv), { anchor: "start" }); }
  const zero = yf(0);
  ln(s, L, zero, W - R, zero, "var(--baseline)", 1.5);
  const gw = iw / series.length, bw = Math.min(16, gw - 4);
  series.forEach((d, i) => {
    const x = L + i * gw + (gw - bw) / 2, y = d.v >= 0 ? yf(d.v) : zero;
    rect(s, x, y, bw, Math.abs(yf(d.v) - zero), d.v >= 0 ? "var(--s3)" : "var(--bad)", 3);
  });
  [0, Math.floor(series.length / 2), series.length - 1].forEach(i => tx(s, L + i * gw + gw / 2, H - 6, series[i].m));
  return s;
}

// Grouped bars: two series
function groupChart(rows, aKey, bKey, aColor, bColor) {
  const W = 680, H = 200, L = 6, R = 6, T = 14, B = 24;
  const s = svg(W, H);
  const hi = niceMax(Math.max(...rows.map(d => Math.max(d[aKey], d[bKey]))) * 1.1);
  const iw = W - L - R, ih = H - T - B;
  const yf = v => T + ih - (v / hi) * ih;
  for (let g = 0; g <= 2; g++) { const yv = hi * g / 2; const y = yf(yv); ln(s, L, y, W - R, y, "var(--grid)"); tx(s, L, y - 4, money(yv), { anchor: "start" }); }
  const gw = iw / rows.length, bw = Math.min(10, (gw - 5) / 2);
  rows.forEach((d, i) => {
    const cx = L + i * gw + gw / 2;
    rect(s, cx - bw - 1, yf(d[aKey]), bw, ih - (yf(d[aKey]) - T), aColor, 2);
    rect(s, cx + 1, yf(d[bKey]), bw, ih - (yf(d[bKey]) - T), bColor, 2);
  });
  [0, Math.floor(rows.length / 2), rows.length - 1].forEach(i => tx(s, L + i * gw + gw / 2, H - 6, rows[i].m));
  return s;
}

function barRow(label, value, max, color, fmtv = money2) {
  const w = max > 0 ? Math.max(2, (Math.abs(value) / max) * 100) : 0;
  return el(`<div class="bar-line"><span class="lbl">${esc(label)}</span><span class="track"><span class="fill" style="width:${w}%;background:${color}"></span></span><span class="amt" style="color:${value < 0 ? "var(--bad)" : "var(--ink)"}">${fmtv(value)}</span></div>`);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shortName = s => String(s).replace(/^(Meals|Drinks|Crackers)\s*[-:]\s*/i, "").replace(/\s*\d+(\.\d+)?\s*(oz|fl oz|ct|count|-Ounce|piece).*$/i, "").replace(/,.*$/, "").trim().slice(0, 26);

// ---------- main render ----------
export async function renderCompany(root) {
  root.innerHTML = `<h2>Company</h2><div class="empty">Loading live data…</div>`;
  let d;
  try {
    const r = await apiFetch("/api/live");
    if (!r.ok) throw new Error("live data unavailable");
    d = await r.json();
  } catch (e) {
    root.innerHTML = `<h2>Company</h2><div class="alert"><b>Couldn't load live data.</b> Check your connection and pull down to retry.</div>`;
    return;
  }
  root.innerHTML = "";

  const allSlots = d.machines.flatMap(m => m.slots.map(s => ({ ...s, machine: m.name })));
  const known = allSlots.filter(s => s.cost != null);
  const days = d.window.days;

  // ---- this week so far: what's left the machines since the last fill ----
  const soldSinceFill = allSlots.reduce((a, s) => a + Math.max(0, s.max - s.onHand), 0);
  const weekMargin = allSlots.reduce((a, s) => a + (s.marginEach != null ? Math.max(0, s.max - s.onHand) * s.marginEach : 0), 0);
  const weekRevenue = allSlots.reduce((a, s) => a + Math.max(0, s.max - s.onHand) * s.price, 0);

  // ---- money ----
  const pl = d.pl;
  const last = pl[pl.length - 1], prev = pl[pl.length - 2];
  const revDelta = prev ? ((last.revenue - prev.revenue) / prev.revenue) * 100 : 0;
  const netDelta = prev && prev.net !== 0 ? ((last.net - prev.net) / Math.abs(prev.net)) * 100 : 0;
  const avg3 = pl.slice(-3).reduce((a, p) => a + p.revenue, 0) / Math.min(3, pl.length);
  const vsAvg = ((last.revenue - avg3) / avg3) * 100;

  const marginPerDay = known.reduce((a, s) => a + (s.perDay || 0), 0);

  // ================= HERO =================
  root.appendChild(el(`<h2>This week so far</h2>`));
  root.appendChild(el(`<div class="hero">
    <div class="k">Sold since last fill</div>
    <div class="v">${money2(weekMargin)}</div>
    <div class="sub">profit from <b>${soldSinceFill}</b> units · ${money2(weekRevenue)} in sales</div>
    <div class="chips">
      <span class="chip">Machines<b>${d.machines.length}</b></span>
      <span class="chip">Slots<b>${allSlots.length}</b></span>
      <span class="chip">Empty now<b>${allSlots.filter(s => s.onHand === 0).length}</b></span>
      <span class="chip">Avg fill<b>${Math.round(allSlots.reduce((a, s) => a + s.fillPct, 0) / allSlots.length)}%</b></span>
    </div>
  </div>`));

  // ================= KPI TILES =================
  root.appendChild(el(`<h2>Month at a glance · ${last.m}</h2>`));
  const tiles = el(`<div class="tiles"></div>`);
  tiles.appendChild(el(`<div class="tile"><div class="k">Revenue</div><div class="v">${money(last.revenue)}</div><div class="d ${revDelta >= 0 ? "up" : "down"}">${revDelta >= 0 ? "▲" : "▼"} ${pct(revDelta)} vs ${prev.m}</div></div>`));
  tiles.appendChild(el(`<div class="tile"><div class="k">Net profit</div><div class="v ${last.net >= 0 ? "" : "down"}">${money(last.net)}</div><div class="d ${netDelta >= 0 ? "up" : "down"}">${netDelta >= 0 ? "▲" : "▼"} ${pct(netDelta)} vs ${prev.m}</div></div>`));
  tiles.appendChild(el(`<div class="tile"><div class="k">Vs 3-mo average</div><div class="v ${vsAvg >= 0 ? "" : "down"}">${pct(vsAvg)}</div><div class="d" style="color:var(--muted)">avg ${money(avg3)}/mo</div></div>`));
  tiles.appendChild(el(`<div class="tile"><div class="k">Cash on hand</div><div class="v">${money(last.balance)}</div><div class="d" style="color:var(--muted)">bank balance</div></div>`));
  root.appendChild(tiles);

  // ================= P&L =================
  root.appendChild(el(`<h2>Profit &amp; loss</h2>`));
  const plCard = el(`<div class="card"><div class="ct">Month by month</div><div class="cs">Revenue → product cost → fixed costs → what you keep</div></div>`);
  const wrap = el(`<div class="scrollx"></div>`);
  const rows = pl.slice(-8).reverse();
  const tbl = el(`<table class="tbl"><thead><tr><th>Month</th><th>Revenue</th><th>Product</th><th>Gross</th><th>Fixed</th><th>Net</th></tr></thead><tbody></tbody></table>`);
  const tb = tbl.querySelector("tbody");
  rows.forEach(p => tb.appendChild(el(`<tr><td><b>${p.m}</b></td><td>${money(p.revenue)}</td><td>${money(p.cogs)}</td><td>${money(p.gross)}</td><td>${money(p.fixed)}</td><td class="${p.net >= 0 ? "pos" : "neg"}">${money(p.net)}</td></tr>`)));
  wrap.appendChild(tbl); plCard.appendChild(wrap);
  root.appendChild(plCard);

  const netCard = el(`<div class="card"><div class="ct">Net profit trend</div><div class="cs">After product cost and all fixed costs</div></div>`);
  netCard.appendChild(barChart(pl.slice(-12).map(p => ({ m: p.m, v: Math.round(p.net) }))));
  root.appendChild(netCard);

  // ================= REVENUE TREND =================
  const revSeries = pl.map(p => ({ m: p.m, v: Math.round(p.revenue) }));
  const mavg = revSeries.map((_, i) => { const w = revSeries.slice(Math.max(0, i - 2), i + 1); return w.reduce((a, x) => a + x.v, 0) / w.length; });
  const revCard = el(`<div class="card"><div class="ct">Revenue trend</div><div class="cs">Monthly sales · dashed line is the 3-month average</div></div>`);
  revCard.appendChild(lineChart(revSeries, { avg: mavg }));
  revCard.appendChild(el(`<div class="legend"><span><i style="background:var(--s1)"></i>Revenue</span><span><i style="background:var(--s2)"></i>3-mo average</span></div>`));
  root.appendChild(revCard);

  const ioCard = el(`<div class="card"><div class="ct">Money in vs money out</div><div class="cs">Sales against everything you spent</div></div>`);
  ioCard.appendChild(groupChart(pl.slice(-12).map(p => ({ m: p.m, i: Math.round(p.revenue), o: Math.round(p.debits) })), "i", "o", "var(--s3)", "var(--s2)"));
  ioCard.appendChild(el(`<div class="legend"><span><i style="background:var(--s3)"></i>In</span><span><i style="background:var(--s2)"></i>Out</span></div>`));
  root.appendChild(ioCard);

  // ================= WHAT EARNS =================
  root.appendChild(el(`<h2>What earns its slot</h2>`));
  const byProd = {};
  known.forEach(s => {
    const k = shortName(s.product);
    if (!byProd[k]) byProd[k] = { profit: 0, units: 0, perDay: 0, price: s.price, cost: s.cost, slots: 0 };
    byProd[k].profit += s.profit; byProd[k].units += s.units; byProd[k].perDay += s.perDay; byProd[k].slots++;
  });
  const prods = Object.entries(byProd).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.perDay - a.perDay);
  const topP = prods.slice(0, 10), maxPD = Math.max(...topP.map(p => p.perDay));
  const topCard = el(`<div class="card"><div class="ct">Top earners</div><div class="cs">Profit per day, ${d.window.label} — the number that matters</div></div>`);
  topP.forEach(p => topCard.appendChild(barRow(p.k, p.perDay, maxPD, "var(--s1)", v => "$" + v.toFixed(2) + "/d")));
  root.appendChild(topCard);

  const worst = prods.filter(p => p.units > 0).slice(-6).reverse();
  const lowCard = el(`<div class="card"><div class="ct">Weakest slots</div><div class="cs">Lowest profit per day — candidates to replace</div></div>`);
  const maxW = Math.max(...worst.map(p => Math.abs(p.perDay)), 0.01);
  worst.forEach(p => lowCard.appendChild(barRow(p.k, p.perDay, maxW, "var(--s4)", v => "$" + v.toFixed(2) + "/d")));
  root.appendChild(lowCard);

  // below cost — real ones only
  const below = known.filter(s => s.belowCost);
  if (below.length) {
    const bc = el(`<div class="card"><div class="ct">Priced at or below cost <span class="pill bad">fix</span></div><div class="cs">Every sale loses money</div></div>`);
    const rws = el(`<div class="rows"></div>`);
    below.forEach(s => rws.appendChild(el(`<div class="row"><div class="nm">${esc(shortName(s.product))}<div class="mt">slot ${s.slot} · costs ${money2(s.cost)} · sells ${money2(s.price)}</div></div><div class="val down">${money2(s.marginEach)}</div></div>`)));
    bc.appendChild(rws); root.appendChild(bc);
  } else {
    root.appendChild(el(`<div class="alert" style="border-left-color:var(--good)"><b>Nothing is priced below cost.</b> Every slot in both machines earns a positive margin.</div>`));
  }

  // ================= CATEGORY MIX =================
  root.appendChild(el(`<h2>Where the profit comes from</h2>`));
  const cats = {};
  known.forEach(s => { cats[s.category] = (cats[s.category] || 0) + s.profit; });
  const catList = Object.entries(cats).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
  const catMax = Math.max(...catList.map(c => c.v));
  const catTotal = catList.reduce((a, c) => a + c.v, 0);
  const catCard = el(`<div class="card"><div class="ct">By category</div><div class="cs">Total profit, ${d.window.label}</div></div>`);
  const catColors = { Drinks: "var(--s1)", Snacks: "var(--s3)", Candy: "var(--s4)", "Cold Food": "var(--s2)" };
  catList.forEach(c => catCard.appendChild(barRow(`${c.k} · ${Math.round(c.v / catTotal * 100)}%`, c.v, catMax, catColors[c.k] || "var(--s1)")));
  root.appendChild(catCard);

  // machine comparison
  const mCard = el(`<div class="card"><div class="ct">Machine vs machine</div><div class="cs">Profit per day and how full each is right now</div></div>`);
  const mRows = el(`<div class="rows"></div>`);
  d.machines.forEach(m => {
    const ks = m.slots.filter(s => s.cost != null);
    const pd = ks.reduce((a, s) => a + (s.perDay || 0), 0);
    const fill = Math.round(m.slots.reduce((a, s) => a + s.fillPct, 0) / (m.slots.length || 1));
    const empties = m.slots.filter(s => s.onHand === 0).length;
    mRows.appendChild(el(`<div class="row"><div class="nm">${esc(m.name)}<div class="mt">${m.slots.length} slots · ${fill}% full${empties ? ` · ${empties} empty` : ""}</div></div><div class="val">$${pd.toFixed(2)}/d</div></div>`));
  });
  mCard.appendChild(mRows);
  root.appendChild(mCard);

  // ================= NEEDS ATTENTION =================
  const lowStock = allSlots.filter(s => s.max > 0 && s.onHand / s.max <= 0.34).sort((a, b) => (a.onHand / a.max) - (b.onHand / b.max));
  if (lowStock.length) {
    root.appendChild(el(`<h2>Needs attention</h2>`));
    const ls = el(`<div class="card"><div class="ct">Running low or empty <span class="pill warn">${lowStock.length}</span></div><div class="cs">A third full or less, right now</div></div>`);
    const lr = el(`<div class="rows"></div>`);
    lowStock.slice(0, 14).forEach(s => lr.appendChild(el(`<div class="row"><div class="nm">${esc(shortName(s.product))}<div class="mt">${esc(s.machine)} · slot ${s.slot}</div></div><div class="val ${s.onHand === 0 ? "down" : ""}">${s.onHand}/${s.max}</div></div>`)));
    ls.appendChild(lr); root.appendChild(ls);
  }

  // ================= COSTS =================
  root.appendChild(el(`<h2>Where the money goes</h2>`));
  const fixed = d.fixedCosts.reduce((a, c) => a + c.amount, 0);
  const fc = el(`<div class="card"><div class="ct">Fixed monthly costs</div><div class="cs">Owed every month before a single sale</div></div>`);
  const fr = el(`<div class="rows"></div>`);
  d.fixedCosts.forEach(c => fr.appendChild(el(`<div class="row"><div class="nm">${esc(c.name)}${c.note ? `<div class="mt">${esc(c.note)}</div>` : ""}</div><div class="val">${money2(c.amount)}</div></div>`)));
  fr.appendChild(el(`<div class="row"><div class="nm"><b>Total</b></div><div class="val">${money2(fixed)}</div></div>`));
  fc.appendChild(fr); root.appendChild(fc);

  const breakeven = fixed / (1 - 0.52);
  root.appendChild(el(`<div class="alert" style="border-left-color:var(--accent)"><b>Break-even is ${money(breakeven)}/month</b> in sales. Last month you did ${money(last.revenue)} — ${last.revenue >= breakeven ? `${money(last.revenue - breakeven)} above it.` : `${money(breakeven - last.revenue)} short.`}</div>`));

  root.appendChild(el(`<div style="text-align:center;color:var(--muted);font-size:11px;margin-top:18px">Live from AirVend · updated ${new Date(d.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>`));
}
