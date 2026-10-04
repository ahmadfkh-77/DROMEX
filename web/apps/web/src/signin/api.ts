import type { ApiResult } from './machine.ts';

/**
 * Same-origin JSON requests for the sign-in and account pages. The session
 * and challenge cookies are httpOnly: they travel automatically and are never
 * readable here. Nothing is written to browser storage, and request bodies
 * are never logged. `status: 0` means the request never completed.
 */
async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { status: 0, data: {}, retryAfter: null };
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown> | null;
  return { status: response.status, data: data ?? {}, retryAfter: response.headers.get('retry-after') };
}

export const signInWithPassword = (email: string, password: string) =>
  request('POST', '/api/auth/sign-in/email', { email, password });

export const verifyCode = (code: string) => request('POST', '/api/auth/two-factor/verify-totp', { code });

export const getSession = () => request('GET', '/api/session');

export const signOut = () => request('POST', '/api/auth/sign-out', {});
