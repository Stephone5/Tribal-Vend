// Restock history, read from AirVend's "Refill History" report. Every inventory
// save in AirVend (from this app or the website) is a refill event. Several saves
// a few hours apart are one visit, so events within 6 hours merge into the first.

import { login } from "./airvend.js";

const API = "https://live.app.air-vend.com/reportingapi/reports";
const REPORT = "TsfRetailMarkets.AVLive.Reporting.RefillHistory, TsfRetailMarkets.AVLive.Reporting, Version=2026.8.0.1019, Culture=neutral, PublicKeyToken=null";
const T = () => AbortSignal.timeout(20000);

async function runReport(cookie, machineId, days) {
  const H = { Cookie: cookie, "Content-Type": "application/json" };
  const client = (await (await fetch(API + "/clients", { method: "POST", headers: H, body: "{}", signal: T() })).json()).clientId;
  const parameterValues = {
    UserId: 12154, CompanyId: 15812, IsGma: true, TimeZone: "Eastern Standard Time",
    SetRefillData: false, HasAdminRole: false, LevelId: -2, GroupId: -2, MachineId: Number(machineId),
    StartDate: new Date(Date.now() - days * 864e5).toISOString(), EndDate: new Date().toISOString(),
  };
  const ir = await fetch(`${API}/clients/${client}/instances`, { method: "POST", headers: H, body: JSON.stringify({ report: REPORT, parameterValues }), signal: T() });
  if (!ir.ok) throw new Error(`AirVend refill report refused (HTTP ${ir.status}).`);
  const id = (await ir.json()).instanceId;
  const dr = await fetch(`${API}/clients/${client}/instances/${id}/documents`, { method: "POST", headers: H, body: JSON.stringify({ format: "CSV", deviceInfo: {}, useCache: false }), signal: T() });
  const doc = (await dr.json()).documentId;
  for (let i = 0; i < 40; i++) {
    const info = await (await fetch(`${API}/clients/${client}/instances/${id}/documents/${doc}/info`, { headers: { Cookie: cookie }, signal: T() })).json();
    if (info.documentReady) break;
    await new Promise(s => setTimeout(s, 700));
  }
  return (await fetch(`${API}/clients/${client}/instances/${id}/documents/${doc}`, { headers: { Cookie: cookie }, signal: T() })).text();
}

// Returns { [machineId]: [Date, ...] } newest first. Dates are parsed the same
// way as sales timestamps (Eastern wall clock), so the two line up exactly.
export async function getRestocks(machineIds, days = 200) {
  const cookie = await login();
  const out = {};
  for (const mid of machineIds) {
    const csv = await runReport(cookie, mid, days);
    const times = [...csv.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} [AP]M)/g)].map(m => new Date(m[1])).filter(d => !isNaN(d));
    times.sort((a, b) => a - b);
    const visits = [];
    for (const t of times) if (!visits.length || t - visits[visits.length - 1] > 6 * 3600e3) visits.push(t);
    out[mid] = visits.reverse();
  }
  return out;
}

// Sales since the latest restock vs the average of the same stretch of time
// after each of the previous 4 restocks. A machine counts only if it was
// restocked in the last 21 days, so a parked machine doesn't skew the numbers.
export function sinceRestock(txns, restocks, machines, now, costOf) {
  const perMachine = [];
  let revenue = 0, profit = 0, units = 0, base = 0, minPrior = Infinity;
  for (const m of machines) {
    const list = restocks[m.id] || [];
    const last = list[0];
    if (!last || now - last > 21 * 864e5) continue;
    const elapsed = now - last;
    const mine = txns.filter(t => t.machine === m.name);
    const sumWin = (a, b) => {
      const acc = { r: 0, p: 0, u: 0 };
      for (const t of mine) if (t.when >= a && t.when < b) { const c = costOf(t.item); acc.r += t.amount; acc.u += 1; if (c != null) acc.p += t.amount - c; }
      return acc;
    };
    const cur = sumWin(last, new Date(now));
    const prior = list.slice(1, 5).map(r => ({ at: r, ...sumWin(r, new Date(r.getTime() + elapsed)) }));
    const avg = prior.length ? prior.reduce((a, p) => a + p.r, 0) / prior.length : null;
    // each restock's whole stretch, up to the next restock (or now), with its top 5
    const topOf = (a, b) => {
      const by = {};
      for (const t of mine) if (t.when >= a && t.when < b) {
        const c = costOf(t.item), it = (by[t.item] ||= { item: t.item, revenue: 0, profit: 0, units: 0 });
        it.revenue += t.amount; it.units += 1; if (c != null) it.profit += t.amount - c;
      }
      return Object.values(by).sort((x, y) => y.revenue - x.revenue).slice(0, 5);
    };
    const history = list.slice(0, 12).map((at, i) => {
      const end = i === 0 ? new Date(now) : list[i - 1];
      const w = sumWin(at, end);
      return { at: at.toISOString(), days: +((end - at) / 864e5).toFixed(1), revenue: w.r, profit: w.p, units: w.u, top: topOf(at, end) };
    }).reverse();
    revenue += cur.r; profit += cur.p; units += cur.u;
    if (avg != null) base += avg;
    minPrior = Math.min(minPrior, prior.length);

    // cumulative curve for the chart: this restock vs the prior average, up to ~100 points
    const hours = Math.max(1, Math.ceil(elapsed / 3600e3));
    const step = Math.max(1, Math.ceil(hours / 100));
    const curve = [];
    for (let h = 0; h <= hours + step - 1; h += step) {
      const hh = Math.min(h, hours);
      const off = Math.min(hh * 3600e3, elapsed); // the last point is exactly "now"
      const c = sumWin(last, new Date(last.getTime() + off)).r;
      const a = prior.length ? prior.reduce((acc, p) => acc + sumWin(p.at, new Date(p.at.getTime() + off)).r, 0) / prior.length : null;
      curve.push({ h: +(off / 3600e3).toFixed(2), c: +c.toFixed(2), a: a == null ? null : +a.toFixed(2) });
      if (hh === hours) break;
    }
    perMachine.push({
      id: m.id, name: m.name, restockedAt: last.toISOString(),
      revenue: cur.r, profit: cur.p, units: cur.u, avg, curve,
      top: topOf(last, new Date(now)), history,
    });
  }
  if (!perMachine.length) return null;
  const hasBase = minPrior !== Infinity && minPrior > 0;
  return {
    revenue, profit, units,
    avg: hasBase ? base : null,
    priorCount: hasBase ? minPrior : 0,
    pct: hasBase && base > 0 ? ((revenue - base) / base) * 100 : null,
    restockedAt: perMachine.map(p => p.restockedAt).sort().pop(),
    elapsedHours: (now - new Date(perMachine.map(p => p.restockedAt).sort().pop())) / 3600e3,
    machines: perMachine,
  };
}
