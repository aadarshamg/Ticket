'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CameraScanner } from '@/components/scan/CameraScanner';
import { InstallPrompt } from '@/components/scan/InstallPrompt';
import { LookupPanel } from '@/components/scan/LookupPanel';
import { api, ApiError, setCsrfToken } from '@/lib/api';
import { primeAudio, signal, type Signal } from '@/lib/feedback';
import { formatIstTime } from '@/lib/ist';
import { registerServiceWorker, saveCurrentPage } from '@/lib/offline/precache';
import {
  checkLocally,
  downloadList,
  dropPending,
  loadSaved,
  noteAdmitted,
  offlineStatus,
  syncPending,
  type LocalVerdict,
} from '@/lib/offline/scanner';
import type { AdmitAllOutcome, GateSessionInfo, ScanBooking, ScanOutcome } from '@/lib/types';

const DEVICE_KEY = 'tk_device_id';
/** Lets the scanner reopen while offline: the server cannot be asked who is signed in. */
const SESSION_KEY = 'tk_gate_session';
const RESULT_MS = 3000;
/** If the server has not answered by now, see whether the saved list can confirm the pass. */
const LOCAL_FALLBACK_AFTER_MS = 2500;
/** How long the server gets in total before the phone stops waiting for it. */
const SERVER_ANSWER_TIMEOUT_MS = 20_000;
/** A rescan of a pass with no answer yet, within this time, counts as the same scan. */
const SAME_SCAN_RETRY_MS = 2 * 60 * 1000;
const LIST_MAX_AGE_MS = 2 * 60 * 1000;
const TICK_MS = 15_000;

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
  amber: 'bg-amber-400 text-zinc-900',
  grey: 'bg-zinc-600 text-white',
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

/** What fills the screen when the phone decided by itself, with no connection. */
function toLocalView(verdict: LocalVerdict): ResultView {
  switch (verdict.kind) {
    case 'admitted':
      return {
        tone: 'green',
        title: 'Admitted',
        lines: ['Checked offline', 'Saved on this phone. It uploads when the connection returns.'],
      };
    case 'already':
      return {
        tone: 'red',
        title: 'Already used',
        lines: [`Scanned on this phone at ${formatIstTime(verdict.at)}`, 'Checked offline'],
      };
    case 'not_listed':
      return {
        tone: 'red',
        title: 'Not valid',
        lines: ['Not on this phone’s list of valid passes.', 'It may be already used, cancelled or fake. Do not admit.'],
      };
    case 'no_list':
      return {
        tone: 'grey',
        title: 'Cannot check',
        lines: ['There is no connection, and this phone has no saved list of passes.', 'Get a connection and press “Update list”.'],
      };
  }
}

function readStoredSession(): GateSessionInfo | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as GateSessionInfo) : null;
  } catch {
    return null;
  }
}

