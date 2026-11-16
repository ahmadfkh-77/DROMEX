import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteContractQuantitiesRepository} from '../src/data/repositories/SqliteContractQuantitiesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {BACKUP_COUNT_TABLES} from '../src/domain/backup';
import {emptyLoadDraft,type LoadDraft} from '../src/domain/loads';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Site entries (tracking modes, Phase 1). The mode is stored on the target; entries are their own append-only records; every write goes
 * through the repository with a sync_outbox entry in the same transaction. Used is read fresh from the entries, never stored.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
    INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1000,'${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,quarry_enabled,created_at,updated_at) VALUES ('asphalt','cat','Asphalt','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${SEED_TIME}','${SEED_TIME}','driver');
  `);
  const loads=new SqliteLoadRepository(db as never),contracts=new SqliteContractQuantitiesRepository(db as never);
  const company=(extra:Partial<LoadDraft>={})=>loads.confirmLoad({...emptyLoadDraft,vat:{mode:'none',ratePercent:''},recordDate:'2026-10-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'weighbridge',emptyWeightKg:'10000',fullWeightKg:'29500',conversionId:'conversion_kg_ton',unitPriceUsd:'',...extra});
  const automatic=()=>contracts.createItem('road',{name:'Asphalt binder',unitId:'unit_ton',quantity:'300',unitPriceUsd:'62',materialIds:['asphalt']});
  const linkedManual=(materialIds:string[]=['asphalt'])=>contracts.createItem('road',{name:'Curb installed',unitId:'unit_metre',quantity:'1200',unitPriceUsd:'18.5',materialIds,trackingMode:'linked_manual'});
  const manual=()=>contracts.createItem('road',{name:'Site clearance',unitId:'unit_m3',quantity:'8000',unitPriceUsd:'',materialIds:[],trackingMode:'manual'});
  const outbox=(type:string)=>(db.raw.prepare('SELECT COUNT(*) n FROM sync_outbox WHERE entity_type=?').get(type) as {n:number}).n;
  return {db,contracts,company,automatic,linkedManual,manual,outbox};
}

describe('migration 69',()=>{
  it('adds the tracking mode, the site entries table and counts it in backups',async()=>{
    const {db}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(69);
    const columns=(table:string)=>db.raw.prepare(`PRAGMA table_info(${table})`).all().map(row=>(row as {name:string}).name);
    expect(columns('contract_items')).toEqual(expect.arrayContaining(['tracking_mode','entries_segment']));
    expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='contract_item_site_entries'").get()).toBeTruthy();
    expect(BACKUP_COUNT_TABLES).toContain('contract_item_site_entries');
  });

  it('upgrades a version-68 database: every existing target stays automatic and nothing else changes',async()=>{
    const {db,automatic}=await setup();
    const item=await automatic();
    db.raw.exec(`PRAGMA foreign_keys = OFF;DROP TABLE contract_item_site_entries;ALTER TABLE contract_items DROP COLUMN tracking_mode;ALTER TABLE contract_items DROP COLUMN entries_segment;PRAGMA user_version = 68;`);
    const before=db.raw.prepare('SELECT * FROM contract_items WHERE id=?').get(item.id);
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT * FROM contract_items WHERE id=?').get(item.id)).toEqual({...before as object,tracking_mode:'automatic',entries_segment:1});
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
  });

  it('keeps site entries append-only and refuses an invalid mode, kind or a negative entry without a note',async()=>{
    const {db,contracts,manual}=await setup();
    const item=await manual();
    await contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'100',note:''});
    expect(()=>db.raw.exec("UPDATE contract_item_site_entries SET amount=5")).toThrow('cannot change');
    expect(()=>db.raw.exec('DELETE FROM contract_item_site_entries')).toThrow('cannot be deleted');
    expect(()=>db.raw.exec("UPDATE contract_items SET tracking_mode='weird'")).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO contract_item_site_entries (id,contract_item_id,entries_segment,kind,entry_date,amount,note,created_at) VALUES ('x','${item.id}',1,'entry','2026-10-20',-5,NULL,'${SEED_TIME}')`)).toThrow();
    expect(()=>db.raw.exec(`INSERT INTO contract_item_site_entries (id,contract_item_id,entries_segment,kind,entry_date,amount,note,created_at) VALUES ('y','${item.id}',1,'other','2026-10-20',5,NULL,'${SEED_TIME}')`)).toThrow();
  });
});

