// Durable key–value storage via Upstash Redis (REST API — just fetch, no driver).
// Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in the environment.
// If they're not set, it falls back to in-memory storage so local dev still runs
// (in-memory is NOT durable — it resets when the server restarts).

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = new Map();

export const storeReady = () => !!(URL && TOKEN);

async function cmd(args) {
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args)
  });
  if (!res.ok) throw new Error(`storage error (HTTP ${res.status})`);
  const j = await res.json();
  return j.result;
}

// Read a JSON document by key. Returns null if absent.
export async function getDoc(key) {
  if (!storeReady()) return mem.has(key) ? JSON.parse(mem.get(key)) : null;
  const raw = await cmd(["GET", key]);
  return raw ? JSON.parse(raw) : null;
}

// Write a JSON document by key.
export async function setDoc(key, value) {
  const raw = JSON.stringify(value ?? null);
  if (!storeReady()) { mem.set(key, raw); return; }
  await cmd(["SET", key, raw]);
}
