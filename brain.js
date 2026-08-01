// The brain. Holds the vending-ops doctrine, gets the run data + business context,
// and returns a structured buy list + change orders. The API key lives only in the
// environment on the server — it never reaches the phone or the browser.

import Anthropic from "@anthropic-ai/sdk";
import { SLOTS, MONTHLY, FIXED_COSTS, WINDOW_LABEL } from "./finance.js";

const MODEL = process.env.BRAIN_MODEL || "claude-opus-5";

const SYSTEM = `You are the operations brain for Tribal Amenities, a two-machine vending route in State College, PA, owned by Stephen. You are head of pricing, planogram, and reordering. Stephen (or a hired route runner) is the hands and feet: he restocks, buys, transports, and pays bills. Your one job is to make the route as profitable as possible — kill what does not work, double down on what does.

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

You are talking directly with Stephen, the owner. He is the CEO; you run the desk — pricing, planogram, purchasing, and the numbers. Speak like a sharp operator who already knows his business, not like a chatbot.

Rules for these conversations:
- Answer the question asked, then stop. No preamble, no restating the question, no "great question".
- Lead with the answer or the number. Detail after.
- Every figure you cite must come from the DATA block. Never invent sales, costs, or dates. If the data doesn't cover something, say so in one line.
- Give a recommendation, not a menu of options. If you're unsure, say what you'd do and why.
- Keep it short — a few sentences unless he asks for depth. Use plain language, no jargon, no bullet-point walls unless a list is genuinely the clearest form.
- Money in dollars, plainly. Round sensibly.
- Weeks run Sunday to Saturday.
- He is winding down the Pennsylvania route and relocating the machines to Oklahoma, where locations are lined up. Factor that into advice: don't tell him to invest in PA growth or buy deep inventory he'd have to move.`;

function askContext(live, closet) {
  const lines = [];
  const S = live?.sales;
  if (S) {
    lines.push(`SALES (live from AirVend — ${S.txnCount} transactions covering ${S.spanDays} days${S.firstSale ? `, back to ${S.firstSale.slice(0, 10)}` : ""}. Weeks run Sun-Sat.)`);
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
    lines.push(`\nP&L, EVERY MONTH ON RECORD (revenue / product cost / gross / fixed / net):`);
    pl.forEach(p => lines.push(`${p.m}: $${Math.round(p.revenue)} / $${Math.round(p.cogs)} / $${Math.round(p.gross)} / $${Math.round(p.fixed)} / $${Math.round(p.net)} (bank balance $${p.balance})`));
  }
  if (S?.months?.length) {
    lines.push(`\nMACHINE SALES BY MONTH (from real transactions, first sale ${S.firstSale ? S.firstSale.slice(0, 10) : "n/a"}) — use this for seasonality:`);
    S.months.forEach(m => lines.push(`${m.m}: $${m.revenue.toFixed(2)} revenue, $${m.profit.toFixed(2)} profit, ${m.units} units`));
  }
  if (live?.fixedCosts) lines.push(`\nFIXED MONTHLY COSTS: ${live.fixedCosts.map(c => `${c.name} $${c.amount.toFixed(2)}`).join("; ")}`);
  if (live?.loan) lines.push(`\nLOAN: ${JSON.stringify(live.loan)}`);
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
