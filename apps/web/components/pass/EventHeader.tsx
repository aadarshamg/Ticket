import { brandColour, readableTextOn } from '@/lib/colour';
import { formatIstDate, formatIstTime } from '@/lib/ist';
import type { PublicEvent } from '@/lib/server/passApi';

/** Branded top of a pass page: logo, event name, venue, date and time. */
export function EventHeader({ event }: { event: PublicEvent }) {
  const background = brandColour(event.brandColour);
  return (
    <header className="px-5 pb-10 pt-6 text-center" style={{ backgroundColor: background, color: readableTextOn(background) }}>
      {event.logoUrl && (
        // A plain <img>: the logo is on the organiser's own host, and must not receive this page's secret URL.
        <img
          src={event.logoUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="mx-auto mb-3 max-h-14 max-w-[60%] object-contain"
        />
      )}
      <h1 className="text-xl font-bold leading-tight">{event.name}</h1>
      <p className="mt-1 text-sm opacity-90">
        {event.venue}, {event.city}
      </p>
      <p className="mt-1 text-sm font-medium">
        {formatIstDate(event.startsAt)} · {formatIstTime(event.startsAt)}
      </p>
    </header>
  );
}
