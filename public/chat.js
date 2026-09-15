// Ask — talk to the brain about the business, with everything it knows in context.

import { apiFetch } from "./api.js";
import { icon, setTabSub, confirmDialog, snackbar } from "./ui.js";

const el = h => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const LSK = "tv_chat_v1";

let msgs = [];
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
    .ch-clear{display:flex; justify-content:center}
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
  const b = el(`<div class="ch-b ${role === "user" ? "ch-me" : "ch-ai"}"></div>`);
  if (role === "user") b.textContent = text;
  else b.innerHTML = mdToHtml(text);
  return b;
}

function save() { try { localStorage.setItem(LSK, JSON.stringify(msgs.slice(-40))); } catch (e) {} }
function restore() { try { msgs = JSON.parse(localStorage.getItem(LSK)) || []; } catch (e) { msgs = []; } }

export function renderChat(rootEl) {
  injectStyles();
  ROOT = rootEl;
  if (!msgs.length) restore();
  paint();
}

function paint() {
  ROOT.innerHTML = "";
  setTabSub("chat", "Sees live sales, costs, inventory and the books");
  const wrap = el(`<div class="ch-wrap"></div>`);
  const list = el(`<div class="ch-msgs" role="log" aria-live="polite"></div>`);

  if (!msgs.length) {
    list.appendChild(el(`<div class="ch-b ch-ai">I can see both machines live, every sale, your costs, inventory, and the books.<br><br>Ask what to change, what's losing money, or what to buy.</div>`));
  }
  msgs.forEach(m => list.appendChild(bubble(m.role, m.content)));
  wrap.appendChild(list);
  if (msgs.length) {
    const clr = el(`<div class="ch-clear"><button class="btn text inline">Clear conversation</button></div>`);
    clr.querySelector("button").onclick = async () => {
      if (sending) return;
      const ok = await confirmDialog({ title: "Clear this conversation?", body: "Messages are removed from this phone.", confirm: "Clear", danger: true });
      if (!ok) return;
      msgs = []; save(); paint(); snackbar("Conversation cleared");
    };
    wrap.appendChild(clr);
  }

  let bar = document.querySelector(".ch-bar");
  if (bar) bar.remove();
  bar = el(`<div class="ch-bar"></div>`);
  const ta = el(`<textarea rows="1" placeholder="Ask about the business" aria-label="Message"></textarea>`);
  const btn = el(`<button class="ch-send" aria-label="Send" disabled>${icon("send")}</button>`);
  const sync = () => { btn.disabled = sending || !ta.value.trim(); };
  ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(140, ta.scrollHeight) + "px"; sync(); };
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) { e.preventDefault(); if (ta.value.trim()) send(ta.value.trim()); } };
  btn.onclick = () => { if (ta.value.trim()) send(ta.value.trim()); };
  bar.appendChild(ta); bar.appendChild(btn);
  document.body.appendChild(bar);
  ROOT.appendChild(wrap);
  ROOT._sync = sync;
  ROOT._list = list; ROOT._ta = ta; ROOT._btn = btn;
  // If a reply is still in flight (tab was switched away and back), show it.
  if (sending) { btn.disabled = true; list.appendChild(thinkingEl()); }
  sync();
  // Open at the BOTTOM of the feed (latest message). The section just un-hid, so
  // wait for layout to settle before scrolling — double rAF + a fallback tick.
  const toBottom = () => window.scrollTo(0, document.body.scrollHeight);
  requestAnimationFrame(() => requestAnimationFrame(toBottom));
  setTimeout(toBottom, 60);
}

function thinkingEl() {
  return el(`<div class="ch-think" aria-label="Thinking"><span class="ch-dot"></span><span class="ch-dot"></span><span class="ch-dot"></span></div>`);
}

async function send(text) {
  if (sending) return;                 // one reply at a time — no double-sends
  sending = true;
  const list = ROOT._list, ta = ROOT._ta, btn = ROOT._btn;
  if (!msgs.length) list.innerHTML = "";
  msgs.push({ role: "user", content: text });
  save();                              // persist the question immediately
  list.appendChild(bubble("user", text));
  ta.value = ""; ta.style.height = "auto"; btn.disabled = true;
  list.appendChild(thinkingEl());
  window.scrollTo(0, document.body.scrollHeight);

  let reply = "";
  try {
    const r = await apiFetch("/api/ask", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: msgs.slice(-16) })
    });
    const b = await r.json();
    reply = r.ok && b.reply ? b.reply : (b.message || "Something went wrong reaching the brain.");
  } catch (e) {
    reply = "Couldn't reach the server. Try again in a moment.";
  }

  msgs.push({ role: "assistant", content: reply });
  save();
  sending = false;
  // Only touch the DOM if this chat view is still on screen. If the tab was
  // switched away, the reply is saved and paint() shows it on reopen — it isn't
  // appended to a detached, invisible list (the old lost-reply bug).
  const listNow = ROOT && ROOT._list;
  if (listNow && listNow.isConnected) {
    listNow.querySelectorAll(".ch-think").forEach(t => t.remove());
    listNow.appendChild(bubble("assistant", reply));
    if (ROOT._sync) ROOT._sync();
    window.scrollTo(0, document.body.scrollHeight);
  }
}
