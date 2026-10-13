import { formatIstTime } from '@/lib/ist';
import type { PublicEvent } from '@/lib/server/passApi';

/** Lower part of a pass page: gate time, instructions, helpline and terms. */
export function EventInfo({ event, shareHint }: { event: PublicEvent; shareHint: boolean }) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-white p-5 shadow-sm group-data-[over=true]/page:hidden">
        <h2 className="font-semibold text-slate-900">At the gate</h2>
        <p className="mt-2 text-sm text-slate-700">
          Gates open at <strong>{formatIstTime(event.gatesOpenAt)}</strong>. The event starts at{' '}
          <strong>{formatIstTime(event.startsAt)}</strong>.
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Show the QR code on your phone at the entry gate.</li>
          <li>Each pass admits one person, once.</li>
          <li>Turn your screen brightness up so the code scans quickly.</li>
          {shareHint && <li>Coming separately? Use “Share this pass” to send each person their own pass.</li>}
          <li>This page keeps working without internet once you have opened it.</li>
        </ul>
      </section>

      {event.helplineNumber && (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Need help?</h2>
          <p className="mt-2 text-sm text-slate-700">
            Call the helpline:{' '}
            <a href={`tel:${event.helplineNumber.replace(/[^\d+]/g, '')}`} className="font-semibold text-indigo-700 underline">
              {event.helplineNumber}
            </a>
          </p>
        </section>
      )}

      {event.termsText && (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-slate-900">Terms</h2>
          <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-slate-600">{event.termsText}</p>
        </section>
      )}

      <p className="pb-6 text-center text-xs text-slate-500">{event.organiserName}</p>
    </div>
  );
}

/** Shown in place of the QR codes once the event has ended. */
export function EventOverBanner() {
  return (
    <div className="hidden rounded-2xl bg-white p-5 text-center shadow-md group-data-[over=true]/page:block" role="status">
      <p className="text-lg font-bold text-slate-900">Event over</p>
      <p className="mt-1 text-sm text-slate-600">This event has ended. Thank you for coming.</p>
    </div>
  );
}
