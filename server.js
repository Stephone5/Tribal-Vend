// Tribal Vend server. Serves the phone app and exposes the brain over /api.
// The API key lives only in the environment here — the phone talks to this server,
// this server talks to Claude. The key never reaches the browser.

import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { runBrain, askBrain } from "./brain.js";
import { writeOnHand, getMachineLive } from "./airvend.js";
import { costFor, costInfo, setCostOverrides, categoryFor, SOLD_BY_SLOT, SALES_WINDOW, MONTHLY, FIXED_COSTS, buildPL } from "./catalog.js";
import { CLOSET_SEED } from "./closet-seed.js";
import { auditData } from "./audit.js";
import { LOAN, loanStatus } from "./loan.js";
import { pullSales, summarize, startOfWeek, easternNow } from "./sales.js";
import { getDoc, setDoc, storeReady } from "./store.js";
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

async function getSales(force = false) {
  if (!force && salesCache.sum && Date.now() - salesCache.at < SALES_TTL) return salesCache.sum;
  const end = new Date();
  const start = new Date(Date.now() - SALES_LOOKBACK_DAYS * 864e5);
  const txns = await pullSales(start, end);
  const sum = summarize(txns, costFor);
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

  return {
    machines,
    sales: sales ? {
      thisWeek: sales.thisWeek, lastWeek: sales.lastWeek,
      thisMonth: sales.thisMonth, lastMonth: sales.lastMonth,
      weekStart: sales.weekStart, weeks: sales.weeks, days: sales.days,
      byDow: sales.byDow, byHour: sales.byHour, byItem: sales.byItem.slice(0, 40),
      txnCount: sales.txnCount, spanDays: Math.round(spanDays),
      freshAt: salesCache.at,
    } : null,
    window: SALES_WINDOW, monthly: MONTHLY, fixedCosts: FIXED_COSTS,
    pl: buildPL(), loan: loanStatus(), at: Date.now(),
  };
}

app.get("/api/live", async (req, res) => {
  try {
    const force = req.query.refresh === "1";
    if (!force && liveCache.data && Date.now() - liveCache.at < INV_TTL) return res.json(liveCache.data);
    const data = await buildLive(force);
    liveCache = { at: Date.now(), data };
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
app.get("/api/closet", async (_req, res) => {
  try {
    let doc = await getDoc(CLOSET_KEY);
    // First run on a fresh install: load the Sortly import so the closet isn't empty.
    if (!doc || !Array.isArray(doc.items) || doc.items.length === 0) {
      doc = JSON.parse(JSON.stringify(CLOSET_SEED));
      await setDoc(CLOSET_KEY, doc);
    }
    res.json(doc);
  } catch (err) { res.status(502).json({ error: "store_failed", message: err?.message || "Storage read failed." }); }
});
app.put("/api/closet", async (req, res) => {
  try { await setDoc(CLOSET_KEY, req.body || { items: [], hist: [] }); res.json({ ok: true }); }
  catch (err) { res.status(502).json({ error: "store_failed", message: err?.message || "Storage write failed." }); }
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
});