describe('creating each mode',()=>{
  it('AUTOMATIC is the default and behaves as before',async()=>{
    const {contracts,automatic,company}=await setup();
    const item=await automatic();
    expect(item.trackingMode).toBe('automatic');
    const load=await company();
    await contracts.linkLoad(item.id,{source:'company',loadId:load.id},'Older');
    expect((await contracts.getItem(item.id)).usage).toMatchObject({tracking:'automatic',fromLoads:19.5,used:19.5});
  });

  it('LINKED MANUAL keeps its materials (or none) and starts at zero',async()=>{
    const {contracts,linkedManual}=await setup();
    const withMaterial=await linkedManual(),without=await linkedManual([]);
    expect(withMaterial).toMatchObject({trackingMode:'linked_manual',materialIds:['asphalt']});
    expect(without).toMatchObject({trackingMode:'linked_manual',materialIds:[]});
    expect((await contracts.getItem(withMaterial.id)).usage).toMatchObject({tracking:'linked_manual',used:0,percentUsed:0});
  });

  it('MANUAL has no material and starts at zero',async()=>{
    const {contracts,manual}=await setup();
    const item=await manual();
    expect(item).toMatchObject({trackingMode:'manual',materialIds:[]});
    expect((await contracts.getItem(item.id)).usage).toMatchObject({tracking:'manual',used:0});
  });

  it('refuses a material on a MANUAL target and a missing material on an AUTOMATIC one',async()=>{
    const {contracts}=await setup();
    await expect(contracts.createItem('road',{name:'X',unitId:'unit_ton',quantity:'1',unitPriceUsd:'',materialIds:['asphalt'],trackingMode:'manual'})).rejects.toThrow('no material');
    await expect(contracts.createItem('road',{name:'X',unitId:'unit_ton',quantity:'1',unitPriceUsd:'',materialIds:[]})).rejects.toThrow('Link at least one material');
  });

  it('records the mode in the created history line and the sync entry',async()=>{
    const {db,linkedManual,outbox}=await setup();
    const item=await linkedManual();
    const line=db.raw.prepare("SELECT details_json FROM contract_item_history WHERE contract_item_id=? AND kind='created'").get(item.id) as {details_json:string};
    expect(JSON.parse(line.details_json)).toMatchObject({trackingMode:'linked_manual'});
    expect(outbox('contractItem')).toBe(1);
  });
});

