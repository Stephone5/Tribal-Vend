// Wendle loan, read live from Stephen's Google Sheet (CSV export).
// The sheet is the source of truth: a row counts as paid when "Amount Paid" is filled.
import { LOAN, loanStatus } from "./loan.js";

const SHEET_ID = "14g50kdvsdgQojhVfhz2rxujrZgRVLGXQiXkX1Npg0ig";
export const LOAN_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;
const TTL = 10 * 60 * 1000;
let cache = { at: 0, data: null };

function parseCsv(text) {
  return text.split(/\r?\n/).map(line => {
    const cells = []; let cur = "", q = false;
    for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { cells.push(cur); cur = ""; } else cur += ch; }
    cells.push(cur); return cells.map(c => c.trim());
  });
}
const num = s => { const t = String(s || "").replace(/[$,\s]/g, ""); if (!t) return null; const v = Number(t); return isNaN(v) ? null : v; };
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export async function loanFromSheet(force = false) {
  if (!force && cache.data && Date.now() - cache.at < TTL) return cache.data;
  try {
    const r = await fetch(CSV_URL, { redirect: "follow", signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Google Sheet returned HTTP ${r.status}`);
    const rows = parseCsv(await r.text());
    const get = label => { const row = rows.find(x => (x[0] || "").toLowerCase() === label.toLowerCase()); return row ? num(row[1]) : null; };
    const principal = get("Loan Amount") ?? LOAN.principal;
    const payment = get("Monthly Payment") ?? LOAN.payment;
    const hdr = rows.findIndex(x => x[0] === "Month" && /principal/i.test(x[1] || ""));
    if (hdr < 0) throw new Error("Couldn't find the payment table in the sheet");
    const sched = [];
    for (const x of rows.slice(hdr + 1)) {
      const n = Number(x[0]); if (!Number.isInteger(n) || n < 1) continue;
      const paidAmt = num(x[7]);
      const due = new Date(Date.UTC(2024, 9 + n - 1, 1)); // payment 1 = October 2024
      sched.push({
        n, principal: num(x[1]) || 0, interest: num(x[2]) || 0, balance: num(x[3]) ?? 0,
        datePaid: x[4] || "", paid: paidAmt != null && paidAmt > 0, amountPaid: paidAmt || 0,
        due: `${MON[due.getUTCMonth()]} ${due.getUTCFullYear()}`, dueISO: due.toISOString().slice(0, 7),
      });
    }
    if (!sched.length) throw new Error("The sheet's payment table is empty");
    const paidRows = sched.filter(s => s.paid);
    const lastPaid = paidRows.length ? paidRows[paidRows.length - 1] : null;
    const balance = lastPaid ? Math.max(0, lastPaid.balance) : principal;
    const payoff = sched.find(s => s.balance <= 0) || sched[sched.length - 1];
    const prevBal = sched.find(s => s.n === payoff.n - 1)?.balance ?? balance;
    const finalAmount = +(prevBal + Math.max(0, payoff.interest)).toFixed(2);
    const interestLeft = sched.filter(s => s.n > (lastPaid?.n || 0) && s.n <= payoff.n).reduce((a, s) => a + Math.max(0, s.interest), 0);
    const now = new Date();
    const dueNowN = (now.getUTCFullYear() - 2024) * 12 + now.getUTCMonth() - 9 + 1;
    const data = {
      source: "sheet", sheetUrl: LOAN_SHEET_URL, readAt: Date.now(),
      principal, payment, balance,
      paidThroughN: lastPaid?.n || 0, paidThrough: lastPaid?.due || null,
      principalPaid: principal - balance, pctPaid: Math.min(100, ((principal - balance) / principal) * 100),
      paymentsLeft: Math.max(0, payoff.n - (lastPaid?.n || 0)),
      payoffN: payoff.n, payoffMonth: payoff.due, finalAmount, interestLeft,
      behind: Math.max(0, dueNowN - (lastPaid?.n || 0)), scheduleLength: sched.length,
      schedule: sched.filter(s => s.n <= payoff.n).map(s => ({ n: s.n, due: s.due, balance: Math.max(0, s.balance), principal: s.principal, interest: s.interest, paid: s.paid, datePaid: s.datePaid, amountPaid: s.amountPaid })),
    };
    // fields the rest of the server already reads
    data.monthNumber = data.paidThroughN;
    data.payoffDate = payoff.dueISO + "-01";
    cache = { at: Date.now(), data };
    return data;
  } catch (e) {
    if (cache.data) return { ...cache.data, stale: true, sheetError: e.message };
    return { ...loanStatus(), source: "built-in", sheetUrl: LOAN_SHEET_URL, sheetError: e.message };
  }
}
