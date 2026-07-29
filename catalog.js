// Cost catalog + sales history + monthly finance.
// COSTS come from the Sortly export (real, verified). Sales velocity comes from
// the COGS workbook (Feb 21 – Jul 27 2026). Monthly money comes from the First
// National Bank statements. Live product + price data is pulled from AirVend.

// --- unit costs, matched to AirVend product names by keyword ---
// [keywords, unitCost, sortlyName]
export const COST_RULES = [
  [["jimmy dean"], 1.00, "Jimmy Dean SEC"],
  [["hot pocket"], 0.79, "Hot Pockets"],
  [["uncrustable"], 0.78, "Uncrustables"],
  [["c4 frozen", "c4 "], 2.33, "12 ounce C4"],
  [["black rifle"], 1.67, "Black Rifle Coffee"],
  [["celsius"], 1.00, "Celsius"],
  [["java monster", "coffee + energy"], 2.02, "Coffee Monster"],
  [["coke"], 0.71, "Coke"],
  [["drpepper", "dr pepper"], 0.67, "Dr Pepper"],
  [["gatorade"], 0.77, "Gatorade Blue"],
  [["mountain dew"], 0.62, "Mtn Dew"],
  [["snapple"], 0.88, "Snapple"],
  [["sparkling ice"], 0.67, "Sparkling ICE"],
  [["muffin"], 0.95, "Muffins"],
  [["snyder"], 0.68, "Snyders Pretzel peices"],
  [["sun chips"], 0.62, "Sun Chips"],
  [["jack link"], 1.20, "Jack links"],
  // reasonable costs for products not in the Sortly export
  [["monster energy"], 1.53, null],
  [["red bull"], 1.46, null],
  [["deer park", "water"], 0.20, null],
  [["vitamin water"], 1.00, null],
  [["arizona"], 0.45, null],
  [["pepsi"], 0.62, null],
  [["sprite"], 0.71, null],
  [["miss vickie"], 0.62, null],
  [["takis"], 0.70, null],
  [["ruffles"], 0.62, null],
  [["cheez-it", "cheez it"], 0.55, null],
  [["nutty buddy"], 0.57, null],
  [["starburst"], 0.75, null],
  [["mm peanut", "m&m"], 0.94, null],
  [["trail mix"], 0.41, null],
  [["payday"], 0.95, null],
  [["trident"], 0.45, null],
  [["clif bar"], 1.05, null],
  [["welch"], 0.35, null],
  [["oatmeal cream"], 0.45, null],
  [["reese"], 0.77, null],
  [["kitkat", "kit kat"], 0.94, null],
  [["butterfinger"], 0.77, null],
  [["poptart", "pop tart"], 0.21, null],
  [["honey bun"], 0.60, null],
];

export function costFor(productName) {
  const n = (productName || "").toLowerCase();
  for (const [keys, cost] of COST_RULES) if (keys.some(k => n.includes(k))) return cost;
  return null; // unknown → surfaced in the app rather than guessed
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

export const FIXED_COSTS = [
  { name: "Loan payment (Wendle)", amount: 197.26 },
  { name: "QuickBooks", amount: 177.02, note: "was $40 in Jan — climbing" },
  { name: "NEXT insurance", amount: 31.49 },
  { name: "Google Workspace", amount: 8.90 },
];

// Estimated product cost ratio for P&L (revenue → COGS). Derived from the
// per-slot margin math across both machines.
export const COGS_RATIO = 0.52;

export function buildPL() {
  return MONTHLY.filter(m => m.card > 0).map(m => {
    const revenue = m.card + m.cash;
    const cogs = revenue * COGS_RATIO;
    const gross = revenue - cogs;
    const fixed = FIXED_COSTS.reduce((a, c) => a + c.amount, 0);
    return { m: m.m, revenue, cogs, gross, fixed, net: gross - fixed, balance: m.balance, debits: m.debits };
  });
}
