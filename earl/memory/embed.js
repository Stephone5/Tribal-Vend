// embed.js — ported from the Bridge. In-process text embeddings (gte-small,
// 384 dims) via @xenova/transformers, so member text never goes to an
// embedding vendor. The model (~30MB) downloads on first use.

let pipePromise = null;
const LOAD_TIMEOUT_MS = 45000;

function getPipe() {
  if (!pipePromise) {
    pipePromise = Promise.race([
      (async () => {
        const { pipeline } = await import("@xenova/transformers");
        return pipeline("feature-extraction", "Xenova/gte-small");
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("embedding model load timed out after " + LOAD_TIMEOUT_MS + "ms")), LOAD_TIMEOUT_MS)),
    ]);
    pipePromise.catch(() => { pipePromise = null; });
  }
  return pipePromise;
}

export async function embed(text) {
  const pipe = await getPipe();
  const out = await pipe(String(text || "").slice(0, 2000), { pooling: "mean", normalize: true });
  return Array.from(out.data);
}
