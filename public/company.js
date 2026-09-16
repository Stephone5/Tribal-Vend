// Business view. A short screen of tappable cards; every card opens the detail.
// Paints instantly from the last saved numbers, then keeps pulling until the
// server has the newest data.

import { apiFetch } from "./api.js";
import { icon, sheet, confirmDialog, snackbar, pullToRefresh, expander, setTabSub, skel } from "./ui.js";
import { mountChart, axes } from "./charts.js";

const el = h => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const money = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const money2 = n => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shortName = s => String(s || "").replace(/^(Meals|Drinks|Crackers)\s*[-:]\s*/i, "").replace(/\s*\d+(\.\d+)?\s*(oz|fl oz|ct|count|-Ounce|piece|pk).*$/i, "").replace(/,.*$/, "").trim().slice(0, 26);
// The server stores them as UTC, so format in UTC to keep the clock AirVend shows.
const when = iso => new Date(iso).toLocaleString([], { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const hourLabel = (iso, h) => new Date(new Date(iso).getTime() + h * 3600e3).toLocaleString([], { timeZone: "UTC", weekday: "short", hour: "numeric" });

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parseMonth = m => { const [mo, yy] = String(m).split(" "); return { year: 2000 + (+yy), month: MON.indexOf(mo) }; };
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

const LIVE_LSK = "tv_live_cache_v3";
const FRESH_MS = 3 * 60 * 1000;   // numbers older than this get re-pulled
const AUTO_MS = 5 * 60 * 1000;    // while Business is on screen

// ---------- entry ----------
let ROOT = null, DATA = null, loadingNow = false, timer = null;
export async function renderCompany(root) {
  ROOT = root;
  pullToRefresh(root, () => refreshCompany(root));
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(LIVE_LSK)); } catch {}
  if (cached) paint(root, cached, true);
  else root.innerHTML = `${skel(180, 16)}${skel(300, 16)}${skel(96, 12)}${skel(96, 12)}${skel(96, 12)}`;
  await load(root, false, !!cached);
  if (!timer) {
    timer = setInterval(() => { if (ROOT && ROOT.isConnected && !ROOT.closest("[hidden]") && document.visibilityState === "visible") load(ROOT, false, true); }, AUTO_MS);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ROOT && DATA && Date.now() - DATA.at > FRESH_MS) load(ROOT, false, true); });
  }
}
export async function refreshCompany(root) {
  ROOT = root;
  const ok = await load(root, true, true);
  snackbar(ok ? "Numbers updated" : "Couldn't refresh. Showing your last numbers.");
}
// After a restock is sent: the server re-reads restock times; pull until it has.
export function companyAfterRestock() { if (ROOT) load(ROOT, false, true, DATA ? DATA.at : Date.now()); }

