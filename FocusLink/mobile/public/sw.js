const CACHE_NAME = 'focuslink-mobile-shell-v3';
const APP_SHELL = [
  './manifest.webmanifest',
  './icons/focuslink.svg',
  './icons/focuslink-192.png',
  './icons/focuslink-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const indexResponse = await fetch('./index.html', { cache: 'no-cache' });
      if (!indexResponse.ok) throw new Error('unable to cache FocusLink mobile entry');
      const markup = await indexResponse.clone().text();
      const generatedAssets = [...markup.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map(
        (match) => match[1],
      );
      await cache.put('./index.html', indexResponse);
      await cache.addAll([...APP_SHELL, ...generatedAssets]);
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/v1/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match('./index.html')) || Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
