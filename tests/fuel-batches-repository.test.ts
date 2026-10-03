import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-492. Diesel batches on top of the existing single-tank ledger: opening stock, a batch per delivery,
 * derived first-in-first-out allocation of fills, dip adjustments, overfill, cancellations, and outside
 * station fills. Time is controlled so every record has a known date and the tests are repeatable.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});

const clock=(local:string)=>vi.setSystemTime(new Date(local));
const day=(local:string)=>local.slice(0,10);

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Al-Nour Fuel',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO machine_profiles (id,name,is_active,created_at,updated_at) VALUES ('exc','Excavator CAT 320',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO machine_profiles (id,name,is_active,created_at,updated_at) VALUES ('gen','Generator',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('trk','72-118',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const repository=new SqliteFuelRepository(db as never);
  const site=await repository.createCompanySite('Main Yard');
  const deliver=(local:string,litres:number,price:string,ticket='')=>{clock(local);return repository.recordDelivery({recordDate:day(local),supplierId:'sup',litres:String(litres),ticketNumber:ticket,pricePerLitreUsd:price,updateCurrentPrice:false,notes:''});};
  const fillDraft=(local:string,litres:number,extra:Record<string,unknown>={})=>({recordDate:day(local),fuelType:'diesel' as const,litres:String(litres),equipmentType:'machine' as const,equipmentId:'exc',destinationType:'project' as const,projectId:'road',companySiteId:'',odometerReading:'',pricePerLitreUsd:'',priceOverrideReason:'',notes:'',...extra});
  const fill=(local:string,litres:number,extra:Record<string,unknown>={})=>{clock(local);return repository.recordFill(fillDraft(local,litres,extra) as never);};
  const dip=(local:string,litres:number)=>{clock(local);return repository.recordGauge({recordDate:day(local),actualLitres:String(litres),reason:'Morning dip',notes:''});};
  const start=(local:string,extra:Record<string,unknown>={})=>{clock(local);return repository.startDieselBatches({dipLitres:'',pricePerLitreUsd:'',...extra});};
  const tankMatchesLedger=async()=>{const overview=await repository.getOverview(),batches=await repository.getBatchOverview();expect(batches.tankLitres).toBe(overview.currentBalanceLitres);};
  return {db,repository,site,deliver,fill,fillDraft,dip,start,tankMatchesLedger};
}
const numbers=(batches:{batchNumber:string}[])=>batches.map(batch=>batch.batchNumber);
const batch=async(repository:SqliteFuelRepository,number:string)=>(await repository.getBatchOverview()).batches.find(value=>value.batchNumber===number)!;

describe('before diesel batch tracking starts',()=>{
  it('changes nothing: no batch, the ledger balance is the tank, and fills keep their current price rules',async()=>{
    const {repository,deliver,fill}=await setup();
    await deliver('2026-09-20T09:00:00',1000,'1.00','INV-1');
    const saved=await fill('2026-09-21T09:00:00',150);
    const overview=await repository.getBatchOverview();
    expect(overview).toMatchObject({started:false,startedAt:null,batches:[],fills:{},adjustments:[],tankLitres:850,overfillAlert:false});
    expect(saved).toMatchObject({litres:150,fuelType:'diesel',pricePerLitreUsd:null,consumptionCostUsd:null});
    expect((await repository.getOverview()).currentBalanceLitres).toBe(850);
  });
});

