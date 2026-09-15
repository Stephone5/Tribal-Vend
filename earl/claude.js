// Earl's engine — ported from the Bridge (server/services/claude.js): soul
// prefill, operating context + Big Book + case study index as the system
// prompt, the tool loop, markdown/tell scrubbing, session compression,
// debriefs and summaries. Same models and limits as the Bridge.
//
// Tribal Vend differences:
// - Case studies are read from case-study-index.md (FULL STORIES) instead of a
//   Supabase table, so there's nothing to seed.
// - Tools for Bridge billing features (paid extension, "Your Numbers"
//   suggestions) are left out; the app already has the real numbers.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Anthropic from "@anthropic-ai/sdk";
import { scrubTells } from "./antitells.js";
import { saveActionStep, getActionStep, updateActionStepStatus } from "./db.js";
import { completeGoal } from "./db-setup.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "system");
const read = f => fs.readFileSync(path.join(DIR, f), "utf8");
const client = new Anthropic();

function stripMarkdown(text) {
  const cleaned = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^[\-•]\s+/gm, "")
    .replace(/\s*—\s*/g, ". ")
    .trim();
  return scrubTells(cleaned);
}

export function getSoulVersion() {
  try { return crypto.createHash("md5").update(read("soul.md")).digest("hex").substring(0, 12); }
  catch { return "no-soul"; }
}
function getSoulPrimer() { return read("soul.md"); }
function getCaseStudyIndex() {
  const full = read("case-study-index.md");
  const a = full.indexOf("## COMPRESSED INDEX"), b = full.indexOf("## FULL STORIES");
  if (a === -1) return "";
  return (b > a ? full.substring(a, b) : full.substring(a)).trim();
}
function getSystemPrompt() {
  let prompt = read("commander-context.md") + "\n\n---\n\n" + read("big-book-of-strategy.md");
  const idx = getCaseStudyIndex();
  if (idx) prompt += "\n\n---\n\nCASE STUDY LIBRARY — Available for retrieval when relevant:\n\n" + idx;
  return prompt;
}

// Full stories, parsed once from the FULL STORIES section.
let STORIES = null;
function caseStudies() {
  if (STORIES) return STORIES;
  const full = read("case-study-index.md");
  const sec = full.substring(full.indexOf("## FULL STORIES"));
  STORIES = sec.split(new RegExp("^---[ \t]*\r?$", "m")).map(block => {
    const get = k => { const m = block.match(new RegExp("^" + k + ":\\s*(.*)$", "m")); return m ? m[1].trim() : ""; };
    const arr = k => { try { return JSON.parse(get(k) || "[]"); } catch { return []; } };
    return { title: get("title"), source_book: get("source_book"), source_author: get("source_author"), lever_tags: arr("lever_tags"), problem_tags: arr("problem_tags"), story: get("story") };
  }).filter(c => c.title && c.story);
  return STORIES;
}
function fetchCaseStudyStory(input) {
  let best = null, bestScore = 0;
  for (const cs of caseStudies()) {
    let score = 0;
    for (const tag of input.lever_tags || []) if (cs.lever_tags.some(lt => lt.toLowerCase() === String(tag).toLowerCase())) score += 2;
    for (const tag of input.problem_tags || []) { const t = String(tag).toLowerCase(); if (cs.problem_tags.some(pt => pt.toLowerCase().includes(t) || t.includes(pt.toLowerCase()))) score += 1; }
    if (score > bestScore) { bestScore = score; best = cs; }
  }
  return best && bestScore > 0 ? `[Case Study: ${best.title} — from ${best.source_book} by ${best.source_author}]\n${best.story}` : "";
}

function buildUserContent(message, imageData) {
  if (!imageData || !imageData.data) return message;
  const text = message && message.trim() ? message : "I am sharing an image with you. Take a look.";
  return [
    { type: "image", source: { type: "base64", media_type: imageData.media_type || "image/jpeg", data: imageData.data } },
    { type: "text", text },
  ];
}

