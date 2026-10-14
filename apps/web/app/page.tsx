import type { Metadata } from 'next';
import { BrandMark } from '@/components/AdminShell';

export const metadata: Metadata = {
  title: 'Event passes',
};

// The bare address is what people type or share by mistake. Guests need their own link from
// WhatsApp, and organisers go to /admin; this page sends neither to the admin sign-in.
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center">
        <span className="inline-flex">
          <BrandMark />
        </span>
        <h1 className="mt-5 text-2xl font-semibold text-zinc-900">Your event passes</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500">
          Open the WhatsApp message you received for your booking and tap <strong className="text-zinc-900">View Passes</strong>.
          Your QR codes open straight away, with no sign-in.
        </p>
        <p className="mt-6 border-t border-zinc-100 pt-5 text-xs text-zinc-400">
          Can&apos;t find the message? Contact the event helpline.
        </p>
      </div>
    </main>
  );
}
