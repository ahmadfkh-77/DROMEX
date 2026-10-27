import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteContractQuantitiesRepository} from '../src/data/repositories/SqliteContractQuantitiesRepository';
import {SqliteLoadRepository} from '../src/data/repositories/SqliteLoadRepository';
import {plannedContractLink,type ContractLinkFacts} from '../src/domain/contractQuantities';
import {correctionBaseline} from '../src/domain/loadCorrection';
import {emptyLoadDraft,type ConfirmedLoad,type LoadCorrectionDraft,type LoadDraft} from '../src/domain/loads';
import {SEED_TIME,type SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-536. The Company Load correction can change which Quantity Target a load counts toward. A target named in the correction is used as
 * given and checked; with none named the link is kept, and removed automatically when the corrected project or material no longer fits it.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-24T10:00:00'));});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

describe('plannedContractLink',()=>{
  const road:ContractLinkFacts={id:'road-asphalt',projectId:'road',cancelled:false,materialIds:['asphalt']};
  const other:ContractLinkFacts={id:'other-asphalt',projectId:'other',cancelled:false,materialIds:['asphalt']};
  const old:ContractLinkFacts={id:'old',projectId:'road',cancelled:true,materialIds:['asphalt']};
  const plan=(current:string|null,requested:string|null|undefined,projectId:string|null,itemId='asphalt')=>plannedContractLink({current,requested,projectId,itemId,itemName:'Asphalt',targets:[road,other,old]});

  it('keeps the link while the project and the material still fit it',()=>{
    expect(plan('road-asphalt',undefined,'road')).toEqual({final:'road-asphalt',automatic:null,problem:null});
    expect(plan(null,undefined,'road')).toEqual({final:null,automatic:null,problem:null});
  });

  it('removes the link automatically when the project or the material no longer fits (Option 1)',()=>{
    expect(plan('road-asphalt',undefined,'other')).toEqual({final:null,automatic:'project',problem:null});
    expect(plan('road-asphalt',undefined,null)).toEqual({final:null,automatic:'project',problem:null});
    expect(plan('road-asphalt',undefined,'road','sand')).toEqual({final:null,automatic:'material',problem:null});
  });

  it('uses a named target, or Not linked, as given',()=>{
    expect(plan(null,'road-asphalt','road')).toEqual({final:'road-asphalt',automatic:null,problem:null});
    expect(plan('road-asphalt','','road')).toEqual({final:null,automatic:null,problem:null});
    expect(plan('road-asphalt',null,'road')).toEqual({final:null,automatic:null,problem:null});
    expect(plan('road-asphalt','other-asphalt','other')).toEqual({final:'other-asphalt',automatic:null,problem:null});
  });

  it('refuses a target that is missing, cancelled, in another project or without the material',()=>{
    expect(plan(null,'missing','road').problem).toBe('The chosen target was not found.');
    expect(plan(null,'old','road').problem).toBe('The chosen target is cancelled. Choose another or Not linked.');
    expect(plan(null,'other-asphalt','road').problem).toBe('The chosen target belongs to another project.');
    expect(plan(null,'road-asphalt','road','sand').problem).toBe('Asphalt is not one of the materials of the chosen target.');
  });
});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO company_settings (id,company_name,updated_at) VALUES ('company','DROMEX','${SEED_TIME}');
    INSERT INTO tax_settings (id,vat_rate_basis_points,updated_at) VALUES ('tax',1000,'${SEED_TIME}');
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES ('other','customer','Coastal Road','Tyre','active','2026-08-10','${SEED_TIME}','${SEED_TIME}',0);
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Aggregates','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,default_unit_id,loads_enabled,quarry_enabled,created_at,updated_at) VALUES
      ('asphalt','cat','Asphalt','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}'),('sand','cat','Sand','unit_ton',1,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${SEED_TIME}','${SEED_TIME}','driver');
  `);
  const loads=new SqliteLoadRepository(db as never),contracts=new SqliteContractQuantitiesRepository(db as never);
  const company=(extra:Partial<LoadDraft>={})=>loads.confirmLoad({...emptyLoadDraft,vat:{mode:'none',ratePercent:''},recordDate:'2026-10-20',customerId:'customer',projectId:'road',itemId:'asphalt',driverId:'driver',driverName:'Omar',truckId:'truck',truckPlate:'B123',quantityMethod:'weighbridge',emptyWeightKg:'10000',fullWeightKg:'29500',conversionId:'conversion_kg_ton',...extra});
  const correct=(load:ConfirmedLoad,extra:Partial<LoadCorrectionDraft>)=>loads.correctLoad(load.id,{...correctionBaseline(load),correctionReason:'Wrong entry',...extra});
  const binder=()=>contracts.createItem('road',{name:'Asphalt binder',unitId:'unit_ton',quantity:'300',unitPriceUsd:'',materialIds:['asphalt']});
  const wearing=()=>contracts.createItem('road',{name:'Wearing course',unitId:'unit_ton',quantity:'500',unitPriceUsd:'',materialIds:['asphalt']});
  const coastal=()=>contracts.createItem('other',{name:'Coastal asphalt',unitId:'unit_ton',quantity:'100',unitPriceUsd:'',materialIds:['asphalt']});
  const history=(itemId:string)=>db.raw.prepare('SELECT kind,reason,details_json FROM contract_item_history WHERE contract_item_id=? ORDER BY created_at,rowid').all(itemId) as {kind:string;reason:string|null;details_json:string}[];
  const link=(loadId:string)=>(db.raw.prepare('SELECT contract_item_id c FROM loads WHERE id=?').get(loadId) as {c:string|null}).c;
  return {db,loads,contracts,company,correct,binder,wearing,coastal,history,link};
}

describe('a company load correction that names a target',()=>{
  it('links an unlinked load, counts it at once, and records it in both histories',async()=>{
    const {loads,contracts,company,correct,binder,history,link}=await setup();
    const item=await binder();const load=await company();
    const saved=await correct(load,{contractItemId:item.id});
    expect(saved.contractItemId).toBe(item.id);expect(link(load.id)).toBe(item.id);
    expect((await contracts.getItem(item.id)).usage.used).toBe(19.5);
    const last=history(item.id).at(-1)!;
    expect(last).toMatchObject({kind:'load_linked',reason:null});
    expect(JSON.parse(last.details_json)).toMatchObject({source:'company',loadId:load.id,inCorrection:true});
    expect(saved.correctionHistory.at(-1)!.changes).toEqual([{field:'Counts toward target',originalValue:'Not linked',newValue:'Asphalt binder'}]);
    expect((await loads.getCorrectionContext(load.id)).contractTargetName).toBe('Asphalt binder');
  });

  it('moves a load from one target to another and says why in the old target',async()=>{
    const {contracts,company,correct,binder,wearing,history,link}=await setup();
    const a=await binder(),b=await wearing();const load=await company({contractItemId:a.id});
    await correct(load,{contractItemId:b.id});
    expect(link(load.id)).toBe(b.id);
    expect((await contracts.getItem(a.id)).usage.used).toBe(0);expect((await contracts.getItem(b.id)).usage.used).toBe(19.5);
    expect(history(a.id).at(-1)).toMatchObject({kind:'load_unlinked',reason:'Target changed in correction'});
    expect(history(b.id).at(-1)).toMatchObject({kind:'load_linked'});
  });

  it('removes the link when Not linked is chosen',async()=>{
    const {company,correct,binder,history,link}=await setup();
    const a=await binder();const load=await company({contractItemId:a.id});
    const saved=await correct(load,{contractItemId:''});
    expect(link(load.id)).toBeNull();
    expect(history(a.id).at(-1)).toMatchObject({kind:'load_unlinked',reason:'Target removed in correction'});
    expect(saved.correctionHistory.at(-1)!.changes).toEqual([{field:'Counts toward target',originalValue:'Asphalt binder',newValue:'Not linked'}]);
  });

  it('lets a load move to another project and a target of that project in the same correction',async()=>{
    const {company,correct,binder,coastal,history,link}=await setup();
    const a=await binder(),c=await coastal();const load=await company({contractItemId:a.id});
    await correct(load,{projectId:'other',contractItemId:c.id});
    expect(link(load.id)).toBe(c.id);
    expect(history(a.id).at(-1)).toMatchObject({kind:'load_unlinked',reason:'Target changed in correction'});
  });

  it('refuses a wrong target and saves nothing',async()=>{
    const {db,company,correct,binder,coastal,link}=await setup();
    const a=await binder(),c=await coastal();const load=await company({contractItemId:a.id});
    await expect(correct(load,{contractItemId:c.id})).rejects.toThrow('The chosen target belongs to another project.');
    await expect(correct(load,{contractItemId:'missing'})).rejects.toThrow('The chosen target was not found.');
    expect(link(load.id)).toBe(a.id);
    expect((db.raw.prepare('SELECT COUNT(*) n FROM load_versions').get() as {n:number}).n).toBe(0);
  });
});

describe('a company load correction that names no target',()=>{
  it('keeps the link for a quantity or notes correction, with no target row in the history',async()=>{
    const {company,correct,binder,link}=await setup();
    const a=await binder();const load=await company({contractItemId:a.id});
    const saved=await correct(load,{notes:'Delivered to the north gate'});
    expect(link(load.id)).toBe(a.id);
    expect(saved.correctionHistory.at(-1)!.changes.map(change=>change.field)).toEqual(['Notes']);
  });

  it('still removes the link automatically when the project changes, and the correction history says so',async()=>{
    const {company,correct,binder,history,link}=await setup();
    const a=await binder();const load=await company({contractItemId:a.id});
    const saved=await correct(load,{projectId:'other'});
    expect(link(load.id)).toBeNull();
    expect(history(a.id).at(-1)).toMatchObject({kind:'load_unlinked',reason:'Project changed in correction'});
    expect(saved.correctionHistory.at(-1)!.changes.map(change=>change.field)).toEqual(['Project','Counts toward target']);
  });

  it('removes the link automatically when the material changes',async()=>{
    const {company,correct,binder,history,link}=await setup();
    const a=await binder();const load=await company({contractItemId:a.id});
    await correct(load,{itemId:'sand'});
    expect(link(load.id)).toBeNull();
    expect(history(a.id).at(-1)).toMatchObject({kind:'load_unlinked',reason:'Material changed in correction'});
  });
});
