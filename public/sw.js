// Service worker: precaches the complete app shell at install time so the
// installed PWA renders even fully offline on first launch (iOS home-screen
// apps open in a fresh WebKit instance with no HTTP cache to fall back on -
// without this, the JS/CSS assets 404 and you get a black screen).
//
// The asset list below is injected at build time (vite.config.ts) with the
// real hashed URLs. Navigations are network-first to stay current. Relay
// traffic never touches this worker (it goes straight to the relay origin,
// not through here).

const CACHE = 'cardvault-v5';
const PRECACHE =
  typeof __PRECACHE_ASSETS__ !== 'undefined' ? __PRECACHE_ASSETS__ : [];

const NOTIFICATION_TAG = 'cardvault-request';

function cacheEach(cache, urls) {
  return Promise.all(
    urls.map((url) => cache.add(url).catch(() => {}))
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cacheEach(cache, [...PRECACHE, '/', '/index.html', '/manifest.webmanifest']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match('/index.html')) ??
            (await cache.match('/')) ??
            Response.error()
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((res) => {
          if (res.ok && url.pathname.startsWith('/assets/')) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return res;
        })
    )
  );
});

// Web Push: the relay pings this worker when a blob lands for a device whose
// app is closed/locked. Copy is generic metadata only - payloads stay E2E
// encrypted and are never sent through push.
self.addEventListener('push', (event) => {
  let title = 'CardVault';
  let body = 'New activity - open the app to review.';
  try {
    const data = event.data ? JSON.parse(event.data.text()) : null;
    if (data && typeof data.title === 'string') title = data.title;
    if (data && typeof data.body === 'string') body = data.body;
  } catch {}
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: NOTIFICATION_TAG,
      data: { url: '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) {
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow('/');
    })()
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const oldKey =
        event.oldSubscription && event.oldSubscription.options
          ? event.oldSubscription.options.applicationServerKey
          : null;
      if (oldKey) {
        await self.registration.pushManager
          .subscribe({ userVisibleOnly: true, applicationServerKey: oldKey })
          .catch(() => null);
      }
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'push-subscription-changed' });
      }
    })()
  );
});
