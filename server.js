// Tribal Vend server. Serves the phone app and exposes the brain over /api.
// The API key lives only in the environment here — the phone talks to this server,
// this server talks to Claude. The key never reaches the browser.

import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { runBrain, askBrain } from "./brain.js";
import { writeOnHand, getMachineLive } from "./airvend.js";
import { costFor, costInfo, setCostOverrides, categoryFor, seasonCategoryFor, SOLD_BY_SLOT, SALES_WINDOW, MONTHLY, FIXED_COSTS, buildPL, INVENTORY_PURCHASES, INVENTORY_ON_HAND_MAY26, PURCHASE_DATA_THROUGH } from "./catalog.js";
import { CLOSET_SEED } from "./closet-seed.js";
import { auditData } from "./audit.js";
import { LOAN, loanStatus } from "./loan.js";
import { pullSales, pullSalesRange, summarize, startOfWeek, easternNow } from "./sales.js";
import { getDoc, setDoc, storeReady } from "./store.js";
import { salesTaxReport } from "./salestax.js";
import { SLOTS, WINDOW_LABEL } from "./finance.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    brainReady: !!process.env.ANTHROPIC_API_KEY,
    airvendReady: !!(process.env.AIRVEND_USER && process.env.AIRVEND_PASS),
    storeReady: storeReady(),
    locked: !!process.env.APP_PASSCODE
  });
});

// Passcode gate. Everything under /api (except /api/health) requires the
// X-Passcode header to match APP_PASSCODE. If APP_PASSCODE isn't set, the app
// runs open (fine for local dev; set it in production).
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/") || req.path === "/api/health") return next();
  const pass = process.env.APP_PASSCODE;
  if (!pass) return next();
  if ((req.get("X-Passcode") || "") === pass) return next();
  res.status(401).json({ error: "unauthorized", message: "Locked." });
});

// Financial data — behind the passcode (never in the public app code).
app.get("/api/finance", (_req, res) => {
  res.json({ monthly: MONTHLY, fixedCosts: FIXED_COSTS, slots: SLOTS, loan: loanStatus(), loanSchedule: LOAN, windowLabel: WINDOW_LABEL });
});

// ---- Live business data: real planogram + prices from AirVend, real costs,
// real velocity, real P&L. Cached briefly so the app feels instant.
const MACHINES = [
  { id: "69157", name: "Meals & Drinks" },
  { id: "69180", name: "Snacks & Candy" },
];
// Inventory refreshes every 10 minutes (well inside the half-hour you asked for);
// sales every 15. Both refresh on demand with ?refresh=1.
const INV_TTL = 10 * 60 * 1000;
const SALES_TTL = 15 * 60 * 1000;
const SALES_LOOKBACK_DAYS = 120;

let liveCache = { at: 0, data: null };
let salesCache = { at: 0, sum: null };

// Full history since the first sale. The old part never changes, so it's pulled
// once and kept; only the recent window is re-pulled on the normal cadence.
const HISTORY_START = new Date("2024-09-01");
const RECENT_DAYS = 60;
let historyCache = { at: 0, txns: null };

// Units sold per category per month — the seasonality decomposition the CEO
// chat needs to answer "does energy carry winter, do chips carry summer".
const SEASON_CATS = ["energy", "soda", "sports/water", "cold food", "chips", "candy", "pastry", "other"];
function monthlyByCategory(txns) {
  const byMonth = {};
  for (const t of txns) {
    const k = `${t.when.getFullYear()}-${String(t.when.getMonth() + 1).padStart(2, "0")}`;
    (byMonth[k] ||= Object.fromEntries(SEASON_CATS.map(c => [c, 0])));
    byMonth[k][seasonCategoryFor(t.item)] += 1;
  }
  return Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([m, cats]) => ({ m, ...cats }));
}