describe('starting diesel batches',()=>{
  it('creates an Opening stock batch from the calculated tank balance and labels it as calculated',async()=>{
    const {repository,deliver,fill,start}=await setup();
    await deliver('2026-09-20T09:00:00',1000,'1.00');
    await fill('2026-09-21T09:00:00',150);
    const opening=await start('2026-10-01T09:00:00');
    expect(opening).toMatchObject({batchNumber:'DSL-2026-00001',kind:'opening',openingBasis:'calculated',deliveredLitres:850,remainingLitres:850,status:'in_use',pricePerLitreUsd:null,invoiceNumber:null});
    expect(await repository.getBatchOverview()).toMatchObject({started:true,tankLitres:850});
  });

  it('can start from a dip reading, recording the reading and using it as the opening litres',async()=>{
    const {repository,deliver,start,db}=await setup();
    await deliver('2026-09-20T09:00:00',1000,'1.00');
    const opening=await start('2026-10-01T09:00:00',{dipLitres:'820',pricePerLitreUsd:'1.05'});
    expect(opening).toMatchObject({openingBasis:'dip',deliveredLitres:820,remainingLitres:820,pricePerLitreUsd:1.05});
    expect(db.raw.prepare("SELECT litres,reason FROM fuel_movements WHERE movement_type='gauge'").all()).toEqual([{litres:820,reason:'Opening stock for diesel batches'}]);
    expect((await repository.getOverview()).currentBalanceLitres).toBe(820);
    expect((await repository.getBatchOverview()).tankLitres).toBe(820);
  });

  it('starts tracking without an opening batch when the tank is empty',async()=>{
    const {repository,start}=await setup();
    expect(await start('2026-10-01T09:00:00')).toBeNull();
    expect(await repository.getBatchOverview()).toMatchObject({started:true,batches:[],tankLitres:0});
  });

  it('refuses to start twice',async()=>{
    const {start}=await setup();
    await start('2026-10-01T09:00:00');
    await expect(start('2026-10-01T10:00:00')).rejects.toThrow('Diesel batch tracking has already started.');
  });

  it('refuses a negative dip reading',async()=>{
    const {start}=await setup();
    await expect(start('2026-10-01T09:00:00',{dipLitres:'-5'})).rejects.toThrow();
  });
});

describe('a batch for every delivery',()=>{
  it('numbers each new diesel delivery, keeps the invoice number and the batch price, and starts it waiting behind older diesel',async()=>{
    const {repository,deliver,start}=await setup();
    await start('2026-10-01T09:00:00');
    const first=await deliver('2026-10-02T09:00:00',1000,'1.10','55821');
    const second=await deliver('2026-10-03T09:00:00',500,'','');
    const overview=await repository.getBatchOverview();
    expect(numbers(overview.batches)).toEqual(['DSL-2026-00001','DSL-2026-00002']);
    expect(overview.batches[0]).toMatchObject({kind:'delivery',invoiceNumber:'55821',supplierName:'Al-Nour Fuel',pricePerLitreUsd:1.1,deliveredLitres:1000,status:'in_use',deliveryMovementId:first.id});
    expect(overview.batches[1]).toMatchObject({invoiceNumber:null,pricePerLitreUsd:null,status:'waiting',deliveryMovementId:second.id});
    expect(overview.tankLitres).toBe(1500);
  });

  it('numbers per arrival-date year and never reuses a number, even after a batch is cancelled',async()=>{
    const {repository,deliver,start}=await setup();
    await start('2026-10-01T09:00:00');
    const first=await deliver('2026-10-02T09:00:00',100,'1.00');
    await repository.cancelMovement(first.id,'Entered twice');
    const second=await deliver('2026-10-03T09:00:00',100,'1.00');
    const overview=await repository.getBatchOverview();
    expect(numbers(overview.batches)).toEqual(['DSL-2026-00001','DSL-2026-00002']);
    expect(overview.batches[0]).toMatchObject({status:'cancelled',cancellationReason:'Entered twice',remainingLitres:0});
    expect(overview.batches[1]).toMatchObject({deliveryMovementId:second.id,status:'in_use'});
    expect(overview.tankLitres).toBe(100);
  });

  it('does not make a batch of a delivery dated before tracking started',async()=>{
    const {repository,deliver,start}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-03T09:00:00',300,'1.00');
    await deliver('2026-09-15T09:00:00',900,'1.00');
    expect(numbers((await repository.getBatchOverview()).batches)).toEqual(['DSL-2026-00001']);
  });

  it('does not change the supplier delivery record or its payment status',async()=>{
    const {db,deliver,start}=await setup();
    await start('2026-10-01T09:00:00');
    const delivery=await deliver('2026-10-02T09:00:00',1000,'1.10','55821');
    expect(db.raw.prepare('SELECT litres,ticket_number,final_total_usd_cents,payment_status FROM fuel_movements WHERE id=?').get(delivery.id)).toEqual({litres:1000,ticket_number:'55821',final_total_usd_cents:110000,payment_status:'Unpaid'});
  });
});

