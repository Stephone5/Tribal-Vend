// Ask — talk to the brain about the business, with everything it knows in context.

import { apiFetch } from "./api.js";

const el = h => { const t = document.createElement("template"); t.innerHTML = h.trim(); return t.content.firstChild; };
const LSK = "tv_chat_v1";

let msgs = [];
let ROOT = null, injected = false;

function injectStyles() {
  if (injected) return; injected = true;
  document.head.appendChild(el(`<style>
    .ch-wrap{display:flex;flex-direction:column;gap:12px}
    .ch-msgs{display:flex;flex-direction:column;gap:10px;min-height:40vh}
    .ch-b{max-width:88%;padding:12px 14px;border-radius:16px;font-size:14.5px;line-height:1.5;word-wrap:break-word;overflow-wrap:anywhere}
    .ch-me{align-self:flex-end;background:var(--char);color:#fff;border-bottom-right-radius:5px;white-space:pre-wrap}
    .ch-ai{align-self:flex-start;background:var(--surface);border:1px solid var(--line);border-bottom-left-radius:5px;box-shadow:var(--shadow)}
    /* formatted reply content */
    .ch-ai p{margin:0 0 9px}
    .ch-ai p:last-child,.ch-ai .ch-l:last-child{margin-bottom:0}
    .ch-ai strong{font-weight:800;color:var(--ink)}
    .ch-ai em{font-style:italic}
    .ch-ai code{background:var(--surface-2);border-radius:5px;padding:1px 5px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    .ch-ai .ch-h{font-weight:800;font-size:14.5px;margin:12px 0 6px;color:var(--ink)}
    .ch-ai .ch-h:first-child{margin-top:0}
    .ch-ai .ch-l{margin:0 0 9px;padding-left:20px}
    .ch-ai .ch-l li{margin:4px 0;padding-left:2px}
    .ch-ai .ch-l li::marker{color:var(--muted);font-weight:700}
    .ch-think{align-self:flex-start;color:var(--muted);font-size:13px;padding:8px 4px}
    .ch-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--muted);margin-right:3px;animation:chb 1.2s infinite}
    .ch-dot:nth-child(2){animation-delay:.15s}.ch-dot:nth-child(3){animation-delay:.3s}
    @keyframes chb{0%,60%,100%{opacity:.25}30%{opacity:1}}
    .ch-bar{position:sticky;bottom:calc(84px + env(safe-area-inset-bottom));background:var(--plane);padding:8px 0 4px;display:flex;gap:8px;align-items:flex-end}
    .ch-bar textarea{flex:1;resize:none;background:var(--surface);border:1px solid var(--line);color:var(--ink);border-radius:14px;padding:12px 14px;font-size:16px;font-family:inherit;max-height:120px;line-height:1.4}
    .ch-send{flex:none;width:46px;height:46px;border-radius:14px;border:0;background:var(--char);color:#fff;font-size:20px;cursor:pointer}
    .ch-send:disabled{opacity:.45}
    .ch-sugg{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:4px}
    .ch-sugg button{background:var(--surface);border:1px solid var(--line);color:var(--ink-2);border-radius:99px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer}
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
  ROOT.appendChild(el(`<h2>Ask</h2>`));
  const wrap = el(`<div class="ch-wrap"></div>`);
  const list = el(`<div class="ch-msgs"></div>`);

  if (!msgs.length) {
    list.appendChild(el(`<div class="ch-b ch-ai">I'm running the desk. I can see both machines live, every sale, your costs, closet, and the books.\n\nAsk me anything — what to change, what's leaking money, what to buy.</div>`));
  }
  msgs.forEach(m => list.appendChild(bubble(m.role, m.content)));
  wrap.appendChild(list);

  const bar = el(`<div class="ch-bar"></div>`);
  const ta = el(`<textarea rows="1" placeholder="Ask about the business…"></textarea>`);
  const btn = el(`<button class="ch-send">↑</button>`);
  ta.oninput = () => { ta.style.height = "auto"; ta.style.height = Math.min(120, ta.scrollHeight) + "px"; };
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (ta.value.trim()) send(ta.value.trim()); } };
  btn.onclick = () => { if (ta.value.trim()) send(ta.value.trim()); };
  bar.appendChild(ta); bar.appendChild(btn);

  wrap.appendChild(bar);
  ROOT.appendChild(wrap);
  ROOT._list = list; ROOT._ta = ta; ROOT._btn = btn;
  // Open at the BOTTOM of the feed (latest message). The section just un-hid, so
  // wait for layout to settle before scrolling — double rAF + a fallback tick.
  const toBottom = () => window.scrollTo(0, document.body.scrollHeight);
  requestAnimationFrame(() => requestAnimationFrame(toBottom));
  setTimeout(toBottom, 60);
}

async function send(text) {
  const list = ROOT._list, ta = ROOT._ta, btn = ROOT._btn;
  if (!msgs.length) list.innerHTML = "";
  msgs.push({ role: "user", content: text });
  list.appendChild(bubble("user", text));
  ta.value = ""; ta.style.height = "auto"; btn.disabled = true;
  const thinking = el(`<div class="ch-think"><span class="ch-dot"></span><span class="ch-dot"></span><span class="ch-dot"></span> thinking…</div>`);
  list.appendChild(thinking);
  thinking.scrollIntoView({ block: "end", behavior: "smooth" });

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
  thinking.remove();
  msgs.push({ role: "assistant", content: reply });
  list.appendChild(bubble("assistant", reply));
  save();
  btn.disabled = false;
  list.lastElementChild.scrollIntoView({ block: "end", behavior: "smooth" });
}
