'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CameraScanner } from '@/components/scan/CameraScanner';
import { LookupPanel } from '@/components/scan/LookupPanel';
import { api, ApiError, setCsrfToken } from '@/lib/api';
import { primeAudio, signal, type Signal } from '@/lib/feedback';
import { formatIstTime } from '@/lib/ist';
import type { AdmitAllOutcome, GateSessionInfo, ScanBooking, ScanOutcome } from '@/lib/types';

const DEVICE_KEY = 'tk_device_id';
const RESULT_MS = 3000;

type Tone = 'green' | 'red' | 'amber' | 'grey';

interface ResultView {
  tone: Tone;
  title: string;
  lines: string[];
  /** Set on a green result when more people on the booking are still to come. */
  admitAll?: ScanBooking;
}

const TONE_CLASS: Record<Tone, string> = {
  green: 'bg-emerald-600 text-white',
  red: 'bg-red-600 text-white',
  amber: 'bg-amber-400 text-slate-900',
  grey: 'bg-slate-600 text-white',
};
const TONE_SIGNAL: Record<Tone, Signal> = { green: 'ok', red: 'error', amber: 'warn', grey: 'warn' };

function passLine(outcome: ScanOutcome): string | null {
  if (!outcome.pass || !outcome.booking) return null;
  return `Pass ${outcome.pass.passNo} of ${outcome.booking.passCount}`;
}

/** Turns the server's answer into what fills the screen. */
function toView(outcome: ScanOutcome): ResultView {
  const { booking, pass } = outcome;
  const who = [booking?.name, booking?.category].filter(Boolean) as string[];

  switch (outcome.result) {
    case 'ok': {
      const remaining = booking?.remaining ?? 0;
      const position = passLine(outcome);
      return {
        tone: 'green',
        title: 'Admitted',
        lines: [...who, [position, remaining > 0 ? `${remaining} still to come` : 'all entered'].filter(Boolean).join(' · ')],
        admitAll: booking && remaining > 0 ? booking : undefined,
      };
    }
    case 'already_used':
      return {
        tone: 'red',
        title: 'Already used',
        lines: [
          ...who,
          pass?.usedAt
            ? `First entry at ${formatIstTime(pass.usedAt)}${pass.usedGate ? ` · ${pass.usedGate}` : ''}`
            : 'Everyone on this booking has already entered',
          passLine(outcome) ?? '',
        ].filter(Boolean),
      };
    case 'cancelled':
      return { tone: 'amber', title: 'Cancelled', lines: [...who, 'This booking was cancelled. Do not admit.'] };
    case 'invalid':
      return { tone: 'red', title: 'Invalid pass', lines: ['This is not a valid pass for this event.'] };
  }
}

