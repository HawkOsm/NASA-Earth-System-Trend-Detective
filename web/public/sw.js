// Offline-first cache for data files and build assets.
// - data/*?v=<hash> and assets/*: the URL changes when the content does, so cache-first, forever.
//   A new hash for the same path evicts the stale copy.
// - everything else same-origin (index.html, unversioned files): network first, cache as fallback.
const CACHE = 'trend-detective-v1';
const BASE = new URL('./', self.location).pathname;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function put(cache, req, res) {
  if (!res.ok || res.status !== 200) return;
  const url = new URL(req.url);
  if (url.search) {
    // Drop older versions of the same file.
    for (const old of await cache.keys()) {
      const o = new URL(old.url);
      if (o.pathname === url.pathname && o.search !== url.search) await cache.delete(old);
    }
  }
  await cache.put(req, res);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  const rel = url.pathname.slice(BASE.length);
  const immutable = (rel.startsWith('data/') && url.search.startsWith('?v=')) || rel.startsWith('assets/');

  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (immutable) {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        e.waitUntil(put(cache, req, res.clone()));
        return res;
      }
      try {
        const res = await fetch(req);
        e.waitUntil(put(cache, req, res.clone()));
        return res;
      } catch (err) {
        const hit = await cache.match(req);
        if (hit) return hit;
        throw err;
      }
    })(),
  );
});