describe('filling from the tank',()=>{
  it('takes the fill from the oldest batch, prices it at the batch price, and keeps the tank equal to the ledger',async()=>{
    const {repository,deliver,fill,start,tankMatchesLedger}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',1000,'1.10');
    const saved=await fill('2026-10-03T09:00:00',160);
    const overview=await repository.getBatchOverview();
    expect(overview.fills[saved.id]!.portions).toEqual([{batchId:expect.any(String),batchNumber:'DSL-2026-00001',litres:160,kind:'fill'}]);
    expect(overview.fills[saved.id]!.cost).toMatchObject({costUsd:176,fullyPriced:true});
    expect(overview.batches[0]).toMatchObject({filledLitres:160,remainingLitres:840});
    await tankMatchesLedger();
    const row=(await repository.getOverview()).movements.find(value=>value.id===saved.id)!;
    expect(row).toMatchObject({pricePerLitreUsd:1.1,consumptionCostUsd:176,fuelSource:'tank'});
  });

  it('splits a fill across batches, closes the first, and prices each portion at its own batch price',async()=>{
    const {repository,deliver,fill,start,tankMatchesLedger}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',1000,'1.10');
    await deliver('2026-10-03T08:00:00',1000,'1.30');
    await fill('2026-10-03T09:00:00',660);
    const saved=await fill('2026-10-03T10:00:00',400);
    const overview=await repository.getBatchOverview();
    expect(overview.fills[saved.id]!.portions.map(value=>[value.batchNumber,value.litres])).toEqual([['DSL-2026-00001',340],['DSL-2026-00002',60]]);
    expect(overview.fills[saved.id]!.cost).toMatchObject({costUsd:452,fullyPriced:true});
    expect(overview.batches.map(value=>value.status)).toEqual(['closed','in_use']);
    expect(overview.tankLitres).toBe(940);
    await tankMatchesLedger();
  });

  it('leaves the price and cost empty when any portion has no price, never storing a zero',async()=>{
    const {repository,deliver,fill,start}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    await deliver('2026-10-03T08:00:00',1000,'');
    const saved=await fill('2026-10-03T09:00:00',150);
    const overview=await repository.getBatchOverview();
    expect(overview.fills[saved.id]!.cost).toMatchObject({costUsd:100,pricedLitres:100,unpricedLitres:50,fullyPriced:false});
    expect((await repository.getOverview()).movements.find(value=>value.id===saved.id)).toMatchObject({pricePerLitreUsd:null,consumptionCostUsd:null});
  });

  it('draws first from the batch the user chose, then continues in order',async()=>{
    const {repository,deliver,fill,start}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    const second=await deliver('2026-10-02T10:00:00',100,'1.20');
    const batches=(await repository.getBatchOverview()).batches;
    const saved=await fill('2026-10-03T09:00:00',130,{batchId:batches[1]!.id});
    expect(second.id).toBeTruthy();
    expect((await repository.getBatchOverview()).fills[saved.id]!.portions.map(value=>[value.batchNumber,value.litres])).toEqual([['DSL-2026-00002',100],['DSL-2026-00001',30]]);
  });

  it('rejects a chosen batch that does not exist or is cancelled, saving nothing',async()=>{
    const {db,repository,deliver,fill,start}=await setup();
    await start('2026-10-01T09:00:00');
    const delivery=await deliver('2026-10-02T09:00:00',100,'1.00');
    await deliver('2026-10-02T10:00:00',100,'1.00');
    await repository.cancelMovement(delivery.id,'Wrong');
    const cancelled=(await repository.getBatchOverview()).batches[0]!;
    await expect(fill('2026-10-03T09:00:00',10,{batchId:cancelled.id})).rejects.toThrow('Choose an open diesel batch.');
    await expect(fill('2026-10-03T09:05:00',10,{batchId:'nope'})).rejects.toThrow('Choose an open diesel batch.');
    expect(db.raw.prepare("SELECT COUNT(*) n FROM fuel_movements WHERE movement_type='fill'").get()).toEqual({n:0});
  });

  it('keeps fills dated before tracking started out of every batch',async()=>{
    const {repository,deliver,fill,start}=await setup();
    await deliver('2026-09-20T09:00:00',1000,'1.00');
    await start('2026-10-01T09:00:00');
    const early=await fill('2026-09-25T09:00:00',50);
    expect((await repository.getBatchOverview()).fills[early.id]).toBeUndefined();
    expect((await repository.getOverview()).movements.find(value=>value.id===early.id)).toMatchObject({pricePerLitreUsd:null});
  });

  it('never allocates a gasoline fill to a diesel batch, and it never changes the tank',async()=>{
    const {repository,deliver,fill,start}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    const gasoline=await fill('2026-10-03T09:00:00',20,{fuelType:'gasoline'});
    const overview=await repository.getBatchOverview();
    expect(overview.fills[gasoline.id]).toBeUndefined();
    expect(overview.tankLitres).toBe(100);
  });
});

