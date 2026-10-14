'use client';

import { useEffect, useState } from 'react';

/** Chrome's install event (not yet in TypeScript's DOM types). */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'tk_install_dismissed';

/**
 * Offers to put the scanner on the home screen. Android/Chrome gets a one-tap Install button;
 * iPhone (which has no such button) gets the Share > Add to Home Screen instructions.
 * Hidden once installed, or once the volunteer says "Not now".
 */
export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // storage blocked: just offer it
    }
    if (standalone || dismissed) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsIos(ios);
    if (ios) setHidden(false);

    const onPrompt = (event: Event) => {
      event.preventDefault(); // we show our own button instead of the browser's banner
      setInstallEvent(event as InstallPromptEvent);
      setHidden(false);
    };
    const onInstalled = () => setHidden(true);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (hidden || (!installEvent && !isIos)) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // fine
    }
  };

  return (
    <div className="rounded-xl bg-indigo-950 p-3 text-sm text-indigo-100" data-testid="install-prompt">
      {installEvent ? (
        <p>Put the scanner on this phone&apos;s home screen, so it opens full screen like an app.</p>
      ) : (
        <p>
          To put the scanner on this iPhone&apos;s home screen: tap <strong>Share</strong>, then{' '}
          <strong>Add to Home Screen</strong>.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        {installEvent && (
          <button
            type="button"
            className="rounded-lg bg-indigo-500 px-3 py-1.5 font-semibold text-white"
            onClick={async () => {
              await installEvent.prompt();
              const { outcome } = await installEvent.userChoice;
              if (outcome === 'accepted') setHidden(true);
              setInstallEvent(null);
            }}
          >
            Install app
          </button>
        )}
        <button type="button" className="rounded-lg px-3 py-1.5 font-semibold text-indigo-200" onClick={dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}