const TOOLS = [
  {
    name: "fetch_case_study",
    description: "Fetch the full story of a relevant case study from the library when a story would help the member feel understood or when a strategic claim needs grounding. Only call this when a case study would genuinely serve the moment — not to perform knowledge.",
    input_schema: { type: "object", properties: {
      lever_tags: { type: "array", items: { type: "string" }, description: "Lever names from the Big Book of Strategy that are relevant to this moment" },
      problem_tags: { type: "array", items: { type: "string" }, description: "Problem type descriptors that match what the member is facing" },
    }, required: ["lever_tags", "problem_tags"] },
  },
  {
    name: "save_action_step",
    description: "Call this when the member commits to a specific, concrete action they will take before your next conversation. Save it in their exact words, not your paraphrase. Do not invent action steps the member did not volunteer — but if they name several at once, save every one they commit to (call this tool once per step, back to back). Never make them slow down or wait until later. After saving, confirm to the member in your own voice. If a step clearly serves one of their named goals, include the exact benchmark_id from your context — copy it character for character, do not paraphrase or invent it.",
    input_schema: { type: "object", properties: {
      step_text: { type: "string", description: "The action the member committed to, in their exact words" },
      target_date: { type: "string", description: "Optional target completion date in YYYY-MM-DD form, only if the member gave one" },
      benchmark_id: { type: "string", description: "The benchmark_id from your context for the goal this step serves. Copy it exactly. Only include if this step clearly belongs to one of their named goals." },
    }, required: ["step_text"] },
  },
  {
    name: "mark_action_step_complete",
    description: "Call this whenever the member signals an action step is resolved — done, OR no longer happening. This includes indirect signals: they say a lead is dead, a person is not a customer after all, a deal fell through, a plan changed, or they are no longer pursuing something an open step is about. Do not just acknowledge it in words and move on — if any open step in your context matches what they closed, you MUST call this tool to close the record, or you will keep re-raising it later. Use the exact action_step_id from your context, copied character for character. Set outcome to 'completed' when they did it, 'did_not_happen' when it is off or abandoned. After marking, acknowledge in your own voice.",
    input_schema: { type: "object", properties: {
      action_step_id: { type: "string", description: "The action_step_id from your context. Copy it exactly." },
      outcome: { type: "string", enum: ["completed", "did_not_happen"] },
    }, required: ["action_step_id", "outcome"] },
  },
  {
    name: "complete_goal",
    description: "Marks one of the member's goals complete. NEVER call this on your own judgment. The sequence is: the member says (or their action steps show) the goal is reached → you ask them directly, in your own words, whether to mark it complete and move to the next one → they say yes → THEN you call this. Use the exact benchmark_id from your context. If they hesitate or say not yet, do not call it.",
    input_schema: { type: "object", properties: {
      benchmark_id: { type: "string", description: "The benchmark_id from your context for the goal the member confirmed is complete. Copy it exactly." },
    }, required: ["benchmark_id"] },
  },
];

