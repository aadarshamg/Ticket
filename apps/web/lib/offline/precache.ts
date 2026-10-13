// Keeps pages opening without a connection, together with public/sw.js.

/** Must match CACHE in public/sw.js. */
const PAGE_CACHE = 'passes-v1';

/**
 * Registers the service worker. Resolves true if this is the first visit, meaning the page
 * loaded before the worker existed and has not been saved by it.
 * Only real builds are cached: the dev server's files change constantly.
 */
export async function registerServiceWorker(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return false;
  const firstVisit = !navigator.serviceWorker.controller;
  await navigator.serviceWorker.register('/sw.js');
  return firstVisit;
}

/**
 * Saves the build files this page has loaded so far and, if asked, the page itself.
 * Best-effort: storage can be full or blocked, and that must never break the page.
 */
export async function saveCurrentPage({ includePage }: { includePage: boolean }): Promise<void> {
  if (process.env.NODE_ENV !== 'production' || !('caches' in window)) return;
  try {
    const cache = await caches.open(PAGE_CACHE);
    const assets = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => url.startsWith(`${location.origin}/_next/static/`));
    const missing = (await Promise.all(assets.map(async (url) => ((await cache.match(url)) ? null : url)))).filter(
      (url): url is string => url !== null,
    );
    await Promise.allSettled([
      ...(includePage ? [cache.add(new Request(location.pathname, { cache: 'reload' }))] : []),
      ...missing.map((url) => cache.add(url)),
    ]);
  } catch {
    // offline support is a bonus
  }
}
