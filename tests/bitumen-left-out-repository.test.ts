import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteBitumenRepository} from '../src/data/repositories/SqliteBitumenRepository';
import type {BitumenDeliveryDraft} from '../src/domain/bitumen';
import {AUTO_PLACE_TODAY_KEY} from '../src/data/repositories/BitumenRepository';
import {useLinesForBatch} from '../src/domain/bitumenUse';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Phase C against a real database: the rules, counting asphalt loads into the batch in use, reversing a cancelled load, keeping the rule
 * a load was counted with, moving a load, and adjusting the real amount. No load record is ever changed by any of it.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const clock=(local:string)=>vi.setSystemTime(new Date(local));

const LOAD_COLUMNS='id,transaction_number,confirmed_at,project_id,project_name,customer_id,customer_name,item_id,item_name,category_name,driver_name,truck_plate,empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,payment_status,company_name,status,quantity_method,direct_quantity,direct_unit_symbol,load_number';

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('khayat','Khayat Al Sabouri',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Produced','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO load_number_series (id,prefix,prefix_key,display_name,is_default,is_active,created_at,updated_at) VALUES ('series_asp','ASP','ASP','Asphalt',0,1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,loads_enabled,is_active,load_number_series_id,created_at,updated_at) VALUES ('base','cat','Asphalt Mix – Base',1,1,'series_asp','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,loads_enabled,is_active,load_number_series_id,created_at,updated_at) VALUES ('wear','cat','Asphalt Mix – Wearing',1,1,'series_asp','${SEED_TIME}','${SEED_TIME}');
    INSERT INTO catalog_items (id,category_id,name,loads_enabled,is_active,created_at,updated_at) VALUES ('sand','cat','Sand',1,1,'${SEED_TIME}','${SEED_TIME}');
  `);
  db.raw.exec('PRAGMA foreign_keys=OFF;');
  const store=new Map<string,string>();
  const repository=new SqliteBitumenRepository(db as never,{getItem:async key=>store.get(key)??null,setItem:async(key,value)=>{store.set(key,value);}});
  const draft=(extra:Partial<BitumenDeliveryDraft>={}):BitumenDeliveryDraft=>({recordDate:'2026-10-12',supplierId:'khayat',invoiceNumber:'1',ticketNumber:'',gradeId:'bitumen_grade_60_70',kg:'20000',priceBasis:'per_ton',price:'',vat:{mode:'none',ratePercent:''},notes:'',...extra});
  const deliver=(local:string,extra:Partial<BitumenDeliveryDraft>={})=>{clock(local);return repository.recordDelivery(draft({recordDate:local.slice(0,10),...extra}));};
  let n=0;
  const addLoad=(id:string,confirmedAt:string,netKg:number,extra:{itemId?:string;status?:string;direct?:{quantity:number;unit:string};billed?:{quantity:number;unit:string}}={})=>{
    const itemId=extra.itemId??'base',direct=extra.direct;
    const itemName=itemId==='base'?'Asphalt Mix – Base':itemId==='wear'?'Asphalt Mix – Wearing':'Sand';
    db.raw.prepare(`INSERT INTO loads (${LOAD_COLUMNS}) VALUES (${LOAD_COLUMNS.split(',').map(()=>'?').join(',')})`).run(
      id,`TXN-${id}`,confirmedAt,'road','Mountain Road','customer','Road Co',itemId,itemName,'Produced','Driver A','A111',10000,10000+netKg,netKg,'conv','Kg to t','1000 kg = 1 t',extra.billed?.unit??'t',netKg/1000,extra.billed?.quantity??netKg/1000,
      'Unpriced','DROMEX',extra.status??'Active',direct?'direct':'weighbridge',direct?.quantity??null,direct?.unit??null,`ASP-${String(++n).padStart(5,'0')}`);
  };
  const setStatus=(id:string,status:string)=>db.raw.prepare('UPDATE loads SET status=? WHERE id=?').run(status,id);
  const tick=(itemId='base',bitumenKg='50',countFrom='2026-10-01')=>repository.saveRule({itemId,enabled:true,aggregateTons:'1.6',bitumenKg,countFrom});
  const batch=async(number:string)=>(await repository.getOverview()).batches.find(value=>value.batchNumber===number)!;
  return {db,store,repository,deliver,addLoad,setStatus,tick,batch};
}

/** Left-out loads against a real database: the reproduction, Add to batch by hand, the switch for today's loads and the batch totals. */
const leftOutSetup=async()=>{
  const env=await setup();
  clock('2026-11-03T08:00:00');
  await env.deliver('2026-11-03T08:00:00',{kg:'200'});await env.tick();
  env.addLoad('l1','2026-11-03T09:00:00',32000);// needs 1,000 kg: 200 in batch 1, 800 left out (yesterday)
  clock('2026-11-04T08:00:00');
  env.addLoad('l2','2026-11-04T09:00:00',32000);// needs 1,000 kg: all left out (today)
  await env.repository.syncUse();
  return env;
};
const uncovered=async(repository:SqliteBitumenRepository)=>(await repository.syncUse()).attention.filter(item=>item.kind==='uncovered').map(item=>[item.loadNumber,item.kg]);

describe('a load left out of a batch',()=>{
  it('stays out when room appears later, and says what really happens',async()=>{
    const {repository,deliver}=await leftOutSetup();
    expect(await uncovered(repository)).toEqual([['ASP-00001',800],['ASP-00002',1000]]);
    await deliver('2026-11-04T10:00:00',{kg:'5000'});
    const result=await repository.syncUse();
    expect(result.added).toBe(0);
    expect(result.attention.map(item=>item.confirmedAt)).toEqual(['2026-11-03T09:00:00','2026-11-04T09:00:00']);
    expect(result.attention[0]!.note).toMatch(/Add to batch/);
  });
  it('is added to a batch by hand, once, with the batch totals matching',async()=>{
    const {repository,deliver,batch}=await leftOutSetup();
    await deliver('2026-11-04T10:00:00',{kg:'5000'});
    const target=(await batch('BIT-2026-00002')).id;
    const result=await repository.addLoadToBatch('l2',target);
    expect(result).toMatchObject({addedKg:1000,uncoveredKg:0});
    expect(await uncovered(repository)).toEqual([['ASP-00001',800]]);
    expect(await batch('BIT-2026-00002')).toMatchObject({usedKg:1000,remainingKg:4000});
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:200});
    await expect(repository.addLoadToBatch('l2',target)).rejects.toThrow(/no bitumen left out/);
    const rows=(await repository.getOverview()).useRows!;
    expect(useLinesForBatch(rows,target).map(line=>[line.loadNumber,line.kg])).toEqual([['ASP-00002',1000]]);
    expect(rows.filter(row=>row.loadId==='l2').map(row=>[row.kind,row.kg,row.note])).toEqual([['use',1000,'No open batch had enough bitumen'],['reversal',-1000,'Added by hand from Needs attention'],['moved',1000,'Added by hand from Needs attention']]);
  });
  it('adds only what fits and keeps the rest listed; lists the picker with what each batch has left',async()=>{
    const {repository,deliver,batch}=await leftOutSetup();
    await deliver('2026-11-04T10:00:00',{kg:'300'});
    const small=(await batch('BIT-2026-00002')).id;
    const detail=(await repository.getLeftOutLoad('l2'))!;
    expect(detail.detail).toMatchObject({loadNumber:'ASP-00002',mixKg:32000,requiredKg:1000,uncoveredKg:1000,percent:3.125});
    expect(detail.batches.find(option=>option.batchId===small)).toMatchObject({state:'partial',remainingKg:300});
    expect(detail.batches.find(option=>option.batchNumber==='BIT-2026-00001')).toMatchObject({state:'full',remainingKg:0});
    expect(await repository.addLoadToBatch('l2',small)).toMatchObject({addedKg:300,uncoveredKg:700});
  });
  it('refuses a closed batch, and a batch that had not arrived by the load day',async()=>{
    const {repository,deliver,batch}=await leftOutSetup();
    await deliver('2026-11-04T10:00:00',{kg:'5000'});
    const later=await batch('BIT-2026-00002');
    await expect(repository.addLoadToBatch('l1',later.id)).rejects.toThrow(/still open and had arrived/);// arrived 4 Nov, the load is of 3 Nov
    await repository.closeBatch(later.id,'2026-11-04','Done');
    await expect(repository.addLoadToBatch('l2',later.id)).rejects.toThrow(/still open/);
    expect((await repository.getLeftOutLoad('l2'))!.batches.find(option=>option.batchId===later.id)).toMatchObject({state:'closed'});
  });
});

describe("the switch for today's loads",()=>{
  it('is off by default and places nothing',async()=>{
    const {repository,deliver}=await leftOutSetup();
    expect(await repository.getAutoPlaceToday()).toBe(false);
    await deliver('2026-11-04T10:00:00',{kg:'5000'});
    expect(await uncovered(repository)).toEqual([['ASP-00001',800],['ASP-00002',1000]]);
  });
  it("places only today's load after a delivery, never yesterday's, and repeated opens add no rows",async()=>{
    const {repository,deliver,batch,store}=await leftOutSetup();
    await repository.setAutoPlaceToday(true);
    expect(store.get(AUTO_PLACE_TODAY_KEY)).toBe('1');
    await deliver('2026-11-04T10:00:00',{kg:'5000'});
    expect(await uncovered(repository)).toEqual([['ASP-00001',800]]);
    const count=(await repository.getOverview()).useRows!.length;
    await repository.syncUse();await repository.syncUse();
    expect((await repository.getOverview()).useRows!.length).toBe(count);
    expect(await batch('BIT-2026-00002')).toMatchObject({usedKg:1000});
    expect((await repository.getOverview()).useRows!.filter(row=>row.note==='Counted automatically on the day it was made').length).toBe(2);
  });
  it('keeps earlier placements when turned off, and a load of yesterday stays listed when the day changes',async()=>{
    const {repository,deliver}=await leftOutSetup();
    await repository.setAutoPlaceToday(true);
    await deliver('2026-11-04T10:00:00',{kg:'5000'});
    await repository.setAutoPlaceToday(false);
    expect(await repository.getAutoPlaceToday()).toBe(false);
    expect(await uncovered(repository)).toEqual([['ASP-00001',800]]);
    clock('2026-11-05T08:00:00');
    await repository.setAutoPlaceToday(true);
    expect(await uncovered(repository)).toEqual([['ASP-00001',800]]);
  });
  it('is stored under a dromex. key, which the backup already carries',()=>{
    expect(AUTO_PLACE_TODAY_KEY.startsWith('dromex.')).toBe(true);
  });
});
