// Nexthlon service worker (E5): makes the store installable and kind when the signal drops.
//
// What it keeps, and what it never does:
//   - Pages are always fetched fresh (prices, stock and your cart must be live). With no connection,
//     the offline page is shown instead of the browser's error.
//   - The site's own CSS, JS and fonts with a ?v= version are kept (their URL changes when they do),
//     so repeat visits and the installed app open fast.
//   - Photos are kept too (the newest 120), refreshed in the background.
//   - Never: anything under /api/, anything from another site (payments, analytics), and anything
//     that is not a GET. Signed-in pages are never stored, so a shared phone shows nobody else's data.
const VERSION = 'nx-2026-11-19b';
const STATIC = `${VERSION}-static`;
const PHOTOS = `${VERSION}-photos`;
const OFFLINE = `${VERSION}-offline`;
const OFFLINE_URL = '/offline';
const MAX_PHOTOS = 120;
const MAX_STATIC = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(OFFLINE);
        // Fetched signed out, so the stored copy holds nobody's name or cart.
        const offline = await fetch(
          new Request(OFFLINE_URL, {credentials: 'omit', cache: 'reload'}),
        );
        if (offline.ok) await cache.put(OFFLINE_URL, offline);
      } catch {
        // No offline page yet: the worker still installs and the next visit tries again.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !name.startsWith(VERSION))
          .map((name) => caches.delete(name)),
      );
      if (self.registration.navigationPreload)
        await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })(),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i += 1) await cache.delete(keys[i]);
}

async function cacheFirst(event, cacheName, max) {
  const cached = await caches.match(event.request);
  if (cached && cached.ok) return cached;
  const response = await fetch(event.request);
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    event.waitUntil(
      caches
        .open(cacheName)
        .then((cache) => cache.put(event.request, copy))
        .then(() => trim(cacheName, max)),
    );
  }
  return response;
}

async function staleWhileRevalidate(event, cacheName, max) {
  const cached = await caches.match(event.request);
  const fresh = fetch(event.request).then((response) => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(
        caches
          .open(cacheName)
          .then((cache) => cache.put(event.request, copy))
          .then(() => trim(cacheName, max)),
      );
    }
    return response;
  });
  if (cached) {
    event.waitUntil(fresh.catch(() => null));
    return cached;
  }
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          if (preloaded) return preloaded;
          return await fetch(request);
        } catch {
          const offline = await caches.match(OFFLINE_URL);
          return offline || Response.error();
        }
      })(),
    );
    return;
  }

  // Versioned files never change at the same address: the stored copy is always right.
  if (url.searchParams.has('v')) {
    event.respondWith(
      cacheFirst(event, STATIC, MAX_STATIC).catch(() => fetch(event.request)),
    );
    return;
  }
  if (/^\/(img|fonts|uploads)\//.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, PHOTOS, MAX_PHOTOS));
  }
});

// ---------- Push notifications (E5) ----------
// The server sends { title, body, url, tag }. Only addresses on this site are opened.
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {title: 'Nexthlon', body: event.data ? event.data.text() : ''};
  }
  const url =
    typeof data.url === 'string' &&
    data.url.startsWith('/') &&
    !data.url.startsWith('//')
      ? data.url
      : '/';
  event.waitUntil(
    self.registration.showNotification(data.title || 'Nexthlon', {
      body: data.body || '',
      icon: '/img/app/icon-192.png',
      badge: '/img/app/icon-192.png',
      tag: data.tag || undefined,
      data: {url},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      const same = open.find((client) => client.url === target);
      if (same) return same.focus();
      return self.clients.openWindow(target);
    })(),
  );
});
