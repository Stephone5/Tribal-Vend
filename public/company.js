// Business view — the essentials up top, everything else behind "More".
// Paints instantly from the last cached pull, then refreshes in the background.

import { apiFetch } from "./api.js";

const SVGNS = "http://www.w3.org/2000/svg";
const el = h => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => (n >= 0 ? "+" : "") + n.toFixed(0) + "%";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shortName = s => String(s || "").replace(/^(Meals|Drinks|Crackers)\s*[-:]\s*/i, "").replace(/\s*\d+(\.\d+)?\s*(oz|fl oz|ct|count|-Ounce|piece|pk).*$/i, "").replace(/,.*$/, "").trim().slice(0, 26);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parseMonth = m => { const [mo, yy] = String(m).split(" "); return { year: 2000 + (+yy), month: MON.indexOf(mo) }; };

// Filter the P&L rows to a period. "Last month" = the most recent COMPLETE
// calendar month; "This year" = year-to-date; "Last year" = the full prior
// calendar year; "All time" = everything.
function filterPL(pl, period) {
  const now = new Date(), y = now.getFullYear(), mi = now.getMonth();
  if (period === "all") return pl;
  if (period === "ytd") return pl.filter(p => parseMonth(p.m).year === y);
  if (period === "lastyear") return pl.filter(p => parseMonth(p.m).year === y - 1);
  if (period === "lastmonth") {
    let lm = mi - 1, ly = y; if (lm < 0) { lm = 11; ly--; }
    return pl.filter(p => { const q = parseMonth(p.m); return q.year === ly && q.month === lm; });
  }
  return pl;
}

const LIVE_LSK = "tv_live_cache_v2";
const GROSS = 0.45;            // last-resort fallback only; break-even derives the real margin live from the P&L
const EMP_RATE = 15, EMP_HRS = 4; // $/hr and hours/week for the "can I hire" math
const EMP_MONTHLY = Math.round(EMP_RATE * EMP_HRS * 4.333);

// ---------- chart helpers ----------
function svg(w, h) { const s = document.createElementNS(SVGNS, "svg"); s.setAttribute("class", "chart"); s.setAttribute("viewBox", `0 0 ${w} ${h}`); return s; }
function ln(s, x1, y1, x2, y2, stroke, sw = 1) { const l = document.createElementNS(SVGNS, "line"); l.setAttribute("x1", x1); l.setAttribute("y1", y1); l.setAttribute("x2", x2); l.setAttribute("y2", y2); l.setAttribute("stroke", stroke); l.setAttribute("stroke-width", sw); s.appendChild(l); }
function tx(s, x, y, str, o = {}) { const t = document.createElementNS(SVGNS, "text"); t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("fill", o.fill || "var(--muted)"); t.setAttribute("font-size", o.size || 10); t.setAttribute("text-anchor", o.anchor || "middle"); t.setAttribute("font-weight", o.weight || 500); t.setAttribute("font-variant-numeric", "tabular-nums"); t.textContent = str; s.appendChild(t); }
function rect(s, x, y, w, h, fill, r = 3) { const p = document.createElementNS(SVGNS, "rect"); p.setAttribute("x", x); p.setAttribute("y", y); p.setAttribute("width", Math.max(0, w)); p.setAttribute("height", Math.max(0, h)); p.setAttribute("rx", r); p.setAttribute("fill", fill); s.appendChild(p); }
function pathd(s, d, stroke, sw = 2, fill = "none") { const p = document.createElementNS(SVGNS, "path"); p.setAttribute("d", d); p.setAttribute("fill", fill); p.setAttribute("stroke", stroke); p.setAttribute("stroke-width", sw); p.setAttribute("stroke-linejoin", "round"); p.setAttribute("stroke-linecap", "round"); s.appendChild(p); return p; }
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }

