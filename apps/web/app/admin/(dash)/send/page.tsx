'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/Dialog';
import { api, ApiError } from '@/lib/api';
import type { SendQueued, SendStatus, TestSendResult } from '@/lib/types';

const n = (value: number) => value.toLocaleString('en-IN');
const bookings = (count: number) => `${n(count)} booking${count === 1 ? '' : 's'}`;

type Confirm =
  | { kind: 'unsent'; count: number; limit?: number }
  | { kind: 'failed'; count: number }
  | { kind: 'reminder'; count: number };

const COUNT_TILES: { key: keyof SendStatus['counts']; label: string; className: string }[] = [
  { key: 'unsent', label: 'Not sent yet', className: 'text-slate-900' },
  { key: 'queued', label: 'Waiting to send', className: 'text-amber-700' },
  { key: 'sent', label: 'Sent', className: 'text-sky-700' },
  { key: 'delivered', label: 'Delivered', className: 'text-emerald-700' },
  { key: 'read', label: 'Read', className: 'text-emerald-700' },
  { key: 'failed', label: 'Failed', className: 'text-red-700' },
];

export default function SendPage() {
  const [status, setStatus] = useState<SendStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [howMany, setHowMany] = useState('');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [testNumbers, setTestNumbers] = useState('');
  const [testResult, setTestResult] = useState<TestSendResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const activeRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api<SendStatus>('/api/send/status');
      setStatus(next);
      setLoadError(null);
      activeRef.current = next.counts.queued > 0 || (next.queue?.pending ?? 0) > 0;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }, []);

  // Live progress: every 2 seconds while messages are going out, every 5 otherwise.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState === 'visible') await refresh();
      if (!stopped) timer = setTimeout(tick, activeRef.current ? 2000 : 5000);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ kind: 'ok', text: await action() });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong' });
    } finally {
      setBusy(false);
      setConfirm(null);
      await refresh();
    }
  }

  const queue = (body: Record<string, unknown>, what: string) =>
    run(async () => {
      const result = await api<SendQueued>('/api/send', { method: 'POST', body });
      return result.queued === 0 ? 'Nothing to send.' : `${bookings(result.queued)} added to the queue for ${what}.`;
    });

  async function sendTest() {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const phones = testNumbers.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
      setTestResult(await api<TestSendResult>('/api/send/test', { method: 'POST', body: { phones } }));
    } catch (err) {
      setTestError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Something went wrong');
    } finally {
      setTesting(false);
    }
  }

  if (!status) {
    return <p className="text-sm text-slate-500">{loadError ?? 'Loading…'}</p>;
  }

  const { counts, queue: run_ } = status;
  const limit = howMany.trim() === '' ? undefined : Number(howMany);
  const limitValid = limit === undefined || (Number.isInteger(limit) && limit >= 1);
  const toSend = limit === undefined ? counts.unsent : Math.min(limit, counts.unsent);
  const done = run_ ? run_.sent + run_.failed : 0;
  const inProgress = run_ !== null && (run_.pending > 0 || run_.paused);
  const canSend = status.configured && !status.problem;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Send passes on WhatsApp</h1>

      {status.problem && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{status.problem}</p>
      )}
      {loadError && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">Could not refresh: {loadError}</p>
      )}
      {status.sender === 'mock' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Test mode.</strong> Messages are written to the server log and are not sent to WhatsApp. Nobody
          will receive anything.
        </p>
      )}
      {notice && (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}
        >
          {notice.text}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {COUNT_TILES.map((tile) => (
          <div key={tile.key} className="card p-3 sm:p-4">
            <dt className="text-xs text-slate-500">{tile.label}</dt>
            <dd className={`text-2xl font-semibold ${tile.className}`}>{n(counts[tile.key])}</dd>
          </div>
        ))}
      </dl>

      {run_ && inProgress && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">{run_.paused ? 'Sending is paused' : 'Sending now'}</h2>
            {run_.paused ? (
              <button type="button" className="btn-primary" disabled={busy}
                onClick={() => run(async () => { await api('/api/send/resume', { method: 'POST' }); return 'Sending resumed.'; })}>
                Resume
              </button>
            ) : (
              <button type="button" className="btn-secondary" disabled={busy}
                onClick={() => run(async () => { await api('/api/send/pause', { method: 'POST' }); return 'Sending paused.'; })}>
                Pause
              </button>
            )}
          </div>
          <div
            className="h-3 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={run_.total}
            aria-valuenow={done}
            aria-label="Messages processed"
          >
            <div
              className={`h-full ${run_.paused ? 'bg-amber-500' : 'bg-indigo-600'}`}
              style={{ width: `${run_.total > 0 ? Math.min(100, (done / run_.total) * 100) : 0}%` }}
            />
          </div>
          <p className="text-sm text-slate-700">
            {n(done)} of {n(run_.total)} done · {n(run_.pending)} waiting
            {run_.failed > 0 && <span className="font-medium text-red-700"> · {n(run_.failed)} failed</span>}
          </p>
          {run_.paused && run_.pauseReason === 'failure_rate' && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              Sending stopped by itself because more than 10% of recent messages failed. Open Bookings, filter
              WhatsApp message to “Failed”, and hover a Failed badge to see the reason. Fix the cause, then press
              Resume. The waiting messages have not been lost.
            </p>
          )}
        </div>
      )}

      <section className="card space-y-3">
        <h2 className="font-semibold">Send passes</h2>
        <p className="text-sm text-slate-700">
          {counts.unsent === 0
            ? 'Every active booking has already been sent its passes.'
            : `${bookings(counts.unsent)} ${counts.unsent === 1 ? 'has' : 'have'} not been sent passes yet. Bookings already sent are never sent again from here.`}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="howMany" className="mb-1 block text-sm font-medium text-slate-700">How many to send now</label>
            <input id="howMany" type="number" inputMode="numeric" min={1} className={`input w-40 ${limitValid ? '' : 'input-error'}`}
              placeholder={`All ${n(counts.unsent)}`} value={howMany} onChange={(e) => setHowMany(e.target.value)} />
          </div>
          <button type="button" className="btn-primary" disabled={!canSend || busy || counts.unsent === 0 || !limitValid}
            onClick={() => setConfirm({ kind: 'unsent', count: toSend, limit })}>
            Send to {bookings(toSend)}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          Leave the box empty to send to all of them. Oldest bookings go first. Start with a small number, check
          that those arrive, then send the rest.
        </p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Failed messages</h2>
        <p className="text-sm text-slate-700">
          {counts.failed === 0
            ? 'No failed messages.'
            : `${bookings(counts.failed)} could not be sent. In Bookings, filter WhatsApp message to “Failed” to see why, correct any wrong phone numbers, then resend.`}
        </p>
        <button type="button" className="btn-secondary" disabled={!canSend || busy || counts.failed === 0}
          onClick={() => setConfirm({ kind: 'failed', count: counts.failed })}>
          Resend failed
        </button>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Test message</h2>
        <p className="text-sm text-slate-700">
          Send the first booking&apos;s real message to your own team to check how it looks. The booking is not
          marked as sent.
        </p>
        <label htmlFor="testNumbers" className="block text-sm font-medium text-slate-700">Team phone numbers (up to 10, one per line)</label>
        <textarea id="testNumbers" rows={3} className="input" placeholder={'9876543210\n9876543211'}
          value={testNumbers} onChange={(e) => setTestNumbers(e.target.value)} />
        <button type="button" className="btn-secondary" disabled={!status.sender || testing || testNumbers.trim() === ''} onClick={sendTest}>
          {testing ? 'Sending…' : 'Send test'}
        </button>
        {testError && <p className="text-sm font-medium text-red-700" role="alert">{testError}</p>}
        {testResult && (
          <ul className="text-sm" role="status">
            {testResult.results.map((result) => (
              <li key={result.phone} className={result.ok ? 'text-emerald-800' : 'text-red-700'}>
                {result.phone}: {result.ok ? `sent (order ${testResult.orderId})` : `failed – ${result.error}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Reminder</h2>
        <p className="text-sm text-slate-700">
          {bookings(status.reminderCandidates)} still {status.reminderCandidates === 1 ? 'has' : 'have'} unused passes.
          A reminder uses the separate template <code className="text-xs">event_reminder_v1</code>, which Meta must
          approve first.
        </p>
        <button type="button" className="btn-secondary" disabled={!canSend || busy || status.reminderCandidates === 0}
          onClick={() => setConfirm({ kind: 'reminder', count: status.reminderCandidates })}>
          Send reminder
        </button>
      </section>

      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} title="Send WhatsApp messages?">
        {confirm && (
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              {confirm.kind === 'unsent' && `${bookings(confirm.count)} will each receive their passes on WhatsApp.`}
              {confirm.kind === 'failed' && `The message will be sent again to ${bookings(confirm.count)} whose message failed.`}
              {confirm.kind === 'reminder' && `A reminder will be sent to ${bookings(confirm.count)} with unused passes.`}
              {status.sender === 'mock' && ' (Test mode: nothing is really sent.)'}
            </p>
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setConfirm(null)} disabled={busy}>Not yet</button>
              <button type="button" className="btn-primary" disabled={busy}
                onClick={() => {
                  if (confirm.kind === 'unsent') void queue({ mode: 'unsent', limit: confirm.limit }, 'sending');
                  if (confirm.kind === 'failed') void queue({ mode: 'failed' }, 'resending');
                  if (confirm.kind === 'reminder') void queue({ mode: 'reminder' }, 'the reminder');
                }}>
                {busy ? 'Queueing…' : 'Send now'}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
