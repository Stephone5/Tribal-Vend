// The brain. Holds the vending-ops doctrine, gets the run data + business context,
// and returns a structured buy list + change orders. The API key lives only in the
// environment on the server — it never reaches the phone or the browser.

import Anthropic from "@anthropic-ai/sdk";
import { SLOTS, MONTHLY, FIXED_COSTS, WINDOW_LABEL } from "./public/data.js";

const MODEL = process.env.BRAIN_MODEL || "claude-opus-5";

const SYSTEM = `You are the operations brain for Tribal Amenities, a two-machine vending route in State College, PA, owned by Stephen. You are head of pricing, planogram, and reordering. Stephen (or a hired route runner) is the hands and feet: he restocks, buys, transports, and pays bills. Your one job is to make the route as profitable as possible — kill what does not work, double down on what does.

Operating doctrine:
- The metric that matters is gross margin DOLLARS per slot per day. A slot is scarce real estate; the only question is what it earns per day it is occupied.
- Anything priced at or below its unit cost is an emergency — every sale loses money. Flag it and propose a corrected price immediately.
- Bottom performers over multiple cycles get replaced by a test product. Top performers earn a second facing and eye-level position.
- Par is a lever, not a fixed setting. Too high on a slow mover = cash and (for cold food) spoilage risk sitting idle. Too low on a fast mover = empty before the next visit and lost margin. Tune par to velocity.
- Run price tests one variable at a time so results are attributable.
- Buying is done at Sam's Club in CASES. Convert unit needs to whole cases; never tell him to buy loose units.
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
