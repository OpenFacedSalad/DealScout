// Service Worker Cleanup & Self-Deregistration
// Ensures mobile browsers never get stuck on stale bundles or white screens

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

self.addEventListener('fetch', () => {
  // Pass all fetches directly to network without caching
  return;
});
