/**
 * The game, offline.
 *
 * A service worker is what makes this installable rather than merely
 * bookmarkable, and it is also what lets a manager open the game on a train.
 * So it has two jobs and they pull in opposite directions: the app shell should
 * be available without a network, and a deploy should be picked up the moment it
 * happens. The rules below are how those two are reconciled.
 *
 * The one thing this file must never do is serve a stale *bundle*. Vite names
 * every asset with a hash of its contents, so `/assets/anything-abc123.js` can
 * be cached for ever and is still correct — if the contents change, the name
 * changes with them. The entry document is the opposite: `/index.html` is the
 * same name on every deploy and points at the current bundle, so it is always
 * fetched from the network first and only falls back to the cache when there is
 * no network at all.
 *
 * There is no build step in here and no list of files to keep in step. A cache
 * name carries the release, and an old release's cache is deleted on activate,
 * so a new deploy quietly takes over with a cache of its own.
 */

const CACHE = 'sunday-eleven-v1';

/** The shell: enough to start the game with no network at all. */
const SHELL = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is all-or-nothing: one 404 would leave the game with no shell at
      // all, so each piece is added on its own and a miss is not fatal.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // A hashed asset: the name is the version, so it can be served from the cache
  // without ever being stale.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else, and navigations in particular: the network first, so a
  // deploy reaches the player immediately, and the cache only as a floor.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html').then((hit) => hit ?? caches.match('/'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
