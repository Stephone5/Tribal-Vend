// worker.js — ported from the Bridge. In-process memory worker:
//   Drain   every minute: derive queued sessions into facts + ledger.
//   Sweep   every 15 min: queue sessions that ended (30+ min quiet).
//   Reflect daily 03:30 Central: rewrite the member file if memory changed.
// Runs whenever Earl's database is connected. Set MEMORY_WORKER=off to stop it.

import * as store from "./store.js";
import { deriveSession, refreshProfile } from "./derive.js";
import { earlDbReady } from "../db.js";

const SESSION_END_MINUTES = 30; // must match the session boundary in earl/route.js
let timer = null, ticks = 0;
const fired = new Set();

function chicagoNow() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return { hour: d.getHours(), minute: d.getMinutes(), dateStr: d.toISOString().slice(0, 10) };
}

async function drain() {
  for (const row of await store.fetchPending(2)) {
    try {
      const result = await deriveSession(row.user_id, row.session_id);
      await store.markProcessed(row.id);
      console.log("[memory] derived session", row.session_id, JSON.stringify(result));
    } catch (e) {
      await store.markFailed(row.id, row.attempts, e.message);
      console.error("[memory] derivation failed for session", row.session_id, e.message);
    }
  }
}

async function sweep() {
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const sessions = new Map();
  for (const m of await store.recentMessagesForSweep(since)) {
    if (!m.session_id) continue;
    const s = sessions.get(m.session_id) || { userId: m.user_id, lastAt: m.created_at, count: 0 };
    s.count++; if (m.created_at > s.lastAt) s.lastAt = m.created_at;
    sessions.set(m.session_id, s);
  }
  const cutoff = Date.now() - SESSION_END_MINUTES * 60e3;
  let queued = 0;
  for (const [sessionId, s] of sessions) {
    if (new Date(s.lastAt).getTime() > cutoff || s.count < 4) continue;
    if (await store.outboxHasSession(s.userId, sessionId)) continue;
    try { await store.enqueueSession(s.userId, sessionId); queued++; }
    catch (e) { console.error("[memory] enqueue failed:", e.message); }
  }
  if (queued) console.log(`[memory] sweep queued ${queued} session(s)`);
}

async function reflect() {
  const since = new Date(Date.now() - 864e5).toISOString();
  for (const userId of await store.usersProcessedSince(since)) {
    try { if (await refreshProfile(userId)) console.log("[memory] profile refreshed for", userId); }
    catch (e) { console.error("[memory] profile refresh failed for", userId, e.message); }
  }
}

function tick() {
  ticks++;
  drain().catch(e => console.error("[memory] drain error:", e.message));
  if (ticks % 15 === 1) sweep().catch(e => console.error("[memory] sweep error:", e.message));
  const c = chicagoNow();
  if (c.hour === 3 && c.minute >= 30 && c.minute < 35) {
    const key = "reflect-" + c.dateStr;
    if (!fired.has(key)) { fired.add(key); reflect().catch(e => console.error("[memory] reflect error:", e.message)); }
  }
}

export function startMemoryWorker() {
  if (process.env.MEMORY_WORKER === "off") return console.log("[memory] worker off (MEMORY_WORKER=off)");
  if (!earlDbReady()) return console.log("[memory] worker not started: Earl's database isn't connected");
  if (timer) return;
  timer = setInterval(tick, 60e3);
  tick();
  console.log(`[memory] worker started (env: ${store.ENV})`);
}
