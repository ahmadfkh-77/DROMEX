import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/**
 * Migration 48 (DEC-487). Company Load Number Series, the item-to-series assignment, a load's generated
 * number and its immutable issue history; business documents, their shared record links, document
 * settings, billing contacts, and reusable signers. Every existing load stays a legacy load with no
 * number, and nothing existing is rewritten.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const columns=(db:SqliteTestDatabase,table:string)=>db.raw.prepare(`PRAGMA table_info(${table})`).all().map(row=>(row as {name:string}).name);
const version=(db:SqliteTestDatabase)=>(db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;
const T=SEED_TIME;

describe('migration 48',()=>{
  it('brings a fresh database to version 48 with every new structure',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(48);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(columns(db,'load_number_series')).toEqual(expect.arrayContaining(['id','prefix','prefix_key','display_name','is_default','is_active','created_at','updated_at']));
    expect(columns(db,'load_number_counters')).toEqual(expect.arrayContaining(['prefix_key','year','next_number']));
    expect(columns(db,'load_number_issues')).toEqual(expect.arrayContaining(['load_number','load_id','series_id','prefix','year','sequence','item_id','issued_at']));
    expect(columns(db,'catalog_items')).toContain('load_number_series_id');
    expect(columns(db,'loads')).toEqual(expect.arrayContaining(['load_number','load_number_series_id','load_number_series_name']));
    expect(columns(db,'business_documents')).toEqual(expect.arrayContaining(['id','kind','party_type','customer_id','supplier_id','party_name','status','draft_number','document_number','period_from','period_to','selection_method','issue_date','due_date','reference','notes','issuer_json','recipient_json','terms_json','signer_json','totals_json','logo_uri','status_history_json','issued_at','cancelled_at','cancellation_reason','created_at','updated_at']));
    expect(columns(db,'business_document_records')).toEqual(expect.arrayContaining(['id','document_id','document_kind','document_status','issue_date','record_type','load_id','supplier_load_id','record_key','snapshot_json','position','created_at']));
    expect(columns(db,'business_document_settings')).toEqual(expect.arrayContaining(['legal_name','trading_name','address','phone','email','website','tax_registration_number','company_registration_number','currency_code','bank_details','payment_terms','footer_note','customer_invoice_prefix','supplier_bill_prefix','customer_statement_prefix','supplier_statement_prefix']));
    expect(columns(db,'business_document_counters')).toEqual(expect.arrayContaining(['prefix_key','year','next_number']));
    expect(columns(db,'party_billing_contacts')).toEqual(expect.arrayContaining(['party_type','customer_id','supplier_id','billing_name','contact_person','address','phone','email','tax_registration_number','company_registration_number','notes']));
    expect(columns(db,'document_signers')).toEqual(expect.arrayContaining(['id','name','name_key','job_title','department','signature_json','signature_updated_at','is_active','created_at','updated_at']));
    expect(columns(db,'document_signer_events')).toEqual(expect.arrayContaining(['id','signer_id','event','document_id','details','created_at']));
  });

  it('seeds one active default LOAD series and empty document settings',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    expect(db.raw.prepare('SELECT prefix,display_name,is_default,is_active FROM load_number_series').all()).toEqual([{prefix:'LOAD',display_name:'Company loads',is_default:1,is_active:1}]);
    expect(db.raw.prepare('SELECT legal_name,currency_code,customer_invoice_prefix,supplier_bill_prefix,customer_statement_prefix,supplier_statement_prefix FROM business_document_settings').all())
      .toEqual([{legal_name:null,currency_code:null,customer_invoice_prefix:'INV',supplier_bill_prefix:'BILL',customer_statement_prefix:'CST',supplier_statement_prefix:'SST'}]);
  });

  it('upgrades a version-47 database without numbering or changing any existing load',async()=>{
    const {db,companyLoad}=await recordsDatabase(databases);
    const id=companyLoad('sand');
    const before=db.raw.prepare('SELECT * FROM loads WHERE id=?').get(id) as Record<string,unknown>;
    db.raw.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE business_document_records; DROP TABLE business_documents; DROP TABLE business_document_settings; DROP TABLE business_document_counters;
      DROP TABLE party_billing_contacts; DROP TABLE document_signer_events; DROP TABLE document_signers;
      DROP TABLE load_number_issues; DROP TABLE load_number_counters;
      DROP TRIGGER trg_loads_load_number_immutable;
      DROP INDEX idx_loads_load_number;
      ALTER TABLE loads DROP COLUMN load_number_series_name; ALTER TABLE loads DROP COLUMN load_number_series_id; ALTER TABLE loads DROP COLUMN load_number;
      ALTER TABLE catalog_items DROP COLUMN load_number_series_id;
      DROP TABLE load_number_series;
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 47;
    `);
    await migrateDatabase(db as never);
    expect(version(db)).toBe(DATABASE_VERSION);
    const after=db.raw.prepare('SELECT * FROM loads WHERE id=?').get(id) as Record<string,unknown>;
    expect(after).toEqual({...before,load_number:null,load_number_series_id:null,load_number_series_name:null});
    expect(db.raw.prepare('SELECT COUNT(*) n FROM load_number_issues').get()).toEqual({n:0});
    expect(db.raw.prepare('SELECT COUNT(*) n FROM load_number_series').get()).toEqual({n:1});
  });

  it('runs again harmlessly on an already-migrated database',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    db.raw.exec('PRAGMA user_version = 47');
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM load_number_series').get()).toEqual({n:1});
    expect(version(db)).toBe(DATABASE_VERSION);
  });

  it('upgrades a database from version 0 through every step',async()=>{
    const db=new SqliteTestDatabase();databases.push(db);
    await migrateDatabase(db as never);
    expect(version(db)).toBe(DATABASE_VERSION);
    expect(db.raw.prepare('SELECT prefix FROM load_number_series WHERE is_default=1').get()).toEqual({prefix:'LOAD'});
  });
});

describe('migration 48 database guards',()=>{
  it('never lets a generated load number change once set, but lets a legacy load receive none',async()=>{
    const {db,companyLoad}=await recordsDatabase(databases);
    const numbered=companyLoad('sand',{loadNumber:'LOAD-2026-001'});
    expect(()=>db.raw.prepare("UPDATE loads SET load_number='LOAD-2026-999' WHERE id=?").run(numbered)).toThrow(/load number cannot change/);
    expect(()=>db.raw.prepare('UPDATE loads SET load_number=NULL WHERE id=?').run(numbered)).toThrow(/load number cannot change/);
    db.raw.prepare("UPDATE loads SET notes='corrected', project_id='other' WHERE id=?").run(numbered);
    expect(db.raw.prepare('SELECT load_number FROM loads WHERE id=?').get(numbered)).toEqual({load_number:'LOAD-2026-001'});
  });

  it('rejects two loads with the same generated number',async()=>{
    const {companyLoad}=await recordsDatabase(databases);
    companyLoad('sand',{loadNumber:'LOAD-2026-001'});
    expect(()=>companyLoad('sand',{loadNumber:'LOAD-2026-001'})).toThrow();
  });

  it('keeps issued-number history immutable',async()=>{
    const {db,companyLoad}=await recordsDatabase(databases);
    const id=companyLoad('sand',{loadNumber:'LOAD-2026-001'});
    db.raw.prepare("INSERT INTO load_number_issues (load_number,load_id,series_id,prefix,year,sequence,item_id,issued_at) VALUES ('LOAD-2026-001',?,'series_load','LOAD',2026,1,'sand',?)").run(id,T);
    expect(()=>db.raw.exec("UPDATE load_number_issues SET sequence=2")).toThrow(/history/);
    expect(()=>db.raw.exec('DELETE FROM load_number_issues')).toThrow(/history/);
  });

  it('allows only one default series and validates prefixes',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    expect(()=>db.raw.exec(`INSERT INTO load_number_series (id,prefix,prefix_key,display_name,is_default,is_active,created_at,updated_at) VALUES ('x','ASP','ASP','Asphalt',1,1,'${T}','${T}')`)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO load_number_series (id,prefix,prefix_key,display_name,is_default,is_active,created_at,updated_at) VALUES ('y','LOAD','LOAD','Again',0,1,'${T}','${T}')`)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO load_number_series (id,prefix,prefix_key,display_name,is_default,is_active,created_at,updated_at) VALUES ('z','a1','A1','Bad',0,1,'${T}','${T}')`)).toThrow();
    expect(()=>db.raw.exec("UPDATE load_number_series SET is_active=0 WHERE is_default=1")).toThrow();
  });

  it('forbids one record in two Issued documents of the same kind, but allows drafts, cancelled and other kinds',async()=>{
    const {db,companyLoad}=await recordsDatabase(databases);
    const load=companyLoad('sand');
    const doc=(id:string,kind:string,status:string)=>db.raw.exec(`INSERT INTO business_documents (id,kind,party_type,customer_id,party_name,status,draft_number,document_number,selection_method,status_history_json,created_at,updated_at) VALUES ('${id}','${kind}','customer','customer','Road Co','${status}','DRAFT-${id}',${status==='Draft'?'NULL':`'N-${id}'`},'manual','[]','${T}','${T}')`);
    const link=(id:string,doc:string,kind:string,status:string)=>db.raw.exec(`INSERT INTO business_document_records (id,document_id,document_kind,document_status,record_type,load_id,record_key,snapshot_json,position,created_at) VALUES ('${id}','${doc}','${kind}','${status}','company_load','${load}','company_load:${load}','{}',0,'${T}')`);
    doc('d1','customer_invoice','Issued');doc('d2','customer_invoice','Draft');doc('d3','customer_invoice','Cancelled');doc('d4','customer_statement','Issued');doc('d5','customer_invoice','Issued');
    link('k1','d1','customer_invoice','Issued');link('k2','d2','customer_invoice','Draft');link('k3','d3','customer_invoice','Cancelled');link('k4','d4','customer_statement','Issued');
    expect(()=>link('k5','d5','customer_invoice','Issued')).toThrow();
    expect(()=>db.raw.exec(`UPDATE business_document_records SET document_status='Issued' WHERE id='k2'`)).toThrow();
  });

  it('rejects an unknown document kind or status and a link to no record',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    expect(()=>db.raw.exec(`INSERT INTO business_documents (id,kind,party_type,customer_id,party_name,status,draft_number,selection_method,status_history_json,created_at,updated_at) VALUES ('d','receipt','customer','customer','Road Co','Draft','DRAFT-1','manual','[]','${T}','${T}')`)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO business_documents (id,kind,party_type,customer_id,party_name,status,draft_number,selection_method,status_history_json,created_at,updated_at) VALUES ('d','customer_invoice','customer','customer','Road Co','Paid','DRAFT-1','manual','[]','${T}','${T}')`)).toThrow();
    db.raw.exec(`INSERT INTO business_documents (id,kind,party_type,customer_id,party_name,status,draft_number,selection_method,status_history_json,created_at,updated_at) VALUES ('d','customer_invoice','customer','customer','Road Co','Draft','DRAFT-1','manual','[]','${T}','${T}')`);
    expect(()=>db.raw.exec(`INSERT INTO business_document_records (id,document_id,document_kind,document_status,record_type,record_key,snapshot_json,position,created_at) VALUES ('k','d','customer_invoice','Draft','company_load','company_load:x','{}',0,'${T}')`)).toThrow();
  });
});
