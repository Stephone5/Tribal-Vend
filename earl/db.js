// Earl's database: a Supabase project dedicated to Tribal Vend.
// Ported from the Bridge's server/services/supabase.js (the Earl parts only).
// The app has one member, Stephen, so every row uses one fixed member id.

import { createClient } from "@supabase/supabase-js";

export const MEMBER_ID = "00000000-0000-4000-8000-000000000001";

let client = null;
export function earlDbReady() { return !!(process.env.EARL_SUPABASE_URL && process.env.EARL_SUPABASE_SERVICE_KEY); }
export function getClient() {
  if (!earlDbReady()) return null;
  // Accept the URL however it was pasted (with /rest/v1/, a trailing slash,
  // or spaces): the client needs just https://<project>.supabase.co.
  if (!client) {
    let url = String(process.env.EARL_SUPABASE_URL).trim();
    try { url = new URL(url).origin; } catch (e) {}
    client = createClient(url, String(process.env.EARL_SUPABASE_SERVICE_KEY).trim(), { auth: { persistSession: false } });
  }
  return client;
}
function must() {
  const db = getClient();
  if (!db) throw new Error("Earl's database isn't connected (EARL_SUPABASE_URL / EARL_SUPABASE_SERVICE_KEY).");
  return db;
}

// ---- conversation ----
export async function saveMessage(userId, sessionId, role, content, soulVersion = null) {
  const row = { user_id: userId, session_id: sessionId, message_role: role, message_content: content };
  if (soulVersion) row.soul_version = soulVersion;
  const { data, error } = await must().from("commander_messages").insert(row).select().single();
  if (error) throw new Error("saving a message failed: " + error.message);
  return data;
}

export async function getHistory(userId, limit = 40) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await must().from("commander_messages").select("*")
      .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
    if (!error) return (data || []).reverse();
    lastError = error;
  }
  throw new Error((lastError?.message || "unknown error") + (lastError?.hint ? ` (${lastError.hint})` : "") + (lastError?.code ? ` [${lastError.code}]` : ""));
}

