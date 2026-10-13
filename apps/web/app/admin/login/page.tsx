'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Field } from '@/components/Field';
import { api, ApiError, setCsrfToken } from '@/lib/api';
import type { SessionResponse } from '@/lib/types';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in? Go straight to the dashboard.
  useEffect(() => {
    api<SessionResponse>('/api/auth/me')
      .then(() => router.replace('/admin'))
      .catch(() => undefined);
  }, [router]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await api<SessionResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setCsrfToken(session.csrfToken);
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof ApiError ? (err.details[0]?.message ?? err.message) : 'Something went wrong');
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4" noValidate>
        <div>
          <h1 className="text-xl font-semibold">Organiser sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Event Passes admin dashboard</p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}

        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            className="input"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        <button type="submit" className="btn-primary w-full" disabled={busy || !email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
