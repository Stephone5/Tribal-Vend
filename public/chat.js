// Ask — Earl, the mentor from the Bridge, living in this app. His conversation
// and memory live in his own database on the server; this screen just shows it.

import { apiFetch } from "./api.js";
import { icon, setTabSub, confirmDialog, snackbar, sheet, pullToRefresh } from "./ui.js";

const el = h => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };

let msgs = [], loaded = false, loadError = null, preNote = null, setupInfo = null;
let ROOT = null, injected = false, sending = false;

function injectStyles() {
  if (injected) return; injected = true;
  document.head.appendChild(el(`<style>
    #chat{padding-bottom:88px}
    .ch-msgs{display:flex; flex-direction:column; gap:8px; padding:8px 0 16px; min-height:40dvh}
    .ch-b{max-width:85%; padding:10px 16px; font-size:16px; line-height:24px; letter-spacing:.031em; word-wrap:break-word; overflow-wrap:anywhere}
    .ch-me{align-self:flex-end; background:var(--primary); color:var(--on-primary); border-radius:20px 20px 4px 20px; white-space:pre-wrap}
    .ch-ai{align-self:flex-start; background:var(--surface-c-high); color:var(--on-surface); border-radius:20px 20px 20px 4px}
    .ch-ai p{margin:0 0 8px} .ch-ai p:last-child,.ch-ai .ch-l:last-child{margin-bottom:0}
    .ch-ai strong{font-weight:500}
    .ch-ai code{background:var(--surface-c-highest); border-radius:4px; padding:1px 5px; font-size:14px; font-family:"Roboto Mono",ui-monospace,monospace}
    .ch-ai .ch-h{font-size:16px; font-weight:500; margin:12px 0 4px} .ch-ai .ch-h:first-child{margin-top:0}
    .ch-ai .ch-l{margin:0 0 8px; padding-left:22px} .ch-ai .ch-l li{margin:4px 0}
    .ch-think{align-self:flex-start; display:flex; gap:4px; padding:14px 16px; background:var(--surface-c-high); border-radius:20px 20px 20px 4px}
    .ch-dot{width:8px; height:8px; border-radius:50%; background:var(--on-surface-variant); animation:chb 1.2s infinite}
    .ch-dot:nth-child(2){animation-delay:.15s} .ch-dot:nth-child(3){animation-delay:.3s}
    @keyframes chb{0%,60%,100%{opacity:.25; transform:none}30%{opacity:1; transform:translateY(-2px)}}
    .ch-time{align-self:center; font-size:12px; color:var(--on-surface-variant); margin:8px 0}
    .ch-bar{position:fixed; left:0; right:0; z-index:32; bottom:calc(var(--nav-h) + env(safe-area-inset-bottom)); background:var(--surface); padding:8px 8px 8px 16px; display:flex; gap:8px; align-items:flex-end; max-width:720px; margin:0 auto; box-shadow:0 -1px 0 var(--outline-variant)}
    body.kbd .ch-bar{bottom:0}
    #chat[hidden] ~ .ch-bar, body:not(:has(#chat:not([hidden]))) .ch-bar{display:none}
    .ch-bar textarea{flex:1; min-height:48px; max-height:140px; resize:none; border:0; border-radius:24px; background:var(--surface-c-high); color:var(--on-surface); padding:12px 16px; font-size:16px; line-height:24px}
    .ch-bar textarea:focus{box-shadow:inset 0 0 0 2px var(--primary)}
    .ch-send{width:48px; height:48px; flex:none; border:0; border-radius:var(--r-full); background:var(--primary); color:var(--on-primary); display:inline-flex; align-items:center; justify-content:center; cursor:pointer}
    .ch-send:disabled{background:var(--surface-c-highest); color:var(--on-surface-variant); opacity:.6}
    .ch-send .ic{width:22px; height:22px}
    .ch-top{display:flex; justify-content:flex-end; margin:4px 0}
    .ch-note{align-self:center; max-width:90%; text-align:center; font-size:13px; line-height:18px; color:var(--on-surface-variant); margin:6px 0}
    .ch-err{align-self:stretch; background:var(--error-container); color:var(--on-error-container); border-radius:12px; padding:12px 16px; font-size:14px; line-height:20px}
    .ch-err button{margin-top:8px}
  </style>`));
}

