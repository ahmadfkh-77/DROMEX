import {readFileSync} from 'node:fs';
import {afterEach,describe,expect,it} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import {SqliteDocumentSignerRepository} from '../src/data/repositories/SqliteDocumentSignerRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {BACKUP_COUNT_TABLES} from '../src/domain/backup';
import {emptyCompanyTotalsFilters} from '../src/domain/companyTotals';
import {correctionBaseline,correctionChanges,correctionLocks,loadLocalDate,validateLoadCorrection} from '../src/domain/loadCorrection';
import {emptyLoadDraft,type ConfirmedLoad,type LoadCorrectionDraft,type LoadDraft} from '../src/domain/loads';
import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * Phase 4. Every field of a confirmed load can be corrected. The load is saved exactly as it was before each
 * correction, the load number and transaction number never change, a reason is required, and customer, project,
 * unit and price are locked while the load has active payments.
 */
const STROKE='M 20.0 80.5 L 60.2 40.0 L 110.1 90.4';
const DRIVER_STROKE='M 10.0 60.0 L 50.0 20.0 L 90.0 70.0';
const NEW_STROKE='M 5.0 5.0 L 70.0 60.0';
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const count=(db:SqliteTestDatabase,table:string)=>(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;
const rowOf=(db:SqliteTestDatabase,id:string)=>db.raw.prepare('SELECT * FROM loads WHERE id=?').get(id) as Record<string,unknown>;

async function setup(){
  const database=await migratedDatabaseWithProject(databases);
  database.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
    INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1000,'${SEED_TIME}');
    INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust_b','company','Beirut Builders',0,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('other','cust_b','Coastal Road','Tyre','active','2026-08-10','${SEED_TIME}','${SEED_TIME}',0);
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,created_at,updated_at) VALUES ('asphalt','cat','Asphalt','unit_ton',1,'${SEED_TIME}','${SEED_TIME}'),('sand','cat','Sand','unit_ton',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}'),('truck2','C456',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${SEED_TIME}','${SEED_TIME}','driver'),('driver2','Rami',1,'${SEED_TIME}','${SEED_TIME}','driver');
  `);
  const loads=new SqliteLoadRepository(database as never);
  const signers=new SqliteDocumentSignerRepository(database as never);
  const owner=await signers.createSigner({name:'Ahmad Fakih',jobTitle:'Owner',department:'DROMEX'});await signers.saveSignature(owner.id,[STROKE]);
  await signers.setDeliverySigner({signerId:owner.id,display:'name_with_signature'});
  const kgM3=await loads.createConversion({name:'Kilograms to cubic metre',inputUnitId:'unit_kg',outputUnitId:'unit_m3',inputQuantity:1000,outputQuantity:0.4167,decimalPlaces:3});
  const tonM3=await loads.createConversion({name:'Ton to cubic metre',inputUnitId:'unit_ton',outputUnitId:'unit_m3',inputQuantity:1,outputQuantity:0.4167,decimalPlaces:3});
  const weighed:LoadDraft={...emptyLoadDraft,recordDate:'2026-08-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'weighbridge',emptyWeightKg:'10000',fullWeightKg:'29500',conversionId:'conversion_kg_ton',unitPriceUsd:'180',notes:'Original',driverSignaturePaths:[DRIVER_STROKE]};
  const load=await loads.confirmLoad(weighed);
  const context=()=>loads.getCorrectionContext(load.id);
  const base=(l:ConfirmedLoad=load)=>correctionBaseline(l);
  const correct=(extra:Partial<LoadCorrectionDraft>,l:ConfirmedLoad=load)=>loads.correctLoad(l.id,{...base(l),correctionReason:'Check',...extra});
  return {database,loads,signers,owner,kgM3,tonM3,weighed,load,context,base,correct};
}

describe('migration 52',()=>{
  it('adds the saved-originals table, append-only, and counts it in backups',async()=>{
    const {database}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(52);
    expect((database.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect(database.raw.prepare('PRAGMA table_info(load_versions)').all().map(row=>(row as {name:string}).name)).toEqual(expect.arrayContaining(['id','load_id','version','snapshot_json','reason','changes_json','corrected_at']));
    expect(BACKUP_COUNT_TABLES).toContain('load_versions');
  });
  it('upgrades a version-51 database leaving every load identical',async()=>{
    const {database,load}=await setup();
    const before=rowOf(database,load.id);
    database.raw.exec('PRAGMA foreign_keys = OFF;DROP TABLE load_versions;PRAGMA user_version = 51;');
    await migrateDatabase(database as never);
    expect(rowOf(database,load.id)).toEqual(before);
    expect(count(database,'load_versions')).toBe(0);
  });
  it('refuses to change or delete a saved original',async()=>{
    const {database,correct}=await setup();
    await correct({notes:'Changed'});
    expect(()=>database.raw.exec("UPDATE load_versions SET reason='x'")).toThrow('cannot change');
    expect(()=>database.raw.exec('DELETE FROM load_versions')).toThrow('cannot be deleted');
  });
});

describe('the saved original',()=>{
  it('keeps the load exactly as it was before each correction, oldest first',async()=>{
    const {database,loads,load,correct}=await setup();
    const before=rowOf(database,load.id);
    const first=await correct({notes:'First change',correctionReason:'First'});
    const afterFirst=rowOf(database,load.id);
    await correct({notes:'Second change',correctionReason:'Second'},first);
    const versions=database.raw.prepare('SELECT * FROM load_versions WHERE load_id=? ORDER BY version').all(load.id) as {version:number;snapshot_json:string;reason:string;changes_json:string}[];
    expect(versions.map(value=>[value.version,value.reason])).toEqual([[1,'First'],[2,'Second']]);
    expect(JSON.parse(versions[0]!.snapshot_json)).toEqual(before);
    expect(JSON.parse(versions[1]!.snapshot_json)).toEqual(afterFirst);
    expect(JSON.parse(versions[0]!.changes_json)).toEqual([{field:'Notes',originalValue:'Original',newValue:'First change'}]);
    expect((await loads.getCorrectionContext(load.id)).versions.map(value=>value.version)).toEqual([1,2]);
  });
  it('is also saved by the older partial form of a correction',async()=>{
    const {database,loads,load}=await setup();
    await loads.correctLoad(load.id,{requestedQuantityKg:'',emptyWeightKg:'10000',fullWeightKg:'29500',directQuantity:'',unitPriceUsd:'200.00',destinationAddress:'',notes:'Original',correctionReason:'Legacy form'});
    expect(count(database,'load_versions')).toBe(1);
  });
  it('is not created when nothing is saved: a failed or empty correction leaves no original behind',async()=>{
    const {database,load,correct}=await setup();
    await expect(correct({})).rejects.toThrow('No information was changed.');
    await expect(correct({notes:'X',correctionReason:''})).rejects.toThrow('Correction reason is required.');
    await expect(correct({fullWeightKg:'5'})).rejects.toThrow('Full weight must be greater than empty weight.');
    expect(count(database,'load_versions')).toBe(0);
    expect(rowOf(database,load.id).notes).toBe('Original');
  });
});

describe('correcting everything',()=>{
  it('changes date, customer, project, item, driver, truck, quantity, unit, price and notes, and keeps the numbers',async()=>{
    const {database,load,kgM3,correct}=await setup();
    const enteredBefore=rowOf(database,load.id).entered_at;
    const corrected=await correct({
      recordDate:'2026-08-18',customerId:'cust_b',projectId:'other',destinationAddress:'',itemId:'sand',
      driverId:'',driverName:'Walid Khoury',truckId:'',truckPlate:' b 884211 ',
      emptyWeightKg:'9000',fullWeightKg:'21000',requestedQuantityKg:'12000',conversionId:kgM3.id,unitPriceUsd:'150',notes:'  Re-weighed ',correctionReason:'Everything was entered wrongly',
    });
    expect(corrected).toMatchObject({customerName:'Beirut Builders',projectName:'Coastal Road',itemName:'Sand',driverName:'Walid Khoury',driverId:null,truckPlate:'B 884211',emptyWeightKg:9000,fullWeightKg:21000,netWeightKg:12000,requestedQuantityKg:12000,conversionName:'Kilograms to cubic metre',outputUnitSymbol:'m³',unitPriceUsd:150,notes:'Re-weighed'});
    expect(corrected.billedQuantity).toBeCloseTo(5.0,3);
    expect(corrected.loadNumber).toBe(load.loadNumber);expect(corrected.transactionNumber).toBe(load.transactionNumber);
    expect(rowOf(database,load.id).entered_at).toBe(enteredBefore);
    expect(loadLocalDate(corrected.confirmedAt)).toBe('2026-08-18');
    const oldTime=new Date(load.confirmedAt),newTime=new Date(corrected.confirmedAt);
    expect([newTime.getHours(),newTime.getMinutes(),newTime.getSeconds()]).toEqual([oldTime.getHours(),oldTime.getMinutes(),oldTime.getSeconds()]);
    expect(database.raw.prepare('SELECT driver_profile_id,truck_profile_id FROM loads WHERE id=?').get(load.id)).toEqual({driver_profile_id:null,truck_profile_id:null});
    expect(corrected.correctionHistory.at(-1)!.changes.map(change=>change.field)).toEqual(expect.arrayContaining(['Record date','Customer','Project','Item','Driver / Operator','Truck plate','Empty weight kg','Full weight kg','Requested quantity kg','Unit','Conversion','Unit price','Notes','Driver signature']));
  });

  it('counts the corrected load in its new unit and date in Company Totals',async()=>{
    const {database,kgM3,correct}=await setup();
    await correct({conversionId:kgM3.id});
    const records=await new SqliteCompanyTotalsRepository(database as never).listRecords(emptyCompanyTotalsFilters(),10);
    expect(records.map(value=>[value.snapshot.unitSymbol,value.snapshot.quantity])).toEqual([['m³',expect.closeTo(8.126,3)]]);
  });

  it('can move a load to a saved driver and a saved truck, and back to typed values',async()=>{
    const {database,load,correct}=await setup();
    const saved=await correct({driverId:'driver2',driverName:'Rami',truckId:'truck2',truckPlate:'C456'});
    expect(database.raw.prepare('SELECT driver_profile_id,truck_profile_id,driver_name,truck_plate FROM loads WHERE id=?').get(load.id)).toEqual({driver_profile_id:'driver2',truck_profile_id:'truck2',driver_name:'Rami',truck_plate:'C456'});
    await correct({driverId:'',driverName:'Typed Person',truckId:'',truckPlate:'Z 9'},saved);
    expect(database.raw.prepare('SELECT driver_profile_id,truck_profile_id FROM loads WHERE id=?').get(load.id)).toEqual({driver_profile_id:null,truck_profile_id:null});
  });

  it('corrects a plain direct load to use a conversion and back, counting it in the converted unit',async()=>{
    const {loads,tonM3,weighed,database}=await setup();
    const direct=await loads.confirmLoad({...weighed,quantityMethod:'direct',directQuantity:'10',directUnitId:'unit_ton',emptyWeightKg:'',fullWeightKg:'',conversionId:'',driverSignaturePaths:[]});
    const converted=await loads.correctLoad(direct.id,{...correctionBaseline(direct),conversionId:tonM3.id,correctionReason:'Convert'});
    expect(converted).toMatchObject({quantityMethod:'direct',directQuantity:10,directUnitSymbol:'t',conversionRule:'1 t = 0.4167 m³',outputUnitSymbol:'m³',billedQuantity:4.167});
    const back=await loads.correctLoad(direct.id,{...correctionBaseline(converted),conversionId:'',correctionReason:'Undo'});
    expect(back).toMatchObject({directQuantity:10,conversionRule:null,outputUnitSymbol:'t',billedQuantity:10});
    expect(database.raw.prepare('SELECT conversion_rule FROM loads WHERE id=?').get(direct.id)).toEqual({conversion_rule:'Entered directly'});
  });

  it('keeps a weighed load weighed and a direct load direct, whatever else is corrected',async()=>{
    const {loads,weighed,correct}=await setup();
    expect((await correct({notes:'x',directQuantity:'99'})).quantityMethod).toBe('weighbridge');
    const direct=await loads.confirmLoad({...weighed,quantityMethod:'direct',directQuantity:'10',directUnitId:'unit_ton',emptyWeightKg:'',fullWeightKg:'',conversionId:'',driverSignaturePaths:[]});
    expect((await loads.correctLoad(direct.id,{...correctionBaseline(direct),notes:'y',emptyWeightKg:'1',fullWeightKg:'9',correctionReason:'z'})).quantityMethod).toBe('direct');
  });
});

describe('validation',()=>{
  it('applies the Make Receipt checks to the corrected values',async()=>{
    const {load,context,base}=await setup();
    const {options}=await context();
    const issues=(extra:Partial<LoadCorrectionDraft>)=>validateLoadCorrection(load,{...base(),correctionReason:'x',...extra},options,0);
    expect(issues({recordDate:'2026-07-30'})).toContain('The record date must be within the selected project dates.');
    expect(issues({recordDate:'2999-01-01'})).toContain('Record date must be today or a valid past date.');
    expect(issues({projectId:'other'})).toContain('The selected project belongs to another customer.');
    expect(issues({driverName:' ',driverId:''})).toContain('Driver or operator name is required.');
    expect(issues({truckPlate:'',truckId:''})).toContain('Truck plate is required.');
    expect(issues({unitPriceUsd:'1.999'})).toContain('Unit price must be zero or more with no more than two decimals.');
    expect(issues({})).toEqual([]);
  });
  it('does not fail an untouched old date, so an old load can still be corrected in other ways',async()=>{
    const {database,loads,load,context}=await setup();
    database.raw.prepare("UPDATE projects SET start_date='2026-09-01' WHERE id='road'").run();
    const {options}=await context();
    expect(validateLoadCorrection(load,{...correctionBaseline(load),correctionReason:'x',notes:'New'},options,0)).toEqual([]);
    void loads;
  });
  it('refuses a cancelled load, and a missing reason first',async()=>{
    const {loads,load,correct}=await setup();
    await loads.cancelLoad(load.id,'Duplicate');
    await expect(correct({notes:'X'})).rejects.toThrow('A cancelled load cannot be corrected.');
  });
});

describe('active payments',()=>{
  const pay=(database:SqliteTestDatabase,id:string,cents=50000)=>database.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at) VALUES ('p1','load','${id}',${cents},'2026-08-21','Active','${SEED_TIME}')`);
  it('locks customer, project, unit and price, and leaves everything else correctable',async()=>{
    const {database,load,correct,kgM3,context}=await setup();
    pay(database,load.id);
    expect(correctionLocks((await context()).activePaymentCents)).toEqual({customer:true,project:true,unit:true,price:true});
    await expect(correct({customerId:'cust_b',projectId:'other'})).rejects.toThrow('customer, project cannot change while this load has active payments');
    await expect(correct({conversionId:kgM3.id})).rejects.toThrow('unit cannot change');
    await expect(correct({unitPriceUsd:'150'})).rejects.toThrow('price cannot change');
    const changed=await correct({recordDate:'2026-08-19',itemId:'sand',driverId:'',driverName:'Typed',truckPlate:'Z 1',truckId:'',notes:'Allowed',emptyWeightKg:'10000',fullWeightKg:'25000'});
    expect(changed).toMatchObject({itemName:'Sand',driverName:'Typed',notes:'Allowed',netWeightKg:15000});
  });
  it('recalculates the payment status when the quantity changes, and never touches the payments',async()=>{
    const {database,load,correct}=await setup();
    pay(database,load.id,50000);
    const before=database.raw.prepare('SELECT * FROM payment_entries').all();
    const changed=await correct({fullWeightKg:'20000'});
    expect(changed.finalTotalUsd).toBeCloseTo(1980,2);
    expect(changed.paymentStatus).toBe('Partially Paid');
    expect(database.raw.prepare('SELECT * FROM payment_entries').all()).toEqual(before);
  });
  it('lifts the lock once the payments are cancelled',async()=>{
    const {database,load,correct}=await setup();
    pay(database,load.id);
    database.raw.exec("UPDATE payment_entries SET status='Cancelled'");
    await expect(correct({unitPriceUsd:'150'})).resolves.toMatchObject({unitPriceUsd:150});
    void load;
  });
});

