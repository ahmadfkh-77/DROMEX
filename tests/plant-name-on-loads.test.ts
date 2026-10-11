import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteBusinessReportRepository} from '../src/data/repositories/SqliteBusinessReportRepository';
import {SqliteCompanyHeaderRepository} from '../src/data/repositories/SqliteCompanyHeaderRepository';
import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import {SqliteProjectTotalsRepository} from '../src/data/repositories/SqliteProjectTotalsRepository';
import {emptyCompanyTotalsFilters} from '../src/domain/companyTotals';
import {detailsDiffer,emptyCompanyDetails,planLoadNameUpdate,validateLoadNameUpdate} from '../src/domain/loadCompanyName';
import type {ConfirmedLoad} from '../src/domain/loads';
import {loadHistoryRows} from '../src/domain/loadHistoryPdf';
import {plantSupplierName} from '../src/domain/loadSupplier';
import {supplierBox} from '../src/domain/projectTotalsPdf';
import {recordsDatabase} from './support/recordFixtures';
import {SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * The name on my loads. Phase A: PDFs, Excel and totals always print the CURRENT Plant Company name on my own loads, and the
 * data is not touched. Phase B: one explicit, confirmed, all-or-nothing update of the name (and optionally the details)
 * saved on the loads, cancelled and archived loads included, with an audit row per old name.
 */
const databases:SqliteTestDatabase[]=[];const folders:string[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});

const NEW='DROMEX S.A.R.L.';
/** The plant was "DROMEX", now "DROMEX S.A.R.L.": 3 loads say DROMEX, 2 say DROMEX Asphalt (one cancelled, one archived), 1 already says the new name. */
async function setup(options:{plantName?:string}={}){
  const fixtures=await recordsDatabase(databases);const {db,companyLoad}=fixtures;
  db.raw.exec(`INSERT INTO company_settings (id,company_name,address,phone,email,tax_vat_number,receipt_footer,updated_at) VALUES ('company','${options.plantName??NEW}','Beirut, Lebanon','+961 1 234 567','info@dromex.example','TX-1234567','Thank you','2026-10-01T00:00:00.000Z')`);
  const ids={
    a:companyLoad('sand'),b:companyLoad('gravel'),c:companyLoad('sand',{project:'other'}),
    asphalt1:companyLoad('asphalt'),asphaltCancelled:companyLoad('asphalt',{status:'Cancelled'}),asphaltArchived:companyLoad('asphalt',{archived:1}),
    current:companyLoad('sand',{day:'2026-10-05'}),
  };
  db.raw.prepare("UPDATE loads SET company_name='DROMEX Asphalt',company_address='Old street 1' WHERE id IN (?,?,?)").run(ids.asphalt1,ids.asphaltCancelled,ids.asphaltArchived);
  db.raw.prepare("UPDATE loads SET company_name=? WHERE id=?").run(NEW,ids.current);
  const headers=new SqliteCompanyHeaderRepository(db as never);
  return {...fixtures,ids,headers};
}
const names=(db:SqliteTestDatabase)=>(db.raw.prepare('SELECT id,company_name FROM loads ORDER BY id').all() as {id:string;company_name:string}[]);

describe('Phase A: the current Plant Company name is printed',()=>{
  it('gives every own load the current name in the lists behind the PDFs, whatever name it was saved with',async()=>{
    const {db}=await setup();
    const records=await new SqliteCompanyTotalsRepository(db as never).listRecords({...emptyCompanyTotalsFilters()});
    const own=records.filter(record=>record.snapshot.recordType==='company_load');
    expect(own.length).toBe(5);expect(new Set(own.map(record=>record.details!.supplierName))).toEqual(new Set([NEW]));
    expect(supplierBox(own)).toEqual({label:NEW,names:[]});
    expect(new Set(names(db).map(row=>row.company_name))).toEqual(new Set(['DROMEX','DROMEX Asphalt',NEW]));
  });
  it('shows one name on the Company Totals and Project Totals rows',async()=>{
    const {db}=await setup();
    const totals=await new SqliteProjectTotalsRepository(db as never).getProjectTotals('road',{fromDate:'',toDate:''});
    expect(new Set(totals.deliveries.filter(row=>row.source==='company_delivery').map(row=>row.supplierName))).toEqual(new Set([NEW]));
    const company=await new SqliteCompanyTotalsRepository(db as never).getCompanyTotals({...emptyCompanyTotalsFilters()});
    expect(new Set(company.deliveries.filter(row=>row.source==='company_delivery').map(row=>row.supplierName))).toEqual(new Set([NEW]));
  });
  it('uses the name saved on the load only when no Plant Company name is set',async()=>{
    const {db}=await setup({plantName:''});
    const records=await new SqliteCompanyTotalsRepository(db as never).listRecords({...emptyCompanyTotalsFilters()});
    const own=records.filter(record=>record.snapshot.recordType==='company_load');
    expect(new Set(own.map(record=>record.details!.supplierName))).toEqual(new Set(['DROMEX','DROMEX Asphalt',NEW]));
    expect(plantSupplierName(' DROMEX S.A.R.L. ','old')).toBe(NEW);expect(plantSupplierName('  ','old')).toBe('old');expect(plantSupplierName(null,null)).toBeNull();
  });
  it('prints the current name on the Load History PDF rows',()=>{
    const load=(over:Partial<ConfirmedLoad>)=>({id:'x',transactionNumber:'T1',confirmedAt:'2026-10-01T10:00:00',customerName:'C',itemName:'Sand',outputUnitSymbol:'t',billedQuantity:1,status:'Active',correctionHistory:[],companyName:'DROMEX',...over}) as ConfirmedLoad;
    expect(loadHistoryRows([load({}),load({id:'y',transactionNumber:'T2',companyName:'DROMEX Asphalt'})],NEW).map(row=>row.supplier)).toEqual([NEW,NEW]);
    expect(loadHistoryRows([load({})],null)[0]!.supplier).toBe('DROMEX');
  });
  it('puts the current name in the Excel Supplier column',async()=>{
    const {db}=await setup();
    const data=await new SqliteBusinessReportRepository(db as never).getReportData();
    expect(new Set(data.loads.map(row=>row.Supplier))).toEqual(new Set([NEW]));
  });
});

