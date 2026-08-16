// Service worker: precaches the complete app shell at install time so the
// installed PWA renders even fully offline on first launch (iOS home-screen
// apps open in a fresh WebKit instance with no HTTP cache to fall back on -
// without this, the JS/CSS assets 404 and you get a black screen).
//
// The asset list below is injected at build time (vite.config.ts) with the
// real hashed URLs. Navigations are network-first to stay current. Same-origin
// /v1/* relay calls are excluded from fetch handling so they are never cached.

const CACHE = 'cardvault-v10';
const PRECACHE =
  typeof __PRECACHE_ASSETS__ !== 'undefined' ? __PRECACHE_ASSETS__ : [];

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
  // Production serves the PWA and relay on one origin. Caching GET /v1/blobs
  // (or pairing-code lookups) freezes the inbox on the first 200 and friend /
  // card requests never arrive. Let those hit the network directly.
  if (url.pathname.startsWith('/v1/') || url.pathname === '/health') return;

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

  // Hashed assets: network-first so a new deploy is not stuck behind an old
  // cache entry. Fall back to cache when offline.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => (await caches.match(request)) ?? Response.error())
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((res) => {
          if (res.ok) {
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
  let kind = 'activity';
  try {
    const data = event.data ? JSON.parse(event.data.text()) : null;
    if (data && typeof data.title === 'string') title = data.title;
    if (data && typeof data.body === 'string') body = data.body;
    if (data && typeof data.kind === 'string') kind = data.kind;
  } catch {}
  // iOS revokes Web Push if a push event does not show a notification.
  // Unique tags so a second request does not replace the first banner.
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: `cardvault-${kind}-${Date.now()}`,
      renotify: true,
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
