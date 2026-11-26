import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteContractQuantitiesRepository} from '../src/data/repositories/SqliteContractQuantitiesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {emptyLoadDraft,type LoadDraft} from '../src/domain/loads';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-556, Phase 3. Changing how a target's used quantity is tracked. Every change is an audited edit with its reason, writes a sync entry in
 * its own transaction, never deletes a site entry, and keeps the figures of earlier dates as they were.
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
  // The target is in tons, so the 19.5 t company load counts when automatic.
  const automatic=()=>contracts.createItem('road',{name:'Asphalt binder',unitId:'unit_ton',quantity:'300',unitPriceUsd:'62',materialIds:['asphalt']});
  const withLoad=async()=>{const item=await automatic();const load=await company();await contracts.linkLoad(item.id,{source:'company',loadId:load.id},'Older');return {item,load};};
  const outbox=(type:string)=>(db.raw.prepare('SELECT COUNT(*) n FROM sync_outbox WHERE entity_type=?').get(type) as {n:number}).n;
  const history=(id:string)=>db.raw.prepare('SELECT kind,reason,details_json FROM contract_item_history WHERE contract_item_id=? ORDER BY created_at,rowid').all(id) as {kind:string;reason:string|null;details_json:string}[];
  const entries=(id:string)=>db.raw.prepare('SELECT kind,entries_segment,entry_date,amount FROM contract_item_site_entries WHERE contract_item_id=? ORDER BY rowid').all(id) as {kind:string;entries_segment:number;entry_date:string;amount:number}[];
  return {db,contracts,company,automatic,withLoad,outbox,history,entries};
}

