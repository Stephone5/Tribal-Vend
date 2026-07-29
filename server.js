// Tribal Vend server. Serves the phone app and exposes the brain over /api.
// The API key lives only in the environment here — the phone talks to this server,
// this server talks to Claude. The key never reaches the browser.

import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { runBrain } from "./brain.js";
import { writeOnHand, getMachineLive } from "./airvend.js";
import { costFor, categoryFor, SOLD_BY_SLOT, SALES_WINDOW, MONTHLY, FIXED_COSTS, buildPL } from "./catalog.js";
import { CLOSET_SEED } from "./closet-seed.js";
import { getDoc, setDoc, storeReady } from "./store.js";
import { SLOTS, LOAN, WINDOW_LABEL } from "./finance.js";

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
  res.json({ monthly: MONTHLY, fixedCosts: FIXED_COSTS, slots: SLOTS, loan: LOAN, windowLabel: WINDOW_LABEL });
});

// ---- Live business data: real planogram + prices from AirVend, real costs,
// real velocity, real P&L. Cached briefly so the app feels instant.
const MACHINES = [
  { id: "69157", name: "Meals & Drinks" },
  { id: "69180", name: "Snacks & Candy" },
];
let liveCache = { at: 0, data: null };

async function buildLive() {
  const machines = [];
  for (const m of MACHINES) {
    let slots = [];
    try { slots = await getMachineLive(m.id); } catch (e) { slots = []; }
    const sold = SOLD_BY_SLOT[m.id] || {};
    const rows = slots.map(s => {
      const cost = costFor(s.product);
      const units = sold[s.slot] ?? 0;
      const marginEach = cost == null ? null : s.price - cost;
      return {
        slot: s.slot, product: s.product, price: s.price, cost,
        onHand: s.onHand, max: s.max, units,
        category: categoryFor(s.product),
        marginEach,
        profit: marginEach == null ? null : marginEach * units,
        perDay: marginEach == null ? null : (marginEach * units) / SALES_WINDOW.days,
        fillPct: s.max ? Math.round((s.onHand / s.max) * 100) : 0,
        belowCost: marginEach != null && marginEach <= 0,
      };
    });
    machines.push({ ...m, slots: rows });
  }
  return { machines, window: SALES_WINDOW, monthly: MONTHLY, fixedCosts: FIXED_COSTS, pl: buildPL(), loan: LOAN, at: Date.now() };
}

app.get("/api/live", async (req, res) => {
  try {
    const fresh = req.query.refresh === "1";
    if (!fresh && liveCache.data && Date.now() - liveCache.at < 5 * 60 * 1000) return res.json(liveCache.data);
    const data = await buildLive();
    liveCache = { at: Date.now(), data };
    res.json(data);
  } catch (err) {
    if (liveCache.data) return res.json({ ...liveCache.data, stale: true });
    res.status(502).json({ error: "live_failed", message: err?.message || "Couldn't reach AirVend." });
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
