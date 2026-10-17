import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteStockRepository} from '../src/data/repositories/SqliteStockRepository';
import {BACKUP_COUNT_TABLES} from '../src/domain/backup';
import type {StockBatchDraft} from '../src/domain/stock';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Stock (Phase 1). A backup copies the whole SQLite file, so stock items, batches and the use history travel with it. These tests restore a
 * real file copy and prove nothing is lost or renumbered, and that an older database with real data upgrades to version 60 untouched.
 */
const open:SqliteTestDatabase[]=[];const files:string[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-16T09:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of open.splice(0))database.close();for(const file of files.splice(0))fs.rmSync(file,{force:true});});
function copyOf(database:SqliteTestDatabase):SqliteTestDatabase{
  const file=path.join(os.tmpdir(),`dromex-stock-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);files.push(file);
  database.raw.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);
  const restored=new SqliteTestDatabase(file);open.push(restored);return restored;
}
const seed=(db:SqliteTestDatabase)=>db.raw.exec(`
  INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('gulf','Gulf Lubricants',1,'${SEED_TIME}','${SEED_TIME}');
  INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat_stock','Materials','${SEED_TIME}','${SEED_TIME}');
  INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('oil','cat_stock','Engine oil','unit_kg',1,1,'${SEED_TIME}','${SEED_TIME}');
`);
const draft=(extra:Partial<StockBatchDraft>={}):StockBatchDraft=>({itemId:'oil',unitId:'',recordDate:'2026-10-12',supplierId:'gulf',invoiceNumber:'INV-1',quantity:'20',priceBasis:'per_unit',price:'18.5',vat:true,vatRate:'11',notes:'',...extra});

describe('backup and restore of Stock',()=>{
  it('counts stock in the backup preview and every counted table exists',async()=>{
    const db=await migratedDatabaseWithProject(open);
    expect(BACKUP_COUNT_TABLES).toEqual(expect.arrayContaining(['stock_items','stock_batches','stock_use']));
    const tables=new Set((db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(row=>row.name));
    for(const table of BACKUP_COUNT_TABLES)expect(tables.has(table),`${table} is counted but does not exist`).toBe(true);
  });

  it('round-trips items, batches, uses and cancellations, then keeps numbering',async()=>{
    const db=await migratedDatabaseWithProject(open);seed(db);
    const repository=new SqliteStockRepository(db as never);
    await repository.recordBatch(draft({recordDate:'2026-10-03',quantity:'4'}));
    await repository.recordBatch(draft({recordDate:'2026-10-12',quantity:'50',price:'',vat:false,vatRate:''}));
    const first=await repository.recordUse({itemId:'oil',quantity:'10',usedOn:'2026-10-16',note:'Loader service'});
    const second=await repository.recordUse({itemId:'oil',quantity:'3',usedOn:'2026-10-16',note:'Typed twice'});
    await repository.cancelUse(second.groupId,'Entered twice');
    const expected=await repository.getOverview();
    expect(expected.items[0]!.batches.map(batch=>batch.batchNumber)).toEqual(['ENG-0001','ENG-0002']);
    expect(first.lines.map(line=>line.quantity)).toEqual([4,6]);

    const after=new SqliteStockRepository(copyOf(db) as never);
    expect(await after.getOverview()).toEqual(expected);
    expect((await after.getSetup()).catalogItems.find(item=>item.id==='oil')?.inStock).toBe(true);

    vi.setSystemTime(new Date('2026-10-17T09:00:00'));
    const next=await after.recordBatch(draft({recordDate:'2026-10-17',quantity:'5',price:'',vat:false,vatRate:''}));
    expect(next.batchNumber).toBe('ENG-0003');
  });

  it('never reuses a cancelled batch number after a restore',async()=>{
    const db=await migratedDatabaseWithProject(open);seed(db);
    const repository=new SqliteStockRepository(db as never);
    const batch=await repository.recordBatch(draft({price:'',vat:false,vatRate:''}));
    await repository.cancelBatch(batch.id,'Entered twice');
    const after=new SqliteStockRepository(copyOf(db) as never);
    await after.recordBatch(draft({price:'',vat:false,vatRate:''}));
    expect((await after.getOverview()).items[0]!.batches.map(value=>[value.batchNumber,value.status])).toEqual([['ENG-0001','cancelled'],['ENG-0002','in_use']]);
  });

  it('upgrades a version 59 database that already has real records without touching them',async()=>{
    const db=await migratedDatabaseWithProject(open);seed(db);
    db.raw.exec(`DROP TABLE stock_use;DROP TABLE stock_batches;DROP TABLE stock_items;PRAGMA user_version = 59;`);
    const loads=(db.raw.prepare('SELECT COUNT(*) c FROM projects').get() as {c:number}).c;
    await migrateDatabase(db as never);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect((db.raw.prepare('SELECT COUNT(*) c FROM projects').get() as {c:number}).c).toBe(loads);
    expect((db.raw.prepare('SELECT COUNT(*) c FROM stock_items').get() as {c:number}).c).toBe(0);
    const repository=new SqliteStockRepository(db as never);
    expect((await repository.recordBatch(draft({price:'',vat:false,vatRate:''}))).batchNumber).toBe('ENG-0001');
  });
});
