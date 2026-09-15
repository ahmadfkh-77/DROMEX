/**
 * The DROMEX security audit writer (DEC-430, DEC-436, DEC-437).
 *
 * The only DROMEX path into `dromex_audit_event`. An event is a fixed,
 * structured shape: an event type from a closed list, an outcome, the acting
 * user and a snapshot of their name, a web recovery reference, a constrained
 * reason code, a revoked-session count, a client address, a terminal recovery
 * run reference, and an incident reference. Anything else — an unknown type,
 * an extra property, a reason that is not a short lower-case identifier, an
 * incident reference that is not `INC-YYYYMMDD-NN` — is refused before a
 * statement is sent, so no caller can pass a password, code, secret, cookie,
 * token, or request body into the audit trail.
 *
 * Errors never include a submitted value, because a refused value may itself
 * be the secret that must not be recorded.
 */

export const SECURITY_AUDIT_EVENT_TYPES = [
  'recovery_code_accepted',
  'recovery_code_rejected',
  'recovery_session_created',
  'other_sessions_revoked',
  'replacement_started',
  'old_factor_disabled',
  'new_totp_rejected',
  'new_totp_verified',
  'replacement_completed',
  'replacement_failed',
  'recovery_expired',
  'recovery_abandoned',
  'recovery_sessions_revoked',
  'terminal_recovery_required',
  // Terminal emergency Owner recovery (DEC-437).
  'terminal_recovery_requested',
  'terminal_identity_verified',
  'terminal_password_rejected',
  'terminal_recovery_concurrent_refused',
  'terminal_stale_recovery_cleared',
  'terminal_recovery_refused',
  'recovery_code_retrieved',
  'owner_emergency_mfa_reset',
  'terminal_replacement_started',
  'terminal_old_factor_removed',
  'terminal_new_totp_rejected',
  'terminal_new_totp_verified',
  'terminal_recovery_codes_issued',
  'terminal_sessions_revoked',
  'terminal_recovery_completed',
  'terminal_recovery_failed',
  'terminal_recovery_abandoned',
] as const;

export type SecurityAuditEventType = (typeof SECURITY_AUDIT_EVENT_TYPES)[number];
export type SecurityAuditOutcome = 'success' | 'failure';

export interface SecurityAuditActor {
  userId: string;
  name: string;
}

export interface SecurityAuditEvent {
  type: SecurityAuditEventType;
  outcome: SecurityAuditOutcome;
  actor: SecurityAuditActor | null;
  /** The web recovery's database identifier, as a decimal string. */
  recoveryId: string | null;
  /** A short lower-case identifier such as `invalid_code`, never free text. */
  reason: string | null;
  revokedSessionCount: number | null;
  clientAddress: string | null;
  /** The terminal recovery run's database identifier, as a decimal string. */
  terminalRecoveryId: string | null;
  /** The operator's dated incident reference, `INC-YYYYMMDD-NN`. */
  incidentReference: string | null;
}

/** Anything that runs a parameterised statement: a pool or a client in a transaction. */
export interface Queryable {
  query(text: string, values: unknown[]): Promise<unknown>;
}

export interface SecurityAudit {
  /** Writes one event, through `db` when given so it joins that transaction. Throws on any refusal or failure. */
  record(event: SecurityAuditEvent, db?: Queryable): Promise<void>;
}

export class SecurityAuditValidationError extends Error {
  constructor(field: string) {
    super(`Security audit event refused: invalid ${field}. The value itself is not shown.`);
    this.name = 'SecurityAuditValidationError';
  }
}

/** Sorted, because the shape check compares sorted keys. */
const EVENT_KEYS = [
  'actor',
  'clientAddress',
  'incidentReference',
  'outcome',
  'reason',
  'recoveryId',
  'revokedSessionCount',
  'terminalRecoveryId',
  'type',
];
const ACTOR_KEYS = ['name', 'userId'];
const EVENT_TYPES = new Set<string>(SECURITY_AUDIT_EVENT_TYPES);
const OUTCOMES = new Set<string>(['success', 'failure']);
const REASON = /^[a-z][a-z_]{0,63}$/;
const DATABASE_ID = /^[1-9][0-9]{0,18}$/;
const CLIENT_ADDRESS = /^[0-9A-Fa-f:.]{1,45}$/;
const INCIDENT_REFERENCE = /^INC-[0-9]{8}-[0-9]{2}$/;
const MAX_NAME_LENGTH = 200;
const MAX_USER_ID_LENGTH = 255;

