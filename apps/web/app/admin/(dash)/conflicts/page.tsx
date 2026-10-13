'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { api } from '@/lib/api';
import { formatIst } from '@/lib/ist';
import type { Conflict } from '@/lib/types';

const KIND: Record<Conflict['result'], { tone: BadgeTone; label: string; meaning: string }> = {
  already_used: { tone: 'red', label: 'Entered twice', meaning: 'The same pass was also used for another entry.' },
  cancelled: { tone: 'amber', label: 'Cancelled booking', meaning: 'The booking had been cancelled.' },
  invalid: { tone: 'red', label: 'Not a real pass', meaning: 'The code was not issued by this system.' },
};

export default function ConflictsPage() {
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<{ conflicts: Conflict[] }>('/api/checkins/conflicts')
      .then((data) => {
        setConflicts(data.conflicts);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong'));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Offline conflicts</h1>
        <p className="mt-1 text-sm text-slate-600">
          When a gate has no internet, its scanner checks passes against a list saved on the phone and uploads
          the entries later. This page lists entries that turned out not to be valid once uploaded. These people
          did get in.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {conflicts === null && !error && <p className="text-sm text-slate-500">Loading…</p>}
      {conflicts && conflicts.length === 0 && (
        <div className="card text-sm text-slate-600">No conflicts. Every offline entry so far was valid.</div>
      )}

      <ul className="space-y-3">
        {(conflicts ?? []).map((conflict) => {
          const kind = KIND[conflict.result];
          return (
            <li key={conflict.id} className="card space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {conflict.booking
                    ? `${conflict.booking.name} · order ${conflict.booking.orderId} · pass ${conflict.booking.passNo} of ${conflict.booking.passCount}`
                    : 'Unknown code'}
                </p>
                <Badge tone={kind.tone}>{kind.label}</Badge>
              </div>
              <p className="text-sm text-slate-700">{kind.meaning}</p>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Let in offline at</dt>
                  <dd className="font-medium">
                    {conflict.gate} · {formatIst(conflict.scannedAt)}
                  </dd>
                  <dd className="text-xs text-slate-500">Phone {conflict.deviceId.slice(0, 8)}</dd>
                </div>
                {conflict.result === 'already_used' && conflict.recordedEntry && (
                  <div>
                    <dt className="text-slate-500">Other entry on this pass</dt>
                    <dd className="font-medium">
                      {conflict.recordedEntry.gate ?? 'Unknown gate'} · {formatIst(conflict.recordedEntry.at)}
                    </dd>
                  </div>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
