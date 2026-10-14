'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiError } from '@/lib/api';
import { signal } from '@/lib/feedback';
import type { AdmitAllOutcome, LookupResult, ScanOutcome } from '@/lib/types';

interface Props {
  onClose: () => void;
  /** The session ended (PIN reset, expired): go back to the PIN screen. */
  onSessionEnded: () => void;
}

/**
 * Manual entry for when a QR cannot be scanned: find the booking by order ID or the last
 * four digits of the buyer's phone, then admit one person or everyone still to come.
 */
export function LookupPanel({ onClose, onSessionEnded }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupResult[] | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function fail(err: unknown) {
    if (err instanceof ApiError && err.status === 401) return onSessionEnded();
    setMessage({
      kind: 'error',
      text: err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Something went wrong',
    });
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const data = await api<{ results: LookupResult[] }>(`/api/scan/lookup?q=${encodeURIComponent(query.trim())}`);
      setResults(data.results);
    } catch (err) {
      setResults(null);
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const update = (ticketId: string, remaining: number, passCount: number) =>
    setResults((current) =>
      (current ?? []).map((row) =>
        row.ticketId === ticketId ? { ...row, remaining, passCount, entered: passCount - remaining } : row,
      ),
    );

  async function admitOne(row: LookupResult) {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await api<ScanOutcome>('/api/scan/admit-one', { method: 'POST', body: { ticketId: row.ticketId } });
      if (outcome.booking) update(row.ticketId, outcome.booking.remaining, outcome.booking.passCount);
      if (outcome.result === 'ok') {
        signal('ok');
        setMessage({ kind: 'ok', text: `Admitted 1 for ${row.name}. ${outcome.booking?.remaining ?? 0} still to come.` });
      } else {
        signal('error');
        setMessage({
          kind: 'error',
          text: outcome.result === 'cancelled' ? 'This booking is cancelled.' : 'Everyone on this booking has already entered.',
        });
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function admitAll(row: LookupResult) {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await api<AdmitAllOutcome>('/api/scan/admit-all', { method: 'POST', body: { ticketId: row.ticketId } });
      update(row.ticketId, outcome.booking.remaining, outcome.booking.passCount);
      if (outcome.admitted > 0) {
        signal('ok');
        setMessage({ kind: 'ok', text: `Admitted ${outcome.admitted} for ${row.name}. Everyone has now entered.` });
      } else {
        signal('error');
        setMessage({ kind: 'error', text: outcome.cancelled ? 'This booking is cancelled.' : 'Nobody was left to admit.' });
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 overflow-y-auto bg-zinc-950 p-4 text-white">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Find a booking</h2>
          <button type="button" onClick={onClose} className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-semibold">
            Back to camera
          </button>
        </div>

        <form onSubmit={search} className="space-y-2">
          <label htmlFor="lookup" className="block text-sm text-zinc-300">
            Order ID, or the last 4 digits of the buyer&apos;s phone number
          </label>
          <div className="flex gap-2">
            <input
              id="lookup"
              className="min-w-0 flex-1 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-3 text-lg text-white placeholder:text-zinc-500 focus:border-zinc-400 focus:outline-none"
              placeholder="ORD-1001 or 3210"
              autoComplete="off"
              autoCapitalize="characters"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <button
              type="submit"
              disabled={busy || query.trim().length < 3}
              className="rounded-lg bg-white px-4 py-3 font-semibold text-zinc-950 disabled:opacity-40"
            >
              Search
            </button>
          </div>
        </form>

        {message && (
          <p
            role={message.kind === 'error' ? 'alert' : 'status'}
            className={`rounded-lg px-3 py-3 text-sm font-medium ${message.kind === 'ok' ? 'bg-emerald-600' : 'bg-red-600'}`}
          >
            {message.text}
          </p>
        )}

        {results && results.length === 0 && (
          <p className="rounded-lg bg-zinc-800 p-4 text-sm text-zinc-300">
            No booking matches. Check the order ID is typed exactly, or try the last 4 digits of the phone number.
          </p>
        )}

        <ul className="space-y-3">
          {(results ?? []).map((row) => (
            <li key={row.ticketId} className="rounded-xl bg-zinc-800 p-4">
              <p className="text-lg font-semibold">{row.name}</p>
              <p className="text-sm text-zinc-300">
                {row.category ? `${row.category} · ` : ''}
                {row.entered} of {row.passCount} entered
              </p>
              {row.cancelled ? (
                <p className="mt-2 inline-block rounded-full bg-amber-500 px-3 py-1 text-sm font-semibold text-zinc-900">
                  Cancelled
                </p>
              ) : row.remaining === 0 ? (
                <p className="mt-2 text-sm text-zinc-400">Everyone has entered.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => admitOne(row)}
                    className="rounded-lg bg-emerald-600 px-4 py-3 font-semibold disabled:opacity-50"
                  >
                    Admit 1
                  </button>
                  {row.remaining > 1 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => admitAll(row)}
                      className="rounded-lg border border-emerald-400 px-4 py-3 font-semibold text-emerald-200 disabled:opacity-50"
                    >
                      Admit all {row.remaining}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