describe('Phase B: the status',()=>{
  it('counts the loads by the name they carry, cancelled and archived included',async()=>{
    const {headers}=await setup();
    expect(await headers.getLoadNameStatus(false)).toEqual({currentName:NEW,totalLoads:7,needing:6,groups:[{oldName:'DROMEX',count:3,detailsOnly:false},{oldName:'DROMEX Asphalt',count:3,detailsOnly:false}]});
  });
  it('adds the loads whose name is current but whose saved details differ, as "details only"',async()=>{
    const {headers}=await setup();
    const status=await headers.getLoadNameStatus(true);
    expect(status.needing).toBe(7);expect(status.groups.at(-1)).toEqual({oldName:NEW,count:1,detailsOnly:true});
  });
  it('is empty when every load already carries the current name',async()=>{
    const {db,headers}=await setup();
    db.raw.exec(`UPDATE loads SET company_name='${NEW}'`);
    expect((await headers.getLoadNameStatus(false)).needing).toBe(0);
  });
  it('plans from pure facts, comparing details without blanks or spaces',()=>{
    const facts=(id:string,name:string,address:string|null)=>({id,companyName:name,address,phone:null,email:null,taxVatNumber:null,receiptFooter:null});
    const plan=planLoadNameUpdate([facts('1','Old',null),facts('2',NEW,'  A  '),facts('3',NEW,'A'),facts('4',' DROMEX S.A.R.L. ',' A ')],NEW,{...emptyCompanyDetails,address:'A'},true);
    expect(plan.ids).toEqual(['1']);expect(plan.status.groups).toEqual([{oldName:'Old',count:1,detailsOnly:false}]);
    expect(detailsDiffer({...emptyCompanyDetails,address:''},emptyCompanyDetails)).toBe(false);
    expect(validateLoadNameUpdate('',{includeDetails:true,note:''})).toEqual(['Save the Plant Company name first.']);
    expect(validateLoadNameUpdate(NEW,{includeDetails:true,note:'x'.repeat(301)})).toEqual(['The note can be at most 300 characters.']);
  });
});

