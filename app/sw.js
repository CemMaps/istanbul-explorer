// Offline support: the app shell, data and pinned CDN libraries are cached on first visit.
//
// Four caches (2026-11-10). Before, everything lived under the version name, so every update threw away the whole
// offline copy (map tiles and photos, ~60 MB), and the libraries the app needs to start shared a size-capped bucket
// with the photos: once it filled up, the oldest entries (the libraries, the map style) were the first to be deleted.
//   shell  – our own files. Versioned; replaced on each update.
//   core   – things the app can't start without offline: CDN libraries, fonts, the map style, sprites and glyphs.
//            Never trimmed (a small, bounded set).
//   tiles  – map tiles of every basemap. Capped, oldest out first. Kept across updates.
//   photos – Wikimedia photos. Capped. Kept across updates.
const VERSION = "oit-v42";
const SHELL_CACHE = `${VERSION}-shell`;
const CORE = "oit-core-1", TILES = "oit-tiles-1", PHOTOS = "oit-photos-1";
const KEEP = [SHELL_CACHE, CORE, TILES, PHOTOS];
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "map.js", "theme.js", "icons.js", "store.js", "sky.js", "routes.js", "share.js", "splash.js", "photos.js",
  "config.json", "theme.json", "manifest.webmanifest", "icons/favicon-32.png", "icons/favicon-64.png", "themes/index.json",
  "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/google-maps.png",
  ...["iznik-navy", "bosphorus-night", "tea-simit", "tile-white", "gul"].map((t) => `themes/${t}.json`),
  "../data/places.geojson", "../data/study_mask.geojson", "../data/ferries.geojson", "../data/stops.geojson", "../data/fixed.geojson", "../data/areas.geojson",
];
const TILE_LIMIT = 3000;
const PHOTO_LIMIT = 2500;
const SLOW_MS = 3000; // on a weak signal, stop waiting for the network after this and use the saved copy

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}
// Trim at most every 20 s per cache (2026-11-08): listing thousands of cache keys after every single tile
// slowed panning on phones.
const trimAt = {};
function trimSoon(cacheName, max) {
  if (trimAt[cacheName]) return;
  trimAt[cacheName] = setTimeout(() => { delete trimAt[cacheName]; trim(cacheName, max); }, 20000);
}

// Our own files: network first (so updates arrive), but if the network is slow or gone, the saved copy.
async function shellFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const saved = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (!saved) return net;
  net.catch(() => {}); // the timer may win; a later network error must not go unhandled
  return Promise.race([net.catch(() => saved), new Promise((r) => setTimeout(() => r(saved), SLOW_MS))]);
}

// Everything from elsewhere: saved copy first, filled as you browse.
async function cacheFirst(req, bucket, limit, viaCors) {
  const hit = await caches.match(req); // any cache
  if (hit) return hit;
  // Photos are always fetched with CORS, whoever asks (an <img>, a CSS background, the offline saver), so the answer's
  // status can be read: only good photos are kept, and one saved copy serves every kind of request.
  const res = await (viaCors ? fetch(req.url, { mode: "cors", credentials: "omit" }) : fetch(req));
  if (res.ok || (res.type === "opaque" && !viaCors)) {
    const copy = res.clone();
    caches.open(bucket).then((c) => c.put(req, copy)).then(() => { if (limit) trimSoon(bucket, limit); }).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) return e.respondWith(shellFirst(req));

  const host = url.hostname;
  if (host === "api.open-meteo.com" || host === "routing.openstreetmap.de") return; // weather is always live; routes are kept by the app itself
  if (host === "upload.wikimedia.org") return e.respondWith(cacheFirst(req, PHOTOS, PHOTO_LIMIT, true));
  if (host === "commons.wikimedia.org") return e.respondWith(cacheFirst(req, PHOTOS, PHOTO_LIMIT, false));
  // Map tiles: CARTO vector tiles (not its style, sprites or glyphs), Esri streets/satellite/labels, terrain.
  const isTile = (/cartocdn\.com$/.test(host) && /\/\d+\/\d+\/\d+\.(mvt|pbf|png)/.test(url.pathname) && !/\/fonts\//.test(url.pathname))
    || /arcgisonline\.com$/.test(host) || /elevation-tiles-prod/.test(host + url.pathname);
  e.respondWith(isTile ? cacheFirst(req, TILES, TILE_LIMIT, false) : cacheFirst(req, CORE, 0, false));
});
