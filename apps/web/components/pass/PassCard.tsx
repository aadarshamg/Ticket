import { formatIstTime } from '@/lib/ist';
import type { PublicPass } from '@/lib/server/passApi';
import { QrCode } from './QrCode';

interface Props {
  pass: PublicPass;
  passCount: number;
  eventName: string;
  /** When given, shows "Share this pass", which opens WhatsApp with the single-pass link. */
  shareUrl?: string;
  className?: string;
}

const STATUS = {
  valid: { label: 'Valid', className: 'bg-emerald-100 text-emerald-800' },
  used: { label: 'Entered', className: 'bg-slate-200 text-slate-700' },
  cancelled: { label: 'Cancelled', className: 'bg-amber-100 text-amber-900' },
} as const;

export function PassCard({ pass, passCount, eventName, shareUrl, className = '' }: Props) {
  const title = `Pass ${pass.passNo} of ${passCount}`;
  const status = STATUS[pass.status];
  const shareText = `Here is your entry pass for ${eventName} (${title}). Open it and show the QR code at the gate: ${shareUrl}`;

  return (
    <article className={`rounded-2xl bg-white p-5 shadow-md ${className}`} aria-label={title}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {pass.status === 'valid' ? (
          <>
            <span className={`rounded-full px-3 py-1 text-sm font-semibold group-data-[over=true]/page:hidden ${status.className}`}>
              {status.label}
            </span>
            {/* Once the event is over a pass that was never scanned is no longer "valid". */}
            <span className="hidden rounded-full bg-slate-200 px-3 py-1 text-sm font-semibold text-slate-700 group-data-[over=true]/page:inline">
              Not used
            </span>
          </>
        ) : (
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${status.className}`}>{status.label}</span>
        )}
      </div>

      {pass.qr && (
        // Hidden by PassPageShell once the event is over, including on an offline copy.
        <div className="group-data-[over=true]/page:hidden">
          <div
            className={`mx-auto mt-4 aspect-square w-full max-w-[17rem] overflow-hidden rounded-xl border border-slate-200 ${
              pass.status === 'used' ? 'opacity-30' : ''
            }`}
          >
            <QrCode value={pass.qr} label={`QR code for ${title}`} />
          </div>
        </div>
      )}

      <p className="mt-4 text-center text-sm text-slate-700">
        {pass.status === 'valid' && (
          <>
            <span className="group-data-[over=true]/page:hidden">Admits one person, once. Show this code at the gate.</span>
            <span className="hidden group-data-[over=true]/page:inline">This pass was not used for entry.</span>
          </>
        )}
        {pass.status === 'used' && (
          <span className="font-semibold text-slate-900">
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
          className="mt-4 flex w-full items-center justify-center rounded-xl bg-[#128c7e] px-4 py-3 text-base font-semibold text-white hover:bg-[#0e7469] focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 group-data-[over=true]/page:hidden"
        >
          Share this pass
        </a>
      )}
    </article>
  );
}
