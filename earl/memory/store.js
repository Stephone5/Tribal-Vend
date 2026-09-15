// store.js — ported from the Bridge. Supabase persistence for Earl's memory:
// facts, decision ledger, member profile, and the ingestion outbox. All of it
// is derived from commander_messages and rebuildable.

import { getClient } from "../db.js";

export const ENV = process.env.MEMORY_ENV || "tribal-vend";

function db() {
  const c = getClient();
  if (!c) throw new Error("Earl's database isn't connected.");
  return c;
}

// ---- facts ----
export async function insertFact({ userId, fact, embedding, sourceSession = null, asOf = null }) {
  const when = asOf ? new Date(asOf).toISOString() : new Date().toISOString();
  const { data, error } = await db().from("memory_facts")
    .insert({ user_id: userId, fact, embedding, source_session: sourceSession, first_seen: when, last_confirmed: when })
    .select("id").single();
  if (error) throw error;
  return data.id;
}
export async function confirmFact(id, asOf = null) {
  const when = asOf ? new Date(asOf).toISOString() : new Date().toISOString();
  await db().from("memory_facts").update({ last_confirmed: when }).eq("id", id);
}
export async function supersedeFact(oldId, newId) {
  await db().from("memory_facts").update({ superseded_by: newId }).eq("id", oldId);
}
export async function listFacts(userId, limit = 150) {
  const { data, error } = await db().from("memory_facts").select("id, fact, last_confirmed")
    .eq("user_id", userId).is("superseded_by", null).order("last_confirmed", { ascending: false }).limit(limit);
  if (error) return [];
  return data;
}
export async function searchFacts(userId, queryEmbedding, count = 24) {
  const { data, error } = await db().rpc("match_memory_facts", { p_user_id: userId, p_query: queryEmbedding, p_count: count });
  if (error) throw error;
  return data || [];
}

// ---- decision ledger ----
export async function listLedger(userId, limit = 40) {
  const { data, error } = await db().from("decision_ledger")
    .select("id, topic, conclusion, reasoning, status, decided_at, last_touched")
    .eq("user_id", userId).order("last_touched", { ascending: false }).limit(limit);
  if (error) return [];
  return data;
}
export async function insertLedgerEntry({ userId, topic, conclusion, reasoning = null, status = "open", decidedAt = null }) {
  const { data, error } = await db().from("decision_ledger")
    .insert({ user_id: userId, topic, conclusion, reasoning, status, decided_at: decidedAt, last_touched: new Date().toISOString() })
    .select("id").single();
  if (error) throw error;
  return data.id;
}
export async function updateLedgerEntry(id, patch) {
  await db().from("decision_ledger").update({ ...patch, last_touched: new Date().toISOString() }).eq("id", id);
}

// ---- member profile ----
export async function getProfile(userId) {
  const { data } = await db().from("member_profiles").select("*").eq("user_id", userId).limit(1);
  return (data && data[0]) || null;
}
export async function saveProfile(userId, profile) {
  const existing = await getProfile(userId);
  if (existing) await db().from("member_profiles").update({ profile, version: existing.version + 1, updated_at: new Date().toISOString() }).eq("user_id", userId);
  else await db().from("member_profiles").insert({ user_id: userId, profile });
}

// ---- outbox ----
export async function enqueueSession(userId, sessionId, kind = "session") {
  const { error } = await db().from("memory_outbox").insert({ user_id: userId, session_id: sessionId, env: ENV, kind, processed: false });
  if (error) throw error;
}
export async function outboxHasSession(userId, sessionId) {
  const { data, error } = await db().from("memory_outbox").select("id").eq("user_id", userId).eq("session_id", sessionId).limit(1);
  if (error) return true;
  return !!(data && data.length);
}
export async function fetchPending(limit = 3) {
  const { data, error } = await db().from("memory_outbox").select("*").eq("env", ENV).eq("processed", false)
    .lt("attempts", 5).order("created_at", { ascending: true }).limit(limit);
  if (error) return [];
  return data;
}
export async function markProcessed(id) {
  await db().from("memory_outbox").update({ processed: true, processed_at: new Date().toISOString() }).eq("id", id);
}
export async function markFailed(id, attempts, message) {
  await db().from("memory_outbox").update({ attempts: attempts + 1, last_error: String(message).slice(0, 500) }).eq("id", id);
}
export async function usersProcessedSince(sinceIso) {
  const { data, error } = await db().from("memory_outbox").select("user_id").eq("processed", true).gte("processed_at", sinceIso);
  if (error) return [];
  return [...new Set(data.map(r => r.user_id))];
}
export async function recentMessagesForSweep(sinceIso, limit = 2000) {
  const { data, error } = await db().from("commander_messages").select("user_id, session_id, created_at")
    .gte("created_at", sinceIso).order("created_at", { ascending: true }).limit(limit);
  if (error) return [];
  return data;
}