describe('site entries',()=>{
  it('adds dated entries; used is their sum, read fresh each time, with a history of entries',async()=>{
    const {contracts,manual,outbox,db}=await setup();
    const item=await manual();
    await contracts.addSiteEntry(item.id,{date:'2026-10-19',amount:'600',note:'North strip'});
    await contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'700',note:''});
    const detail=await contracts.getItem(item.id);
    expect(detail.usage).toMatchObject({used:1300,siteEntriesTotal:1300,percentUsed:16.3});
    expect(detail.usage.siteEntries.map(value=>[value.entryDate,value.amount,value.note,value.kind])).toEqual([['2026-10-19',600,'North strip','entry'],['2026-10-20',700,null,'entry']]);
    expect((await contracts.listSiteEntries(item.id)).map(value=>value.amount)).toEqual([700,600]);
    expect(outbox('contractSiteEntry')).toBe(2);
    expect((db.raw.prepare('SELECT COUNT(*) n FROM contract_item_site_entries').get() as {n:number}).n).toBe(2);
  });

  it('refuses an entry on an AUTOMATIC target, a cancelled target, a future day and a day before the project began',async()=>{
    const {contracts,automatic,manual}=await setup();
    const auto=await automatic();
    await expect(contracts.addSiteEntry(auto.id,{date:'2026-10-20',amount:'5',note:''})).rejects.toThrow('calculated from loads');
    const item=await manual();
    await expect(contracts.addSiteEntry(item.id,{date:'2026-10-25',amount:'5',note:''})).rejects.toThrow('today or a past day');
    await expect(contracts.addSiteEntry(item.id,{date:'2026-07-31',amount:'5',note:''})).rejects.toThrow('before the project');
    await contracts.cancelItem(item.id,'Mistake');
    await expect(contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'5',note:''})).rejects.toThrow('cancelled');
  });

  it('a negative correction needs a reason, reduces used, and cannot take used below zero',async()=>{
    const {contracts,manual}=await setup();
    const item=await manual();
    await contracts.addSiteEntry(item.id,{date:'2026-10-19',amount:'120',note:''});
    await expect(contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'-10',note:''})).rejects.toThrow('reason');
    await contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'-10',note:'Counted twice'});
    expect((await contracts.getItem(item.id)).usage.used).toBe(110);
    await expect(contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'-500',note:'x'})).rejects.toThrow('below zero');
    expect((await contracts.getItem(item.id)).usage.used).toBe(110);
  });

  it('shows the 90% and 100% warnings the same way as an automatic target and never blocks an entry',async()=>{
    const {contracts,linkedManual}=await setup();
    const item=await linkedManual();
    await contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'1080',note:''});
    expect((await contracts.getItem(item.id)).usage).toMatchObject({warning:'near',percentUsed:90});
    await contracts.addSiteEntry(item.id,{date:'2026-10-21',amount:'120',note:''});
    expect((await contracts.getItem(item.id)).usage.warning).toBe('full');
    await contracts.addSiteEntry(item.id,{date:'2026-10-22',amount:'30',note:''});
    expect((await contracts.getItem(item.id)).usage).toMatchObject({warning:'over',overBy:30,used:1230});
  });

  it('LINKED MANUAL still lists its linked loads in the material unit but never adds them to used',async()=>{
    const {contracts,linkedManual,company,db}=await setup();
    const item=await linkedManual();
    const load=await company();
    await contracts.linkLoad(item.id,{source:'company',loadId:load.id},'For reference');
    await contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'100',note:''});
    const {usage}=await contracts.getItem(item.id);
    expect(usage.used).toBe(100);
    expect(usage.deliveredFromLoads).toEqual([{materialId:'asphalt',unitId:'unit_ton',unitSymbol:'t',quantity:19.5,loadCount:1}]);
    expect(db.raw.prepare('SELECT billed_quantity FROM loads WHERE id=?').get(load.id)).toEqual({billed_quantity:19.5});
  });

  it('does not touch loads, stock or batches',async()=>{
    const {db,contracts,manual}=await setup();
    const item=await manual();
    const count=(table:string)=>(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;
    const before=['loads','quarry_purchases','stock_batches','stock_use','fuel_batches'].map(count);
    await contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'5',note:''});
    expect(['loads','quarry_purchases','stock_batches','stock_use','fuel_batches'].map(count)).toEqual(before);
  });

  it('an entry makes later edits need a reason, and the mode cannot be changed yet',async()=>{
    const {contracts,manual}=await setup();
    const item=await manual();
    expect((await contracts.getItem(item.id)).editNeedsReason).toBe(false);
    await contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'5',note:''});
    expect((await contracts.getItem(item.id)).editNeedsReason).toBe(true);
    await expect(contracts.editItem(item.id,{name:'Site clearance',unitId:'unit_m3',quantity:'9000',unitPriceUsd:'',materialIds:[],trackingMode:'manual'},'')).rejects.toThrow('reason');
    await expect(contracts.editItem(item.id,{name:'Site clearance',unitId:'unit_m3',quantity:'9000',unitPriceUsd:'',materialIds:['asphalt'],trackingMode:'linked_manual'},'Change')).rejects.toThrow('later phase');
    expect(await contracts.editItem(item.id,{name:'Site clearance',unitId:'unit_m3',quantity:'9000',unitPriceUsd:'',materialIds:[]},'Variation order')).toMatchObject({quantity:9000,trackingMode:'manual'});
  });
});

describe('every reader sees the same used figure',()=>{
  it('the list, the totals, the daily progress, the Company Daily Report row and the final report agree for each mode',async()=>{
    const {contracts,linkedManual,manual,automatic,company}=await setup();
    const auto=await automatic(),lm=await linkedManual(),m=await manual();
    const load=await company();
    await contracts.linkLoad(auto.id,{source:'company',loadId:load.id},'Older');
    await contracts.addSiteEntry(lm.id,{date:'2026-10-20',amount:'300',note:''});
    await contracts.addSiteEntry(m.id,{date:'2026-10-20',amount:'400',note:''});
    const expected={[auto.id]:19.5,[lm.id]:300,[m.id]:400};
    const list=await contracts.listProject('road');
    for(const row of list.rows)expect(row.usage.used).toBe(expected[row.item.id]);
    for(const row of await contracts.totalsTargets('road',null))expect(row.counted).toBe(expected[row.id]);
    for(const row of await contracts.targetTableOn('road','2026-10-20'))expect(row.used).toBe(expected[row.itemId]);
    for(const row of (await contracts.progressOn('road','2026-10-20')).targets)expect(row.usage.used).toBe(expected[row.item.id]);
    for(const row of (await contracts.finalReport('road')).targets)expect(row.usage.used).toBe(expected[row.item.id]);
    expect(list.rows.map(row=>row.usage.tracking).sort()).toEqual(['automatic','linked_manual','manual']);
  });
});
