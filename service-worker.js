/* OKATAKYIRE WALLET - service worker
 * Pre-caches every file the app needs so it opens and works with NO internet after the
 * first successful visit. Bump CACHE_VERSION whenever you change any file and redeploy:
 * phones then fetch the new files once and drop the old cache. Financial data lives in
 * IndexedDB, which this file never touches, so updating the app never affects records. */
var CACHE_VERSION = 'v1.0.0';
var CACHE = 'okatakyire-wallet-' + CACHE_VERSION;

var ASSETS = [
  './',
  'index.html',
  'style.css',
  'utils.js',
  'db.js',
  'app.js',
  'views.js',
  'vendor/chart.umd.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/logo-256.png',
  'icons/favicon-48.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // cache:'reload' bypasses the HTTP cache so we never pre-cache stale copies
      return Promise.all(ASSETS.map(function (url) {
        return fetch(new Request(url, { cache: 'reload' })).then(function (res) {
          if (!res.ok) throw new Error('Failed to cache ' + url);
          return cache.put(url, res);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('okatakyire-wallet-') === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Page loads (including ?add=savings shortcuts): always answer with the cached app shell
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('index.html', { cacheName: CACHE }).then(function (hit) {
        return hit || fetch(req).catch(function () { return caches.match('./'); });
      })
    );
    return;
  }

  // Everything else: cache first, then network (and remember it)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
