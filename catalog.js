// Cost catalog + sales history + monthly finance.
// COSTS come from the Sortly export (real, verified). Sales velocity comes from
// the COGS workbook (Feb 21 – Jul 27 2026). Monthly money comes from the First
// National Bank statements. Live product + price data is pulled from AirVend.

// --- unit costs, matched to AirVend product names by keyword ---
// source "sams"  = actual per-unit cost from Stephen's most-recent Sam's Club
//                  receipt (pack price ÷ pack count). The truest cost we have.
// source "sortly"= from the Sortly export (real, but may be older).
// source "estimate" = my best guess, NOT verified — surfaced in the app to fix.
// [keywords, unitCost, source, note]
export const COST_RULES = [
  [["jimmy dean"], 1.17, "sams", "12ct $13.98 (Jul 26)"],
  [["hot pocket"], 0.74, "sams", "20pk $14.88 (Jul 26)"],
  [["uncrustable"], 0.62, "sams", "24pk $14.87 (Feb 26)"],
  [["c4 frozen", "c4 "], 2.33, "sortly", "not in Sam's data"],
  [["black rifle"], 1.96, "sams", "12pk $23.48 (May 26)"],
  [["celsius"], 1.33, "sams", "18pk $23.98 (Jul 26)"],
  [["java monster", "coffee + energy"], 2.02, "sortly", "not in Sam's data"],
  [["coke"], 0.92, "sams", "24pk $22.14 (May 26)"],
  [["drpepper", "dr pepper"], 0.67, "sortly", "not in Sam's data"],
  [["gatorade"], 0.75, "sams", "24pk $17.98 (Jul 26)"],
  [["mountain dew"], 0.65, "sams", "24pk $15.68 (Jun 26)"],
  [["snapple"], 0.88, "sortly", "not in Sam's data"],
  [["sparkling ice"], 0.55, "sams", "24pk $13.18 (May 26)"],
  [["muffin"], 1.03, "sams", "15pk $15.44 (Jun 26)"],
  [["snyder"], 0.68, "sams", "20pk $13.64 (Jul 26)"],
  [["sun chips"], 0.62, "sams", "30pk $18.48 (Jun 26)"],
  [["jack link"], 1.20, "sams", "15pk $17.98 (Jun 26)"],
  [["monster energy"], 1.77, "sams", "24pk $42.48 (Jul 26)"],
  [["red bull"], 1.54, "sams", "28pk $42.98 (Jul 26)"],
  [["deer park", "water"], 0.16, "sams", "40pk $6.58 (May 26)"],
  [["vitamin water"], 0.93, "sams", "18pk $16.78 (Jul 26)"],
  [["arizona"], 0.53, "sams", "24pk $12.78 (Jun 26)"],
  [["pepsi"], 0.65, "sams", "24pk $15.68 (Jul 26)"],
  [["sprite"], 0.92, "sams", "24pk $22.14 (Jun 26)"],
  [["miss vickie"], 0.62, "sams", "30pk $18.48 (Jul 26)"],
  [["takis"], 0.33, "sams", "46pk $15.28 (May 26)"],
  [["ruffles"], 0.38, "sams", "50pk $18.98 (Apr 26)"],
  [["cheez-it", "cheez it"], 0.28, "sams", "50pk $13.98 (Jun 26)"],
  [["nutty buddy"], 0.40, "sams", "24pk $9.54 (Jun 26)"],
  [["starburst"], 0.75, "estimate", "not in Sam's data"],
  [["mm peanut", "m&m"], 1.09, "sams", "48pk $52.48 (May 26)"],
  [["trail mix"], 0.38, "sortly", "not in Sam's data"],
  [["payday"], 1.16, "sams", "24pk $27.84 (Feb 26)"],
  [["trident"], 0.89, "sams", "15pk $13.38 (Jun 26)"],
  [["clif bar"], 0.95, "sams", "20pk $18.98 (Apr 26)"],
  [["welch"], 0.35, "estimate", "not in Sam's data"],
  [["oatmeal cream"], 0.21, "sams", "48pk $10.22 (Nov 25)"],
  [["reese"], 0.99, "sams", "36pk $35.72 (Jul 26)"],
  [["kitkat", "kit kat"], 1.16, "sams", "36pk $41.72 (Apr 26)"],
  [["butterfinger"], 1.11, "sams", "36pk $39.98 (Apr 26)"],
  [["poptart", "pop tart"], 0.21, "sams", "48ct $9.98 (Jul 26)"],
  [["honey bun"], 0.60, "sams", "12pk $7.18 (Jul 26)"],
];

// overrides: { "<lowercased product name>": {cost, at} } — set by Stephen in the app.
let OVERRIDES = {};
export function setCostOverrides(o) { OVERRIDES = o || {}; }
export function getCostOverrides() { return OVERRIDES; }

