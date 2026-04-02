/* ============================================================
   VortexFlow NCR — Service Worker (sw.js)
   Cache-first strategy with background refresh
   ============================================================ */

const CACHE_VERSION = 'vortexflow-ncr-v2.3.0';
const PRECACHE_URLS = [
  './index.html',
  './style.css',
  './enterprise.css',
  './enterprise-plus.css',
  './app.js',
  './enterprise.js',
  './enterprise-plus.js',
  './manifest.json',
  './assets/icons/vortexflow-ncr-icon.svg',
  './assets/icons/vortexflow-ncr-maskable.svg'
];

/* ---- INSTALL: Precache app shell ---- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => {
        console.log('[SW] Precaching app shell');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Precache failed (offline install):', err))
  );
});

/* ---- ACTIVATE: Purge old caches ---- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => {
            console.log('[SW] Deleting old cache:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ---- FETCH: Stale-while-revalidate ---- */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests that aren't CDN resources
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return;
  const isSameOrigin = url.origin === self.location.origin;
  const isTrustedCDN = [
    'cdn.tailwindcss.com',
    'cdnjs.cloudflare.com',
    'cdn.jsdelivr.net',
    'unpkg.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdn.sheetjs.com'
  ].some(cdn => url.hostname.includes(cdn));

  if (!isSameOrigin && !isTrustedCDN) return;

  event.respondWith(
    caches.open(CACHE_VERSION).then(cache =>
      cache.match(event.request).then(cached => {
        // Background refresh
        const networkFetch = fetch(event.request)
          .then(response => {
            if (response && response.status === 200 && response.type !== 'opaque') {
              cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          // Return cached immediately, refresh in background
          networkFetch.catch(() => {}); // suppress unhandled promise
          return cached;
        }

        // Not cached: wait for network
        return networkFetch.then(response => {
          if (response) return response;
          // Network failed + not cached: return app shell for document requests
          if (event.request.destination === 'document') {
            return cache.match('./index.html');
          }
        });
      })
    )
  );
});

/* ---- MESSAGE: Handle skip-waiting from UI ---- */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});
