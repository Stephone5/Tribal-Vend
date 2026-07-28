// Tribal Amenities — real business data (extracted from AirVend, COGS sheet, First National Bank statements)
// This file is the seed. Once the backend is wired, these arrays get replaced by live pulls.

// --- Monthly money, from First National Bank statements (Sep 2024 – Jun 2026) ---
// card = 365 Retail card revenue (reliable monthly), cash = deposits (irregular),
// debits = total money out, balance = closing balance.
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

// --- Fixed monthly costs (from bank statements) ---
export const FIXED_COSTS = [
  { name: "Loan payment", amount: 197.26 },
  { name: "QuickBooks",   amount: 177.02, note: "was $40 in Jan — climbing" },
  { name: "NEXT insurance", amount: 31.49 },
  { name: "Google Workspace", amount: 8.90 },
];

// --- Per-slot performance, Meals & Drinks machine (AirVend, Feb 21 – Jul 27 2026) ---
// profit is gross margin dollars after cost, over the window.
export const SLOTS = [
  { slot: "10", item: "Jimmy Dean Croissant", cost: 2.00, price: 1.75, sold: 25, profit: -8.88 },
  { slot: "12", item: "Jimmy Dean Croissant", cost: 2.00, price: 1.75, sold: 24, profit: -8.52 },
  { slot: "14", item: "Jimmy Dean Croissant", cost: 2.00, price: 1.75, sold: 17, profit: -6.04 },
  { slot: "16", item: "Hot Pockets Pepperoni", cost: 0.79, price: 2.50, sold: 31, profit: 48.36 },
  { slot: "18", item: "Hot Pockets Pepperoni", cost: 0.79, price: 2.50, sold: 28, profit: 43.68 },
  { slot: "20", item: "Uncrustables", cost: 1.90, price: 1.75, sold: 4, profit: -1.02 },
  { slot: "22", item: "Uncrustables", cost: 1.90, price: 1.75, sold: 3, profit: -0.77 },
  { slot: "24", item: "Uncrustables", cost: 1.90, price: 1.75, sold: 10, profit: -2.55 },
  { slot: "26", item: "Uncrustables", cost: 1.90, price: 1.75, sold: 5, profit: -1.28 },
  { slot: "28", item: "Hot Pockets Pepperoni", cost: 0.79, price: 2.25, sold: 24, profit: 31.80 },
  { slot: "30", item: "Deer Park Water", cost: 0.20, price: 1.00, sold: 31, profit: 22.94 },
  { slot: "31", item: "Deer Park Water", cost: 0.20, price: 1.00, sold: 16, profit: 11.84 },
  { slot: "32", item: "Chobani yogurt", cost: 1.75, price: 1.75, sold: 6, profit: -0.63 },
  { slot: "32b", item: "Vitamin Water", cost: 1.00, price: 2.00, sold: 15, profit: 13.20 },
  { slot: "33", item: "Snapple Raspberry", cost: 0.87, price: 1.50, sold: 24, profit: 12.96 },
  { slot: "34", item: "Arizona Green Tea", cost: 0.45, price: 1.50, sold: 27, profit: 25.92 },
  { slot: "35", item: "Arizona Arnold Palmer", cost: 0.45, price: 1.50, sold: 31, profit: 29.76 },
  { slot: "36", item: "Gatorade Frost Arctic", cost: 0.75, price: 1.50, sold: 41, profit: 27.06 },
  { slot: "37", item: "Gatorade Frost", cost: 0.75, price: 1.50, sold: 61, profit: 40.26 },
  { slot: "38", item: "Gatorade Cool Blue", cost: 0.75, price: 1.50, sold: 21, profit: 13.86 },
  { slot: "40", item: "Mountain Dew", cost: 0.60, price: 2.00, sold: 64, profit: 81.92 },
  { slot: "41", item: "Mountain Dew", cost: 0.60, price: 2.00, sold: 23, profit: 29.44 },
  { slot: "42", item: "Mountain Dew", cost: 0.60, price: 2.00, sold: 44, profit: 56.32 },
  { slot: "43", item: "Pepsi", cost: 0.60, price: 2.00, sold: 63, profit: 80.64 },
  { slot: "44", item: "Coke Can", cost: 0.71, price: 2.00, sold: 85, profit: 99.45 },
  { slot: "45", item: "Sprite", cost: 0.71, price: 2.00, sold: 48, profit: 56.16 },
  { slot: "46", item: "Dr Pepper 12oz", cost: 0.88, price: 2.00, sold: 90, profit: 90.00 },
  { slot: "47", item: "Dr Pepper 12oz", cost: 0.88, price: 2.00, sold: 69, profit: 69.00 },
  { slot: "48", item: "Dr Pepper 12oz", cost: 0.88, price: 2.00, sold: 6, profit: 6.00 },
  { slot: "50", item: "Sparkling ICE", cost: 0.66, price: 1.50, sold: 72, profit: 54.00 },
  { slot: "51", item: "Liquid Death", cost: 1.33, price: 1.75, sold: 6, profit: 1.89 },
  { slot: "51b", item: "Vitamin Water", cost: 1.00, price: 2.00, sold: 34, profit: 29.92 },
  { slot: "51c", item: "C4 Bombsicle", cost: 2.42, price: 3.50, sold: 31, profit: 26.97 },
  { slot: "52", item: "Red Bull", cost: 1.46, price: 2.75, sold: 67, profit: 75.38 },
  { slot: "52b", item: "C4 Bombsicle", cost: 2.42, price: 3.50, sold: 37, profit: 32.19 },
  { slot: "53", item: "Celsius Cola", cost: 1.30, price: 2.00, sold: 45, profit: 26.10 },
  { slot: "53b", item: "C4 Bombsicle", cost: 2.42, price: 3.50, sold: 66, profit: 57.42 },
  { slot: "54", item: "Celsius Cola", cost: 1.30, price: 2.00, sold: 41, profit: 23.78 },
  { slot: "54b", item: "Black Rifle Coffee", cost: 1.67, price: 2.75, sold: 24, profit: 21.96 },
  { slot: "55", item: "Celsius Cola", cost: 1.30, price: 2.00, sold: 67, profit: 38.86 },
  { slot: "55b", item: "Red Bull", cost: 1.46, price: 2.75, sold: 46, profit: 51.75 },
  { slot: "56", item: "Celsius Cola", cost: 1.30, price: 2.00, sold: 57, profit: 33.06 },
  { slot: "56b", item: "Black Rifle Coffee", cost: 1.67, price: 2.75, sold: 9, profit: 8.24 },
  { slot: "57", item: "Java Monster", cost: 1.92, price: 2.75, sold: 46, profit: 30.59 },
  { slot: "58", item: "Monster Energy", cost: 1.53, price: 2.75, sold: 108, profit: 113.94 },
];

export const WINDOW_LABEL = "Feb 21 – Jul 27, 2026";

// Two machines (from AirVend)
export const MACHINES = [
  { id: "69157", name: "Meals & Drinks", lastRefill: "Jul 27, 2026 6:05 PM" },
  { id: "69180", name: "Snacks & Candy", lastRefill: "Jul 27, 2026 6:39 PM" },
];