async function getSales(force = false) {
  if (!force && salesCache.sum && Date.now() - salesCache.at < SALES_TTL) return salesCache.sum;

  const cutoff = new Date(Date.now() - RECENT_DAYS * 864e5);

  // Archive: everything older than the recent window. Refreshed daily at most.
  if (!historyCache.txns || Date.now() - historyCache.at > 24 * 60 * 60 * 1000) {
    try {
      historyCache = { at: Date.now(), txns: await pullSalesRange(HISTORY_START, cutoff) };
    } catch (e) {
      if (!historyCache.txns) historyCache = { at: Date.now(), txns: [] };
    }
  }

  const recent = await pullSalesRange(cutoff, new Date());
  const seen = new Set();
  const all = [];
  for (const r of [...(historyCache.txns || []), ...recent]) {
    const k = `${r.when.getTime()}|${r.machine}|${r.slot}|${r.amount}`;
    if (seen.has(k)) continue;
    seen.add(k); all.push(r);
  }
  all.sort((a, b) => a.when - b.when);

  const sum = summarize(all, costFor);
  sum.salesTax = salesTaxReport(all, 2026);
  sum.monthlyByCategory = monthlyByCategory(all);
  salesCache = { at: Date.now(), sum };
  return sum;
}

async function buildLive(force = false) {
  if (!costsLoaded) await loadCostOverrides();
  // Live sales — falls back to the last good pull if AirVend's report engine hiccups.
  let sales = null;
  try { sales = await getSales(force); } catch (e) { sales = salesCache.sum; }

  const soldBySlot = {};
  if (sales) for (const s of sales.bySlot) {
    const mid = MACHINES.find(m => m.name === s.machine)?.id;
    if (!mid) continue;
    (soldBySlot[mid] ||= {})[s.slot] = s;
  }

  // Real observed window: first transaction → now
  const spanDays = sales && sales.days.length
    ? Math.max(1, (Date.now() - new Date(sales.days[0].d).getTime()) / 864e5)
    : SALES_WINDOW.days;

  const machines = [];
  for (const m of MACHINES) {
    let slots = [];
    try { slots = await getMachineLive(m.id); } catch (e) { slots = []; }
    const live = soldBySlot[m.id] || {};
    const fallback = SOLD_BY_SLOT[m.id] || {};
    const rows = slots.map(s => {
      const cost = costFor(s.product);
      const rec = live[s.slot];
      const units = rec ? rec.units : (fallback[s.slot] ?? 0);
      const ci = costInfo(s.product);
      // marginEach uses the CURRENT price — this is forward-looking economics.
      const marginEach = cost == null ? null : s.price - cost;
      // Historical profit is what actually happened, at whatever price was set then.
      const profit = rec ? rec.profit : (marginEach == null ? null : marginEach * units);
      // Realized average price tells us whether the price has changed since.
      const avgPrice = rec && rec.units ? rec.revenue / rec.units : null;
      const priceChanged = avgPrice != null && Math.abs(avgPrice - s.price) > 0.05;
      const perDay = units / spanDays;                       // units/day velocity
      const forwardPerDay = marginEach == null ? null : marginEach * perDay; // $/day at today's price
      return {
        slot: s.slot, product: s.product, price: s.price, cost,
        costSource: ci.source,
        onHand: s.onHand, max: s.max, units,
        week: rec ? rec.week : 0, prevWeek: rec ? rec.prevWeek : 0,
        category: categoryFor(s.product),
        marginEach, profit,
        avgPrice, priceChanged,
        unitsPerDay: perDay,
        perDay: forwardPerDay,                                // what the slot earns going forward
        histPerDay: profit == null ? null : profit / spanDays, // what it earned historically
        fillPct: s.max ? Math.round((s.onHand / s.max) * 100) : 0,
        belowCost: marginEach != null && marginEach <= 0,
        stockedOut: s.onHand === 0,
      };
    });
    machines.push({ ...m, slots: rows });
  }

  // Balance sheet — what the business owns vs owes, right now. Uses loadCloset()
  // (seeds if needed) so your closet inventory is ALWAYS counted, even if the
  // Inventory tab hasn't been opened yet this session.
  const closet = await loadCloset().catch(() => null);
  const cItems = (closet && closet.items) || [];
  const closetInventory = cItems.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
  const closetUnits = cItems.reduce((a, i) => a + (Number(i.qty) || 0), 0);
  // Inventory = the Sortly count and NOTHING else. Stephen updates Sortly at
  // every fill, so its 810 units / $591.20 already covers BOTH the machines and
  // the closet. Adding AirVend's machine on-hand on top of it double-counts —
  // that was the $730.90 bug.
  const inventory = closetInventory;
  const bank = MONTHLY[MONTHLY.length - 1] || {};
  const loan = loanStatus();
  // Equipment at NET BOOK VALUE (MACRS-depreciated), matching Stephen's real
  // accountant balance sheet — cost basis $11,738 less accumulated depreciation
  // (Yr1 $2,348 + Yr2 $3,756) = $5,634 as of the 2025 filing. This is why real
  // owner equity is negative early in the loan. NOT original cost ($13k) — that
  // overstated net worth.
  const equipment = 5634;
  const assets = (bank.balance || 0) + inventory + equipment;
  const balanceSheet = {
    cash: bank.balance || 0, cashAsOf: bank.m || "",
    inventory, closetInventory, closetUnits, equipment,
    assets, loanBalance: loan.balance, liabilities: loan.balance,
    equity: assets - loan.balance,
  };

  // ---- Inventory loss: bought − sold(at cost) − ending inventory, over the
  // closed window the bank/card data covers (through May 26). Cumulative series
  // drives the live chart. Recomputes every pull; extends when newer statements land.
  const MON3 = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const toKey = lbl => { const [mo, yy] = lbl.split(" "); return `20${yy}-${String(MON3.indexOf(mo)+1).padStart(2,"0")}`; };
  const purchByKey = {}; INVENTORY_PURCHASES.forEach(p => { purchByKey[toKey(p.m)] = p.amount; });
  const soldByKey = {}; if (sales) sales.months.forEach(m => { soldByKey[m.m] = m.revenue - m.profit; });
  const lossMonths = [];
  for (let y = 2024, mo = 9; ;) {
    const k = `${y}-${String(mo).padStart(2,"0")}`; lossMonths.push(k);
    if (k === PURCHASE_DATA_THROUGH) break;
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  let cb = 0, cs = 0;
  const lossSeries = lossMonths.map(k => { cb += purchByKey[k] || 0; cs += soldByKey[k] || 0; return { m: k, bought: cb, sold: cs }; });
  const boughtTotal = cb, soldTotal = cs;
  const lossValue = boughtTotal - soldTotal - INVENTORY_ON_HAND_MAY26;
  const inventoryLoss = {
    bought: boughtTotal, sold: soldTotal, onHand: INVENTORY_ON_HAND_MAY26,
    loss: lossValue, lossPct: boughtTotal ? (lossValue / boughtTotal) * 100 : 0,
    series: lossSeries, through: "May 2026", currentOnHand: inventory,
  };

  const payload = {
    machines,
    sales: sales ? {
      thisWeek: sales.thisWeek, lastWeek: sales.lastWeek,
      thisMonth: sales.thisMonth, lastMonth: sales.lastMonth,
      weekStart: sales.weekStart, weeks: sales.weeks, days: sales.days,
      byDow: sales.byDow, byHour: sales.byHour, byItem: sales.byItem.slice(0, 40),
      months: sales.months, monthlyByCategory: sales.monthlyByCategory, firstSale: sales.firstSale,
      txnCount: sales.txnCount, spanDays: Math.round(spanDays),
      freshAt: salesCache.at,
    } : null,
    window: SALES_WINDOW, monthly: MONTHLY, fixedCosts: FIXED_COSTS,
    pl: buildPL(sales?.months), loan, balanceSheet, inventoryLoss, salesTax: sales?.salesTax || null, at: Date.now(),
  };
  try { payload.audit = auditData(payload, closet); }
  catch (e) { payload.audit = { issues: [], counts: { critical: 0, warning: 0, info: 0 } }; }
  return payload;
}

// Stale-while-revalidate: if we have any cached data, return it INSTANTLY and
// refresh in the background when it's stale. Only a truly cold cache blocks.
// Concurrent requests share one in-flight build so we never pull twice at once.
let liveBuilding = null;
function refreshLive(force = false) {
  if (liveBuilding) return liveBuilding;
  liveBuilding = buildLive(force)
    .then(d => { liveCache = { at: Date.now(), data: d }; return d; })
    .finally(() => { liveBuilding = null; });
  return liveBuilding;
}

app.get("/api/live", async (req, res) => {
  const force = req.query.refresh === "1";
  if (liveCache.data && !force) {
    const stale = Date.now() - liveCache.at >= INV_TTL;
    if (stale) refreshLive().catch(() => {}); // fire and forget
    return res.json(liveCache.data);
  }
  try {
    const data = await refreshLive(force);
    res.json(data);
  } catch (err) {
    if (liveCache.data) return res.json({ ...liveCache.data, stale: true });
    res.status(502).json({ error: "live_failed", message: err?.message || "Couldn't reach AirVend." });
  }
});

// ---- Data health: catch wrong/misleading numbers before they mislead you ----
const COSTS_KEY = "costs:overrides";
let costsLoaded = false;
async function loadCostOverrides() {
  try {
    const o = await getDoc(COSTS_KEY);
    setCostOverrides(o || {});
    costsLoaded = true;
  } catch (e) { /* keep whatever is in memory */ }
}

app.get("/api/audit", async (_req, res) => {
  try {
    if (!costsLoaded) await loadCostOverrides();
    const live = (liveCache.data && Date.now() - liveCache.at < INV_TTL)
      ? liveCache.data
      : await buildLive().then(d => { liveCache = { at: Date.now(), data: d }; return d; });
    const closet = await getDoc(CLOSET_KEY).catch(() => null);
    res.json(auditData(live, closet));
  } catch (err) {
    res.status(502).json({ error: "audit_failed", message: err?.message || "Couldn't run the data check." });
  }
});

// Your own costs — these override anything I estimated, permanently.
app.get("/api/costs", async (_req, res) => {
  try { res.json(await getDoc(COSTS_KEY) || {}); }
  catch (err) { res.status(502).json({ error: "store_failed", message: err?.message }); }
});
app.put("/api/costs", async (req, res) => {
  try {
    const cur = (await getDoc(COSTS_KEY)) || {};
    const { product, cost } = req.body || {};
    if (!product) return res.status(400).json({ error: "bad_request", message: "No product given." });
    const key = String(product).toLowerCase();
    if (cost == null || cost === "") delete cur[key];
    else cur[key] = { cost: Number(cost), at: Date.now() };
    await setDoc(COSTS_KEY, cur);
    setCostOverrides(cur);
    liveCache = { at: 0, data: null }; // recompute margins with the corrected cost
    res.json({ ok: true, costs: cur });
  } catch (err) {
    res.status(502).json({ error: "store_failed", message: err?.message });
  }
});

// ---- Ask: talk to the brain with the whole business in context ----
app.post("/api/ask", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "no_key", message: "The brain isn't connected — no API key on the server." });
  }
  try {
    const [live, closet] = await Promise.all([
      (liveCache.data && Date.now() - liveCache.at < INV_TTL) ? liveCache.data : buildLive().then(d => { liveCache = { at: Date.now(), data: d }; return d; }),
      getDoc(CLOSET_KEY).catch(() => null),
    ]);
    const reply = await askBrain(req.body?.messages || [], live, closet);
    res.json({ reply });
  } catch (err) {
    console.error("ask error:", err?.message || err);
    res.status(502).json({ error: "ask_failed", message: err?.message || "The brain hit an error." });
  }
});

