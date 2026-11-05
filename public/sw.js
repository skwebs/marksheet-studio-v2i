/* Marksheet Studio V2 offline application shell. Bump CACHE_VERSION when changing this file. */
const CACHE_VERSION = 'marksheet-studio-v2-shell-v4';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/marksheet-multi-exam.html',
  '/marksheet-single-exam.html',
  '/demo-school-logo.svg',
  '/brand-illustration.png',
  '/og-image.jpg',
  '/favicon.ico',
  '/icons/icon-16x16.png',
  '/icons/icon-32x32.png',
  '/icons/icon-180x180.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-192x192-maskable.png',
  '/icons/icon-512x512-maskable.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(APP_SHELL.map(async path => {
      try {
        const response = await fetch(path, { cache: 'reload' });
        if (response.ok) await cache.put(path, response);
      } catch { /* An unavailable optional shell item must not block installation. */ }
    }));
    // Cache the hashed Vite entry bundle and stylesheet on first install as well.
    try {
      const indexResponse = await fetch('/index.html', { cache: 'reload' });
      const html = await indexResponse.clone().text();
      const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1]);
      await Promise.all(assetPaths.map(async path => {
        try { const response = await fetch(path, { cache: 'reload' }); if (response.ok) await cache.put(path, response); } catch { /* Optional bundle cache. */ }
      }));
    } catch { /* The navigation handler will retry the shell when online. */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('marksheet-studio-v2-') && key !== CACHE_VERSION).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE_VERSION)).put('/index.html', response.clone());
        return response;
      } catch {
        return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    try {
      const response = await fetch(request);
      if (response.ok && (url.pathname.startsWith('/assets/') || APP_SHELL.includes(url.pathname))) {
        (await caches.open(CACHE_VERSION)).put(request, response.clone());
      }
      return response;
    } catch {
      return cached || Response.error();
    }
  })());
});