export async function commanderChat(message, sessionContext, conversationHistory, summaryContext, sessionNotesContext, persist = {}, imageData = null) {
  let context = "";
  if (sessionNotesContext) context += sessionNotesContext + "\n\n";
  if (summaryContext) context += `Summary of previous conversation:\n${summaryContext}\n\n`;
  if (sessionContext) context += sessionContext + "\n\n";

  const systemBlocks = [{ type: "text", text: getSystemPrompt(), cache_control: { type: "ephemeral" } }];
  if (context) systemBlocks.push({ type: "text", text: "---\n\n" + context });

  const rawMessages = [
    { role: "user", content: "." },
    { role: "assistant", content: [{ type: "text", text: getSoulPrimer(), cache_control: { type: "ephemeral" } }] },
    ...(conversationHistory || []),
    { role: "user", content: buildUserContent(message, imageData) },
  ];
  const toBlocks = c => (Array.isArray(c) ? c : [{ type: "text", text: String(c) }]);
  const messages = [];
  for (const m of rawMessages) {
    const prev = messages[messages.length - 1];
    if (prev && prev.role === m.role) prev.content = [...toBlocks(prev.content), ...toBlocks(m.content)];
    else messages.push({ role: m.role, content: m.content });
  }

  const call = () => client.messages.create({ model: "claude-sonnet-4-6", max_tokens: 400, system: systemBlocks, messages, tools: TOOLS });
  let response = await call();
  let guard = 0;
  while (guard < 4) {
    const uses = response.content.filter(b => b.type === "tool_use");
    if (!uses.length) break;
    guard++;
    const results = [];
    for (const block of uses) {
      let content = "OK.";
      if (block.name === "fetch_case_study") {
        content = fetchCaseStudyStory(block.input) || "No matching case study found.";
      } else if (block.name === "save_action_step") {
        try { await saveActionStep(persist.userId, block.input.step_text, persist.sessionId || null, block.input.target_date || null, block.input.benchmark_id || null); content = "Action step saved."; }
        catch (e) { console.error("[earl] save_action_step:", e.message); content = "The action step could not be saved: " + e.message; }
      } else if (block.name === "mark_action_step_complete") {
        try {
          const step = await getActionStep(block.input.action_step_id);
          if (step && step.user_id === persist.userId) { await updateActionStepStatus(block.input.action_step_id, block.input.outcome); content = "Action step updated."; }
          else content = "No action step with that id.";
        } catch (e) { console.error("[earl] mark_action_step_complete:", e.message); content = "The action step could not be updated: " + e.message; }
      }
      else if (block.name === "complete_goal") {
        try { await completeGoal(persist.userId, block.input.benchmark_id); content = "Goal marked complete."; }
        catch (e) { console.error("[earl] complete_goal:", e.message); content = "The goal could not be marked complete: " + e.message; }
      }
      results.push({ type: "tool_result", tool_use_id: block.id, content });
    }
    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: results });
    response = await call();
  }
  const text = response.content.find(b => b.type === "text");
  return stripMarkdown(text ? text.text : "");
}

export async function generateSessionDebrief(conversationMessages) {
  const formatted = conversationMessages.map(m => `${(m.role || m.message_role) === "user" ? "Member" : "Earl"}: ${m.content || m.message_content}`).join("\n\n");
  const response = await client.messages.create({
    model: "claude-haiku-4-5", max_tokens: 400,
    system: "You are quietly reflecting on a conversation between a small-business owner (Member) and their advisor (Earl). Return only a JSON object, no markdown, no backticks, no prose.",
    messages: [{ role: "user", content: `From this conversation, return JSON exactly in this shape:
{
  "summary": "two or three sentences, written for the member, naming what was decided or uncovered",
  "shift_detected": true or false — true only if the member reported completing something significant, described a notable change, or began asking a qualitatively different kind of question than before,
  "unresolved_item": "one open thread to surface at the start of the next session, or null if nothing is open"
}

Conversation:
${formatted}` }],
  });
  const m = response.content[0].text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("generateSessionDebrief: non-JSON response");
  return JSON.parse(m[0]);
}

export async function generateConversationSummary(msgs) {
  const formatted = msgs.map(m => `${m.role === "user" ? "Member" : "Earl"}: ${m.content}`).join("\n\n");
  const response = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 4000,
    system: [{ type: "text", text: read("big-book-of-strategy.md"), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: `Summarize this conversation between a business owner (Member) and their strategic advisor (Earl) in exactly three sentences. Focus on: what was discussed, what was decided or recommended, and any action items. Be specific to their business.\n\nConversation:\n${formatted}` }],
  });
  return response.content[0].text;
}

export async function compressSession(conversationMessages) {
  const formatted = conversationMessages.map(m => `${m.message_role === "user" ? "Member" : "Earl"}: ${m.message_content}`).join("\n\n");
  const response = await client.messages.create({
    model: "claude-sonnet-4-6", max_tokens: 1500,
    system: "You are extracting meaningful knowledge from a business advisory conversation. Be precise and brief. Return only a JSON object with no markdown, no backticks, no prose.",
    messages: [{ role: "user", content: `Extract the following from this conversation and return as JSON:\n{\n  "operator_insights": [array of strings — personal observations about who this person is, how they think, what drives them, what they avoid],\n  "strategic_ground": [array of strings — specific levers discussed, recommendations made, decisions reached],\n  "unresolved_threads": [array of strings — open questions, problems named but not solved, things left hanging]\n}\n\nConversation:\n${formatted}` }],
  });
  const m = response.content[0].text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("compressSession: non-JSON response");
  return JSON.parse(m[0]);
}


