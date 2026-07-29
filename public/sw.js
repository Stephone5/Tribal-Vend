// Tribal Vend service worker.
// Network-first for the app shell (HTML + JS) so code files can never be served
// as a stale mix of old and new versions — that mismatch is what causes a blank
// white screen. Cache is the offline fallback only. Icons stay cache-first.

const CACHE = "tv-v12";
const SHELL = ["./", "./index.html", "./app.js", "./data.js", "./closet.js", "./api.js", "./manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // don't touch cross-origin
  if (url.pathname.startsWith("/api/")) return;    // never cache API calls

  const isShell = req.mode === "navigate" || /\.(js|html|webmanifest)$/.test(url.pathname) || url.pathname === "/";

  if (isShell) {
    // Network first: always try for the freshest code; fall back to cache offline.
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // Everything else (icons, images): cache first, then network.
  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});

// Restock push notifications land here once the backend sends them.
self.addEventListener("push", e => {
  let d = { title: "Restock ready", body: "Your buy list is ready." };
  try { d = e.data.json(); } catch (_) {}
  e.waitUntil(self.registration.showNotification(d.title, {
    body: d.body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png", data: d
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.openWindow("./index.html"));
});