function barChart(series, { fmt = money } = {}) {
  const W = 680, H = 190, L = 6, R = 6, T = 14, B = 22;
  const s = svg(W, H);
  const vals = series.map(d => d.v);
  const hi = niceMax(Math.max(...vals, 0) * 1.1), lo = Math.min(0, ...vals) * 1.1;
  const iw = W - L - R, ih = H - T - B, yf = v => T + ih - ((v - lo) / (hi - lo || 1)) * ih;
  for (let g = 0; g <= 2; g++) { const yv = lo + (hi - lo) * g / 2; const y = yf(yv); ln(s, L, y, W - R, y, "var(--line)"); tx(s, L, y - 4, fmt(yv), { anchor: "start" }); }
  const zero = yf(0); ln(s, L, zero, W - R, zero, "var(--muted)", 1);
  const gw = iw / series.length, bw = Math.min(18, gw - 4);
  series.forEach((d, i) => { const x = L + i * gw + (gw - bw) / 2, y = d.v >= 0 ? yf(d.v) : zero; rect(s, x, y, bw, Math.abs(yf(d.v) - zero), d.v >= 0 ? "var(--s3)" : "var(--bad)", 3); });
  [0, Math.floor(series.length / 2), series.length - 1].forEach(i => tx(s, L + i * gw + gw / 2, H - 5, series[i].m));
  return s;
}
function lineChart(series, { color = "var(--s1)", avg = null } = {}) {
  const W = 680, H = 190, L = 6, R = 6, T = 14, B = 22;
  const s = svg(W, H);
  const vals = series.map(d => d.v), hi = niceMax(Math.max(...vals) * 1.08);
  const iw = W - L - R, ih = H - T - B, xf = i => L + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw), yf = v => T + ih - (v / (hi || 1)) * ih;
  for (let g = 0; g <= 2; g++) { const yv = hi * g / 2; const y = yf(yv); ln(s, L, y, W - R, y, "var(--line)"); tx(s, L, y - 4, money(yv), { anchor: "start" }); }
  let d = `M ${xf(0)} ${yf(vals[0])}`; series.forEach((p, i) => d += ` L ${xf(i)} ${yf(p.v)}`);
  pathd(s, d + ` L ${xf(series.length - 1)} ${yf(0)} L ${xf(0)} ${yf(0)} Z`, "none", 0, color).setAttribute("opacity", ".10");
  pathd(s, d, color, 2);
  if (avg) { let a = `M ${xf(0)} ${yf(avg[0])}`; avg.forEach((v, i) => a += ` L ${xf(i)} ${yf(v)}`); pathd(s, a, "var(--s2)", 1.5).setAttribute("stroke-dasharray", "4 3"); }
  [0, Math.floor(series.length / 2), series.length - 1].forEach(i => tx(s, xf(i), H - 5, series[i].m));
  return s;
}
function multiLineChart(rows, series) {
  // rows: [{m, <key>:units, ...}] ; series: [{key,label,color}]
  const W = 680, H = 210, L = 6, R = 6, T = 14, B = 22;
  const s = svg(W, H);
  const hi = niceMax(Math.max(...rows.flatMap(r => series.map(se => r[se.key] || 0)), 1) * 1.08);
  const iw = W - L - R, ih = H - T - B;
  const xf = i => L + (rows.length === 1 ? iw / 2 : (i / (rows.length - 1)) * iw), yf = v => T + ih - (v / hi) * ih;
  for (let g = 0; g <= 2; g++) { const yv = hi * g / 2, y = yf(yv); ln(s, L, y, W - R, y, "var(--line)"); tx(s, L, y - 4, String(Math.round(yv)), { anchor: "start" }); }
  series.forEach(se => {
    let d = "";
    rows.forEach((r, i) => { d += `${i ? " L" : "M"} ${xf(i)} ${yf(r[se.key] || 0)}`; });
    pathd(s, d, se.color, 2);
  });
  [0, Math.floor(rows.length / 2), rows.length - 1].forEach(i => tx(s, xf(i), H - 5, rows[i].m.slice(2)));
  return s;
}
function groupChart(rows, aKey, bKey, aColor, bColor) {
  const W = 680, H = 190, L = 6, R = 6, T = 14, B = 22;
  const s = svg(W, H);
  const hi = niceMax(Math.max(...rows.map(d => Math.max(d[aKey], d[bKey]))) * 1.1);
  const iw = W - L - R, ih = H - T - B, yf = v => T + ih - (v / hi) * ih;
  for (let g = 0; g <= 2; g++) { const yv = hi * g / 2; const y = yf(yv); ln(s, L, y, W - R, y, "var(--line)"); tx(s, L, y - 4, money(yv), { anchor: "start" }); }
  const gw = iw / rows.length, bw = Math.min(10, (gw - 5) / 2);
  rows.forEach((d, i) => { const cx = L + i * gw + gw / 2; rect(s, cx - bw - 1, yf(d[aKey]), bw, ih - (yf(d[aKey]) - T), aColor, 2); rect(s, cx + 1, yf(d[bKey]), bw, ih - (yf(d[bKey]) - T), bColor, 2); });
  [0, Math.floor(rows.length / 2), rows.length - 1].forEach(i => tx(s, L + i * gw + gw / 2, H - 5, rows[i].m));
  return s;
}
function hourChart(byHour) {
  const W = 680, H = 160, L = 6, R = 6, T = 12, B = 20, s = svg(W, H);
  const hi = niceMax(Math.max(...byHour) * 1.1), iw = W - L - R, ih = H - T - B, yf = v => T + ih - (v / (hi || 1)) * ih;
  for (let g = 0; g <= 2; g++) { const yv = hi * g / 2; const y = yf(yv); ln(s, L, y, W - R, y, "var(--line)"); tx(s, L, y - 4, money(yv), { anchor: "start" }); }
  const gw = iw / 24, bw = Math.max(6, gw - 3);
  byHour.forEach((v, h) => rect(s, L + h * gw + (gw - bw) / 2, yf(v), bw, ih - (yf(v) - T), v >= hi * 0.5 ? "var(--s1)" : "var(--s3)", 2));
  [0, 6, 12, 18, 23].forEach(h => tx(s, L + h * gw + gw / 2, H - 5, h === 0 ? "12a" : h === 12 ? "12p" : h > 12 ? (h - 12) + "p" : h + "a"));
  return s;
}
function barRow(label, value, max, color, fmtv = money2) {
  const w = max > 0 ? Math.max(2, (Math.abs(value) / max) * 100) : 0;
  return el(`<div class="bar-line"><span class="lbl">${esc(label)}</span><span class="track"><span class="fill" style="width:${w}%;background:${color}"></span></span><span class="amt" style="color:${value < 0 ? "var(--bad)" : "var(--ink)"}">${fmtv(value)}</span></div>`);
}

// ---------- entry: instant from cache, then refresh ----------
let ROOT = null;
export async function renderCompany(root) {
  ROOT = root;
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(LIVE_LSK)); } catch {}
  if (cached) paint(root, cached, true);
  else root.innerHTML = skeleton();

  try {
    const r = await apiFetch("/api/live");
    if (r.ok) {
      const d = await r.json();
      try { localStorage.setItem(LIVE_LSK, JSON.stringify(d)); } catch {}
      if (ROOT === root) paint(root, d, false);
    } else if (!cached) {
      root.innerHTML = `<div class="note bad" style="margin-top:20px"><b>Couldn't load your numbers.</b> Pull to refresh in a moment.</div>`;
    }
  } catch (e) {
    if (!cached) root.innerHTML = `<div class="note bad" style="margin-top:20px"><b>Offline.</b> Showing nothing yet — reconnect and reopen.</div>`;
  }
}

function skeleton() {
  return `<div style="margin-top:20px">
    <div class="skel" style="height:150px;border-radius:22px"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:12px">
      <div class="skel" style="height:92px"></div><div class="skel" style="height:92px"></div>
    </div>
    <div class="skel" style="height:210px;margin-top:12px"></div>
  </div>`;
}

