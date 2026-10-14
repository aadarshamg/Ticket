'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { registerServiceWorker, saveCurrentPage } from '@/lib/offline/precache';

const RELOAD_AFTER_MS = 20_000;

interface Props {
  endsAt: string;
  /** Whether the server already considers the event over. */
  initialOver: boolean;
  children: ReactNode;
}

/**
 * Wraps a public pass page and adds the things that need the browser:
 *  - hides QR codes once the event's end time passes, even on a copy opened offline
 *    (children react to `data-over` via Tailwind's group-data-[over=true]/page: variants);
 *  - registers the service worker and stores this page for offline use on the first visit;
 *  - refreshes entry status when the visitor comes back to the tab.
 */
export function PassPageShell({ endsAt, initialOver, children }: Props) {
  const [over, setOver] = useState(initialOver);

  useEffect(() => {
    const end = new Date(endsAt).getTime();
    const check = () => setOver(Date.now() > end);
    check();
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, [endsAt]);

  useEffect(() => {
    // From the second visit on, the service worker saves pages as it serves them. On the very
    // first visit this page loaded before the worker existed, so save it (and its files) now.
    registerServiceWorker()
      .then((firstVisit) => (firstVisit ? saveCurrentPage({ includePage: true }) : undefined))
      .catch(() => undefined); // offline support is a bonus; never break the page over it
  }, []);

  useEffect(() => {
    const loadedAt = Date.now();
    const onVisible = () => {
      const stale = Date.now() - loadedAt > RELOAD_AFTER_MS;
      // Only when the service worker is in control: it falls back to the saved copy if the
      // venue's network is too slow, so a reload can never leave the visitor without a pass.
      if (document.visibilityState === 'visible' && stale && navigator.onLine && navigator.serviceWorker?.controller) {
        window.location.reload();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  return (
    <div className="group/page min-h-screen bg-zinc-100" data-over={over ? 'true' : 'false'}>
      {children}
    </div>
  );
}
