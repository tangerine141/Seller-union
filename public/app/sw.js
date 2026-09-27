// Service worker: cache vỏ ứng dụng để mở nhanh; API dùng network-first, lỗi mạng thì trả bản cache gần nhất.
const VERSION = 'su-v1';
const SHELL = ['/app/', '/app/app.css', '/app/app.js', '/app/print.html', '/app/print.js', '/app/barcode.js', '/assets/icon.svg', '/app/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('.csv')) return;

  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || Response.json({ error: 'Mất kết nối mạng' }, { status: 503 })))
    );
    return;
  }

  // Vỏ ứng dụng: stale-while-revalidate.
  e.respondWith(
    caches.match(req, { ignoreSearch: url.pathname === '/app/print.html' }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
