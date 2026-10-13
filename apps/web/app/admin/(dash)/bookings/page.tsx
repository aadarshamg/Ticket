'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { Dialog } from '@/components/Dialog';
import { Field } from '@/components/Field';
import { api, ApiError } from '@/lib/api';
import type { Booking, BookingList, BookingStatus, EntryStatus, MessageStatus } from '@/lib/types';

const PAGE_SIZE = 50;

const MESSAGE_BADGE: Record<MessageStatus, { tone: BadgeTone; label: string }> = {
  unsent: { tone: 'slate', label: 'Not sent' },
  queued: { tone: 'amber', label: 'Queued' },
  sent: { tone: 'blue', label: 'Sent' },
  delivered: { tone: 'green', label: 'Delivered' },
  read: { tone: 'green', label: 'Read' },
  failed: { tone: 'red', label: 'Failed' },
};

const rupees = (amount: string | null) => (amount === null ? '—' : `₹${Number(amount).toLocaleString('en-IN')}`);

function EntryBadge({ booking }: { booking: Booking }) {
  const { usedCount, passCount } = booking;
  const tone: BadgeTone = usedCount === 0 ? 'slate' : usedCount >= passCount ? 'green' : 'amber';
  return (
    <Badge tone={tone}>
      {usedCount} of {passCount} entered
    </Badge>
  );
}

function StatusBadges({ booking }: { booking: Booking }) {
  const message = MESSAGE_BADGE[booking.messageStatus];
  return (
    <div className="flex flex-wrap gap-1.5">
      {booking.status === 'cancelled' && <Badge tone="red">Cancelled</Badge>}
      <Badge tone={message.tone} title={booking.messageError ?? undefined}>
        {message.label}
      </Badge>
      <EntryBadge booking={booking} />
    </div>
  );
}

// --- Edit dialog -----------------------------------------------------------

