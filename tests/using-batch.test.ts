import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {applyUsingBatch,type BatchStatus} from '../src/domain/fuelBatches';
import {openBatchOptions} from '../src/domain/fuelFillForm';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Phase A. "Use this batch first": the owner can name one open diesel batch that new fills draw from first. It changes labels and
 * what a new fill is taken from; it never changes a recorded fill, an amount or a price, and it falls back to the oldest open batch
 * as soon as the chosen batch is no longer open.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

const clock=(local:string)=>vi.setSystemTime(new Date(local));
const day=(local:string)=>local.slice(0,10);

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Khayat Al Sabouri',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO machine_profiles (id,name,is_active,created_at,updated_at) VALUES ('exc','Excavator',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const repository=new SqliteFuelRepository(db as never);
  const deliver=(local:string,litres:number,price='1.00')=>{clock(local);return repository.recordDelivery({recordDate:day(local),supplierId:'sup',litres:String(litres),ticketNumber:'',pricePerLitreUsd:price,updateCurrentPrice:false,notes:''} as never);};
  const fill=(local:string,litres:number,batchId='')=>{clock(local);return repository.recordFill({recordDate:day(local),fuelType:'diesel',litres:String(litres),equipmentType:'machine',equipmentId:'exc',destinationType:'project',projectId:'road',companySiteId:'',odometerReading:'',notes:'',pricePerLitreUsd:'',priceOverrideReason:'',fuelSource:'tank',fuelStationId:'',batchId} as never);};
  // The first batch: opening stock of 300 L; a second batch of 2,000 L arrives after it.
  clock('2026-10-01T09:00:00');await repository.startDieselBatches({dipLitres:'300',pricePerLitreUsd:'1.00'} as never);
  await deliver('2026-10-05T09:00:00',2000,'1.10');
  const overview=()=>repository.getBatchOverview();
  const ids=async()=>{const batches=(await overview()).batches;return {first:batches.find(value=>value.batchNumber==='DSL-2026-00001')!.id,second:batches.find(value=>value.batchNumber==='DSL-2026-00002')!.id};};
  const statuses=async()=>Object.fromEntries((await overview()).batches.map(value=>[value.batchNumber,value.status]));
  return {db,repository,fill,deliver,overview,ids,statuses};
}

describe('applyUsingBatch (pure)',()=>{
  const batch=(id:string,status:BatchStatus)=>({id,status});
  it('does nothing when no batch was chosen, or the chosen one is not open',()=>{
    const list=[batch('a','in_use'),batch('b','waiting'),batch('c','closed')];
    expect(applyUsingBatch(list,null)).toEqual({batches:list,usingBatchId:null});
    expect(applyUsingBatch(list,'c')).toEqual({batches:list,usingBatchId:null});
    expect(applyUsingBatch(list,'missing')).toEqual({batches:list,usingBatchId:null});
  });
  it('makes a waiting batch the one in use, moves it first among the open batches and relabels the old one as waiting',()=>{
    const result=applyUsingBatch([batch('closed','closed'),batch('a','in_use'),batch('b','waiting'),batch('c','waiting')],'c');
    expect(result.usingBatchId).toBe('c');
    expect(result.batches.map(value=>[value.id,value.status])).toEqual([['closed','closed'],['c','in_use'],['a','waiting'],['b','waiting']]);
  });
  it('keeps everything as it is when the chosen batch is already the first open one',()=>{
    const result=applyUsingBatch([batch('a','in_use'),batch('b','waiting')],'a');
    expect(result).toEqual({batches:[batch('a','in_use'),batch('b','waiting')],usingBatchId:'a'});
  });
});

