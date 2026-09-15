// Earl's routes — ported from the Bridge (routes/api.js: commander history,
// commander message, action steps). Same session rules: 30 minutes quiet ends a
// session and it gets compressed; long sessions compress mid-way; a summary
// bridges gaps over a day; a background debrief runs after every reply.
//
// Instead of the Bridge's intake profile, Earl gets the member's live Tribal
// Vend numbers on every message (businessData).

import crypto from "crypto";
import * as db from "./db.js";
import { MEMBER_ID, earlDbReady } from "./db.js";
import { commanderChat, getSoulVersion, compressSession, generateSessionDebrief, generateConversationSummary } from "./claude.js";
import { buildMemoryContext, describeGap } from "./memory/context.js";

const _inFlight = new Set();
function runBackground(label, fn) {
  const p = (async () => { try { await fn(); } catch (e) { console.error(`[earl] background ${label} failed:`, e.message); } finally { _inFlight.delete(p); } })();
  _inFlight.add(p);
}

function formatSessionNotes(notes) {
  const ins = [], ground = [], threads = [];
  const arr = v => Array.isArray(v) ? v : (typeof v === "string" && v ? (() => { try { const j = JSON.parse(v); return Array.isArray(j) ? j : [v]; } catch { return [v]; } })() : []);
  for (const n of notes) { ins.push(...arr(n.operator_insights)); ground.push(...arr(n.strategic_ground)); threads.push(...arr(n.unresolved_threads)); }
  let block = "WHAT I KNOW ABOUT THIS PERSON FROM OUR PREVIOUS CONVERSATIONS:\n\n";
  if (ins.length) block += "Operator insights:\n" + ins.map(i => `— ${i}\n`).join("") + "\n";
  if (ground.length) block += "Strategic ground we have covered:\n" + ground.map(i => `— ${i}\n`).join("") + "\n";
  if (threads.length) block += "Open threads we have not resolved:\n" + threads.map(i => `— ${i}\n`).join("");
  return block;
}

// The Bridge's buildCoachingContext, minus the intake interview and goals that
// Tribal Vend doesn't have: open action steps with ids, last unresolved thread,
// overdue step.
async function actionContext(userId) {
  let ctx = "";
  const steps = await db.getActionSteps(userId);
  if (steps.length) {
    ctx += "THEIR ACTION STEPS (your private map):\n";
    for (const s of steps.slice(0, 30)) {
      const mark = s.status === "completed" ? "✓ done" : s.status === "did_not_happen" ? "✗ did not happen" : "in progress";
      ctx += `    · [action_step_id: ${s.id}] "${s.step_text}" (${mark})${s.target_date ? ` target ${s.target_date}` : ""}\n`;
    }
    ctx += "Use the exact action_step_id values above when marking steps complete.\n";
  }
  const debriefs = await db.getDebriefs(userId, 1);
  if (debriefs.length && debriefs[0].unresolved_item) ctx += `\nONE UNRESOLVED THREAD FROM LAST TIME: ${debriefs[0].unresolved_item}\n`;
  const overdue = steps.filter(s => s.status === "active" && s.target_date && new Date(s.target_date) < new Date());
  if (overdue.length) ctx += `\nOVERDUE ACTION STEP (raise if relevant): "${overdue[0].step_text}"\n`;
  return ctx.trim();
}

