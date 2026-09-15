// Earl's setup interview and goals — ported from the Bridge's supabase.js
// (member_state, intake_responses, member_benchmarks).

import { getClient } from "./db.js";

function must() {
  const db = getClient();
  if (!db) throw new Error("Earl's database isn't connected (EARL_SUPABASE_URL / EARL_SUPABASE_SERVICE_KEY).");
  return db;
}

// ---- member state ----
export async function getMemberState(userId) {
  const db = must();
  const { data, error } = await db.from("member_state").select("*").eq("user_id", userId).limit(1);
  if (error) throw new Error("member state failed: " + error.message);
  if (data && data.length) return data[0];
  const ins = await db.from("member_state").insert({ user_id: userId }).select().single();
  if (ins.error) throw new Error("creating member state failed: " + ins.error.message);
  return ins.data;
}
export async function updateMemberState(userId, patch) {
  await getMemberState(userId);
  const { error } = await must().from("member_state").update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (error) throw new Error("updating member state failed: " + error.message);
}

// ---- setup answers ----
export async function getIntakeResponses(userId, round = 1) {
  const { data, error } = await must().from("intake_responses").select("*").eq("user_id", userId).eq("round", round).order("created_at", { ascending: true });
  if (error) throw new Error("setup answers failed: " + error.message);
  return data || [];
}
export async function saveIntakeResponse(userId, round, stage, field, answer) {
  const { error } = await must().from("intake_responses").upsert(
    { user_id: userId, round, stage, question_field: field, answer, updated_at: new Date().toISOString() },
    { onConflict: "user_id,round,question_field" });
  if (error) throw new Error("saving answer failed: " + error.message);
}
export async function updateIntakeFollowUp(userId, round, field, followUpQuestion, followUpAnswer) {
  const patch = { updated_at: new Date().toISOString() };
  if (followUpQuestion !== undefined) patch.follow_up_question = followUpQuestion;
  if (followUpAnswer !== undefined) patch.follow_up_answer = followUpAnswer;
  const { error } = await must().from("intake_responses").update(patch).eq("user_id", userId).eq("round", round).eq("question_field", field);
  if (error) throw new Error("saving follow-up failed: " + error.message);
}

// ---- goals ----
export async function getGoals(userId, activeOnly = true) {
  let q = must().from("member_benchmarks").select("*").eq("user_id", userId);
  if (activeOnly) q = q.eq("active", true);
  const { data, error } = await q.order("position", { ascending: true });
  if (error) throw new Error("goals failed: " + error.message);
  return data || [];
}
// Earl's suggested goals from the interview replace any earlier suggestions you
// haven't approved yet; goals you approved or added yourself stay.
export async function saveGeneratedGoals(userId, statements) {
  const db = must();
  await db.from("member_benchmarks").delete().eq("user_id", userId).eq("approved", false).is("completed_at", null);
  const existing = await getGoals(userId, false);
  const rows = statements.map((s, i) => ({
    user_id: userId, statement: s.statement, position: existing.length + i,
    starting_rating: s.starting_rating ?? null, current_rating: s.starting_rating ?? null, approved: false, active: true,
  }));
  const { data, error } = await db.from("member_benchmarks").insert(rows).select();
  if (error) throw new Error("saving goals failed: " + error.message);
  const seed = (data || []).filter(b => b.starting_rating != null).map(b => ({ user_id: userId, benchmark_id: b.id, rating: b.starting_rating, source: "initial" }));
  if (seed.length) await db.from("benchmark_ratings").insert(seed);
  return data || [];
}
export async function addGoal(userId, statement) {
  const existing = await getGoals(userId, false);
  const { data, error } = await must().from("member_benchmarks").insert({ user_id: userId, statement, position: existing.length, approved: true, active: true }).select().single();
  if (error) throw new Error("adding goal failed: " + error.message);
  return data;
}
export async function updateGoal(userId, id, patch) {
  const { data, error } = await must().from("member_benchmarks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId).select().single();
  if (error) throw new Error("updating goal failed: " + error.message);
  return data;
}
export async function completeGoal(userId, id) {
  return updateGoal(userId, id, { completed_at: new Date().toISOString() });
}
export async function removeGoal(userId, id) {
  return updateGoal(userId, id, { active: false });
}
