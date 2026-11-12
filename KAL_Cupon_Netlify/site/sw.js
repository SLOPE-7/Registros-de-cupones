// Service worker de KAL: permite abrir la app sin conexión.
// - La página se pide primero a la red (para recibir siempre la última versión) y, si no hay
//   conexión, se usa la copia guardada.
// - Iconos y manifiesto se sirven desde la caché.
// - Las funciones de Netlify (API-Football) nunca se guardan: siempre van a la red.
const CACHE = 'kal-v22';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png',
  '/css/01-base.css',
  '/css/02-tema-claro.css',
  '/css/03-ficha-partido.css',
  '/css/04-mercados-compactos.css',
  '/css/05-compacto.css',
  '/css/06-tema-oscuro-componentes.css',
  '/css/07-cupones-app.css',
  '/css/08-estadisticas.css',
  '/css/09-avisos-presupuesto.css',
  '/css/10-buscador-guardado.css',
  '/css/11-progreso.css',
  '/css/12-cabecera-partido.css',
  '/css/13-imagenes.css',
  '/css/14-pulido.css',
  '/css/15-animaciones.css',
  '/css/16-analista.css',
  '/css/17-control.css',
  '/js/01-nucleo.js',
  '/js/02-lector-cupones.js',
  '/js/03-reglas-cupones.js',
  '/js/04-escudos.js',
  '/js/05-nuevo-cupon-resultados.js',
  '/js/06-agenda-mercados.js',
  '/js/07-logos-jugadores.js',
  '/js/08-cupones-casas-estadisticas.js',
  '/js/09-nube.js',
  '/js/10-ficha-partido.js',
  '/js/11-navegacion-eventos.js',
  '/js/12-tema.js',
  '/js/13-app-instalable.js',
  '/js/14-avisos-presupuesto.js',
  '/js/15-guardado-rapido.js',
  '/js/16-buscador.js',
  '/js/17-progreso.js',
  '/js/18-cabecera-partido.js',
  '/js/19-imagenes.js',
  '/js/20-animaciones.js',
  '/js/21-espacio.js',
  '/js/22-analista.js',
  '/js/23-control-apuestas.js',
  '/js/24-valor.js',
  '/js/25-datos-partido.js',
  '/js/99-arranque.js'];

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
  if (url.origin !== self.location.origin || url.pathname.startsWith('/.netlify/') || url.pathname.startsWith('/api/')) return;
  // Página, estilos y lógica: primero la red (así llegan las actualizaciones) y, sin conexión, la copia guardada.
  // Imágenes (íconos): primero la copia guardada.
  const isImage = /\.(png|jpe?g|svg|webp|ico)$/i.test(url.pathname);
  if (!isImage) {
    const cacheKey = req.mode === 'navigate' || url.pathname === '/' ? '/index.html' : url.pathname;
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(cache => cache.put(cacheKey, copy)); }
        return res;
      }).catch(() => caches.match(cacheKey).then(r => r || caches.match('/')))
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
