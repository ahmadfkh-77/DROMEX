import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION,migrateDatabase} from '../src/data/database/migrations';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {SqliteStockRepository} from '../src/data/repositories/SqliteStockRepository';
import {emptyLoadDraft,type LoadDraft} from '../src/domain/loads';
import {correctionBaseline} from '../src/domain/loadCorrection';
import type {StockBatchDraft} from '../src/domain/stock';
import type {StockRuleDraft} from '../src/domain/stockRules';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Stock usage rules against a real database: a rule on Ready-mix C30 (350 kg of cement and 0.45 t of sand per 1 m3) takes its materials out of
 * Stock whenever Stock is counted, from each confirmed load, oldest batch first; cancelled and corrected loads follow; the owner can type the
 * real amount; a shortage is listed and filled when a delivery arrives; and a rule change keeps what was already counted.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-16T12:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX Test','${SEED_TIME}');
    INSERT OR REPLACE INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',0,'${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('produced','Produced','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,is_active,created_at,updated_at) VALUES ('c30','produced','Ready-mix C30','unit_m3',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,is_active,created_at,updated_at) VALUES ('c25','produced','Ready-mix C25','unit_m3',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,is_active,created_at,updated_at) VALUES ('asphalt','produced','Asphalt Mix','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('cement','produced','Cement','unit_kg',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,quarry_enabled,is_active,created_at,updated_at) VALUES ('sand','produced','Sand','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('salam','Al Salam',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at) VALUES ('omar','Omar',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('mixer','L 204118',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const stock=new SqliteStockRepository(db as never),loads=new SqliteLoadRepository(db as never);
  const batch=(extra:Partial<StockBatchDraft>)=>stock.recordBatch({itemId:'cement',unitId:'',recordDate:'2026-10-03',supplierId:'salam',invoiceNumber:'',quantity:'1000',priceBasis:'per_unit',price:'',vat:{mode:'none',ratePercent:''},notes:'',...extra});
  await batch({});await batch({recordDate:'2026-10-12',quantity:'5000'});
  await batch({itemId:'sand',recordDate:'2026-10-01',quantity:'5'});await batch({itemId:'sand',recordDate:'2026-10-11',quantity:'40'});
  const rule=(extra:Partial<StockRuleDraft>={}):StockRuleDraft=>({loadItemId:'c30',unitId:'unit_m3',perQuantity:'1',effectiveFrom:'2026-10-15',lines:[{stockItemId:'cement',amount:'350'},{stockItemId:'sand',amount:'0.45'}],...extra});
  let minute=0;
  /** Each load is made a minute after the one before, so their order is the order they were made in. */
  const load=(quantity:string,extra:Partial<LoadDraft>={})=>{vi.setSystemTime(new Date(`2026-10-16T12:${String(minute+=1).padStart(2,'0')}:00`));return loads.confirmLoad({...emptyLoadDraft,recordDate:'2026-10-16',customerId:'customer',destinationAddress:'Beirut site',itemId:'c30',driverId:'omar',driverName:'Omar',truckId:'mixer',truckPlate:'L 204118',quantityMethod:'direct',directQuantity:quantity,directUnitId:'unit_m3',...extra});};
  const item=async(id:string)=>(await stock.getOverview()).items.find(value=>value.itemId===id)!;
  return {db,stock,loads,batch,rule,load,item};
}

describe('saving a rule',()=>{
  it('creates a rule with its first version and lists it with the items it can watch',async()=>{
    const {stock,rule}=await setup();
    const before=await stock.getRulesSetup();
    expect(before.loadItems.map(value=>[value.id,value.unitSymbol,value.hasRule,value.bitumen])).toEqual([['asphalt','t',false,false],['c25','m³',false,false],['c30','m³',false,false]]);
    expect(before.materials.map(value=>[value.name,value.unitSymbol])).toEqual([['Cement','kg'],['Sand','t']]);
    const saved=await stock.saveRule(rule());
    expect(saved).toMatchObject({loadItemId:'c30',loadItemName:'Ready-mix C30',unitSymbol:'m³',enabled:true});
    expect(saved.versions).toEqual([expect.objectContaining({effectiveFrom:'2026-10-15',perQuantity:1,lines:[{stockItemId:'cement',amount:350},{stockItemId:'sand',amount:0.45}]})]);
    expect((await stock.getRulesSetup()).loadItems.find(value=>value.id==='c30')?.hasRule).toBe(true);
  });
  it('refuses a rule that is not complete, a second rule for the same item, or an item Bitumen already counts',async()=>{
    const {db,stock,rule}=await setup();
    await expect(stock.saveRule(rule({loadItemId:'cement'}))).rejects.toThrow('delivered on receipts');
    await expect(stock.saveRule(rule({unitId:''}))).rejects.toThrow('the rule is per');
    await expect(stock.saveRule(rule({perQuantity:'0'}))).rejects.toThrow('greater than zero');
    await expect(stock.saveRule(rule({effectiveFrom:''}))).rejects.toThrow('date the rule applies from');
    await expect(stock.saveRule(rule({lines:[]}))).rejects.toThrow('at least one material');
    await expect(stock.saveRule(rule({lines:[{stockItemId:'gravel',amount:'1'}]}))).rejects.toThrow('from your Stock');
    await expect(stock.saveRule(rule({lines:[{stockItemId:'cement',amount:'1'},{stockItemId:'cement',amount:'2'}]}))).rejects.toThrow('listed twice');
    await expect(stock.saveRule(rule({lines:[{stockItemId:'cement',amount:'abc'}]}))).rejects.toThrow('The amount of Cement');
    await stock.saveRule(rule());
    await expect(stock.saveRule(rule())).rejects.toThrow('already has a rule');
    db.raw.exec(`INSERT INTO bitumen_item_rules (item_id,is_enabled,aggregate_kg,bitumen_kg,count_from,created_at,updated_at) VALUES ('asphalt',1,1600,50,'2026-10-01','${SEED_TIME}','${SEED_TIME}')`);
    await expect(stock.saveRule(rule({loadItemId:'asphalt',unitId:'unit_ton'}))).rejects.toThrow('Bitumen already counts this item');
    expect((await stock.getRulesSetup()).loadItems.find(value=>value.id==='asphalt')?.bitumen).toBe(true);
    expect((await stock.getRulesSetup()).rules).toHaveLength(1);
  });
  it('adds a new version when a rule is edited, keeps its unit, and can be turned off',async()=>{
    const {stock,rule}=await setup();
    const saved=await stock.saveRule(rule());
    const edited=await stock.saveRule({...rule({effectiveFrom:'2026-11-02',unitId:'unit_ton',lines:[{stockItemId:'cement',amount:'325'},{stockItemId:'sand',amount:'0.45'}]}),ruleId:saved.id});
    expect(edited.unitSymbol).toBe('m³');expect(edited.versions.map(value=>[value.effectiveFrom,value.lines[0]!.amount])).toEqual([['2026-10-15',350],['2026-11-02',325]]);
    await stock.setRuleEnabled(saved.id,false);expect((await stock.getRulesSetup()).rules[0]!.enabled).toBe(false);
    await expect(stock.setRuleEnabled('missing',true)).rejects.toThrow('not found');
    await expect(stock.saveRule({...rule(),ruleId:'missing'})).rejects.toThrow('not found');
  });
});

describe('counting loads',()=>{
  it('takes each material from the oldest batches, carrying on into the next, and counts a load once',async()=>{
    const {stock,rule,load,item}=await setup();
    await stock.saveRule(rule());
    await load('8');await load('6');
    const result=await stock.syncUse();
    expect(result).toMatchObject({added:6,attention:[]});
    const cement=await item('cement'),sand=await item('sand');
    expect(cement.totalRemaining).toBe(1100);expect(sand.totalRemaining).toBe(38.7);
    expect(cement.batches.map(batch=>[batch.batchNumber,batch.remainingQuantity])).toEqual([['CEM-0001',0],['CEM-0002',1100]]);
    expect(sand.batches.map(batch=>[batch.batchNumber,batch.remainingQuantity])).toEqual([['SAN-0001',0],['SAN-0002',38.7]]);
    expect((await stock.syncUse()).added).toBe(0);
    expect((await item('cement')).totalUsed).toBe(4900);
  });
  it('shows each load on the item as a use from a load, with its quantity, rate and batch split',async()=>{
    const {stock,rule,load,item}=await setup();
    await stock.saveRule(rule());
    await load('8');await load('6');await stock.syncUse();
    const uses=(await item('cement')).uses;
    expect(uses).toHaveLength(2);
    const newest=uses.find(use=>use.loadQuantity===6)!;
    expect(newest).toMatchObject({source:'load',quantity:2100,status:'Active',loadUnit:'m³',rulePerQuantity:1,ruleAmount:350,adjustedReason:null,note:null});
    expect(newest.lines.map(line=>[line.batchNumber,line.quantity])).toEqual([['CEM-0002',2100]]);
    const first=uses.find(use=>use.loadQuantity===8)!;
    expect(first.lines.map(line=>[line.batchNumber,line.quantity])).toEqual([['CEM-0001',1000],['CEM-0002',1800]]);
    expect(first.loadNumber).toMatch(/\S/);
  });
  it('does not count loads before the rule began, loads of other items, or anything when the rule is off',async()=>{
    const {stock,rule,load,item}=await setup();
    const saved=await stock.saveRule(rule({effectiveFrom:'2026-10-17'}));
    await load('8');expect((await stock.syncUse()).added).toBe(0);
    await stock.saveRule({...rule({effectiveFrom:'2026-10-15'}),ruleId:saved.id});
    await load('4',{itemId:'c25'});
    await stock.setRuleEnabled(saved.id,false);expect((await stock.syncUse()).added).toBe(0);
    await stock.setRuleEnabled(saved.id,true);expect((await stock.syncUse()).added).toBe(3);
    expect((await item('cement')).totalUsed).toBe(2800);
  });
  it('does nothing at all when there is no rule', async()=>{
    const {stock,load}=await setup();
    await load('8');expect(await stock.syncUse()).toEqual({added:0,attention:[]});
  });
});

describe('loads that change',()=>{
  it('puts the materials back when a load is cancelled, and takes them again if it is reactivated',async()=>{
    const {stock,loads,rule,load,item}=await setup();
    await stock.saveRule(rule());
    const first=await load('8');await stock.syncUse();
    expect((await item('cement')).totalRemaining).toBe(3200);
    await loads.cancelLoad(first.id,'Wrong customer');await stock.syncUse();
    expect((await item('cement')).totalRemaining).toBe(6000);expect((await item('sand')).totalRemaining).toBe(45);
    const record=(await item('cement')).uses[0]!;expect(record).toMatchObject({status:'Cancelled',source:'load'});
  });
  it('adds only the difference when a load\'s quantity is corrected, at the rate it was counted with',async()=>{
    const {stock,loads,rule,load,item}=await setup();
    const saved=await stock.saveRule(rule());
    const first=await load('8');await stock.syncUse();
    await stock.saveRule({...rule({effectiveFrom:'2026-10-16',lines:[{stockItemId:'cement',amount:'400'},{stockItemId:'sand',amount:'0.5'}]}),ruleId:saved.id});
    await loads.correctLoad(first.id,{...correctionBaseline(first),directQuantity:'9',correctionReason:'Counted again'});
    await stock.syncUse();
    expect((await item('cement')).totalUsed).toBe(3150);
    expect((await item('cement')).uses[0]).toMatchObject({quantity:3150,ruleAmount:350});
  });
  it('uses the new rule from its date for new loads while earlier loads keep their rate',async()=>{
    const {stock,rule,load,item}=await setup();
    const saved=await stock.saveRule(rule());
    await load('8');await stock.syncUse();
    await stock.saveRule({...rule({effectiveFrom:'2026-10-16',lines:[{stockItemId:'cement',amount:'325'},{stockItemId:'sand',amount:'0.45'}]}),ruleId:saved.id});
    await load('6');await stock.syncUse();
    const uses=(await item('cement')).uses;
    expect(uses.map(use=>[use.loadQuantity,use.quantity,use.ruleAmount]).sort()).toEqual([[6,1950,325],[8,2800,350]]);
  });
});

describe('typing the real amount',()=>{
  it('records the real amount of one load with a reason, and the load keeps it afterwards',async()=>{
    const {stock,loads,rule,load,item}=await setup();
    await stock.saveRule(rule());
    const first=await load('8');await stock.syncUse();
    await expect(stock.adjustLoadUse(first.id,'cement','2750','  ')).rejects.toThrow('reason');
    await expect(stock.adjustLoadUse(first.id,'cement','abc','Counted')).rejects.toThrow('number');
    await stock.adjustLoadUse(first.id,'cement','2750','Counted the empty bags');
    const record=(await item('cement')).uses[0]!;
    expect(record).toMatchObject({quantity:2750,adjustedReason:'Counted the empty bags'});
    expect((await item('sand')).totalUsed).toBe(3.6);
    await loads.correctLoad(first.id,{...correctionBaseline(first),directQuantity:'9',correctionReason:'Counted again'});
    await stock.syncUse();expect((await item('cement')).uses[0]!.quantity).toBe(2750);
    await stock.adjustLoadUse(first.id,'cement','0','Not used');expect((await item('cement')).totalUsed).toBe(0);
  });
  it('refuses to adjust a load that was not counted or was cancelled',async()=>{
    const {stock,loads,rule,load}=await setup();
    await stock.saveRule(rule());
    const first=await load('8');
    await expect(stock.adjustLoadUse(first.id,'cement','100','x')).rejects.toThrow('not been counted');
    await stock.syncUse();await loads.cancelLoad(first.id,'Mistake');
    await expect(stock.adjustLoadUse(first.id,'cement','100','x')).rejects.toThrow('cancelled load');
  });
});

describe('shortages and loads that cannot be counted',()=>{
  it('never blocks a load, lists the shortage, and fills it when a delivery is recorded',async()=>{
    const {stock,rule,batch,load,item}=await setup();
    await stock.saveRule(rule());
    for(let index=0;index<18;index+=1)await load('1');
    await load('10');
    const first=await stock.syncUse();
    const short=first.attention.filter(value=>value.kind==='short'&&value.stockItemId==='cement');
    expect(short.length).toBeGreaterThan(0);
    expect((await item('cement')).totalRemaining).toBe(0);
    const owed=Math.round(short.reduce((sum,value)=>sum+value.quantity,0)*1000)/1000;
    expect(owed).toBe(350*28-6000);
    await batch({recordDate:'2026-10-16',quantity:'4000'});
    const second=await stock.syncUse();
    expect(second.attention.filter(value=>value.stockItemId==='cement')).toEqual([]);
    expect((await item('cement')).totalRemaining).toBe(4000-owed);
    expect((await stock.syncUse()).added).toBe(0);
  });
  it('lists a load that is not counted in the rule\'s unit instead of guessing',async()=>{
    const {stock,loads,rule,load}=await setup();
    await stock.saveRule(rule());
    const tons=await load('10',{directUnitId:'unit_ton'});
    expect(tons.outputUnitSymbol).toBe('t');
    const result=await stock.syncUse();
    expect(result.added).toBe(0);expect(result.attention.map(value=>[value.loadId,value.kind,value.stockItemId])).toEqual([[tons.id,'not_countable','cement'],[tons.id,'not_countable','sand']]);
    expect(result.attention[0]!.note).toContain('m³');
    await loads.cancelLoad(tons.id,'Wrong item');expect((await stock.syncUse()).attention).toEqual([]);
  });
});

describe('the database',()=>{
  it('is migrated with the rule tables, keeps a use by hand as a use by hand, and can be migrated again',async()=>{
    const {db,stock,item}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(63);
    const tables=(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'stock_%' ORDER BY name").all() as {name:string}[]).map(row=>row.name);
    expect(tables).toEqual(['stock_batches','stock_items','stock_rule_versions','stock_rules','stock_use','stock_use_overrides']);
    await stock.recordUse({itemId:'cement',quantity:'100',usedOn:'2026-10-16',note:'By hand'});
    expect(db.raw.prepare('SELECT source,load_id,rule_id FROM stock_use').all()).toEqual([{source:'manual',load_id:null,rule_id:null}]);
    expect((await item('cement')).uses[0]).toMatchObject({source:'manual',loadId:null,quantity:100,note:'By hand'});
    db.raw.exec('PRAGMA user_version = 62');
    await migrateDatabase(db as never);
    expect((db.raw.prepare('PRAGMA user_version').get() as {user_version:number}).user_version).toBe(DATABASE_VERSION);
    expect((await item('cement')).totalUsed).toBe(100);
  });
  it('queues rule and count changes for sync',async()=>{
    const {db,stock,rule,load}=await setup();
    const saved=await stock.saveRule(rule());await stock.setRuleEnabled(saved.id,true);await load('8');await stock.syncUse();
    const kinds=(db.raw.prepare("SELECT entity_type FROM sync_outbox WHERE entity_type LIKE 'stock%' AND entity_type IN ('stockRule','stockUse') ORDER BY id").all() as {entity_type:string}[]).map(row=>row.entity_type);
    expect(kinds.filter(kind=>kind==='stockRule')).toHaveLength(2);expect(kinds.filter(kind=>kind==='stockUse').length).toBe(2);
  });
});
