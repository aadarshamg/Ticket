import type { PublicEvent } from '@/lib/server/passApi';

/** Top of a pass page: the organiser's logo, or their name. The event details are on each pass. */
export function EventHeader({ event }: { event: PublicEvent }) {
  return (
    <header className="flex justify-center px-5 pb-4 pt-6">
      {event.logoUrl ? (
        // A plain <img>: the logo is on the organiser's own host, and must not receive this page's secret URL.
        <img src={event.logoUrl} alt={event.organiserName} referrerPolicy="no-referrer" className="max-h-10 max-w-[50%] object-contain" />
      ) : (
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">{event.organiserName}</p>
      )}
    </header>
  );
}
