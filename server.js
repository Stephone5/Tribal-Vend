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
app.set("trust proxy", 1); // Render sits in front — needed to read the real client IP
app.use(express.json({ limit: "8mb" })); // 8mb: closet items carry photo data-URIs

// Security headers on every response. The app is fully self-hosted (no CDNs),
// so a tight CSP is safe: inline <script>/<style> are allowed (the app uses
// them), but externally-injected script, framing (clickjacking), and MIME
// sniffing are blocked.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; " +
    "form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    brainReady: !!process.env.ANTHROPIC_API_KEY,
    airvendReady: !!(process.env.AIRVEND_USER && process.env.AIRVEND_PASS),
    storeReady: storeReady(),
    locked: !!process.env.APP_PASSCODE
  });
});

// A simple per-IP rate limiter (in-memory; resets on restart).
const rlBuckets = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const ip = req.ip || "?", now = Date.now();
    const hits = (rlBuckets.get(ip) || []).filter(t => now - t < windowMs);
    if (hits.length >= max) return res.status(429).json({ error: "rate_limited", message: "Too many requests — give it a moment." });
    hits.push(now); rlBuckets.set(ip, hits);
    next();
  };
}

// Passcode gate + brute-force lockout. Everything under /api (except health)
// needs the X-Passcode header to match APP_PASSCODE. After too many wrong codes
// from one IP, that IP is blocked for a cooldown so a short code can't be ground
// down. If APP_PASSCODE isn't set, the app runs open (local dev only).
const pcFails = new Map(); // ip -> { count, until }
const PC_MAX = 10, PC_WINDOW = 15 * 60 * 1000;
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/") || req.path === "/api/health") return next();
  const pass = process.env.APP_PASSCODE;
  if (!pass) return next();
  const ip = req.ip || "?";
  const rec = pcFails.get(ip);
  if (rec && rec.until > Date.now()) {
    return res.status(429).json({ error: "locked_out", message: "Too many wrong passcodes — locked for a few minutes." });
  }
  if ((req.get("X-Passcode") || "") === pass) { pcFails.delete(ip); return next(); }
  // Wrong code: keep accumulating; only reset the counter if a PRIOR lock has
  // since expired (until>0 and past). A never-locked record (until=0) keeps its count.
  let r;
  if (!rec) r = { count: 0, until: 0 };
  else if (rec.until && rec.until <= Date.now()) r = { count: 0, until: 0 };
  else r = rec;
  r.count++;
  if (r.count >= PC_MAX) { r.until = Date.now() + PC_WINDOW; r.count = 0; }
  pcFails.set(ip, r);
  res.status(401).json({ error: "unauthorized", message: "Locked." });
});