describe('Phase B: the update',()=>{
  const others=(db:SqliteTestDatabase)=>db.raw.prepare('SELECT id,transaction_number,confirmed_at,customer_id,customer_name,project_id,item_name,billed_quantity,unit_price_usd_cents,final_total_usd_cents,payment_status,status,is_archived,load_number FROM loads ORDER BY id').all();
  it('updates the name on every load that carries another one, cancelled and archived loads included, and nothing else',async()=>{
    const {db,headers}=await setup();
    const before=others(db);
    const result=await headers.updateLoadCompanyName({includeDetails:false,note:'  Company renamed  '});
    expect(result.updated).toBe(6);
    expect(new Set(names(db).map(row=>row.company_name))).toEqual(new Set([NEW]));
    expect(others(db)).toEqual(before);
    expect(db.raw.prepare("SELECT company_address a FROM loads WHERE company_name=? AND id IN (SELECT id FROM loads WHERE company_address='Old street 1')").all(NEW).length).toBe(3);
    expect(result.records.map(record=>[record.oldName,record.newName,record.loadsCount,record.detailsIncluded,record.note])).toEqual([['DROMEX',NEW,3,false,'Company renamed'],['DROMEX Asphalt',NEW,3,false,'Company renamed']]);
  });
  it('also copies the address, phone, email, Tax/VAT and receipt footer when asked, including loads whose name was already current',async()=>{
    const {db,headers}=await setup();
    const result=await headers.updateLoadCompanyName({includeDetails:true,note:''});
    expect(result.updated).toBe(7);
    const rows=db.raw.prepare('SELECT company_name n,company_address a,company_phone p,company_email e,company_tax_vat_number t,company_receipt_footer f FROM loads').all();
    expect(rows.every(row=>JSON.stringify(row)===JSON.stringify({n:NEW,a:'Beirut, Lebanon',p:'+961 1 234 567',e:'info@dromex.example',t:'TX-1234567',f:'Thank you'}))).toBe(true);
    expect(result.records.map(record=>[record.oldName,record.loadsCount,record.detailsOnly])).toEqual([['DROMEX',3,false],['DROMEX Asphalt',3,false],[NEW,1,true]]);
  });
  it('keeps a history, newest first, and leaves customer, supplier names, numbers, quantities, prices and payments alone',async()=>{
    const {db,headers}=await setup();
    await headers.updateLoadCompanyName({includeDetails:false,note:'first'});
    const history=await headers.listLoadNameUpdates();
    expect(history.map(record=>[record.oldName,record.newName,record.loadsCount,record.note,record.detailsIncluded,record.detailsOnly])).toEqual([['DROMEX',NEW,3,'first',false,false],['DROMEX Asphalt',NEW,3,'first',false,false]]);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM load_company_name_updates').get()).toEqual({n:2});
    expect((db.raw.prepare("SELECT customer_name FROM loads WHERE id=?").get('l1') as {customer_name:string}).customer_name).toBe('Road Co');
    expect(db.raw.prepare("SELECT COUNT(*) n FROM sync_outbox WHERE entity_type='loadCompanyNameUpdate'").get()).toEqual({n:1});
  });
  it('refuses a second update when nothing is left, writing no history',async()=>{
    const {db,headers}=await setup();
    await headers.updateLoadCompanyName({includeDetails:true,note:''});
    await expect(headers.updateLoadCompanyName({includeDetails:true,note:''})).rejects.toThrow('All loads already carry this name.');
    expect(db.raw.prepare('SELECT COUNT(*) n FROM load_company_name_updates').get()).toEqual({n:3});
  });
  it('is all or nothing: if one load cannot be updated, no load and no history changes',async()=>{
    const {db,headers,ids}=await setup();
    const before=names(db);
    db.raw.exec(`CREATE TRIGGER trg_test_fail BEFORE UPDATE OF company_name ON loads WHEN OLD.id='${ids.c}' BEGIN SELECT RAISE(ABORT,'cannot update this load'); END;`);
    await expect(headers.updateLoadCompanyName({includeDetails:false,note:''})).rejects.toThrow('cannot update this load');
    expect(names(db)).toEqual(before);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM load_company_name_updates').get()).toEqual({n:0});
  });
  it('needs a Plant Company name, and a note of at most 300 characters',async()=>{
    const empty=await setup({plantName:''});
    await expect(empty.headers.updateLoadCompanyName({includeDetails:false,note:''})).rejects.toThrow('Save the Plant Company name first.');
    expect(names(empty.db).some(row=>row.company_name==='DROMEX')).toBe(true);
    const {headers}=await setup();
    await expect(headers.updateLoadCompanyName({includeDetails:false,note:'x'.repeat(301)})).rejects.toThrow('at most 300');
  });
  it('is only ever offered after the confirmation sheet: the screen needs the backup tick and calls the update once',()=>{
    const card=require('node:fs').readFileSync('src/ui/components/LoadCompanyNameCard.tsx','utf8') as string;
    expect(card).toContain('disabled={!backedUp||!needing}');expect(card.match(/updateLoadCompanyName\(/g)?.length).toBe(1);
    expect(card).toContain('I have made a backup');expect(card).toContain('Cancelled and archived loads are updated too');
  });
});

describe('data safety',()=>{
  it('upgrades a version-55 database: the history table is created empty and no load is touched',async()=>{
    const {db}=await setup();
    const before=db.raw.prepare('SELECT * FROM loads ORDER BY id').all();
    db.raw.exec('DROP TABLE load_company_name_updates;PRAGMA user_version=55;');
    await migrateDatabase(db as never);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(56);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM load_company_name_updates').get()).toEqual({n:0});
    expect(db.raw.prepare('SELECT * FROM loads ORDER BY id').all()).toEqual(before);
  });
  it('keeps the update history and the new names through a backup file restore',async()=>{
    const {db,headers}=await setup();
    await headers.updateLoadCompanyName({includeDetails:true,note:'renamed'});
    const folder=mkdtempSync(path.join(os.tmpdir(),'dromex-name-'));folders.push(folder);const file=path.join(folder,'backup.sqlite');
    db.raw.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);
    const restored=new SqliteTestDatabase(file);databases.push(restored);
    expect(restored.raw.prepare('PRAGMA integrity_check').get()).toEqual({integrity_check:'ok'});expect(restored.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const after=new SqliteCompanyHeaderRepository(restored as never);
    expect((await after.listLoadNameUpdates()).map(record=>[record.oldName,record.loadsCount,record.note])).toEqual([['DROMEX',3,'renamed'],['DROMEX Asphalt',3,'renamed'],[NEW,1,'renamed']]);
    expect(new Set(names(restored).map(row=>row.company_name))).toEqual(new Set([NEW]));
    expect((await after.getLoadNameStatus(true)).needing).toBe(0);
  });
});
