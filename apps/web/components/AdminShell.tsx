'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken } from '@/lib/api';
import type { Admin, SessionResponse } from '@/lib/types';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/upload', label: 'Upload' },
  { href: '/admin/bookings', label: 'Bookings' },
  { href: '/admin/send', label: 'Send' },
  { href: '/admin/conflicts', label: 'Conflicts' },
  { href: '/admin/audit', label: 'Activity' },
  { href: '/admin/settings', label: 'Settings' },
];

function NavLinks({ pathname }: { pathname: string }) {
  return NAV.map((item) => {
    const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition ${
          active ? 'bg-zinc-900 text-white md:bg-white md:text-zinc-900 md:shadow-sm' : 'text-zinc-500 hover:text-zinc-900'
        }`}
      >
        {item.label}
      </Link>
    );
  });
}

/** A small ticket glyph, used as the dashboard's logo. */
export function BrandMark() {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-900 text-white" aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4Z" />
        <path d="M13 6v2M13 11v2M13 16v2" />
      </svg>
    </span>
  );
}

const AdminContext = createContext<Admin | null>(null);

export function useAdmin(): Admin {
  const admin = useContext(AdminContext);
  if (!admin) throw new Error('useAdmin must be used inside AdminShell');
  return admin;
}

/** Guards the admin area: loads the session, redirects to sign-in when there is none. */
export function AdminShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<SessionResponse>('/api/auth/me')
      .then((session) => {
        if (cancelled) return;
        setCsrfToken(session.csrfToken);
        setAdmin(session.admin);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace('/admin/login');
        } else {
          setError(err instanceof Error ? err.message : 'Something went wrong');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function signOut() {
    setSigningOut(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the call fails, send the user to the sign-in page.
    }
    setCsrfToken(null);
    router.replace('/admin/login');
  }

  if (error) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="card">
          <h1 className="text-lg font-semibold">Cannot load the dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600">{error}</p>
          <button className="btn-primary mt-4" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!admin) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-zinc-500" aria-busy="true">
        Loading…
      </main>
    );
  }

  return (
    <AdminContext.Provider value={admin}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-zinc-200/80 bg-white/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pt-3 sm:py-3">
            <Link href="/admin" className="flex items-center gap-2.5">
              <BrandMark />
              <span className="text-sm font-semibold tracking-tight">Event Passes</span>
            </Link>
            <nav className="hidden items-center gap-0.5 rounded-full bg-zinc-100 p-1 md:flex" aria-label="Admin sections">
              <NavLinks pathname={pathname} />
            </nav>
            <div className="flex items-center gap-3">
              <span className="hidden text-xs text-zinc-500 lg:inline">{admin.email}</span>
              <button className="btn-secondary px-3 py-1.5 text-xs" onClick={signOut} disabled={signingOut}>
                Sign out
              </button>
            </div>
          </div>
          <nav className="mx-auto flex max-w-5xl gap-0.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] md:hidden" aria-label="Admin sections">
            <NavLinks pathname={pathname} />
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}