describe('overfill',()=>{
  it('saves a fill larger than all diesel, shows the shortfall and alert, and is resolved by a later delivery',async()=>{
    const {repository,deliver,fill,start,tankMatchesLedger}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    const saved=await fill('2026-10-03T09:00:00',130);
    let overview=await repository.getBatchOverview();
    expect(overview).toMatchObject({overfillAlert:true,outstandingShortfallLitres:30,tankLitres:0});
    expect(overview.fills[saved.id]).toMatchObject({shortfallLitres:30,outstandingShortfallLitres:30});
    expect((await repository.getOverview()).currentBalanceLitres).toBe(-30);
    await deliver('2026-10-04T09:00:00',1000,'1.10');
    overview=await repository.getBatchOverview();
    expect(overview).toMatchObject({overfillAlert:false,outstandingShortfallLitres:0,tankLitres:970});
    expect(overview.fills[saved.id]!.portions.map(value=>[value.batchNumber,value.litres,value.kind])).toEqual([['DSL-2026-00001',100,'fill'],['DSL-2026-00002',30,'cover']]);
    await tankMatchesLedger();
  });
});

describe('dip readings',()=>{
  it('records a difference as a visible adjustment on the oldest open batch and keeps both figures',async()=>{
    const {repository,deliver,fill,dip,start,tankMatchesLedger}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',1000,'1.00');
    await deliver('2026-10-02T10:00:00',1000,'1.00');
    await fill('2026-10-03T08:00:00',640);
    await dip('2026-10-03T09:00:00',1340);
    const overview=await repository.getBatchOverview();
    expect(overview.adjustments).toEqual([expect.objectContaining({batchNumber:'DSL-2026-00001',litres:-20,calculatedLitres:1360,dipLitres:1340})]);
    expect(overview.batches[0]).toMatchObject({adjustmentLitres:-20,remainingLitres:340});
    expect(overview.tankLitres).toBe(1340);
    await tankMatchesLedger();
  });

  it('keeps the tank equal to the ledger through a long mixed sequence',async()=>{
    const {repository,deliver,fill,dip,start,tankMatchesLedger}=await setup();
    await deliver('2026-09-20T09:00:00',500,'1.00');
    await fill('2026-09-21T09:00:00',120);
    await start('2026-10-01T09:00:00',{dipLitres:'370'});
    await tankMatchesLedger();
    await deliver('2026-10-01T10:00:00',800,'1.05','A-1');await tankMatchesLedger();
    await fill('2026-10-01T11:00:00',200);await tankMatchesLedger();
    await fill('2026-10-02T09:00:00',300,{equipmentId:'gen'});await tankMatchesLedger();
    await dip('2026-10-02T10:00:00',650);await tankMatchesLedger();
    await deliver('2026-10-02T11:00:00',400,'1.15','A-2');await tankMatchesLedger();
    await fill('2026-10-03T09:00:00',900);await tankMatchesLedger();
    await fill('2026-10-03T10:00:00',400);
    expect((await repository.getBatchOverview()).overfillAlert).toBe(true);
    await deliver('2026-10-03T11:00:00',1000,'1.20','A-3');await tankMatchesLedger();
    expect((await repository.getBatchOverview()).overfillAlert).toBe(false);
  });
});

