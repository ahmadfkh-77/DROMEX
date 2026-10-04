import { EventEmitter } from 'node:events';

import { Pool, type PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';

import { loadDromexMigrations } from '../../src/db/dromex-migrations.ts';
import { VERIFIED_BETTER_AUTH_SCHEMA } from '../../src/provisioning/owner-mfa-reset.ts';
import {
  recoverOwnerFromTerminal,
  type OwnerRecoveryTerminal,
} from '../../src/provisioning/terminal-recovery.ts';
import { TerminalRecoveryError } from '../../src/provisioning/terminal-recovery-errors.ts';
import type { TerminalRecoveryIdentityPort } from '../../src/provisioning/terminal-recovery-identity.ts';

/**
 * Terminal emergency Owner recovery holds one PostgreSQL advisory lock on one
 * checked-out connection for the whole run, while the operator sits at
 * prompts. Same scenario and same method as
 * tests/unit/owner-provisioning-lock-loss.test.ts: the pool is the real
 * `pg-pool`, only the client behind it is a fake whose server connection has
 * been terminated. The real-database counterpart is
 * tests/integration/terminal-owner-recovery.test.ts.
 */

const OWNER_EMAIL = 'owner@synthetic.invalid';
const PASSPHRASE = 'synthetic owner passphrase one';

interface World {
  statements: string[];
  clients: FakeClient[];
  ended: number;
  lost: boolean;
  lockFree: boolean;
  migrationIds: string[];
  /** What `emit('error')` threw, if anything: with real pg, an uncaught exception. */
  unhandled: unknown;
  revoked: number;
}

type Reply = { rows: unknown[]; rowCount: number };

class FakeClient extends EventEmitter {
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

  /** pg-pool's own `pool.query` uses the callback form; the run itself uses the promise form. */
  query(text: string, values?: unknown, callback?: (error: Error | null, result?: Reply) => void): Promise<Reply> | void {
    const done = typeof values === 'function' ? (values as typeof callback) : callback;
    const run = this.answer(text);
    if (done !== undefined) {
      run.then(
        (result) => done(null, result),
        (error: Error) => done(error),
      );
      return;
    }
    return run;
  }

  private async answer(text: string): Promise<Reply> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.world.statements.push(sql);
    if (this.world.lost) throw new Error('Client has encountered a connection error and is not queryable');

    if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: this.world.lockFree }], rowCount: 1 };
    if (/FROM information_schema\.columns/.test(sql)) {
      const rows = Object.entries(VERIFIED_BETTER_AUTH_SCHEMA).flatMap(([table, columns]) =>
        Object.entries(columns).map(([column, type]) => ({ table_name: table, column_name: column, data_type: type })),
      );
      return { rows, rowCount: rows.length };
    }
    if (/^SELECT id FROM dromex_migration ORDER BY id/.test(sql)) {
      return { rows: this.world.migrationIds.map((id) => ({ id })), rowCount: this.world.migrationIds.length };
    }
    if (/FROM dromex_principal p JOIN "user" u/.test(sql)) {
      return { rows: [{ user_id: 'owner-1', status: 'active', email: OWNER_EMAIL, name: 'Synthetic Owner' }], rowCount: 1 };
    }
    if (/count\(\*\)::int AS n FROM dromex_audit_event/.test(sql)) return { rows: [{ n: 0 }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  }
}

async function createWorld(): Promise<World> {
  const migrationIds = (await loadDromexMigrations()).map((migration) => migration.id);
  return { statements: [], clients: [], ended: 0, lost: false, lockFree: true, migrationIds, unhandled: null, revoked: 0 };
}

function createPool(world: World): Pool {
  class Client extends FakeClient {
    constructor() {
      super(world);
    }
  }
  return new Pool({ Client, max: 4 } as unknown as PoolConfig);
}

function identityFor(world: World): TerminalRecoveryIdentityPort {
  return {
    async signIn() {
      return { kind: 'session', cookie: 'synthetic-session-one' };
    },
    async revokeAllSessions() {
      world.revoked += 1;
    },
  } as unknown as TerminalRecoveryIdentityPort;
}

