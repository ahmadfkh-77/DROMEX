import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

import { migrateDatabase, RESERVED_TEST_DATA_DEACTIVATION_SQL } from '../src/data/database/migrations';

class TestDatabase {
  readonly raw = new DatabaseSync(':memory:');
  execAsync(sql: string) { this.raw.exec(sql); return Promise.resolve(); }
  getFirstAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve((this.raw.prepare(sql).get(...params as never[]) ?? null) as T | null); }
  getAllAsync<T>(sql: string, ...params: unknown[]) { return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]); }
  close() { this.raw.close(); }
}

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
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
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
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('adds project issues and media when upgrading version 17', async () => {
    const statements: string[] = [];
    const db = {execAsync: async (sql: string) => { statements.push(sql); },getFirstAsync: async () => ({ user_version: 17 })};
    await migrateDatabase(db as never);
    expect(statements.some((sql) => sql.includes('CREATE TABLE project_issues'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE project_media'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('adds account and cloud synchronization state when upgrading version 18', async () => {
    const statements: string[] = [];
    const db = {execAsync: async (sql: string) => { statements.push(sql); },getFirstAsync: async () => ({ user_version: 18 })};
    await migrateDatabase(db as never);
    expect(statements.some((sql) => sql.includes('CREATE TABLE cloud_sync_state'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE cloud_sync_records'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('adds project-linked pavement calculations when upgrading version 19',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:19})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE pavement_calculations'))).toBe(true);
    expect(statements.some(sql=>sql.includes('spread_rate_kg_m2 REAL NOT NULL'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('adds loose and compacted pavement thickness fields when upgrading version 20',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:20})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('loose_thickness_factor'))).toBe(true);
    expect(statements.some(sql=>sql.includes('loose_thickness_mm'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('adds project walls and material consumption when upgrading version 21',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:21})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE walls'))).toBe(true);
    expect(statements.some(sql=>sql.includes('CREATE TABLE wall_consumptions'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('adds direct-quantity receipt snapshots when upgrading version 22',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:22})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('quantity_method'))).toBe(true);
    expect(statements.some(sql=>sql.includes('direct_unit_symbol'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('adds supplier delivery compatibility records when upgrading version 23',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:23})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('delivery_method'))).toBe(true);
    expect(statements.some(sql=>sql.includes('system_supplier_delivery_driver'))).toBe(true);
    expect(statements.some(sql=>sql.includes('system_supplier_delivery_truck'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('adds fuel price history and immutable fill cost snapshots when upgrading version 24',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:24})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE fuel_price_history'))).toBe(true);
    expect(statements.some(sql=>sql.includes('consumption_cost_usd_cents'))).toBe(true);
    expect(statements.some(sql=>sql.includes('price_override_reason'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('adds flexible supplier pricing, unit snapshots, correction audit, and worker safety when upgrading version 25',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:25})};
    await migrateDatabase(db as never);
    const sql=statements.join('\n');
    expect(sql).toContain('price_basis');
    expect(sql).toContain('vat_inclusive');
    expect(sql).toContain('correction_history_json');
    expect(sql).toContain('safety_json');
    expect(sql).toContain("unit_symbol=COALESCE(unit_symbol,'m³')");
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });

  it('repairs a partially attempted version 25 upgrade and reuses an existing cubic-metre unit',async()=>{
    const db=new TestDatabase();
    try{
      await migrateDatabase(db as never);
      db.raw.exec(`DELETE FROM measurement_units WHERE id='unit_m3';
        INSERT INTO measurement_units (id,name,symbol,is_active,created_at,updated_at)
          VALUES ('existing_cubic_unit','Cubic metre','m³',1,'2026-08-01','2026-08-01');
        PRAGMA user_version=25;`);
      await migrateDatabase(db as never);
      expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(27);
      expect((db.raw.prepare(`SELECT id FROM measurement_units WHERE symbol='m³'`).get() as {id:string}).id).toBe('existing_cubic_unit');
      expect((db.raw.prepare(`SELECT COUNT(*) count FROM measurement_units WHERE id='unit_m3'`).get() as {count:number}).count).toBe(0);
      const purchaseColumns=db.raw.prepare(`PRAGMA table_info(quarry_purchases)`).all() as {name:string}[];
      expect(purchaseColumns.filter(value=>value.name==='unit_id')).toHaveLength(1);
      const reportColumns=db.raw.prepare(`PRAGMA table_info(daily_project_reports)`).all() as {name:string}[];
      expect(reportColumns.filter(value=>value.name==='safety_json')).toHaveLength(1);
    }finally{db.close();}
  });

  it('adds truck fuel identity and separate operational entry timestamps when upgrading version 26',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:26}),getAllAsync:async()=>[]};
    await migrateDatabase(db as never);
    const sql=statements.join('\n');
    expect(sql).toContain('fuel_movements ADD COLUMN equipment_type');
    expect(sql).toContain('fuel_movements ADD COLUMN truck_profile_id');
    expect(sql).toContain('loads ADD COLUMN entered_at');
    expect(sql).toContain('quarry_purchases ADD COLUMN entered_at');
    expect(statements.at(-1)).toBe('PRAGMA user_version = 27');
  });
});
