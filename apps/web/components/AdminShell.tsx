'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken } from '@/lib/api';
import type { Admin, SessionResponse } from '@/lib/types';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/settings', label: 'Settings' },
];

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
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button className="btn-primary mt-4" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!admin) {
    return (
      <main className="flex min-h-screen items-center justify-center text-sm text-slate-500" aria-busy="true">
        Loading…
      </main>
    );
  }

  return (
    <AdminContext.Provider value={admin}>
      <div className="min-h-screen">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <span className="text-base font-semibold">Event Passes · Admin</span>
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-500 sm:inline">{admin.email}</span>
              <button className="btn-secondary px-3 py-1.5" onClick={signOut} disabled={signingOut}>
                Sign out
              </button>
            </div>
          </div>
          <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2" aria-label="Admin sections">
            {NAV.map((item) => {
              const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                    active
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </div>
    </AdminContext.Provider>
  );
}