describe('using batch in the repository',()=>{
  it('adds a nullable column in migration 57 and starts with no batch chosen',async()=>{
    const {db,overview}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(57);
    const column=(db.raw.prepare('PRAGMA table_info(fuel_batch_settings)').all() as {name:string;notnull:number}[]).find(value=>value.name==='using_batch_id');
    expect(column).toMatchObject({name:'using_batch_id',notnull:0});
    expect((await overview()).usingBatchId??null).toBeNull();
  });
  it('before anything is chosen, the oldest batch is in use and a fill draws from it',async()=>{
    const {fill,overview,statuses}=await setup();
    expect(await statuses()).toEqual({'DSL-2026-00001':'in_use','DSL-2026-00002':'waiting'});
    const saved=await fill('2026-10-06T09:00:00',100);
    expect((await overview()).fills[saved.id]!.portions).toEqual([expect.objectContaining({batchNumber:'DSL-2026-00001',litres:100})]);
  });
  it('after choosing the new batch, a new fill draws from it and the old batch keeps its litres',async()=>{
    const {repository,fill,overview,statuses,ids}=await setup();
    const before=await fill('2026-10-06T09:00:00',100);
    const {second}=await ids();
    const chosen=await repository.setUsingDieselBatch(second);
    expect(chosen.usingBatchId).toBe(second);
    expect(await statuses()).toEqual({'DSL-2026-00001':'waiting','DSL-2026-00002':'in_use'});
    expect(chosen.batches.map(value=>value.batchNumber)).toEqual(['DSL-2026-00002','DSL-2026-00001']);
    const after=await fill('2026-10-07T09:00:00',150);
    const current=await overview();
    expect(current.fills[after.id]!.portions).toEqual([expect.objectContaining({batchNumber:'DSL-2026-00002',litres:150})]);
    // The earlier fill is exactly as it was, and the old batch still holds what was left in it.
    expect(current.fills[before.id]!.portions).toEqual([expect.objectContaining({batchNumber:'DSL-2026-00001',litres:100})]);
    expect(current.batches.find(value=>value.batchNumber==='DSL-2026-00001')).toMatchObject({filledLitres:100,remainingLitres:200});
    expect(current.batches.find(value=>value.batchNumber==='DSL-2026-00002')).toMatchObject({filledLitres:150,remainingLitres:1850});
  });
  it('lets a single fill pick the old batch on purpose while another is in use',async()=>{
    const {repository,fill,overview,ids}=await setup();
    const {first,second}=await ids();
    await repository.setUsingDieselBatch(second);
    const saved=await fill('2026-10-07T09:00:00',50,first);
    expect((await overview()).fills[saved.id]!.portions).toEqual([expect.objectContaining({batchNumber:'DSL-2026-00001',litres:50})]);
  });
  it('previews a fill from the batch in use',async()=>{
    const {repository,ids}=await setup();
    const {second}=await ids();
    await repository.setUsingDieselBatch(second);
    clock('2026-10-07T09:00:00');
    const preview=await repository.previewTankFill({litres:'120',batchId:'',recordDate:'2026-10-07'} as never);
    expect(preview?.portions.map(value=>value.batchNumber)).toEqual(['DSL-2026-00002']);
  });
  it('goes back to the oldest first when the choice is cleared',async()=>{
    const {repository,fill,overview,statuses,ids}=await setup();
    const {second}=await ids();
    await repository.setUsingDieselBatch(second);
    const cleared=await repository.setUsingDieselBatch(null);
    expect(cleared.usingBatchId??null).toBeNull();
    expect(await statuses()).toEqual({'DSL-2026-00001':'in_use','DSL-2026-00002':'waiting'});
    const saved=await fill('2026-10-07T09:00:00',60);
    expect((await overview()).fills[saved.id]!.portions).toEqual([expect.objectContaining({batchNumber:'DSL-2026-00001'})]);
  });
  it('falls back to the oldest open batch when the chosen batch is empty',async()=>{
    const {repository,fill,overview,statuses,ids}=await setup();
    const {second}=await ids();
    await repository.setUsingDieselBatch(second);
    await fill('2026-10-07T09:00:00',2000);// empties the second batch
    expect(await statuses()).toEqual({'DSL-2026-00001':'in_use','DSL-2026-00002':'closed'});
    expect((await overview()).usingBatchId??null).toBeNull();
    const saved=await fill('2026-10-08T09:00:00',40);
    expect((await overview()).fills[saved.id]!.portions).toEqual([expect.objectContaining({batchNumber:'DSL-2026-00001',litres:40})]);
  });
  it('only accepts an open batch',async()=>{
    const {repository,fill,ids}=await setup();
    const {first,second}=await ids();
    await expect(repository.setUsingDieselBatch('nope')).rejects.toThrow('still open');
    await fill('2026-10-07T09:00:00',300,first);// empties the first batch
    await expect(repository.setUsingDieselBatch(first)).rejects.toThrow('still open');
    await expect(repository.setUsingDieselBatch(second)).resolves.toMatchObject({usingBatchId:second});
  });
  it('starts the fill form on the batch in use',async()=>{
    const {repository,ids}=await setup();
    const {second}=await ids();
    await repository.setUsingDieselBatch(second);
    const options=openBatchOptions((await repository.getBatchOverview()).batches);
    expect(options[0]!.label).toContain('DSL-2026-00002');
  });
  it('leaves every earlier record, price and cost untouched',async()=>{
    const {repository,fill,overview,ids}=await setup();
    const saved=await fill('2026-10-06T09:00:00',100);
    const before=JSON.stringify((await overview()).fills[saved.id]);
    const {second}=await ids();
    await repository.setUsingDieselBatch(second);
    expect(JSON.stringify((await overview()).fills[saved.id])).toBe(before);
  });
});
