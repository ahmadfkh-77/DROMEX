import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {strFromU8,unzipSync} from 'fflate';
import {describe,expect,it,vi} from 'vitest';

// Building and encrypting a whole backup can exceed vitest's 5 s default while the full suite runs in parallel.
vi.setConfig({testTimeout:60_000});

import {generateCustomerTestBackup} from '../scripts/generate-customer-test-backup';
import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import {buildMaterialTree,emptyCompanyTotalsFilters,NO_CUSTOMER_KEY,treeTotals} from '../src/domain/companyTotals';
import {customerDeliveryFilters,emptyCustomerDeliveryScope} from '../src/domain/customerDeliveries';
import {customerBox,supplierBox} from '../src/domain/projectTotalsPdf';
import {decryptBackupBytes} from '../src/services/backup/BackupCrypto';

/** The small customer/totals test backup: decryptable, relationally valid, and it exercises every case the new work handles. */
class Adapter{
  constructor(readonly raw:DatabaseSync){}
  execAsync(sql:string){this.raw.exec(sql);return Promise.resolve();}
  getFirstAsync<T>(sql:string,...params:unknown[]){return Promise.resolve((this.raw.prepare(sql).get(...params as never[])??null) as T|null);}
  getAllAsync<T>(sql:string,...params:unknown[]){return Promise.resolve(this.raw.prepare(sql).all(...params as never[]) as T[]);}
  runAsync(sql:string,...params:unknown[]){const result=this.raw.prepare(sql).run(...params as never[]);return Promise.resolve({changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)});}
}

async function restored(){
  const directory=mkdtempSync(join(tmpdir(),'dromex-customer-test-')),output=join(directory,'test.dromexbackup');
  const generated=await generateCustomerTestBackup({output,password:'test-password',now:new Date('2026-10-05T12:00:00.000Z')});
  const files=unzipSync(await decryptBackupBytes(Uint8Array.from(readFileSync(output)),'test-password'));
  const databasePath=join(directory,'restored.sqlite');writeFileSync(databasePath,files['database.sqlite']!);
  const db=new DatabaseSync(databasePath);
  return {directory,generated,files,db,adapter:new Adapter(db)};
}

