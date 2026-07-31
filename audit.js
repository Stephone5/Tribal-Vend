// Data health. Runs every time the app loads and catches the kinds of problems
// that made Jack Link's look like a failing product when it wasn't.
//
// Severity: "critical" = the numbers are actively wrong or you're losing money
//           "warning"  = worth a look, numbers may mislead
//           "info"     = nothing broken, just a heads-up

export function auditData(live, closet) {
  const issues = [];
  const slots = (live?.machines || []).flatMap(m => m.slots.map(s => ({ ...s, machine: m.name })));
  const S = live?.sales;

  // --- 1. Machines that failed to load ---
  for (const m of live?.machines || []) {
    if (!m.slots.length) {
      issues.push({
        severity: "critical", code: "machine_unreachable",
        title: `${m.name} didn't load`,
        detail: "Couldn't read this machine from AirVend, so its numbers are missing entirely.",
        fix: "Usually a login or network blip. Hit Refresh; if it sticks, check the AirVend password.",
      });
    }
  }

  // --- 2. Selling at or below cost, right now ---
  const below = slots.filter(s => s.cost != null && s.price - s.cost <= 0);
  for (const s of below) {
    issues.push({
      severity: "critical", code: "below_cost",
      title: `${clean(s.product)} loses money on every sale`,
      detail: `Slot ${s.slot} in ${s.machine}: costs ${usd(s.cost)}, sells for ${usd(s.price)}.`,
      fix: `Raise the price above ${usd(s.cost)} in AirVend, or pull the item.`,
      slot: s.slot, machine: s.machine, product: s.product,
    });
  }

  // --- 3. Price drifted since the recorded sales (the Jack Link's case) ---
  // Only call it out individually when it actually distorts the numbers:
  // the old price was below cost, or the change is big (>25%).
  const drift = slots.filter(s => s.priceChanged && s.units >= 3);
  const seriousDrift = drift.filter(s => {
    const wasLosing = s.cost != null && s.avgPrice <= s.cost;
    const big = s.price > 0 && Math.abs(s.avgPrice - s.price) / s.price > 0.25;
    return wasLosing || big;
  });
  for (const s of seriousDrift) {
    const wasLosing = s.cost != null && s.avgPrice <= s.cost;
    issues.push({
      severity: wasLosing ? "warning" : "info", code: "price_drift",
      title: `${clean(s.product)} sold at a very different price`,
      detail: `${s.units} sold averaging ${usd(s.avgPrice)}, but it charges ${usd(s.price)} today${wasLosing ? ` — and ${usd(s.avgPrice)} was below its ${usd(s.cost)} cost` : ""}.`,
      fix: "Past profit for this slot is at the old price. Judge it on today's price.",
      slot: s.slot, machine: s.machine, product: s.product,
    });
  }
  // Everything else that drifted a little gets one quiet line, not fifteen.
  const minorDrift = drift.length - seriousDrift.length;
  if (minorDrift > 0) {
    issues.push({
      severity: "info", code: "minor_drift",
      title: `${minorDrift} slot${minorDrift === 1 ? " has" : "s have"} small price differences`,
      detail: "Normal drift from price changes, promos, and rounding — under 25% and never below cost.",
      fix: "Nothing to do.",
    });
  }

  // --- 3b. Margins so thin they're barely worth the slot ---
  const thin = slots.filter(s => s.cost != null && s.price > s.cost && (s.price - s.cost) / s.price < 0.20 && s.units >= 5);
  for (const s of dedupe(thin, x => x.product)) {
    issues.push({
      severity: "warning", code: "thin_margin",
      title: `${clean(s.product)} barely makes money`,
      detail: `Costs ${usd(s.cost)}, sells for ${usd(s.price)} — you keep ${usd(s.price - s.cost)} a unit, ${Math.round((s.price - s.cost) / s.price * 100)}% margin.`,
      fix: "Raise the price or give the slot to something that earns more.",
      slot: s.slot, machine: s.machine, product: s.product,
    });
  }

  // --- 4. Costs I guessed rather than verified ---
  const est = dedupe(slots.filter(s => s.costSource === "estimate"), s => s.product);
  if (est.length) {
    issues.push({
      severity: "warning", code: "estimated_costs",
      title: `${est.length} product${est.length === 1 ? " has an" : "s have"} estimated cost${est.length === 1 ? "" : "s"}`,
      detail: `These costs are my best guess, not from your records: ${est.slice(0, 8).map(s => clean(s.product)).join(", ")}${est.length > 8 ? `, +${est.length - 8} more` : ""}.`,
      fix: "Tap any product below to set what you actually pay. Every margin using it is only as good as this number.",
      products: est.map(s => ({ product: s.product, cost: s.cost, price: s.price })),
    });
  }

  // --- 5. Products with no cost at all ---
  const unknown = dedupe(slots.filter(s => s.cost == null), s => s.product);
  if (unknown.length) {
    issues.push({
      severity: "critical", code: "unknown_costs",
      title: `${unknown.length} product${unknown.length === 1 ? "" : "s"} missing a cost`,
      detail: `No cost on file, so these are left out of all profit math: ${unknown.slice(0, 8).map(s => clean(s.product)).join(", ")}${unknown.length > 8 ? `, +${unknown.length - 8} more` : ""}.`,
      fix: "Set what you pay per unit so they count toward your real profit.",
      products: unknown.map(s => ({ product: s.product, cost: null, price: s.price })),
    });
  }

  // --- 6. Sold out — sales are being lost and velocity is understated ---
  const out = slots.filter(s => s.onHand === 0 && s.units > 0);
  if (out.length) {
    const lost = out.reduce((a, s) => a + (s.perDay || 0), 0);
    issues.push({
      severity: "warning", code: "stocked_out",
      title: `${out.length} slot${out.length === 1 ? " is" : "s are"} empty right now`,
      detail: `Roughly ${usd(lost)}/day of margin isn't being earned, and these products look slower than they are because they can't sell while empty.`,
      fix: "Refill them and raise par on anything that empties before your next visit.",
      products: out.map(s => ({ product: s.product, slot: s.slot, machine: s.machine })),
    });
  }

  // --- 7. Stale sales feed ---
  if (!S) {
    issues.push({
      severity: "critical", code: "no_sales",
      title: "Live sales aren't loading",
      detail: "AirVend's report engine didn't return transactions, so trends and week-over-week are unavailable.",
      fix: "Hit Refresh. If it persists, AirVend's reporting may be down.",
    });
  } else if (S.freshAt && Date.now() - S.freshAt > 6 * 60 * 60 * 1000) {
    issues.push({
      severity: "warning", code: "stale_sales",
      title: "Sales data is a few hours old",
      detail: `Last successful pull was ${new Date(S.freshAt).toLocaleString()}.`,
      fix: "Hit Refresh to force a fresh pull.",
    });
  }

  // --- 8. Closet items priced very differently from machine costs ---
  if (closet?.items?.length) {
    for (const it of closet.items) {
      const match = slots.find(s => looseMatch(s.product, it.name));
      if (!match || match.cost == null || !it.price) continue;
      const diff = Math.abs(Number(it.price) - match.cost);
      if (diff > 0.25) {
        issues.push({
          severity: "info", code: "closet_cost_mismatch",
          title: `${it.name} costs differ between closet and machine math`,
          detail: `Closet says ${usd(it.price)}, the machine math uses ${usd(match.cost)}.`,
          fix: "Set the right one so profit numbers match what you actually pay.",
          product: match.product,
        });
      }
    }
  }

  const order = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    issues,
    counts: {
      critical: issues.filter(i => i.severity === "critical").length,
      warning: issues.filter(i => i.severity === "warning").length,
      info: issues.filter(i => i.severity === "info").length,
    },
    checkedAt: Date.now(),
    slotsChecked: slots.length,
  };
}

const usd = n => "$" + (Number(n) || 0).toFixed(2);
const clean = s => String(s || "").replace(/^(Meals|Drinks|Crackers)\s*[-:]\s*/i, "").replace(/,.*$/, "").trim().slice(0, 40);
function dedupe(arr, keyFn) { const seen = new Set(); return arr.filter(x => { const k = keyFn(x); if (seen.has(k)) return false; seen.add(k); return true; }); }
function looseMatch(a, b) {
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2);
  const A = norm(a), B = norm(b);
  if (!A.length || !B.length) return false;
  return B.some(w => A.includes(w)) && B.filter(w => A.includes(w)).length >= Math.min(2, B.length);
}
