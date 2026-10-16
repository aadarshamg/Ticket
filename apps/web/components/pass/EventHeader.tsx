import type { PublicEvent } from '@/lib/server/passApi';

/**
 * The organiser's and the event's logos, shown side by side ("TSP Events × Garba Ni Ratri").
 * They are files on this site (public/brand), small and saved with the page for offline use:
 * a logo on another site loaded slowly on mobile data and was missing from offline copies.
 */
const BRAND = {
  organiser: { src: '/brand/tsp-events.jpg', width: 240, height: 240 },
  event: { src: '/brand/garba-ni-ratri.jpg', width: 360, height: 240 },
};

/** Top of a pass page: the logos. The event details are on each pass. */
export function EventHeader({ event }: { event: PublicEvent }) {
  return (
    <header className="flex items-center justify-center gap-3 px-5 pb-4 pt-6">
      {/* eslint-disable @next/next/no-img-element -- small static logos, already sized */}
      <img
        src={BRAND.organiser.src}
        width={BRAND.organiser.width}
        height={BRAND.organiser.height}
        alt={event.organiserName}
        fetchPriority="high"
        className="h-20 w-20 rounded-2xl bg-white object-contain shadow-sm ring-1 ring-black/5"
      />
      <span className="text-lg font-light text-zinc-400" aria-hidden="true">
        ×
      </span>
      <img
        src={BRAND.event.src}
        width={BRAND.event.width}
        height={BRAND.event.height}
        alt={event.name}
        fetchPriority="high"
        className="h-20 w-[120px] rounded-2xl object-cover shadow-sm ring-1 ring-black/5"
      />
      {/* eslint-enable @next/next/no-img-element */}
    </header>
  );
}
