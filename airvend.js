// AirVend write-back. Logs into AirVend as the owner, reads the live inventory
// form for a machine, overlays the true on-hand counts, and posts it back —
// setting AirVend's inventory to match reality. Credentials live only in the
// server environment (AIRVEND_USER / AIRVEND_PASS); they never reach the phone.
//
// Safety: writeOnHand defaults to dryRun. A dry run logs in and reads the form
// but changes NOTHING — it returns the exact from→to plan for review. Only an
// explicit dryRun:false actually writes to the machine.

import * as cheerio from "cheerio";

const BASE = "https://live.app.air-vend.com";

// Accumulate Set-Cookie lines into a name→value jar (last value wins; a cleared
// cookie is removed). AirVend's login sets cookies across several redirect hops.
function updateJar(jar, setCookies) {
  for (const c of setCookies) {
    const nv = c.split(";")[0];
    const i = nv.indexOf("=");
    if (i < 0) continue;
    const name = nv.slice(0, i).trim();
    const val = nv.slice(i + 1);
    if (val === "" || /expires=Thu, 01 Jan 1970/i.test(c)) jar.delete(name);
    else jar.set(name, val);
  }
}
function jarHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// Log in and return a Cookie header string. Follows AirVend's multi-hop login
// chain (Login/Validate → Account/VerifyAuth → …) accumulating cookies, until it
// lands on a real page. A bounce back to /Login means bad credentials.
export async function login() {
  const user = process.env.AIRVEND_USER, pass = process.env.AIRVEND_PASS;
  if (!user || !pass) throw new Error("AirVend login isn't configured on the server (AIRVEND_USER / AIRVEND_PASS).");

  const jar = new Map();
  let url = `${BASE}/Login/Validate`;
  let method = "POST";
  let body = new URLSearchParams({ UserName: user, Password: pass, RememberMe: "true", ReturnUrl: "" });

  for (let hop = 0; hop < 6; hop++) {
    const headers = { Cookie: jarHeader(jar) };
    if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
    const res = await fetch(url, { method, headers, body: method === "POST" ? body : undefined, redirect: "manual" });
    updateJar(jar, res.headers.getSetCookie?.() || []);

    if (res.status >= 300 && res.status < 400) {
      let loc = res.headers.get("location");
      if (!loc) break;
      if (loc.startsWith("/")) loc = BASE + loc;
      if (/\/Login(\?|\/|$)/i.test(loc) && hop > 0) throw new Error("AirVend login failed — check the username and password.");
      url = loc; method = "GET"; body = undefined;
      continue;
    }
    break; // landed on a real page
  }

  if (![...jar.keys()].some(k => /ASPXFORMSAUTH/i.test(k))) {
    throw new Error("AirVend login failed — no session was established.");
  }
  return jarHeader(jar);
}

// Read the live inventory form for a machine into { fields, slots }.
export async function getForm(cookie, machineId) {
  const res = await fetch(`${BASE}/Planogram/UpdateQuantities/?machineId=${encodeURIComponent(machineId)}`, {
    headers: { Cookie: cookie },
    redirect: "manual"
  });
  if (res.status >= 300 && res.status < 400) throw new Error("AirVend session was rejected — login may have failed.");
  const html = await res.text();
  const $ = cheerio.load(html);
  const form = $("#updateQuantitiesForm");
  if (!form.length) throw new Error("Couldn't find AirVend's inventory form (wrong machine id, or not logged in).");

  const fields = {};
  form.find("input, select, textarea").each((_, el) => {
    const name = $(el).attr("name");
    if (!name) return;
    const type = ($(el).attr("type") || "").toLowerCase();
    if (type === "radio") {
      if ($(el).attr("checked") !== undefined) fields[name] = $(el).attr("value") ?? "";
    } else {
      fields[name] = $(el).attr("value") ?? "";
    }
  });

  // Build a slot list from the Trays[t].Slots[s].* fields.
  const slots = [];
  for (const name of Object.keys(fields)) {
    const m = name.match(/^(Trays\[\d+\]\.Slots\[\d+\])\.Key$/);
    if (!m) continue;
    const p = m[1];
    slots.push({
      prefix: p,
      key: String(fields[`${p}.Key`] ?? ""),
      product: fields[`${p}.ProductName`] ?? "",
      onHand: Number(fields[`${p}.OnHandQuantity`] ?? 0),
      max: Number(fields[`${p}.MaxCapacity`] ?? 0)
    });
  }
  return { fields, slots };
}

