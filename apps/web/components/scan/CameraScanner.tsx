'use client';

import { useEffect, useRef, useState } from 'react';

const READER_ID = 'qr-reader';
/** A code already handled is ignored until it has been out of view for this long. */
const SAME_CODE_GAP_MS = 4000;

interface Props {
  /** Called once per newly seen QR code. */
  onScan: (text: string) => void;
  /** Called once the camera and the scanning code are running. */
  onReady?: () => void;
}

/**
 * Live camera view that reads QR codes (html5-qrcode). The camera keeps running while a
 * result is on screen; the same pass held in front of it is reported only once, so a green
 * "Admitted" is not followed by a red "Already used" for the same person.
 */
export function CameraScanner({ onScan, onReady }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  /** Bumped by the Try again button to start the camera afresh. */
  const [attempt, setAttempt] = useState(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setStarting(true);
    let stop: (() => Promise<void>) | null = null;
    const last = { text: '', seenAt: 0 };

    (async () => {
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (cancelled) return;
        const scanner = new Html5Qrcode(READER_ID, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          useBarCodeDetectorIfSupported: true,
          verbose: false,
        });
        await scanner.start(
          { facingMode: 'environment' }, // the rear camera on phones
          {
            fps: 12,
            qrbox: (width, height) => {
              const side = Math.floor(Math.min(width, height) * 0.78);
              return { width: side, height: side };
            },
          },
          (text) => {
            const now = Date.now();
            const sameAsLast = text === last.text && now - last.seenAt < SAME_CODE_GAP_MS;
            last.text = text;
            last.seenAt = now;
            if (!sameAsLast) onScanRef.current(text);
          },
          () => undefined, // "no QR in this frame" fires constantly; not an error
        );
        stop = async () => {
          await scanner.stop().catch(() => undefined);
          scanner.clear();
        };
        if (cancelled) await stop();
        else {
          setStarting(false);
          onReadyRef.current?.();
        }
      } catch (err) {
        if (cancelled) return;
        const text = err instanceof Error ? err.message : String(err);
        setStarting(false);
        setError(
          /permission|notallowed|denied/i.test(text)
            ? 'Camera access was blocked. Allow the camera for this site in your browser settings, then reload.'
            : /notfound|no camera|requested device/i.test(text)
              ? 'No camera was found on this device.'
              : 'The camera could not be started. Close other apps that use the camera and try again, or use “Find booking” to admit people by hand.',
        );
      }
    })();

    return () => {
      cancelled = true;
      void stop?.();
    };
  }, [attempt]);

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div id={READER_ID} className="overflow-hidden rounded-2xl bg-black [&_video]:block [&_video]:w-full" />
      {starting && !error && <p className="py-10 text-center text-sm text-zinc-300">Starting the camera…</p>}
      {error && (
        <div className="rounded-2xl bg-zinc-800 p-4 text-center" role="alert">
          <p className="text-sm text-amber-200">{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="mt-3 rounded-lg bg-zinc-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Try the camera again
          </button>
        </div>
      )}
    </div>
  );
}
