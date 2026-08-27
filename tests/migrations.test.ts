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
    expect(statements.some((sql) => sql.includes('CREATE TABLE schedule_tasks'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE waste_counter_presets'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE project_issues'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE project_media'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE cloud_sync_state'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE pavement_calculations'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 23');
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

  it('adds only the schedule and waste-counter schema when upgrading version 16', async () => {
    const statements: string[] = [];
    const db = {
      execAsync: async (sql: string) => { statements.push(sql); },
      getFirstAsync: async () => ({ user_version: 16 }),
    };

    await migrateDatabase(db as never);

    expect(statements.some((sql) => sql.includes('ALTER TABLE projects ADD COLUMN is_archived'))).toBe(false);
    expect(statements.some((sql) => sql.includes('CREATE TABLE schedule_tasks'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE waste_counter_presets'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE project_issues'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 23');
  });

  it('adds project issues and media when upgrading version 17', async () => {
    const statements: string[] = [];
    const db = {execAsync: async (sql: string) => { statements.push(sql); },getFirstAsync: async () => ({ user_version: 17 })};
    await migrateDatabase(db as never);
    expect(statements.some((sql) => sql.includes('CREATE TABLE project_issues'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE project_media'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 23');
  });

  it('adds account and cloud synchronization state when upgrading version 18', async () => {
    const statements: string[] = [];
    const db = {execAsync: async (sql: string) => { statements.push(sql); },getFirstAsync: async () => ({ user_version: 18 })};
    await migrateDatabase(db as never);
    expect(statements.some((sql) => sql.includes('CREATE TABLE cloud_sync_state'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE cloud_sync_records'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 23');
  });

  it('adds project-linked pavement calculations when upgrading version 19',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:19})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE pavement_calculations'))).toBe(true);
    expect(statements.some(sql=>sql.includes('spread_rate_kg_m2 REAL NOT NULL'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 23');
  });

  it('adds loose and compacted pavement thickness fields when upgrading version 20',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:20})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('loose_thickness_factor'))).toBe(true);
    expect(statements.some(sql=>sql.includes('loose_thickness_mm'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 23');
  });

  it('adds project walls and material consumption when upgrading version 21',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:21})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE walls'))).toBe(true);
    expect(statements.some(sql=>sql.includes('CREATE TABLE wall_consumptions'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 23');
  });

  it('adds direct-quantity receipt snapshots when upgrading version 22',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:22})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('quantity_method'))).toBe(true);
    expect(statements.some(sql=>sql.includes('direct_unit_symbol'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 23');
  });
});