export function mountEarl(app, { rateLimit, getBusinessData }) {
  const notReady = res => res.status(503).json({ error: "earl_db", message: "Earl's memory database isn't connected yet, so Earl can't talk. Add EARL_SUPABASE_URL and EARL_SUPABASE_SERVICE_KEY on the server and run migrations/earl.sql." });

  app.get("/api/earl/history", async (_req, res) => {
    if (!earlDbReady()) return notReady(res);
    const userId = MEMBER_ID;
    let messages;
    try { messages = await db.getHistory(userId, 40); }
    catch (e) { console.error("[earl] history:", e.message); return res.status(502).json({ error: "history_failed", message: "Couldn't load your conversation with Earl. Try again." }); }
    let summary = null, preConversation = null;
    try {
      const info = await db.getLatestSessionId(userId);
      if (info && (Date.now() - new Date(info.lastMessageAt).getTime()) / 3600e3 > 24) {
        const existing = await db.getLatestSummary(userId);
        if (existing) summary = existing.summary;
        else if (messages.length) {
          const text = await generateConversationSummary(messages.map(m => ({ role: m.message_role, content: m.message_content })));
          await db.saveSummary(userId, info.sessionId, text); summary = text;
        }
      }
      const debriefs = await db.getDebriefs(userId, 1);
      if (debriefs.length && debriefs[0].unresolved_item) preConversation = debriefs[0].unresolved_item;
    } catch (e) { console.error("[earl] history extras:", e.message); }
    res.json({
      messages: messages.map(m => ({ role: m.message_role, content: m.message_content, timestamp: m.created_at })),
      summary, preConversation,
    });
  });

  app.post("/api/earl/message", rateLimit(20, 60e3), async (req, res) => {
    if (!earlDbReady()) return notReady(res);
    if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "no_key", message: "Earl isn't connected: no API key on the server." });
    const userId = MEMBER_ID;
    try {
      const { message, image } = req.body || {};
      const imageData = image && image.data ? { data: image.data, media_type: image.media_type || "image/jpeg" } : null;
      if (!message && !imageData) return res.status(400).json({ error: "bad_request", message: "Message required." });
      const storedText = message && message.trim() ? message : "[shared an image]";

      let sessionId, summaryContext = null, sessionNotesContext = "", gapMinutes = null;
      const info = await db.getLatestSessionId(userId);
      if (info) {
        gapMinutes = (Date.now() - new Date(info.lastMessageAt).getTime()) / 60e3;
        if (gapMinutes >= 30) {
          const oldId = info.sessionId;
          if (!(await db.sessionNoteExists(userId, oldId))) {
            const old = await db.getSessionMessages(userId, oldId);
            if (old.length >= 4) {
              try { const c = await compressSession(old); await db.saveSessionNote(userId, oldId, c.operator_insights || [], c.strategic_ground || [], c.unresolved_threads || [], old.length); }
              catch (e) { console.error("[earl] session compression:", e.message); }
            }
          }
          const s = await db.getLatestSummary(userId);
          if (s) summaryContext = s.summary;
          sessionId = crypto.randomUUID();
        } else sessionId = info.sessionId;
      } else sessionId = crypto.randomUUID();

      const soulVersion = getSoulVersion();
      const current = await db.getSessionMessages(userId, sessionId);
      if (current.length >= 30 && !current.some(m => m.message_role === "system_note")) {
        const toCompress = current.filter(m => m.message_role !== "system_note").slice(0, 20);
        runBackground("mid-session-compress", async () => {
          const c = await compressSession(toCompress);
          await db.saveSessionNote(userId, crypto.randomUUID(), c.operator_insights || [], c.strategic_ground || [], c.unresolved_threads || [], toCompress.length);
          await db.saveMessage(userId, sessionId, "system_note", "Earlier context in this conversation has been summarized.", null);
        });
      }

      const conversationHistory = await db.getMessagesForApi(userId, 30, soulVersion);
      // Long-term memory. A thrown error means memory is broken: surface it.
      const memoryContext = await buildMemoryContext(userId, storedText);
      if (memoryContext) sessionNotesContext = memoryContext;
      else {
        const notes = await db.getSessionNotes(userId, 30);
        if (notes.length) sessionNotesContext = formatSessionNotes(notes);
      }
      if (gapMinutes !== null && gapMinutes >= 30) {
        const gapLine = `TIME CONTEXT: It has been ${describeGap(gapMinutes)} since your last conversation with this member.`;
        sessionNotesContext = gapLine + (sessionNotesContext ? "\n\n" + sessionNotesContext : "");
      }

      await db.saveMessage(userId, sessionId, "user", storedText, soulVersion);

      let intakeContext = await actionContext(userId);
      const biz = await getBusinessData();
      if (biz) intakeContext = `LIVE BUSINESS NUMBERS (from the member's Tribal Vend app, pulled just now; every figure here is real data):\n${biz}` + (intakeContext ? "\n\n" + intakeContext : "");

      const persist = { userId, sessionId };
      const response = await commanderChat(message || "", intakeContext, conversationHistory, summaryContext, sessionNotesContext, persist, imageData);
      if (!response) throw new Error("Earl returned an empty reply");
      await db.saveMessage(userId, sessionId, "assistant", response, soulVersion);

      const debriefMessages = [...conversationHistory, { role: "user", content: storedText }, { role: "assistant", content: response }];
      runBackground("session-debrief", async () => {
        const d = await generateSessionDebrief(debriefMessages);
        await db.upsertDebrief(userId, sessionId, d.summary, !!d.shift_detected, d.unresolved_item || null);
      });

      res.json({ response });
    } catch (e) {
      console.error("[earl] message error:", e.message, e.stack);
      res.status(502).json({ error: "earl_failed", message: `Earl couldn't answer: ${e.message}` });
    }
  });

  app.get("/api/earl/action-steps", async (_req, res) => {
    if (!earlDbReady()) return notReady(res);
    try {
      const steps = await db.getActionSteps(MEMBER_ID);
      res.json({ active: steps.filter(s => s.status === "active"), completed: steps.filter(s => s.status === "completed"), did_not_happen: steps.filter(s => s.status === "did_not_happen") });
    } catch (e) { res.status(502).json({ error: "steps_failed", message: e.message }); }
  });
  app.post("/api/earl/action-steps/:id/status", async (req, res) => {
    if (!earlDbReady()) return notReady(res);
    const status = req.body?.status;
    if (!["active", "completed", "did_not_happen"].includes(status)) return res.status(400).json({ error: "bad_request", message: "Bad status." });
    try {
      const step = await db.getActionStep(req.params.id);
      if (!step || step.user_id !== MEMBER_ID) return res.status(404).json({ error: "not_found", message: "Step not found." });
      res.json({ ok: true, step: await db.updateActionStepStatus(req.params.id, status) });
    } catch (e) { res.status(502).json({ error: "steps_failed", message: e.message }); }
  });
  app.delete("/api/earl/action-steps/:id", async (req, res) => {
    if (!earlDbReady()) return notReady(res);
    try { await db.deleteActionStep(MEMBER_ID, req.params.id); res.json({ ok: true }); }
    catch (e) { res.status(502).json({ error: "steps_failed", message: e.message }); }
  });
}
