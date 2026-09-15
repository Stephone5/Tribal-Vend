// Interactive charts (Apache ECharts, served from this app).
// One behavior everywhere: touch or drag across a chart and the values for that
// spot show in a readout above the plot, where a finger can't cover them.
// The library loads once, the first time a chart scrolls into view.

let loading = null;
function loadLib() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (!loading) loading = new Promise((ok, bad) => {
    const s = document.createElement("script");
    s.src = "echarts.min.js"; s.onload = () => ok(window.echarts); s.onerror = () => { loading = null; bad(new Error("chart library didn't load")); };
    document.head.appendChild(s);
  });
  return loading;
}

const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
export function palette() {
  return {
    text: cssVar("--on-surface"), muted: cssVar("--on-surface-variant"), line: cssVar("--outline-variant"),
    primary: cssVar("--primary"), good: cssVar("--success") || cssVar("--primary"), bad: cssVar("--error"),
    tertiary: cssVar("--tertiary") || cssVar("--secondary"), surface: cssVar("--surface-c-high") || cssVar("--surface"),
  };
}

const live = new Set();
// Re-draw every chart when the phone switches light/dark.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => setTimeout(() => live.forEach(c => c.redraw()), 50));

// mountChart(host, build, { height, readout(params) -> html, onTap(index) })
// build(pal) returns an ECharts option. The readout sits above the chart; it
// shows the latest point until you touch the chart.
export function mountChart(host, build, { height = 220, readout, onTap, initial } = {}) {
  host.classList.add("ichart");
  host.innerHTML = `<div class="ichart-read" aria-live="polite"></div><div class="ichart-plot" style="height:${height}px;touch-action:pan-y"><div class="skel" style="height:100%;border-radius:12px"></div></div>`;
  const read = host.querySelector(".ichart-read"), plot = host.querySelector(".ichart-plot");
  let chart = null, ro = null;
  const setRead = i => { if (readout) read.innerHTML = readout(i); };
  const handle = {
    redraw() { if (!chart) return; chart.setOption(build(palette()), true); },
    dispose() { live.delete(handle); ro && ro.disconnect(); chart && chart.dispose(); },
  };
  if (initial != null) setRead(initial);

  const start = async () => {
    let ec;
    try { ec = await loadLib(); }
    catch (e) { plot.innerHTML = `<div class="t-body-m muted" style="padding:16px">Couldn't load the chart. Pull down to try again.</div>`; return; }
    if (!host.isConnected) return;
    plot.innerHTML = "";
    chart = ec.init(plot, null, { renderer: "canvas" });
    const opt = build(palette());
    opt.tooltip = Object.assign({
      trigger: "axis", triggerOn: "mousemove|click", confine: true, showContent: false,
      axisPointer: { type: "line", lineStyle: { color: palette().muted, width: 1 }, snap: true },
    }, opt.tooltip || {});
    chart.setOption(opt);
    // Own touch handling: a finger (or mouse) on the plot picks the nearest point,
    // moves the guide line there and updates the readout. A quick tap with little
    // movement counts as a tap on that point.
    const n = (opt.xAxis?.data || []).length;
    const idxAt = ev => {
      const r = plot.getBoundingClientRect();
      const px = [ev.clientX - r.left, ev.clientY - r.top];
      const x = chart.convertFromPixel({ gridIndex: 0 }, [px[0], r.height / 2])[0];
      return Math.max(0, Math.min(n - 1, Math.round(x)));
    };
    const show = i => { const x = chart.convertToPixel({ gridIndex: 0 }, [i, 0])[0]; chart.dispatchAction({ type: "showTip", x, y: plot.clientHeight / 2 }); setRead(i); };
    let down = null;
    plot.addEventListener("pointerdown", ev => { down = { x: ev.clientX, y: ev.clientY, t: Date.now(), moved: false }; show(idxAt(ev)); }, true);
    plot.addEventListener("pointermove", ev => {
      if (ev.pointerType === "mouse" && !down) { show(idxAt(ev)); return; }
      if (!down) return;
      if (Math.abs(ev.clientX - down.x) > 8) down.moved = true;
      show(idxAt(ev));
    }, true);
    const up = ev => {
      if (down && !down.moved && Math.abs(ev.clientY - down.y) < 10 && Date.now() - down.t < 500 && onTap) { const i = idxAt(ev); setTimeout(() => onTap(i), 80); } // after the tap's own click, so it can't land on the new sheet
      down = null;
    };
    plot.addEventListener("pointerup", up, true);
    plot.addEventListener("pointercancel", () => { down = null; }, true);
    plot.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") { chart.dispatchAction({ type: "hideTip" }); if (initial != null) setRead(initial); } });
    ro = new ResizeObserver(() => chart && chart.resize());
    ro.observe(plot);
    live.add(handle);
  };

  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: "200px" });
  io.observe(host);
  return handle;
}

// Shared axis styling so every chart looks the same.
export function axes(pal, labels, { money = true, yMin } = {}) {
  return {
    grid: { left: 4, right: 8, top: 12, bottom: 4, containLabel: true },
    xAxis: {
      type: "category", data: labels, boundaryGap: true,
      axisLine: { lineStyle: { color: pal.line } }, axisTick: { show: false },
      axisLabel: { color: pal.muted, fontSize: 12, hideOverlap: true },
    },
    yAxis: {
      type: "value", min: yMin, splitNumber: 3,
      splitLine: { lineStyle: { color: pal.line, opacity: .6 } },
      axisLabel: { color: pal.muted, fontSize: 12, formatter: v => money ? (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `$${v}`) : v },
    },
  };
}
