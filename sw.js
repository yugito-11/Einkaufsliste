// Service Worker: macht die App offline-fähig.
// Bei Änderungen an den Dateien die Versionsnummer erhöhen.
const CACHE = 'einkaufsliste-v2';
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'sync.js',
  'firebase-config.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Netzwerk zuerst (damit Updates ankommen), sonst aus dem Cache
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Nur eigene Dateien und die Firebase-Bibliothek cachen, nicht die Datenbank-Verbindung
  const url = new URL(event.request.url);
  if (url.origin !== location.origin && url.hostname !== 'www.gstatic.com') return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || caches.match('index.html')))
  );
});