async function load(root, force, haveSomething, newerThan = 0) {
  if (loadingNow && !force) return true;
  loadingNow = true; setUpdating(root, true);
  try {
    // The server answers instantly with what it has and refreshes behind the
    // scenes, so ask again a few times until the numbers are current.
    for (let tries = 0; tries < 6; tries++) {
      const r = await apiFetch("/api/live" + (force && tries === 0 ? "?refresh=1" : ""));
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      const fresh = Date.now() - d.at < FRESH_MS && d.at > newerThan;
      if (!DATA || d.at !== DATA.at) {
        try { localStorage.setItem(LIVE_LSK, JSON.stringify(d)); } catch {}
        if (ROOT === root) paint(root, d, !fresh);
      }
      if (fresh) break;
      await new Promise(s => setTimeout(s, 5000));
    }
    return true;
  } catch (e) {
    if (!haveSomething) {
      root.innerHTML = `<div class="empty">${icon("warn")}Couldn't load your numbers.<br>Check your connection, then pull down to try again.</div>`;
      setTabSub("company", "Offline");
    }
    return false;
  } finally {
    loadingNow = false; setUpdating(root, false);
    if (DATA) setTabSub("company", `Updated ${new Date(DATA.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  }
}
function setUpdating(root, on) {
  root.querySelectorAll("[data-live]").forEach(n => n.classList.toggle("updating", on));
  if (on) setTabSub("company", "Updating…");
}

// ---------- paint ----------
function paint(root, d, stale) {
  DATA = d;
  const y = window.scrollY;
  root.innerHTML = "";
  healthBanners(root, d);
  root.appendChild(restockHero(d));

  root.appendChild(el(`<h2 class="sec-h">The money</h2>`));
  const pl = d.pl || [];
  if (pl.length) {
    const ytd = filterPL(pl, "ytd"), net = ytd.reduce((a, p) => a + p.net, 0), rev = ytd.reduce((a, p) => a + p.revenue, 0);
    root.appendChild(tapCard("Profit & loss", money(net), `kept this year on ${money(rev)} in sales`, () => plSheet(d)));
  }
  if (d.balanceSheet) {
    const L = d.loan || {};
    root.appendChild(tapCard("Balance sheet", money(d.balanceSheet.assets), `owned · ${money(L.balance || 0)} left on the loan${L.payoffMonth ? `, last payment ${L.payoffMonth}` : ""}`, () => balanceSheet(d)));
  }
  if (d.inventoryLoss) root.appendChild(tapCard("Inventory loss", money(d.inventoryLoss.loss), `lost · ${d.inventoryLoss.lossPct.toFixed(1)}% of what you bought`, () => lossSheet(d.inventoryLoss), true));

  productRows(root, d);

  const wrap = el(`<div style="display:flex;justify-content:center;margin-top:24px"></div>`);
  const b = el(`<button class="btn text inline">${icon("refresh")}Re-read everything from AirVend</button>`);
  b.onclick = confirmResync; wrap.appendChild(b); root.appendChild(wrap);

  setTabSub("company", stale ? "Updating…" : `Updated ${new Date(d.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  window.scrollTo(0, y);
}

function tapCard(title, value, sub, open, bad) {
  const c = el(`<button class="card tapcard" data-live>
    <div class="ct">${esc(title)}</div>
    <div class="money-v" ${bad ? 'style="color:var(--error)"' : ""}>${esc(value)}</div>
    <div class="money-s">${esc(sub)}</div>
    ${icon("chevron", "chev")}
  </button>`);
  c.onclick = open;
  return c;
}

// ---------- 1. sales since the last restock ----------
function restockHero(d) {
  const R = d.restock;
  if (!R || R.error) {
    const msg = R && R.error ? `Couldn't read restock times from AirVend: ${R.error}` : "No machine was restocked in the last 21 days.";
    return el(`<div class="hero" data-live><div class="k">Sales since restock</div><div class="sub" style="margin-top:8px">${esc(msg)}</div></div>`);
  }
  const cmp = R.pct == null
    ? "No earlier restocks to compare yet"
    : `${R.pct >= 0 ? "+" : ""}${R.pct.toFixed(0)}% vs your last ${R.priorCount} restocks at this point`;
  const h = el(`<button class="hero" data-live aria-label="Sales since restock, open the chart">
    <div class="k">Since restock · ${esc(when(R.restockedAt))}</div>
    <div class="v">${money2(R.revenue)}</div>
    <div class="row2"><b>${money2(R.profit)}</b><span>net profit</span></div>
    <div class="delta">${esc(cmp)}</div>
  </button>`);
  h.onclick = () => restockSheet(R);
  return h;
}

function restockSheet(R) {
  const body = el(`<div></div>`);
  R.machines.forEach(m => {
    const c = el(`<div class="card"><div class="ct">${esc(m.name)}</div><div class="cs">Restocked ${esc(when(m.restockedAt))} · ${m.units} sold</div><div></div></div>`);
    const labels = m.curve.map(p => hourLabel(m.restockedAt, p.h));
    const last = m.curve.length - 1;
    mountChart(c.lastChild, pal => ({
      ...axes(pal, labels),
      series: [
        { name: "This restock", type: "line", data: m.curve.map(p => p.c), showSymbol: false, smooth: .2, lineStyle: { width: 3, color: pal.primary }, areaStyle: { color: pal.primary, opacity: .12 } },
        ...(m.avg != null ? [{ name: "Average", type: "line", data: m.curve.map(p => p.a), showSymbol: false, smooth: .2, lineStyle: { width: 2, type: "dashed", color: pal.muted } }] : []),
      ],
    }), {
      height: 220, initial: last,
      readout: i => { const p = m.curve[i]; if (!p) return ""; const hrs = p.h;
        return `<b>${money2(p.c)}</b><span class="k"><i style="background:var(--primary)"></i>${esc(hourLabel(m.restockedAt, hrs))} · ${hrs < 48 ? Math.round(hrs * 10) / 10 + " hr" : (hrs / 24).toFixed(1) + " days"} in</span>${p.a != null ? `<span class="k"><i style="background:var(--on-surface-variant)"></i>avg ${money2(p.a)}</span>` : ""}`; },
    });
    body.appendChild(c);
    const tc = el(`<div class="card"><div class="ct">Top sellers since the restock</div><div class="rows"></div></div>`);
    topRows(tc.querySelector(".rows"), m.top);
    body.appendChild(tc);
    if (m.history.length > 1) {
      const H = m.history, hl = H.map(p => new Date(p.at).toLocaleDateString([], { month: "numeric", day: "numeric" }));
      const hc = el(`<div class="card"><div class="ct">Every restock</div><div class="cs">Touch a bar to read it, tap it for that restock's top sellers</div><div></div></div>`);
      mountChart(hc.lastChild, pal => ({
        ...axes(pal, hl),
        series: [{ type: "bar", data: H.map((p, i) => ({ value: +p.revenue.toFixed(2), itemStyle: { color: i === H.length - 1 ? pal.tertiary : pal.primary, borderRadius: [4, 4, 0, 0] } })), barMaxWidth: 18 }],
      }), {
        height: 200, initial: H.length - 1,
        readout: i => { const p = H[i]; if (!p) return ""; return `<b>${money2(p.revenue)} sales</b>${esc(when(p.at))}${i === H.length - 1 ? " (still going)" : ` · lasted ${p.days} days`} · ${money2(p.profit)} profit · ${p.units} sold`; },
        onTap: i => { const p = H[i]; const b = el(`<div class="rows"></div>`); topRows(b, p.top);
          sheet({ title: `Restock of ${hl[i]}`, sub: `${money2(p.revenue)} sales · ${money2(p.profit)} profit`, body: b }); },
      });
      body.appendChild(hc);
    }
  });
  sheet({
    title: "Since your last restock", sub: `${money2(R.revenue)} sales · ${money2(R.profit)} net profit`, body, full: true,
    info: "Counts every sale since your latest restock in AirVend. The percentage compares that to the same number of hours after each of your previous 4 restocks, whatever day they happened. It starts over each time you send a restock. The bars at the bottom are each whole restock, from that visit to the next one. A machine that hasn't been restocked in 21 days is left out.",
  });
}

function topRows(root, top) {
  if (!top.length) root.appendChild(el(`<div class="empty">No sales yet.</div>`));
  top.forEach((t, i) => root.appendChild(el(`<div class="row"><div class="nm">${i + 1}. ${esc(String(t.item).replace(/^(Meals|Drinks|Crackers)\s*[-:]\s*/i, ""))}<div class="mt">${t.units} sold · ${money2(t.profit)} profit</div></div><div class="val">${money2(t.revenue)}</div></div>`)));
}

// ---------- 3. profit & loss ----------
function plSheet(d) {
  const pl = d.pl || [];
  const wrap = el(`<div></div>`);
  const bar = el(`<div class="period-bar"></div>`);
  const host = el(`<div></div>`);
  const periods = [["lastmonth", "Last month"], ["ytd", "This year"], ["lastyear", "Last year"], ["all", "All time"]];
  let cur = "ytd";
  const draw = () => {
    host.innerHTML = "";
    const rows = filterPL(pl, cur), label = periods.find(p => p[0] === cur)[1];
    if (!rows.length) host.appendChild(el(`<div class="empty">No sales on record for ${label.toLowerCase()} yet.</div>`));
    else {
      if (rows.length > 1) {
        const cc = el(`<div class="card"><div class="ct">Net profit by month</div><div></div></div>`);
        mountChart(cc.lastChild, pal => ({
          ...axes(pal, rows.map(p => p.m)),
          series: [{ type: "bar", barMaxWidth: 22, data: rows.map(p => ({ value: Math.round(p.net), itemStyle: { color: p.net >= 0 ? pal.primary : pal.bad, borderRadius: 4 } })) }],
        }), {
          height: 190, initial: rows.length - 1,
          readout: i => { const p = rows[i]; return p ? `<b>${money2(p.net)} net</b>${esc(p.m)} · ${money(p.revenue)} sales · ${money(p.gross)} after product` : ""; },
        });
        host.appendChild(cc);
      }
      host.appendChild(plCard(rows, label, d));
    }
    [...bar.children].forEach((b, i) => b.classList.toggle("on", periods[i][0] === cur));
  };
  periods.forEach(([k, lab]) => { const b = el(`<button class="period-btn">${lab}</button>`); b.onclick = () => { cur = k; draw(); }; bar.appendChild(b); });
  wrap.append(bar, host);
  draw();
  if (d.salesTax) wrap.appendChild(salesTaxSection(d.salesTax));
  sheet({
    title: "Profit & loss", body: wrap, full: true,
    info: "Sales count when they happen, and product cost is matched to what sold, the same way QuickBooks does it. Monthly bills use today's rates until the bank is connected.",
  });
}

function plCard(pl, periodLabel, d) {
  const N = pl.length;
  const sum = k => pl.reduce((a, p) => a + (p[k] || 0), 0);
  const sales = sum("revenue"), cogs = sum("cogs"), gross = sum("gross");
  const loanInt = sum("loanInterest"), opFixed = sum("opFixed");
  const expenses = opFixed + loanInt, net = gross - expenses;
  const span = N === 1 ? pl[0].m : `${pl[0].m} – ${pl[N - 1].m}`;
  // A bill that ended counts only in the months it was paid.
  const monthsOf = c => c.endedAfter ? pl.filter(p => parseMonth(p.m).year * 12 + parseMonth(p.m).month <= parseMonth(c.endedAfter).year * 12 + parseMonth(c.endedAfter).month).length : N;
  const opLines = (d.allFixedCosts || d.fixedCosts || []).map(c => ({ name: c.name, amt: c.amount * monthsOf(c) })).filter(l => l.amt > 0);
  const c = el(`<div class="card"><div class="ct">Statement</div><div class="cs">${esc(periodLabel)} · ${esc(span)}</div></div>`);
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
  return c;
}

function salesTaxSection(tax) {
  const nextTxt = tax.next ? `Next: ${tax.next.label.replace(/·.*/, "").trim()} by ${new Date(tax.next.due + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" })}` : "All quarters filed";
  const x = expander({ title: `PA sales tax · ${tax.year}`, sub: esc(nextTxt), open: false, build: body => {
    const c = el(`<div class="card"><div class="ct">Estimated sales tax owed</div><div class="cs">On taxable drinks only · ${money2(tax.ytdTaxDue)} this year</div></div>`);
    const t = el(`<div class="qb"></div>`);
    tax.quarters.forEach(q => {
      const due = new Date(q.due + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
      const isNext = tax.next && q.q === tax.next.q;
      t.appendChild(el(`<div class="qb-l"><span>${esc(q.label)}<span class="qb-sub">${q.status === "past" ? "was due" : "file by"} ${due}${isNext ? " · next" : ""}</span></span><span>${money2(q.taxDue)}</span></div>`));
    });
    t.appendChild(el(`<div class="qb-h b tot"><span>Total ${tax.year}</span><span>${money2(tax.ytdTaxDue)}</span></div>`));
    c.appendChild(t);
    if (tax.taxableItems && tax.taxableItems.length) c.appendChild(el(`<p class="money-s" style="margin:12px 0 0">Taxed: ${esc(tax.taxableItems.slice(0, 6).map(i => shortName(i.item)).join(", "))}${tax.taxableItems.length > 6 ? ", …" : ""}. Estimate: taxable sales ÷ 1.06 × 0.06. Check before filing.</p>`));
    const go = el(`<a href="${esc(tax.fileUrl)}" target="_blank" rel="noopener" class="btn outlined" style="margin-top:12px">${icon("open")}File at myPATH</a>`);
    c.appendChild(go);
    body.appendChild(c);
  } });
  x.style.marginTop = "16px";
  return x;
}

// ---------- 4. balance sheet + loan ----------
function balanceSheet(d) {
  const b = d.balanceSheet, L = d.loan || {};
  const wrap = el(`<div></div>`);
  const inventory = b.inventory != null ? b.inventory : (b.closetInventory || 0);
  const c = el(`<div class="card"><div class="ct">What the business owns and owes</div><div class="cs">Cash as of ${esc(b.cashAsOf || "now")}</div></div>`);
  const t = el(`<div class="qb"></div>`);
  const grp = (label, val, bold) => t.appendChild(el(`<div class="qb-h ${bold ? "b" : ""}"><span>${esc(label)}</span><span>${money2(val)}</span></div>`));
  const line = (label, val, sub) => t.appendChild(el(`<div class="qb-l"><span>${esc(label)}${sub ? `<span class="qb-sub">${esc(sub)}</span>` : ""}</span><span>${money2(val)}</span></div>`));
  grp("Assets", b.assets, true);
  line("Cash in bank", b.cash);
  line("Product inventory", inventory, b.closetUnits ? `${b.closetUnits} units` : "");
  line("Machines", b.equipment, "depreciated value, matches your accountant");
  t.appendChild(el(`<div class="qb-h b tot"><span>Total assets</span><span>${money2(b.assets)}</span></div>`));
  grp("Liabilities", b.liabilities, true);
  line("Wendle loan", b.liabilities, L.source === "sheet" ? "from your loan sheet" : "");
  grp("Owner's equity", b.equity, true);
  t.appendChild(el(`<div class="qb-h b tot"><span>Liabilities + equity</span><span>${money2((b.liabilities || 0) + (b.equity || 0))}</span></div>`));
  c.appendChild(t);
  wrap.appendChild(c);

  const lc = el(`<div class="card"><div class="ct">Loan payoff</div><div class="cs"></div><div></div></div>`);
  const cs = lc.querySelector(".cs");
  if (L.payoffMonth) {
    cs.innerHTML = `<b style="color:var(--on-surface);font-weight:500">Final payment: ${esc(L.payoffMonth)}</b>, payment ${L.payoffN} (${money2(L.finalAmount)}). Paid through ${esc(L.paidThrough || "none yet")} · ${L.paymentsLeft} to go${L.behind > 0 ? ` · ${L.behind} behind` : ""}.`;
  }
  if (L.sheetError) lc.appendChild(el(`<div class="err-line">Couldn't read the loan sheet (${esc(L.sheetError)}). ${L.stale ? "Showing the last copy read." : "Showing the built-in schedule."}</div>`));
  if (L.schedule && L.schedule.length) {
    const S = L.schedule;
    const lastPaidI = S.reduce((a, s, i) => s.paid ? i : a, -1);
    mountChart(lc.children[2], pal => ({
      ...axes(pal, S.map(s => s.due.replace(/^(\w{3})\w*/, "$1"))),
      series: [
        { name: "Paid", type: "line", showSymbol: false, data: S.map((s, i) => i <= lastPaidI ? s.balance : null), lineStyle: { width: 3, color: pal.primary }, areaStyle: { color: pal.primary, opacity: .12 } },
        { name: "Scheduled", type: "line", showSymbol: false, data: S.map((s, i) => i >= lastPaidI ? s.balance : null), lineStyle: { width: 2, type: "dashed", color: pal.muted } },
      ],
    }), {
      height: 210, initial: Math.max(0, lastPaidI),
      readout: i => { const s = S[i]; if (!s) return ""; return `<b>${money2(s.balance)} left</b>Payment ${s.n} · ${esc(s.due)} · ${s.paid ? `paid${s.datePaid ? " " + esc(s.datePaid) : ""}` : "scheduled"} · ${money2(s.principal)} principal, ${money2(Math.max(0, s.interest))} interest`; },
    });
  }
  const open = el(`<a class="btn outlined" href="${esc(L.sheetUrl || "#")}" target="_blank" rel="noopener" style="margin-top:12px">${icon("open")}Open the loan sheet</a>`);
  lc.appendChild(open);
  wrap.appendChild(lc);

  sheet({
    title: "Balance sheet", body: wrap, full: true,
    info: "Owner's equity is everything the business owns minus the loan. It's negative early on because the loan is bigger than the machines' depreciated value, and it rises with every payment. The loan comes straight from your Google Sheet: a month counts as paid once its Amount Paid cell is filled in.",
  });
}

// ---------- 5. inventory loss ----------
function lossSheet(L) {
  const body = el(`<div></div>`);
  const c = el(`<div class="card"><div class="ct">Bought vs sold, at cost</div><div class="cs">The gap is what's on the shelf plus what was lost · through ${esc(L.through)}</div><div></div></div>`);
  const lbl = k => { const [y, m] = k.split("-"); return `${MON[+m - 1]} ${y.slice(2)}`; };
  mountChart(c.lastChild, pal => ({
    ...axes(pal, L.series.map(p => lbl(p.m))),
    series: [
      { name: "Bought", type: "line", showSymbol: false, data: L.series.map(p => Math.round(p.bought)), lineStyle: { width: 3, color: pal.bad } },
      { name: "Sold", type: "line", showSymbol: false, data: L.series.map(p => Math.round(p.sold)), lineStyle: { width: 3, color: pal.primary }, areaStyle: { color: pal.primary, opacity: .10 } },
    ],
  }), {
    height: 220, initial: L.series.length - 1,
    readout: i => { const p = L.series[i]; if (!p) return ""; return `<b>${money(p.bought - p.sold)} gap</b><span class="k"><i style="background:var(--error)"></i>bought ${money(p.bought)}</span><span class="k"><i style="background:var(--primary)"></i>sold ${money(p.sold)}</span> by ${lbl(p.m)}`; },
  });
  body.appendChild(c);
  const rows = el(`<div class="card"><div class="rows"></div></div>`), r = rows.firstChild;
  r.appendChild(el(`<div class="row"><div class="nm">Inventory bought<div class="mt">Sam's card + debit statements</div></div><div class="val">${money2(L.bought)}</div></div>`));
  r.appendChild(el(`<div class="row"><div class="nm">Cost of what sold</div><div class="val">${money2(L.sold)}</div></div>`));
  r.appendChild(el(`<div class="row"><div class="nm">Still on the shelf</div><div class="val">${money2(L.onHand)}</div></div>`));
  r.appendChild(el(`<div class="row"><div class="nm"><b>Lost</b><div class="mt">bought − sold − on the shelf</div></div><div class="val down"><b>${money2(L.loss)}</b></div></div>`));
  body.appendChild(rows);
  sheet({
    title: "Inventory loss", sub: `${money2(L.loss)} · ${L.lossPct.toFixed(1)}% of what you bought`, body, full: true,
    info: `Product you paid for that never became a sale: expired, damaged, eaten, or given away. Sold is valued at today's unit costs, which are higher than past years, so the real loss is likely a little more. It updates as new card statements come in. On the shelf today: ${money(L.currentOnHand)}.`,
  });
}

// ---------- 6. product lists ----------
function productRows(root, d) {
  const all = d.machines.flatMap(m => m.slots.map(s => ({ ...s, machine: m.name })));
  const known = all.filter(s => s.cost != null);
  const soldOut = known.filter(s => s.stockedOut && s.units > 0).sort((a, b) => b.unitsPerDay - a.unitsPerDay);
  const below = known.filter(s => s.belowCost);
  const byProd = {};
  known.forEach(s => { const k = shortName(s.product); (byProd[k] ||= { k, perDay: 0, units: 0 }); byProd[k].perDay += s.perDay; byProd[k].units += s.units; });
  const slow = Object.values(byProd).filter(p => p.units > 0).sort((a, b) => a.perDay - b.perDay).slice(0, 6);
  if (!soldOut.length && !below.length && !slow.length) return;
  root.appendChild(el(`<h2 class="sec-h">Products</h2>`));
  const card = el(`<div class="card" style="padding:0 16px"><div class="rows"></div></div>`), rows = card.firstChild;
  const add = (title, sub, open) => { const r = el(`<button class="row tap" style="width:100%;border:0;background:none;text-align:left;font:inherit"><div class="nm">${esc(title)}<div class="mt">${sub}</div></div>${icon("chevron")}</button>`); r.onclick = open; rows.appendChild(r); };
  if (soldOut.length) add("Sold out", `${soldOut.length} slot${soldOut.length === 1 ? "" : "s"} empty right now`, () => {
    const b = el(`<div class="rows"></div>`);
    soldOut.forEach(s => b.appendChild(el(`<div class="row"><div class="nm">${esc(shortName(s.product))}<div class="mt">${esc(s.machine)} · slot ${s.slot} · sells ${s.unitsPerDay.toFixed(2)}/day</div></div><div class="val">${(s.max / Math.max(s.unitsPerDay, .01)).toFixed(1)} days</div></div>`)));
    sheet({ title: "Sold out", sub: "Right side: how many days a full slot lasts", body: b });
  });
  if (below.length) add("Priced at or below cost", `<span style="color:var(--error)">${below.length} lose money on every sale</span>`, () => {
    const b = el(`<div class="rows"></div>`);
    const sh = sheet({ title: "Priced at or below cost", sub: "Tap one to fix its cost, or raise the price in AirVend", body: b });
    below.forEach(s => { const r = el(`<div class="row tap"><div class="nm">${esc(shortName(s.product))}<div class="mt">slot ${s.slot} · costs ${money2(s.cost)} · sells ${money2(s.price)}</div></div><div class="val down">${money2(s.marginEach)}</div></div>`); r.onclick = () => { sh.close(); setTimeout(() => editCost({ product: s.product, price: s.price, cost: s.cost }, ROOT), 240); }; b.appendChild(r); });
  });
  if (slow.length) add("Slowest sellers", "Least profit per day, ones to swap out", () => {
    const b = el(`<div class="rows"></div>`);
    slow.forEach(p => b.appendChild(el(`<div class="row"><div class="nm">${esc(p.k)}<div class="mt">${p.units} sold</div></div><div class="val">$${p.perDay.toFixed(2)}/day</div></div>`)));
    sheet({ title: "Slowest sellers", sub: "Profit per day at today's prices", body: b });
  });
  root.appendChild(card);
}

// ---------- re-read AirVend ----------
async function confirmResync() {
  const ok = await confirmDialog({
    title: "Re-read everything from AirVend?",
    body: "Only needed after you change something in AirVend itself, like a par, a price, or a swapped product. It replaces the app's pars, prices and on-hand counts with what AirVend has now. Your inventory and cost corrections aren't touched.",
    confirm: "Re-read",
  });
  if (!ok) return;
  snackbar("Reading AirVend…");
  try { if (window.tvResyncAirVend) await window.tvResyncAirVend(); snackbar("Everything re-read from AirVend"); }
  catch (_) { snackbar("Couldn't reach AirVend. Nothing changed."); }
}

// ---------- alerts ----------
function healthBanners(root, d) {
  const issues = (d.audit && d.audit.issues) || [];
  const wrap = el(`<div id="tv-health"></div>`);
  root.appendChild(wrap);
  const below = issues.find(i => i.code === "below_cost");
  const unknown = issues.find(i => i.code === "unknown_costs");
  const est = issues.find(i => i.code === "estimated_costs");
  const broke = issues.find(i => i.code === "machine_unreachable" || i.code === "no_sales");
  const banner = (text, onClick) => {
    const b = el(`<button class="alert">${icon("warn")}<span class="a-t">${text}</span>${icon("chevron")}</button>`);
    b.onclick = onClick; wrap.appendChild(b);
  };
  const items = [];
  if (broke) items.push({ text: `<b>${esc(broke.title)}.</b> Tap to try again.`, go: () => refreshCompany(root) });
  if (below) items.push({ text: `<b>${esc(shortName(below.product || "A product"))} is priced at or below cost.</b> Raise it in AirVend, or fix the cost.`, go: () => editCost({ product: below.product, price: null, cost: null }, root) });
  if (unknown) items.push({ text: `<b>${unknown.products.length} product${unknown.products.length === 1 ? "" : "s"} missing a cost.</b> Left out of profit until set.`, go: () => costChooser(unknown.products, root) });
  if (est) items.push({ text: `${est.products.length} cost${est.products.length === 1 ? " is an estimate" : "s are estimates"}, not from your records.`, go: () => costChooser(est.products, root) });
  if (items.length === 1) banner(items[0].text, items[0].go);
  else if (items.length > 1) banner(`<b>${items.length} things need a look</b>`, () => {
    const list = el(`<div class="rows"></div>`);
    const sh = sheet({ title: "Needs a look", body: list });
    items.forEach(it => { const r = el(`<div class="row tap"><div class="nm" style="font-size:14px;line-height:20px">${it.text}</div>${icon("chevron")}</div>`); r.onclick = () => { sh.close(); setTimeout(it.go, 240); }; list.appendChild(r); });
  });
}

// ---------- cost correction ----------
function costChooser(products, root) {
  const rows = el(`<div class="rows"></div>`);
  const sh = sheet({ title: "Set the real costs", sub: "Tap a product and enter what you pay per unit.", body: rows });
  products.forEach(p => {
    const row = el(`<div class="row tap"><div class="nm">${esc(shortName(p.product))}<div class="mt">${p.cost == null ? "No cost set" : "Estimated " + money2(p.cost)}${p.price ? " · sells " + money2(p.price) : ""}</div></div>${icon("chevron")}</div>`);
    row.onclick = () => { sh.close(); setTimeout(() => editCost(p, root), 240); };
    rows.appendChild(row);
  });
}
function editCost(p, root) {
  const body = el(`<div>
    <div class="field"><label for="cst">Cost per unit</label><input id="cst" type="text" inputmode="decimal" value="${p.cost != null ? p.cost : ""}" placeholder="0.00"></div>
    <div class="t-body-s" id="cerr" role="alert" style="color:var(--error);min-height:16px;margin:4px 4px 0"></div>
  </div>`);
  const inp = body.querySelector("#cst"), err = body.querySelector("#cerr");
  const sh = sheet({
    title: shortName(p.product), sub: p.price ? `Sells for ${money2(p.price)}` : "", body,
    actions: [
      { label: "Cancel", kind: "outlined", onClick: (b, s) => s.close() },
      { label: "Save cost", kind: "filled", onClick: async (btn, s) => {
        const v = parseFloat(inp.value);
        if (isNaN(v) || v < 0) { err.textContent = "Enter a number, like 0.79"; inp.focus(); return; }
        btn.disabled = true; btn.textContent = "Saving…";
        try {
          const r = await apiFetch("/api/costs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product: p.product, cost: v }) });
          if (!r.ok) throw new Error();
          s.close(); snackbar("Cost saved");
          await load(root, true, true);
        } catch (e) { err.textContent = "Couldn't save. Check your connection and try again."; btn.disabled = false; btn.textContent = "Save cost"; }
      } },
    ],
  });
  setTimeout(() => inp.focus(), 300);
  inp.onkeydown = e => { if (e.key === "Enter") sh.footer.querySelector(".btn.filled").click(); };
}
