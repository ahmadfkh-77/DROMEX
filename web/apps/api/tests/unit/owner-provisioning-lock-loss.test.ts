import { EventEmitter } from 'node:events';

import { Pool, type PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';

import { OwnerProvisioningError } from '../../src/provisioning/errors.ts';
import type { OwnerIdentityPort } from '../../src/provisioning/owner-identity.ts';
import { provisionOwner, type OwnerActivationTerminal } from '../../src/provisioning/owner-provisioning.ts';

/**
 * SEC-1c: Owner activation holds one PostgreSQL advisory lock on one checked
 * out connection for the whole run, while the operator sits at prompts and
 * Better Auth works on other connections. These tests lose that connection
 * mid-run and pin what must happen.
 *
 * The pool is the real `pg-pool`; only the client behind it is a fake that
 * behaves like a `pg` client whose server connection has been terminated:
 * its queries reject, and it emits an `error` event while idle.
 *
 * The real-database counterpart, which terminates the lock holder's backend
 * with `pg_terminate_backend`, is in `tests/integration/owner-provisioning.test.ts`.
 */

const PASSPHRASE = 'synthetic owner passphrase one';

interface World {
  /** Every statement a client was asked to run, whitespace-normalised. */
  statements: string[];
  clients: FakeClient[];
  ended: number;
  userCreated: boolean;
  lost: boolean;
  /** False when another run already holds the advisory lock. */
  lockFree: boolean;
  /** What `emit('error')` threw, if anything: with real pg, an uncaught exception. */
  unhandled: unknown;
  revoked: number;
}

class FakeClient extends EventEmitter {
  // `pg-pool` reads these two to decide whether a released client is reusable.
  _queryable = true;
  _ending = false;

  constructor(private readonly world: World) {
    super();
    world.clients.push(this);
  }

  connect(callback: (error?: Error) => void): void {
    setImmediate(() => callback());
  }

  end(callback?: () => void): void {
    this._ending = true;
    this._queryable = false;
    this.world.ended += 1;
    callback?.();
  }

  async query(text: string): Promise<{ rows: unknown[]; rowCount: number }> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.world.statements.push(sql);
    if (this.world.lost) throw new Error('Client has encountered a connection error and is not queryable');

    if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: this.world.lockFree }], rowCount: 1 };
    if (/^SELECT 1 FROM dromex_principal/.test(sql)) return { rows: [], rowCount: 0 };
    if (/^SELECT state, email, user_id FROM dromex_owner_bootstrap/.test(sql)) return { rows: [], rowCount: 0 };
    if (/^SELECT id FROM "user" WHERE email/.test(sql)) {
      return this.world.userCreated ? { rows: [{ id: 'user-1' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/^SELECT count\(\*\)::int AS n FROM "session"/.test(sql)) return { rows: [{ n: 0 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }
}

function createWorld(): World {
  return { statements: [], clients: [], ended: 0, userCreated: false, lost: false, lockFree: true, unhandled: null, revoked: 0 };
}

function createPool(world: World): Pool {
  class Client extends FakeClient {
    constructor() {
      super(world);
    }
  }
  return new Pool({ Client, max: 2 } as unknown as PoolConfig);
}

function identityFor(world: World): OwnerIdentityPort {
  return {
    async create() {
      world.userCreated = true;
      return { userId: 'user-1' };
    },
    async signIn() {
      return { kind: 'session', cookie: 'synthetic-session-one' };
    },
    async enableTotp() {
      return {
        totpUri: 'otpauth://totp/DROMEX:owner?secret=JBSWY3DPEHPK3PXP&issuer=DROMEX',
        recoveryCodes: ['AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'],
      };
    },
    async verifyTotp() {
      return { kind: 'verified', cookie: 'synthetic-session-two' };
    },
    async regenerateRecoveryCodes() {
      return [];
    },
    async revokeAllSessions() {
      world.revoked += 1;
    },
  };
}

/** The server drops the connection while the operator is at the TOTP prompt. */
function terminalLosingConnection(world: World): OwnerActivationTerminal {
  return {
    async presentEnrollment() {},
    async readTotpCode() {
      world.lost = true;
      try {
        world.clients[0]!.emit('error', new Error('terminating connection due to administrator command'));
      } catch (error) {
        world.unhandled = error;
      }
      return '123456';
    },
    async confirmAuthenticatorsAndStorage() {
      return true;
    },
    async presentRecoveryCodes() {},
    async confirmRecoveryCodesRecorded() {
      return true;
    },
    async clearScreen() {},
  };
}

async function runLosingConnection() {
  const world = createWorld();
  const pool = createPool(world);
  const outcome = await provisionOwner(
    { pool, identity: identityFor(world), terminal: terminalLosingConnection(world) },
    { name: 'Synthetic Owner', email: 'owner@synthetic.invalid', password: PASSPHRASE, passwordConfirmation: PASSPHRASE },
  ).then(
    () => new Error('expected provisioning to fail'),
    (error: unknown) => error,
  );
  const poolSizeAfter = pool.totalCount;
  await pool.end();
  return { world, outcome, poolSizeAfter };
}

describe('Owner provisioning when the lock connection is lost mid-run (SEC-1c)', () => {
  it('fails closed: a generic failure, no Owner committed, and the dead connection is discarded', async () => {
    const { world, outcome, poolSizeAfter } = await runLosingConnection();

    expect(outcome).toBeInstanceOf(OwnerProvisioningError);
    expect((outcome as OwnerProvisioningError).code).toBe('failed');
    // The driver's error, which can carry row data, is dropped.
    expect((outcome as { cause?: unknown }).cause).toBeUndefined();

    // The lock was taken, the run reached the final transaction, and that
    // transaction could not start: nothing that makes an Owner ever ran.
    expect(world.statements.some((sql) => /pg_try_advisory_lock/.test(sql))).toBe(true);
    expect(world.statements.some((sql) => sql === 'BEGIN')).toBe(true);
    expect(world.statements.some((sql) => /INSERT INTO dromex_principal/.test(sql))).toBe(false);
    expect(world.statements.some((sql) => sql === 'COMMIT')).toBe(false);

    // Better Auth sessions were revoked by the workflow, not left behind.
    expect(world.revoked).toBeGreaterThanOrEqual(1);

    // The unlock was attempted, failed, and the connection was destroyed
    // instead of being returned to the pool.
    expect(world.statements.some((sql) => /pg_advisory_unlock/.test(sql))).toBe(true);
    expect(world.ended).toBe(1);
    expect(poolSizeAfter).toBe(0);
  });

  // Fixed by SEC-1c follow-up F2. `pg-pool` removes its own `error` listener
  // from a client the moment it is checked out, so before the fix a connection
  // that died while the operator was at a prompt emitted `error` with no
  // listener, which Node raises as an uncaught exception that ended the command
  // with a raw stack trace instead of the generic `failed` message.
  it('attaches an error listener to its checked-out connection, so a lost connection cannot crash the command', async () => {
    const { world } = await runLosingConnection();

    expect(world.unhandled, 'a connection error emitted on the checked-out client was left unhandled').toBeNull();
  });

  it('leaves no listener of its own on a connection it returns to the pool', async () => {
    const world = createWorld();
    world.lockFree = false; // another run holds the lock: this one refuses and returns its connection
    const pool = createPool(world);

    const outcome = await provisionOwner(
      { pool, identity: identityFor(world), terminal: terminalLosingConnection(world) },
      { name: 'Synthetic Owner', email: 'owner@synthetic.invalid', password: PASSPHRASE, passwordConfirmation: PASSPHRASE },
    ).then(
      () => new Error('expected provisioning to be refused'),
      (error: unknown) => error,
    );

    expect((outcome as OwnerProvisioningError).code).toBe('in_progress');
    // Only pg-pool's own idle listener remains on the pooled client.
    expect(world.clients).toHaveLength(1);
    expect(world.clients[0]!.listenerCount('error')).toBe(1);
    await pool.end();
  });
});
