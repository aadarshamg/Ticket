/*
 * Service worker for the public pass pages (/b/{code} and /p/{code}).
 *
 * Goal: once a visitor has opened their pass, it keeps opening with no or poor signal at
 * the venue. It handles only pass pages, the site's build files and pass-page images;
 * admin pages, the scanner and all API calls go straight to the network.
 *
 * Rule: saving a copy is best-effort. Storage can be full, disabled or blocked (private
 * browsing), so a failure to read or write the cache must never stop a page from loading.
 */

const CACHE = 'passes-v1'; // must match CACHE in components/pass/PassPageShell.tsx
const NETWORK_TIMEOUT_MS = 4000;

const sameOrigin = (url) => url.origin === self.location.origin;
const isPassPage = (url) => sameOrigin(url) && /^\/(b|p)\/[^/]+\/?$/.test(url.pathname);
const isBuildAsset = (url) => sameOrigin(url) && url.pathname.startsWith('/_next/static/');

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.all(
          names.filter((name) => name.startsWith('passes-') && name !== CACHE).map((name) => caches.delete(name)),
        );
      } catch {
        // no usable storage; carry on without it
      }
      await self.clients.claim();
    })(),
  );
});

/** The saved copy of a request, or undefined. Never throws. */
async function readSaved(request, options) {
  try {
    const cache = await caches.open(CACHE);
    return await cache.match(request, options);
  } catch {
    return undefined;
  }
}

/** Saves a copy in the background. Never throws, never delays the response. */
function save(event, request, response) {
  const copy = response.clone();
  keepAlive(
    event,
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.put(request, copy);
      } catch {
        // storage full or unavailable: the page still works while online
      }
    })(),
  );
}

function forget(event, request) {
  keepAlive(
    event,
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.delete(request, { ignoreSearch: true });
      } catch {
        // nothing to forget
      }
    })(),
  );
}

/** Asks the browser to keep the worker running until `work` finishes, if it still can. */
function keepAlive(event, work) {
  try {
    event.waitUntil(work);
  } catch {
    // The response was already delivered (slow network case); the work continues regardless.
  }
}

/** Pass pages: the network if it answers quickly (so entry status is fresh), else the saved copy. */
async function passPage(event) {
  const { request } = event;
  const saved = await readSaved(request, { ignoreSearch: true });

  const fromNetwork = fetch(request).then((response) => {
    if (response.ok) save(event, request, response);
    // The pass no longer exists (for example the booking was reduced): drop the saved copy.
    if (response.status === 404) forget(event, request);
    return response;
  });
  if (!saved) return fromNetwork;

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
  try {
    const response = await Promise.race([fromNetwork, timeout]);
    // Too slow, or the server is having trouble: show the saved pass.
    if (!response || response.status >= 500) {
      fromNetwork.catch(() => undefined); // still running; ignore a late failure
      return saved;
    }
    return response;
  } catch {
    return saved; // offline
  }
}

/** Build files have content-hashed names, so a saved copy never goes stale. */
async function buildAsset(event) {
  const saved = await readSaved(event.request);
  if (saved) return saved;
  const response = await fetch(event.request);
  if (response.ok) save(event, event.request, response);
  return response;
}

/** Images on a pass page (the organiser's logo): saved copy first, refreshed in the background. */
async function passPageImage(event) {
  const { request } = event;
  const client = event.clientId ? await self.clients.get(event.clientId).catch(() => null) : null;
  if (!client || !isPassPage(new URL(client.url))) return fetch(request);

  const saved = await readSaved(request);
  const refresh = fetch(request).then((response) => {
    // Cross-origin images arrive as "opaque" responses (status 0); those can be stored too.
    if (response.ok || response.type === 'opaque') save(event, request, response);
    return response;
  });
  if (saved) {
    event.waitUntil(refresh.catch(() => undefined));
    return saved;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && isPassPage(url)) {
    event.respondWith(passPage(event));
  } else if (isBuildAsset(url)) {
    event.respondWith(buildAsset(event));
  } else if (request.destination === 'image' && !url.pathname.startsWith('/api/')) {
    event.respondWith(passPageImage(event));
  }
});
