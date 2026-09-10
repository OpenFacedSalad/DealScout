const STATIC_CACHE = 'dealscout-static-v2.2';
const API_CACHE = 'dealscout-api-v2.2';

const isDevOrPreview =
  self.location.hostname === 'localhost' ||
  self.location.hostname === '127.0.0.1' ||
  self.location.hostname.includes('ais-dev') ||
  self.location.hostname.includes('run.app');

if (isDevOrPreview) {
  // In development and AI Studio preview containers, actively deregister and bypass caching
  // to avoid Vite HMR conflicts and white-screen module caching issues.
  self.addEventListener('install', () => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Support offline POST flyer retrieval even in preview if network drops
    if (url.pathname === '/api/circulars/nearby' && request.method === 'POST') {
      event.respondWith(handleNearbyCircularsOffline(request));
      return;
    }

    // Direct network pass-through for all other requests
    return;
  });
} else {
  // Standalone Production PWA Mode
  const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/icon-192.png',
    '/icon-512.png'
  ];

  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
    );
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key))
        )
      )
    );
    self.clients.claim();
  });

  self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Bypass non-http schemes and development/internal paths
    if (
      !url.protocol.startsWith('http') ||
      url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/src/') ||
      url.pathname.startsWith('/node_modules/') ||
      url.pathname.startsWith('/_aistudio') ||
      url.search.includes('v=') ||
      url.search.includes('t=')
    ) {
      return;
    }

    // 1. Handle POST /api/circulars/nearby with synthetic GET cache keys
    if (url.pathname === '/api/circulars/nearby' && request.method === 'POST') {
      event.respondWith(handleNearbyCircularsOffline(request));
      return;
    }

    // 2. Pass other /api/ calls directly through network
    if (url.pathname.startsWith('/api/')) {
      event.respondWith(fetch(request));
      return;
    }

    // 3. For HTML navigation requests, ALWAYS perform Network-First so app updates show immediately
    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return networkResponse;
          })
          .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html') || caches.match('/')))
      );
      return;
    }

    // 4. Only handle GET requests for static assets
    if (request.method !== 'GET') {
      return;
    }

    // Static Assets: Stale-While-Revalidate
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              caches.open(STATIC_CACHE).then((cache) => {
                cache.put(request, copy).catch(() => {});
              }).catch(() => {});
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  });
}

async function handleNearbyCircularsOffline(request) {
  const clonedRequest = request.clone();
  let bodyText = '';

  try {
    bodyText = await clonedRequest.text();
  } catch (err) {
    bodyText = 'default';
  }

  const cacheKey = new Request(`/api/circulars/cache?payload=${encodeURIComponent(bodyText)}`);
  const apiCache = await caches.open(API_CACHE);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200) {
      await apiCache.put(cacheKey, networkResponse.clone());
    }
    return networkResponse;
  } catch (networkError) {
    const cachedResponse = await apiCache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }

    const allRequests = await apiCache.keys();
    if (allRequests.length > 0) {
      const fallbackResponse = await apiCache.match(allRequests[0]);
      if (fallbackResponse) return fallbackResponse;
    }

    return new Response(
      JSON.stringify({ stores: [], deals: [], offline: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

// Background Sync Handler (Chromium / Android)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-cart') {
    event.waitUntil(replayCartQueue());
  }
});

function getSyncDB() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const request = indexedDB.open('dealscout_sync_db', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function replayCartQueue() {
  const db = await getSyncDB();
  if (!db) return;

  try {
    const tx = db.transaction('cart_queue', 'readwrite');
    const store = tx.objectStore('cart_queue');

    const getItems = new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });

    const items = await getItems;
    if (!items || items.length === 0) return;

    for (const entry of items) {
      try {
        const response = await fetch('/api/cart/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        });

        if (response.ok) {
          const deleteTx = db.transaction('cart_queue', 'readwrite');
          deleteTx.objectStore('cart_queue').delete(entry.id);
        } else {
          throw new Error('Server rejected mutation');
        }
      } catch (error) {
        throw error;
      }
    }
  } catch (e) {
    console.warn('[PWA] Replay cart queue deferred:', e);
  }
}
