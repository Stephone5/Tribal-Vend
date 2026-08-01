// Tribal Vend service worker.
//
// Cache-FIRST for the app shell so the app opens instantly — even when the
// server is asleep on Render's free tier. The shell paints immediately from
// cache, then data loads over the network with our own loading state. That
// removes Render's wake screen entirely for the installed app.
//
// A background update keeps the cached shell fresh: every load we quietly
// re-fetch the shell and store the new copy for next time.

const CACHE = "tv-v20";
const SHELL = [
  "./", "./index.html", "./app.js", "./data.js", "./closet.js",
  "./company.js", "./chat.js", "./api.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
];

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
  if (url.origin !== self.location.origin) return;

  // API calls always go to the network — never serve stale business data.
  if (url.pathname.startsWith("/api/")) return;

  // Shell: cache-first, refresh in the background.
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
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