// Escape first, then apply formatting — so nothing in a reply can inject markup.
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Minimal markdown → HTML: bold, italic, code, headings, bullet and numbered lists.
function mdToHtml(src) {
  const lines = escHtml(String(src)).replace(/\r\n/g, "\n").split("\n");
  const inline = t => t
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>")
    .replace(/`([^`\n]+?)`/g, "<code>$1</code>");

  const out = [];
  let list = null; // "ul" | "ol"
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (let raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<div class="ch-h">${inline(h[2])}</div>`); continue; }

    const ul = line.match(/^[-*•]\s+(.*)$/);
    if (ul) {
      if (list !== "ul") { closeList(); out.push('<ul class="ch-l">'); list = "ul"; }
      out.push(`<li>${inline(ul[1])}</li>`); continue;
    }
    const ol = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (ol) {
      if (list !== "ol") { closeList(); out.push('<ol class="ch-l">'); list = "ol"; }
      out.push(`<li>${inline(ol[2])}</li>`); continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join("");
}

function bubble(role, text) {
  if (role === "system_note") return el(`<div class="ch-note">${escHtml(text)}</div>`);
  const b = el(`<div class="ch-b ${role === "user" ? "ch-me" : "ch-ai"}"></div>`);
  if (role === "user") b.textContent = text;
  else b.innerHTML = mdToHtml(text);
  return b;
}

async function loadHistory() {
  try {
    const r = await apiFetch("/api/earl/history");
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.message || `HTTP ${r.status}`);
    msgs = b.messages || [];
    preNote = b.preConversation || null;
    loadError = null;
    try { const sr = await apiFetch("/api/earl/interview/state"); if (sr.ok) setupInfo = await sr.json(); } catch (e) {}
  } catch (e) {
    loadError = e.message || "Couldn't load your conversation with Earl.";
  }
  loaded = true;
}

export async function renderChat(rootEl) {
  injectStyles();
  ROOT = rootEl;
  pullToRefresh(rootEl, async () => { if (sending) return; await loadHistory(); paint(false); });
  if (!loaded || loadError) { paint(true); await loadHistory(); }
  paint(false);
}

function paint(loading) {
  ROOT.innerHTML = "";
  setTabSub("chat", "");
  const wrap = el(`<div class="ch-wrap"></div>`);
  const top = el(`<div class="ch-top"><button class="btn text inline" data-setup>${icon("info")}Setup${setupInfo && !setupInfo.done ? ` ${setupInfo.progress.answered}/${setupInfo.progress.total}` : ""}</button><button class="btn text inline" data-goals>${icon("check")}Goals &amp; steps</button></div>`);
  top.querySelector("[data-setup]").onclick = openInterview;
  top.querySelector("[data-goals]").onclick = openGoals;
  wrap.appendChild(top);
  const list = el(`<div class="ch-msgs" role="log" aria-live="polite"></div>`);

  if (loading) list.appendChild(thinkingEl());
  else if (loadError) {
    const e = el(`<div class="ch-err"><b>Earl isn't available.</b><br>${escHtml(loadError)}<br><button class="btn outlined inline">Try again</button></div>`);
    e.querySelector("button").onclick = async () => { paint(true); await loadHistory(); paint(false); };
    list.appendChild(e);
  } else {
    if (setupInfo && !setupInfo.stages.stage_1) {
      const card = el(`<div class="ch-err" style="background:var(--secondary-container);color:var(--on-secondary-container)"><b>Start with Earl's setup questions.</b><br>The first stage takes about five minutes and tells Earl who you are and what you want from the business.<br><button class="btn filled inline">Start setup</button></div>`);
      card.querySelector("button").onclick = openInterview;
      list.appendChild(card);
    }
    msgs.forEach(m => list.appendChild(bubble(m.role, m.content)));
    if (preNote && !sending) list.appendChild(el(`<div class="ch-note">Last time: ${escHtml(preNote)}</div>`));
  }
  wrap.appendChild(list);

  let bar = document.querySelector(".ch-bar");
  if (bar) bar.remove();
  bar = el(`<div class="ch-bar"></div>`);
  const ta = el(`<textarea rows="1" placeholder="Talk to Earl" aria-label="Message"></textarea>`);
  const btn = el(`<button class="ch-send" aria-label="Send" disabled>${icon("send")}</button>`);
  const sync = () => { btn.disabled = sending || loading || !!loadError || !ta.value.trim(); };
  ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; sync(); };
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) { e.preventDefault(); if (ta.value.trim()) send(ta.value.trim()); } };
  btn.onclick = () => { if (ta.value.trim()) send(ta.value.trim()); };
  bar.appendChild(ta); bar.appendChild(btn);
  document.body.appendChild(bar);
  ROOT.appendChild(wrap);
  ROOT._sync = sync;
  ROOT._list = list; ROOT._ta = ta; ROOT._btn = btn;
  if (sending) { btn.disabled = true; list.appendChild(thinkingEl()); }
  sync();
  const toBottom = () => window.scrollTo(0, document.body.scrollHeight);
  requestAnimationFrame(() => requestAnimationFrame(toBottom));
  setTimeout(toBottom, 60);
}

