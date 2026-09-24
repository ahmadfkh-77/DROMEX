import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Migration 47 (DEC-482, DEC-483). Open Balances gain an Active/Cancelled status with a reason and
 * the payment status they had when cancelled; one real payment becomes an account_payments row; and
 * payment_entries may point at the account payment they were allocated from. Every existing balance
 * stays Active and every existing payment keeps working exactly as before (no account payment).
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
/** payment_entries exactly as migration 13 left it (unchanged through version 46). */
const V46_PAYMENT_ENTRIES=`
  CREATE TABLE payment_entries (
    id TEXT PRIMARY KEY NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('load', 'quarryPurchase', 'openingBalance', 'fuelDelivery')),
    load_id TEXT REFERENCES loads(id),
    quarry_purchase_id TEXT REFERENCES quarry_purchases(id),
    opening_balance_id TEXT REFERENCES opening_balances(id),
    fuel_movement_id TEXT REFERENCES fuel_movements(id),
    amount_usd_cents INTEGER NOT NULL CHECK (amount_usd_cents > 0),
    payment_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Cancelled')),
    cancellation_reason TEXT,
    cancelled_at TEXT,
    created_at TEXT NOT NULL,
    CHECK (
      (target_type = 'load' AND load_id IS NOT NULL AND quarry_purchase_id IS NULL AND opening_balance_id IS NULL AND fuel_movement_id IS NULL) OR
      (target_type = 'quarryPurchase' AND load_id IS NULL AND quarry_purchase_id IS NOT NULL AND opening_balance_id IS NULL AND fuel_movement_id IS NULL) OR
      (target_type = 'openingBalance' AND load_id IS NULL AND quarry_purchase_id IS NULL AND opening_balance_id IS NOT NULL AND fuel_movement_id IS NULL) OR
      (target_type = 'fuelDelivery' AND load_id IS NULL AND quarry_purchase_id IS NULL AND opening_balance_id IS NULL AND fuel_movement_id IS NOT NULL)
    )
  );`;
const columns=(db:SqliteTestDatabase,table:string)=>db.raw.prepare(`PRAGMA table_info(${table})`).all().map(row=>(row as {name:string}).name);
const version=(db:SqliteTestDatabase)=>(db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version;

describe('migration 47',()=>{
  it('brings a fresh database to version 47 with the new columns and table',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    expect(DATABASE_VERSION).toBe(47);
    expect(version(db)).toBe(47);
    expect(columns(db,'opening_balances')).toEqual(expect.arrayContaining(['status','cancellation_reason','cancelled_at','status_before_cancellation']));
    expect(columns(db,'account_payments')).toEqual(expect.arrayContaining(['id','party_type','customer_id','supplier_id','party_name','amount_usd_cents','payment_date','method','reference','notes','application_mode','status','cancellation_reason','cancelled_at','created_at']));
    expect(columns(db,'payment_entries')).toContain('account_payment_id');
  });

  it('keeps every version-46 Open Balance Active and every payment unlinked',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    // Put the version-46 shape back: the three new structures removed, then the real rows inserted.
    db.raw.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TABLE payment_entries;
      ${V46_PAYMENT_ENTRIES}
      DROP TABLE account_payments;
      ALTER TABLE opening_balances DROP COLUMN status_before_cancellation;
      ALTER TABLE opening_balances DROP COLUMN cancelled_at;
      ALTER TABLE opening_balances DROP COLUMN cancellation_reason;
      ALTER TABLE opening_balances DROP COLUMN status;
      INSERT INTO suppliers (id,name,created_at,updated_at) VALUES ('sup','Alpha','${SEED_TIME}','${SEED_TIME}');
      INSERT INTO opening_balances (id,party_type,supplier_id,party_name,original_amount_usd_cents,as_of_date,payment_status,created_at) VALUES ('ob','supplier','sup','Alpha',90000,'2026-07-01','Partially Paid','${SEED_TIME}');
      INSERT INTO payment_entries (id,target_type,opening_balance_id,amount_usd_cents,payment_date,created_at) VALUES ('pe','openingBalance','ob',10000,'2026-08-01','${SEED_TIME}');
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 46;
    `);
    await migrateDatabase(db as never);
    expect(version(db)).toBe(47);
    expect(db.raw.prepare('SELECT status,payment_status,cancellation_reason,original_amount_usd_cents FROM opening_balances WHERE id=?').get('ob')).toEqual({status:'Active',payment_status:'Partially Paid',cancellation_reason:null,original_amount_usd_cents:90000});
    expect(db.raw.prepare('SELECT account_payment_id,amount_usd_cents,status FROM payment_entries WHERE id=?').get('pe')).toEqual({account_payment_id:null,amount_usd_cents:10000,status:'Active'});
  });

  it('rejects an unknown Open Balance status and a non-positive account payment',async()=>{
    const db=await migratedDatabaseWithProject(databases);
    db.raw.exec(`INSERT INTO suppliers (id,name,created_at,updated_at) VALUES ('sup','Alpha','${SEED_TIME}','${SEED_TIME}')`);
    expect(()=>db.raw.exec(`INSERT INTO opening_balances (id,party_type,supplier_id,party_name,original_amount_usd_cents,as_of_date,created_at,status) VALUES ('x','supplier','sup','Alpha',1,'2026-07-01','${SEED_TIME}','Deleted')`)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO account_payments (id,party_type,supplier_id,party_name,amount_usd_cents,payment_date,method,application_mode,created_at) VALUES ('p','supplier','sup','Alpha',0,'2026-09-01','cash','overall','${SEED_TIME}')`)).toThrow();
  });
});
