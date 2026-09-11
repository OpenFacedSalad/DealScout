const CACHE_NAME = 'dealscout-cache-v2.4';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Cache-First strategy for static assets, Network-First for API calls
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Do not intercept mutations
  if (event.request.method !== 'GET') {
    return;
  }

  // Network-first for API requests
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for frontend bundles
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return (
        cachedResponse ||
        fetch(event.request).then((networkResponse) => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
      );
    })
  );
});

// -----------------------------------------------------------------------------
// WEB PUSH NOTIFICATIONS & AD-HOC TESTING
// -----------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = {
    title: 'DealScout Circular Alert 🛒',
    body: 'Fresh weekly flyer discounts available near you.',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    data: { url: '/' },
    actions: [
      { action: 'view_deals', title: 'View Deals' },
      { action: 'open_list', title: 'Open List' },
    ],
  };

  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || '/icons/icon-192x192.png',
    badge: payload.badge || '/icons/badge-72x72.png',
    data: payload.data || { url: '/' },
    actions: payload.actions || [
      { action: 'view_deals', title: 'View Deals' },
      { action: 'open_list', title: 'Open List' },
    ],
    vibrate: [100, 50, 100],
    renotify: true,
    tag: payload.tag || 'dealscout-notification',
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  let targetPath = event.notification.data?.url || '/';
  if (event.action === 'open_list') {
    targetPath = '/#list';
  } else if (event.action === 'view_deals') {
    targetPath = '/#circulars';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if ('navigate' in client) {
            client.navigate(targetPath);
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetPath);
      }
    })
  );
});