describe('automatic to linked manual',()=>{
  it('freezes the calculated value as an opening entry; used stays the same and never resets to zero',async()=>{
    const {contracts,withLoad,entries}=await setup();
    const {item}=await withLoad();
    await contracts.addAdjustment(item.id,{amount:'-1.5',reason:'Left on site'});
    const before=(await contracts.getItem(item.id)).usage.used;
    expect(before).toBe(18);
    const preview=await contracts.previewModeChange(item.id,'linked_manual');
    expect(preview).toMatchObject({opening:{amount:19.5},needsConfirm:false,usedBefore:18,usedAfter:18});
    const changed=await contracts.changeTrackingMode(item.id,'linked_manual',{reason:'Tracked in metres on site'});
    expect(changed.trackingMode).toBe('linked_manual');
    const after=(await contracts.getItem(item.id)).usage;
    expect(after).toMatchObject({tracking:'linked_manual',used:18,siteEntriesTotal:19.5,fromLoads:0});
    expect(entries(item.id)).toEqual([{kind:'opening',entries_segment:1,entry_date:'2026-10-24',amount:19.5}]);
  });

  it('keeps counting from the entries afterwards and shows the loads as delivered, never added',async()=>{
    const {contracts,withLoad}=await setup();
    const {item}=await withLoad();
    await contracts.changeTrackingMode(item.id,'linked_manual',{reason:'Tracked in metres'});
    await contracts.addSiteEntry(item.id,{date:'2026-10-24',amount:'10',note:''});
    const {usage}=await contracts.getItem(item.id);
    expect(usage.used).toBe(29.5);
    expect(usage.deliveredFromLoads).toEqual([expect.objectContaining({quantity:19.5})]);
  });

  it('is an audited edit with the reason, and writes sync entries in the same transaction',async()=>{
    const {contracts,withLoad,history,outbox}=await setup();
    const {item}=await withLoad();
    const before=outbox('contractItem');
    await contracts.changeTrackingMode(item.id,'linked_manual',{reason:'Tracked in metres'});
    const line=history(item.id).at(-1)!;
    expect(line).toMatchObject({kind:'edited',reason:'Tracked in metres'});
    expect(JSON.parse(line.details_json)).toMatchObject({changes:{trackingMode:{from:'automatic',to:'linked_manual'}},opening:{amount:19.5}});
    expect(outbox('contractItem')).toBe(before+1);
    expect(outbox('contractSiteEntry')).toBe(1);
  });

  it('needs a reason once loads count, and is refused for a cancelled target or the same mode',async()=>{
    const {contracts,withLoad}=await setup();
    const {item}=await withLoad();
    await expect(contracts.changeTrackingMode(item.id,'linked_manual',{reason:''})).rejects.toThrow('reason');
    await expect(contracts.changeTrackingMode(item.id,'automatic',{reason:'x'})).rejects.toThrow('already tracked');
    await expect(contracts.changeTrackingMode(item.id,'manual',{reason:'x'})).rejects.toThrow('Switch to Linked manual');
    await contracts.cancelItem(item.id,'Mistake');
    await expect(contracts.changeTrackingMode(item.id,'linked_manual',{reason:'x'})).rejects.toThrow('cancelled');
  });

  it('does not touch loads, stock or batches',async()=>{
    const {db,contracts,withLoad}=await setup();
    const {item}=await withLoad();
    const count=(table:string)=>(db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n;
    const tables=['loads','quarry_purchases','stock_batches','stock_use','fuel_batches'];
    const before=tables.map(count),billed=db.raw.prepare('SELECT billed_quantity FROM loads').all();
    await contracts.changeTrackingMode(item.id,'linked_manual',{reason:'Tracked in metres'});
    expect(tables.map(count)).toEqual(before);
    expect(db.raw.prepare('SELECT billed_quantity FROM loads').all()).toEqual(billed);
  });
});

describe('back to automatic',()=>{
  async function manualWithEntries(){
    const context=await setup();
    const {item}=await context.withLoad();
    await context.contracts.changeTrackingMode(item.id,'linked_manual',{reason:'Tracked in metres'});
    await context.contracts.addSiteEntry(item.id,{date:'2026-10-24',amount:'10',note:'Block 4'});
    return {...context,item};
  }

  it('refuses until confirmed, then recalculates from the loads and keeps every entry in the database',async()=>{
    const {contracts,item,entries,db}=await manualWithEntries();
    const preview=await contracts.previewModeChange(item.id,'automatic');
    expect(preview).toMatchObject({needsConfirm:true,discards:{count:2,total:29.5},usedBefore:29.5,usedAfter:19.5});
    await expect(contracts.changeTrackingMode(item.id,'automatic',{reason:'Back to loads'})).rejects.toThrow('Confirm');
    expect((await contracts.getItem(item.id)).item.trackingMode).toBe('linked_manual');
    const changed=await contracts.changeTrackingMode(item.id,'automatic',{reason:'Back to loads',confirmed:true});
    expect(changed.trackingMode).toBe('automatic');
    expect((await contracts.getItem(item.id)).usage).toMatchObject({tracking:'automatic',used:19.5,fromLoads:19.5,siteEntriesTotal:0});
    expect(entries(item.id)).toHaveLength(2);
    expect((db.raw.prepare('SELECT entries_segment FROM contract_items WHERE id=?').get(item.id) as {entries_segment:number}).entries_segment).toBe(2);
  });

  it('records the entries that stopped counting in the history',async()=>{
    const {contracts,item,history}=await manualWithEntries();
    await contracts.changeTrackingMode(item.id,'automatic',{reason:'Back to loads',confirmed:true});
    expect(JSON.parse(history(item.id).at(-1)!.details_json)).toMatchObject({changes:{trackingMode:{from:'linked_manual',to:'automatic'}},stoppedCounting:{count:2,total:29.5}});
  });

  it('needs a linked material',async()=>{
    const {contracts}=await setup();
    const item=await contracts.createItem('road',{name:'Site clearance',unitId:'unit_ton',quantity:'10',unitPriceUsd:'',materialIds:[],trackingMode:'manual'});
    await expect(contracts.changeTrackingMode(item.id,'automatic',{reason:'x',confirmed:true})).rejects.toThrow('Link at least one material');
  });

  it('starting manual again begins a fresh segment with a fresh opening entry; the earlier entries never count again',async()=>{
    const {contracts,item,entries}=await manualWithEntries();
    await contracts.changeTrackingMode(item.id,'automatic',{reason:'Back to loads',confirmed:true});
    await contracts.changeTrackingMode(item.id,'linked_manual',{reason:'Metres again'});
    expect((await contracts.getItem(item.id)).usage).toMatchObject({used:19.5,siteEntriesTotal:19.5});
    expect(entries(item.id).map(value=>[value.kind,value.entries_segment])).toEqual([['opening',1],['entry',1],['opening',2]]);
  });
});

describe('between the two manual modes',()=>{
  it('manual to linked manual keeps every entry; linked manual to manual needs the materials removed first',async()=>{
    const {contracts}=await setup();
    const item=await contracts.createItem('road',{name:'Site clearance',unitId:'unit_ton',quantity:'1000',unitPriceUsd:'',materialIds:[],trackingMode:'manual'});
    await contracts.addSiteEntry(item.id,{date:'2026-10-20',amount:'100',note:''});
    await contracts.changeTrackingMode(item.id,'linked_manual',{reason:'Now linked'});
    expect((await contracts.getItem(item.id)).usage).toMatchObject({used:100,siteEntriesTotal:100});
    await contracts.editItem(item.id,{name:'Site clearance',unitId:'unit_ton',quantity:'1000',unitPriceUsd:'',materialIds:['asphalt']},'Reference material');
    await expect(contracts.changeTrackingMode(item.id,'manual',{reason:'x'})).rejects.toThrow('no material');
    await contracts.editItem(item.id,{name:'Site clearance',unitId:'unit_ton',quantity:'1000',unitPriceUsd:'',materialIds:[]},'Remove reference');
    expect((await contracts.changeTrackingMode(item.id,'manual',{reason:'Not linked any more'})).trackingMode).toBe('manual');
    expect((await contracts.getItem(item.id)).usage.used).toBe(100);
  });
});

describe('earlier dates keep their figures after a switch',()=>{
  it('reports as of a day before the switch still read the loads, and the same used figure today',async()=>{
    const {contracts,withLoad}=await setup();
    const {item}=await withLoad();
    expect((await contracts.totalsTargets('road','2026-10-22'))[0]!.counted).toBe(19.5);
    await contracts.changeTrackingMode(item.id,'linked_manual',{reason:'Tracked in metres'});
    await contracts.addSiteEntry(item.id,{date:'2026-10-24',amount:'10',note:''});
    expect((await contracts.totalsTargets('road','2026-10-22'))[0]!.counted).toBe(19.5);
    expect((await contracts.totalsTargets('road','2026-10-24'))[0]!.counted).toBe(29.5);
    expect((await contracts.totalsTargets('road',null))[0]!.counted).toBe(29.5);
    expect((await contracts.targetTableOn('road','2026-10-24'))[0]).toMatchObject({used:29.5,usedToday:10});
    await contracts.changeTrackingMode(item.id,'automatic',{reason:'Back',confirmed:true});
    expect((await contracts.totalsTargets('road','2026-10-24'))[0]!.counted).toBe(19.5);
    expect((await contracts.totalsTargets('road',null))[0]!.counted).toBe(19.5);
  });
});