// The two machines this account owns — AirVend writes are whitelisted to these.
const KNOWN_MACHINES = new Set(["69157", "69180"]);

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
app.post("/api/ask", rateLimit(20, 60 * 1000), async (req, res) => {
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
  // One-time: add the OK fridge-machine Sam's Club buys (order 1045 3481 805,
  // picked up Aug 31, plus the Sep 1/4/5 deliveries). Every line was Qty 1 at the
  // price actually paid. Adds onto matching items; new items created. Runs once.
  if (!(await getDoc(OK_BUY_KEY).catch(() => null))) {
    const items = doc.items || (doc.items = []);
    // Stephen: snacks and candy are at zero now (only the fridge machine is running).
    items.forEach(i => { if (i.folder === "Snacks" || i.folder === "Candy") i.qty = 0; });
    for (const b of OK_BUY_0831) {
      const hit = items.find(i => b.match.includes(String(i.name).trim().toLowerCase()));
      const unit = +(b.paid / b.units).toFixed(2);
      if (hit) { hit.qty = (Number(hit.qty) || 0) + b.units; hit.price = unit; if (b.rename) hit.name = b.rename; }
      else items.push({ id: b.id, folder: b.folder, name: b.name, price: unit, qty: b.units, min: 0, img: null });
    }
    if (!doc.countedAt || doc.countedAt < "2026-08-31") doc.countedAt = "2026-08-31";
    await setDoc(CLOSET_KEY, doc);
    await setDoc(OK_BUY_KEY, new Date().toISOString());
  }
  return doc;
}

const OK_BUY_KEY = "closet:okbuy-2026-08-31";
const OK_BUY_0831 = [
  { id: "OK0831-01", folder: "Snacks",    name: "Nissin Chow Mein",      match: ["nissin chow mein"], units: 8,  paid: 9.97 },
  { id: "OK0831-02", folder: "Cold Food", name: "Hot Pockets",           match: ["hot pockets"], units: 20, paid: 14.88 },
  { id: "OK0831-03", folder: "Cold Food", name: "Jimmy Dean SEC",        match: ["jimmy dean sec"], units: 12, paid: 11.73 },
  { id: "OK0831-04", folder: "Cold Food", name: "Uncrustables",          match: ["uncrustables"], units: 24, paid: 11.87 },
  { id: "OK0831-05", folder: "Drinks",    name: "Fiji Water",            match: ["fiji water"], units: 24, paid: 18.98 },
  { id: "OK0831-06", folder: "Drinks",    name: "Vitamin Water",         match: ["vitamin water"], units: 18, paid: 14.78 },
  { id: "OK0831-07", folder: "Drinks",    name: "AriZona Green Tea",     match: ["arizona green tea"], units: 24, paid: 10.78 },
  { id: "OK0831-08", folder: "Drinks",    name: "Coke",                  match: ["coke"], units: 24, paid: 15.98 },
  { id: "OK0831-09", folder: "Drinks",    name: "Dr Pepper",             match: ["dr pepper"], units: 24, paid: 15.98 },
  { id: "OK0831-10", folder: "Drinks",    name: "Sparkling ICE",         match: ["sparkling ice"], units: 24, paid: 17.98 },
  { id: "OK0831-11", folder: "Drinks",    name: "Pepsi",                 match: ["pepsi"], units: 24, paid: 15.68 },
  { id: "OK0831-12", folder: "Drinks",    name: "Gatorade",              match: ["gatorade blue", "gatorade"], rename: "Gatorade", units: 24, paid: 17.98 },
  { id: "OK0831-13", folder: "Drinks",    name: "Celsius",               match: ["celsius"], units: 18, paid: 17.98 },
  { id: "OK0831-14", folder: "Drinks",    name: "Red Bull",              match: ["red bull"], units: 24, paid: 42.48 },
  { id: "OK0831-15", folder: "Drinks",    name: "Coffee Monster",        match: ["coffee monster"], units: 12, paid: 25.98 },
  { id: "OK0831-16", folder: "Drinks",    name: "Gold Peak Zero Sweet Tea", match: ["gold peak zero sweet tea"], units: 18, paid: 16.98 },
  { id: "OK0831-17", folder: "Drinks",    name: "Mtn Dew",               match: ["mtn dew"], units: 24, paid: 15.68 },
  { id: "OK0831-18", folder: "Drinks",    name: "Arnold Palmer",         match: ["arnold palmer"], units: 24, paid: 10.78 },
  { id: "OK0831-19", folder: "Drinks",    name: "Black Rifle Coffee",    match: ["black rifle coffee"], units: 12, paid: 23.48 },
  { id: "OK0831-20", folder: "Drinks",    name: "Diet Mtn Dew",          match: ["diet mtn dew"], units: 24, paid: 15.68 },
  { id: "OK0831-21", folder: "Drinks",    name: "Monster",               match: ["monster"], units: 24, paid: 37.98 },
];

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

app.post("/api/generate", rateLimit(20, 60 * 1000), async (req, res) => {
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
  if (!KNOWN_MACHINES.has(String(machineId))) return res.status(400).json({ error: "bad_request", message: "Unknown machine." });
  try {
    const result = await writeOnHand(machineId, gapsToMissing(gaps), { dryRun: true });
    res.json(result);
  } catch (err) {
    console.error("airvend preview error:", err?.message || err);
    res.status(502).json({ error: "airvend_failed", message: err?.message || "Couldn't reach AirVend. Nothing was changed." });
  }
});

// Write (real) — actually posts the counts back to AirVend. Only fires on explicit confirm.
app.post("/api/airvend/write", rateLimit(20, 60 * 1000), async (req, res) => {
  const { machineId, gaps } = req.body || {};
  if (!KNOWN_MACHINES.has(String(machineId))) return res.status(400).json({ error: "bad_request", message: "Unknown machine." });
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