function storeSession(info: GateSessionInfo | null): void {
  try {
    if (info) localStorage.setItem(SESSION_KEY, JSON.stringify(info));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage blocked: scanning still works, but the page cannot reopen offline
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
  const [online, setOnline] = useState(true);
  const [offline, setOffline] = useState(offlineStatus());
  const [listNote, setListNote] = useState<string | null>(null);
  const [updatingList, setUpdatingList] = useState(false);
  const busyRef = useRef(false); // true while a scan is being checked or its result is showing
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The latest scan the phone has had no server answer for. */
  const unansweredRef = useRef<{ qr: string; clientRef: string; at: number } | null>(null);
  /** ID of the scan whose result is (or was last) on screen. */
  const activeScanRef = useRef<string | null>(null);
  /** Whether a result is on screen right now. */
  const resultShownRef = useRef(false);
  resultShownRef.current = result !== null;

  const endSession = useCallback(() => {
    setCsrfToken(null);
    storeSession(null);
    setSession(null);
    setResult(null);
    setLookupOpen(false);
    busyRef.current = false;
    setPinError('You have been signed out. Enter the gate PIN again.');
  }, []);

  // Who is signed in on this phone? Ask the server; if it cannot be reached, trust what was saved.
  useEffect(() => {
    void registerServiceWorker().catch(() => undefined);
    api<GateSessionInfo>('/api/auth/gate/me', { timeoutMs: 6000 })
      .then((info) => {
        setCsrfToken(info.csrfToken);
        storeSession(info);
        setSession(info);
      })
      .catch((err: unknown) => {
        const saved = readStoredSession();
        if (err instanceof ApiError && err.status === 0 && saved) {
          setCsrfToken(saved.csrfToken); // offline: carry on with the saved session
          setSession(saved);
        } else {
          storeSession(null);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  /** Uploads stored check-ins, then refreshes the saved list. Quietly does nothing while offline. */
  const refreshOffline = useCallback(
    async (showProblems = false) => {
      if (!navigator.onLine) {
        if (showProblems) setListNote('No connection. The saved list stays in use.');
        return;
      }
      const sync = await syncPending();
      if (sync.sessionEnded) return endSession();
      try {
        await downloadList();
        setOnline(true); // the server answered, whatever an earlier failed scan suggested
        setListNote(
          sync.conflicts > 0
            ? `${sync.conflicts} offline ${sync.conflicts === 1 ? 'entry was' : 'entries were'} not valid. Tell the organiser.`
            : null,
        );
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return endSession();
        if (err instanceof ApiError && err.status === 0) setOnline(false);
        if (showProblems) setListNote(err instanceof ApiError && err.status === 0 ? 'No connection. The saved list stays in use.' : 'The list could not be updated.');
      } finally {
        setOffline(offlineStatus());
      }
    },
    [endSession],
  );

  // Once signed in: load what this phone saved, then keep the list fresh and check-ins uploaded.
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    setOnline(navigator.onLine);

    void loadSaved().then(() => {
      if (stopped) return;
      setOffline(offlineStatus());
      void refreshOffline();
    });

    const tick = setInterval(() => {
      const { list, pending } = offlineStatus();
      const stale = !list || Date.now() - new Date(list.generatedAt).getTime() > LIST_MAX_AGE_MS;
      if (navigator.onLine && (pending > 0 || stale)) void refreshOffline();
    }, TICK_MS);
    const goOnline = () => {
      setOnline(true);
      void refreshOffline();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      stopped = true;
      clearInterval(tick);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [session, refreshOffline]);

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

      // One ID per scan attempt, whichever way it ends up being checked. A rescan of a pass the
      // phone never got an answer about reuses the ID, so the server can tell "the same scan,
      // asked again" from "a second person with the same pass".
      const earlier = unansweredRef.current;
      const clientRef =
        earlier && earlier.qr === qr && Date.now() - earlier.at < SAME_SCAN_RETRY_MS ? earlier.clientRef : crypto.randomUUID();
      unansweredRef.current = { qr, clientRef, at: Date.now() };
      activeScanRef.current = clientRef;

      type Answer = { outcome: ScanOutcome } | { error: unknown };
      const server: Promise<Answer> | null = navigator.onLine
        ? api<ScanOutcome>('/api/scan', { method: 'POST', body: { qr, clientRef }, timeoutMs: SERVER_ANSWER_TIMEOUT_MS }).then(
            (outcome) => ({ outcome }),
            (error: unknown) => ({ error }),
          )
        : null;

      /** Shows what the server said. Returns false if the server could not be reached at all. */
      const useServerAnswer = (answer: Answer): boolean => {
        if ('outcome' in answer) {
          unansweredRef.current = null;
          setOnline(true);
          if (answer.outcome.result === 'ok') void noteAdmitted(qr);
          show(toView(answer.outcome));
          return true;
        }
        const err = answer.error;
        if (err instanceof ApiError && err.status === 401) {
          endSession();
          return true;
        }
        if (err instanceof ApiError && err.status !== 0) {
          // The server answered, but with a problem (for example "scanning too fast").
          show({ tone: 'grey', title: 'Not checked', lines: [err.message] });
          return true;
        }
        setOnline(false);
        return false;
      };

      try {
        if (server) {
          const quick = await Promise.race([
            server,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), LOCAL_FALLBACK_AFTER_MS)),
          ]);
          if (quick && useServerAnswer(quick)) return;
        }

        // The server is slow or unreachable. Can the list saved on this phone settle it?
        const verdict = await checkLocally(qr, clientRef);
        setOffline(offlineStatus());
        if (verdict.kind === 'admitted' || verdict.kind === 'already') {
          show(toLocalView(verdict));
          // If the server does answer after all, its word is final.
          void server?.then(async (late) => {
            if (!('outcome' in late)) return;
            unansweredRef.current = null;
            setOnline(true);
            await dropPending(clientRef); // the server has its own record of this scan now
            setOffline(offlineStatus());
            if (activeScanRef.current !== clientRef || verdict.kind !== 'admitted') return;
            if (late.outcome.result !== 'ok') {
              show(toView(late.outcome)); // for example: used at another gate a moment ago
            } else if (resultShownRef.current) {
              // Same verdict, now with the name and the rest of the group: update without a second beep.
              setResult(toView(late.outcome));
              if (timerRef.current) clearTimeout(timerRef.current);
              timerRef.current = setTimeout(dismiss, RESULT_MS);
            }
          });
          return;
        }

        // The saved list cannot confirm this pass. Do not guess: wait for the server's own answer.
        if (server && useServerAnswer(await server)) return;
        show(toLocalView(verdict));
      } finally {
        setChecking(false);
      }
    },
    [show, dismiss, endSession],
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
      storeSession(info);
      setSession(info);
      setPin('');
    } catch (err) {
      setPinError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Something went wrong');
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    const waiting = offlineStatus().pending;
    if (
      waiting > 0 &&
      !window.confirm(`${waiting} offline check-in${waiting === 1 ? ' has' : 's have'} not been uploaded yet. They stay on this phone and upload after the next sign-in. Sign out anyway?`)
    ) {
      return;
    }
    try {
      await api('/api/auth/gate/logout', { method: 'POST', timeoutMs: 5000 });
    } catch {
      // sign out locally regardless
    }
    setCsrfToken(null);
    storeSession(null);
    setSession(null);
    setPinError(null);
  }

  async function updateList() {
    setUpdatingList(true);
    await refreshOffline(true);
    setUpdatingList(false);
  }

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">Loading…</main>;
  }

  // --- PIN screen ----------------------------------------------------------
  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-white">
        <form onSubmit={signIn} className="w-full max-w-xs space-y-6" noValidate>
          <div className="space-y-4 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16" />
              </svg>
            </span>
            <div>
              <h1 className="text-2xl font-semibold">Gate scanner</h1>
              <p className="mt-1 text-sm text-zinc-400">Enter the PIN for your gate.</p>
            </div>
          </div>
          {pinError && (
            <p className="rounded-xl bg-red-500/15 px-3 py-2 text-center text-sm text-red-300" role="alert">
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
            className="block w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-center text-3xl font-semibold tracking-[0.5em] text-white placeholder:text-zinc-600 focus:border-white/40 focus:outline-none"
            placeholder="••••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          <button
            type="submit"
            className="w-full rounded-2xl bg-white py-4 text-base font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:opacity-30"
            disabled={signingIn || pin.length < 4}
          >
            {signingIn ? 'Checking…' : 'Start scanning'}
          </button>
        </form>
      </main>
    );
  }

  // --- Scanner -------------------------------------------------------------
  const { list, pending, storageFailed } = offline;
  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{session.gate}</p>
            <p className="text-xs text-zinc-500">{checking ? 'Checking…' : 'Point the camera at a pass'}</p>
          </div>
        </div>
        <button type="button" onClick={signOut} className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/15">
          Sign out
        </button>
      </header>

      {!online && (
        <p className="mx-auto mb-3 max-w-md px-4" role="status">
          <span className="block rounded-xl bg-amber-400 px-3 py-2 text-sm font-semibold text-zinc-900">
            {list
              ? 'No connection. Passes are being checked against the list saved on this phone.'
              : 'No connection, and no saved list on this phone. Passes cannot be checked until it is back.'}
          </span>
        </p>
      )}

      <div className="px-4">
        <CameraScanner onScan={onScan} onReady={() => void saveCurrentPage({ includePage: true })} />
      </div>

      <div className="mx-auto max-w-md space-y-3 p-4">
        <button
          type="button"
          disabled={!online}
          onClick={() => {
            busyRef.current = true; // no scanning while looking a booking up
            setLookupOpen(true);
          }}
          className="w-full rounded-2xl bg-white px-4 py-3.5 text-base font-semibold text-zinc-950 transition hover:bg-zinc-200 disabled:bg-white/10 disabled:text-zinc-500"
        >
          {online ? 'Find booking (no QR)' : 'Find booking needs a connection'}
        </button>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-sm" data-testid="offline-status">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-400">
              {list
                ? `Saved list: ${list.count.toLocaleString('en-IN')} valid passes, updated ${formatIstTime(list.generatedAt)}`
                : 'No list saved on this phone yet'}
            </p>
            <button
              type="button"
              onClick={updateList}
              disabled={updatingList}
              className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/15 disabled:opacity-50"
            >
              {updatingList ? 'Updating…' : 'Update list'}
            </button>
          </div>
          {pending > 0 && (
            <p className="mt-2 font-semibold text-amber-300">
              {pending} offline check-in{pending === 1 ? '' : 's'} waiting to upload
            </p>
          )}
          {storageFailed && (
            <p className="mt-2 font-semibold text-red-300">
              This phone could not save a check-in. Keep this page open until it has uploaded.
            </p>
          )}
          {listNote && <p className="mt-2 text-amber-200">{listNote}</p>}
        </div>

        <InstallPrompt />

        <p className="text-center text-xs text-zinc-500">
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
