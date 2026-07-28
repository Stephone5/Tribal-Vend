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

function cookieHeader(setCookies) {
  // keep only the "name=value" part of each Set-Cookie line
  return setCookies.map(c => c.split(";")[0]).join("; ");
}

// Log in and return a Cookie header string for authenticated requests.
export async function login() {
  const user = process.env.AIRVEND_USER, pass = process.env.AIRVEND_PASS;
  if (!user || !pass) throw new Error("AirVend login isn't configured on the server (AIRVEND_USER / AIRVEND_PASS).");

  const body = new URLSearchParams({ UserName: user, Password: pass, RememberMe: "true", ReturnUrl: "" });
  const res = await fetch(`${BASE}/Login/Validate`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    redirect: "manual"
  });

  const cookies = res.headers.getSetCookie?.() || [];
  // Success = a redirect (302/303) away from the login page, with a session cookie.
  // A 200 means AirVend re-rendered the login page → bad credentials.
  const redirected = res.status >= 300 && res.status < 400;
  if (!redirected) throw new Error("AirVend login failed — check the username and password.");
  if (!cookies.length) throw new Error("AirVend login returned no session cookie.");
  return cookieHeader(cookies);
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

// Set each slot's true on-hand count and post it back.
// onHandBySlot: { "<slotKey>": count }. Slots not listed default to full (MaxCapacity).
// Returns a plan of { slot, product, from, to }. dryRun:true (default) writes nothing.
export async function writeOnHand(machineId, onHandBySlot = {}, { dryRun = true } = {}) {
  const cookie = await login();
  const { fields, slots } = await getForm(cookie, machineId);

  const payload = { ...fields };
  payload["UsingQuantityAdded"] = "False"; // on-hand mode: the Quantity we send IS the current count

  const plan = [];
  for (const s of slots) {
    const listed = Object.prototype.hasOwnProperty.call(onHandBySlot, s.key);
    const to = listed ? Number(onHandBySlot[s.key]) : s.max; // unlisted = filled to par
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
  const ok = res.status === 302 || res.status === 303 || res.status === 200;
  if (!ok) throw new Error(`AirVend rejected the inventory update (HTTP ${res.status}). Nothing was changed on your end.`);
  return { dryRun: false, machineId, wrote: plan.length, plan };
}
