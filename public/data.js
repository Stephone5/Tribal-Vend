// Public app data — non-financial only. The money numbers (bank, per-slot margins,
// loan) live server-side behind the passcode and load via /api/finance.

// Two machines (from AirVend) — names/ids, used by the Runs machine picker.
export const MACHINES = [
  { id: "69157", name: "Meals & Drinks", lastRefill: "Jul 27, 2026 6:05 PM" },
  { id: "69180", name: "Snacks & Candy", lastRefill: "Jul 27, 2026 6:39 PM" },
];
