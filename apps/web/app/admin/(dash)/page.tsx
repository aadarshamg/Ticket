'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAdmin } from '@/components/AdminShell';
import { api } from '@/lib/api';
import { formatIst, formatIstTime } from '@/lib/ist';
import type { SettingsResponse, Stats } from '@/lib/types';

const REFRESH_MS = 5000;
const n = (value: number) => value.toLocaleString('en-IN');

function Tile({ label, value, tone = 'text-zinc-900', hint }: { label: string; value: number; tone?: string; hint?: string }) {
  return (
    <div className="card p-3 sm:p-4">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className={`text-2xl font-semibold ${tone}`}>{n(value)}</dd>
      {hint && <dd className="mt-0.5 text-xs text-zinc-500">{hint}</dd>}
    </div>
  );
}

export default function OverviewPage() {
  const admin = useAdmin();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SettingsResponse>('/api/event')
      .then(setSettings)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong'));
  }, []);

  // Live numbers: every 5 seconds while this tab is in view.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const next = await api<Stats>('/api/stats');
          if (!stopped) {
            setStats(next);
            setError(null);
          }
        } catch (err) {
          if (!stopped) setError(err instanceof Error ? err.message : 'Something went wrong');
        }
      }
      if (!stopped) timer = setTimeout(tick, REFRESH_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const event = settings?.event;
  const activeGates = settings?.gates.filter((gate) => gate.active).length ?? 0;
  const expected = stats ? stats.entered + stats.stillToCome : 0;
  const share = expected > 0 && stats ? Math.round((stats.entered / expected) * 100) : 0;
  const busiest = stats?.gates[0]?.entered ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold">{event ? event.name : `Welcome, ${admin.name}`}</h1>
          {event && (
            <p className="text-sm text-zinc-600">
              {event.venue}, {event.city} · starts {formatIst(event.startsAt)} IST
            </p>
          )}
        </div>
        {/* A plain link: the browser downloads the file using the admin session cookie. */}
        <a href="/api/export.csv" className="btn-secondary">
          Download CSV
        </a>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          Could not refresh: {error}
        </p>
      )}

      {settings && !event && (
        <div className="card">
          <h2 className="font-semibold">Set up your event</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Add the event name, venue, timings and entry gates before uploading bookings.
          </p>
          <Link href="/admin/settings" className="btn-primary mt-4">
            Open settings
          </Link>
        </div>
      )}

      {event && activeGates === 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No active gates yet. Volunteers need a gate PIN to scan passes.{' '}
          <Link href="/admin/settings" className="font-medium underline">
            Add one in Settings
          </Link>
          .
        </p>
      )}

      {!stats && !error && <p className="text-sm text-zinc-500">Loading the numbers…</p>}

      {stats && (
        <>
          <section className="card space-y-3" aria-label="Entry">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">At the gates</h2>
              <p className="text-xs text-zinc-500" aria-live="off">
                Updated {formatIstTime(stats.generatedAt)} · refreshes every 5 seconds
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
              <p>
                <span className="text-4xl font-bold text-emerald-700">{n(stats.entered)}</span>
                <span className="ml-2 text-sm text-zinc-600">people entered</span>
              </p>
              <p>
                <span className="text-4xl font-bold text-zinc-900">{n(stats.stillToCome)}</span>
                <span className="ml-2 text-sm text-zinc-600">still to come</span>
              </p>
            </div>
            <div
              className="h-3 overflow-hidden rounded-full bg-zinc-200"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={expected}
              aria-valuenow={stats.entered}
              aria-label="People entered"
            >
              <div className="h-full bg-emerald-600" style={{ width: `${share}%` }} />
            </div>
            <p className="text-sm text-zinc-600">
              {share}% of {n(expected)} expected
            </p>

            {stats.gates.length > 0 && (
              <ul className="space-y-2 pt-1">
                {stats.gates.map((gate) => (
                  <li key={gate.gate} className="text-sm">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{gate.gate}</span>
                      <span className="text-zinc-600">
                        {n(gate.entered)} entered
                        {gate.lastEntryAt ? ` · last at ${formatIstTime(gate.lastEntryAt)}` : ''}
                      </span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-100">
                      <div className="h-full bg-zinc-800" style={{ width: `${busiest > 0 ? (gate.entered / busiest) * 100 : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {stats.gates.length === 0 && <p className="text-sm text-zinc-500">Nobody has been scanned in yet.</p>}

            {stats.conflicts > 0 && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {n(stats.conflicts)} offline {stats.conflicts === 1 ? 'entry was' : 'entries were'} not valid.{' '}
                <Link href="/admin/conflicts" className="font-medium underline">
                  See conflicts
                </Link>
              </p>
            )}
          </section>

          <section aria-label="Bookings and passes">
            <h2 className="mb-2 font-semibold">Bookings and passes</h2>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Bookings" value={stats.bookings.active} hint={stats.bookings.cancelled > 0 ? `${n(stats.bookings.cancelled)} cancelled` : undefined} />
              <Tile label="Passes issued" value={stats.passes.valid + stats.passes.used} />
              <Tile label="Passes used" value={stats.passes.used} tone="text-emerald-700" />
              <Tile label="Passes cancelled" value={stats.passes.cancelled} tone={stats.passes.cancelled > 0 ? 'text-amber-700' : 'text-zinc-900'} />
            </dl>
          </section>

          <section aria-label="WhatsApp messages">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="font-semibold">WhatsApp messages</h2>
              <Link href="/admin/send" className="text-sm font-medium text-zinc-900 hover:underline">
                Open Send
              </Link>
            </div>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Tile label="Not sent yet" value={stats.messages.unsent} />
              <Tile label="Waiting to send" value={stats.messages.queued} tone="text-amber-700" />
              <Tile label="Sent" value={stats.messages.sent} tone="text-sky-700" />
              <Tile label="Delivered" value={stats.messages.delivered} tone="text-emerald-700" />
              <Tile label="Read" value={stats.messages.read} tone="text-emerald-700" />
              <Tile label="Failed" value={stats.messages.failed} tone={stats.messages.failed > 0 ? 'text-red-700' : 'text-zinc-900'} />
            </dl>
            <p className="mt-2 text-xs text-zinc-500">
              Each booking is counted once, at its latest status: a message that has been read is under Read, not Delivered.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