/** The server drops the lock connection while the operator is looking at the first screen. */
function terminalLosingConnection(world: World): OwnerRecoveryTerminal {
  const unexpected = async () => {
    throw new Error('the run went further than this scenario expects');
  };
  return {
    async presentTarget() {
      world.lost = true;
      try {
        world.clients[0]!.emit('error', new Error('terminating connection due to administrator command'));
      } catch (error) {
        world.unhandled = error;
      }
    },
    async readOwnerEmail() {
      return OWNER_EMAIL;
    },
    async readPassword() {
      return PASSPHRASE;
    },
    readAuthenticatorAvailability: unexpected,
    readTotpCode: unexpected,
    readRetrievalConfirmation: unexpected,
    presentRetrievedCode: unexpected,
    presentResetWarning: unexpected,
    readResetConfirmation: unexpected,
    readIncidentReference: unexpected,
    presentEnrollment: unexpected,
    readAuthenticatorAcknowledgement: unexpected,
    presentRecoveryCodes: unexpected,
    readRecoveryCodeAcknowledgement: unexpected,
    clearScreen: unexpected,
  } as unknown as OwnerRecoveryTerminal;
}

async function runLosingConnection() {
  const world = await createWorld();
  const pool = createPool(world);
  const outcome = await recoverOwnerFromTerminal({
    pool,
    identity: identityFor(world),
    terminal: terminalLosingConnection(world),
    environment: 'synthetic test',
  }).then(
    () => new Error('expected recovery to fail'),
    (error: unknown) => error,
  );
  const poolSizeAfter = pool.totalCount;
  await pool.end();
  return { world, outcome, poolSizeAfter };
}

describe('terminal Owner recovery when the lock connection is lost at a prompt (SEC-1c follow-up)', () => {
  it('fails closed: a generic failure, no factor change, and the dead connection is discarded', async () => {
    const { world, outcome, poolSizeAfter } = await runLosingConnection();

    expect(outcome).toBeInstanceOf(TerminalRecoveryError);
    expect((outcome as TerminalRecoveryError).code).toBe('failed');
    expect((outcome as { cause?: unknown }).cause).toBeUndefined();

    // The run reached its first prompt holding the lock, and nothing that
    // changes Better Auth's factor data ever ran.
    expect(world.statements.some((sql) => /pg_try_advisory_lock/.test(sql))).toBe(true);
    expect(world.statements.some((sql) => /UPDATE "user" SET "twoFactorEnabled"|DELETE FROM "twoFactor"/.test(sql))).toBe(false);
    expect(world.revoked).toBeGreaterThanOrEqual(1);

    // The unlock was attempted, failed, and the connection was destroyed
    // instead of being returned to the pool.
    expect(world.statements.some((sql) => /pg_advisory_unlock/.test(sql))).toBe(true);
    expect(world.clients[0]!._ending).toBe(true);
    expect(poolSizeAfter).toBeLessThanOrEqual(1);
  });

  it('attaches an error listener to its checked-out connection, so a lost connection cannot crash the command', async () => {
    const { world } = await runLosingConnection();

    expect(world.unhandled, 'a connection error emitted on the checked-out client was left unhandled').toBeNull();
  });

  it('leaves no listener of its own on a connection it returns to the pool', async () => {
    const world = await createWorld();
    world.lockFree = false; // another run holds the lock: this one refuses and returns its connection
    const pool = createPool(world);

    const outcome = await recoverOwnerFromTerminal({
      pool,
      identity: identityFor(world),
      terminal: terminalLosingConnection(world),
      environment: 'synthetic test',
    }).then(
      () => new Error('expected recovery to be refused'),
      (error: unknown) => error,
    );

    expect((outcome as TerminalRecoveryError).code).toBe('in_progress');
    expect(world.clients[0]!.listenerCount('error')).toBe(1); // only pg-pool's idle listener
    await pool.end();
  });
});
