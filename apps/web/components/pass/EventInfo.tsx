import type { ReactNode } from 'react';
import { formatIstTime } from '@/lib/ist';
import type { PublicEvent } from '@/lib/server/passApi';

/** Lower part of a pass page: gate time, instructions, helpline and terms. */
export function EventInfo({ event, shareHint }: { event: PublicEvent; shareHint: boolean }) {
  return (
    <div className="space-y-4">
      <section className="rounded-3xl bg-white p-6 group-data-[over=true]/page:hidden">
        <dl className="grid grid-cols-2 divide-x divide-zinc-100 text-center">
          <div>
            <dt className="text-xs text-zinc-500">Gates open</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{formatIstTime(event.gatesOpenAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Event starts</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{formatIstTime(event.startsAt)}</dd>
          </div>
        </dl>
        <ul className="mt-6 space-y-3 border-t border-zinc-100 pt-5 text-sm text-zinc-600">
          <Tip>Show the QR code on your phone at the entry gate. Each pass admits one person, once.</Tip>
          <Tip>Turn your screen brightness up so the code scans quickly.</Tip>
          {shareHint && <Tip>Coming separately? Use “Share this pass” to send each person their own pass.</Tip>}
          <Tip>This page keeps working without internet once you have opened it.</Tip>
        </ul>
      </section>

      {event.helplineNumber && (
        <a
          href={`tel:${event.helplineNumber.replace(/[^\d+]/g, '')}`}
          className="flex items-center justify-between gap-3 rounded-3xl bg-white px-6 py-4 transition hover:bg-zinc-50"
        >
          <span>
            <span className="block text-xs text-zinc-500">Need help?</span>
            <span className="block text-sm font-semibold text-zinc-900">{event.helplineNumber}</span>
          </span>
          <span className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white">Call</span>
        </a>
      )}

      {event.termsText && (
        <section className="px-2">
          <h2 className="text-xs font-semibold text-zinc-500">Terms</h2>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-zinc-400">{event.termsText}</p>
        </section>
      )}

      <p className="pb-8 pt-2 text-center text-xs text-zinc-400">{event.organiserName}</p>
    </div>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
          clipRule="evenodd"
        />
      </svg>
      <span>{children}</span>
    </li>
  );
}

/** Shown in place of the QR codes once the event has ended. */
export function EventOverBanner() {
  return (
    <div className="hidden rounded-3xl bg-white p-6 text-center group-data-[over=true]/page:block" role="status">
      <p className="text-lg font-semibold text-zinc-900">Event over</p>
      <p className="mt-1 text-sm text-zinc-500">This event has ended. Thank you for coming.</p>
    </div>
  );
}
