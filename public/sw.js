// Service worker: keeps the app opening when the network is slow, and receives "your wish is ready".
const CACHE = 'wishes-v1';
const SHELL = [
  '/', '/styles.css', '/app.js', '/api.js', '/ui.js', '/lever-view.js', '/lib/lever.js',
  '/brand/lockup-stacked-chalk.svg', '/brand/seal-chalk.svg', '/brand/wordmark-chalk.svg', '/brand/night-stars.jpg',
  '/brand/fonts/HankenGrotesk-Light.ttf', '/brand/fonts/HankenGrotesk-Regular.ttf', '/brand/fonts/HankenGrotesk-Medium.ttf',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/w/') || url.pathname.startsWith('/admin/')) return;
  // Stale while revalidate: show what we have, fetch the fresh copy for next time.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: false });
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || fresh;
    }),
  );
});

self.addEventListener('push', (e) => {
  let data = {};
  try {
    data = e.data?.json() ?? {};
  } catch {
    /* plain text or empty */
  }
  e.waitUntil(
    self.registration.showNotification(data.title || '3 wishes', {
      body: data.body || 'Your wish is ready.',
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-32.png',
      data: { url: data.url || '/' },
      tag: 'wish',
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate?.(target);
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
