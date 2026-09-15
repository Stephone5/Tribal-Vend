// Ask — Earl, the mentor from the Bridge, living in this app. His conversation
// and memory live in his own database on the server; this screen just shows it.

import { apiFetch } from "./api.js";
import { icon, setTabSub, confirmDialog, snackbar, sheet } from "./ui.js";

const el = h => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };

let msgs = [], loaded = false, loadError = null, preNote = null;
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
  } catch (e) {
    loadError = e.message || "Couldn't load your conversation with Earl.";
  }
  loaded = true;
}

export async function renderChat(rootEl) {
  injectStyles();
  ROOT = rootEl;
  if (!loaded || loadError) { paint(true); await loadHistory(); }
  paint(false);
}

function paint(loading) {
  ROOT.innerHTML = "";
  setTabSub("chat", "Earl · knows your live numbers");
  const wrap = el(`<div class="ch-wrap"></div>`);
  const top = el(`<div class="ch-top"><button class="btn text inline">${icon("check")}Action steps</button></div>`);
  top.querySelector("button").onclick = openSteps;
  wrap.appendChild(top);
  const list = el(`<div class="ch-msgs" role="log" aria-live="polite"></div>`);

  if (loading) list.appendChild(thinkingEl());
  else if (loadError) {
    const e = el(`<div class="ch-err"><b>Earl isn't available.</b><br>${escHtml(loadError)}<br><button class="btn outlined inline">Try again</button></div>`);
    e.querySelector("button").onclick = async () => { paint(true); await loadHistory(); paint(false); };
    list.appendChild(e);
  } else {
    if (!msgs.length) list.appendChild(el(`<div class="ch-note">This is Earl. He can see your live sales, costs, inventory, the loan and the books, and he remembers your conversations.</div>`));
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

// ---------- action steps (Earl saves these when you commit to something) ----------
async function openSteps() {
  const body = el(`<div><div class="ch-think" style="margin:16px auto"><span class="ch-dot"></span><span class="ch-dot"></span><span class="ch-dot"></span></div></div>`);
  const sh = sheet({ title: "Action steps", sub: "What you told Earl you'd do", body, full: true });
  let data;
  try {
    const r = await apiFetch("/api/earl/action-steps");
    data = await r.json();
    if (!r.ok) throw new Error(data.message || `HTTP ${r.status}`);
  } catch (e) {
    body.innerHTML = `<div class="ch-err">Couldn't load action steps: ${escHtml(e.message)}</div>`;
    return;
  }
  const draw = () => {
    body.innerHTML = "";
    const section = (title, steps, open) => {
      if (!steps.length) return;
      body.appendChild(el(`<h2 class="sec-h">${escHtml(title)}</h2>`));
      const rows = el(`<div class="rows"></div>`);
      steps.forEach(s => {
        const row = el(`<div class="row"><div class="nm">${escHtml(s.step_text)}<div class="mt">${new Date(s.created_at).toLocaleDateString([], { month: "short", day: "numeric" })}${s.target_date ? ` · by ${escHtml(s.target_date)}` : ""}</div></div></div>`);
        if (open) {
          const done = el(`<button class="icon-btn" aria-label="Mark done">${icon("check")}</button>`);
          done.onclick = () => setStatus(s, "completed");
          row.appendChild(done);
        } else {
          const undo = el(`<button class="btn text inline">Reopen</button>`);
          undo.onclick = () => setStatus(s, "active");
          row.appendChild(undo);
        }
        rows.appendChild(row);
      });
      body.appendChild(rows);
    };
    if (!data.active.length && !data.completed.length && !(data.did_not_happen || []).length) body.appendChild(el(`<div class="empty">No action steps yet. When you tell Earl you'll do something, he saves it here.</div>`));
    section("Open", data.active, true);
    section("Done", data.completed, false);
    section("Didn't happen", data.did_not_happen || [], false);
  };
  const setStatus = async (s, status) => {
    try {
      const r = await apiFetch(`/api/earl/action-steps/${s.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.message || `HTTP ${r.status}`);
      for (const k of ["active", "completed", "did_not_happen"]) data[k] = (data[k] || []).filter(x => x.id !== s.id);
      (data[status] ||= []).unshift(b.step);
      draw();
      snackbar(status === "completed" ? "Marked done" : "Reopened");
    } catch (e) { snackbar("Couldn't update: " + e.message); }
  };
  draw();
}
