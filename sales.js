// Live sales from AirVend's reporting engine (Telerik REST).
// Pulls real transactions — every sale with timestamp, machine, slot, item, price.
// Weeks run Sunday → Saturday, matching the service rhythm.

import { login } from "./airvend.js";

const BASE = "https://live.app.air-vend.com";
const API = BASE + "/reportingapi/reports";
const REPORT = "TsfRetailMarkets.AVLive.Reporting.DetailSalesRaw, TsfRetailMarkets.AVLive.Reporting, Version=2026.6.0.1007, Culture=neutral, PublicKeyToken=null";

const BASE_PARAMS = {
  UserId: 12154, CompanyId: 15812, IsGma: true, TimeZone: "Eastern Standard Time",
  SetRefillData: false, HasAdminRole: false, LevelId: -2, GroupId: [-2],
  MachineId: [69157, 69180], ShowCategory: true,
};

// --- week helpers (Sunday start, in Eastern time) ---
export function easternNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
}
export function startOfWeek(d = easternNow()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay()); // 0 = Sunday
  return x;
}
export function startOfMonth(d = easternNow()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1); return x;
}

function parseCsv(text) {
  const rows = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  for (let i = 1; i < lines.length; i++) {
    const cells = []; let cur = "", q = false;
    for (const ch of lines[i]) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    if (cells.length < 7) continue;
    const [paymentType, orderDate, machine, slot, item, category, total] = cells;
    const amount = Number(String(total).replace(/[^0-9.\-]/g, "")) || 0;
    const when = new Date(orderDate);
    if (isNaN(when)) continue;
    rows.push({ paymentType, when, machine, slot: String(slot).trim(), item: item.trim(), category, amount });
  }
  return rows;
}

// Pull raw transactions between two dates.
export async function pullSales(start, end) {
  const cookie = await login();
  const H = { Cookie: cookie, "Content-Type": "application/json" };

  const client = (await (await fetch(API + "/clients", { method: "POST", headers: H, body: "{}" })).json()).clientId;
  const parameterValues = { ...BASE_PARAMS, StartDate: new Date(start).toISOString(), EndDate: new Date(end).toISOString() };

  const ir = await fetch(`${API}/clients/${client}/instances`, {
    method: "POST", headers: H, body: JSON.stringify({ report: REPORT, parameterValues })
  });
  if (!ir.ok) throw new Error(`AirVend report refused the request (HTTP ${ir.status}).`);
  const instanceId = (await ir.json()).instanceId;

  const dr = await fetch(`${API}/clients/${client}/instances/${instanceId}/documents`, {
    method: "POST", headers: H, body: JSON.stringify({ format: "CSV", deviceInfo: {}, useCache: false })
  });
  const documentId = (await dr.json()).documentId;

  for (let i = 0; i < 60; i++) {
    const info = await (await fetch(`${API}/clients/${client}/instances/${instanceId}/documents/${documentId}/info`, { headers: { Cookie: cookie } })).json();
    if (info.documentReady) break;
    await new Promise(s => setTimeout(s, 700));
  }
  const csv = await (await fetch(`${API}/clients/${client}/instances/${instanceId}/documents/${documentId}`, { headers: { Cookie: cookie } })).text();
  return parseCsv(csv);
}

// Roll transactions into everything the app needs.
export function summarize(txns, costOf) {
  const now = easternNow();
  const wkStart = startOfWeek(now);
  const lastWkStart = new Date(wkStart); lastWkStart.setDate(lastWkStart.getDate() - 7);
  const moStart = startOfMonth(now);
  const lastMoStart = new Date(moStart); lastMoStart.setMonth(lastMoStart.getMonth() - 1);

  const bucket = () => ({ revenue: 0, profit: 0, units: 0 });
  const add = (b, t) => { const c = costOf(t.item); b.revenue += t.amount; b.units += 1; if (c != null) b.profit += t.amount - c; };

  const thisWeek = bucket(), lastWeek = bucket(), thisMonth = bucket(), lastMonth = bucket();
  const bySlot = {}, byItem = {}, byDay = {}, byDow = [0, 0, 0, 0, 0, 0, 0], byHour = Array(24).fill(0);

  for (const t of txns) {
    if (t.when >= wkStart) add(thisWeek, t);
    else if (t.when >= lastWkStart && t.when < wkStart) add(lastWeek, t);
    if (t.when >= moStart) add(thisMonth, t);
    else if (t.when >= lastMoStart && t.when < moStart) add(lastMonth, t);

    const key = `${t.machine}|${t.slot}`;
    if (!bySlot[key]) bySlot[key] = { machine: t.machine, slot: t.slot, item: t.item, ...bucket(), week: 0, prevWeek: 0 };
    add(bySlot[key], t);
    if (t.when >= wkStart) bySlot[key].week += 1;
    else if (t.when >= lastWkStart) bySlot[key].prevWeek += 1;

    if (!byItem[t.item]) byItem[t.item] = { item: t.item, ...bucket(), week: 0, prevWeek: 0 };
    add(byItem[t.item], t);
    if (t.when >= wkStart) byItem[t.item].week += 1;
    else if (t.when >= lastWkStart) byItem[t.item].prevWeek += 1;

    const dk = t.when.toISOString().slice(0, 10);
    if (!byDay[dk]) byDay[dk] = { d: dk, revenue: 0, profit: 0, units: 0 };
    const c = costOf(t.item);
    byDay[dk].revenue += t.amount; byDay[dk].units += 1; if (c != null) byDay[dk].profit += t.amount - c;

    byDow[t.when.getDay()] += t.amount;
    byHour[t.when.getHours()] += t.amount;
  }

  const days = Object.values(byDay).sort((a, b) => a.d.localeCompare(b.d));
  // week-by-week series (Sunday buckets)
  const weeks = {};
  for (const t of txns) {
    const w = startOfWeek(t.when).toISOString().slice(0, 10);
    if (!weeks[w]) weeks[w] = { w, revenue: 0, profit: 0, units: 0 };
    const c = costOf(t.item);
    weeks[w].revenue += t.amount; weeks[w].units += 1; if (c != null) weeks[w].profit += t.amount - c;
  }

  return {
    thisWeek, lastWeek, thisMonth, lastMonth,
    weekStart: wkStart.toISOString(),
    bySlot: Object.values(bySlot),
    byItem: Object.values(byItem).sort((a, b) => b.profit - a.profit),
    days,
    weeks: Object.values(weeks).sort((a, b) => a.w.localeCompare(b.w)),
    byDow, byHour,
    txnCount: txns.length,
  };
}
