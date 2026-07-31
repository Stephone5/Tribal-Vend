// Wendle loan — parsed from the amortization schedule (Aug 2024 agreement).
// $13,000 at 10% APR, $197.26/month. Month 1 = October 2024.
// NOTE: the schedule runs 96 payments but the balance reaches zero at month 93.
// Paying all 96 overpays by about $634 — stop at 93.

export const LOAN = {
  lender: "Wendle",
  principal: 13000,
  apr: 0.10,
  termMonths: 96,
  payment: 197.26,
  firstPaymentYear: 2024,
  firstPaymentMonth: 10,
  payoffMonth: 93,
  schedule: [
 {
  "n": 1,
  "principal": 88.93,
  "interest": 108.33,
  "balance": 12911.07,
  "note": "10/1/2024Paid by Stephen 197.26"
 },
 {
  "n": 2,
  "principal": 89.67,
  "interest": 107.59,
  "balance": 12821.4,
  "note": "11/1/24Paid by Stephen 197.26"
 },
 {
  "n": 3,
  "principal": 90.42,
  "interest": 106.84,
  "balance": 12730.98,
  "note": "12/13/24December 1002 197.26"
 },
 {
  "n": 4,
  "principal": 91.17,
  "interest": 106.09,
  "balance": 12442.55,
  "note": "1/8/25January 1003 394.52"
 },
 {
  "n": 5,
  "principal": 93.58,
  "interest": 103.69,
  "balance": 12348.97,
  "note": "6/5/25February 1008 197.26"
 },
 {
  "n": 6,
  "principal": 94.36,
  "interest": 102.91,
  "balance": 12154.61,
  "note": "3/6/25March 1005 297.26"
 },
 {
  "n": 7,
  "principal": 95.98,
  "interest": 101.29,
  "balance": 12058.64,
  "note": "4/16/25April 1006 197.26"
 },
 {
  "n": 8,
  "principal": 96.78,
  "interest": 100.49,
  "balance": 11961.86,
  "note": "6/5/25May 1007 197.26"
 },
 {
  "n": 9,
  "principal": 97.58,
  "interest": 99.68,
  "balance": 11864.28,
  "note": "6/11/25June 1009 197.26"
 },
 {
  "n": 10,
  "principal": 98.4,
  "interest": 98.87,
  "balance": 11765.88,
  "note": "7/8/25July 1010 197.26"
 },
 {
  "n": 11,
  "principal": 99.22,
  "interest": 98.05,
  "balance": 11666.67,
  "note": "8/4/25August 1013 197.26"
 },
 {
  "n": 12,
  "principal": 100.04,
  "interest": 97.22,
  "balance": 11566.63,
  "note": "8/4/25September 1012 197.27"
 },
 {
  "n": 13,
  "principal": 100.88,
  "interest": 96.39,
  "balance": 11465.75,
  "note": "10/27/25October 1015 197.26"
 },
 {
  "n": 14,
  "principal": 101.72,
  "interest": 95.55,
  "balance": 11364.04,
  "note": "11/27/26November 1016 197.26"
 },
 {
  "n": 15,
  "principal": 102.56,
  "interest": 94.7,
  "balance": 11261.47,
  "note": "12/05/25December 1017 197.26"
 },
 {
  "n": 16,
  "principal": 103.42,
  "interest": 93.85,
  "balance": 11158.05,
  "note": "01/13/26January 1019 197.26"
 },
 {
  "n": 17,
  "principal": 104.28,
  "interest": 92.98,
  "balance": 11053.77,
  "note": "2/9/25February 197.26"
 },
 {
  "n": 18,
  "principal": 105.15,
  "interest": 92.11,
  "balance": 10948.62,
  "note": ""
 },
 {
  "n": 19,
  "principal": 106.03,
  "interest": 91.24,
  "balance": 10842.6,
  "note": ""
 },
 {
  "n": 20,
  "principal": 106.91,
  "interest": 90.35,
  "balance": 10735.69,
  "note": ""
 },
 {
  "n": 21,
  "principal": 107.8,
  "interest": 89.46,
  "balance": 10627.89,
  "note": ""
 },
 {
  "n": 22,
  "principal": 108.7,
  "interest": 88.57,
  "balance": 10519.19,
  "note": ""
 },
 {
  "n": 23,
  "principal": 109.6,
  "interest": 87.66,
  "balance": 10409.59,
  "note": ""
 },
 {
  "n": 24,
  "principal": 110.52,
  "interest": 86.75,
  "balance": 10299.07,
  "note": ""
 },
 {
  "n": 25,
  "principal": 111.44,
  "interest": 85.83,
  "balance": 10187.63,
  "note": ""
 },
 {
  "n": 26,
  "principal": 112.37,
  "interest": 84.9,
  "balance": 10075.26,
  "note": ""
 },
 {
  "n": 27,
  "principal": 113.3,
  "interest": 83.96,
  "balance": 9961.96,
  "note": ""
 },
 {
  "n": 28,
  "principal": 114.25,
  "interest": 83.02,
  "balance": 9847.71,
  "note": ""
 },
 {
  "n": 29,
  "principal": 115.2,
  "interest": 82.06,
  "balance": 9732.51,
  "note": ""
 },
 {
  "n": 30,
  "principal": 116.16,
  "interest": 81.1,
  "balance": 9616.35,
  "note": ""
 },
 {
  "n": 31,
  "principal": 117.13,
  "interest": 80.14,
  "balance": 9499.22,
  "note": ""
 },
 {
  "n": 32,
  "principal": 118.1,
  "interest": 79.16,
  "balance": 9381.12,
  "note": ""
 },
 {
  "n": 33,
  "principal": 119.09,
  "interest": 78.18,
  "balance": 9262.03,
  "note": ""
 },
 {
  "n": 34,
  "principal": 120.08,
  "interest": 77.18,
  "balance": 9141.95,
  "note": ""
 },
 {
  "n": 35,
  "principal": 121.08,
  "interest": 76.18,
  "balance": 9020.87,
  "note": ""
 },
 {
  "n": 36,
  "principal": 122.09,
  "interest": 75.17,
  "balance": 8898.78,
  "note": ""
 },
 {
  "n": 37,
  "principal": 123.11,
  "interest": 74.16,
  "balance": 8775.67,
  "note": ""
 },
 {
  "n": 38,
  "principal": 124.13,
  "interest": 73.13,
  "balance": 8651.54,
  "note": ""
 },
 {
  "n": 39,
  "principal": 125.17,
  "interest": 72.1,
  "balance": 8526.37,
  "note": ""
 },
 {
  "n": 40,
  "principal": 126.21,
  "interest": 71.05,
  "balance": 8400.16,
  "note": ""
 },
 {
  "n": 41,
  "principal": 127.26,
  "interest": 70.0,
  "balance": 8272.9,
  "note": ""
 },
 {
  "n": 42,
  "principal": 128.32,
  "interest": 68.94,
  "balance": 8144.57,
  "note": ""
 },
 {
  "n": 43,
  "principal": 129.39,
  "interest": 67.87,
  "balance": 8015.18,
  "note": ""
 },
 {
  "n": 44,
  "principal": 130.47,
  "interest": 66.79,
  "balance": 7884.71,
  "note": ""
 },
 {
  "n": 45,
  "principal": 131.56,
  "interest": 65.71,
  "balance": 7753.15,
  "note": ""
 },
 {
  "n": 46,
  "principal": 132.65,
  "interest": 64.61,
  "balance": 7620.5,
  "note": ""
 },
 {
  "n": 47,
  "principal": 133.76,
  "interest": 63.5,
  "balance": 7486.74,
  "note": ""
 },
 {
  "n": 48,
  "principal": 134.87,
  "interest": 62.39,
  "balance": 7351.86,
  "note": ""
 },
 {
  "n": 49,
  "principal": 136.0,
  "interest": 61.27,
  "balance": 7215.86,
  "note": ""
 },
 {
  "n": 50,
  "principal": 137.13,
  "interest": 60.13,
  "balance": 7078.73,
  "note": ""
 },
 {
  "n": 51,
  "principal": 138.27,
  "interest": 58.99,
  "balance": 6940.46,
  "note": ""
 },
 {
  "n": 52,
  "principal": 139.43,
  "interest": 57.84,
  "balance": 6801.03,
  "note": ""
 },
 {
  "n": 53,
  "principal": 140.59,
  "interest": 56.68,
  "balance": 6660.44,
  "note": ""
 },
 {
  "n": 54,
  "principal": 141.76,
  "interest": 55.5,
  "balance": 6518.68,
  "note": ""
 },
 {
  "n": 55,
  "principal": 142.94,
  "interest": 54.32,
  "balance": 6375.74,
  "note": ""
 },
 {
  "n": 56,
  "principal": 144.13,
  "interest": 53.13,
  "balance": 6231.61,
  "note": ""
 },
 {
  "n": 57,
  "principal": 145.33,
  "interest": 51.93,
  "balance": 6086.27,
  "note": ""
 },
 {
  "n": 58,
  "principal": 146.55,
  "interest": 50.72,
  "balance": 5939.73,
  "note": ""
 },
 {
  "n": 59,
  "principal": 147.77,
  "interest": 49.5,
  "balance": 5791.96,
  "note": ""
 },
 {
  "n": 60,
  "principal": 149.0,
  "interest": 48.27,
  "balance": 5642.96,
  "note": ""
 },
 {
  "n": 61,
  "principal": 150.24,
  "interest": 47.02,
  "balance": 5492.72,
  "note": ""
 },
 {
  "n": 62,
  "principal": 151.49,
  "interest": 45.77,
  "balance": 5341.23,
  "note": ""
 },
 {
  "n": 63,
  "principal": 152.75,
  "interest": 44.51,
  "balance": 5188.48,
  "note": ""
 },
 {
  "n": 64,
  "principal": 154.03,
  "interest": 43.24,
  "balance": 5034.45,
  "note": ""
 },
 {
  "n": 65,
  "principal": 155.31,
  "interest": 41.95,
  "balance": 4879.14,
  "note": ""
 },
 {
  "n": 66,
  "principal": 156.6,
  "interest": 40.66,
  "balance": 4722.54,
  "note": ""
 },
 {
  "n": 67,
  "principal": 157.91,
  "interest": 39.35,
  "balance": 4564.63,
  "note": ""
 },
 {
  "n": 68,
  "principal": 159.23,
  "interest": 38.04,
  "balance": 4405.4,
  "note": ""
 },
 {
  "n": 69,
  "principal": 160.55,
  "interest": 36.71,
  "balance": 4244.85,
  "note": ""
 },
 {
  "n": 70,
  "principal": 161.89,
  "interest": 35.37,
  "balance": 4082.96,
  "note": ""
 },
 {
  "n": 71,
  "principal": 163.24,
  "interest": 34.02,
  "balance": 3919.72,
  "note": ""
 },
 {
  "n": 72,
  "principal": 164.6,
  "interest": 32.66,
  "balance": 3755.12,
  "note": ""
 },
 {
  "n": 73,
  "principal": 165.97,
  "interest": 31.29,
  "balance": 3589.15,
  "note": ""
 },
 {
  "n": 74,
  "principal": 167.35,
  "interest": 29.91,
  "balance": 3421.79,
  "note": ""
 },
 {
  "n": 75,
  "principal": 168.75,
  "interest": 28.51,
  "balance": 3253.04,
  "note": ""
 },
 {
  "n": 76,
  "principal": 170.16,
  "interest": 27.11,
  "balance": 3082.89,
  "note": ""
 },
 {
  "n": 77,
  "principal": 171.57,
  "interest": 25.69,
  "balance": 2911.32,
  "note": ""
 },
 {
  "n": 78,
  "principal": 173.0,
  "interest": 24.26,
  "balance": 2738.31,
  "note": ""
 },
 {
  "n": 79,
  "principal": 174.44,
  "interest": 22.82,
  "balance": 2563.87,
  "note": ""
 },
 {
  "n": 80,
  "principal": 175.9,
  "interest": 21.37,
  "balance": 2387.97,
  "note": ""
 },
 {
  "n": 81,
  "principal": 177.36,
  "interest": 19.9,
  "balance": 2210.6,
  "note": ""
 },
 {
  "n": 82,
  "principal": 178.84,
  "interest": 18.42,
  "balance": 2031.76,
  "note": ""
 },
 {
  "n": 83,
  "principal": 180.33,
  "interest": 16.93,
  "balance": 1851.43,
  "note": ""
 },
 {
  "n": 84,
  "principal": 181.84,
  "interest": 15.43,
  "balance": 1669.59,
  "note": ""
 },
 {
  "n": 85,
  "principal": 183.35,
  "interest": 13.91,
  "balance": 1486.24,
  "note": ""
 },
 {
  "n": 86,
  "principal": 184.88,
  "interest": 12.39,
  "balance": 1301.36,
  "note": ""
 },
 {
  "n": 87,
  "principal": 186.42,
  "interest": 10.84,
  "balance": 1114.94,
  "note": ""
 },
 {
  "n": 88,
  "principal": 187.97,
  "interest": 9.29,
  "balance": 926.97,
  "note": ""
 },
 {
  "n": 89,
  "principal": 189.54,
  "interest": 7.72,
  "balance": 737.43,
  "note": ""
 },
 {
  "n": 90,
  "principal": 191.12,
  "interest": 6.15,
  "balance": 546.31,
  "note": ""
 },
 {
  "n": 91,
  "principal": 192.71,
  "interest": 4.55,
  "balance": 353.6,
  "note": ""
 },
 {
  "n": 92,
  "principal": 194.32,
  "interest": 2.95,
  "balance": 159.28,
  "note": ""
 },
 {
  "n": 93,
  "principal": 195.94,
  "interest": 1.33,
  "balance": -36.65,
  "note": ""
 },
 {
  "n": 94,
  "principal": 197.57,
  "interest": -0.31,
  "balance": -234.22,
  "note": ""
 },
 {
  "n": 95,
  "principal": 199.22,
  "interest": -1.95,
  "balance": -433.44,
  "note": ""
 },
 {
  "n": 96,
  "principal": 200.88,
  "interest": -3.61,
  "balance": -634.31,
  "note": ""
 }
]
};

