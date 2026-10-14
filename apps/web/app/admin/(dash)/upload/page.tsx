'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Badge, type BadgeTone } from '@/components/Badge';
import { api } from '@/lib/api';
import { formatNight } from '@/lib/ist';
import type { ConfirmResult, PreviewRow, UploadPreview } from '@/lib/types';

type Filter = 'all' | 'valid' | 'invalid';
const PAGE_SIZE = 50;

const ACTION_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  create: { tone: 'green', label: 'New' },
  update: { tone: 'blue', label: 'Update' },
  unchanged: { tone: 'slate', label: 'No change' },
};

const plural = (count: number, word: string) => `${count.toLocaleString('en-IN')} ${word}${count === 1 ? '' : 's'}`;

function rowDetails(row: PreviewRow): string[] {
  if (!row.valid) return row.errors;
  const details = row.changes.length > 0 ? [`Changes: ${row.changes.join(', ')}`] : [];
  return [...details, ...row.notes];
}

export default function UploadPage() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [result, setResult] = useState<ConfirmResult | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<'check' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = preview?.rows ?? [];
    return filter === 'all' ? all : all.filter((row) => row.valid === (filter === 'valid'));
  }, [preview, filter]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const summary = preview?.summary;
  const toSave = summary ? summary.create + summary.update : 0;

  function reset() {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setFilter('all');
    setPage(1);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function checkFile(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy('check');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const checked = await api<UploadPreview>('/api/uploads', { method: 'POST', body: form });
      setPreview(checked);
      setFilter(checked.summary && checked.summary.invalid > 0 ? 'invalid' : 'all');
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!preview) return;
    setBusy('save');
    setError(null);
    try {
      setResult(await api<ConfirmResult>(`/api/uploads/${preview.upload.id}/confirm`, { method: 'POST' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  const errorBanner = error && (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {error}
    </p>
  );

  // --- Step 3: saved -------------------------------------------------------
  if (result) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Upload bookings</h1>
        <div className="card space-y-3">
          <h2 className="font-semibold text-emerald-800">Bookings saved</h2>
          <ul className="text-sm text-zinc-700">
            <li>{plural(result.created, 'new booking')} created</li>
            <li>{plural(result.updated, 'booking')} updated</li>
            <li>{plural(result.unchanged, 'booking')} already up to date</li>
            <li>
              {plural(result.passesCreated, 'pass')} created
              {result.passesRemoved > 0 && `, ${plural(result.passesRemoved, 'unused pass')} removed`}
            </li>
          </ul>
          {result.skipped.length > 0 && (
            <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">
                {plural(result.skipped.length, 'row')} could not be saved because the booking changed after the
                preview:
              </p>
              <ul className="mt-1 list-disc pl-5">
                {result.skipped.map((skip) => (
                  <li key={skip.row}>
                    Row {skip.row} ({skip.orderId}): {skip.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Link href="/admin/bookings" className="btn-primary">
              View bookings
            </Link>
            <button type="button" className="btn-secondary" onClick={reset}>
              Upload another file
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Step 1: choose a file -----------------------------------------------
  if (!preview || !summary) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Upload bookings</h1>
        {errorBanner}
        <form onSubmit={checkFile} className="card space-y-4">
          <div>
            <label htmlFor="file" className="mb-1 block text-sm font-medium text-zinc-700">
              Excel or CSV file
            </label>
            <input
              ref={fileInput}
              id="file"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="block w-full text-sm text-zinc-700 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-zinc-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-zinc-900 hover:file:bg-zinc-200"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="mt-1 text-xs text-zinc-500">Up to 5 MB and 10,000 rows. Only the first sheet is read.</p>
          </div>
          <button type="submit" className="btn-primary" disabled={!file || busy !== null}>
            {busy === 'check' ? 'Checking…' : 'Check file'}
          </button>
          <p className="text-sm text-zinc-600">
            Nothing is saved at this step. You will see every row marked valid or invalid first.
          </p>
        </form>

        <div className="card text-sm text-zinc-700">
          <h2 className="font-semibold text-zinc-900">What the file needs</h2>
          <p className="mt-1">The first row must be the column names. Capital letters and extra spaces are fine.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left">
              <thead className="text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-1 pr-4">Column</th>
                  <th className="py-1 pr-4">Required</th>
                  <th className="py-1">Rule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {[
                  ['order_id', 'Yes', 'Unique. Uploading the same order ID again updates that booking.'],
                  ['name', 'Yes', '2 to 80 characters.'],
                  ['phone', 'Yes', '10-digit Indian mobile; +91, 91 or 0 in front is fine. Other countries need + and the country code.'],
                  ['passes', 'Yes', 'Whole number from 1 up to the limit in Settings.'],
                  ['amount', 'No', 'Number, in rupees.'],
                  ['category', 'No', 'Any text, such as General or VIP.'],
                  ['email', 'No', 'A valid email address.'],
                  ['night', 'Multi-night events', 'The night the booking is for, e.g. 17/10/2026, 17 Oct or Sat, 17 Oct 2026 7:00 PM. A column called date or show_date also works.'],
                ].map(([column, required, rule]) => (
                  <tr key={column}>
                    <td className="py-1.5 pr-4 font-mono text-xs">{column}</td>
                    <td className="py-1.5 pr-4">{required}</td>
                    <td className="py-1.5">{rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <a href="/sample-bookings.csv" download className="mt-3 inline-block font-medium text-zinc-900 hover:underline">
            Download a sample file
          </a>
        </div>
      </div>
    );
  }

  // --- Step 2: preview -----------------------------------------------------
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: preview.rows.length },
    { key: 'valid', label: 'Valid', count: preview.upload.validCount },
    { key: 'invalid', label: 'Invalid', count: summary.invalid },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Check before saving</h1>
        <button type="button" className="btn-secondary" onClick={reset} disabled={busy !== null}>
          Choose a different file
        </button>
      </div>
      {errorBanner}

      <div className="card space-y-3">
        <p className="text-sm text-zinc-600">
          <span className="font-medium text-zinc-900">{preview.upload.fileName}</span> ·{' '}
          {plural(preview.upload.rowCount, 'row')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">{plural(summary.create, 'new booking')}</Badge>
          <Badge tone="blue">{plural(summary.update, 'update')}</Badge>
          <Badge tone="slate">{summary.unchanged.toLocaleString('en-IN')} unchanged</Badge>
          <Badge tone={summary.invalid > 0 ? 'red' : 'slate'}>{summary.invalid.toLocaleString('en-IN')} invalid</Badge>
        </div>
        {summary.invalid > 0 && (
          <p className="text-sm text-zinc-700">
            Invalid rows will be skipped. Fix them in your spreadsheet and upload it again; rows already saved
            are simply updated.
          </p>
        )}
        {preview.ignoredColumns.length > 0 && (
          <p className="text-sm text-zinc-500">Ignored columns: {preview.ignoredColumns.join(', ')}</p>
        )}
        <button type="button" className="btn-primary" onClick={save} disabled={toSave === 0 || busy !== null}>
          {busy === 'save' ? 'Saving…' : toSave === 0 ? 'Nothing to save' : `Save ${plural(toSave, 'booking')}`}
        </button>
      </div>

      <div className="card space-y-3 p-0 sm:p-0">
        <div className="flex flex-wrap gap-2 px-4 pt-4" role="tablist" aria-label="Filter rows">
          {filters.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              onClick={() => {
                setFilter(item.key);
                setPage(1);
              }}
              className={`cursor-pointer rounded-full px-3 py-1 text-sm font-medium ${
                filter === item.key ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
              }`}
            >
              {item.label} ({item.count.toLocaleString('en-IN')})
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-y border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Row</th>
                <th className="px-2 py-2">Result</th>
                <th className="px-2 py-2">Problem or change</th>
                <th className="px-2 py-2">Order ID</th>
                <th className="px-2 py-2">Name</th>
                <th className="px-2 py-2">Phone</th>
                <th className="px-2 py-2">Passes</th>
                <th className="px-2 py-2">Amount</th>
                <th className="px-2 py-2">Category</th>
                <th className="px-2 py-2">Night</th>
                <th className="px-4 py-2">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visible.map((row) => {
                const badge = row.valid && row.action ? ACTION_BADGE[row.action] : undefined;
                // Valid rows show the cleaned-up values that will be saved; invalid rows show the file as-is.
                const cells = row.data
                  ? [
                      row.data.orderId,
                      row.data.name,
                      row.data.phone,
                      String(row.data.passCount),
                      row.data.amount ?? '',
                      row.data.category ?? '',
                      row.data.night ? formatNight(row.data.night) : '',
                      row.data.email ?? '',
                    ]
                  : [row.raw.order_id, row.raw.name, row.raw.phone, row.raw.passes, row.raw.amount, row.raw.category, row.raw.night, row.raw.email];
                return (
                  <tr key={row.row} className={row.valid ? '' : 'bg-red-50/40'}>
                    <td className="px-4 py-2 text-zinc-500">{row.row}</td>
                    <td className="px-2 py-2">
                      {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : <Badge tone="red">Invalid</Badge>}
                    </td>
                    <td className={`px-2 py-2 ${row.valid ? 'text-zinc-600' : 'font-medium text-red-700'}`}>
                      {rowDetails(row).map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </td>
                    {cells.map((cell, index) => (
                      <td key={index} className={`max-w-[14rem] truncate py-2 ${index === 6 ? 'px-4' : 'px-2'}`} title={cell}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-zinc-500">
                    No rows to show.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 pb-4 text-sm text-zinc-600">
          <span>
            Page {page} of {pageCount}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <button type="button" className="btn-secondary px-3 py-1.5" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