// Closet (inventory) — durable, synced across devices.
const CLOSET_KEY = "closet:default";
const SEEDVER_KEY = "closet:seedver";
// Bump this string whenever the seed should be force-loaded over the stored
// closet (a fresh reload from Sortly). It only fires once per new value — after
// that, your own edits persist untouched.
const SEED_VERSION = "2026-08-01-full-41";

// Single source of truth for reading the closet — seeds on first run or once
// when SEED_VERSION changes. The balance sheet uses this too, so machine +
// closet inventory always ties out no matter which endpoint is hit first.
async function loadCloset() {
  let doc = await getDoc(CLOSET_KEY).catch(() => null);
  const ver = await getDoc(SEEDVER_KEY).catch(() => null);
  const empty = !doc || !Array.isArray(doc.items) || doc.items.length === 0;
  if (empty || ver !== SEED_VERSION) {
    doc = JSON.parse(JSON.stringify(CLOSET_SEED));
    await setDoc(CLOSET_KEY, doc);
    await setDoc(SEEDVER_KEY, SEED_VERSION);
  }
  return doc;
}

// Default count date — the last fill/count when the 810 was taken. Any in-app
// save updates it to that day (a fresh recount resets the baseline).
const DEFAULT_COUNT_DATE = "2026-07-27";

