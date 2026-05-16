// public/sw.js — ReliableTrack Service Worker
//
// __SW_VERSION__ below is replaced at build time by the stampServiceWorkerVersion
// plugin in vite.config.js. files in public/ skip Vite's define{} substitution,
// so the plugin rewrites dist/sw.js post-build. Each deploy gets a unique cache
// name → activate handler clears prior caches → no stale-chunk accumulation.
//
// In `vite dev` (no build), the literal token below remains as-is; dev mode
// caches under `reliabletrack-__SW_VERSION__` and the developer manually
// unregisters the SW between runs.
const CACHE_NAME = 'reliabletrack-' + __SW_VERSION__;

// App shell files to cache on install
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
];

// ── INSTALL: cache app shell ───────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()) // activate immediately, don't wait for old SW to die
  );
});

// ── ACTIVATE: clean up old caches, claim all clients immediately ───────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// ── FETCH: network-first for API/auth, cache-first for assets ──────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never intercept non-GET requests. We used to synthesize a 503 on network
  // failure, but the server may have actually received & committed a POST
  // before the connection dropped — the synthetic 503 would trigger
  // saveSubmission's retry loop and create duplicate rows on flaky cell.
  // Let the browser fail naturally so the caller's AbortController / fetch
  // error path sees the real error.
  if (event.request.method !== 'GET') return;

  // Always network-first for API calls, Supabase, Resend — never cache these
  if (
    url.pathname.startsWith('/api/') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('resend.com')
  ) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // For navigation requests (HTML), network-first with fallback to cached index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Cache fresh copy
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For JS/CSS/fonts: cache-first, update in background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      });
      return cached || networkFetch;
    })
  );
});

// ── SYNC: process offline submission queue when back online ────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-submissions') {
    event.waitUntil(syncOfflineQueue());
  }
});

async function syncOfflineQueue() {
  // Signal all clients to attempt sync
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'SYNC_QUEUE' }));
}

// ── MESSAGE: handle messages from the app ─────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