function EditForm({ booking, onDone, onCancel }: { booking: Booking; onDone: (b: Booking) => void; onCancel: () => void }) {
  const [name, setName] = useState(booking.name);
  const [phone, setPhone] = useState(booking.phone);
  const [passCount, setPassCount] = useState(String(booking.passCount));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const patch: Record<string, unknown> = {};
    if (name.trim() !== booking.name) patch.name = name;
    if (phone.trim() !== booking.phone) patch.phone = phone;
    if (Number(passCount) !== booking.passCount) patch.passCount = Number(passCount);
    if (Object.keys(patch).length === 0) return onCancel();

    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      onDone(await api<Booking>(`/api/tickets/${booking.id}`, { method: 'PATCH', body: patch }));
    } catch (err) {
      if (err instanceof ApiError && err.details.length > 0) {
        setErrors(Object.fromEntries(err.details.map((detail) => [detail.path, detail.message])));
      } else {
        setMessage(err instanceof Error ? err.message : 'Something went wrong');
      }
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="text-sm text-slate-500">Order {booking.orderId}</p>
      {message && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {message}
        </p>
      )}
      <Field label="Name" htmlFor="edit-name" error={errors.name}>
        <input id="edit-name" className={`input ${errors.name ? 'input-error' : ''}`} value={name} maxLength={80}
          onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Phone" htmlFor="edit-phone" error={errors.phone}
        hint="If you change this after sending, resend the WhatsApp message.">
        <input id="edit-phone" type="tel" inputMode="tel" className={`input ${errors.phone ? 'input-error' : ''}`}
          value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="Number of passes" htmlFor="edit-passes" error={errors.passCount}
        hint={booking.usedCount > 0 ? `${booking.usedCount} already used; cannot go below that.` : undefined}>
        <input id="edit-passes" type="number" inputMode="numeric" min={Math.max(1, booking.usedCount)}
          className={`input ${errors.passCount ? 'input-error' : ''}`} value={passCount}
          onChange={(e) => setPassCount(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Close
        </button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

// --- Cancel / restore dialog -----------------------------------------------

function StatusForm({ booking, onDone, onCancel }: { booking: Booking; onDone: (b: Booking) => void; onCancel: () => void }) {
  const cancelling = booking.status === 'active';
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const unused = booking.passCount - booking.usedCount;

  async function apply() {
    setSaving(true);
    setMessage(null);
    try {
      const status: BookingStatus = cancelling ? 'cancelled' : 'active';
      onDone(await api<Booking>(`/api/tickets/${booking.id}`, { method: 'PATCH', body: { status } }));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-700">
        {cancelling
          ? `${booking.name} (order ${booking.orderId}): ${unused} unused ${unused === 1 ? 'pass' : 'passes'} will stop working at the gate.`
          : `${booking.name} (order ${booking.orderId}): the cancelled passes will work at the gate again.`}
        {cancelling && booking.usedCount > 0 && ` ${booking.usedCount} already used will stay recorded as entered.`}
      </p>
      {message && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {message}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Keep as is
        </button>
        <button type="button" className={cancelling ? 'btn-danger' : 'btn-primary'} onClick={apply} disabled={saving}>
          {saving ? 'Saving…' : cancelling ? 'Cancel booking' : 'Restore booking'}
        </button>
      </div>
    </div>
  );
}

// --- Page ------------------------------------------------------------------

export default function BookingsPage() {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState(''); // debounced search
  const [status, setStatus] = useState<BookingStatus | ''>('');
  const [messageStatus, setMessageStatus] = useState<MessageStatus | ''>('');
  const [entryStatus, setEntryStatus] = useState<EntryStatus | ''>('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<BookingList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'edit' | 'status'; booking: Booking } | null>(null);
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
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (messageStatus) params.set('messageStatus', messageStatus);
    if (entryStatus) params.set('entryStatus', entryStatus);
    try {
      const list = await api<BookingList>(`/api/tickets?${params}`);
      if (requestId !== latestRequest.current) return; // a newer search is already running
      setData(list);
      setError(null);
    } catch (err) {
      if (requestId !== latestRequest.current) return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [q, status, messageStatus, entryStatus, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSaved() {
    setDialog(null);
    void load(); // a changed booking may no longer match the current filters
  }

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const items = data?.items ?? [];

  const actions = (booking: Booking) => (
    <div className="flex gap-2">
      <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => setDialog({ kind: 'edit', booking })}>
        Edit
      </button>
      <button
        type="button"
        className={booking.status === 'active' ? 'btn-danger px-3 py-1.5' : 'btn-secondary px-3 py-1.5'}
        onClick={() => setDialog({ kind: 'status', booking })}
      >
        {booking.status === 'active' ? 'Cancel' : 'Restore'}
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Bookings</h1>

      <div className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-1">
          <label htmlFor="search" className="mb-1 block text-sm font-medium text-slate-700">Search</label>
          <input id="search" type="search" className="input" placeholder="Name, order ID, phone or email"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label htmlFor="f-message" className="mb-1 block text-sm font-medium text-slate-700">WhatsApp message</label>
          <select id="f-message" className="input" value={messageStatus}
            onChange={(e) => { setMessageStatus(e.target.value as MessageStatus | ''); setPage(1); }}>
            <option value="">Any</option>
            {(Object.keys(MESSAGE_BADGE) as MessageStatus[]).map((key) => (
              <option key={key} value={key}>{MESSAGE_BADGE[key].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="f-entry" className="mb-1 block text-sm font-medium text-slate-700">Entry</label>
          <select id="f-entry" className="input" value={entryStatus}
            onChange={(e) => { setEntryStatus(e.target.value as EntryStatus | ''); setPage(1); }}>
            <option value="">Any</option>
            <option value="none">Nobody entered</option>
            <option value="partial">Some entered</option>
            <option value="full">Everyone entered</option>
          </select>
        </div>
        <div>
          <label htmlFor="f-status" className="mb-1 block text-sm font-medium text-slate-700">Booking</label>
          <select id="f-status" className="input" value={status}
            onChange={(e) => { setStatus(e.target.value as BookingStatus | ''); setPage(1); }}>
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>
      )}

      <p className="text-sm text-slate-600" aria-live="polite">
        {loading && !data ? 'Loading…' : `Showing ${first.toLocaleString('en-IN')}–${last.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`}
      </p>

      {data && items.length === 0 && (
        <div className="card text-sm text-slate-600">No bookings match. Try a different search or filter.</div>
      )}

      {/* Phones: one card per booking */}
      <ul className={`space-y-3 md:hidden ${loading ? 'opacity-60' : ''}`}>
        {items.map((booking) => (
          <li key={booking.id} className="card space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{booking.name}</p>
                <p className="text-sm text-slate-500">
                  {booking.orderId}{booking.category ? ` · ${booking.category}` : ''} · {rupees(booking.amount)}
                </p>
                <p className="text-sm text-slate-700">{booking.phone}</p>
              </div>
            </div>
            <StatusBadges booking={booking} />
            {actions(booking)}
          </li>
        ))}
      </ul>

      {/* Larger screens: table */}
      {items.length > 0 && (
        <div className={`card hidden overflow-x-auto p-0 md:block md:p-0 ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Order ID</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Phone</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((booking) => (
                <tr key={booking.id} className={booking.status === 'cancelled' ? 'text-slate-400' : ''}>
                  <td className="whitespace-nowrap px-4 py-2 font-medium">{booking.orderId}</td>
                  <td className="px-2 py-2">
                    <div className="max-w-[16rem] truncate">{booking.name}</div>
                    {booking.category && <div className="text-xs text-slate-500">{booking.category}</div>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">{booking.phone}</td>
                  <td className="whitespace-nowrap px-2 py-2">{rupees(booking.amount)}</td>
                  <td className="px-2 py-2"><StatusBadges booking={booking} /></td>
                  <td className="px-4 py-2">{actions(booking)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 text-sm text-slate-600">
          <span>Page {page} of {pageCount.toLocaleString('en-IN')}</span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary px-3 py-1.5" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button type="button" className="btn-secondary px-3 py-1.5" disabled={page >= pageCount || loading} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </div>
      )}

      <Dialog open={dialog?.kind === 'edit'} onClose={() => setDialog(null)} title="Edit booking">
        {dialog?.kind === 'edit' && (
          <EditForm key={dialog.booking.id} booking={dialog.booking} onDone={onSaved} onCancel={() => setDialog(null)} />
        )}
      </Dialog>
      <Dialog
        open={dialog?.kind === 'status'}
        onClose={() => setDialog(null)}
        title={dialog?.booking.status === 'cancelled' ? 'Restore this booking?' : 'Cancel this booking?'}
      >
        {dialog?.kind === 'status' && (
          <StatusForm key={dialog.booking.id} booking={dialog.booking} onDone={onSaved} onCancel={() => setDialog(null)} />
        )}
      </Dialog>
    </div>
  );
}
