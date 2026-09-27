/**
 * Same-origin JSON POSTs for the password-reset pages. `status: 0` means the
 * request never completed (offline, DNS, reset connection), which the pages
 * show as a network error and let the user retry without losing the token.
 */
export async function postJson(path: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, data: {} };
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data };
}