describe('cancelling and correcting',()=>{
  it('re-allocates when a fill is cancelled and frees its litres for the next fill',async()=>{
    const {repository,deliver,fill,start,tankMatchesLedger}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    const first=await fill('2026-10-03T09:00:00',80);
    await repository.cancelMovement(first.id,'Wrong machine');
    const second=await fill('2026-10-03T10:00:00',90);
    const overview=await repository.getBatchOverview();
    expect(overview.fills[first.id]).toBeUndefined();
    expect(overview.fills[second.id]!.portions.map(value=>value.litres)).toEqual([90]);
    expect(overview.batches[0]!.remainingLitres).toBe(10);
    await tankMatchesLedger();
  });

  it('re-allocates the fills of a cancelled delivery and shows the resulting shortfall',async()=>{
    const {repository,deliver,fill,start}=await setup();
    await start('2026-10-01T09:00:00');
    const delivery=await deliver('2026-10-02T09:00:00',100,'1.00');
    const saved=await fill('2026-10-03T09:00:00',60);
    await repository.cancelMovement(delivery.id,'Never arrived');
    const overview=await repository.getBatchOverview();
    expect(overview.overfillAlert).toBe(true);
    expect(overview.fills[saved.id]).toMatchObject({shortfallLitres:60,portions:[]});
  });

  it('refuses to cancel a priced delivery that has active payments, as before',async()=>{
    const {db,repository,deliver,start}=await setup();
    await start('2026-10-01T09:00:00');
    const delivery=await deliver('2026-10-02T09:00:00',100,'1.00');
    db.raw.prepare("INSERT INTO payment_entries (id,target_type,fuel_movement_id,amount_usd_cents,payment_date,status,created_at) VALUES ('p1','fuelDelivery',?,1000,'2026-10-02','Active',?)").run(delivery.id,SEED_TIME);
    await expect(repository.cancelMovement(delivery.id,'Wrong')).rejects.toThrow('Cancel active supplier payments');
    expect((await repository.getBatchOverview()).batches[0]!.status).not.toBe('cancelled');
  });

  it('updates the batch when its delivery is corrected, and re-prices the fills drawn from it',async()=>{
    const {repository,deliver,fill,start}=await setup();
    await start('2026-10-01T09:00:00');
    const delivery=await deliver('2026-10-02T09:00:00',1000,'1.10','55821');
    const saved=await fill('2026-10-03T09:00:00',100);
    await repository.correctDelivery(delivery.id,{recordDate:'2026-10-02',supplierId:'sup',litres:'900',ticketNumber:'55822',pricePerLitreUsd:'1.20',notes:'',correctionReason:'Invoice corrected'});
    const overview=await repository.getBatchOverview();
    expect(overview.batches[0]).toMatchObject({deliveredLitres:900,invoiceNumber:'55822',pricePerLitreUsd:1.2,remainingLitres:800,batchNumber:'DSL-2026-00001'});
    expect(overview.fills[saved.id]!.cost).toMatchObject({costUsd:120});
    expect((await repository.getOverview()).movements.find(value=>value.id===saved.id)).toMatchObject({consumptionCostUsd:120});
  });

  it('refuses to move a batch delivery to a date before tracking started',async()=>{
    const {repository,deliver,start}=await setup();
    await start('2026-10-01T09:00:00');
    const delivery=await deliver('2026-10-02T09:00:00',100,'1.00');
    await expect(repository.correctDelivery(delivery.id,{recordDate:'2026-09-20',supplierId:'sup',litres:'100',ticketNumber:'',pricePerLitreUsd:'1.00',notes:'',correctionReason:'Wrong date'})).rejects.toThrow('on or after the day diesel batch tracking started');
  });

  it('updates the allocation when a fill is corrected',async()=>{
    const {repository,deliver,fill,start,tankMatchesLedger}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    const saved=await fill('2026-10-03T09:00:00',60);
    await repository.correctFill(saved.id,{recordDate:'2026-10-03',fuelType:'diesel',litres:'90',equipmentType:'machine',equipmentId:'exc',destinationType:'project',projectId:'road',companySiteId:'',odometerReading:'',pricePerLitreUsd:'',priceOverrideReason:'',notes:'',correctionReason:'Pump showed 90'});
    expect((await repository.getBatchOverview()).batches[0]).toMatchObject({filledLitres:90,remainingLitres:10});
    await tankMatchesLedger();
  });

  it('records a note when an earlier fill is re-allocated by a back-dated delivery',async()=>{
    const {db,repository,deliver,fill,start}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    const later=await fill('2026-10-04T09:00:00',150);
    const backDated=await deliver('2026-10-03T09:00:00',500,'1.10');
    expect((await repository.getBatchOverview()).fills[later.id]!.portions.map(value=>[value.batchNumber,value.litres])).toEqual([['DSL-2026-00001',100],['DSL-2026-00002',50]]);
    const events=db.raw.prepare('SELECT movement_id,caused_by_movement_id,before_json,after_json FROM fuel_allocation_events').all() as {movement_id:string;caused_by_movement_id:string;before_json:string;after_json:string}[];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({movement_id:later.id,caused_by_movement_id:backDated.id});
    expect(JSON.parse(events[0]!.before_json)).toEqual([{batch:'DSL-2026-00001',litres:100,kind:'fill'},{batch:null,litres:50,kind:'shortfall'}]);
    expect(JSON.parse(events[0]!.after_json)).toEqual([{batch:'DSL-2026-00001',litres:100,kind:'fill'},{batch:'DSL-2026-00002',litres:50,kind:'fill'}]);
    expect((await repository.getBatchOverview()).changes).toEqual([expect.objectContaining({movementId:later.id,causedByMovementId:backDated.id})]);
  });

  it('records no note for a new fill, a correction of the fill itself, or an unchanged allocation',async()=>{
    const {db,deliver,fill,start}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',1000,'1.00');
    await fill('2026-10-03T09:00:00',100);
    await fill('2026-10-03T10:00:00',100);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM fuel_allocation_events').get()).toEqual({n:0});
  });
});

