// The brain. Holds the vending-ops doctrine, gets the run data + business context,
// and returns a structured buy list + change orders. The API key lives only in the
// environment on the server — it never reaches the phone or the browser.

import Anthropic from "@anthropic-ai/sdk";
import { SLOTS, MONTHLY, FIXED_COSTS, WINDOW_LABEL } from "./finance.js";

const MODEL = process.env.BRAIN_MODEL || "claude-opus-5";

const SYSTEM = `You are the operations brain for Tribal Vend, a vending business in Oklahoma City owned by Stephen Barton. It started in Pennsylvania and moved to Oklahoma in August 2026. It owns two machines: Meals & Drinks (the refrigerated machine, at American Elevator, 1905 S Harvard, OKC) and Snacks & Candy. Which machines are running right now is in the DATA block. You are head of pricing, planogram, and reordering. Stephen (or a hired route runner) is the hands and feet: he restocks, buys, transports, and pays bills. Your one job is to make the route as profitable as possible — kill what does not work, double down on what does.

Operating doctrine:
- The metric that matters is gross margin DOLLARS per slot per day. A slot is scarce real estate; the only question is what it earns per day it is occupied.
- Anything priced at or below its unit cost is an emergency — every sale loses money. Flag it and propose a corrected price immediately.
- Bottom performers over multiple cycles get replaced by a test product. Top performers earn a second facing and eye-level position.
- Par is a lever, not a fixed setting. Too high on a slow mover = cash and (for cold food) spoilage risk sitting idle. Too low on a fast mover = empty before the next visit and lost margin. Tune par to velocity.
- Run price tests one variable at a time so results are attributable.
- Buying is done at Sam's Club in CASES. Convert unit needs to whole cases; never tell him to buy loose units.
- Products loaded across several flavor slots are BOUGHT as one package, so combine them into a single buy line: all Miss Vickie's slots together, all Sun Chips together, all Snyder's together, all Gatorade together. Arizona is the exception — each Arizona flavor is its own package, so keep those separate.
- Assortment changes happen at the START of each month, not mid-cycle. Restock/reorder decisions happen every visit.

Be concrete, decisive, and brief. Give a recommendation, not a survey of options. Every number you cite must come from the data provided — never invent sales figures or costs. When you are missing data needed for a call, say so plainly rather than guessing.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", description: "One or two sentences: the state of this run and the single most important thing to do." },
    reconciliation: { type: "string", description: "What the reported par gaps imply about actual machine inventory vs. what the system thought." },
    buyList: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          item: { type: "string" },
          slot: { type: "string" },
          cases: { type: "integer" },
          units: { type: "integer" },
          reason: { type: "string" }
        },
        required: ["item", "slot", "cases", "units", "reason"]
      }
    },
    changeOrders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["price", "planogram", "par"] },
          slot: { type: "string" },
          item: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          reason: { type: "string" }
        },
        required: ["type", "slot", "item", "from", "to", "reason"]
      }
    }
  },
  required: ["summary", "reconciliation", "buyList", "changeOrders"]
};

function businessContext() {
  const lines = SLOTS.map(s =>
    `slot ${s.slot} | ${s.item} | cost $${s.cost.toFixed(2)} | price $${s.price.toFixed(2)} | sold ${s.sold} | margin $${s.profit.toFixed(2)}`
  ).join("\n");
  const fixed = FIXED_COSTS.map(c => `${c.name}: $${c.amount.toFixed(2)}${c.note ? ` (${c.note})` : ""}`).join("; ");
  const recent = MONTHLY.slice(-4).map(m => `${m.m}: card $${m.card} + cash $${m.cash}, out $${m.debits}, balance $${m.balance}`).join("\n");
  return `MEALS & DRINKS per-slot performance (${WINDOW_LABEL}):\n${lines}\n\nFixed monthly costs: ${fixed}\n\nRecent months (bank):\n${recent}`;
}

// ---- Conversational mode: Stephen asking the desk questions ----
const ASK_SYSTEM = `${SYSTEM}

You are talking directly with Stephen, the owner.

How to answer:
- Answer the question asked, then stop. Lead with the answer or the number.
- Plain words a normal person uses. No finance or business jargon: say "money going out each month" instead of "burn" or "run rate", "payments you're behind on" instead of "arrears", "what would help most" instead of "lever". If a term needs special knowledge, use the everyday phrase.
- Never write "not X, it's Y" or any version of that flip. Never say "worth sitting with".
- Short: a few sentences unless he asks for depth. Money in dollars, rounded sensibly.