// ---------- paint ----------
function paint(root, d, stale) {
  const scrollY = window.scrollY;
  root.innerHTML = "";

  healthBanners(root, d);

  const allSlots = d.machines.flatMap(m => m.slots.map(s => ({ ...s, machine: m.name })));
  const known = allSlots.filter(s => s.cost != null);
  const S = d.sales;
  const pl = d.pl || [];
  window.__fixedCosts = d.fixedCosts || [];

  // ===================== SECTION 1 · THIS WEEK =====================
  root.appendChild(sectionLabel("This week"));

  const wkP = S ? S.thisWeek.profit : 0, wkR = S ? S.thisWeek.revenue : 0, wkU = S ? S.thisWeek.units : 0;
  const lwR = S ? S.lastWeek.revenue : 0;
  // Pace = how far into THIS week we are (0→1), from the real week start —
  // so the vs-last-week compare is apples to apples no matter the day.
  const elapsed = S ? Math.min(1, Math.max(0.03, (Date.now() - new Date(S.weekStart).getTime()) / (7 * 864e5))) : 1;
  const lwSoFar = lwR * elapsed;
  const wkDelta = lwSoFar > 0 ? ((wkR - lwSoFar) / lwSoFar) * 100 : 0;

  root.appendChild(el(`<div class="hero">
    <div class="k">Sales this week</div>
    <div class="v">${money2(wkR)}</div>
    <div class="sub"><b>${money2(wkP)}</b> profit · ${wkU} units · resets Mon midnight</div>
    <div class="delta ${wkDelta >= 0 ? "up" : "down"}">${wkDelta >= 0 ? "▲" : "▼"} ${pct(wkDelta)} vs this point last week</div>
    <div class="chips">
      <span class="chip"><span>Last week</span><b>${money(lwR)}</b></span>
      <span class="chip"><span>Empty now</span><b>${allSlots.filter(s => s.onHand === 0).length}</b></span>
      <span class="chip"><span>Avg fill</span><b>${Math.round(allSlots.reduce((a, s) => a + s.fillPct, 0) / (allSlots.length || 1))}%</b></span>
    </div>
  </div>`));

  if (S) {
    const c = el(`<div class="card"><div class="ct">Weekly profit</div><div class="cs">Every week Sunday → Saturday · this week still filling in</div></div>`);
    c.appendChild(barChart(S.weeks.slice(-14).map(w => ({ m: new Date(w.w).toLocaleDateString([], { month: "numeric", day: "numeric" }), v: Math.round(w.profit) }))));
    root.appendChild(c);
  }

  // ===================== SECTION 2 · THE MONEY =====================
  root.appendChild(sectionLabel("The money"));

  // Standing reminder: the money numbers are only as live as the data feeding
  // them. Once the OK bank is open, this has to be wired up.
  root.appendChild(bankFeedBanner());

  // Profit & loss — period selector (Last month / This year / Last year / All
  // time) over a QuickBooks-style hierarchy.
  if (pl.length) root.appendChild(plSection(pl));

  // Balance sheet — QuickBooks-style grouping.
  if (d.balanceSheet) root.appendChild(balanceSheetCard(d.balanceSheet));

  // Inventory loss — live, from real bank/card purchases vs sales.
  if (d.inventoryLoss) root.appendChild(lossCard(d.inventoryLoss));

  // Why profit ≠ cash — the question every owner asks.
  if (pl.length && d.balanceSheet && d.loan) root.appendChild(cashBridgeCard(d, pl));

  // Loan
  if (d.loan) {
    const L = d.loan, payoff = new Date(L.payoffDate + "T12:00:00");
    const lc = el(`<div class="card"><div class="ct">Wendle loan</div><div class="cs">$13,000 at 10% · ${money2(L.payment)}/mo · payment ${L.monthNumber} of 93</div></div>`);
    lc.appendChild(el(`<div style="margin:4px 2px 2px">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span style="font-size:27px;font-weight:800;letter-spacing:-.02em">${money(L.balance)}</span>
        <span style="font-size:12px;color:var(--muted)">still owed</span></div>
      <div style="height:10px;background:var(--surface-2);border-radius:99px;overflow:hidden;margin:11px 0 6px"><div style="height:100%;width:${L.pctPaid.toFixed(1)}%;background:var(--s3)"></div></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)"><span>${L.pctPaid.toFixed(0)}% of principal paid</span><span>${L.paymentsLeft} payments left</span></div>
    </div>`));
    const lr = el(`<div class="rows" style="margin-top:12px"></div>`);
    lr.appendChild(el(`<div class="row"><div class="nm">Paid off</div><div class="val">${payoff.toLocaleDateString([], { month: "short", year: "numeric" })}</div></div>`));
    lr.appendChild(el(`<div class="row"><div class="nm">Interest still to come</div><div class="val down">${money(L.interestLeft)}</div></div>`));
    lc.appendChild(lr);
    root.appendChild(lc);
    if (L.overpayWarning > 0) root.appendChild(el(`<div class="note warn"><b>Stop after payment 93, not 96.</b> The schedule lists 96 but the balance hits zero at 93 — paying all 96 hands over about ${money(L.overpayWarning * L.payment)} you don't owe.</div>`));
  }

  // Break-even + hire threshold. This is a CASH question — what you must clear
  // to cover the bills — so it uses the whole loan payment, not just interest.
  {
    const opFixed = (d.fixedCosts || []).reduce((a, c) => a + c.amount, 0);
    const loanPay = d.loan ? d.loan.payment : 0;
    const fixed = opFixed + loanPay;
    const recent = pl.slice(-3);
    const recentRev = recent.length ? recent.reduce((a, p) => a + p.revenue, 0) / recent.length : 0;
    // Margin is now LIVE, not a guess: real gross ÷ real revenue from the P&L,
    // then knocked down by inventory shrinkage — the margin you actually keep.
    const grossSum = pl.reduce((a, p) => a + p.gross, 0), revSum = pl.reduce((a, p) => a + p.revenue, 0);
    const loss = d.inventoryLoss ? d.inventoryLoss.loss : 0;
    const margin = revSum ? Math.max(0.05, (grossSum - loss) / revSum) : GROSS;
    const breakeven = fixed / margin;
    const hireNeed = (fixed + EMP_MONTHLY) / margin;
    const gap = hireNeed - recentRev;
    const bc = el(`<div class="card"><div class="ct">Break-even &amp; hiring</div><div class="cs">Averaging ${money(recentRev)}/mo · at your real ${Math.round(margin * 100)}% margin after shrinkage</div></div>`);
    const rows = el(`<div class="rows"></div>`);
    rows.appendChild(el(`<div class="row"><div class="nm">Just to break even<div class="mt">cover ${money(fixed)}/mo — bills + the ${money(loanPay)} loan payment</div></div><div class="val ${recentRev >= breakeven ? "up" : "down"}">${money(breakeven)}</div></div>`));
    rows.appendChild(el(`<div class="row"><div class="nm">To afford a helper<div class="mt">$${EMP_RATE}/hr, ~${EMP_HRS} hrs/wk on the route (${money(EMP_MONTHLY)}/mo)</div></div><div class="val">${money(hireNeed)}</div></div>`));
    bc.appendChild(rows);
    bc.appendChild(el(`<div class="note ${gap <= 0 ? "good" : ""}">${gap <= 0
      ? `<b>You can afford the helper.</b> You're clearing the ${money(hireNeed)} bar by about ${money(-gap)}/month.`
      : `<b>${money(gap)}/month more in sales</b> and a $${EMP_RATE}/hr helper pays for itself — roughly one more machine's worth.`}</div>`));
    root.appendChild(bc);
  }

  // ===================== SECTION 3 · YOUR PRODUCTS =====================
  root.appendChild(sectionLabel("Your products"));

  // aggregate by product for the earner/laggard views
  const byProd = {};
  known.forEach(s => { const k = shortName(s.product); if (!byProd[k]) byProd[k] = { profit: 0, units: 0, perDay: 0 }; byProd[k].profit += s.profit; byProd[k].units += s.units; byProd[k].perDay += s.perDay; });
  const prods = Object.entries(byProd).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.perDay - a.perDay);

  const top = prods.slice(0, 10), maxPD = Math.max(...top.map(p => p.perDay), 0.01);
  const tc = el(`<div class="card"><div class="ct">Top earners</div><div class="cs">Profit per day at today's prices — the number that matters</div></div>`);
  top.forEach(p => tc.appendChild(barRow(p.k, p.perDay, maxPD, "var(--s1)", v => "$" + v.toFixed(2) + "/d")));
  root.appendChild(tc);

  // sold out — losing sales
  const soldOut = known.filter(s => s.stockedOut && s.units > 0).sort((a, b) => b.unitsPerDay - a.unitsPerDay);
  if (soldOut.length) {
    const so = el(`<div class="card"><div class="ct">Sold out — losing sales <span class="pill warn">${soldOut.length}</span></div><div class="cs">Empty before you got back. Right column = days that par lasts.</div></div>`);
    const rr = el(`<div class="rows"></div>`);
    soldOut.forEach(s => rr.appendChild(el(`<div class="row"><div class="nm">${esc(shortName(s.product))}<div class="mt">${esc(s.machine)} · slot ${s.slot} · sells ${s.unitsPerDay.toFixed(2)}/day · par ${s.max}</div></div><div class="val">${(s.max / Math.max(s.unitsPerDay, .01)).toFixed(1)}d</div></div>`)));
    so.appendChild(rr); root.appendChild(so);
  }

  // below cost
  const below = known.filter(s => s.belowCost);
  if (below.length) {
    const bc = el(`<div class="card"><div class="ct">Priced at or below cost <span class="pill bad">fix</span></div><div class="cs">Every sale loses money — raise the price or fix the cost</div></div>`);
    const rr = el(`<div class="rows"></div>`);
    below.forEach(s => { const row = el(`<div class="row" style="cursor:pointer"><div class="nm">${esc(shortName(s.product))}<div class="mt">slot ${s.slot} · costs ${money2(s.cost)} · sells ${money2(s.price)}</div></div><div class="val down">${money2(s.marginEach)}</div></div>`); row.onclick = () => editCost({ product: s.product, price: s.price, cost: s.cost }, root); rr.appendChild(row); });
    bc.appendChild(rr); root.appendChild(bc);
  }

  // slowest slots (replaces "running low")
  const slow = prods.filter(p => p.units > 0).slice(-6).reverse();
  if (slow.length) {
    const sc = el(`<div class="card"><div class="ct">Slowest slots</div><div class="cs">Least profit per day — candidates to replace next reset</div></div>`);
    const maxS = Math.max(...slow.map(p => Math.abs(p.perDay)), 0.01);
    slow.forEach(p => sc.appendChild(barRow(p.k, p.perDay, maxS, "var(--s4)", v => "$" + v.toFixed(2) + "/d")));
    root.appendChild(sc);
  }

  // ===================== SALES TAX (subtle, collapsed) =====================
  if (d.salesTax) root.appendChild(salesTaxCard(d.salesTax));

  // ===================== MORE (collapsible) =====================
  root.appendChild(moreSection(d, allSlots, known, S, pl));

  // ---- footer ----
  const foot = el(`<div style="text-align:center;color:var(--muted);font-size:11px;margin-top:22px">
    ${stale ? "Updating…" : `Updated ${new Date(d.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}${S ? ` · ${S.txnCount.toLocaleString()} sales on record` : ""}
    <div style="margin-top:10px"><button id="refreshNow" class="btn ghost" style="width:auto;display:inline-block;padding:10px 18px;margin:0">Refresh now</button></div>
  </div>`);
  root.appendChild(foot);
  foot.querySelector("#refreshNow").onclick = async (e) => { e.target.textContent = "Refreshing…"; e.target.disabled = true; try { await apiFetch("/api/live?refresh=1"); } catch (_) {} renderCompany(root); };

  // Deliberate, rare full re-read of AirVend (double-confirmed).
  root.appendChild(airvendResyncButton());

  window.scrollTo(0, stale ? scrollY : 0);
}

// ---- deliberate "re-read everything from AirVend" (double-confirm) ----
function airvendResyncButton() {
  const wrap = el(`<div style="text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid var(--line)"></div>`);
  const b = el(`<button class="btn ghost" style="width:auto;display:inline-block;padding:9px 16px;margin:0;color:var(--muted);font-size:12px">⟳ Re-read everything from AirVend</button>`);
  b.onclick = confirmResync;
  wrap.appendChild(b);
  return wrap;
}
function confirmResync() {
  const modal = el(`<div style="position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:70;display:flex;align-items:center;justify-content:center;padding:24px"></div>`);
  const sheet = el(`<div style="background:var(--surface);border-radius:20px;max-width:430px;width:100%;padding:22px 20px;box-shadow:var(--shadow)">
    <div style="font-weight:800;font-size:18px;color:var(--ink)">Re-read everything from AirVend?</div>
    <div style="color:var(--ink-2);font-size:13.5px;line-height:1.5;margin-top:9px">Use this <b>only after you changed something in AirVend itself</b> — a par, a price, a swapped product. It replaces the app's planogram, pars, prices and on-hand with whatever AirVend says right now.</div>
    <div style="color:var(--muted);font-size:12px;margin-top:9px">It won't touch your closet or your cost corrections. You rarely need this.</div>
    <button id="rs-yes" class="btn" style="margin-top:16px;background:var(--bad);color:#fff">Yes, re-read from AirVend</button>
    <button id="rs-no" class="btn ghost" style="margin-top:8px">Cancel</button>
  </div>`);
  modal.appendChild(sheet); document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  sheet.querySelector("#rs-no").onclick = () => modal.remove();
  const yes = sheet.querySelector("#rs-yes");
  let armed = false;
  yes.onclick = async () => {
    if (!armed) { armed = true; yes.textContent = "Tap again to confirm"; yes.style.background = "var(--warn)"; return; } // double-confirm
    yes.disabled = true; yes.textContent = "Reading AirVend…";
    try { if (window.tvResyncAirVend) await window.tvResyncAirVend(); } catch (_) {}
    modal.remove();
  };
}

// ---------- bank-feed reminder (muted red) ----------
function bankFeedBanner() {
  return el(`<div style="display:flex;align-items:flex-start;gap:10px;background:rgba(200,55,45,.08);border:1px solid rgba(200,55,45,.18);border-radius:12px;padding:11px 13px;margin-bottom:2px">
    <span style="width:7px;height:7px;border-radius:50%;background:#b64236;flex:none;margin-top:5px"></span>
    <span style="flex:1;font-size:12.5px;color:#8f342c;font-weight:600;line-height:1.4">When you open the new bank in Oklahoma, wire its data into this app — Plaid, emailed statements, or a periodic CSV. Until then these numbers only move as fast as the data you feed in.</span></div>`);
}

// ---------- P&L with a period selector ----------
function plSection(pl) {
  const wrap = el(`<div></div>`);
  const bar = el(`<div class="period-bar"></div>`);
  const host = el(`<div></div>`);
  const periods = [["lastmonth", "Last month"], ["ytd", "This year"], ["lastyear", "Last year"], ["all", "All time"]];
  let cur = "ytd";
  const draw = () => {
    host.innerHTML = "";
    const rows = filterPL(pl, cur);
    const label = periods.find(p => p[0] === cur)[1];
    host.appendChild(rows.length ? plCard(rows, label)
      : el(`<div class="note">No sales on record for ${label.toLowerCase()} yet.</div>`));
    [...bar.children].forEach((b, i) => b.classList.toggle("on", periods[i][0] === cur));
  };
  periods.forEach(([k, lab]) => { const b = el(`<button class="period-btn">${lab}</button>`); b.onclick = () => { cur = k; draw(); }; bar.appendChild(b); });
  wrap.appendChild(bar); wrap.appendChild(host); draw();
  return wrap;
}

// ---------- QuickBooks-style P&L ----------
function plCard(pl, periodLabel) {
  const N = pl.length;
  const sum = k => pl.reduce((a, p) => a + (p[k] || 0), 0);
  const sales = sum("revenue"), cogs = sum("cogs"), gross = sum("gross");
  const loanInt = sum("loanInterest"), opFixed = sum("opFixed");
  const expenses = opFixed + loanInt, net = gross - expenses;
  const span = N === 1 ? pl[0].m : `${pl[0].m} – ${pl[N - 1].m}`;

  // one fixed-cost line = its monthly amount × months on record
  const opLines = (window.__fixedCosts || []).map(c => ({ name: c.name, amt: c.amount * N }));

  const sub = periodLabel ? `${periodLabel} · ${span}` : span;
  const c = el(`<div class="card"><div class="ct">Profit &amp; loss</div><div class="cs">${esc(sub)} · ${money(net)} kept on ${money(sales)}</div></div>`);
  const t = el(`<div class="qb"></div>`);
  const grp = (label, val, bold) => el(`<div class="qb-h ${bold ? "b" : ""}"><span>${esc(label)}</span><span>${money2(val)}</span></div>`);
  const line = (label, val, neg) => el(`<div class="qb-l"><span>${esc(label)}</span><span${neg ? ' class="neg"' : ""}>${neg ? "−" : ""}${money2(Math.abs(val))}</span></div>`);

  t.appendChild(grp("Income", sales, true));
  t.appendChild(line("Sales", sales));
  t.appendChild(line("Cost of goods (product)", cogs, true));
  t.appendChild(grp("Gross profit", gross, true));
  t.appendChild(grp("Expenses", expenses, true));
  opLines.forEach(l => t.appendChild(line(l.name, l.amt, true)));
  t.appendChild(line("Loan interest", loanInt, true));
  t.appendChild(el(`<div class="qb-h b tot"><span>Net income</span><span class="${net >= 0 ? "pos" : "neg"}">${money2(net)}</span></div>`));
  c.appendChild(t);

  // month-by-month detail, collapsed
  const tog = el(`<button class="btn ghost" style="margin-top:12px;display:flex;align-items:center;justify-content:center;gap:7px">Month by month <span>▾</span></button>`);
  const body = el(`<div hidden style="margin-top:10px"></div>`);
  const wrap = el(`<div class="scrollx"></div>`);
  const tbl = el(`<table class="tbl"><thead><tr><th>Month</th><th>Sales</th><th>Product</th><th>Gross</th><th>Op+int</th><th>Net</th></tr></thead><tbody></tbody></table>`);
  const tb = tbl.querySelector("tbody");
  [...pl].reverse().forEach(p => tb.appendChild(el(`<tr><td><b>${p.m}</b></td><td>${money(p.revenue)}</td><td>${money(p.cogs)}</td><td>${money(p.gross)}</td><td>${money(p.fixed)}</td><td class="${p.net >= 0 ? "pos" : "neg"}">${money(p.net)}</td></tr>`)));
  wrap.appendChild(tbl); body.appendChild(wrap);
  tog.onclick = () => { body.hidden = !body.hidden; tog.querySelector("span").textContent = body.hidden ? "▾" : "▴"; };
  c.appendChild(tog); c.appendChild(body);
  c.appendChild(el(`<div class="note" style="margin-top:12px"><b>Accrual basis</b> — like your QuickBooks. Sales are booked when they happen (not when the cash lands), and product cost is matched to the units actually sold. Operating costs are estimated at today's monthly rates until the bank feed is wired.</div>`));
  return c;
}

// ---------- QuickBooks-style balance sheet ----------
function balanceSheetCard(b) {
  const inventory = b.inventory != null ? b.inventory : (b.closetInventory || 0);
  const currentAssets = (b.cash || 0) + inventory;
  const c = el(`<div class="card"><div class="ct">Balance sheet</div><div class="cs">What the business owns vs owes · as of ${esc(b.cashAsOf || "now")}</div></div>`);
  const t = el(`<div class="qb"></div>`);
  const grp = (label, val, bold) => t.appendChild(el(`<div class="qb-h ${bold ? "b" : ""}"><span>${esc(label)}</span><span>${money2(val)}</span></div>`));
  const line = (label, val, sub) => t.appendChild(el(`<div class="qb-l"><span>${esc(label)}${sub ? `<span class="qb-sub">${esc(sub)}</span>` : ""}</span><span>${money2(val)}</span></div>`));

  grp("Assets", b.assets, true);
  grp("Current assets", currentAssets);
  line("Cash in bank", b.cash);
  line("Product inventory", inventory, b.closetUnits ? `${b.closetUnits} units, machines + closet (Sortly)` : "from Sortly");
  grp("Fixed assets", b.equipment);
  line("Machines (equipment)", b.equipment);
  t.appendChild(el(`<div class="qb-h b tot"><span>Total assets</span><span>${money2(b.assets)}</span></div>`));

  grp("Liabilities", b.liabilities, true);
  line("Wendle loan (principal owed)", b.liabilities);
  grp("Equity", b.equity, true);
  line("Net worth", b.equity);
  t.appendChild(el(`<div class="qb-h b tot"><span>Liabilities + equity</span><span>${money2((b.liabilities || 0) + (b.equity || 0))}</span></div>`));
  c.appendChild(t);
  const negEq = b.equity < 0;
  c.appendChild(el(`<div class="note ${negEq ? "warn" : "good"}" style="margin-top:12px"><b>Net worth: ${money(b.equity)}</b> — everything you own, minus the loan.${negEq ? " Negative is normal this early — the loan ($" + Math.round(b.liabilities).toLocaleString() + ") still outweighs the depreciated machines. It climbs as you pay down principal." : ""}</div>`));
  c.appendChild(el(`<div class="note" style="margin-top:8px;font-size:11.5px">Machines are at depreciated book value ($${b.equipment.toLocaleString()}, MACRS), matching your accountant — not sticker price. A balance sheet is a snapshot of <i>right now</i> — that's why it has no date buttons like the P&L. Once the bank feed is in, this can be shown as of any past date too.</div>`));
  return c;
}

// ---------- profit vs cash bridge ----------
// ---------- Inventory loss (live) ----------
function lossCard(L) {
  const gap = L.bought - L.sold;
  const c = el(`<div class="card"><div class="ct">Inventory &amp; loss</div><div class="cs">Bought vs sold, from your real bank + Sam's card · through ${esc(L.through)}</div></div>`);

  // hero loss figure
  c.appendChild(el(`<div style="margin:6px 2px 4px">
    <div style="display:flex;justify-content:space-between;align-items:baseline">
      <span style="font-size:28px;font-weight:800;letter-spacing:-.02em;color:var(--bad)">${money2(L.loss)}</span>
      <span style="font-size:12px;color:var(--muted)">lost · ${L.lossPct.toFixed(1)}% of what you bought</span></div>
    <div style="font-size:12.5px;color:var(--ink-2);margin-top:4px">Product you paid for that never became a sale — expired, ripped, eaten, or given away.</div>
  </div>`));

  // cumulative bought vs sold chart — the gap IS inventory + loss
  c.appendChild(cumChart(L.series));
  c.appendChild(el(`<div class="legend"><span><i style="background:var(--s2)"></i>Bought (at cost)</span><span><i style="background:var(--s1)"></i>Sold (at cost)</span></div>`));

  const rows = el(`<div class="rows" style="margin-top:10px"></div>`);
  rows.appendChild(el(`<div class="row"><div class="nm">Inventory bought<div class="mt">Sam's card + debit, from your statements</div></div><div class="val">${money2(L.bought)}</div></div>`));
  rows.appendChild(el(`<div class="row"><div class="nm">Cost of what sold<div class="mt">real units sold × your unit costs</div></div><div class="val">${money2(L.sold)}</div></div>`));
  rows.appendChild(el(`<div class="row"><div class="nm">Still on the shelf<div class="mt">Sortly, end of window</div></div><div class="val">${money2(L.onHand)}</div></div>`));
  rows.appendChild(el(`<div class="row"><div class="nm"><b>Loss</b><div class="mt">bought − sold − on-hand</div></div><div class="val down"><b>${money2(L.loss)}</b></div></div>`));
  c.appendChild(rows);

  c.appendChild(el(`<div class="note" style="margin-top:12px;font-size:11.5px">Live — recomputes every refresh and extends as new card statements and sales come in. Sold is valued at your <i>current</i> unit costs (higher than years past), so real loss is likely a bit more. Today's on-hand: ${money(L.currentOnHand)}.</div>`));
  return c;
}

// two cumulative lines with the gap shaded
function cumChart(series) {
  const W = 680, H = 200, L = 6, R = 6, T = 14, B = 22, s = svg(W, H);
  const hi = niceMax(Math.max(...series.map(d => d.bought)) * 1.08);
  const iw = W - L - R, ih = H - T - B;
  const xf = i => L + (i / (series.length - 1)) * iw, yf = v => T + ih - (v / (hi || 1)) * ih;
  for (let g = 0; g <= 2; g++) { const yv = hi * g / 2, y = yf(yv); ln(s, L, y, W - R, y, "var(--line)"); tx(s, L, y - 4, money(yv), { anchor: "start" }); }
  // shaded gap between bought and sold
  let area = `M ${xf(0)} ${yf(series[0].bought)}`;
  series.forEach((p, i) => area += ` L ${xf(i)} ${yf(p.bought)}`);
  for (let i = series.length - 1; i >= 0; i--) area += ` L ${xf(i)} ${yf(series[i].sold)}`;
  pathd(s, area + " Z", "none", 0, "var(--bad)").setAttribute("opacity", ".10");
  const line = (key, color) => { let d = `M ${xf(0)} ${yf(series[0][key])}`; series.forEach((p, i) => d += ` L ${xf(i)} ${yf(p[key])}`); pathd(s, d, color, 2.2); };
  line("bought", "var(--s2)");
  line("sold", "var(--s1)");
  const lbl = i => { const [y, m] = series[i].m.split("-"); return `${["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+m]} ${y.slice(2)}`; };
  [0, Math.floor(series.length / 2), series.length - 1].forEach(i => tx(s, xf(i), H - 5, lbl(i)));
  return s;
}

function cashBridgeCard(d, pl) {
  const b = d.balanceSheet;
  const lifeNet = pl.reduce((a, p) => a + p.net, 0);
  // Actual cash that went to principal = what's been knocked off the balance
  // (the schedule's principal column understates it because of your overpayments).
  const principalPaid = d.loan.principalPaid != null ? d.loan.principalPaid : Math.max(0, (d.loan.principal || 13000) - (d.loan.balance || 0));
  const inventory = b.inventory != null ? b.inventory : (b.closetInventory || 0);
  const cash = b.cash || 0;

  const c = el(`<div class="card"><div class="ct">Why profit isn't in the bank</div><div class="cs">Profit ${money(lifeNet)} · cash ${money(cash)} — they're never the same number</div></div>`);

  // ONLY the cash movements we can actually measure. No plug, no forced total.
  c.appendChild(el(`<div style="font-size:12.5px;color:var(--muted);font-weight:700;margin:6px 2px 2px;text-transform:uppercase;letter-spacing:.06em">What we can measure</div>`));
  const t = el(`<div class="qb"></div>`);
  const invLoss = d.inventoryLoss ? d.inventoryLoss.loss : null;
  t.appendChild(el(`<div class="qb-l"><span>Cash sent to loan principal<span class="qb-sub">real money out; builds equity, never hit the P&amp;L as an expense</span></span><span class="neg">−${money2(principalPaid)}</span></div>`));
  t.appendChild(el(`<div class="qb-l"><span>Cash tied up in stock on hand<span class="qb-sub">product sitting in the machines + closet</span></span><span class="neg">−${money2(inventory)}</span></div>`));
  if (invLoss != null) t.appendChild(el(`<div class="qb-l"><span>Inventory loss<span class="qb-sub">bought but never sold — see the card above</span></span><span class="neg">−${money2(invLoss)}</span></div>`));
  c.appendChild(t);

  c.appendChild(el(`<div class="note" style="margin-top:12px"><b>The loan is the headline.</b> You've put ${money(principalPaid)} of cash into paying down principal — more than your whole profit — so money has clearly also come <i>in</i> (your QuickBooks shows the owner contributions). Profit funded loan equity, stock, and shrinkage, not your checking account.</div>`));

  c.appendChild(el(`<div class="note bad" style="margin-top:10px"><b>Still needs the bank feed to close exactly:</b> money you put in vs. paid yourself, the machine down payment, and deposits still clearing. When the Oklahoma bank is wired, this becomes a full cash-flow statement — no gaps.</div>`));
  return c;
}

// ---------- PA sales tax (subtle, collapsed) ----------
function salesTaxCard(tax) {
  const wrap = el(`<div style="margin-top:26px"></div>`);
  const nextTxt = tax.next ? `next: ${tax.next.label.replace(/·.*/, "").trim()} by ${new Date(tax.next.due + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" })}` : "all quarters filed";
  const tog = el(`<button class="btn ghost" style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--muted)"><span>PA sales tax · ${tax.year}</span><span style="font-size:12px">${esc(nextTxt)} <span id="txchev">▾</span></span></button>`);
  const body = el(`<div hidden style="margin-top:10px"></div>`);
  wrap.appendChild(tog); wrap.appendChild(body);
  let built = false;
  tog.onclick = () => {
    body.hidden = !body.hidden;
    tog.querySelector("#txchev").textContent = body.hidden ? "▾" : "▴";
    if (built || body.hidden) return; built = true;

    const c = el(`<div class="card"><div class="ct">Estimated sales tax owed</div><div class="cs">On taxable drinks only · ${money2(tax.ytdTaxDue)} year-to-date</div></div>`);
    const t = el(`<div class="qb"></div>`);
    tax.quarters.forEach(q => {
      const due = new Date(q.due + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
      const isNext = tax.next && q.q === tax.next.q;
      t.appendChild(el(`<div class="qb-l"><span>${esc(q.label)}<span class="qb-sub">${q.status === "past" ? "was due" : "file by"} ${due}${isNext ? " · next" : ""}</span></span><span${isNext ? ' style="color:var(--s1);font-weight:700"' : ""}>${money2(q.taxDue)}</span></div>`));
    });
    t.appendChild(el(`<div class="qb-h b tot"><span>Total ${tax.year}</span><span>${money2(tax.ytdTaxDue)}</span></div>`));
    c.appendChild(t);

    if (tax.taxableItems && tax.taxableItems.length) {
      const top = tax.taxableItems.slice(0, 6).map(i => shortName(i.item)).join(", ");
      c.appendChild(el(`<div class="note" style="margin-top:12px"><b>Taxed items:</b> ${esc(top)}${tax.taxableItems.length > 6 ? ", …" : ""}. Snacks, candy, plain water, tea, and cold coffee aren't taxed.</div>`));
    }
    c.appendChild(el(`<div class="note" style="margin-top:8px;font-size:11.5px">Method: taxable gross ÷ 1.06 × 0.06 (61 PA Code § 31.28); items per REV-717. Estimate — verify before filing.</div>`));
    const go = el(`<a href="${esc(tax.fileUrl)}" target="_blank" rel="noopener" class="btn" style="margin-top:12px;text-decoration:none;display:block;text-align:center">File at myPATH (mypath.pa.gov) →</a>`);
    c.appendChild(go);
    body.appendChild(c);
  };
  return wrap;
}

function sectionLabel(text) {
  return el(`<div style="display:flex;align-items:center;gap:10px;margin:30px 2px 12px"><span style="width:22px;height:3px;background:var(--gold);border-radius:2px"></span><span style="font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-2);font-weight:800">${esc(text)}</span></div>`);
}

// ---------- health banners (top, muted red) ----------
function healthBanners(root, d) {
  const issues = (d.audit && d.audit.issues) || [];
  const wrap = el(`<div id="tv-health"></div>`);
  root.appendChild(wrap);

  const below = issues.find(i => i.code === "below_cost");
  const unknown = issues.find(i => i.code === "unknown_costs");
  const est = issues.find(i => i.code === "estimated_costs");
  const broke = issues.find(i => i.code === "machine_unreachable" || i.code === "no_sales");

  const banner = (text, onClick) => {
    const b = el(`<div style="display:flex;align-items:center;gap:10px;background:rgba(200,55,45,.08);border:1px solid rgba(200,55,45,.18);border-radius:12px;padding:11px 13px;margin-top:10px;cursor:${onClick ? "pointer" : "default"}">
      <span style="width:7px;height:7px;border-radius:50%;background:#b64236;flex:none"></span>
      <span style="flex:1;font-size:13px;color:#8f342c;font-weight:600;line-height:1.35">${text}</span>
      ${onClick ? `<span style="color:#b64236;font-size:17px">›</span>` : ""}</div>`);
    if (onClick) b.onclick = onClick;
    wrap.appendChild(b);
  };

  if (broke) banner(`<b>${esc(broke.title)}.</b> Tap to retry.`, () => renderCompany(root));
  if (below) banner(`<b>${esc(shortName(below.product || "A product"))} is priced at or below cost.</b> Raise it in AirVend, or fix the cost.`, () => editCost({ product: below.product, price: null, cost: null }, root));
  if (unknown) banner(`<b>${unknown.products.length} product${unknown.products.length === 1 ? "" : "s"} missing a cost.</b> They're left out of profit. Tap to set them.`, () => costChooser(unknown.products, root));
  if (est) banner(`${est.products.length} cost${est.products.length === 1 ? " is an estimate" : "s are estimates"}, not your records. Tap to check them.`, () => costChooser(est.products, root));
}

// ---------- cost correction ----------
function costChooser(products, root) {
  const modal = el(`<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:60;display:flex;align-items:flex-end;justify-content:center"></div>`);
  const sheet = el(`<div style="background:var(--surface);width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:18px 16px calc(22px + env(safe-area-inset-bottom));max-height:82vh;overflow:auto"><div style="font-weight:800;font-size:16px;margin-bottom:4px">Set the real costs</div><div style="color:var(--muted);font-size:12.5px;margin-bottom:12px">Tap a product and enter what you actually pay per unit.</div></div>`);
  modal.appendChild(sheet); document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  const rows = el(`<div class="rows"></div>`);
  products.forEach(p => { const row = el(`<div class="row" style="cursor:pointer"><div class="nm">${esc(shortName(p.product))}<div class="mt">${p.cost == null ? "no cost set" : "estimated " + money2(p.cost)}${p.price ? " · sells " + money2(p.price) : ""}</div></div><div class="val" style="color:var(--s1)">set ›</div></div>`); row.onclick = () => { modal.remove(); editCost(p, root); }; rows.appendChild(row); });
  sheet.appendChild(rows);
  const close = el(`<button class="btn ghost" style="margin-top:14px">Done</button>`); close.onclick = () => modal.remove(); sheet.appendChild(close);
}
function editCost(p, root) {
  const modal = el(`<div style="position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:61;display:flex;align-items:flex-end;justify-content:center"></div>`);
  const sheet = el(`<div style="background:var(--surface);width:100%;max-width:520px;border-radius:20px 20px 0 0;padding:18px 16px calc(22px + env(safe-area-inset-bottom))">
      <div style="font-weight:800;font-size:16px">${esc(shortName(p.product))}</div>
      <div style="color:var(--muted);font-size:12.5px;margin-top:3px">${p.price ? "Sells for " + money2(p.price) + ". " : ""}What do you pay per unit?</div>
      <input id="cst" type="text" inputmode="decimal" value="${p.cost != null ? p.cost : ""}" placeholder="0.00" style="width:100%;margin-top:14px;background:var(--surface-2);border:1.5px solid var(--line);color:var(--ink);border-radius:12px;padding:15px;font-size:19px;text-align:center">
      <div id="cerr" style="color:var(--bad);font-size:12px;height:15px;margin-top:6px"></div>
      <button id="csave" class="btn">Save cost</button>
      <button id="ccancel" class="btn ghost" style="margin-top:8px">Cancel</button></div>`);
  modal.appendChild(sheet); document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  sheet.querySelector("#ccancel").onclick = () => modal.remove();
  const inp = sheet.querySelector("#cst"); inp.focus();
  sheet.querySelector("#csave").onclick = async () => {
    const v = parseFloat(inp.value), err = sheet.querySelector("#cerr");
    if (isNaN(v) || v < 0) { err.textContent = "Enter a number, like 0.79"; return; }
    const btn = sheet.querySelector("#csave"); btn.disabled = true; btn.textContent = "Saving…";
    try { await apiFetch("/api/costs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: p.product, cost: v }) }); await apiFetch("/api/live?refresh=1"); modal.remove(); renderCompany(root); }
    catch (e) { err.textContent = "Couldn't save. Try again."; btn.disabled = false; btn.textContent = "Save cost"; }
  };
}

// ---------- More (collapsible) ----------
function moreSection(d, allSlots, known, S, pl) {
  const wrap = el(`<div style="margin-top:30px"></div>`);
  const toggle = el(`<button class="btn ghost" style="display:flex;align-items:center;justify-content:center;gap:8px">More charts <span id="mchev">▾</span></button>`);
  const body = el(`<div id="more-body" hidden style="margin-top:12px"></div>`);
  wrap.appendChild(toggle); wrap.appendChild(body);
  let built = false;
  toggle.onclick = () => {
    body.hidden = !body.hidden;
    toggle.querySelector("#mchev").textContent = body.hidden ? "▾" : "▴";
    if (body.hidden || built) return;
    built = true;
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    if (S) {
      const dm = Math.max(...S.byDow), c1 = el(`<div class="card"><div class="ct">Best days to be stocked</div><div class="cs">Total sales by weekday, last ${S.spanDays} days</div></div>`);
      S.byDow.forEach((v, i) => c1.appendChild(barRow(dow[i], v, dm, i === 0 || i === 6 ? "var(--s4)" : "var(--s1)", money)));
      body.appendChild(c1);

      const c2 = el(`<div class="card"><div class="ct">When people buy</div><div class="cs">Sales by hour of day</div></div>`); c2.appendChild(hourChart(S.byHour)); body.appendChild(c2);

      if (S.months && S.months.length > 2) {
        const c3 = el(`<div class="card"><div class="ct">Seasonal curve</div><div class="cs">Machine revenue by month, ${S.months[0].m} → now</div></div>`);
        c3.appendChild(lineChart(S.months.map(m => ({ m: m.m.slice(2), v: Math.round(m.revenue) }))));
        body.appendChild(c3);
      }

      if (S.monthlyByCategory && S.monthlyByCategory.length > 2) {
        const series = [
          { key: "energy", label: "Energy", color: "var(--s1)" },
          { key: "soda", label: "Soda", color: "var(--s2)" },
          { key: "sports/water", label: "Sports/water", color: "var(--s3)" },
          { key: "chips", label: "Chips", color: "var(--s4)" },
          { key: "candy", label: "Candy", color: "#c9770e" },
          { key: "pastry", label: "Pastry", color: "#7b5ea7" },
          { key: "cold food", label: "Cold food", color: "#3f8f6b" },
        ];
        const c3b = el(`<div class="card"><div class="ct">Category seasonality</div><div class="cs">Units/month per category — does energy carry winter, chips carry summer?</div></div>`);
        c3b.appendChild(multiLineChart(S.monthlyByCategory, series));
        const leg = el(`<div class="legend"></div>`);
        series.forEach(se => leg.appendChild(el(`<span><i style="background:${se.color}"></i>${se.label}</span>`)));
        c3b.appendChild(leg);
        body.appendChild(c3b);
      }
    }
    if (pl.length) {
      const c4 = el(`<div class="card"><div class="ct">Net profit trend</div><div class="cs">After product and fixed costs, last 12 months</div></div>`); c4.appendChild(barChart(pl.slice(-12).map(p => ({ m: p.m.slice(0, 3), v: Math.round(p.net) })))); body.appendChild(c4);
      const c5 = el(`<div class="card"><div class="ct">Money in vs out</div><div class="cs">Sales against everything spent</div></div>`); c5.appendChild(groupChart(pl.slice(-12).map(p => ({ m: p.m.slice(0, 3), i: Math.round(p.revenue), o: Math.round(p.debits) })), "i", "o", "var(--s3)", "var(--s2)")); c5.appendChild(el(`<div class="legend"><span><i style="background:var(--s3)"></i>In</span><span><i style="background:var(--s2)"></i>Out</span></div>`)); body.appendChild(c5);
    }
    // category mix
    const cats = {}; known.forEach(s => cats[s.category] = (cats[s.category] || 0) + s.profit);
    const catList = Object.entries(cats).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v);
    const catMax = Math.max(...catList.map(c => c.v), 0.01), catTot = catList.reduce((a, c) => a + c.v, 0);
    const cc = { Drinks: "var(--s1)", Snacks: "var(--s3)", Candy: "var(--s4)", "Cold Food": "var(--s2)" };
    const c6 = el(`<div class="card"><div class="ct">Profit by category</div><div class="cs">Where the margin comes from</div></div>`);
    catList.forEach(c => c6.appendChild(barRow(`${c.k} · ${Math.round(c.v / catTot * 100)}%`, c.v, catMax, cc[c.k] || "var(--s1)"))); body.appendChild(c6);
    // machine vs machine
    const mc = el(`<div class="card"><div class="ct">Machine vs machine</div><div class="cs">Profit per day and fill right now</div></div>`); const mr = el(`<div class="rows"></div>`);
    d.machines.forEach(m => { const ks = m.slots.filter(s => s.cost != null); const pd = ks.reduce((a, s) => a + (s.perDay || 0), 0); const fill = Math.round(m.slots.reduce((a, s) => a + s.fillPct, 0) / (m.slots.length || 1)); mr.appendChild(el(`<div class="row"><div class="nm">${esc(m.name)}<div class="mt">${m.slots.length} slots · ${fill}% full</div></div><div class="val">$${pd.toFixed(2)}/d</div></div>`)); });
    mc.appendChild(mr); body.appendChild(mc);
  };
  return wrap;
}
