export interface FieldError {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Held in memory only; re-fetched from /api/auth/me after a page reload.
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
}

/** Calls the API on this origin. Throws ApiError for any non-2xx response. */
export async function api<T>(path: string, { method = 'GET', body }: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach the server. Check your connection and try again.');
  }

  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: FieldError[] } } | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? 'error',
      error?.message ?? `Request failed (${res.status})`,
      error?.details ?? [],
    );
  }
  return data as T;
}
