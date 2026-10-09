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
 * There is no build step in here. The list of files is written in at build time
 * (see the precacheManifest plugin in vite.config.ts) so that it describes the
 * build that is actually deployed rather than the one somebody remembered. A
 * cache name carries the release, and an old release's cache is deleted on
 * activate, so a new deploy quietly takes over with a cache of its own.
 */

const CACHE = 'sunday-eleven-v1';

/**
 * Every file in the build, injected by the build.
 *
 * Written as a placeholder here and replaced in dist/sw.js. An empty list is a
 * worker that caches nothing, which is a game that does not work offline, so
 * the build fails if this line ever goes missing rather than shipping that.
 */
const SHELL = self.__PRECACHE__;

/**
 * How a cached file is looked up, and the option in it is load-bearing.
 *
 * `ignoreVary` was not written here on a hunch; it was found by *being offline*.
 * Chromium's cache honours a stored response's `Vary` header when matching it
 * against a request, so a host that answers with `Vary: Origin` — the preview
 * server does, and an edge may — makes every request that carries an `Origin`
 * header miss the cache. Module scripts and `modulepreload` links carry one,
 * and they are how this game's own bundles are fetched, so the failure was a
 * document served happily from the cache with its JavaScript failing behind it:
 * the booting placeholder, for ever, with no network to explain it.
 *
 * Ignoring `Vary` cannot serve one visitor's response to another here, and that
 * is a property of this worker rather than a hope: it answers same-origin GETs
 * only, from a list of content-hashed files this build wrote down, so the entry
 * under a URL is the same bytes for everybody.
 */
const CACHE_MATCH = { ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is all-or-nothing: one 404 would leave the game with no shell at
      // all, so each piece is added on its own and a miss is not fatal.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined)))),
  );
});

/**
 * Updates wait. Deliberately.
 *
 * This worker used to call skipWaiting() here, which is the polite default for
 * an update nobody is watching: the new worker takes over the moment it is
 * ready. It is wrong for this game. A worker swapping itself underneath a live
 * match changes the code out from under a half-played game, and the manager has
 * no idea it happened — the screen reloads on the next match instead, which
 * reads as the game losing his career rather than as a deploy.
 *
 * So a new worker installs, waits, and says nothing. The page watches for it and
 * asks the manager, and only then does this worker take over. First installs
 * need no such ceremony: with no worker already in charge there is nothing to
 * wait for, and the activate handler below claims the open page either way.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
      caches.match(request, CACHE_MATCH).then(
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
        .catch(() =>
          caches.match('/index.html', CACHE_MATCH).then((hit) => hit ?? caches.match('/', CACHE_MATCH)),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request, CACHE_MATCH).then(
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
