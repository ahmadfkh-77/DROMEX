/**
 * Same-origin JSON requests for Owner account management (checkpoint 4E).
 * The session cookie travels automatically and is never readable here;
 * nothing is written to browser storage. `status: 0` means the request never
 * completed (offline, DNS, reset connection).
 */

export interface ApiResult {
  status: number;
  data: Record<string, unknown>;
}

async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) } : {}),
    });
  } catch {
    return { status: 0, data: {} };
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: response.status, data: typeof data === 'object' && data !== null ? data : {} };
}

export const getJson = (path: string) => request('GET', path);
export const postJson = (path: string, body?: unknown) => request('POST', path, body);

/** A Better Auth identifier as the API accepts it in a path. */
export const USER_ID = /^[A-Za-z0-9_-]{1,100}$/;

export const accountPath = (userId: string) => `/api/owner/accounts/${encodeURIComponent(userId)}`;

// ---------------------------------------------------------------------------
// The shapes the API returns. Anything missing or malformed is treated as an
// unexpected response rather than trusted.
// ---------------------------------------------------------------------------

export type AccountState =
  | 'active'
  | 'disabled'
  | 'enrolment_in_progress'
  | 'invitation_pending'
  | 'invitation_expired'
  | 'invitation_cancelled';

export type DeliveryStatus = 'sending' | 'provider_accepted' | 'failed' | 'not_sent';

export interface InvitationSnapshot {
  id: string;
  status: 'pending' | 'accepted' | 'superseded' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  delivery: { status: DeliveryStatus; reason: string | null };
}

export interface AccountSummary {
  userId: string;
  name: string;
  email: string;
  state: AccountState;
  activeSessions: number | null;
  invitation: InvitationSnapshot | null;
}

export interface InvitationEntry {
  invitationId: string;
  email: string;
  state: AccountState;
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  delivery: { status: DeliveryStatus; reason: string | null };
}

export interface ActionAvailability {
  available: boolean;
  reason: 'account_not_active' | 'account_not_disabled' | null;
}

export interface AccountDetail {
  userId: string;
  name: string;
  email: string;
  state: AccountState;
  identityCreatedAt: string;
  setupCompletedAt: string | null;
  invitation: InvitationSnapshot | null;
  lastStatusChange: { action: 'disabled' | 'enabled'; reason: string; changedAt: string; changedByName: string } | null;
  sessions: Array<{ ref: string; signedInAt: string; expiresAt: string }>;
  actions: { disable: ActionAvailability; enable: ActionAvailability; revokeAllSessions: ActionAvailability };
}

export function isAccountDetail(value: unknown): value is AccountDetail {
  const detail = value as AccountDetail | null;
  return (
    typeof detail === 'object' &&
    detail !== null &&
    typeof detail.userId === 'string' &&
    typeof detail.name === 'string' &&
    typeof detail.email === 'string' &&
    typeof detail.state === 'string' &&
    Array.isArray(detail.sessions) &&
    typeof detail.actions === 'object' &&
    detail.actions !== null
  );
}

export function isAccountList(value: Record<string, unknown>): value is { accounts: AccountSummary[]; invitations: InvitationEntry[] } {
  return Array.isArray(value.accounts) && Array.isArray(value.invitations);
}