describe('cancelling a batch',()=>{
  it('cancels the delivery behind a batch with a reason, and the number is never reused',async()=>{
    const {repository,deliver,start}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    const target=(await repository.getBatchOverview()).batches[0]!;
    await repository.cancelBatch(target.id,'Delivery refused');
    const overview=await repository.getBatchOverview();
    expect(overview.batches[0]).toMatchObject({status:'cancelled',cancellationReason:'Delivery refused'});
    await deliver('2026-10-03T09:00:00',100,'1.00');
    expect(numbers((await repository.getBatchOverview()).batches)).toEqual(['DSL-2026-00001','DSL-2026-00002']);
    await expect(repository.cancelBatch(target.id,'Again')).rejects.toThrow('already cancelled');
    await expect(repository.cancelBatch(target.id,'  ')).rejects.toThrow('reason');
  });

  it('cancels an Opening stock batch directly',async()=>{
    const {repository,deliver,start}=await setup();
    await deliver('2026-09-20T09:00:00',500,'1.00');
    const opening=await start('2026-10-01T09:00:00');
    await repository.cancelBatch(opening!.id,'Counted wrongly');
    expect((await repository.getBatchOverview()).batches[0]).toMatchObject({status:'cancelled',kind:'opening'});
  });
});

describe('outside station fills',()=>{
  it('keeps a saved, searchable stations list that never repeats an active name',async()=>{
    const {repository}=await setup();
    const station=await repository.createFuelStation({name:'  Hasbaya   Highway Station ',location:'Hasbaya',notes:''});
    expect(station).toMatchObject({name:'Hasbaya Highway Station',location:'Hasbaya',isActive:true});
    await expect(repository.createFuelStation({name:'hasbaya highway station',location:'',notes:''})).rejects.toThrow('already exists');
    await expect(repository.createFuelStation({name:'   ',location:'',notes:''})).rejects.toThrow('name is required');
    await repository.renameFuelStation(station.id,'Hasbaya Station');
    await repository.setFuelStationActive(station.id,false);
    await repository.createFuelStation({name:'Hasbaya Station',location:'',notes:''});
    expect((await repository.getSetup()).fuelStations.map(value=>[value.name,value.isActive])).toEqual([['Hasbaya Station',true],['Hasbaya Station',false]]);
  });

  it('records a fill from a station without touching the tank or any batch',async()=>{
    const {repository,deliver,fill,start,tankMatchesLedger}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    const station=await repository.createFuelStation({name:'Hasbaya Highway Station',location:'',notes:''});
    const saved=await fill('2026-10-03T09:00:00',60,{fuelSource:'station',stationId:station.id,receiptNumber:'R-7731',equipmentType:'truck',equipmentId:'trk'});
    expect(saved).toMatchObject({fuelSource:'station',fuelStationId:station.id,fuelStationName:'Hasbaya Highway Station',ticketNumber:'R-7731',litres:60,pricePerLitreUsd:null,consumptionCostUsd:null,fuelType:'diesel'});
    const overview=await repository.getBatchOverview();
    expect(overview.fills[saved.id]).toBeUndefined();
    expect(overview.tankLitres).toBe(100);
    expect(overview.batches[0]).toMatchObject({filledLitres:0,remainingLitres:100});
    expect((await repository.getOverview()).currentBalanceLitres).toBe(100);
    await tankMatchesLedger();
  });

  it('keeps the station and the price for cost history, and counts the fill in project fuel',async()=>{
    const {repository,fill}=await setup();
    const station=await repository.createFuelStation({name:'Highway Station',location:'',notes:''});
    const saved=await fill('2026-10-03T09:00:00',50,{fuelSource:'station',stationId:station.id,pricePerLitreUsd:'1.25'});
    expect(saved).toMatchObject({pricePerLitreUsd:1.25,consumptionCostUsd:62.5,fuelPriceHistoryId:null,projectName:'Mountain Road'});
    expect((await repository.getOverview()).currentBalanceLitres).toBe(0);
  });

  it('works before tracking starts and for gasoline, and still does not change the diesel tank',async()=>{
    const {repository,deliver,fill}=await setup();
    await deliver('2026-09-20T09:00:00',500,'1.00');
    const station=await repository.createFuelStation({name:'Highway Station',location:'',notes:''});
    await fill('2026-09-21T09:00:00',40,{fuelSource:'station',stationId:station.id});
    await fill('2026-09-21T10:00:00',20,{fuelSource:'station',stationId:station.id,fuelType:'gasoline'});
    expect((await repository.getOverview()).currentBalanceLitres).toBe(500);
  });

  it('requires an active saved station and rejects a free-typed or deactivated one, saving nothing',async()=>{
    const {db,repository,fill}=await setup();
    await expect(fill('2026-10-03T09:00:00',10,{fuelSource:'station'})).rejects.toThrow('Select a saved fuel station.');
    await expect(fill('2026-10-03T09:00:00',10,{fuelSource:'station',stationId:'made-up'})).rejects.toThrow('Select a saved fuel station.');
    const station=await repository.createFuelStation({name:'Highway Station',location:'',notes:''});
    await repository.setFuelStationActive(station.id,false);
    await expect(fill('2026-10-03T09:00:00',10,{fuelSource:'station',stationId:station.id})).rejects.toThrow('Select a saved fuel station.');
    expect(db.raw.prepare("SELECT COUNT(*) n FROM fuel_movements WHERE movement_type='fill'").get()).toEqual({n:0});
  });

  it('keeps the station fill unchanged when a station is renamed later, and when it is corrected',async()=>{
    const {repository,fill}=await setup();
    const station=await repository.createFuelStation({name:'Highway Station',location:'',notes:''});
    const saved=await fill('2026-10-03T09:00:00',50,{fuelSource:'station',stationId:station.id});
    await repository.renameFuelStation(station.id,'New Name');
    await repository.correctFill(saved.id,{recordDate:'2026-10-03',fuelType:'diesel',litres:'55',equipmentType:'machine',equipmentId:'exc',destinationType:'project',projectId:'road',companySiteId:'',odometerReading:'',pricePerLitreUsd:'',priceOverrideReason:'',notes:'',correctionReason:'Receipt said 55'});
    expect((await repository.getOverview()).movements.find(value=>value.id===saved.id)).toMatchObject({litres:55,fuelSource:'station',fuelStationName:'Highway Station'});
  });
});

