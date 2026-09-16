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
import { commanderChat, getSoulVersion, compressSession, generateSessionDebrief, generateConversationSummary, generateIntakeFollowUp, generateBenchmark } from "./claude.js";
import * as setup from "./db-setup.js";
import { QUESTIONS, STAGE_FRAMING, STAGE_COMPLETE, STAGE_BOUNDS, getQuestionByField } from "./intake-questions.js";
import { buildMemoryContext, describeGap } from "./memory/context.js";
import { buildPrefill } from "./prefill.js";

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

// ---- setup interview helpers (Bridge routes/api.js) ----
function isVague(answer, check) {
  if (!check) return false;
  const raw = (answer || "").trim(), low = raw.toLowerCase();
  const words = raw.split(/\s+/).filter(Boolean).length;
  if (check.custom === "always_if_no") return /^(no|nope|not really|haven'?t|have not|not yet|never)\b/.test(low);
  if (check.custom === "depends_only") return low === "depends" || /^(it )?depends\.?$/.test(low);
  if (check.custom === "both_only") return /^both( equally)?\.?$/.test(low);
  if (check.minWords && words < check.minWords) return true;
  if (check.banned && check.banned.some(b => low.includes(b))) return true;
  if (check.needNumber && !/\d/.test(raw)) return true;
  if (check.needTimeRef && !/\d|year|month|week|day|decade/.test(low)) return true;
  return false;
}
const answeredFieldSet = rs => new Set(rs.filter(r => r.answer != null && String(r.answer).trim() !== "").map(r => r.question_field));
const nextQuestion = answered => QUESTIONS.find(q => !answered.has(q.field)) || null;
const stageStatus = st => ({ stage_1: !!st?.stage_1_complete, stage_2: !!st?.stage_2_complete, stage_3: !!st?.stage_3_complete });

async function completeStageIfDone(userId, stage, answered) {
  const fields = QUESTIONS.filter(q => q.stage === stage).map(q => q.field);
  if (!fields.every(f => answered.has(f))) return { completed: false };
  const state = await setup.getMemberState(userId);
  if (state[`stage_${stage}_complete`]) return { completed: false };
  await setup.updateMemberState(userId, { [`stage_${stage}_complete`]: true, [`stage_${stage}_completed_at`]: new Date().toISOString() });
  let goalsReady = false;
  if (stage === 2) {
    const all = await setup.getIntakeResponses(userId, 1);
    const answers = {};
    for (const r of all) answers[r.question_field] = r.follow_up_answer ? `${r.answer} ${r.follow_up_answer}` : r.answer;
    const bench = await generateBenchmark(answers);
    if (bench.statements && bench.statements.length) {
      await setup.saveGeneratedGoals(userId, bench.statements);
      if (bench.hidden_metrics) await setup.updateMemberState(userId, { hidden_metrics: bench.hidden_metrics });
      goalsReady = true;
    }
  }
  return { completed: true, message: STAGE_COMPLETE[stage], goalsReady };
}

// The Bridge's buildCoachingContext: interview profile, goals with the action
// steps under each, operational baseline, interview status, last unresolved
// thread, overdue step.
async function actionContext(userId) {
  const [responses, goals, state, steps, debriefs] = await Promise.all([
    setup.getIntakeResponses(userId, 1), setup.getGoals(userId), setup.getMemberState(userId),
    db.getActionSteps(userId), db.getDebriefs(userId, 1),
  ]);
  let ctx = "";
  if (responses.length) {
    ctx += "MEMBER PROFILE (from their interview):\n";
    for (const r of responses) {
      const q = getQuestionByField(r.question_field);
      let val = r.answer || "";
      if (r.follow_up_answer) val += " — " + r.follow_up_answer;
      if (val.trim()) ctx += `- ${(q ? q.field : r.question_field).replace(/_/g, " ")}: ${val}\n`;
    }
  }
  const mark = s => s.status === "completed" ? "✓ done" : s.status === "did_not_happen" ? "✗ did not happen" : "in progress";
  if (goals.length) {
    ctx += "\nTHEIR GOALS AND THE ACTION STEPS UNDER EACH (your private map):\n";
    for (const b of goals) {
      const done = !!b.completed_at;
      ctx += `- [benchmark_id: ${b.id}] "${b.statement}"${done ? " — DONE (already marked complete)" : ""}${!b.approved ? " (suggested, not yet approved by the member)" : ""}\n`;
      const under = steps.filter(s => s.benchmark_id === b.id);
      for (const s of under) ctx += `    · [action_step_id: ${s.id}] "${s.step_text}" (${mark(s)})\n`;
      if (under.length && !done && !under.some(s => s.status === "active")) ctx += "    → Every action step for this goal is closed. If it feels reached, ask them whether to mark the goal complete and move to the next — only call complete_goal if they say yes.\n";
      if (!under.length && !done) ctx += "    · (no action steps yet — when the moment is right, help them name the concrete steps that would get them here, and save each with save_action_step tagged to this benchmark_id)\n";
    }
  }
  const loose = steps.filter(s => !s.benchmark_id || !goals.some(g => g.id === s.benchmark_id));
  if (loose.length) {
    ctx += "\nACTION STEPS NOT TIED TO A GOAL:\n";
    for (const s of loose.slice(0, 30)) ctx += `    · [action_step_id: ${s.id}] "${s.step_text}" (${mark(s)})${s.target_date ? ` target ${s.target_date}` : ""}\n`;
  }
  if (goals.length || steps.length) ctx += "Use the exact benchmark_id / action_step_id values above when saving steps, marking steps complete, or completing a goal.\n";
  if (state.hidden_metrics && typeof state.hidden_metrics === "object") {
    const lines = Object.entries(state.hidden_metrics).filter(([, v]) => v);
    if (lines.length) ctx += "\nOPERATIONAL BASELINE (internal, not a talking point):\n" + lines.map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}\n`).join("");
  }
  const incomplete = [];
  if (!state.stage_1_complete) incomplete.push("Stage 1 (the basics)");
  if (!state.stage_2_complete) incomplete.push("Stage 2 (operational reality)");
  if (!state.stage_3_complete) incomplete.push("Stage 3 (personal context)");
  if (incomplete.length) ctx += `\nINTAKE STATUS: They have not completed ${incomplete.join(" and ")}. Invite them back only when the missing information would meaningfully change your response.\n`;
  if (debriefs.length && debriefs[0].unresolved_item) ctx += `\nONE UNRESOLVED THREAD FROM LAST TIME: ${debriefs[0].unresolved_item}\n`;
  const overdue = steps.filter(s => s.status === "active" && s.target_date && new Date(s.target_date) < new Date());
  if (overdue.length) ctx += `\nOVERDUE ACTION STEP (raise if relevant): "${overdue[0].step_text}"\n`;
  return ctx.trim();
}

export function mountEarl(app, { rateLimit, getBusinessData, getLive }) {
  // Draft answers for setup questions the app can answer from real data.
  const draftFor = async field => {
    if (!getLive) return null;
    try { const { live, closet } = await getLive(); return buildPrefill(live, closet)[field] || null; }
    catch (e) { console.error("[earl] prefill:", e.message); return null; }
  };
  const notReady = res => res.status(503).json({ error: "earl_db", message: "Earl's memory database isn't connected yet, so Earl can't talk. Add EARL_SUPABASE_URL and EARL_SUPABASE_SERVICE_KEY on the server and run migrations/earl.sql." });

  app.get("/api/earl/history", async (_req, res) => {
    if (!earlDbReady()) return notReady(res);
    const userId = MEMBER_ID;
    let messages;
    try { messages = await db.getHistory(userId, 40); }
    catch (e) { console.error("[earl] history:", e.message); return res.status(502).json({ error: "history_failed", message: `Couldn't load your conversation with Earl. Database said: ${e.message}` }); }
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

  // ---- setup interview ----
  app.get("/api/earl/interview/state", async (_req, res) => {
    if (!earlDbReady()) return notReady(res);
    try {
      const state = await setup.getMemberState(MEMBER_ID);
      const answered = answeredFieldSet(await setup.getIntakeResponses(MEMBER_ID, 1));
      const q = nextQuestion(answered);
      const base = { stages: stageStatus(state), progress: { answered: answered.size, total: QUESTIONS.length } };
      if (!q) return res.json({ ...base, done: true });
      res.json({ ...base, done: false, stage: q.stage, framing: q.n === STAGE_BOUNDS[q.stage].first ? STAGE_FRAMING[q.stage] : null, question: { n: q.n, field: q.field, text: q.question, draft: await draftFor(q.field) } });
    } catch (e) { res.status(502).json({ error: "interview_failed", message: e.message }); }
  });

  app.post("/api/earl/interview/answer", async (req, res) => {
    if (!earlDbReady()) return notReady(res);
    try {
      const { field, answer, isFollowUp } = req.body || {};
      const q = getQuestionByField(field);
      if (!q) return res.status(400).json({ error: "bad_request", message: "Unknown question." });
      if (answer == null || String(answer).trim() === "") return res.status(400).json({ error: "bad_request", message: "Answer required." });
      if (isFollowUp) await setup.updateIntakeFollowUp(MEMBER_ID, 1, field, undefined, String(answer));
      else {
        await setup.saveIntakeResponse(MEMBER_ID, 1, q.stage, field, String(answer));
        if (isVague(answer, q.check) && q.followup.kind !== "none") {
          let followUp = null;
          if (q.followup.kind === "string") followUp = q.followup.template.replace("[answer]", String(answer).trim().split(/\s+/).slice(0, 12).join(" "));
          else { try { followUp = await generateIntakeFollowUp(q.question, String(answer), q.followup.instruction); } catch (e) { followUp = null; } }
          if (followUp) { await setup.updateIntakeFollowUp(MEMBER_ID, 1, field, followUp, undefined); return res.json({ followUp }); }
        }
      }
      const answered = answeredFieldSet(await setup.getIntakeResponses(MEMBER_ID, 1));
      const stageResult = await completeStageIfDone(MEMBER_ID, q.stage, answered);
      const nq = nextQuestion(answered);
      const state = await setup.getMemberState(MEMBER_ID);
      const out = { stageComplete: stageResult.completed ? stageResult.message : null, goalsReady: !!stageResult.goalsReady, stages: stageStatus(state), progress: { answered: answered.size, total: QUESTIONS.length } };
      if (!nq) return res.json({ ...out, done: true });
      res.json({ ...out, done: false, stage: nq.stage, framing: nq.n === STAGE_BOUNDS[nq.stage].first && stageResult.completed ? STAGE_FRAMING[nq.stage] : null, question: { n: nq.n, field: nq.field, text: nq.question, draft: await draftFor(nq.field) } });
    } catch (e) { console.error("[earl] interview answer:", e.message); res.status(502).json({ error: "interview_failed", message: `Couldn't save your answer: ${e.message}` }); }
  });

  // ---- goals ----
  app.get("/api/earl/goals", async (_req, res) => {
    if (!earlDbReady()) return notReady(res);
    try { res.json({ goals: await setup.getGoals(MEMBER_ID) }); }
    catch (e) { res.status(502).json({ error: "goals_failed", message: e.message }); }
  });
  app.post("/api/earl/goals", async (req, res) => {
    if (!earlDbReady()) return notReady(res);
    const statement = String(req.body?.statement || "").trim();
    if (!statement) return res.status(400).json({ error: "bad_request", message: "Write the goal first." });
    try { res.json({ goal: await setup.addGoal(MEMBER_ID, statement) }); }
    catch (e) { res.status(502).json({ error: "goals_failed", message: e.message }); }
  });
  app.post("/api/earl/goals/:id", async (req, res) => {
    if (!earlDbReady()) return notReady(res);
    try {
      const b = req.body || {};
      let goal;
      if (b.action === "complete") goal = await setup.completeGoal(MEMBER_ID, req.params.id);
      else if (b.action === "reopen") goal = await setup.updateGoal(MEMBER_ID, req.params.id, { completed_at: null });
      else if (b.action === "approve") goal = await setup.updateGoal(MEMBER_ID, req.params.id, { approved: true });
      else if (b.action === "remove") goal = await setup.removeGoal(MEMBER_ID, req.params.id);
      else if (b.action === "edit" && String(b.statement || "").trim()) goal = await setup.updateGoal(MEMBER_ID, req.params.id, { statement: String(b.statement).trim(), approved: true });
      else return res.status(400).json({ error: "bad_request", message: "Unknown change." });
      res.json({ goal });
    } catch (e) { res.status(502).json({ error: "goals_failed", message: e.message }); }
  });

  // ---- add an action step yourself ----
  app.post("/api/earl/action-steps", async (req, res) => {
    if (!earlDbReady()) return notReady(res);
    const text = String(req.body?.step_text || "").trim();
    if (!text) return res.status(400).json({ error: "bad_request", message: "Write the step first." });
    try { res.json({ step: await db.saveActionStep(MEMBER_ID, text, null, req.body?.target_date || null, req.body?.benchmark_id || null) }); }
    catch (e) { res.status(502).json({ error: "steps_failed", message: e.message }); }
  });

}
