// Draft answers for the setup questions the app can already answer from real
// data: sales, costs, the loan, the bank statements, the machines.
// Every draft is editable — the member changes it or adds context before saving.
// A question the data can't answer honestly gets no draft.

const money = n => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
const money2 = n => "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function monthLabel(key) { const [y, m] = key.split("-"); return `${MON[+m - 1]} ${y}`; }

export function buildPrefill(live, closet) {
  if (!live) return {};
  const S = live.sales, pl = live.pl || [], out = {};
  const machines = live.machines || [];
  const running = (live.restock && !live.restock.error ? live.restock.machines || [] : []).map(m => m.name);
  const bills = (live.fixedCosts || []).reduce((a, c) => a + c.amount, 0);
  const payment = live.loan ? live.loan.payment : 0;
  const cashOut = bills + payment;
  const banked = (live.monthly || []).filter(m => m.balance != null);
  const lastBank = banked[banked.length - 1];

  // yearly revenue from real transactions
  const byYear = {};
  (S?.months || []).forEach(m => { const y = m.m.slice(0, 4); (byYear[y] ||= { revenue: 0, profit: 0, units: 0 }); byYear[y].revenue += m.revenue; byYear[y].profit += m.profit; byYear[y].units += m.units; });
  const thisYear = String(new Date().getFullYear()), lastYear = String(new Date().getFullYear() - 1);

  out.member_name = "Stephen Barton"; // the name on the LLC and the bank statements
  out.business_name = "Tribal Amenities LLC, which I run as Tribal Vend.";

  if (machines.length) {
    const slots = machines.reduce((a, m) => a + m.slots.length, 0);
    out.business_description = `I run vending machines. Two machines, ${slots} slots in total: ${machines.map(m => `${m.name} (${m.slots.length} slots)`).join(" and ")}. People buy drinks, snacks and cold food out of them, so the machine is the whole transaction.${running.length ? ` Right now ${running.join(" and ")} ${running.length === 1 ? "is" : "are"} stocked and running.` : ""}`;
  }

  if (S?.byItem?.length) {
    const top = S.byItem.slice(0, 3).map(i => i.item.replace(/^(Meals|Drinks|Crackers)\s*[-:]\s*/i, "").split(",")[0]).join(", ");
    out.primary_customer = `People working at the building the machine sits in. The refrigerated machine is at American Elevator, 1905 S Harvard in Oklahoma City, so it is their crew and anyone visiting the shop, buying on a break or a lunch. Their top buys are ${top}.`;
  }
  out.location_and_service_area = "Oklahoma City, Oklahoma. The business started in State College, Pennsylvania and moved here in August 2026. It is local: the machines sit in one building and I service them myself.";

  if (S?.firstSale) {
    const first = new Date(S.firstSale);
    const months = Math.max(1, Math.round((Date.now() - first.getTime()) / (30.44 * 864e5)));
    out.years_in_business = `About ${months >= 24 ? `${Math.floor(months / 12)} years` : `${months} months`}. The first sale was ${first.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`;
  }

  if (byYear[lastYear]) {
    const y = byYear[lastYear];
    out.annual_revenue = `${money(y.revenue)} in ${lastYear}, from ${y.units.toLocaleString()} sales out of the machines. So far in ${thisYear} it is ${money(byYear[thisYear]?.revenue || 0)}.`;
  }

  if (machines.length) {
    const active = running.length || machines.length;
    out.customer_concentration = `Yes. ${active === 1 ? "One location is 100% of revenue" : `${active} locations`}. Every dollar comes from ${running.length ? running.join(" and ") : machines.map(m => m.name).join(" and ")}, so losing that building would end the revenue.`;
  }

  if (pl.length) {
    const gross = pl.reduce((a, p) => a + p.gross, 0), rev = pl.reduce((a, p) => a + p.revenue, 0);
    const loss = live.inventoryLoss ? live.inventoryLoss.loss : 0;
    const margin = rev ? Math.round(((gross - loss) / rev) * 100) : null;
    const net = pl.reduce((a, p) => a + p.net, 0);
    if (margin != null) out.profit_margin = `About ${margin} cents on the dollar after product cost and shrinkage, before the monthly bills. After those bills, all time, the business has kept ${money(net)} on ${money(rev)} of sales.`;
    if (margin) {
      const be = cashOut / (margin / 100);
      out.break_even = `About ${money(be)} a month in sales. That covers ${money2(bills)} of bills plus the ${money2(payment)} loan payment at a ${margin}% margin.`;
    }
  }

  const billLines = (live.fixedCosts || []).map(c => `${c.name}${c.note ? ` (${c.note})` : ""} ${money2(c.amount)}/mo`);
  if (billLines.length) {
    const buys = (live.inventoryLoss && live.inventoryLoss.bought && S?.months?.length)
      ? `Product from Sam's Club is the biggest spend overall: ${money(live.inventoryLoss.bought)} bought since the start.` : "";
    out.major_expenses = `${billLines.join("; ")}, and the Wendle loan payment ${money2(payment)}/mo. ${buys}`.trim();
  }

  if (lastBank && pl.length) {
    const recent = pl.slice(-3);
    const avgGross = recent.reduce((a, p) => a + p.gross, 0) / recent.length;
    const monthly = avgGross - cashOut;
    const cash = lastBank.balance;
    out.cash_runway = monthly >= 0
      ? `The bank was ${money2(cash)} at the end of ${lastBank.m}, and the last three months cover the ${money2(cashOut)} that goes out each month, so the account is holding.`
      : `The bank was ${money2(cash)} at the end of ${lastBank.m}. Money out is ${money2(cashOut)} a month and the last three months averaged ${money2(avgGross)} left after product, so it is short about ${money2(-monthly)} a month. That is roughly ${(cash / -monthly).toFixed(1)} months at this pace.`;
  }

  if (S?.months?.length >= 6) {
    const last6 = S.months.slice(-7, -1);
    const best = [...last6].sort((a, b) => b.revenue - a.revenue)[0];
    out.external_pressures = `The move from Pennsylvania to Oklahoma in August 2026 stopped the route: sales went from ${money(best.revenue)} in ${monthLabel(best.m)} to ${money(S.months[S.months.length - 1].revenue)} so far this month, with one machine running. Product costs from Sam's Club have also climbed.`;
  }

  if (live.loan) {
    const L = live.loan;
    out.additional_context = `The Wendle loan is ${money2(L.balance)} owed of ${money(L.principal || 13000)}, ${money2(L.payment)} a month, last payment ${L.payoffMonth || "unknown"}.${L.behind ? ` ${L.behind} payment${L.behind === 1 ? "" : "s"} are not marked paid in my loan sheet.` : ""} Inventory on hand is ${money2(live.balanceSheet ? (live.balanceSheet.inventory || 0) : 0)}.`;
  }

  return out;
}