describe('setup information for the screens',()=>{
  it('reports the stations and whether batch tracking has started',async()=>{
    const {repository,start}=await setup();
    expect(await repository.getSetup()).toMatchObject({fuelStations:[],batchTracking:{started:false,startedAt:null}});
    await start('2026-10-01T09:00:00');
    expect((await repository.getSetup()).batchTracking).toMatchObject({started:true,startedAt:expect.any(String)});
  });
});

describe('previewing a fill before it is saved',()=>{
  it('shows the portions, the batch that closes, and the tank after the fill, without saving anything',async()=>{
    const {db,repository,deliver,fill,start}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',1000,'1.10');
    await deliver('2026-10-03T08:00:00',1000,'1.30');
    await fill('2026-10-03T09:00:00',660);
    clock('2026-10-03T12:00:00');
    const preview=await repository.previewTankFill({litres:'400',batchId:'',recordDate:'2026-10-03'});
    expect(preview!.portions).toEqual([{batchId:expect.any(String),batchNumber:'DSL-2026-00001',litres:340,closesBatch:true,remainingAfterLitres:0,statusBefore:'in_use'},{batchId:expect.any(String),batchNumber:'DSL-2026-00002',litres:60,closesBatch:false,remainingAfterLitres:940,statusBefore:'waiting'}]);
    expect(preview).toMatchObject({tankBeforeLitres:1340,tankAfterLitres:940,shortfallLitres:0,overfillAlert:false,cost:{costUsd:452,fullyPriced:true}});
    expect(db.raw.prepare("SELECT COUNT(*) n FROM fuel_movements WHERE movement_type='fill'").get()).toEqual({n:1});
  });

  it('warns about an overfill and rejects a litre quantity that is not positive',async()=>{
    const {repository,deliver,start}=await setup();
    await start('2026-10-01T09:00:00');
    await deliver('2026-10-02T09:00:00',100,'1.00');
    clock('2026-10-03T12:00:00');
    expect(await repository.previewTankFill({litres:'130',batchId:'',recordDate:'2026-10-03'})).toMatchObject({overfillAlert:true,shortfallLitres:30,tankAfterLitres:0});
    await expect(repository.previewTankFill({litres:'0',batchId:'',recordDate:'2026-10-03'})).rejects.toThrow('Litres must be a number greater than zero.');
  });

  it('returns no preview before tracking starts',async()=>{
    const {repository}=await setup();
    expect(await repository.previewTankFill({litres:'10',batchId:'',recordDate:'2026-10-03'})).toBeNull();
  });
});

