// ---------------------------------------------------------------------------
// GitLike — Service Worker
// Caches immutable IPFS gateway responses (keyed by CID) for instant repeat
// access and partial offline support.
// ---------------------------------------------------------------------------

const CACHE_NAME = 'gitlike-ipfs-v1';
const IPFS_PATH = '/api/ipfs/';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only cache IPFS gateway proxy requests (immutable by CID)
  if (!url.pathname.startsWith(IPFS_PATH)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;

      const response = await fetch(event.request);

      // Only cache successful responses
      if (response.ok) {
        cache.put(event.request, response.clone());
      }

      return response;
    }),
  );
});
