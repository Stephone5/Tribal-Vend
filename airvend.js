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