export async function getLatestSessionId(userId) {
  const { data, error } = await must().from("commander_messages").select("session_id, created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
  if (error) throw new Error("session lookup failed: " + error.message);
  if (!data || !data.length) return null;
  return { sessionId: data[0].session_id, lastMessageAt: data[0].created_at };
}

export async function getSessionMessages(userId, sessionId) {
  const { data, error } = await must().from("commander_messages").select("message_role, message_content, created_at")
    .eq("user_id", userId).eq("session_id", sessionId).order("created_at", { ascending: true });
  if (error) throw new Error("session messages failed: " + error.message);
  return data || [];
}

// Last N messages for the model, filtered to the current soul version, with
// strict role alternation (same rules as the Bridge).
export async function getMessagesForApi(userId, limit = 30, soulVersion = null) {
  const { data, error } = await must().from("commander_messages").select("message_role, message_content, soul_version")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error("history for Earl failed: " + error.message);
  let filtered = (data || []).filter(m => m.message_role !== "system_note");
  if (soulVersion) filtered = filtered.filter(m => m.message_role === "user" || m.soul_version === soulVersion);
  const chronological = filtered.reverse().map(m => ({ role: m.message_role, content: m.message_content }));
  const out = [];
  for (let i = 0; i < chronological.length; i++) {
    const next = chronological[i + 1];
    if (next && next.role === chronological[i].role) continue;
    out.push(chronological[i]);
  }
  return out;
}

// ---- summaries / session notes / debriefs ----
export async function getLatestSummary(userId) {
  const { data } = await must().from("commander_summaries").select("summary, created_at")
    .eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
  return (data && data[0]) || null;
}
export async function saveSummary(userId, sessionId, summary) {
  const { error } = await must().from("commander_summaries").insert({ user_id: userId, session_id: sessionId, summary });
  if (error) console.error("[earl] save summary:", error.message);
}
export async function sessionNoteExists(userId, sessionId) {
  const { data, error } = await must().from("commander_session_notes").select("id").eq("user_id", userId).eq("session_id", sessionId).limit(1);
  if (error) return false;
  return !!(data && data.length);
}
export async function saveSessionNote(userId, sessionId, insights, ground, threads, turnCount) {
  const { error } = await must().from("commander_session_notes").insert({
    user_id: userId, session_id: sessionId, operator_insights: insights, strategic_ground: ground,
    unresolved_threads: threads, generated_at: new Date().toISOString(), conversation_turn_count: turnCount,
  });
  if (error) console.error("[earl] save session note:", error.message);
}
export async function getSessionNotes(userId, limit = 30) {
  const { data, error } = await must().from("commander_session_notes").select("operator_insights, strategic_ground, unresolved_threads, generated_at")
    .eq("user_id", userId).order("generated_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}
export async function getDebriefs(userId, limit = 20) {
  const { data, error } = await must().from("session_debriefs").select("*").eq("user_id", userId).eq("dismissed", false)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) return [];
  return data || [];
}
export async function upsertDebrief(userId, sessionId, summary, shift = false, unresolved = null) {
  const db = must();
  const { data: existing } = await db.from("session_debriefs").select("id").eq("user_id", userId).eq("session_id", sessionId).limit(1);
  if (existing && existing.length) {
    await db.from("session_debriefs").update({ summary, shift_detected: shift, unresolved_item: unresolved }).eq("id", existing[0].id);
  } else {
    await db.from("session_debriefs").insert({ user_id: userId, session_id: sessionId, summary, shift_detected: shift, unresolved_item: unresolved });
  }
}

// ---- action steps ----
function stepKey(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9\s]/g, "")
    .replace(/\b(the|a|an|my|to|for|and|today|this|that)\b/g, "").replace(/\s+/g, " ").trim();
}
export async function saveActionStep(userId, stepText, sessionId = null, targetDate = null, benchmarkId = null) {
  const db = must();
  const key = stepKey(stepText);
  if (key) {
    const dayAgo = new Date(Date.now() - 864e5).toISOString();
    const { data: existing } = await db.from("action_steps").select("*").eq("user_id", userId).or(`status.eq.active,created_at.gte.${dayAgo}`);
    const match = (existing || []).find(s => stepKey(s.step_text) === key);
    if (match) {
      const patch = {};
      if (targetDate && !match.target_date) patch.target_date = targetDate;
      if (benchmarkId && !match.benchmark_id) patch.benchmark_id = benchmarkId;
      if (Object.keys(patch).length) await db.from("action_steps").update(patch).eq("id", match.id);
      return match;
    }
  }
  const { data, error } = await db.from("action_steps").insert({ user_id: userId, step_text: stepText, source_session_id: sessionId, target_date: targetDate, status: "active", ...(benchmarkId ? { benchmark_id: benchmarkId } : {}) }).select().single();
  if (error) throw new Error("saving action step failed: " + error.message);
  return data;
}
export async function getActionSteps(userId, status = null) {
  let q = must().from("action_steps").select("*").eq("user_id", userId);
  if (status) q = q.eq("status", status);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error("action steps failed: " + error.message);
  return data || [];
}
export async function getActionStep(id) {
  const { data } = await must().from("action_steps").select("*").eq("id", id).limit(1);
  return (data && data[0]) || null;
}
export async function updateActionStepStatus(id, status) {
  const patch = { status };
  if (status === "completed") patch.completed_at = new Date().toISOString();
  const { data, error } = await must().from("action_steps").update(patch).eq("id", id).select().single();
  if (error) throw new Error("updating action step failed: " + error.message);
  return data;
}
export async function deleteActionStep(userId, id) {
  const { error } = await must().from("action_steps").delete().eq("id", id).eq("user_id", userId);
  if (error) throw new Error("deleting action step failed: " + error.message);
}
