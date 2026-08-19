import { describe, expect, it } from 'vitest';

import { migrateDatabase, RESERVED_TEST_DATA_DEACTIVATION_SQL } from '../src/data/database/migrations';

describe('reserved test data deactivation migration', () => {
  it('soft-removes reserved profiles then adds reversible project/load archiving when upgrading version 14', async () => {
    const statements: string[] = [];
    const db = {
      execAsync: async (sql: string) => { statements.push(sql); },
      getFirstAsync: async () => ({ user_version: 14 }),
    };

    await migrateDatabase(db as never);

    expect(statements).toContain(RESERVED_TEST_DATA_DEACTIVATION_SQL);
    expect(statements.some((sql) => sql.includes('ALTER TABLE projects ADD COLUMN is_archived'))).toBe(true);
    expect(statements.some((sql) => sql.includes('ALTER TABLE loads ADD COLUMN is_archived'))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE projects SET is_archived = 1"))).toBe(true);
    expect(statements.some((sql) => sql.includes("UPDATE loads SET is_archived = 1"))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 16');
  });

  it('targets every reserved generator prefix without broad table deletes', () => {
    for (const marker of ['slice8_test_%', 'slice11_test_%', 'demo_linked_%', 'test_filter_', 'test_report_']) {
      expect(RESERVED_TEST_DATA_DEACTIVATION_SQL).toContain(marker);
    }
    expect(RESERVED_TEST_DATA_DEACTIVATION_SQL).not.toContain('DELETE FROM');
    expect(RESERVED_TEST_DATA_DEACTIVATION_SQL).not.toContain('name LIKE');
    expect(RESERVED_TEST_DATA_DEACTIVATION_SQL).toContain("UPDATE projects SET status = 'completed'");
    expect(RESERVED_TEST_DATA_DEACTIVATION_SQL).toContain('UPDATE customers SET is_active = 0');
    expect(RESERVED_TEST_DATA_DEACTIVATION_SQL).toContain('WHERE is_own_company = 0');
  });
});