app.get("/api/closet", async (_req, res) => {
  try {
    const doc = await loadCloset();
    const baseline = (doc.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0);
    const countedAt = doc.countedAt || DEFAULT_COUNT_DATE;
    // Live count = what you counted at the last fill, minus every unit AirVend
    // has rung up since. Only drops between fills; resets when you recount.
    let soldSince = 0, haveSales = false;
    try {
      const sales = await getSales();
      soldSince = (sales.days || []).filter(day => day.d > countedAt).reduce((a, day) => a + (day.units || 0), 0);
      haveSales = true;
    } catch (e) { /* fall back to the static count if the sales feed is down */ }
    doc.live = haveSales
      ? { baseline, countedAt, soldSince, liveUnits: Math.max(0, baseline - soldSince) }
      : null;
    res.json(doc);
  } catch (err) { res.status(502).json({ error: "store_failed", message: err?.message || "Storage read failed." }); }
});
app.put("/api/closet", async (req, res) => {
  try {
    const doc = req.body || { items: [], hist: [] };
    doc.countedAt = new Date().toISOString().slice(0, 10); // saving = a fresh recount → reset the baseline
    await setDoc(CLOSET_KEY, doc);
    res.json({ ok: true });
  } catch (err) { res.status(502).json({ error: "store_failed", message: err?.message || "Storage write failed." }); }
});

