// Leads: the prospect lists and the research, kept in Earl's database.
// Earl can SEARCH these (read-only). Only Stephen changes a status.
// Seeding runs once from the files in this repo and never overwrites a status.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getClient } from "./db.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = () => {
  const c = getClient();
  if (!c) throw new Error("Earl's database isn't connected.");
  return c;
};

// ---------- reading ----------
export async function findProspects({ anchor, category, maxMiles, minScore, status, hasPhone, search, limit = 10 } = {}) {
  let q = db().from("prospects").select("*");
  if (anchor) q = q.eq("anchor", anchor);
  if (status) q = Array.isArray(status) ? q.in("status", status) : q.eq("status", status);
  if (category) q = q.ilike("category", `%${category}%`);
  if (maxMiles != null) q = q.lte("miles", maxMiles);
  if (minScore != null) q = q.gte("score", minScore);
  if (hasPhone) q = q.not("phone", "is", null).neq("phone", "");
  if (search) q = q.or(`name.ilike.%${search}%,note.ilike.%${search}%,addr.ilike.%${search}%`);
  const { data, error } = await q.order("tier", { ascending: true }).order("score", { ascending: false }).limit(Math.min(limit, 60));
  if (error) throw new Error("prospect search failed: " + error.message);
  return data || [];
}

export async function countsByAnchor() {
  const { data, error } = await db().from("prospects").select("anchor,status");
  if (error) throw new Error("prospect counts failed: " + error.message);
  const out = {};
  for (const r of data || []) {
    (out[r.anchor] ||= { total: 0, new: 0, called: 0, interested: 0, no: 0, later: 0 });
    out[r.anchor].total++; out[r.anchor][r.status]++;
  }
  return out;
}

export async function setProspectStatus(id, status, myNote) {
  const patch = { status, updated_at: new Date().toISOString() };
  if (myNote !== undefined) patch.my_note = myNote;
  if (status !== "new" && status !== "later") patch.contacted_at = new Date().toISOString();
  const { data, error } = await db().from("prospects").update(patch).eq("id", id).select().single();
  if (error) throw new Error("saving the status failed: " + error.message);
  return data;
}

export async function searchResearch(query, limit = 3) {
  const words = String(query || "").split(/\s+/).filter(w => w.length > 3).slice(0, 4);
  if (!words.length) return [];
  const or = words.map(w => `heading.ilike.%${w}%,body.ilike.%${w}%`).join(",");
  const { data, error } = await db().from("research_sections").select("*").or(or).limit(limit);
  if (error) throw new Error("research search failed: " + error.message);
  return (data || []).map(r => ({ ...r, body: r.body.slice(0, 4000) }));
}

// ---------- seeding from the repo files ----------
function rowsFromScoredJson(file, anchor) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
  return (j.rows || []).map(r => ({
    anchor, name: r.name, category: r.category, tier: 2, score: r.score,
    miles: r.miles, food_ft: r.foodFt, addr: [r.addr, r.city].filter(Boolean).join(", ") || null,
    phone: r.phone || null, website: r.website || null, lat: r.lat, lon: r.lon, note: r.note || null,
  }));
}

// The markdown tables carry the verified phone numbers and the hand notes.
function rowsFromMarkdown(file, anchor) {
  const md = fs.readFileSync(path.join(ROOT, file), "utf8");
  const out = [];
  for (const line of md.split("\n")) {
    const m = line.match(/^\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*([\d.]+)\s*mi\s*\|\s*([\d,]+)\s*ft[^|]*\|\s*(.*?)\s*\|$/);
    if (m) {
      const [, , score, nameRaw, category, miles, foodFt, contact] = m;
      const name = nameRaw.replace(/\*\*/g, "").trim();
      const phone = (contact.match(/\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/) || [])[0] || null;
      const addr = (contact.split("·").find(p => /\d{3,}\s+\w|,\s*OKC/.test(p)) || "").trim() || null;
      const note = contact.split("·").slice(2).join("·").trim() || null;
      out.push({ anchor, name, category, tier: 2, score: +score, miles: +miles, food_ft: +foodFt.replace(/,/g, ""), addr, phone, note });
      continue;
    }
    // Tier 1 table: | **Site**, address | headcount | (dist) | note |
    const t1 = line.match(/^\|\s*\*\*(.+?)\*\*,?\s*([^|]*)\|\s*([^|]+)\|\s*([^|]*)\|\s*([^|]*)\|$/);
    if (t1) {
      const [, name, addr, headcount, dist, note] = t1;
      const phone = (note.match(/\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}/) || [])[0] || null;
      out.push({ anchor, name: name.trim(), category: "Tier 1 anchor", tier: 1, score: null,
        miles: parseFloat(String(dist).replace(/[^\d.]/g, "")) || null, food_ft: null,
        headcount: headcount.trim() || null, addr: addr.trim() || null, phone, note: note.trim() || null });
    }
  }
  return out;
}

function sectionsFromMarkdown(file) {
  const md = fs.readFileSync(path.join(ROOT, file), "utf8");
  const parts = md.split(/\n(?=##\s)/);
  return parts.map(p => {
    const heading = (p.match(/^##+\s*(.+)$/m) || [, "Intro"])[1].trim();
    return { doc: file, heading, body: p.trim() };
  }).filter(s => s.body.length > 80);
}

export async function seedLeads() {
  const c = getClient();
  if (!c) return { skipped: "no database" };
  const { count } = await c.from("prospects").select("*", { count: "exact", head: true });
  const out = { prospects: 0, research: 0 };
  if (!count) {
    const rows = [];
    const add = (file, anchor, fn) => { try { rows.push(...fn(file, anchor)); } catch (e) { console.error("[leads] seed", file, e.message); } };
    add("okc-prospects-home.json", "home", rowsFromScoredJson);
    add("okc-prospect-list-home.md", "home", rowsFromMarkdown);
    if (fs.existsSync(path.join(ROOT, "okc-prospects-shop.json"))) add("okc-prospects-shop.json", "shop", rowsFromScoredJson);
    add("okc-prospect-list.md", "shop", rowsFromMarkdown);
    // Merge duplicates: the markdown row (verified phone, hand note) wins.
    const byKey = new Map();
    for (const r of rows) {
      const k = r.anchor + "|" + r.name.toLowerCase();
      const prev = byKey.get(k);
      byKey.set(k, prev ? { ...prev, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== "")) } : r);
    }
    const list = [...byKey.values()];
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await c.from("prospects").insert(list.slice(i, i + 200));
      if (error) { console.error("[leads] seed insert:", error.message); break; }
    }
    out.prospects = list.length;
  }
  const { count: rCount } = await c.from("research_sections").select("*", { count: "exact", head: true });
  if (!rCount) {
    const sections = [];
    for (const f of ["okc-vending-research-v2.md", "okc-prospect-list.md", "okc-prospect-list-home.md"]) {
      if (fs.existsSync(path.join(ROOT, f))) { try { sections.push(...sectionsFromMarkdown(f)); } catch (e) { console.error("[leads] sections", f, e.message); } }
    }
    if (sections.length) {
      const { error } = await c.from("research_sections").insert(sections);
      if (error) console.error("[leads] research insert:", error.message);
      else out.research = sections.length;
    }
  }
  if (out.prospects || out.research) console.log("[leads] seeded", JSON.stringify(out));
  return out;
}
