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
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
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
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds project issues and media when upgrading version 17', async () => {
    const statements: string[] = [];
    const db = {execAsync: async (sql: string) => { statements.push(sql); },getFirstAsync: async () => ({ user_version: 17 })};
    await migrateDatabase(db as never);
    expect(statements.some((sql) => sql.includes('CREATE TABLE project_issues'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE project_media'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds account and cloud synchronization state when upgrading version 18', async () => {
    const statements: string[] = [];
    const db = {execAsync: async (sql: string) => { statements.push(sql); },getFirstAsync: async () => ({ user_version: 18 })};
    await migrateDatabase(db as never);
    expect(statements.some((sql) => sql.includes('CREATE TABLE cloud_sync_state'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE cloud_sync_records'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds project-linked pavement calculations when upgrading version 19',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:19})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE pavement_calculations'))).toBe(true);
    expect(statements.some(sql=>sql.includes('spread_rate_kg_m2 REAL NOT NULL'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds loose and compacted pavement thickness fields when upgrading version 20',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:20})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('loose_thickness_factor'))).toBe(true);
    expect(statements.some(sql=>sql.includes('loose_thickness_mm'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds project walls and material consumption when upgrading version 21',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:21})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE walls'))).toBe(true);
    expect(statements.some(sql=>sql.includes('CREATE TABLE wall_consumptions'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds direct-quantity receipt snapshots when upgrading version 22',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:22})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('quantity_method'))).toBe(true);
    expect(statements.some(sql=>sql.includes('direct_unit_symbol'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds supplier delivery compatibility records when upgrading version 23',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:23})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('delivery_method'))).toBe(true);
    expect(statements.some(sql=>sql.includes('system_supplier_delivery_driver'))).toBe(true);
    expect(statements.some(sql=>sql.includes('system_supplier_delivery_truck'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds fuel price history and immutable fill cost snapshots when upgrading version 24',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:24})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>sql.includes('CREATE TABLE fuel_price_history'))).toBe(true);
    expect(statements.some(sql=>sql.includes('consumption_cost_usd_cents'))).toBe(true);
    expect(statements.some(sql=>sql.includes('price_override_reason'))).toBe(true);
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
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
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
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
      expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(32);
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
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds load status, cancellation fields, and correction-history when upgrading version 27',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:27}),getAllAsync:async()=>[]};
    await migrateDatabase(db as never);
    const sql=statements.join('\n');
    expect(sql).toContain("loads ADD COLUMN status TEXT NOT NULL DEFAULT 'Active'");
    expect(sql).toContain("CHECK (status IN ('Active','Cancelled'))");
    expect(sql).toContain('loads ADD COLUMN cancellation_reason TEXT');
    expect(sql).toContain('loads ADD COLUMN cancelled_at TEXT');
    expect(sql).toContain("loads ADD COLUMN correction_history_json TEXT NOT NULL DEFAULT '[]'");
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_loads_status');
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds loads.updated_at and backfills it from entered_at/confirmed_at when upgrading version 28',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:28}),getAllAsync:async()=>[]};
    await migrateDatabase(db as never);
    const sql=statements.join('\n');
    expect(sql).toContain('loads ADD COLUMN updated_at TEXT');
    expect(sql).toContain('UPDATE loads SET updated_at = COALESCE(entered_at, confirmed_at) WHERE updated_at IS NULL');
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('adds consultant sign-off columns to daily_project_reports when upgrading version 29',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:29}),getAllAsync:async()=>[]};
    await migrateDatabase(db as never);
    const sql=statements.join('\n');
    expect(sql).toContain("daily_project_reports ADD COLUMN consultant_signoff_enabled INTEGER NOT NULL DEFAULT 0");
    expect(sql).toContain('daily_project_reports ADD COLUMN consultant_name TEXT');
    expect(sql).toContain("daily_project_reports ADD COLUMN consultant_signature_json TEXT NOT NULL DEFAULT '[]'");
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('is idempotent when re-run after already reaching version 32',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:32})};
    await migrateDatabase(db as never);
    expect(statements.some(sql=>/ALTER TABLE|CREATE TABLE|CREATE INDEX/.test(sql))).toBe(false);
    expect(statements.some(sql=>sql.includes('PRAGMA user_version'))).toBe(false);
  });

  it('adds ministry header columns when upgrading version 30',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:30}),getAllAsync:async()=>[]};
    await migrateDatabase(db as never);
    const sql=statements.join('\n');
    expect(sql).toContain('company_settings ADD COLUMN ministry_name TEXT');
    expect(sql).toContain('company_settings ADD COLUMN ministry_logo_uri TEXT');
    expect(sql).toContain('daily_project_reports ADD COLUMN show_ministry_header INTEGER NOT NULL DEFAULT 0');
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('gives an existing daily report a safe OFF ministry header default without touching its business data',async()=>{
    const db=new TestDatabase();
    try{
      await migrateDatabase(db as never);
      const now='2026-08-10T00:00:00.000Z';
      db.raw.exec(`
        INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_m','company','Legacy Customer',0,1,'${now}','${now}');
        INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('project_m','cust_m','Legacy Project','Beirut','active','${now}','${now}',0);
        INSERT INTO daily_project_reports (id,project_id,work_date,work_description,created_at,updated_at) VALUES ('report_legacy_m','project_m','2026-08-10','Legacy work description','${now}','${now}');
      `);
      const row=db.raw.prepare('SELECT show_ministry_header,consultant_signoff_enabled,work_date,work_description FROM daily_project_reports WHERE id=?').get('report_legacy_m') as {show_ministry_header:number;consultant_signoff_enabled:number;work_date:string;work_description:string};
      expect(row.show_ministry_header).toBe(0);
      // The consultant sign-off default and the report's own business data are untouched.
      expect(row.consultant_signoff_enabled).toBe(0);
      expect(row.work_date).toBe('2026-08-10');
      expect(row.work_description).toBe('Legacy work description');
    }finally{db.close();}
  });

  it('adds the consulting agency column when upgrading version 31',async()=>{
    const statements:string[]=[];
    const db={execAsync:async(sql:string)=>{statements.push(sql);},getFirstAsync:async()=>({user_version:31}),getAllAsync:async()=>[]};
    await migrateDatabase(db as never);
    expect(statements.join('\n')).toContain('company_settings ADD COLUMN consulting_agency_name TEXT');
    expect(statements.at(-1)).toBe('PRAGMA user_version = 32');
  });

  it('leaves an existing company settings row without an agency name after upgrading to version 32',async()=>{
    const db=new TestDatabase();
    try{
      await migrateDatabase(db as never);
      db.raw.exec(`INSERT INTO company_settings (id,company_name,logo_uri,ministry_name,updated_at) VALUES ('company','DROMEX','file:///logo.png','Ministry of Works','2026-08-10T00:00:00.000Z');`);
      const row=db.raw.prepare('SELECT company_name,logo_uri,ministry_name,consulting_agency_name FROM company_settings WHERE id=?').get('company') as {company_name:string;logo_uri:string|null;ministry_name:string|null;consulting_agency_name:string|null};
      expect(row.consulting_agency_name).toBeNull();
      // The company and ministry values it already held are untouched.
      expect(row.company_name).toBe('DROMEX');
      expect(row.logo_uri).toBe('file:///logo.png');
      expect(row.ministry_name).toBe('Ministry of Works');
    }finally{db.close();}
  });

  it('leaves an existing company settings row unbranded after upgrading to version 31',async()=>{
    const db=new TestDatabase();
    try{
      await migrateDatabase(db as never);
      db.raw.exec(`INSERT INTO company_settings (id,company_name,logo_uri,updated_at) VALUES ('company','DROMEX','file:///logo.png','2026-08-10T00:00:00.000Z');`);
      const row=db.raw.prepare('SELECT company_name,logo_uri,ministry_name,ministry_logo_uri FROM company_settings WHERE id=?').get('company') as {company_name:string;logo_uri:string|null;ministry_name:string|null;ministry_logo_uri:string|null};
      expect(row.ministry_name).toBeNull();
      expect(row.ministry_logo_uri).toBeNull();
      expect(row.company_name).toBe('DROMEX');
      expect(row.logo_uri).toBe('file:///logo.png');
    }finally{db.close();}
  });

  it('gives an existing daily report safe consultant sign-off defaults without touching its business data',async()=>{
    const db=new TestDatabase();
    try{
      await migrateDatabase(db as never);
      const now='2026-08-10T00:00:00.000Z';
      db.raw.exec(`
        INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_1','company','Legacy Customer',0,1,'${now}','${now}');
        INSERT INTO projects (id,customer_id,name,location,status,created_at,updated_at,is_archived) VALUES ('project_1','cust_1','Legacy Project','Beirut','active','${now}','${now}',0);
        INSERT INTO daily_project_reports (id,project_id,work_date,work_description,created_at,updated_at) VALUES ('report_legacy_1','project_1','2026-08-10','Legacy work description','${now}','${now}');
      `);
      const row=db.raw.prepare('SELECT consultant_signoff_enabled,consultant_name,consultant_signature_json,work_date,work_description FROM daily_project_reports WHERE id=?').get('report_legacy_1') as {consultant_signoff_enabled:number;consultant_name:string|null;consultant_signature_json:string;work_date:string;work_description:string};
      expect(row.consultant_signoff_enabled).toBe(0);
      expect(row.consultant_name).toBeNull();
      expect(row.consultant_signature_json).toBe('[]');
      expect(row.work_date).toBe('2026-08-10');
      expect(row.work_description).toBe('Legacy work description');
    }finally{db.close();}
  });

  it('gives existing loads safe defaults and leaves their transaction number and snapshot untouched after upgrading to version 28',async()=>{
    const db=new TestDatabase();
    try{
      await migrateDatabase(db as never);
      db.raw.exec('PRAGMA foreign_keys=OFF;');
      db.raw.exec(`INSERT INTO loads (id,transaction_number,confirmed_at,entered_at,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,payment_status,company_name)
        VALUES ('load_legacy_1','20260801-A-00001','2026-08-01T09:00:00.000Z','2026-08-01T09:00:00.000Z','cust_1','Legacy Customer','item_1','Legacy Item','Produced','Legacy Driver','B999',10000,30000,20000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',20,20,'Unpaid','DROMEX');`);
      const row=db.raw.prepare(`SELECT status,cancellation_reason,cancelled_at,correction_history_json,transaction_number,customer_name,billed_quantity FROM loads WHERE id='load_legacy_1'`).get() as {status:string;cancellation_reason:string|null;cancelled_at:string|null;correction_history_json:string;transaction_number:string;customer_name:string;billed_quantity:number};
      expect(row.status).toBe('Active');
      expect(row.cancellation_reason).toBeNull();
      expect(row.cancelled_at).toBeNull();
      expect(row.correction_history_json).toBe('[]');
      expect(row.transaction_number).toBe('20260801-A-00001');
      expect(row.customer_name).toBe('Legacy Customer');
      expect(row.billed_quantity).toBe(20);
    }finally{db.close();}
  });

  it('backfills updated_at from entered_at/confirmed_at for existing loads, leaves business fields unchanged, and is harmless to re-run',async()=>{
    const db=new TestDatabase();
    try{
      await migrateDatabase(db as never);
      db.raw.exec('PRAGMA foreign_keys=OFF;');
      // load_a has a distinct entered_at (should win over confirmed_at); load_b has no entered_at (should fall back to confirmed_at).
      db.raw.exec(`INSERT INTO loads (id,transaction_number,confirmed_at,entered_at,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,payment_status,company_name)
        VALUES ('load_a','20260801-A-00001','2026-08-01T09:00:00.000Z','2026-08-01T08:55:00.000Z','cust_1','Customer A','item_1','Item A','Produced','Driver A','A111',10000,30000,20000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',20,20,'Unpaid','DROMEX');
        INSERT INTO loads (id,transaction_number,confirmed_at,entered_at,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,payment_status,company_name)
        VALUES ('load_b','20260801-A-00002','2026-08-02T10:00:00.000Z',NULL,'cust_1','Customer B','item_1','Item B','Produced','Driver B','B222',5000,15000,10000,'conv_1','Kilograms to metric tons','1000 kg = 1 t','t',10,10,'Paid','DROMEX');`);
      db.raw.exec('PRAGMA user_version=28;');
      await migrateDatabase(db as never);

      type Row={updated_at:string|null;entered_at:string|null;confirmed_at:string;customer_name:string;billed_quantity:number;payment_status:string;transaction_number:string};
      const readBoth=()=>({
        a:db.raw.prepare('SELECT updated_at,entered_at,confirmed_at,customer_name,billed_quantity,payment_status,transaction_number FROM loads WHERE id=?').get('load_a') as Row,
        b:db.raw.prepare('SELECT updated_at,entered_at,confirmed_at,customer_name,billed_quantity,payment_status,transaction_number FROM loads WHERE id=?').get('load_b') as Row,
      });
      const first=readBoth();
      expect(first.a.updated_at).toBe('2026-08-01T08:55:00.000Z'); // entered_at
      expect(first.b.updated_at).toBe('2026-08-02T10:00:00.000Z'); // confirmed_at, entered_at is NULL
      expect(first.a.customer_name).toBe('Customer A');
      expect(first.a.billed_quantity).toBe(20);
      expect(first.a.payment_status).toBe('Unpaid');
      expect(first.a.transaction_number).toBe('20260801-A-00001');
      expect(first.b.customer_name).toBe('Customer B');
      expect(first.b.billed_quantity).toBe(10);
      expect(first.b.payment_status).toBe('Paid');
      expect(first.b.transaction_number).toBe('20260801-A-00002');

      // Re-running the migration (simulating a repeat attempt) must not overwrite an already-backfilled value or touch business data.
      db.raw.exec('PRAGMA user_version=28;');
      await migrateDatabase(db as never);
      const second=readBoth();
      expect(second).toEqual(first);
      expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(32);
    }finally{db.close();}
  });
});
