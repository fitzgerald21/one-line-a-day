// Offline support: network-first so updates show up right away, cache as fallback.
const CACHE = 'olad-v8';
const SHELL = ['./', 'index.html', 'import.html', 'css/styles.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/main.js', 'js/book.js', 'js/ui.js', 'js/store.js', 'js/dates.js', 'js/cover.js', 'js/assist.js', 'js/editor.js',
  'js/views.js', 'js/settings.js', 'js/modelpicker.js', 'js/ai.js', 'js/import.js',
  'js/book3d.js', 'js/pagetex.js', 'js/storage/boot.js', 'js/storage/local.js', 'js/storage/firebase.js', 'js/storage/config.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  // fonts and the Firebase SDK (versioned, so safe to cache) may be fetched cross-origin
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' ||
    (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) ||
    (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/three@'));
  if (!sameOrigin && !isFont) return; // never touch API calls
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req)) || (await cache.match('index.html')) || Response.error();
    }
  })());
});