app.post("/api/generate", async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({
      error: "no_key",
      message: "The brain isn't connected yet — no API key on the server. Add ANTHROPIC_API_KEY to the .env file and restart."
    });
  }
  try {
    const result = await runBrain(req.body || {});
    res.json(result);
  } catch (err) {
    console.error("brain error:", err?.message || err);
    res.status(502).json({
      error: "brain_failed",
      message: err?.message || "The brain hit an error. Nothing was changed."
    });
  }
});

// AirVend: turn the reported short slots into a per-slot "missing" map.
// Each entry is how many units are missing from that slot; every slot not
// listed is assumed full to par.
function gapsToMissing(gaps) {
  const map = {};
  for (const g of gaps || []) {
    if (g && g.slot != null && g.missing != null && !isNaN(Number(g.missing))) map[String(g.slot)] = Number(g.missing);
  }
  return map;
}

// Preview (dry run) — logs in and reads the live form, changes NOTHING, returns the from→to plan.
app.post("/api/airvend/preview", async (req, res) => {
  const { machineId, gaps } = req.body || {};
  if (!machineId) return res.status(400).json({ error: "bad_request", message: "No machine specified." });
  try {
    const result = await writeOnHand(machineId, gapsToMissing(gaps), { dryRun: true });
    res.json(result);
  } catch (err) {
    console.error("airvend preview error:", err?.message || err);
    res.status(502).json({ error: "airvend_failed", message: err?.message || "Couldn't reach AirVend. Nothing was changed." });
  }
});

// Write (real) — actually posts the counts back to AirVend. Only fires on explicit confirm.
app.post("/api/airvend/write", async (req, res) => {
  const { machineId, gaps } = req.body || {};
  if (!machineId) return res.status(400).json({ error: "bad_request", message: "No machine specified." });
  try {
    const result = await writeOnHand(machineId, gapsToMissing(gaps), { dryRun: false });
    res.json(result);
  } catch (err) {
    console.error("airvend write error:", err?.message || err);
    res.status(502).json({ error: "airvend_failed", message: err?.message || "AirVend rejected the update. Nothing was changed." });
  }
});

// Serve the phone app. Only the public/ folder is exposed — never .env or server code.
app.use(express.static(path.join(__dirname, "public")));

const port = process.env.PORT || 8123;
app.listen(port, () => {
  const ready = process.env.ANTHROPIC_API_KEY ? "brain CONNECTED" : "brain not connected (no key yet)";
  console.log(`Tribal Vend on http://localhost:${port} — ${ready}`);
  // Warm the cache on startup so the first real open is instant.
  loadCostOverrides().then(() => refreshLive()).catch(() => {});
});