describe('customer and totals test backup',()=>{
  it('is a decryptable, relationally valid complete-backup package at the current database version',async()=>{
    const {directory,generated,files,db}=await restored();
    try{
      const manifest=JSON.parse(strFromU8(files['manifest.json']!)) as {databaseVersion:number;recordCounts:Record<string,number>;media:unknown[]};
      expect(manifest.databaseVersion).toBe(DATABASE_VERSION);
      expect(manifest.media).toEqual([]);
      expect(generated.counts).toMatchObject({loads:9,quarry_purchases:3,customers:3,projects:3,suppliers:2,catalog_items:4});
      expect(db.prepare('PRAGMA integrity_check').get()).toMatchObject({integrity_check:'ok'});
      expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
    }finally{db.close();rmSync(directory,{recursive:true,force:true});}
  });

  it('numbers loads from the right series, with Sand and Gravel sharing AGG and a legacy load left unnumbered',async()=>{
    const {directory,db}=await restored();
    try{
      const numbers=(db.prepare("SELECT load_number FROM loads WHERE load_number IS NOT NULL ORDER BY confirmed_at, id").all() as {load_number:string}[]).map(row=>row.load_number);
      expect(numbers.filter(value=>value.startsWith('ASP-'))).toEqual(['ASP-00001','ASP-00002','ASP-00003','ASP-00004']);
      expect(numbers.filter(value=>value.startsWith('AGG-'))).toEqual(['AGG-00001','AGG-00002','AGG-00003']);
      expect(numbers.filter(value=>value.startsWith('LOAD-'))).toEqual(['LOAD-00001']);
      expect(db.prepare("SELECT COUNT(*) n FROM loads WHERE load_number IS NULL").get()).toMatchObject({n:1});
      expect(db.prepare("SELECT id FROM loads WHERE load_number IS NULL").get()).toMatchObject({id:'test_load_legacy'});
      expect(db.prepare("SELECT next_number FROM load_number_counters WHERE prefix_key='AGG' AND year=0").get()).toMatchObject({next_number:4});
      expect(db.prepare("SELECT COUNT(*) n FROM load_number_issues").get()).toMatchObject({n:8});
    }finally{db.close();rmSync(directory,{recursive:true,force:true});}
  });

  it('contains every case: cancelled load, blank destination, Arabic name, two suppliers, customer and internal projects',async()=>{
    const {directory,db}=await restored();
    try{
      expect(db.prepare("SELECT COUNT(*) n FROM loads WHERE status='Cancelled'").get()).toMatchObject({n:1});
      expect(db.prepare("SELECT COUNT(*) n FROM loads WHERE project_location IS NULL AND destination_address IS NULL").get()).toMatchObject({n:1});
      expect(db.prepare("SELECT name FROM customers WHERE id='test_customer_nour'").get()).toMatchObject({name:'شركة النور للمقاولات'});
      expect(db.prepare("SELECT COUNT(DISTINCT supplier_id) n FROM quarry_purchases").get()).toMatchObject({n:2});
      expect(db.prepare("SELECT is_own_company FROM customers c JOIN projects p ON p.customer_id=c.id WHERE p.id='test_project_yard'").get()).toMatchObject({is_own_company:1});
      expect(db.prepare("SELECT is_own_company FROM customers c JOIN projects p ON p.customer_id=c.id WHERE p.id='test_project_highway'").get()).toMatchObject({is_own_company:0});
    }finally{db.close();rmSync(directory,{recursive:true,force:true});}
  });

  it('behaves as intended through the app’s own totals queries',async()=>{
    const {directory,db,adapter}=await restored();
    try{
      const totals=new SqliteCompanyTotalsRepository(adapter as never);
      // Project Totals PDF input: the customer project lists company loads and two suppliers, never the cancelled load.
      const highway=await totals.listRecords({...emptyCompanyTotalsFilters(),projectKey:'test_project_highway'});
      expect(highway.some(record=>record.status==='Cancelled')).toBe(false);
      expect(highway.some(record=>record.snapshot.loadNumber==='ASP-00003')).toBe(false);
      expect(supplierBox(highway)).toEqual({label:'Multiple suppliers (2)',names:['Cedar Aggregates','Saad Quarry']});
      expect(highway.find(record=>record.snapshot.loadNumber===null&&record.snapshot.recordType==='company_load')).toBeDefined();
      expect(highway.find(record=>record.snapshot.loadNumber==='ASP-00002')!.details!.destination).toBeNull();
      expect(customerBox({name:'DROMEX Asphalt Co.',isOwnCompany:true}).label).toBe('Internal project');
      // The internal project has one supplier.
      const yard=await totals.listRecords({...emptyCompanyTotalsFilters(),projectKey:'test_project_yard'});
      expect(supplierBox(yard)).toEqual({label:'Saad Quarry',names:[]});
      // Customer filter and No customer / Internal.
      const choices=await totals.listCustomerChoices({fromDate:'',toDate:''});
      expect(choices.map(choice=>choice.name)).toEqual(['Al Amal Contracting','شركة النور للمقاولات','No customer / Internal']);
      const internal=await totals.getCompanyTotals({...emptyCompanyTotalsFilters(),customerKeys:[NO_CUSTOMER_KEY]});
      expect(treeTotals(buildMaterialTree(internal)).inclusion.total).toBe(1);
      // Customer page for Al Amal: Active company loads only.
      const page=await totals.listRecords(customerDeliveryFilters('test_customer_amal',emptyCustomerDeliveryScope()));
      expect(page.map(record=>record.snapshot.loadNumber)).toEqual([null,'ASP-00001','ASP-00002','AGG-00001']);
    }finally{db.close();rmSync(directory,{recursive:true,force:true});}
  },20_000);
});
