import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EventHeader } from '@/components/pass/EventHeader';
import { EventInfo, EventOverBanner } from '@/components/pass/EventInfo';
import { PassCard } from '@/components/pass/PassCard';
import { PassPageShell } from '@/components/pass/PassPageShell';
import { fetchPass } from '@/lib/server/passApi';

// Single-pass page, for a group member the buyer forwarded one pass to.
// It must never show the buyer's phone, the other passes, or a link to the booking;
// the API it reads from does not return any of those.

export const metadata: Metadata = {
  title: 'Your entry pass',
  referrer: 'no-referrer',
};

export default async function PassPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const view = await fetchPass(code);
  if (!view) notFound();

  const { event, pass } = view;
  return (
    <PassPageShell endsAt={event.endsAt} initialOver={event.over}>
      <EventHeader event={event} />
      <main className="mx-auto max-w-md space-y-4 px-4">
        <div className="px-2 pb-2 text-center">
          <h1 className="text-2xl font-semibold text-zinc-900">Your entry pass</h1>
          {pass.category && <p className="mt-1 text-sm text-zinc-500">{pass.category}</p>}
        </div>
        <EventOverBanner />
        <PassCard pass={pass} passCount={pass.passCount} event={event} />
        <EventInfo event={event} shareHint={false} />
      </main>
    </PassPageShell>
  );
}
