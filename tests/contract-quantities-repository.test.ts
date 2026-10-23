import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteContractQuantitiesRepository} from '../src/data/repositories/SqliteContractQuantitiesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteQuarryRepository} from '../src/data/repositories/SqliteQuarryRepository';
import {BACKUP_COUNT_TABLES} from '../src/domain/backup';
import {correctionBaseline} from '../src/domain/loadCorrection';
import {emptyLoadDraft,type ConfirmedLoad,type LoadCorrectionDraft,type LoadDraft} from '../src/domain/loads';
import {emptyQuarryPurchaseDraft,type QuarryPurchaseDraft} from '../src/domain/quarry';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-522 Phase B. Contract items are saved with their material links, adjustments and an append-only history; loads point at the item they
 * count toward through a nullable contract_item_id. Used is read fresh from the loads, so a correction or a cancellation shows at once.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

const NEW_TABLES=['contract_items','contract_item_materials','contract_item_adjustments','contract_item_history'];

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
    INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1000,'${SEED_TIME}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('other','customer','Coastal Road','Tyre','active','2026-08-10','${SEED_TIME}','${SEED_TIME}',0);
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,quarry_enabled,created_at,updated_at) VALUES
      ('asphalt','cat','Asphalt','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}'),('sand','cat','Sand','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}'),('base','cat','Base course','unit_m3',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Majbal Quarry',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${SEED_TIME}','${SEED_TIME}','driver');
  `);
  const loads=new SqliteLoadRepository(db as never),quarry=new SqliteQuarryRepository(db as never),contracts=new SqliteContractQuantitiesRepository(db as never);
  const company=(extra:Partial<LoadDraft>={})=>loads.confirmLoad({...emptyLoadDraft,vat:{mode:'none',ratePercent:''},recordDate:'2026-10-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'weighbridge',emptyWeightKg:'10000',fullWeightKg:'29500',conversionId:'conversion_kg_ton',unitPriceUsd:'',...extra});
  const supplier=(extra:Partial<QuarryPurchaseDraft>={})=>quarry.confirmPurchase({...emptyQuarryPurchaseDraft,recordDate:'2026-10-21',supplierId:'sup',destinationType:'project',projectId:'road',itemId:'asphalt',unitId:'unit_ton',quantityCubicMetres:'12',deliveryMethod:'supplier',supplierTruckPlate:'T-1',...extra});
  const correctCompany=(load:ConfirmedLoad,extra:Partial<LoadCorrectionDraft>)=>loads.correctLoad(load.id,{...correctionBaseline(load),correctionReason:'Wrong entry',...extra});
  const asphaltItem=()=>contracts.createItem('road',{name:'Asphalt binder',unitId:'unit_ton',quantity:'300',unitPriceUsd:'62',materialIds:['asphalt']});
  const outbox=(type:string)=>(db.raw.prepare('SELECT COUNT(*) n FROM sync_outbox WHERE entity_type=?').get(type) as {n:number}).n;
  const history=(itemId:string)=>db.raw.prepare('SELECT kind,reason FROM contract_item_history WHERE contract_item_id=? ORDER BY created_at,rowid').all(itemId) as {kind:string;reason:string|null}[];
  return {db,loads,quarry,contracts,company,supplier,correctCompany,asphaltItem,outbox,history};
}

describe('migration 67',()=>{
  it('adds the contract tables and an empty contract_item_id on both load tables, and counts the tables in backups',async()=>{
    const {db}=await setup();
    expect(DATABASE_VERSION).toBe(67);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(67);
    for(const table of NEW_TABLES)expect(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)).toBeTruthy();
    const columns=(table:string)=>db.raw.prepare(`PRAGMA table_info(${table})`).all().map(row=>(row as {name:string}).name);
    expect(columns('loads')).toContain('contract_item_id');
    expect(columns('quarry_purchases')).toContain('contract_item_id');
    expect(BACKUP_COUNT_TABLES).toEqual(expect.arrayContaining(NEW_TABLES));
  });

  it('upgrades a version-66 database leaving every load and supplier load identical and not linked',async()=>{
    const {db,company,supplier}=await setup();
    const load=await company(),purchase=await supplier();
    db.raw.exec(`PRAGMA foreign_keys = OFF;
      DROP TABLE contract_item_history;DROP TABLE contract_item_adjustments;DROP TABLE contract_item_materials;DROP TABLE contract_items;
      DROP INDEX idx_loads_contract_item;DROP INDEX idx_quarry_purchases_contract_item;
      ALTER TABLE loads DROP COLUMN contract_item_id;ALTER TABLE quarry_purchases DROP COLUMN contract_item_id;PRAGMA user_version = 66;`);
    const before={load:db.raw.prepare('SELECT * FROM loads WHERE id=?').get(load.id),purchase:db.raw.prepare('SELECT * FROM quarry_purchases WHERE id=?').get(purchase.id)};
    await migrateDatabase(db as never);
    expect(db.raw.prepare('SELECT * FROM loads WHERE id=?').get(load.id)).toEqual({...before.load as object,contract_item_id:null});
    expect(db.raw.prepare('SELECT * FROM quarry_purchases WHERE id=?').get(purchase.id)).toEqual({...before.purchase as object,contract_item_id:null});
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(67);
  });

  it('keeps the history and the adjustments append-only',async()=>{
    const {db,asphaltItem,contracts}=await setup();
    const item=await asphaltItem();
    await contracts.addAdjustment(item.id,{amount:'2',reason:'Re-counted on site'});
    expect(()=>db.raw.exec("UPDATE contract_item_history SET reason='x'")).toThrow('cannot change');
    expect(()=>db.raw.exec('DELETE FROM contract_item_history')).toThrow('cannot be deleted');
    expect(()=>db.raw.exec('UPDATE contract_item_adjustments SET amount=5')).toThrow('cannot change');
    expect(()=>db.raw.exec('DELETE FROM contract_item_adjustments')).toThrow('cannot be deleted');
  });

  it('survives a backup copy of the database file with every row',async()=>{
    const {db,asphaltItem,contracts,company}=await setup();
    const item=await asphaltItem();const load=await company();
    await contracts.linkLoad(item.id,{source:'company',loadId:load.id},'Recorded before contracts');
    const folder=mkdtempSync(join(tmpdir(),'dromex-contract-'));
    const path=join(folder,'backup.db').replace(/\\/g,'/');
    db.raw.exec(`VACUUM INTO '${path}'`);
    const copy=new SqliteTestDatabase(path);
    try{
      const restored=new SqliteContractQuantitiesRepository(copy as never);
      const view=await restored.listProject('road');
      expect(view.rows[0]!.usage).toMatchObject({fromLoads:19.5,used:19.5});
      expect((copy.raw.prepare('SELECT COUNT(*) n FROM contract_item_history').get() as {n:number}).n).toBe(2);
    }finally{copy.close();rmSync(folder,{recursive:true,force:true});}
  });
});

describe('contract items',()=>{
  it('creates an item with its materials, a Created history line and a sync outbox entry',async()=>{
    const {db,contracts,outbox,history}=await setup();
    const item=await contracts.createItem('road',{name:'  Asphalt   binder ',unitId:'unit_ton',quantity:'300',unitPriceUsd:'62.5',materialIds:['asphalt','sand']});
    expect(item).toMatchObject({projectId:'road',name:'Asphalt binder',unitId:'unit_ton',unitSymbol:'t',quantity:300,unitPriceUsd:62.5,materialIds:['asphalt','sand'],status:'in_progress',completedOn:null,cancelledAt:null});
    expect(db.raw.prepare('SELECT unit_price_usd_cents FROM contract_items WHERE id=?').get(item.id)).toEqual({unit_price_usd_cents:6250});
    expect(history(item.id)).toEqual([{kind:'created',reason:null}]);
    expect(outbox('contractItem')).toBe(1);
  });

  it('refuses an invalid item and a project that does not exist',async()=>{
    const {contracts}=await setup();
    await expect(contracts.createItem('road',{name:'X',unitId:'unit_ton',quantity:'0',unitPriceUsd:'',materialIds:['asphalt']})).rejects.toThrow('greater than zero');
    await expect(contracts.createItem('road',{name:'X',unitId:'unit_ton',quantity:'5',unitPriceUsd:'',materialIds:[]})).rejects.toThrow('at least one material');
    await expect(contracts.createItem('ghost',{name:'X',unitId:'unit_ton',quantity:'5',unitPriceUsd:'',materialIds:['asphalt']})).rejects.toThrow('project');
    await expect(contracts.createItem('road',{name:'X',unitId:'unit_missing',quantity:'5',unitPriceUsd:'',materialIds:['asphalt']})).rejects.toThrow('unit');
  });

  it('lists a project with its rows, usage and summary, and an empty project with none',async()=>{
    const {contracts,asphaltItem}=await setup();
    expect(await contracts.listProject('road')).toMatchObject({rows:[],summary:{itemCount:0,overallPercentUsed:null}});
    await asphaltItem();
    const view=await contracts.listProject('road');
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({item:{name:'Asphalt binder'},usage:{allowed:300,used:0,remaining:300},materials:[{id:'asphalt',name:'Asphalt',unitSymbol:'t'}]});
    expect(view.summary.itemCount).toBe(1);
  });
});

describe('counting loads',()=>{
  it('counts linked company and supplier loads in the item unit, leaves out cancelled ones and lists another unit as not counted',async()=>{
    const {contracts,asphaltItem,company,supplier,quarry}=await setup();
    const item=await asphaltItem();
    const load=await company();const trip=await supplier();const other=await supplier({unitId:'unit_m3',quantityCubicMetres:'8'});const gone=await supplier({quantityCubicMetres:'50'});
    for(const ref of [{source:'company' as const,loadId:load.id},{source:'supplier' as const,loadId:trip.id},{source:'supplier' as const,loadId:other.id},{source:'supplier' as const,loadId:gone.id}])await contracts.linkLoad(item.id,ref,'Older load');
    await quarry.cancelPurchase(gone.id,'Duplicate');
    const detail=await contracts.getItem(item.id);
    expect(detail.usage).toMatchObject({fromLoads:31.5,used:31.5,remaining:268.5});
    expect(detail.usage.notCounted.map(entry=>[entry.load.id,entry.reason])).toEqual([[other.id,'unit_differs']]);
    expect(detail.loadsByDay.days.map(day=>[day.day,day.countedQuantity])).toEqual([['2026-10-21',12],['2026-10-20',19.5]]);
    expect(detail.loadsByDay.cancelled.map(value=>value.id)).toEqual([gone.id]);
    expect(detail.loadsByDay.days[1]!.loads[0]!.load).toMatchObject({reference:load.loadNumber,source:'company',truckPlate:'B123',driverName:'Omar',partyName:'Road Co',materialName:'Asphalt'});
  });

  it('links a load only to an item of its own project with its material, and needs a reason',async()=>{
    const {contracts,asphaltItem,company}=await setup();
    const item=await asphaltItem();
    const elsewhere=await company({projectId:'other'}),sand=await company({itemId:'sand'}),load=await company();
    await expect(contracts.linkLoad(item.id,{source:'company',loadId:elsewhere.id},'x')).rejects.toThrow('another project');
    await expect(contracts.linkLoad(item.id,{source:'company',loadId:sand.id},'x')).rejects.toThrow('not one of the materials');
    await expect(contracts.linkLoad(item.id,{source:'company',loadId:load.id},' ')).rejects.toThrow('reason');
    await contracts.linkLoad(item.id,{source:'company',loadId:load.id},'Recorded before contracts');
    await expect(contracts.linkLoad(item.id,{source:'company',loadId:load.id},'again')).rejects.toThrow('already counts');
  });

  it('moves a load to another item and unlinks it, each with a reason kept in both histories',async()=>{
    const {contracts,asphaltItem,company,history}=await setup();
    const a=await asphaltItem();
    const b=await contracts.createItem('road',{name:'Binder access road',unitId:'unit_ton',quantity:'120',unitPriceUsd:'',materialIds:['asphalt']});
    const load=await company();
    await contracts.linkLoad(a.id,{source:'company',loadId:load.id},'Older load');
    await expect(contracts.moveLoad({source:'company',loadId:load.id},b.id,'')).rejects.toThrow('reason');
    await contracts.moveLoad({source:'company',loadId:load.id},b.id,'Was for the access road');
    expect((await contracts.getItem(a.id)).usage.used).toBe(0);
    expect((await contracts.getItem(b.id)).usage.used).toBe(19.5);
    await contracts.unlinkLoad({source:'company',loadId:load.id},'Not part of the contract');
    expect((await contracts.getItem(b.id)).usage.used).toBe(0);
    expect(history(a.id).map(entry=>entry.kind)).toEqual(['created','load_linked','load_moved']);
    expect(history(b.id).map(entry=>entry.kind)).toEqual(['created','load_moved','load_unlinked']);
    await expect(contracts.unlinkLoad({source:'company',loadId:load.id},'again')).rejects.toThrow('not linked');
  });

  it('offers the unlinked loads of the linked materials in the project, for linking later',async()=>{
    const {contracts,asphaltItem,company,supplier}=await setup();
    const item=await asphaltItem();
    const load=await company();const trip=await supplier();await company({itemId:'sand'});await company({projectId:'other'});
    await contracts.linkLoad(item.id,{source:'supplier',loadId:trip.id},'Older');
    expect((await contracts.linkableLoads(item.id)).map(value=>value.id)).toEqual([load.id]);
  });

  it('gives the candidates for a load of a material in a project',async()=>{
    const {contracts,asphaltItem}=await setup();
    const item=await asphaltItem();
    expect(await contracts.candidatesFor('road','asphalt')).toMatchObject({preselectedId:item.id});
    expect(await contracts.candidatesFor('other','asphalt')).toEqual({candidates:[],preselectedId:null});
    expect(await contracts.candidatesFor(null,'asphalt')).toEqual({candidates:[],preselectedId:null});
  });
});

describe('a correction that changes the project or the material removes the link (Option 1)',()=>{
  it('a company load moved to another project stops counting and the item history says why',async()=>{
    const {db,contracts,asphaltItem,company,correctCompany,history}=await setup();
    const item=await asphaltItem();const load=await company();
    await contracts.linkLoad(item.id,{source:'company',loadId:load.id},'Older');
    await correctCompany(load,{projectId:'other'});
    expect(db.raw.prepare('SELECT contract_item_id FROM loads WHERE id=?').get(load.id)).toEqual({contract_item_id:null});
    expect((await contracts.getItem(item.id)).usage.used).toBe(0);
    expect(history(item.id).at(-1)).toEqual({kind:'load_unlinked',reason:'Project changed in correction'});
  });

  it('a supplier load corrected to a material not in the item stops counting',async()=>{
    const {contracts,asphaltItem,supplier,quarry,history}=await setup();
    const item=await asphaltItem();const trip=await supplier();
    await contracts.linkLoad(item.id,{source:'supplier',loadId:trip.id},'Older');
    const draft=quarry['draftFromPurchase'](trip);
    await quarry.correctPurchase(trip.id,{...draft,itemId:'sand',correctionReason:'Wrong material'});
    expect((await contracts.getItem(item.id)).usage.used).toBe(0);
    expect(history(item.id).at(-1)).toEqual({kind:'load_unlinked',reason:'Material changed in correction'});
  });

  it('a quantity correction keeps the link and the new quantity counts at once',async()=>{
    const {contracts,asphaltItem,supplier,quarry}=await setup();
    const item=await asphaltItem();const trip=await supplier();
    await contracts.linkLoad(item.id,{source:'supplier',loadId:trip.id},'Older');
    await quarry.correctPurchase(trip.id,{...quarry['draftFromPurchase'](trip),quantityCubicMetres:'15',correctionReason:'Ticket says 15'});
    expect((await contracts.getItem(item.id)).usage.used).toBe(15);
  });
});

describe('adjust, finish, reopen, edit and cancel',()=>{
  it('an adjustment is its own line with a reason and changes Used without touching the loads',async()=>{
    const {db,contracts,asphaltItem,company,history,outbox}=await setup();
    const item=await asphaltItem();const load=await company();
    await contracts.linkLoad(item.id,{source:'company',loadId:load.id},'Older');
    await contracts.addAdjustment(item.id,{amount:'-1.5',reason:'Left on site'});
    const detail=await contracts.getItem(item.id);
    expect(detail.usage).toMatchObject({fromLoads:19.5,adjustmentsTotal:-1.5,used:18});
    expect(detail.usage.adjustments[0]).toMatchObject({amount:-1.5,reason:'Left on site'});
    expect(db.raw.prepare('SELECT billed_quantity FROM loads WHERE id=?').get(load.id)).toEqual({billed_quantity:19.5});
    await expect(contracts.addAdjustment(item.id,{amount:'-50',reason:'x'})).rejects.toThrow('below zero');
    expect(history(item.id).at(-1)).toEqual({kind:'adjusted',reason:'Left on site'});
    expect(outbox('contractAdjustment')).toBe(1);
  });

  it('finish records the day, refuses a future day, and reopen needs a reason; both stay in the history',async()=>{
    const {contracts,asphaltItem,history}=await setup();
    const item=await asphaltItem();
    await expect(contracts.finishItem(item.id,'2026-10-30')).rejects.toThrow('today or a past day');
    const done=await contracts.finishItem(item.id,'2026-10-23');
    expect(done).toMatchObject({status:'complete',completedOn:'2026-10-23'});
    expect((await contracts.getItem(item.id)).usage).toMatchObject({leftover:300,savingUsd:18600,savingIsEstimate:false});
    await expect(contracts.reopenItem(item.id,'')).rejects.toThrow('reason');
    expect(await contracts.reopenItem(item.id,'More paving')).toMatchObject({status:'in_progress',completedOn:null});
    expect(history(item.id).map(entry=>entry.kind)).toEqual(['created','finished','reopened']);
  });

  it('an edit needs a reason once loads count, keeps the old values, and refuses removing a material that loads use',async()=>{
    const {db,contracts,asphaltItem,company}=await setup();
    const item=await asphaltItem();
    const free=await contracts.editItem(item.id,{name:'Asphalt binder',unitId:'unit_ton',quantity:'320',unitPriceUsd:'62',materialIds:['asphalt','sand']},'');
    expect(free).toMatchObject({quantity:320,materialIds:['asphalt','sand']});
    expect((await contracts.getItem(item.id)).editNeedsReason).toBe(false);
    const load=await company();await contracts.linkLoad(item.id,{source:'company',loadId:load.id},'Older');
    expect((await contracts.getItem(item.id)).editNeedsReason).toBe(true);
    await expect(contracts.editItem(item.id,{name:'Asphalt binder',unitId:'unit_ton',quantity:'350',unitPriceUsd:'62',materialIds:['asphalt','sand']},'')).rejects.toThrow('reason');
    await expect(contracts.editItem(item.id,{name:'Asphalt binder',unitId:'unit_ton',quantity:'350',unitPriceUsd:'62',materialIds:['sand']},'VO-3')).rejects.toThrow('loads counted');
    const edited=await contracts.editItem(item.id,{name:'Asphalt binder',unitId:'unit_ton',quantity:'350',unitPriceUsd:'62',materialIds:['asphalt']},'VO-3 approved');
    expect(edited).toMatchObject({quantity:350,materialIds:['asphalt']});
    expect(db.raw.prepare("SELECT item_id,removed_at IS NOT NULL removed FROM contract_item_materials WHERE contract_item_id=? ORDER BY item_id").all(item.id)).toEqual([{item_id:'asphalt',removed:0},{item_id:'sand',removed:1}]);
    const last=db.raw.prepare("SELECT reason,details_json FROM contract_item_history WHERE contract_item_id=? AND kind='edited' ORDER BY rowid DESC").get(item.id) as {reason:string;details_json:string};
    expect(last.reason).toBe('VO-3 approved');
    expect(JSON.parse(last.details_json).changes).toEqual({quantity:{from:320,to:350},materialIds:{from:['asphalt','sand'],to:['asphalt']}});
  });

  it('a cancelled item keeps its rows, leaves the summary and takes no new loads',async()=>{
    const {contracts,asphaltItem,company}=await setup();
    const item=await asphaltItem();
    await expect(contracts.cancelItem(item.id,'')).rejects.toThrow('reason');
    await contracts.cancelItem(item.id,'Created by mistake');
    const view=await contracts.listProject('road');
    expect(view.rows[0]!.item.cancelledAt).not.toBeNull();
    expect(view.summary.itemCount).toBe(0);
    const load=await company();
    await expect(contracts.linkLoad(item.id,{source:'company',loadId:load.id},'x')).rejects.toThrow('cancelled');
  });
});

describe('setup for the contract item form',()=>{
  it('lists the active Catalog materials with their category and default unit, and the active units',async()=>{
    const {db,contracts}=await setup();
    db.raw.exec(`INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,is_active,created_at,updated_at) VALUES ('old','cat','Old gravel','unit_m3',1,0,'${SEED_TIME}','${SEED_TIME}')`);
    const form=await contracts.getSetup();
    expect(form.materials.map(value=>value.id)).toEqual(['asphalt','base','sand']);
    expect(form.materials[0]).toEqual({id:'asphalt',name:'Asphalt',categoryName:'Aggregates',unitId:'unit_ton',unitSymbol:'t'});
    expect(form.units.find(value=>value.id==='unit_m3')).toEqual({id:'unit_m3',name:'Cubic metre',symbol:'m³'});
  });
});
