// Service worker de KAL: permite abrir la app sin conexión.
// - La página se pide primero a la red (para recibir siempre la última versión) y, si no hay
//   conexión, se usa la copia guardada.
// - Iconos y manifiesto se sirven desde la caché.
// - Las funciones de Netlify (API-Football) nunca se guardan: siempre van a la red.
const CACHE = 'kal-v7';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/')) return;
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put('/index.html', copy));
        return res;
      }).catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    );
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(cache => cache.put(req, copy)); }
    return res;
  })));
});

// Notificaciones de partidos enviadas por la función programada "avisos-envio".
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'KAL', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'KAL', {
    body: data.body || '',
    tag: data.tag || 'kal',
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/' }
  }));
});

// Al tocar la notificación se abre KAL (o se trae al frente si ya está abierta).
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const client of list) {
      if (new URL(client.url).origin === self.location.origin) { client.navigate(target).catch(() => {}); return client.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