// ---- setup interview helpers, copied from the Bridge ----
export async function generateIntakeFollowUp(questionText, answer, instruction) {
  const soul = getSoulPrimer();
  const prompt = `You are interviewing a small business owner, one question at a time. You just asked: "${questionText}". They answered: "${answer}". ${instruction}

Ask exactly one short follow-up question in your own voice. Output only the question — no preamble, no explanation, nothing else.`;

  const messages = [
    ...(soul ? [{ role: 'user', content: '.' }, { role: 'assistant', content: soul }] : []),
    { role: 'user', content: prompt }
  ];

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 150,
    messages
  });
  const t = response.content.find(b => b.type === 'text');
  return stripMarkdown(t ? t.text : '').trim();
}

export async function generateBenchmark(answers) {
  const get = (f) => (answers && answers[f]) ? answers[f] : '';

  const prompt = `A member has completed enough of their intake to set their benchmark. Using their own words, write 3 to 5 success statements that capture what they are working toward. Each statement must be drawn directly from what they said — not reworded into abstractions. If they said "take a Saturday off without everything falling apart," that is the statement, not "operational independence."

CRITICAL SCOPE: These statements are the member's goals for the next six months of working together — the things that, when reached, mean their business is in a genuinely thriving spot as THEY define it. Draw them primarily from the member's near-term target below. Every statement must be something that can meaningfully move within roughly six months to a year.

The member's long-term vision (three-to-five years) is provided only as background — it tells you where they ultimately want to go. Do NOT turn the long-term vision into goal statements. Anything that cannot move in the six-month window — selling the business, exiting, retiring, passing it to family — is context, not a goal. Keep every statement on what thriving looks like in the near term.

Give each statement a starting rating from 1 to 10 reflecting where they are NOW (these should be low — they reflect the current gap, not the goal).

Also return a hidden_metrics object summarizing their operational baseline for internal use.

Return ONLY JSON, no markdown:
{
  "statements": [ { "statement": "their words", "starting_rating": 3 } ],
  "hidden_metrics": {
    "annual_revenue": "", "knows_break_even": "", "cash_runway": "",
    "raised_prices": "", "knows_margin": "", "customer_concentration": "",
    "time_trapped": "", "isolation": ""
  }
}

PRIMARY GOAL SOURCE — their near-term target (best realistic position ~a year out): ${get('graduation_target')}
What they want from working together: ${get('desired_outcome')}
What their actual life would look like in success: ${get('life_success_definition')}

BACKGROUND ONLY — their long-term three-to-five year vision (do not make goals from this): ${get('north_star')}

Operational baseline:
- Annual revenue: ${get('annual_revenue')}
- Break-even known: ${get('break_even')}
- Cash runway: ${get('cash_runway')}
- Raised prices recently: ${get('pricing_history')}
- Profit margin known: ${get('profit_margin')}
- Customer concentration: ${get('customer_concentration')}
- Time usage: ${get('time_usage')}
- Support network: ${get('support_network')}
- Peer network: ${get('peer_network')}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: 'You extract a member benchmark from intake answers. Use the member\'s own language. Return only a JSON object — no markdown, no backticks, no prose.',
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('generateBenchmark: non-JSON response: ' + text.substring(0, 200));
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.statements)) parsed.statements = [];
  // Clamp to 3-5 and sane ratings.
  parsed.statements = parsed.statements.slice(0, 5).map(s => ({
    statement: String(s.statement || '').trim(),
    starting_rating: Math.min(10, Math.max(1, parseInt(s.starting_rating, 10) || 2))
  })).filter(s => s.statement);
  return parsed;
}

export const _test = { caseStudies, getSystemPrompt };