Using the data:
- Every figure must come from the DATA block. Never invent numbers, dates, or facts about his situation (what a bill is for, whether a machine is idle, what he plans to do). If you're not sure what something is, say what the data calls it.
- When the data is missing something the answer needs, say exactly what's missing in one line, then give the best answer the data does support and label which parts are estimates. Don't refuse and then give a number anyway.
- Do the math carefully and show the few numbers it rests on. Don't count the same cost twice: a month's NET already subtracts the monthly bills and the loan interest. Loan principal is separate money out and is NOT in net.
- The current month is partial. Never treat it as a full month; say how many days it covers.
- Don't add advice he didn't ask for. The one exception is something urgent in the data (like a price below cost), in one sentence. A machine that isn't running is his decision; don't lecture about it.
- For cash questions, NET is a profit figure. Cash is: last bank balance, plus money left after product each month, minus the cash money-out figure each month. Say which months you counted.
- Selling weeks run Tuesday through Monday.`;

function askContext(live, closet) {
  const lines = [];
  const S = live?.sales;
  if (S) {
    lines.push(`SALES (live from AirVend — ${S.txnCount} transactions covering ${S.spanDays} days${S.firstSale ? `, back to ${S.firstSale.slice(0, 10)}` : ""}. Weeks run Tue-Mon.)`);
    lines.push(`This week so far: $${S.thisWeek.revenue.toFixed(2)} revenue, $${S.thisWeek.profit.toFixed(2)} profit, ${S.thisWeek.units} units`);
    lines.push(`Last week total: $${S.lastWeek.revenue.toFixed(2)} revenue, $${S.lastWeek.profit.toFixed(2)} profit, ${S.lastWeek.units} units`);
    lines.push(`This month: $${S.thisMonth.revenue.toFixed(2)} rev / $${S.thisMonth.profit.toFixed(2)} profit. Last month: $${S.lastMonth.revenue.toFixed(2)} rev / $${S.lastMonth.profit.toFixed(2)} profit`);
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    lines.push(`Sales by weekday: ${S.byDow.map((v, i) => `${dow[i]} $${Math.round(v)}`).join(", ")}`);
    lines.push(`Recent weekly profit: ${S.weeks.slice(-8).map(w => `${w.w} $${Math.round(w.profit)}`).join(", ")}`);
  }
  for (const m of live?.machines || []) {
    lines.push(`\nMACHINE: ${m.name} (${m.slots.length} slots)`);
    lines.push(`slot | product | price | cost | on-hand/par | units(${S ? S.spanDays + "d" : "window"}) | units/day | $/day at today's price | notes`);
    for (const s of m.slots) {
      const notes = [];
      if (s.belowCost) notes.push("BELOW COST");
      if (s.stockedOut) notes.push("SOLD OUT NOW");
      if (s.priceChanged) notes.push(`price was $${(s.avgPrice || 0).toFixed(2)}`);
      lines.push(`${s.slot} | ${s.product} | $${s.price.toFixed(2)} | ${s.cost == null ? "unknown" : "$" + s.cost.toFixed(2)} | ${s.onHand}/${s.max} | ${s.units} | ${(s.unitsPerDay || 0).toFixed(2)} | ${s.perDay == null ? "n/a" : "$" + s.perDay.toFixed(2)}${notes.length ? " | " + notes.join("; ") : ""}`);
    }
  }
  if (closet?.items?.length) {
    lines.push(`\nCLOSET (backstock you already own):`);
    closet.items.forEach(i => lines.push(`${i.name} (${i.folder}): ${i.qty} units @ $${Number(i.price).toFixed(2)}${i.min !== "" && i.min != null ? `, low at ${i.min}` : ""}`));
    const tv = closet.items.reduce((a, i) => a + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
    lines.push(`Closet total: ${closet.items.reduce((a, i) => a + (Number(i.qty) || 0), 0)} units, $${tv.toFixed(2)} tied up`);
  }
  const pl = live?.pl || [];
  if (pl.length) {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const curLabel = now.toLocaleString("en-US", { month: "short" }) + " " + String(now.getFullYear()).slice(2);
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    lines.push(`\nPROFIT & LOSS BY MONTH. Columns: sales / product cost / left after product / monthly bills + loan interest / NET. Net = left after product minus bills and loan interest. Loan principal is not in net.`);
    pl.forEach(p => lines.push(`${p.m}: $${Math.round(p.revenue)} / $${Math.round(p.cogs)} / $${Math.round(p.gross)} / $${Math.round(p.fixed)} / $${Math.round(p.net)}${p.m === curLabel ? ` (PARTIAL MONTH: day ${now.getDate()} of ${daysIn}; bills are counted for the whole month)` : ""}`));
    const banked = (live.monthly || []).filter(m => m.balance != null);
    const lastBank = banked[banked.length - 1];
    lines.push(`\nCASH IN THE BANK: the bank account is not connected to the app. Last balance on file: $${lastBank ? lastBank.balance : "unknown"} at the end of ${lastBank ? lastBank.m : "unknown"}. No bank data after that, so any cash figure after ${lastBank ? lastBank.m : "then"} is an estimate.`);
  }
  const R = live?.restock;
  if (R && !R.error) {
    const running = (R.machines || []).map(m => m.name);
    const parked = (live.machines || []).map(m => m.name).filter(n => !running.includes(n));
    lines.push(`\nMACHINES RUNNING (restocked in the last 21 days): ${running.join(", ") || "none"}.${parked.length ? ` Not restocked in over 21 days: ${parked.join(", ")}.` : ""}`);
    lines.push(`Since the last restock (${R.restockedAt.slice(0, 16).replace("T", " ")}): $${R.revenue.toFixed(2)} sales, $${R.profit.toFixed(2)} profit, ${R.units} sold${R.pct != null ? `; ${R.pct >= 0 ? "+" : ""}${R.pct.toFixed(0)}% vs the same hours after the previous ${R.priorCount} restocks` : ""}.`);
  }
  if (S?.months?.length) {
    lines.push(`\nMACHINE SALES BY MONTH (from real transactions, first sale ${S.firstSale ? S.firstSale.slice(0, 10) : "n/a"}) — use this for seasonality:`);
    S.months.forEach(m => lines.push(`${m.m}: $${m.revenue.toFixed(2)} revenue, $${m.profit.toFixed(2)} profit, ${m.units} units`));
  }
  if (S?.monthlyByCategory?.length) {
    const cats = ["energy", "soda", "sports/water", "cold food", "chips", "candy", "pastry", "other"];
    lines.push(`\nUNITS SOLD BY CATEGORY BY MONTH (real transactions) — this IS the seasonal decomposition; use it to say which categories carry which months:`);
    lines.push(`month | ${cats.join(" | ")}`);
    S.monthlyByCategory.forEach(r => lines.push(`${r.m} | ${cats.map(c => r[c] || 0).join(" | ")}`));
  }
  if (live?.fixedCosts) lines.push(`\nMONTHLY BILLS (already subtracted in each month's net): ${live.fixedCosts.map(c => `${c.name}${c.note ? ` (${c.note})` : ""} $${c.amount.toFixed(2)}`).join("; ")}`);
  const L = live?.loan;
  if (L) {
    lines.push(`\nWENDLE LOAN (from Stephen's Google Sheet${L.sheetError ? `; NOTE: couldn't read the sheet (${L.sheetError}), using ${L.stale ? "the last copy read" : "the built-in schedule"}` : ""}):`);
    lines.push(`Owed now $${(L.balance || 0).toFixed(2)} of $${L.principal || 13000}. Monthly payment $${(L.payment || 0).toFixed(2)} (part interest, part principal). Paid through payment ${L.paidThroughN} (${L.paidThrough || "none"}). Payments due but not marked paid in the sheet: ${L.behind ?? "unknown"}. Final payment ${L.payoffMonth || "unknown"} (payment ${L.payoffN}, $${L.finalAmount}). Interest still to pay: $${Math.round(L.interestLeft || 0)}.`);
    const bills = (live.fixedCosts || []).reduce((a, c) => a + c.amount, 0);
    lines.push(`MONEY OUT EACH MONTH IN CASH (use this for any cash or runway question): bills $${bills.toFixed(2)} + full loan payment $${(L.payment || 0).toFixed(2)} = $${(bills + (L.payment || 0)).toFixed(2)}. The loan payment already includes its interest, so don't add interest again. For months after the last bank balance, subtract a loan payment only if the sheet marks it paid (paid through ${L.paidThrough || "none"}). Payments not marked paid haven't left the bank; they are money still owed, so list them separately and never subtract them twice.`);
    if (L.schedule) lines.push(`Next 3 payments: ${L.schedule.filter(r => r.n > L.paidThroughN).slice(0, 3).map(r => `#${r.n} ${r.due}: $${r.principal.toFixed(2)} principal + $${r.interest.toFixed(2)} interest`).join("; ")}`);
  }
  return lines.join("\n");
}

export async function askBrain(messages, live, closet) {
  const client = new Anthropic();
  const ctx = askContext(live, closet);
  const history = (messages || []).filter(m => m && m.content).slice(-16).map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content).slice(0, 4000),
  }));
  if (!history.length) history.push({ role: "user", content: "Give me a one-line read on the business right now." });

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    system: [
      { type: "text", text: ASK_SYSTEM },
      { type: "text", text: `CURRENT DATA (as of ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern):\n\n${ctx}` },
    ],
    output_config: { effort: "medium" },
    messages: history,
  });
  return resp.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

export async function runBrain(run) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const machine = run.machine || "unknown machine";
  const gaps = Array.isArray(run.shorts) && run.shorts.length
    ? run.shorts.map(g => `slot ${g.slot} (${g.item}): short by ${g.missing} units`).join("\n")
    : "No short slots reported — machine came back full to par.";

  const userMsg =
`Service run just completed on: ${machine}.

Short slots reported by the person servicing the machine (how many units are MISSING from each; every slot not listed is full to par):
${gaps}

Business context:
${businessContext()}

Produce: (1) a one-line summary, (2) a reconciliation of what the gaps mean for real inventory, (3) a buy list in whole cases for the next refill, and (4) any price / planogram / par change orders that would earn more margin per slot per day. Only include change orders that are clearly worth making from the data.`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } }
  });

  if (resp.stop_reason === "max_tokens") {
    throw new Error("The brain ran out of room before finishing. Try again — if it keeps happening, the token budget needs raising.");
  }

  const text = resp.content.find(b => b.type === "text")?.text || "{}";
  const data = JSON.parse(text);
  data._model = resp.model;
  return data;
}
