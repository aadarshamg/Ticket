import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

// Lets volunteers install the scanner on their phone's home screen, where it opens full screen
// like an app (Android: "Install app"; iPhone: Share > Add to Home Screen). It is still this
// same page, so there is nothing to send round when it changes.
export const metadata: Metadata = {
  title: 'Gate Scanner',
  manifest: '/scan.webmanifest',
  appleWebApp: { capable: true, title: 'Scanner', statusBarStyle: 'black-translucent' },
  icons: { apple: '/scanner-apple-180.png' },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
};

export default function ScanLayout({ children }: { children: ReactNode }) {
  return children;
}