function thinkingEl() {
  return el(`<div class="ch-think" aria-label="Earl is thinking"><span class="ch-dot"></span><span class="ch-dot"></span><span class="ch-dot"></span></div>`);
}

async function send(text) {
  if (sending) return;
  sending = true;
  const list = ROOT._list, ta = ROOT._ta, btn = ROOT._btn;
  list.querySelectorAll(".ch-note").forEach(n => n.remove());
  preNote = null;
  msgs.push({ role: "user", content: text });
  list.appendChild(bubble("user", text));
  ta.value = ""; ta.style.height = "auto"; btn.disabled = true;
  list.appendChild(thinkingEl());
  window.scrollTo(0, document.body.scrollHeight);

  let reply = null, failure = null;
  try {
    const r = await apiFetch("/api/earl/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
    const b = await r.json().catch(() => ({}));
    if (r.ok && b.response) reply = b.response;
    else failure = b.message || `Earl couldn't answer (HTTP ${r.status}).`;
  } catch (e) {
    failure = "Couldn't reach the server. Your message wasn't sent.";
  }
  sending = false;
  if (reply) msgs.push({ role: "assistant", content: reply });

  const listNow = ROOT && ROOT._list;
  if (listNow && listNow.isConnected) {
    listNow.querySelectorAll(".ch-think").forEach(t => t.remove());
    if (reply) listNow.appendChild(bubble("assistant", reply));
    else {
      const e = el(`<div class="ch-err">${escHtml(failure)}<br><button class="btn outlined inline">Send again</button></div>`);
      e.querySelector("button").onclick = () => { e.remove(); msgs.pop(); listNow.lastElementChild && listNow.lastElementChild.classList.contains("ch-me") && listNow.lastElementChild.remove(); send(text); };
      listNow.appendChild(e);
    }
    if (ROOT._sync) ROOT._sync();
    window.scrollTo(0, document.body.scrollHeight);
  } else if (failure) snackbar(failure);
}

// ---------- setup interview (Earl's questions, same as the Bridge) ----------
async function openInterview() {
  const body = el(`<div></div>`);
  const sh = sheet({ title: "Setup", sub: "Earl's questions about you and the business", body, full: true, onClose: () => { if (ROOT && !sending) loadHistory().then(() => paint(false)); } });
  const post = async (url, data) => {
    const r = await apiFetch(url, data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : undefined);
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.message || `HTTP ${r.status}`);
    return b;
  };
  const wait = () => { body.innerHTML = `<div class="ch-think" style="margin:24px auto"><span class="ch-dot"></span><span class="ch-dot"></span><span class="ch-dot"></span></div>`; };
  const fail = (msg, retry) => { body.innerHTML = ""; const e = el(`<div class="ch-err">${escHtml(msg)}<br><button class="btn outlined inline">Try again</button></div>`); e.querySelector("button").onclick = retry; body.appendChild(e); };

  const show = (st, note) => {
    body.innerHTML = "";
    if (note) body.appendChild(el(`<div class="card" style="white-space:pre-wrap">${escHtml(note)}</div>`));
    if (st.goalsReady) {
      const g = el(`<div class="card"><b>Earl drafted your goals.</b> Review them under Goals &amp; steps.<br><button class="btn tonal inline" style="margin-top:8px">Review goals</button></div>`);
      g.querySelector("button").onclick = () => { sh.close(); setTimeout(openGoals, 240); };
      body.appendChild(g);
    }
    if (st.done) { body.appendChild(el(`<div class="empty">You've answered every setup question. Earl has the full picture.</div>`)); return; }
    const q = st.question, isFollow = !!st.followUp;
    body.appendChild(el(`<p class="money-s" style="margin:8px 4px">Stage ${st.stage || ""} · ${st.progress ? `${st.progress.answered} of ${st.progress.total} answered` : ""}</p>`));
    if (st.framing) body.appendChild(el(`<div class="card" style="white-space:pre-wrap">${escHtml(st.framing)}</div>`));
    body.appendChild(el(`<div class="ch-b ch-ai" style="max-width:100%;margin:12px 0">${escHtml(isFollow ? st.followUp : q.text)}</div>`));
    const ta = el(`<textarea rows="5" aria-label="Your answer" style="width:100%;box-sizing:border-box;border:0;border-radius:16px;background:var(--surface-c-high);color:var(--on-surface);padding:12px 16px;font-size:16px;line-height:24px;resize:vertical"></textarea>`);
    if (!isFollow && q.draft) {
      body.appendChild(el(`<p class="money-s" style="margin:0 4px 6px">Filled in from your app numbers. Change it or add to it before you send it.</p>`));
      ta.value = q.draft;
    }
    const go = el(`<button class="btn filled" style="margin-top:12px" disabled>Next</button>`);
    ta.oninput = () => { go.disabled = !ta.value.trim(); };
    go.disabled = !ta.value.trim();
    go.onclick = async () => {
      const answer = ta.value.trim(); if (!answer) return;
      wait();
      try {
        const r = await post("/api/earl/interview/answer", { field: q.field, answer, isFollowUp: isFollow });
        if (r.followUp) show({ ...st, followUp: r.followUp, framing: null, goalsReady: false });
        else show({ ...r, question: r.question }, r.stageComplete);
      } catch (e) { fail(e.message, () => show(st)); }
    };
    body.append(ta, go);
    setTimeout(() => ta.focus(), 300);
  };
  const start = async () => {
    wait();
    try { const st = await post("/api/earl/interview/state"); show(st); }
    catch (e) { fail(`Couldn't load the setup questions: ${e.message}`, start); }
  };
  start();
}

