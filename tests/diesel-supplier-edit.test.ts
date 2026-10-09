import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteFuelRepository} from '../src/data/repositories/SqliteFuelRepository';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * DEC-505. Diesel batches on top of the existing single-tank ledger: opening stock, a batch per delivery,
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

const batch=async(repository:SqliteFuelRepository,number:string)=>(await repository.getBatchOverview()).batches.find(value=>value.batchNumber===number)!;

/**
 * DEC-506. Editing a saved diesel batch: supplier, invoice number and price are free; litres and the arrival date
 * need a reason, and the litres can never go below what was already used. The supplier's diesel list follows.
 */
const plain=(repository:SqliteFuelRepository,local:string,litres:number)=>{vi.setSystemTime(new Date(local));return repository.recordDelivery({recordDate:local.slice(0,10),supplierId:'',litres:String(litres),ticketNumber:'',pricePerLitreUsd:'',updateCurrentPrice:false,notes:''});};
const draftOf=(detail:Awaited<ReturnType<typeof batch>>,change:Record<string,string>={})=>({supplierId:detail.supplierId??'',invoiceNumber:detail.invoiceNumber??'',pricePerLitreUsd:detail.pricePerLitreUsd==null?'':String(detail.pricePerLitreUsd),litres:String(detail.deliveredLitres),recordDate:detail.arrivedAt.slice(0,10),reason:'',...change});