export default function ScanPage() {
  const [session, setSession] = useState<GateSessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [result, setResult] = useState<ResultView | null>(null);
  const [checking, setChecking] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false);
  const busyRef = useRef(false); // true while a scan is being checked or its result is showing
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Already signed in on this phone?
  useEffect(() => {
    api<GateSessionInfo>('/api/auth/gate/me')
      .then((info) => {
        setCsrfToken(info.csrfToken);
        setSession(info);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  // Keep the screen awake while scanning.
  useEffect(() => {
    if (!session || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          lock = sentinel;
        })
        .catch(() => undefined);
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
    };
  }, [session]);

  const endSession = useCallback(() => {
    setCsrfToken(null);
    setSession(null);
    setResult(null);
    setLookupOpen(false);
    busyRef.current = false;
    setPinError('You have been signed out. Enter the gate PIN again.');
  }, []);

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setResult(null);
    busyRef.current = false;
  }, []);

  /** Shows a full-screen result, with sound and vibration, then returns to the camera. */
  const show = useCallback(
    (view: ResultView) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setResult(view);
      signal(TONE_SIGNAL[view.tone]);
      timerRef.current = setTimeout(dismiss, RESULT_MS);
    },
    [dismiss],
  );

  const onScan = useCallback(
    async (qr: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setChecking(true);
      try {
        show(toView(await api<ScanOutcome>('/api/scan', { method: 'POST', body: { qr } })));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return endSession();
        show({
          tone: 'grey',
          title: err instanceof ApiError && err.status === 0 ? 'No connection' : 'Not checked',
          lines: [
            err instanceof ApiError && err.status !== 0 ? err.message : 'The pass could not be checked. Scan it again.',
          ],
        });
      } finally {
        setChecking(false);
      }
    },
    [show, endSession],
  );

  async function admitAll(booking: ScanBooking) {
    if (timerRef.current) clearTimeout(timerRef.current); // stay on this screen while it works
    setAdmitting(true);
    try {
      const outcome = await api<AdmitAllOutcome>('/api/scan/admit-all', { method: 'POST', body: { ticketId: booking.ticketId } });
      show(
        outcome.admitted > 0
          ? {
              tone: 'green',
              title: `Admitted ${outcome.admitted} more`,
              lines: [booking.name, `All ${outcome.booking.passCount} have entered`],
            }
          : { tone: 'red', title: 'Nobody left to admit', lines: [booking.name, 'Everyone on this booking has already entered'] },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return endSession();
      show({ tone: 'grey', title: 'Not done', lines: ['Could not admit the rest. Try again, or scan each pass.'] });
    } finally {
      setAdmitting(false);
    }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    primeAudio(); // this tap is what allows the beeps to play later
    setSigningIn(true);
    setPinError(null);
    try {
      let deviceId: string | undefined;
      try {
        deviceId = localStorage.getItem(DEVICE_KEY) ?? undefined;
      } catch {
        // storage blocked: the server will issue a device ID for this session
      }
      const info = await api<GateSessionInfo>('/api/auth/gate', { method: 'POST', body: { pin, deviceId } });
      try {
        localStorage.setItem(DEVICE_KEY, info.deviceId);
      } catch {
        // fine without it
      }
      setCsrfToken(info.csrfToken);
      setSession(info);
      setPin('');
    } catch (err) {
      setPinError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Something went wrong');
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    try {
      await api('/api/auth/gate/logout', { method: 'POST' });
    } catch {
      // sign out locally regardless
    }
    setCsrfToken(null);
    setSession(null);
    setPinError(null);
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-300">Loading…</main>;
  }

  // --- PIN screen ----------------------------------------------------------
  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
        <form onSubmit={signIn} className="w-full max-w-xs space-y-4 rounded-2xl bg-white p-6" noValidate>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Gate scanner</h1>
            <p className="mt-1 text-sm text-slate-600">Enter the PIN for your gate.</p>
          </div>
          {pinError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {pinError}
            </p>
          )}
          <label htmlFor="pin" className="sr-only">
            Gate PIN
          </label>
          <input
            id="pin"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d*"
            maxLength={8}
            className="input text-center text-2xl tracking-[0.4em]"
            placeholder="••••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          <button type="submit" className="btn-primary w-full py-3 text-base" disabled={signingIn || pin.length < 4}>
            {signingIn ? 'Checking…' : 'Start scanning'}
          </button>
        </form>
      </main>
    );
  }

  // --- Scanner -------------------------------------------------------------
  return (
    <main className="min-h-screen bg-slate-900 text-white">
      <header className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{session.gate}</p>
          <p className="text-xs text-slate-400">{checking ? 'Checking…' : 'Point the camera at a pass'}</p>
        </div>
        <button type="button" onClick={signOut} className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-semibold">
          Sign out
        </button>
      </header>

      <div className="px-4">
        <CameraScanner onScan={onScan} />
      </div>

      <div className="mx-auto max-w-md space-y-2 p-4">
        <button
          type="button"
          onClick={() => {
            busyRef.current = true; // no scanning while looking a booking up
            setLookupOpen(true);
          }}
          className="w-full rounded-xl bg-slate-700 px-4 py-3 text-base font-semibold"
        >
          Find booking (no QR)
        </button>
        <p className="text-center text-xs text-slate-400">
          Green: let them in. Red or amber: do not admit. Each pass admits one person, once.
        </p>
      </div>

      {lookupOpen && (
        <LookupPanel
          onClose={() => {
            setLookupOpen(false);
            busyRef.current = false;
          }}
          onSessionEnded={endSession}
        />
      )}

      {result && (
        <div
          className={`fixed inset-0 z-30 flex flex-col items-center justify-center gap-3 p-6 text-center ${TONE_CLASS[result.tone]}`}
          role="alert"
          aria-live="assertive"
        >
          <h2 className="text-5xl font-extrabold leading-tight">{result.title}</h2>
          {result.lines.map((line, index) => (
            <p key={line} className={index === 0 ? 'text-2xl font-semibold' : 'text-lg'}>
              {line}
            </p>
          ))}
          <div className="mt-6 flex w-full max-w-xs flex-col gap-3">
            {result.admitAll && (
              <button
                type="button"
                disabled={admitting}
                onClick={() => admitAll(result.admitAll as ScanBooking)}
                className="rounded-xl bg-white px-4 py-4 text-lg font-bold text-emerald-700 disabled:opacity-70"
              >
                {admitting ? 'Admitting…' : `Admit all remaining (${result.admitAll.remaining})`}
              </button>
            )}
            <button type="button" onClick={dismiss} className="rounded-xl border-2 border-current px-4 py-3 text-base font-semibold">
              Next scan
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
