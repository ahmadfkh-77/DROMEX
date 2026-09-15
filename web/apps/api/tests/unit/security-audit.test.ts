import { describe, expect, it } from 'vitest';

import { createSecurityAudit, type SecurityAuditEvent } from '../../src/auth/security-audit.ts';

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
  ])('refuses %s before touching the database', async (_label, event) => {
    const { db, statements } = recordingDatabase();

    await expect(createSecurityAudit(db).record(event as SecurityAuditEvent)).rejects.toThrow();
    expect(statements).toEqual([]);
  });
});