// ---------- goals & action steps (Earl saves these; you can add and edit your own) ----------
async function openGoals() {
  const body = el(`<div></div>`);
  sheet({ title: "Goals & steps", sub: "What you're working toward and what you said you'd do", body, full: true });
  const call = async (url, data, method = "POST") => {
    const r = await apiFetch(url, data !== undefined ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : undefined);
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.message || `HTTP ${r.status}`);
    return b;
  };
  let goals = [], steps = [];
  const load = async () => {
    body.innerHTML = `<div class="ch-think" style="margin:24px auto"><span class="ch-dot"></span><span class="ch-dot"></span><span class="ch-dot"></span></div>`;
    try {
      const [g, s] = await Promise.all([call("/api/earl/goals"), call("/api/earl/action-steps")]);
      goals = g.goals || [];
      steps = [...(s.active || []), ...(s.completed || []), ...(s.did_not_happen || [])];
      draw();
    } catch (e) { body.innerHTML = ""; body.appendChild(el(`<div class="ch-err">Couldn't load goals and steps: ${escHtml(e.message)}</div>`)); }
  };
  const act = async (fn, msg) => { try { await fn(); if (msg) snackbar(msg); await load(); } catch (e) { snackbar("Couldn't save: " + e.message); } };

  const addForm = (placeholder, button, onSave, extra) => {
    const f = el(`<div style="display:flex;gap:8px;align-items:flex-end;margin:8px 0 4px;flex-wrap:wrap"></div>`);
    const inp = el(`<textarea rows="1" placeholder="${escHtml(placeholder)}" aria-label="${escHtml(placeholder)}" style="flex:1;min-width:200px;min-height:48px;border:0;border-radius:24px;background:var(--surface-c-high);color:var(--on-surface);padding:12px 16px;font-size:16px;line-height:24px;resize:none"></textarea>`);
    const b = el(`<button class="btn tonal" disabled>${escHtml(button)}</button>`);
    inp.oninput = () => { b.disabled = !inp.value.trim(); inp.style.height = "auto"; inp.style.height = Math.min(140, inp.scrollHeight) + "px"; };
    b.onclick = () => { const v = inp.value.trim(); if (v) onSave(v, extra ? extra.value : null); };
    f.append(inp);
    if (extra) f.append(extra);
    f.append(b);
    return f;
  };
  const stepRow = s => {
    const done = s.status !== "active";
    const row = el(`<div class="row"><div class="nm" style="${done ? "text-decoration:line-through;color:var(--on-surface-variant)" : ""}">${escHtml(s.step_text)}<div class="mt">${s.status === "did_not_happen" ? "Didn't happen · " : ""}${new Date(s.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}${s.target_date ? ` · by ${escHtml(s.target_date)}` : ""}</div></div></div>`);
    const b = done ? el(`<button class="btn text inline">Reopen</button>`) : el(`<button class="icon-btn" aria-label="Mark done">${icon("check")}</button>`);
    b.onclick = () => act(() => call(`/api/earl/action-steps/${s.id}/status`, { status: done ? "active" : "completed" }), done ? "Reopened" : "Marked done");
    row.appendChild(b);
    return row;
  };

  const draw = () => {
    body.innerHTML = "";
    body.appendChild(el(`<h2 class="sec-h" style="margin-top:8px">Goals</h2>`));
    if (!goals.length) body.appendChild(el(`<p class="money-s" style="margin:0 4px 8px">No goals yet. Earl drafts them when you finish Stage 2 of setup, or add your own.</p>`));
    goals.forEach(g => {
      const c = el(`<div class="card"></div>`);
      const head = el(`<div style="display:flex;gap:8px;align-items:flex-start"><div style="flex:1;font-size:16px;line-height:24px;${g.completed_at ? "text-decoration:line-through;color:var(--on-surface-variant)" : ""}">${escHtml(g.statement)}${!g.approved ? `<div class="mt" style="color:var(--primary)">Suggested by Earl</div>` : ""}${g.completed_at ? `<div class="mt">Done</div>` : ""}</div></div>`);
      const acts = el(`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px"></div>`);
      const btn = (label, fn, kind = "text") => { const b = el(`<button class="btn ${kind} inline">${label}</button>`); b.onclick = fn; acts.appendChild(b); };
      if (!g.approved) btn("Keep", () => act(() => call(`/api/earl/goals/${g.id}`, { action: "approve" }), "Goal kept"), "tonal");
      btn("Edit", () => {
        const t = el(`<textarea rows="3" style="width:100%;box-sizing:border-box;border:0;border-radius:16px;background:var(--surface-c-high);color:var(--on-surface);padding:12px 16px;font-size:16px;line-height:24px"></textarea>`);
        t.value = g.statement;
        const save = el(`<button class="btn filled inline" style="margin-top:8px">Save</button>`);
        save.onclick = () => act(() => call(`/api/earl/goals/${g.id}`, { action: "edit", statement: t.value }), "Goal saved");
        head.replaceWith(el(`<div></div>`)); c.prepend(save); c.prepend(t); acts.remove();
      });
      btn(g.completed_at ? "Reopen" : "Mark done", () => act(() => call(`/api/earl/goals/${g.id}`, { action: g.completed_at ? "reopen" : "complete" }), g.completed_at ? "Reopened" : "Goal done"));
      btn("Remove", async () => { const ok = await confirmDialog({ title: "Remove this goal?", body: escHtml(g.statement), confirm: "Remove", danger: true }); if (ok) act(() => call(`/api/earl/goals/${g.id}`, { action: "remove" }), "Goal removed"); });
      c.append(head, acts);
      const under = steps.filter(s => s.benchmark_id === g.id);
      if (under.length) { const r = el(`<div class="rows" style="margin-top:8px"></div>`); under.forEach(s => r.appendChild(stepRow(s))); c.appendChild(r); }
      body.appendChild(c);
    });
    body.appendChild(addForm("Add a goal", "Add goal", v => act(() => call("/api/earl/goals", { statement: v }), "Goal added")));

    body.appendChild(el(`<h2 class="sec-h">Action steps</h2>`));
    const pick = el(`<select aria-label="Goal for this step" style="height:48px;border:0;border-radius:24px;background:var(--surface-c-high);color:var(--on-surface);padding:0 12px;font-size:14px;max-width:100%"><option value="">No goal</option>${goals.filter(g => !g.completed_at).map(g => `<option value="${g.id}">${escHtml(g.statement.slice(0, 40))}</option>`).join("")}</select>`);
    body.appendChild(addForm("Add an action step", "Add step", (v, goalId) => act(() => call("/api/earl/action-steps", { step_text: v, benchmark_id: goalId || null }), "Step added"), goals.length ? pick : null));
    const loose = steps.filter(s => !s.benchmark_id || !goals.some(g => g.id === s.benchmark_id));
    if (!steps.length) body.appendChild(el(`<p class="money-s" style="margin:8px 4px">No action steps yet. When you tell Earl you'll do something, he saves it here.</p>`));
    if (loose.length) { const r = el(`<div class="rows"></div>`); loose.forEach(s => r.appendChild(stepRow(s))); body.appendChild(r); }
  };
  load();
}