// Read the live planogram (product + price + capacity) for a machine.
export async function getPlanogram(cookie, machineId) {
  const res = await fetch(`${BASE}/Planogram/Edit/?id=${encodeURIComponent(machineId)}&state=Current`, {
    headers: { Cookie: cookie }, redirect: "manual"
  });
  const html = await res.text();
  const $ = cheerio.load(html);
  const f = {};
  $("input, select").each((_, el) => {
    const name = $(el).attr("name"); if (!name) return;
    f[name] = $(el).attr("value") ?? "";
  });
  const out = [];
  for (const name of Object.keys(f)) {
    const m = name.match(/^(Trays\[\d+\]\.Slots\[\d+\])\.Key$/);
    if (!m) continue;
    const p = m[1];
    out.push({
      slot: String(f[`${p}.Key`] ?? ""),
      price: Number(f[`${p}.Price`] ?? 0),
      product: f[`${p}.ProductName`] ?? "",
    });
  }
  return out;
}

// Combined live view: product name + on-hand + capacity (from the quantities
// form) merged with price (from the planogram page).
export async function getMachineLive(machineId) {
  const cookie = await login();
  const [{ slots }, plano] = await Promise.all([
    getForm(cookie, machineId),
    getPlanogram(cookie, machineId),
  ]);
  const priceBySlot = Object.fromEntries(plano.map(p => [p.slot, p.price]));
  return slots.map(s => ({
    slot: s.key,
    product: s.product,
    onHand: s.onHand,
    max: s.max,
    price: priceBySlot[s.key] ?? 0,
  }));
}

// Set each slot's true on-hand count and post it back.
// missingBySlot: { "<slotKey>": unitsMissing }. For a listed slot, on-hand = par − missing.
// Every slot NOT listed is assumed full to par (its MaxCapacity).
// Returns a plan of { slot, product, from, to }. dryRun:true (default) writes nothing.
export async function writeOnHand(machineId, missingBySlot = {}, { dryRun = true } = {}) {
  const cookie = await login();
  const { fields, slots } = await getForm(cookie, machineId);

  const payload = { ...fields };
  payload["UsingQuantityAdded"] = "False"; // on-hand mode: the Quantity we send IS the current count
  // The refill happens now. AirVend rejects a refill date earlier than its
  // MinimumRefillDate — echoing the old date back is what made writes fail.
  const refillDate = airvendNow();
  payload["RefillDate"] = refillDate;

  const plan = [];
  for (const s of slots) {
    const missing = Object.prototype.hasOwnProperty.call(missingBySlot, s.key) ? Number(missingBySlot[s.key]) : 0;
    const to = Math.max(0, s.max - missing); // full to par, minus what's missing
    payload[`${s.prefix}.Quantity`] = String(to);
    plan.push({ slot: s.key, product: s.product, from: s.onHand, to });
  }

  if (dryRun) return { dryRun: true, machineId, plan };

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) body.append(k, v ?? "");
  const res = await fetch(`${BASE}/Planogram/UpdateQuantities`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual"
  });
  // A saved form redirects. A 200 means AirVend handed the form back — usually
  // with a validation error — so it did NOT save. Never report that as success.
  if (res.status === 200) {
    const $ = cheerio.load(await res.text());
    const msgs = $(".validation-summary-errors li, .field-validation-error, .k-invalid-msg, .alert-danger")
      .map((_, e) => $(e).text().trim()).get().filter(Boolean);
    throw new Error(`AirVend did not save the update${msgs.length ? `: ${[...new Set(msgs)].join(" · ")}` : " (it returned the form without saving)"}.`);
  }
  if (!(res.status === 302 || res.status === 303)) {
    throw new Error(`AirVend rejected the inventory update (HTTP ${res.status}). Nothing was saved.`);
  }

  // Proof, not trust: read AirVend back and check every slot actually took.
  const after = await getForm(cookie, machineId);
  const nowBySlot = Object.fromEntries(after.slots.map(s => [s.key, s.onHand]));
  const diffs = plan.map(p => ({ ...p, airvendNow: Number(nowBySlot[p.slot]) })).filter(p => p.airvendNow !== Number(p.to));
  // Lower than entered = a sale landed between the save and this check (the
  // machine keeps selling while you finish up). That's not a failed save.
  const soldSince = diffs.filter(p => p.airvendNow < Number(p.to));
  const failed = diffs.filter(p => !(p.airvendNow < Number(p.to)));
  if (failed.length) {
    const list = failed.slice(0, 8).map(m => `slot ${m.slot} is ${m.airvendNow}, you entered ${m.to}`).join("; ");
    throw new Error(`AirVend accepted the form but ${failed.length} slot${failed.length === 1 ? "" : "s"} didn't update: ${list}.`);
  }
  return { dryRun: false, machineId, wrote: plan.length, verified: true, refillDate, plan,
    soldSince: soldSince.map(p => ({ slot: p.slot, product: p.product, entered: Number(p.to), now: p.airvendNow })) };
}

// Current time in AirVend's format ("M/d/yyyy h:mm AM"), Central time — the machines are in Oklahoma.
function airvendNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}`;
}
