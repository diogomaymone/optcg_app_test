// Offline cache for the home-screen app. Scope is the folder this file is served from (/optcg_app_test/).
const VERSION = '34'; // the deploy workflow puts its run number here, so each deploy gets fresh shell caches
const SHELL = `shell-${VERSION}`;
const IMG = 'img-v1'; // card images: kept across versions
const CDN = 'cdn-v1'; // the scanner's text reader (~30 MB, version-pinned URLs): kept across versions, so it starts offline
const MAX_IMG = 4000; // shortcut: capped by count, since cross-origin (opaque) response sizes are unreadable

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== IMG && k !== CDN).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

const put = (cache, req, res) => caches.open(cache).then((c) => c.put(req, res));
const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

// index.html: the network, so a new version shows on the next open; the cached copy when offline or slow.
async function page(req) {
  try {
    const res = await Promise.race([fetch(req.url, { cache: 'no-cache' }), timeout(3000)]); // no-cache: never an old page from the HTTP cache (Pages sends max-age=600)
    if (res.ok) put(SHELL, './', res.clone());
    return res;
  } catch {
    return (await caches.match('./')) || Response.error();
  }
}

// Hashed bundles never change: the cache, else the network.
async function cacheFirst(req, cache) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    await put(cache, req, res.clone());
    if (cache === IMG) trim();
  }
  return res;
}

// prices.json and friends: answer from the cache at once, refresh it in the background.
async function staleWhileRevalidate(e) {
  const hit = await caches.match(e.request);
  const fresh = fetch(e.request).then((res) => (res.ok && put(SHELL, e.request, res.clone()), res));
  if (hit) {
    e.waitUntil(fresh.catch(() => {}));
    return hit;
  }
  return fresh;
}

let trimming = false;
async function trim() {
  if (trimming) return;
  trimming = true;
  const c = await caches.open(IMG);
  const keys = await c.keys(); // insertion order: oldest first
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_IMG)).map((k) => c.delete(k)));
  trimming = false;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const mine = url.origin === location.origin && url.pathname.startsWith(new URL(self.registration.scope).pathname);
  if (req.mode === 'navigate' && mine && !url.pathname.endsWith('.html')) return e.respondWith(page(req)); // other .html pages must not replace the cached app
  if (mine && url.pathname.includes('/_expo/')) return e.respondWith(cacheFirst(req, SHELL));
  if (mine && url.pathname.endsWith('.json')) return e.respondWith(staleWhileRevalidate(e));
  if (url.hostname === 'cdn.jsdelivr.net' && /^\/npm\/(onnxruntime-web|@gutenye\/ocr-models)@/.test(url.pathname)) return e.respondWith(cacheFirst(req, CDN));
  if (req.destination === 'image' && url.hostname !== 'api.github.com') return e.respondWith(cacheFirst(req, IMG));
  // everything else (the GitHub API included) goes straight to the network
});