export function costInfo(productName) {
  const n = (productName || "").toLowerCase();
  if (OVERRIDES[n] && OVERRIDES[n].cost != null) return { cost: Number(OVERRIDES[n].cost), source: "yours" };
  for (const [keys, cost, source] of COST_RULES) if (keys.some(k => n.includes(k))) return { cost, source };
  return { cost: null, source: "unknown" };
}
export function costFor(productName) { return costInfo(productName).cost; }

// Seasonality buckets Stephen wants to watch: energy, soda, sports/water, cold
// food, chips, candy, pastry (jerky/misc fall to "other"). Energy is checked
// first so "Celsius Sparkling Cola" lands in energy, not soda.
export function seasonCategoryFor(productName) {
  const n = (productName || "").toLowerCase();
  if (/c4|celsius|monster|red ?bull|bang|reign|rockstar|ghost energy|alani|prime energy|black rifle|coffee/.test(n)) return "energy";
  if (/coke|coca|pepsi|dr ?pepper|drpepper|mountain dew|mtn dew|sprite|sierra mist|fanta|crush|sunkist|mello yello|7 ?up|root beer|ginger ale|\bcola\b/.test(n)) return "soda";
  if (/gatorade|powerade|bodyarmor|body armor|water|deer park|aquafina|dasani|sparkling ice|vitamin ?water|propel|snapple|arizona|\btea\b|lemonade|juice/.test(n)) return "sports/water";
  if (/jimmy dean|hot pocket|uncrustable|sandwich|burrito|pizza/.test(n)) return "cold food";
  if (/miss vickie|sun ?chips|snyder|takis|ruffles|cheez-?it|chips|pretzel|doritos|lays|cheetos|popcorn|combos/.test(n)) return "chips";
  if (/m&m|mm peanut|reese|kit ?kat|butterfinger|starburst|payday|trident|welch|skittles|\bgum\b|sour|airhead|twix|snickers|hershey/.test(n)) return "candy";
  if (/muffin|honey bun|pop ?tart|oatmeal cream|nutty buddy|clif|cinnamon|donut|danish|brownie|cookie|\bcake\b|honeybun|little debbie/.test(n)) return "pastry";
  return "other";
}

export function categoryFor(productName) {
  const n = (productName || "").toLowerCase();
  if (/jimmy dean|hot pocket|uncrustable/.test(n)) return "Cold Food";
  if (/water|dew|pepsi|coke|sprite|pepper|gatorade|arizona|snapple|celsius|monster|red bull|c4|rifle|sparkling|vitamin|tea/.test(n)) return "Drinks";
  if (/reese|kitkat|kit kat|butterfinger|starburst|payday|m&m|mm peanut|trident|welch/.test(n)) return "Candy";
  return "Snacks";
}

// --- units sold per slot, Feb 21 – Jul 27 2026 (COGS workbook) ---
export const SOLD_BY_SLOT = {
  "69157": { "10":25,"12":24,"14":17,"16":31,"18":28,"20":4,"22":3,"24":10,"26":5,"28":24,
    "30":31,"31":16,"32":15,"33":24,"34":27,"35":31,"36":41,"37":61,"38":21,
    "40":64,"41":23,"42":44,"43":63,"44":85,"45":48,"46":90,"47":69,"48":6,
    "50":72,"51":31,"52":37,"53":45,"54":41,"55":67,"56":57,"57":46,"58":108 },
  "69180": { "10":42,"12":18,"14":14,"16":22,"20":24,"22":16,"24":19,"26":12,
    "30":21,"32":47,"34":19,"36":15,"40":26,"41":18,"42":13,"43":11,"44":24,
    "45":9,"46":9,"47":7,"50":14,"51":22,"52":31,"53":15,"54":12,"55":10,
    "56":11,"57":9,"60":18,"62":14,"64":38,"66":16 },
};
export const SALES_WINDOW = { label: "Feb 21 – Jul 27, 2026", days: 157 };