export function loanMonthFor(date = new Date()) {
  const y = date.getFullYear(), m = date.getMonth() + 1;
  return (y - LOAN.firstPaymentYear) * 12 + (m - LOAN.firstPaymentMonth) + 1;
}

export function loanStatus(date = new Date()) {
  const n = Math.max(0, Math.min(loanMonthFor(date), LOAN.schedule.length));
  const row = LOAN.schedule.find(r => r.n === n) || null;
  const balance = row ? Math.max(0, row.balance) : LOAN.principal;
  const paidRows = LOAN.schedule.filter(r => r.n <= n);
  const principalPaid = paidRows.reduce((a, r) => a + r.principal, 0);
  const interestPaid = paidRows.reduce((a, r) => a + Math.max(0, r.interest), 0);
  const interestLeft = LOAN.schedule.filter(r => r.n > n && r.n <= LOAN.payoffMonth)
    .reduce((a, r) => a + Math.max(0, r.interest), 0);
  const paymentsLeft = Math.max(0, LOAN.payoffMonth - n);
  const pd = new Date(LOAN.firstPaymentYear, LOAN.firstPaymentMonth - 1 + (LOAN.payoffMonth - 1), 1);
  return {
    monthNumber: n, payment: LOAN.payment, balance,
    principalPaid: Math.min(principalPaid, LOAN.principal),
    interestPaid, interestLeft, paymentsLeft,
    payoffDate: pd.toISOString().slice(0, 10),
    pctPaid: Math.min(100, (Math.min(principalPaid, LOAN.principal) / LOAN.principal) * 100),
    totalInterest: 5606.14,
    overpayWarning: LOAN.termMonths - LOAN.payoffMonth,
  };
}
