import { describe, expect, it } from 'vitest';

import {
  SECURITY_AUDIT_EVENT_TYPES,
  createSecurityAudit,
  type SecurityAuditEvent,
} from '../../src/auth/security-audit.ts';

// The audit writer is the only DROMEX path into dromex_audit_event. These
// tests prove it refuses anything outside its structured shape before any
// statement reaches the database, so a caller cannot smuggle a secret into
// the audit trail by passing an extra property or an unconstrained string.

function recordingDatabase() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  return {
    statements,
    db: {
      async query(text: string, values: unknown[]) {
        statements.push({ text, values });
        return { rows: [], rowCount: 1 };
      },
    },
  };
}

const VALID: SecurityAuditEvent = {
  type: 'other_sessions_revoked',
  outcome: 'success',
  actor: { userId: 'user_synthetic', name: 'Synthetic Owner' },
  recoveryId: '42',
  reason: null,
  revokedSessionCount: 2,
  clientAddress: '198.51.100.7',
  terminalRecoveryId: null,
  incidentReference: null,
  invitationId: null,
  passwordResetId: null,
  targetUserId: null,
  accountChangeId: null,
};

describe('security audit writer', () => {
  it('writes one parameterised insert carrying exactly the structured fields', async () => {
    const { db, statements } = recordingDatabase();

    await createSecurityAudit(db).record(VALID);

    expect(statements).toHaveLength(1);
    expect(statements[0]!.text).toMatch(/^\s*INSERT INTO dromex_audit_event\b/);
    expect(statements[0]!.text).not.toContain('Synthetic Owner');
    expect(statements[0]!.text).not.toContain('198.51.100.7');
    expect(statements[0]!.values).toEqual([
      'other_sessions_revoked',
      'success',
      'user_synthetic',
      'Synthetic Owner',
      '42',
      null,
      2,
      '198.51.100.7',
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('writes a terminal recovery event with its run reference and incident reference', async () => {
    const { db, statements } = recordingDatabase();

    await createSecurityAudit(db).record({
      type: 'owner_emergency_mfa_reset',
      outcome: 'success',
      actor: { userId: 'user_synthetic', name: 'Synthetic Owner' },
      recoveryId: null,
      reason: null,
      revokedSessionCount: null,
      clientAddress: null,
      terminalRecoveryId: '7',
      incidentReference: 'INC-20260915-01',
      invitationId: null,
      passwordResetId: null,
      targetUserId: null,
      accountChangeId: null,
    });

    expect(statements[0]!.values).toEqual([
      'owner_emergency_mfa_reset',
      'success',
      'user_synthetic',
      'Synthetic Owner',
      null,
      null,
      null,
      null,
      '7',
      'INC-20260915-01',
      null,
      null,
      null,
      null,
    ]);
  });

  it('writes an event with no known actor as nulls', async () => {
    const { db, statements } = recordingDatabase();

    await createSecurityAudit(db).record({
      type: 'recovery_code_rejected',
      outcome: 'failure',
      actor: null,
      recoveryId: null,
      reason: 'invalid_code',
      revokedSessionCount: null,
      clientAddress: null,
      terminalRecoveryId: null,
      incidentReference: null,
      invitationId: null,
      passwordResetId: null,
      targetUserId: null,
      accountChangeId: null,
    });

    expect(statements[0]!.values).toEqual([
      'recovery_code_rejected',
      'failure',
      null,
      null,
      null,
      'invalid_code',
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('writes an Admin invitation event with its invitation reference and no address', async () => {
    const { db, statements } = recordingDatabase();

    await createSecurityAudit(db).record({
      type: 'admin_invitation_delivery_failed',
      outcome: 'failure',
      actor: { userId: 'user_synthetic', name: 'Synthetic Owner' },
      recoveryId: null,
      reason: 'provider_unavailable',
      revokedSessionCount: null,
      clientAddress: '198.51.100.7',
      terminalRecoveryId: null,
      incidentReference: null,
      invitationId: '12',
      passwordResetId: null,
      targetUserId: null,
      accountChangeId: null,
    });

    expect(statements[0]!.text).toContain('invitation_id');
    expect(statements[0]!.values).toEqual([
      'admin_invitation_delivery_failed',
      'failure',
      'user_synthetic',
      'Synthetic Owner',
      null,
      'provider_unavailable',
      null,
      '198.51.100.7',
      null,
      null,
      '12',
      null,
      null,
      null,
    ]);
  });

  it('writes a password-reset event with its reset reference and no address, token, or hash', async () => {
    const { db, statements } = recordingDatabase();

    await createSecurityAudit(db).record({
      type: 'password_reset_sessions_revoked',
      outcome: 'success',
      actor: { userId: 'user_synthetic', name: 'Synthetic Admin' },
      recoveryId: null,
      reason: null,
      revokedSessionCount: 3,
      clientAddress: '198.51.100.7',
      terminalRecoveryId: null,
      incidentReference: null,
      invitationId: null,
      passwordResetId: '9',
      targetUserId: null,
      accountChangeId: null,
    });

    expect(statements[0]!.text).toContain('password_reset_id');
    expect(statements[0]!.values).toEqual([
      'password_reset_sessions_revoked',
      'success',
      'user_synthetic',
      'Synthetic Admin',
      null,
      null,
      3,
      '198.51.100.7',
      null,
      null,
      null,
      '9',
      null,
      null,
    ]);
  });

  it('writes an account-management event with its target and status-change reference, and nothing else', async () => {
    const { db, statements } = recordingDatabase();

    await createSecurityAudit(db).record({
      type: 'admin_account_disabled',
      outcome: 'success',
      actor: { userId: 'user_owner', name: 'Synthetic Owner' },
      recoveryId: null,
      reason: null,
      revokedSessionCount: 2,
      clientAddress: '198.51.100.7',
      terminalRecoveryId: null,
      incidentReference: null,
      invitationId: null,
      passwordResetId: null,
      targetUserId: 'user_admin',
      accountChangeId: '5',
    });

    expect(statements[0]!.text).toContain('target_user_id');
    expect(statements[0]!.text).toContain('account_change_id');
    expect(statements[0]!.values).toEqual([
      'admin_account_disabled',
      'success',
      'user_owner',
      'Synthetic Owner',
      null,
      null,
      2,
      '198.51.100.7',
      null,
      null,
      null,
      null,
      'user_admin',
      '5',
    ]);
  });

  it('accepts exactly the closed account-management event vocabulary', () => {
    expect(
      SECURITY_AUDIT_EVENT_TYPES.filter((type) => type.startsWith('admin_account_') || type.startsWith('owner_route_')),
    ).toEqual([
      'admin_account_disabled',
      'admin_account_enabled',
      'admin_account_sessions_revoked',
      'admin_account_session_revoked',
      'admin_account_session_cleanup_incomplete',
      'admin_account_action_refused',
      'owner_route_refused',
    ]);
  });

  it('accepts exactly the closed password-reset event vocabulary', () => {
    expect(SECURITY_AUDIT_EVENT_TYPES.filter((type) => type.startsWith('password_'))).toEqual([
      'password_reset_requested',
      'password_reset_request_suppressed',
      'password_reset_superseded',
      'password_reset_expired',
      'password_reset_delivery_accepted',
      'password_reset_delivery_failed',
      'password_reset_rejected',
      'password_reset_claimed',
      'password_reset_failed',
      'password_reset_sessions_revoked',
      'password_reset_session_revocation_incomplete',
      'password_reset_completed',
      'password_changed_notification_accepted',
      'password_changed_notification_failed',
    ]);
  });

  it('accepts exactly the closed Admin invitation event vocabulary', () => {
    expect(SECURITY_AUDIT_EVENT_TYPES.filter((type) => type.startsWith('admin_invitation_'))).toEqual([
      'admin_invitation_created',
      'admin_invitation_resent',
      'admin_invitation_superseded',
      'admin_invitation_cancelled',
      'admin_invitation_expired',
      'admin_invitation_delivery_accepted',
      'admin_invitation_delivery_failed',
      'admin_invitation_refused',
      'admin_invitation_acceptance_refused',
      'admin_invitation_identity_created',
      'admin_invitation_identity_resumed',
      'admin_invitation_password_rejected',
      'admin_invitation_totp_enrolment_started',
      'admin_invitation_totp_rejected',
      'admin_invitation_totp_verified',
      'admin_invitation_recovery_codes_issued',
      'admin_invitation_sessions_revoked',
      'admin_invitation_accepted',
    ]);
  });

  it.each<[string, unknown]>([
    ['an unknown event type', { ...VALID, type: 'password_changed' }],
    ['an unknown outcome', { ...VALID, outcome: 'maybe' }],
    ['an extra property that could carry a secret', { ...VALID, code: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01' }],
    ['a missing property', { type: VALID.type, outcome: VALID.outcome }],
    ['a reason that is not a lower-case identifier', { ...VALID, reason: 'ABCD-EFGH-JKMN' }],
    ['a reason with spaces', { ...VALID, reason: 'wrong password was hunter2' }],
    ['an overlong reason', { ...VALID, reason: `a${'b'.repeat(64)}` }],
    ['a negative session count', { ...VALID, revokedSessionCount: -1 }],
    ['a fractional session count', { ...VALID, revokedSessionCount: 1.5 }],
    ['a non-numeric recovery reference', { ...VALID, recoveryId: '42; drop table' }],
    ['a client address carrying other text', { ...VALID, clientAddress: '198.51.100.7 password=x' }],
    ['an overlong actor name', { ...VALID, actor: { userId: 'user_synthetic', name: 'n'.repeat(201) } }],
    ['an actor with an extra property', { ...VALID, actor: { userId: 'user_synthetic', name: 'Owner', token: 'x' } }],
    ['an actor without a user id', { ...VALID, actor: { userId: '', name: 'Owner' } }],
    ['a non-object', 'recovery_code_rejected'],
    ['an incident reference carrying free text', { ...VALID, incidentReference: 'INC-20260915-01 lost phone, code 4815' }],
    ['a malformed incident reference', { ...VALID, incidentReference: 'INC-2026-1' }],
    ['a non-numeric terminal recovery reference', { ...VALID, terminalRecoveryId: '7 OR 1=1' }],
    ['a zero terminal recovery reference', { ...VALID, terminalRecoveryId: '0' }],
    ['a missing invitation reference', (({ invitationId: _omit, ...rest }) => rest)(VALID)],
    ['a zero invitation reference', { ...VALID, invitationId: '0' }],
    ['an invitation reference carrying an address', { ...VALID, invitationId: 'new.admin@example.test' }],
    ['a numeric invitation reference', { ...VALID, invitationId: 12 }],
    ['a missing password-reset reference', (({ passwordResetId: _omit, ...rest }) => rest)(VALID)],
    ['a zero password-reset reference', { ...VALID, passwordResetId: '0' }],
    ['a password-reset reference carrying a token', { ...VALID, passwordResetId: 'A'.repeat(43) }],
    ['a numeric password-reset reference', { ...VALID, passwordResetId: 9 }],
    ['a missing target reference', (({ targetUserId: _omit, ...rest }) => rest)(VALID)],
    ['an empty target reference', { ...VALID, targetUserId: '' }],
    ['a target reference carrying an address', { ...VALID, targetUserId: 'admin@example.test' }],
    ['a target reference carrying free text', { ...VALID, targetUserId: 'user admin; reason=lost phone' }],
    ['an overlong target reference', { ...VALID, targetUserId: 'u'.repeat(256) }],
    ['a missing status-change reference', (({ accountChangeId: _omit, ...rest }) => rest)(VALID)],
    ['a zero status-change reference', { ...VALID, accountChangeId: '0' }],
    ['a status-change reference carrying the reason text', { ...VALID, accountChangeId: 'left the company' }],
    ['a numeric status-change reference', { ...VALID, accountChangeId: 5 }],
  ])('refuses %s before touching the database', async (_label, event) => {
    const { db, statements } = recordingDatabase();

    await expect(createSecurityAudit(db).record(event as SecurityAuditEvent)).rejects.toThrow();
    expect(statements).toEqual([]);
  });
});
