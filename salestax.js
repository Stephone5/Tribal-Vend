// PA sales tax for vending — the math the state actually wants.
//
// Two rules drive this:
//  • 61 PA Code § 31.28 (vending machines): vending prices INCLUDE the tax. So
//    taxable sales = gross receipts ÷ 1.06, and tax due = taxable sales × 0.06.
//    (Equivalently, tax = gross × 0.06 ÷ 1.06.)
//  • REV-717 (Retailer's Information): which items are taxable. For a snack/drink
//    route it comes down to a clean line — SODA, SPORTS DRINKS, ENERGY DRINKS,
//    and FLAVORED/VITAMIN WATER are taxable; food, candy, gum, chips, pretzels,
//    jerky, baked goods, PLAIN water, TEA (incl. Arizona/Snapple), and cold
//    bottled coffee are NOT.
//
// Anything without a taxable keyword is treated as exempt (the safe default for
// food). The handful of genuinely ambiguous items (iced teas, juice drinks) are
// left exempt as tea/juice per REV-717 and flagged so they can be checked.

const RATE = 0.06;

// Taxable keywords, per REV-717. Plain water / tea / cold coffee have NO entry
// here, so they fall through to exempt — that's intentional.
const TAXABLE = [
  // soft drinks (bottled or not)
  "coke", "coca-cola", "pepsi", "dr pepper", "drpepper", "dr. pepper",
  "mountain dew", "mtn dew", "sprite", "sierra mist", "fanta", "crush",
  "sunkist", "mello yello", "squirt", "7up", "7 up", "root beer", "ginger ale",
  "cream soda", "cola",
  // sports drinks
  "gatorade", "powerade", "bodyarmor", "body armor",
  // energy drinks / shots 4 oz or greater
  "monster", "red bull", "redbull", "celsius", "c4", "bang", "reign",
  "rockstar", "ghost energy", "alani", "prime energy",
  // flavored / vitamin water (plain water stays exempt)
  "vitamin water", "vitaminwater", "sparkling ice", "propel", "flavored water",
];

// Items that read as taxable by keyword but are actually exempt, so we override.
// (none needed today — kept for when the assortment shifts.)
const EXEMPT_OVERRIDE = [];

export function isTaxable(name) {
  const n = String(name || "").toLowerCase();
  if (EXEMPT_OVERRIDE.some(k => n.includes(k))) return false;
  return TAXABLE.some(k => n.includes(k));
}

// PA quarterly sales-tax return periods. Returns are due the 20th of the month
// after the quarter closes.
const QUARTERS = [
  { q: 1, label: "Q1 · Jan–Mar", months: [0, 1, 2],  due: "2026-04-20" },
  { q: 2, label: "Q2 · Apr–Jun", months: [3, 4, 5],  due: "2026-07-20" },
  { q: 3, label: "Q3 · Jul–Sep", months: [6, 7, 8],  due: "2026-10-20" },
  { q: 4, label: "Q4 · Oct–Dec", months: [9, 10, 11], due: "2027-01-20" },
];

// gross (tax-included) → tax owed, per § 31.28
export function taxFromGross(gross) {
  return (gross / (1 + RATE)) * RATE;
}

// Build the full 2026 sales-tax picture from raw transactions.
export function salesTaxReport(txns, year = 2026, now = new Date()) {
  const taxableByItem = {};
  const quarters = QUARTERS.map(q => ({ ...q, gross: 0, taxableSales: 0, taxDue: 0 }));

  for (const t of txns || []) {
    if (!t.when || t.when.getFullYear() !== year) continue;
    if (!isTaxable(t.item)) continue;
    const qi = quarters.find(q => q.months.includes(t.when.getMonth()));
    if (!qi) continue;
    qi.gross += t.amount;
    taxableByItem[t.item] = (taxableByItem[t.item] || 0) + t.amount;
  }

  for (const q of quarters) {
    q.taxableSales = q.gross / (1 + RATE);
    q.taxDue = q.taxableSales * RATE;
    q.status = new Date(q.due + "T23:59:59") >= now ? "upcoming" : "past";
  }

  const ytdTaxDue = quarters.reduce((a, q) => a + q.taxDue, 0);
  const ytdGross = quarters.reduce((a, q) => a + q.gross, 0);
  const next = quarters.find(q => q.status === "upcoming") || null;

  const taxableItems = Object.entries(taxableByItem)
    .map(([item, gross]) => ({ item, gross, taxDue: taxFromGross(gross) }))
    .sort((a, b) => b.gross - a.gross);

  return {
    rate: RATE, year,
    basis: "PA vending: taxable gross ÷ 1.06 × 0.06 (61 PA Code § 31.28); items per REV-717",
    quarters, ytdGross, ytdTaxDue, next, taxableItems,
    fileUrl: "https://mypath.pa.gov",
    reference: "REV-717 (Retailer's Information) · 61 PA Code § 31.28",
  };
}
