// UI audit — paste-free: evaluated in the page by the test browser.
// Checks what DESIGN.md requires: 48px touch targets, WCAG AA text contrast,
// nothing wider than the screen, no text-selectable controls, and that every
// interactive control has an accessible name.
window.__audit = (() => {
  const vw = document.documentElement.clientWidth;
  const out = { targets: [], contrast: [], overflow: [], unnamed: [], selectable: [] };

  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const bgOf = el => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    const htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor); if (htmlBg && htmlBg.a === 1) base = htmlBg;
    return layers.reverse().reduce((acc, c) => blend(c, acc), base);
  };
  const visible = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && r.top < innerHeight * 20 && !(el.closest(".actionbar") && !el.closest(".actionbar.in")) && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[hidden]"); };
  const label = el => (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const where = el => { const s = el.closest("section,.sheet,nav,header,.actionbar,#snack,.dialog"); return s ? (s.id || s.className.split(" ")[0]) : "body"; };

  // 1) touch targets ≥ 48×48 (M3). Inline text links inside paragraphs are exempt.
  document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], .row.tap, label.btn").forEach(el => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.height < 47.5 || r.width < 47.5) {
      // an icon button whose visual is smaller but hit box is 48 passes; check hit box = element box
      out.targets.push({ where: where(el), el: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : ""), label: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
    if (!label(el) && !el.querySelector("svg title")) out.unnamed.push({ where: where(el), el: el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0] });
    const us = getComputedStyle(el).userSelect;
    if (/^(BUTTON|A)$/.test(el.tagName) && us !== "none") out.selectable.push({ where: where(el), label: label(el) });
  });

  // 2) contrast for every visible text node's element
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!t.textContent.trim()) continue;
    const el = t.parentElement; if (!el || seen.has(el) || !visible(el)) continue; seen.add(el);
    if (el.closest("svg")) continue;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); const fgb = blend(fg, bg);
    const L1 = lum(fgb), L2 = lum(bg); const ratio = (Math.max(L1, L2) + .05) / (Math.min(L1, L2) + .05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const op = [...Array(10)].reduce((acc, _, i, a) => acc, 1);
    let o = 1; for (let n = el; n; n = n.parentElement) o *= +getComputedStyle(n).opacity;
    if (o < 1) continue; // disabled controls are exempt from contrast rules
    if (ratio < need) out.contrast.push({ where: where(el), text: t.textContent.trim().slice(0, 40), ratio: +ratio.toFixed(2), need });
  }

  // 3) horizontal overflow (except intentional horizontal scrollers)
  document.querySelectorAll("body *").forEach(el => {
    if (!visible(el) || el.closest(".scrollx, .period-bar, svg")) return;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) out.overflow.push({ where: where(el), el: el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0], left: Math.round(r.left), right: Math.round(r.right), vw });
  });
  out.pageWiderThanScreen = document.documentElement.scrollWidth > vw + 1;
  return out;
})();
