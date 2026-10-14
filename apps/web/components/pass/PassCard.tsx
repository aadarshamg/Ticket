import { brandColour, readableTextOn } from '@/lib/colour';
import { formatIstDate, formatIstTime } from '@/lib/ist';
import type { PublicEvent, PublicPass } from '@/lib/server/passApi';
import { QrCode } from './QrCode';

interface Props {
  pass: PublicPass;
  passCount: number;
  event: PublicEvent;
  /** When given, shows "Share this pass", which opens WhatsApp with the single-pass link. */
  shareUrl?: string;
  className?: string;
}

const STATUS = {
  valid: { label: 'Valid', className: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  used: { label: 'Entered', className: 'bg-zinc-100 text-zinc-600 ring-zinc-500/20' },
  cancelled: { label: 'Cancelled', className: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
} as const;

const PILL = 'rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset';

/** One entry pass, drawn as a ticket: event details on the stub, the QR code below the tear line. */
export function PassCard({ pass, passCount, event, shareUrl, className = '' }: Props) {
  const title = `Pass ${pass.passNo} of ${passCount}`;
  const status = STATUS[pass.status];
  const shareText = `Here is your entry pass for ${event.name} (${title}). Open it and show the QR code at the gate: ${shareUrl}`;
  const background = brandColour(event.brandColour);

  return (
    <article
      className={`overflow-hidden rounded-3xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] ${className}`}
      aria-label={title}
    >
      <div className="px-6 pb-6 pt-5" style={{ backgroundColor: background, color: readableTextOn(background) }}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-75">{title}</p>
        <h2 className="mt-2 text-xl font-semibold leading-snug">{event.name}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-wider opacity-70">Date</dt>
            {/* "Sat, 14 Nov 2026": the full weekday would wrap on small phones. */}
            <dd className="mt-0.5 font-medium">{formatIstDate(event.startsAt).replace(/^(\w{3})\w*/, '$1')}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wider opacity-70">Starts</dt>
            <dd className="mt-0.5 font-medium">{formatIstTime(event.startsAt)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[11px] uppercase tracking-wider opacity-70">Venue</dt>
            <dd className="mt-0.5 font-medium">
              {event.venue}, {event.city}
            </dd>
          </div>
        </dl>
      </div>

      {/* The tear line, with a notch cut out of each side. */}
      <div className="relative h-0" aria-hidden="true">
        <span className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-zinc-100" />
        <span className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-zinc-100" />
      </div>

      <div className="px-6 pb-6 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-zinc-500">Entry pass</p>
          {pass.status === 'valid' ? (
            <>
              <span className={`${PILL} group-data-[over=true]/page:hidden ${status.className}`}>{status.label}</span>
              {/* Once the event is over a pass that was never scanned is no longer "valid". */}
              <span className={`${PILL} hidden group-data-[over=true]/page:inline ${STATUS.used.className}`}>Not used</span>
            </>
          ) : (
            <span className={`${PILL} ${status.className}`}>{status.label}</span>
          )}
        </div>

        {pass.qr && (
          // Hidden by PassPageShell once the event is over, including on an offline copy.
          <div className="group-data-[over=true]/page:hidden">
            <div
              className={`mx-auto mt-4 aspect-square w-full max-w-[16rem] overflow-hidden rounded-2xl border border-zinc-100 ${
                pass.status === 'used' ? 'opacity-25' : ''
              }`}
            >
              <QrCode value={pass.qr} label={`QR code for ${title}`} />
            </div>
          </div>
        )}

        <p className="mt-4 text-center text-sm text-zinc-500">
          {pass.status === 'valid' && (
            <>
              <span className="group-data-[over=true]/page:hidden">Admits one person, once. Show this code at the gate.</span>
              <span className="hidden group-data-[over=true]/page:inline">This pass was not used for entry.</span>
            </>
          )}
          {pass.status === 'used' && (
            <span className="font-medium text-zinc-900">
              Entered{pass.usedAt ? ` at ${formatIstTime(pass.usedAt)}` : ''}
              {pass.usedGate ? ` · ${pass.usedGate}` : ''}
            </span>
          )}
          {pass.status === 'cancelled' && 'This pass has been cancelled and will not be accepted at the gate.'}
        </p>

        {shareUrl && pass.status === 'valid' && pass.qr && (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 group-data-[over=true]/page:hidden"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-[#25d366]" fill="currentColor" aria-hidden="true">
              <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2c0 1.3.9 2.5 1 2.7.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.6-.3Z" />
            </svg>
            Share this pass
          </a>
        )}
      </div>
    </article>
  );
}
