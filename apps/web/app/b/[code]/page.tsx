import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventHeader } from '@/components/pass/EventHeader';
import { EventInfo, EventOverBanner } from '@/components/pass/EventInfo';
import { PassCard } from '@/components/pass/PassCard';
import { PassPageShell } from '@/components/pass/PassPageShell';
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
      <main className="mx-auto -mt-6 max-w-md space-y-4 px-4">
        <div className="rounded-2xl bg-white p-4 text-center shadow-md">
          <p className="text-base font-semibold text-slate-900">Hi {booking.firstName}</p>
          <p className="mt-1 text-sm text-slate-600">
            Order {booking.orderId} · {plural(booking.passCount, 'pass')}
            {booking.category ? ` · ${booking.category}` : ''}
          </p>
          {!cancelled && (
            <p className="mt-1 text-sm font-medium text-slate-800">
              {booking.usedCount} entered
              <span className="group-data-[over=true]/page:hidden">, {toCome} to come</span>
            </p>
          )}
        </div>

        {cancelled && (
          <div className="rounded-2xl bg-amber-50 p-4 text-center text-sm font-medium text-amber-900 shadow-sm" role="status">
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
              eventName={event.name}
              shareUrl={pass.shareUrl}
              className={`shrink-0 snap-center ${passes.length > 1 ? 'w-[88%]' : 'w-full'}`}
            />
          ))}
        </div>
        {passes.length > 1 && (
          <p className="text-center text-xs text-slate-500">Swipe sideways to see all {passes.length} passes</p>
        )}

        <EventInfo event={event} shareHint={passes.length > 1 && !cancelled} />
      </main>
    </PassPageShell>
  );
}
