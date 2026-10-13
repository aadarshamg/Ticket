'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAdmin } from '@/components/AdminShell';
import { api } from '@/lib/api';
import { formatIst } from '@/lib/ist';
import type { SettingsResponse } from '@/lib/types';

export default function OverviewPage() {
  const admin = useAdmin();
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SettingsResponse>('/api/event')
      .then(setSettings)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong'));
  }, []);

  const event = settings?.event;
  const activeGates = settings?.gates.filter((gate) => gate.active).length ?? 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Welcome, {admin.name}</h1>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {settings && !event && (
        <div className="card">
          <h2 className="font-semibold">Set up your event</h2>
          <p className="mt-1 text-sm text-slate-600">
            Add the event name, venue, timings and entry gates before uploading bookings.
          </p>
          <Link href="/admin/settings" className="btn-primary mt-4">
            Open settings
          </Link>
        </div>
      )}

      {event && (
        <div className="card">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{event.name}</h2>
              <p className="text-sm text-slate-600">
                {event.venue}, {event.city}
              </p>
            </div>
            <span
              className="h-8 w-8 shrink-0 rounded-full border border-slate-200"
              style={{ backgroundColor: event.brandColour }}
              title={`Brand colour ${event.brandColour}`}
            />
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Gates open</dt>
              <dd className="font-medium">{formatIst(event.gatesOpenAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Starts</dt>
              <dd className="font-medium">{formatIst(event.startsAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Ends</dt>
              <dd className="font-medium">{formatIst(event.endsAt)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Entry gates</dt>
              <dd className="font-medium">
                {activeGates} active{settings.gates.length > activeGates ? ` of ${settings.gates.length}` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Max passes per booking</dt>
              <dd className="font-medium">{event.maxPassesPerBooking}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-slate-500">All times are India Standard Time.</p>
          {activeGates === 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              No active gates yet. Volunteers need a gate PIN to scan passes.
            </p>
          )}
          <Link href="/admin/settings" className="btn-secondary mt-4">
            Edit settings
          </Link>
        </div>
      )}
    </div>
  );
}