describe('signatures in a correction',()=>{
  it('removes the old driver signature when the driver changes, and keeps it otherwise',async()=>{
    const {load,correct}=await setup();
    const kept=await correct({notes:'No driver change'});
    expect(kept.signaturePaths).toEqual([DRIVER_STROKE]);
    const changed=await correct({driverId:'',driverName:'New Driver'},kept);
    expect(changed).toMatchObject({signatureStatus:'Unsigned',signaturePaths:[]});
    expect(changed.correctionHistory.at(-1)!.changes.find(change=>change.field==='Driver signature')).toEqual({field:'Driver signature',originalValue:'Signed',newValue:'Unsigned'});
    void load;
  });
  it('re-signs the driver, even without changing anything else, and saves the old signature in the original',async()=>{
    const {database,load,correct}=await setup();
    const signed=await correct({driverSignaturePaths:[NEW_STROKE]});
    expect(signed).toMatchObject({signatureStatus:'Signed',signaturePaths:[NEW_STROKE]});
    expect(signed.correctionHistory.at(-1)!.changes).toEqual([{field:'Driver signature',originalValue:'Signed',newValue:'Re-signed'}]);
    expect(JSON.parse((database.raw.prepare('SELECT snapshot_json FROM load_versions').get() as {snapshot_json:string}).snapshot_json).signature_json).toBe(JSON.stringify([DRIVER_STROKE]));
    void load;
  });
  it('replaces and removes the supplier signature, and refuses a disabled signer',async()=>{
    const {load,signers,owner,correct}=await setup();
    const other=await signers.createSigner({name:'Site Manager',jobTitle:'Manager',department:''});
    const replaced=await correct({supplierSignature:{signerId:other.id,display:'name_only'}});
    expect(replaced.supplierSignature).toMatchObject({name:'Site Manager',display:'name_only'});
    expect(replaced.correctionHistory.at(-1)!.changes).toEqual([{field:'Supplier signature',originalValue:'Ahmad Fakih',newValue:'Site Manager (name only)'}]);
    const removed=await correct({supplierSignature:null},replaced);
    expect(removed.supplierSignature).toBeNull();
    await signers.setSignerActive(owner.id,false);
    await expect(correct({supplierSignature:{signerId:owner.id,display:'name_only'}},removed)).rejects.toThrow('disabled');
    void load;
  });
  it('treats choosing the signer the load already has as no change',async()=>{
    const {load,owner,correct}=await setup();
    await expect(correct({supplierSignature:{signerId:owner.id,display:'name_with_signature'}})).rejects.toThrow('No information was changed.');
    void load;
  });
});

