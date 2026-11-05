// Offline support: the app shell, data and pinned CDN libraries are cached on first visit.
// Same-origin files: network first (so updates arrive), cache as fallback.
// CDN libs, fonts, Commons photos and map tiles: cache first, filled as you browse (tiles capped).
const VERSION = "oit-v6";
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "map.js", "theme.js", "icons.js", "store.js", "sky.js", "routes.js", "share.js", "splash.js",
  "config.json", "theme.json", "manifest.webmanifest", "icon.svg", "themes/index.json",
  ...["iznik-navy", "bosphorus-night", "tea-simit", "tile-white", "gul"].map((t) => `themes/${t}.json`),
  "../data/places.geojson", "../data/study_mask.geojson", "../data/ferries.geojson", "../data/stops.geojson", "../data/fixed.geojson", "../data/areas.geojson",
];
const TILE_LIMIT = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.open-meteo.com") return; // weather is always live

  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }

  const isTile = /cartocdn\.com/.test(url.hostname);
  const bucket = isTile ? `${VERSION}-tiles` : `${VERSION}-ext`;
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === "opaque") {
      const copy = res.clone();
      caches.open(bucket).then((c) => c.put(req, copy)).then(() => isTile && trim(bucket, TILE_LIMIT));
    }
    return res;
  })));
});
