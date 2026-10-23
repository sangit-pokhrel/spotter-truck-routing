/* Service worker: offline app shell, cached map tiles, and route-risk notifications.
 *
 * Caching strategy
 *   page (navigation)      network first, fall back to the cached shell when offline
 *   /assets/* (hashed)     cache first: file names change whenever content changes
 *   map tiles, fonts       cache first / stale-while-revalidate, tiles capped at MAX_TILES
 *   /api/*                 never cached here: the app saves the last trip itself
 */
const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const FONTS = `fonts-${VERSION}`;
const KEEP = [SHELL, ASSETS, TILES, FONTS];
const MAX_TILES = 800;
const SHELL_URLS = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/favicon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The first visit loads before this worker controls the page; the page sends us the asset
// URLs it already loaded so the app works offline from the very first visit.
self.addEventListener("message", (event) => {
  if (event.data?.type === "cache-urls") {
    event.waitUntil(caches.open(ASSETS).then((c) => c.addAll(event.data.urls).catch(() => {})));
  }
});

async function cacheFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const resp = await fetch(request);
  if (resp.ok) cache.put(request, resp.clone());
  return resp;
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((resp) => {
      if (resp.ok) cache.put(request, resp.clone());
      return resp;
    })
    .catch(() => hit);
  return hit || network;
}

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_TILES)).map((k) => cache.delete(k)));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/api/")) return; // always live
    if (request.mode === "navigate") {
      event.respondWith(
        fetch(request)
          .then((resp) => {
            caches.open(SHELL).then((c) => c.put("/", resp.clone()));
            return resp;
          })
          .catch(() => caches.match("/")),
      );
      return;
    }
    if (url.pathname.startsWith("/assets/")) {
      event.respondWith(cacheFirst(ASSETS, request));
      return;
    }
    event.respondWith(staleWhileRevalidate(SHELL, request));
    return;
  }

  if (url.hostname === "server.arcgisonline.com") {
    event.respondWith(
      cacheFirst(TILES, request).then((resp) => {
        trimTiles();
        return resp;
      }),
    );
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(FONTS, request));
  }
});

// Tapping a risk alert brings the app back to the front.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => "focus" in w);
      return open ? open.focus() : self.clients.openWindow("/");
    }),
  );
});