describe('the company shown on the Diesel Batch Report',()=>{
  it('comes from Company Settings: name, logo and contact details',async()=>{
    const {db,repository}=await setup();
    db.raw.exec(`INSERT INTO company_settings (id,company_name,logo_uri,address,phone,email,updated_at) VALUES ('company','Fakih Asphalt','file:///logo.png','Main Road, Hasbaya','+961 70 123 456','info@fakih.example','${SEED_TIME}')`);
    expect(await repository.getCompanyIdentity()).toEqual({name:'Fakih Asphalt',logoUri:'file:///logo.png',contactLine:'Main Road, Hasbaya · +961 70 123 456 · info@fakih.example'});
  });
  it('leaves out contact details that are not set, and falls back to DROMEX only when no company is saved',async()=>{
    const {db,repository}=await setup();
    expect(await repository.getCompanyIdentity()).toEqual({name:'DROMEX',logoUri:null,contactLine:null});
    db.raw.exec(`INSERT INTO company_settings (id,company_name,phone,updated_at) VALUES ('company','Fakih Asphalt','+961 70 123 456','${SEED_TIME}')`);
    expect(await repository.getCompanyIdentity()).toEqual({name:'Fakih Asphalt',logoUri:null,contactLine:'+961 70 123 456'});
  });
});
