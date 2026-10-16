import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventHeader } from '@/components/pass/EventHeader';
import { EventInfo, EventOverBanner } from '@/components/pass/EventInfo';
import { PassCard } from '@/components/pass/PassCard';
import { PassPageShell } from '@/components/pass/PassPageShell';
import { Sponsors } from '@/components/pass/Sponsors';
import { fetchBooking } from '@/lib/server/passApi';

// Booking page: every pass in one booking. The secret code in the URL is the only credential.

export const metadata: Metadata = {
  title: 'Your passes',
  referrer: 'no-referrer', // never leak the secret URL to other sites
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 'es'}`;

export default async function BookingPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = await fetchBooking(code);
  if (!view) notFound();

  const { event, booking, passes } = view;
  const toCome = passes.filter((pass) => pass.status === 'valid').length;
  const cancelled = booking.status === 'cancelled';

  return (
    <PassPageShell endsAt={event.endsAt} initialOver={event.over}>
      <EventHeader event={event} />
      <main className="mx-auto max-w-md space-y-4 px-4">
        <div className="px-2 pb-2 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900">Hi {booking.firstName}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {plural(booking.passCount, 'pass')}
            {booking.category ? ` · ${booking.category}` : ''} · Order {booking.orderId}
          </p>
          {!cancelled && (
            <p className="mt-3 inline-flex rounded-full bg-white px-3 py-1 text-xs font-medium text-zinc-700 ring-1 ring-zinc-200">
              {booking.usedCount} entered
              <span className="group-data-[over=true]/page:hidden">&nbsp;· {toCome} to come</span>
            </p>
          )}
        </div>

        {cancelled && (
          <div className="rounded-3xl bg-amber-50 p-4 text-center text-sm font-medium text-amber-900" role="status">
            This booking has been cancelled. Its passes will not be accepted at the gate.
          </div>
        )}

        <EventOverBanner />

        {/* Swipeable on phones: one pass per "page", snapping into place. */}
        <div
          className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [scrollbar-width:none]"
          aria-label="Your passes"
        >
          {passes.map((pass) => (
            <PassCard
              key={pass.passNo}
              pass={pass}
              passCount={booking.passCount}
              event={event}
              shareUrl={pass.shareUrl}
              className={`shrink-0 snap-center ${passes.length > 1 ? 'w-[86%]' : 'w-full'}`}
            />
          ))}
        </div>
        {passes.length > 1 && (
          <p className="text-center text-xs text-zinc-500">Swipe sideways to see all {passes.length} passes</p>
        )}

        <Sponsors />

        <EventInfo event={event} shareHint={passes.length > 1 && !cancelled} />
      </main>
    </PassPageShell>
  );
}
