// Public app data — non-financial only. The money numbers (bank, per-slot margins,
// loan) live server-side behind the passcode and load via /api/finance.

// Two machines (from AirVend) — names/ids, used by the Runs machine picker.
export const MACHINES = [
  { id: "69157", name: "Meals & Drinks", lastRefill: "Jul 27, 2026 6:05 PM" },
  { id: "69180", name: "Snacks & Candy", lastRefill: "Jul 27, 2026 6:39 PM" },
];

// Package grouping. In the machines, one product is loaded across several slots
// as different flavors (Miss Vickie's Sea Salt, Jalapeño, …), but it's BOUGHT as
// one package — a variety case. So for ordering, all of a package's slots sum
// into a single line. Arizona is the exception: each Arizona flavor is its own
// package, so those stay separate. Everything not listed groups only with itself.
const PACKAGE_RULES = [
  { match: ["miss vickie", "miss vickies"], label: "Miss Vickie's" },
  { match: ["sun chips", "sunchips"],       label: "Sun Chips" },
  { match: ["snyder"],                       label: "Snyder's" },
  { match: ["gatorade"],                     label: "Gatorade" },
];

// Return the package a product name belongs to: { key, label }. Grouped items
// share a key so they sum; ungrouped items (incl. every Arizona flavor) get a
// key of their own name so they stay separate.
export function packageOf(name) {
  const n = String(name || "").toLowerCase();
  for (const r of PACKAGE_RULES) {
    if (r.match.some(k => n.includes(k))) return { key: r.label, label: r.label };
  }
  return { key: n.trim() || "item", label: String(name || "").trim() };
}
