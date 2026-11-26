const VERSION = 'odometer-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'fonts/google-sans.woff2',
  'fonts/literata.woff2',
  'icons/dial.svg',
  'icons/carry.svg',
  'icons/loops.svg',
  'icons/die.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'js/app.js',
  'js/crypto.js',
  'js/github.js',
  'js/idle.js',
  'js/model.js',
  'js/passkey.js',
  'js/store.js',
  'js/vault.js',
  'js/ui/dom.js',
  'js/ui/gate.js',
  'js/ui/icons.js',
  'js/ui/item.js',
  'js/ui/marks.js',
  'js/ui/parts.js',
  'js/ui/past.js',
  'js/ui/settings.js',
  'js/ui/shell.js',
  'js/ui/timeline.js',
  'js/ui/weekly.js',
  'js/ui/write.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))),
  );
});