describe('editing a diesel batch',()=>{
  it('saves supplier, invoice and price with no reason, without touching stock, and keeps the original in the history',async()=>{
    const {repository,deliver,fill,start,tankMatchesLedger,db}=await setup();
    await start('2026-10-01T08:00:00');
    await plain(repository,'2026-10-02T09:00:00',1000);
    await fill('2026-10-03T09:00:00',300);
    const before=await batch(repository,'DSL-2026-00001');
    expect(before).toMatchObject({supplierId:null,supplierName:null,invoiceNumber:null,pricePerLitreUsd:null,filledLitres:300,remainingLitres:700});
    const arrived=db.raw.prepare('SELECT confirmed_at FROM fuel_movements WHERE id=?').get(before.deliveryMovementId!) as {confirmed_at:string};
    const saved=await repository.editBatch(before.id,draftOf(before,{supplierId:'sup',invoiceNumber:'INV-77',pricePerLitreUsd:'1.20'}));
    expect(saved).toMatchObject({supplierId:'sup',supplierName:'Al-Nour Fuel',invoiceNumber:'INV-77',pricePerLitreUsd:1.2,remainingLitres:700,filledLitres:300});
    expect(saved.finalTotalUsd).toBe(1200);
    expect(saved.history).toHaveLength(1);
    expect(saved.history![0]).toMatchObject({kind:'details',changes:expect.arrayContaining([{field:'Supplier',originalValue:null,newValue:'Al-Nour Fuel'},{field:'Invoice number',originalValue:null,newValue:'INV-77'}])});
    expect((db.raw.prepare('SELECT confirmed_at FROM fuel_movements WHERE id=?').get(before.deliveryMovementId!) as {confirmed_at:string}).confirmed_at).toBe(arrived.confirmed_at);
    const fillRow=db.raw.prepare("SELECT price_per_litre_usd_cents p,consumption_cost_usd_cents c FROM fuel_movements WHERE movement_type='fill'").get() as {p:number;c:number};
    expect(fillRow).toEqual({p:120,c:36000});
    await tankMatchesLedger();
  });

  it('needs a reason to change litres or the date, keeps the original, and never goes below what was used',async()=>{
    const {repository,deliver,fill,start}=await setup();
    await start('2026-10-01T08:00:00');
    await deliver('2026-10-02T09:00:00',1000,'1.00','A1');
    await fill('2026-10-03T09:00:00',400);
    const before=await batch(repository,'DSL-2026-00001');
    await expect(repository.editBatch(before.id,draftOf(before,{litres:'1100'}))).rejects.toThrow('A reason is required');
    await expect(repository.editBatch(before.id,draftOf(before,{litres:'399',reason:'Typing mistake'}))).rejects.toThrow('cannot be below the 400 L already used');
    await expect(repository.editBatch(before.id,draftOf(before,{litres:'400.0004',reason:'Edge'}))).resolves.toBeTruthy();
    const saved=await repository.editBatch(before.id,draftOf(await batch(repository,'DSL-2026-00001'),{litres:'1100',reason:'Delivery note said 1,100 L'}));
    expect(saved).toMatchObject({deliveredLitres:1100,remainingLitres:700});
    const entry=saved.history!.at(-1)!;
    expect(entry).toMatchObject({kind:'correction',reason:'Delivery note said 1,100 L'});
    expect(entry.changes).toContainEqual({field:'Litres',originalValue:'400.0004',newValue:'1100'});
    expect(saved.history![0]!.changes).toContainEqual({field:'Litres',originalValue:'1000',newValue:'400.0004'});
  });

  it('keeps an old batch without a supplier unchanged, and never blocks it',async()=>{
    const {repository,deliver,start}=await setup();
    await start('2026-10-01T08:00:00');
    await plain(repository,'2026-10-02T09:00:00',500);
    const old=await batch(repository,'DSL-2026-00001');
    expect(old).toMatchObject({supplierId:null,supplierName:null,pricePerLitreUsd:null,finalTotalUsd:null,history:[]});
    expect((await repository.getBatchOverview()).tankLitres).toBe(500);
    await expect(repository.editBatch(old.id,draftOf(old))).rejects.toThrow('No information was changed.');
  });

  it('refuses a price without a supplier, refuses a cancelled batch, and refuses to lose payments',async()=>{
    const {repository,deliver,start,db}=await setup();
    await start('2026-10-01T08:00:00');
    await plain(repository,'2026-10-02T09:00:00',500);
    const unpriced=await batch(repository,'DSL-2026-00001');
    await expect(repository.editBatch(unpriced.id,draftOf(unpriced,{pricePerLitreUsd:'1.10'}))).rejects.toThrow('Select a supplier for a priced fuel purchase.');
    await deliver('2026-10-03T09:00:00',100,'1.00');
    const priced=await batch(repository,'DSL-2026-00002');
    db.raw.prepare("INSERT INTO payment_entries (id,target_type,fuel_movement_id,amount_usd_cents,payment_date,status,created_at) VALUES ('pay','fuelDelivery',?,5000,'2026-10-04','Active','2026-10-04T10:00:00')").run(priced.deliveryMovementId!);
    await expect(repository.editBatch(priced.id,draftOf(priced,{pricePerLitreUsd:''}))).rejects.toThrow('active payments');
    await repository.cancelBatch(unpriced.id,'Wrong');
    await expect(repository.editBatch(unpriced.id,draftOf(unpriced,{supplierId:'sup'}))).rejects.toThrow('cancelled batch cannot be edited');
  });

  it('edits supplier, invoice and price of Opening stock but never its quantity or date',async()=>{
    const {repository,deliver,start,db}=await setup();
    await deliver('2026-09-20T09:00:00',1000,'1.00');
    await start('2026-10-01T09:00:00',{dipLitres:'800'});
    const opening=await batch(repository,'DSL-2026-00001');
    const saved=await repository.editBatch(opening.id,draftOf(opening,{supplierId:'sup',invoiceNumber:'OPEN-1',pricePerLitreUsd:'1.05'}));
    expect(saved).toMatchObject({kind:'opening',supplierName:'Al-Nour Fuel',invoiceNumber:'OPEN-1',pricePerLitreUsd:1.05,finalTotalUsd:null});
    await expect(repository.editBatch(opening.id,draftOf(saved,{litres:'700',reason:'x'}))).rejects.toThrow('Record a new dip reading');
    expect(db.raw.prepare("SELECT COUNT(*) n FROM fuel_movements WHERE movement_type='delivery' AND supplier_id IS NULL").get()).toEqual({n:0});
  });
});
