'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { api } from '@/lib/api';
import { formatIst } from '@/lib/ist';
import type { AuditEntry, AuditList } from '@/lib/types';

const PAGE_SIZE = 50;

const GROUPS: { value: string; label: string }[] = [
  { value: '', label: 'Everything' },
  { value: 'uploads', label: 'Uploads' },
  { value: 'bookings', label: 'Booking changes' },
  { value: 'sending', label: 'WhatsApp sending' },
  { value: 'checkins', label: 'Gate entries' },
  { value: 'settings', label: 'Settings and gates' },
  { value: 'signins', label: 'Sign-ins' },
  { value: 'data', label: 'Exports and data' },
];

/** Plain-language names for the actions the system records. Unknown ones are shown as stored. */
const ACTIONS: Record<string, string> = {
  'admin.login': 'Signed in',
  'admin.logout': 'Signed out',
  'admin.login_failed': 'Failed sign-in attempt',
  'admin.create': 'Admin login created',
  'admin.password_reset': 'Admin password reset',
  'event.create': 'Event settings created',
  'event.update': 'Event settings changed',
  'gate.create': 'Gate added',
  'gate.update': 'Gate changed',
  'gate.delete': 'Gate removed',
  'gate.login': 'Volunteer signed in to a gate',
  'gate.login_failed': 'Wrong gate PIN entered',
  'upload.preview': 'Spreadsheet checked',
  'upload.confirm': 'Spreadsheet saved',
  'ticket.update': 'Booking edited',
  'ticket.cancel': 'Booking cancelled',
  'ticket.restore': 'Booking restored',
  'send.queue': 'Messages queued for sending',
  'send.test': 'Test message sent',
  'send.pause': 'Sending paused',
  'send.resume': 'Sending resumed',
  'send.auto_pause': 'Sending paused automatically',
  'checkin.scan': 'Pass scanned in',
  'checkin.admit_all': 'Rest of a booking admitted',
  'checkin.manual': 'Admitted by manual lookup',
  'checkin.offline': 'Offline entry uploaded',
  'checkin.offline_conflict': 'Offline entry not valid',
  'export.csv': 'Bookings exported to CSV',
  'data.purge': 'Booking data deleted',
  'seed.demo_data': 'Demo data loaded',
};

const WHO: Record<AuditEntry['actorType'], { tone: BadgeTone; label: string }> = {
  admin: { tone: 'blue', label: 'Admin' },
  gate: { tone: 'green', label: 'Gate' },
  system: { tone: 'slate', label: 'System' },
};

/** "changed: name, phone · passNo: 2" */
function details(meta: AuditEntry['meta']): string {
  if (!meta) return '';
  return Object.entries(meta)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`)
    .join(' · ');
}

export default function AuditPage() {
  const [group, setGroup] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (group) params.set('group', group);
    if (q) params.set('q', q);
    try {
      const list = await api<AuditList>(`/api/audit?${params}`);
      if (requestId !== latestRequest.current) return;
      setData(list);
      setError(null);
    } catch (err) {
      if (requestId === latestRequest.current) setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [group, q, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Activity log</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Every change made in the system: who did it, what, and when. Newest first. Entries cannot be edited.
        </p>
      </div>

      <div className="card grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="group" className="mb-1 block text-sm font-medium text-zinc-700">Show</label>
          <select id="group" className="input" value={group} onChange={(e) => { setGroup(e.target.value); setPage(1); }}>
            {GROUPS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="who" className="mb-1 block text-sm font-medium text-zinc-700">Done by</label>
          <input id="who" type="search" className="input" placeholder="Admin email or gate name" value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>
      )}

      <p className="text-sm text-zinc-600" aria-live="polite">
        {loading && !data ? 'Loading…' : `${total.toLocaleString('en-IN')} ${total === 1 ? 'entry' : 'entries'}`}
      </p>

      {data && items.length === 0 && <div className="card text-sm text-zinc-600">Nothing matches.</div>}

      <ul className={`space-y-2 ${loading ? 'opacity-60' : ''}`}>
        {items.map((entry) => {
          const who = WHO[entry.actorType];
          const more = details(entry.meta);
          return (
            <li key={entry.id} className="card p-3 sm:p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="font-medium">{ACTIONS[entry.action] ?? entry.action}</p>
                <time className="text-xs text-zinc-500" dateTime={entry.createdAt}>{formatIst(entry.createdAt)} IST</time>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-700">
                <Badge tone={who.tone}>{who.label}</Badge>
                <span className="break-all">{entry.actorLabel}</span>
              </div>
              {more && <p className="mt-1 break-words text-xs text-zinc-500">{more}</p>}
            </li>
          );
        })}
      </ul>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-zinc-600">
          <span>Page {page} of {pageCount.toLocaleString('en-IN')}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary px-3 py-1.5" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
              Newer
            </button>
            <button type="button" className="btn-secondary px-3 py-1.5" disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)}>
              Older
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