const INSERT = `
  INSERT INTO dromex_audit_event
    (event_type, outcome, actor_user_id, actor_name, recovery_id, reason, revoked_session_count, client_address,
     terminal_recovery_id, incident_reference)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function nullableMatch(value: unknown, pattern: RegExp): boolean {
  return value === null || (typeof value === 'string' && pattern.test(value));
}

/** The ten statement values, in column order, or a thrown refusal. */
function valuesOf(event: unknown): unknown[] {
  if (!isPlainObject(event) || !hasExactly(event, EVENT_KEYS)) throw new SecurityAuditValidationError('event shape');

  const { type, outcome, actor, recoveryId, reason, revokedSessionCount, clientAddress, terminalRecoveryId, incidentReference } =
    event;

  if (typeof type !== 'string' || !EVENT_TYPES.has(type)) throw new SecurityAuditValidationError('event type');
  if (typeof outcome !== 'string' || !OUTCOMES.has(outcome)) throw new SecurityAuditValidationError('outcome');

  let actorUserId: string | null = null;
  let actorName: string | null = null;
  if (actor !== null) {
    if (!isPlainObject(actor) || !hasExactly(actor, ACTOR_KEYS)) throw new SecurityAuditValidationError('actor');
    const { userId, name } = actor;
    if (typeof userId !== 'string' || userId.length === 0 || userId.length > MAX_USER_ID_LENGTH) {
      throw new SecurityAuditValidationError('actor');
    }
    if (typeof name !== 'string' || name.length > MAX_NAME_LENGTH) throw new SecurityAuditValidationError('actor');
    actorUserId = userId;
    actorName = name === '' ? null : name;
  }

  if (!nullableMatch(recoveryId, DATABASE_ID)) throw new SecurityAuditValidationError('recovery reference');
  if (!nullableMatch(reason, REASON)) throw new SecurityAuditValidationError('reason');
  if (
    revokedSessionCount !== null &&
    (typeof revokedSessionCount !== 'number' || !Number.isSafeInteger(revokedSessionCount) || revokedSessionCount < 0)
  ) {
    throw new SecurityAuditValidationError('revoked session count');
  }
  if (!nullableMatch(clientAddress, CLIENT_ADDRESS)) throw new SecurityAuditValidationError('client address');
  if (!nullableMatch(terminalRecoveryId, DATABASE_ID)) {
    throw new SecurityAuditValidationError('terminal recovery reference');
  }
  if (!nullableMatch(incidentReference, INCIDENT_REFERENCE)) throw new SecurityAuditValidationError('incident reference');

  return [
    type,
    outcome,
    actorUserId,
    actorName,
    recoveryId,
    reason,
    revokedSessionCount,
    clientAddress,
    terminalRecoveryId,
    incidentReference,
  ];
}

/** Builds a structured event with every optional field explicitly null. */
export function securityEvent(
  type: SecurityAuditEventType,
  outcome: SecurityAuditOutcome,
  actor: SecurityAuditActor | null,
  recoveryId: string | null,
  clientAddress: string | null,
  extra: {
    reason?: string | null;
    revokedSessionCount?: number | null;
    terminalRecoveryId?: string | null;
    incidentReference?: string | null;
  } = {},
): SecurityAuditEvent {
  return {
    type,
    outcome,
    actor: actor === null ? null : { userId: actor.userId, name: actor.name },
    recoveryId,
    reason: extra.reason ?? null,
    revokedSessionCount: extra.revokedSessionCount ?? null,
    clientAddress,
    terminalRecoveryId: extra.terminalRecoveryId ?? null,
    incidentReference: extra.incidentReference ?? null,
  };
}

export function createSecurityAudit(pool: Queryable): SecurityAudit {
  return {
    async record(event, db = pool) {
      const values = valuesOf(event);
      await db.query(INSERT, values);
    },
  };
}