// --- monthly money, First National Bank statements ---
export const MONTHLY = [
  { m: "Sep 24", card: 0,   cash: 720,  debits: 13694, balance: 854  },
  { m: "Oct 24", card: 0,   cash: 0,    debits: 579,   balance: 340  },
  { m: "Nov 24", card: 741, cash: 754,  debits: 1168,  balance: 735  },
  { m: "Dec 24", card: 483, cash: 169,  debits: 1249,  balance: 145  },
  { m: "Jan 25", card: 707, cash: 815,  debits: 1089,  balance: 577  },
  { m: "Feb 25", card: 698, cash: 376,  debits: 940,   balance: 711  },
  { m: "Mar 25", card: 594, cash: 611,  debits: 1046,  balance: 886  },
  { m: "Apr 25", card: 618, cash: 320,  debits: 1160,  balance: 700  },
  { m: "May 25", card: 645, cash: 347,  debits: 782,   balance: 909  },
  { m: "Jun 25", card: 635, cash: 0,    debits: 679,   balance: 865  },
  { m: "Jul 25", card: 602, cash: 341,  debits: 1884,  balance: 307  },
  { m: "Aug 25", card: 968, cash: 308,  debits: 466,   balance: 1117 },
  { m: "Sep 25", card: 665, cash: 0,    debits: 715,   balance: 1068 },
  { m: "Oct 25", card: 687, cash: 680,  debits: 1202,  balance: 1232 },
  { m: "Nov 25", card: 602, cash: 251,  debits: 824,   balance: 1262 },
  { m: "Dec 25", card: 585, cash: 230,  debits: 1041,  balance: 1036 },
  { m: "Jan 26", card: 741, cash: 230,  debits: 1119,  balance: 887  },
  { m: "Feb 26", card: 749, cash: 236,  debits: 1089,  balance: 782  },
  { m: "Mar 26", card: 629, cash: 240,  debits: 473,   balance: 1178 },
  { m: "Apr 26", card: 551, cash: 269,  debits: 1554,  balance: 443  },
  { m: "May 26", card: 667, cash: 0,    debits: 425,   balance: 686  },
  { m: "Jun 26", card: 578, cash: 540,  debits: 570,   balance: 1233 },
];

// Operating fixed costs — the recurring bills that ARE expenses. The Wendle
// loan is deliberately NOT here: its payment splits into interest (an expense,
// added per-month in buildPL) and principal (a balance-sheet paydown, not an
// expense). Lumping the whole $197.26 in here overstated costs and understated
// net income — exactly the loan-split fix.
export const FIXED_COSTS = [
  { name: "Software & apps", amount: 177.02, note: "QuickBooks" },
  { name: "Business insurance", amount: 31.49, note: "NEXT" },
  { name: "Google Workspace", amount: 8.90 },
];

// Fallback product-cost ratio (revenue → COGS), used only for months that
// predate the live transaction feed. Real months use per-item costs instead.
export const COGS_RATIO = 0.52;

import { interestForMonth } from "./loan.js";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Build the P&L. Revenue comes from the LIVE TRANSACTION FEED (salesMonths),
// which records every sale on the day it happened — the true top line. Bank
// deposits lag by collection/deposit timing (cash gets banked weeks later, in
// lumps), so they understate the month a sale actually occurred. We keep the
// bank figures only for the reconciliation columns (deposits, debits, balance).
// Months before the feed began fall back to bank deposits × COGS_RATIO.
const monthKey = label => { const [mo, yy] = label.split(" "); return (2000 + parseInt(yy, 10)) * 12 + MON.indexOf(mo); };

export function buildPL(salesMonths) {
  const opFixed = FIXED_COSTS.reduce((a, c) => a + c.amount, 0);
  const bankBy = {};
  MONTHLY.forEach(m => { bankBy[m.m] = m; });
  const txnBy = {};
  (salesMonths || []).forEach(sm => {
    const label = `${MON[+sm.m.split("-")[1] - 1]} ${sm.m.slice(2, 4)}`;
    txnBy[label] = sm;
  });

  // Union of every month with money moving — from the bank statements AND the
  // live sales feed. The feed runs past where the bank data ends (bank stops
  // Jun 26; sales continue), so this keeps the P&L current instead of frozen at
  // the last bank statement.
  const labels = [...new Set([...Object.keys(bankBy), ...Object.keys(txnBy)])]
    .filter(lbl => {
      const b = bankBy[lbl], t = txnBy[lbl];
      return (t && t.revenue > 0) || (b && ((b.card + b.cash) > 0 || b.debits > 0));
    })
    .sort((a, b) => monthKey(a) - monthKey(b));

  return labels.map(lbl => {
    const m = bankBy[lbl] || {};
    const tx = txnBy[lbl];
    const deposits = (m.card || 0) + (m.cash || 0);
    let revenue, cogs, gross, source;
    if (tx && tx.revenue > 0) {
      revenue = tx.revenue; gross = tx.profit; cogs = revenue - gross; source = "sales";
    } else {
      revenue = deposits; cogs = revenue * COGS_RATIO; gross = revenue - cogs; source = "bank";
    }
    // Loan INTEREST for this month is an expense; principal is not.
    const [monStr, yy] = lbl.split(" ");
    const loanInterest = interestForMonth(2000 + parseInt(yy, 10), MON.indexOf(monStr) + 1);
    const fixed = opFixed + loanInterest;
    return {
      m: lbl, revenue, cogs, gross, fixed, opFixed, loanInterest,
      net: gross - fixed, balance: m.balance != null ? m.balance : null,
      debits: m.debits || 0, deposits, source,
    };
  });
}
