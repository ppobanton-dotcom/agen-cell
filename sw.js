// PWA Chrome Requirement Engine
const CACHE_NAME = 'arsyila-pos-cache-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/app.js',
  '/style.css',
  '/logo-apotek.png',
  '/manifest.json',
  '/walpaper.jpg',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/html5-qrcode'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        // Fetch and cache each URL individually so one failure doesn't block others
        for (let url of urlsToCache) {
          try {
            await cache.add(url);
          } catch (e) {
            console.error('Failed to cache:', url, e);
          }
        }
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Do not intercept or cache Supabase API requests
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  // Use ignoreSearch only for our own origin (fixes ?akses=kasir issue)
  const isLocal = url.origin === location.origin;
  const matchOptions = isLocal ? { ignoreSearch: true } : {};

  event.respondWith(
    caches.match(event.request, matchOptions)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        return fetch(event.request).then(networkResponse => {
          // Check if we received a valid response
          if (!networkResponse || networkResponse.status !== 200 || (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
            return networkResponse;
          }

          // Clone the response because it's a stream and can only be consumed once
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        }).catch(err => {
          console.error('Fetch failed:', err);
        });
      })
  );
});