describe('the Correct this load context',()=>{
  it('still offers this load\'s own customer, project, item, conversion and unit after they are archived or deactivated',async()=>{
    const {database,context}=await setup();
    database.raw.exec("UPDATE customers SET is_active=0 WHERE id='customer';UPDATE projects SET status='completed' WHERE id='road';UPDATE catalog_items SET loads_enabled=0,quarry_enabled=1 WHERE id='asphalt';UPDATE conversion_options SET is_active=0 WHERE id='conversion_kg_ton'");
    const {options}=await context();
    expect(options.customers.map(value=>value.id)).toContain('customer');
    expect(options.projects.map(value=>value.id)).toContain('road');
    expect(options.items.map(value=>value.id)).toContain('asphalt');
    expect(options.conversions.map(value=>value.id)).toContain('conversion_kg_ton');
  });
  it('reports payments, issued documents and saved originals',async()=>{
    const {database,load,context}=await setup();
    expect(await context()).toMatchObject({activePaymentCount:0,activePaymentCents:0,versions:[],issuedDocumentCount:0});
    database.raw.exec(`INSERT INTO payment_entries (id,target_type,load_id,amount_usd_cents,payment_date,status,created_at) VALUES ('p1','load','${load.id}',2500,'2026-08-21','Active','${SEED_TIME}')`);
    expect(await context()).toMatchObject({activePaymentCount:1,activePaymentCents:2500});
  });
  it('lists no changes for an untouched form, and the same changes the repository saves',async()=>{
    const {load,context,base,correct}=await setup();
    const {options}=await context();
    expect(correctionChanges(load,base(),options)).toEqual([]);
    const draft={...base(),notes:'Different',unitPriceUsd:'175'};
    const listed=correctionChanges(load,draft,options);
    const saved=await correct({notes:'Different',unitPriceUsd:'175'});
    expect(saved.correctionHistory.at(-1)!.changes).toEqual(listed);
  });
});

describe('the Correct this load screen',()=>{
  const screen=readFileSync('src/ui/components/LoadCorrectionForm.tsx','utf8');
  it('uses the calendar date picker for the record date',()=>{
    expect(screen).toContain('<DatePickerField label="" value={form.recordDate');expect(screen).toContain('Record date *');
    expect(screen).toContain('minDate=');
  });
  it('follows the approved layout and wording',()=>{
    for(const text of ['Confirmed records are never edited directly. Everything can be corrected: your change is saved with the original in the history, and a reason is required.','number="01"','number="02"','number="03"','number="04"','CHANGED','UNIT CHANGED','LOCKED · PAYMENTS','Re-sign Supplier','Re-sign Driver','Reason for correction *','Save Correction','Correction history','ORIGINAL SAVED','Save this correction?'])expect(screen).toContain(text);
  });
  it('is reached from the load detail as "Correct This Load"',()=>{
    expect(readFileSync('src/ui/screens/LoadHistoryScreen.tsx','utf8')).toContain('label="Correct This Load"');
  });
});
