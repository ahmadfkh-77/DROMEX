import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteBitumenRepository} from '../src/data/repositories/SqliteBitumenRepository';
import {calculateBitumenPrice,formatBitumenBatchNumber,formatKg,formatTons,previewBitumenPrice,supplierBitumenDeliveries,validatePositiveKg,type BitumenDeliveryDraft} from '../src/domain/bitumen';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/**
 * Bitumen batches (Phase B): deliveries in kg, numbering, price and VAT snapshots, the batch in use, correction with a reason,
 * cancellation, and what a supplier delivered. Nothing is used from a batch yet: the asphalt rule comes in a later phase.
 */
const databases:SqliteTestDatabase[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();});
const clock=(local:string)=>vi.setSystemTime(new Date(local));

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('khayat','Khayat Al Sabouri',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('other','Other Supplier',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  const repository=new SqliteBitumenRepository(db as never);
  const draft=(extra:Partial<BitumenDeliveryDraft>={}):BitumenDeliveryDraft=>({recordDate:'2026-10-12',supplierId:'khayat',invoiceNumber:'55870',ticketNumber:'T-1',gradeId:'bitumen_grade_60_70',kg:'20000',priceBasis:'per_ton',price:'610',vat:false,notes:'',...extra});
  const deliver=(local:string,extra:Partial<BitumenDeliveryDraft>={})=>{clock(local);return repository.recordDelivery(draft({recordDate:local.slice(0,10),...extra}));};
  return {db,repository,deliver,draft};
}

describe('the numbers and prices (pure)',()=>{
  it('numbers a batch BIT-YYYY-NNNNN and shows kg with tons',()=>{
    expect(formatBitumenBatchNumber(2026,7)).toBe('BIT-2026-00007');
    expect(formatKg(20000)).toBe('20,000 kg');expect(formatTons(8000)).toBe('8 t');expect(formatTons(1250)).toBe('1.25 t');
  });
  it('accepts only a positive number of kg',()=>{
    expect(validatePositiveKg('8,000'.replace(',',''))).toBe(8000);expect(validatePositiveKg('1250,5')).toBe(1250.5);
    for(const bad of ['','0','-5','abc','1e3'])expect(()=>validatePositiveKg(bad)).toThrow('greater than zero');
  });
  it('prices per ton, per kg and as a whole, with VAT only when asked',()=>{
    expect(calculateBitumenPrice(8000,'per_ton','610',0)).toEqual({priceUsd:610,subtotalUsd:4880,vatAmountUsd:0,totalUsd:4880,pricePerTonUsd:610});
    expect(calculateBitumenPrice(8000,'per_kg','0.61',0)).toMatchObject({subtotalUsd:4880,pricePerTonUsd:610});
    expect(calculateBitumenPrice(8000,'whole','5000',11)).toMatchObject({subtotalUsd:5000,vatAmountUsd:550,totalUsd:5550,pricePerTonUsd:null});
    expect(calculateBitumenPrice(8000,'per_ton','610',11)).toMatchObject({subtotalUsd:4880,vatAmountUsd:536.8,totalUsd:5416.8});
  });
  it('treats no price as Unpriced, never zero, and rejects a bad price',()=>{
    expect(calculateBitumenPrice(8000,'per_ton','',11)).toEqual({priceUsd:null,subtotalUsd:null,vatAmountUsd:null,totalUsd:null,pricePerTonUsd:null});
    expect(calculateBitumenPrice(8000,'per_ton','0',0)).toMatchObject({totalUsd:0});
    expect(()=>calculateBitumenPrice(8000,'per_ton','1.234',0)).toThrow('two decimals');
    expect(previewBitumenPrice({kg:'x',priceBasis:'per_ton',price:'610',vat:false},11)).toBeNull();
  });
});

describe('migration 58',()=>{
  it('adds the bitumen tables and seeds the four grades, touching nothing else',async()=>{
    const {db}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(58);
    const tables=(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bitumen_%'").all() as {name:string}[]).map(value=>value.name).sort();
    expect(tables).toEqual(expect.arrayContaining(['bitumen_batch_counters','bitumen_batches','bitumen_grades','bitumen_settings']));
    expect((db.raw.prepare('SELECT name FROM bitumen_grades ORDER BY name').all() as {name:string}[]).map(value=>value.name)).toEqual(['60/70','80/100','Emulsion','MC-70']);
    expect((db.raw.prepare('SELECT COUNT(*) c FROM bitumen_batches').get() as {c:number}).c).toBe(0);
  });
});

describe('recording a delivery',()=>{
  it('saves the batch with its number, supplier, grade, invoice, ticket and a price snapshot',async()=>{
    const {deliver,repository}=await setup();
    const batch=await deliver('2026-10-12T09:00:00',{vat:true});
    expect(batch).toMatchObject({batchNumber:'BIT-2026-00001',supplierName:'Khayat Al Sabouri',gradeName:'60/70',invoiceNumber:'55870',ticketNumber:'T-1',deliveredKg:20000,usedKg:0,remainingKg:20000,status:'in_use',priceBasis:'per_ton',priceUsd:610,subtotalUsd:12200,priced:true});
    // The VAT rate of the day is saved on the batch (the seeded database has none, so the total equals the subtotal).
    expect(batch.totalUsd).toBe(12200);
    expect((await repository.getOverview()).totalRemainingKg).toBe(20000);
  });
  it('numbers batches in order and never reuses a number after a cancellation',async()=>{
    const {deliver,repository}=await setup();
    const first=await deliver('2026-10-12T09:00:00');
    const second=await deliver('2026-10-13T09:00:00',{kg:'8000'});
    await repository.cancelBatch(second.id,'Entered twice');
    const third=await deliver('2026-10-14T09:00:00',{kg:'5000'});
    expect([first.batchNumber,second.batchNumber,third.batchNumber]).toEqual(['BIT-2026-00001','BIT-2026-00002','BIT-2026-00003']);
  });
  it('saves a delivery with no price as Unpriced',async()=>{
    const {deliver}=await setup();
    const batch=await deliver('2026-10-12T09:00:00',{price:'',invoiceNumber:'',ticketNumber:''});
    expect(batch).toMatchObject({priced:false,priceUsd:null,totalUsd:null,priceBasis:null,invoiceNumber:null,ticketNumber:null});
  });
  it('refuses a missing supplier, grade or quantity, and a future or invalid date',async()=>{
    const {repository,draft}=await setup();
    clock('2026-10-12T09:00:00');
    await expect(repository.recordDelivery(draft({supplierId:''}))).rejects.toThrow('supplier');
    await expect(repository.recordDelivery(draft({gradeId:''}))).rejects.toThrow('grade');
    await expect(repository.recordDelivery(draft({kg:'0'}))).rejects.toThrow('greater than zero');
    await expect(repository.recordDelivery(draft({recordDate:'2026-10-13'}))).rejects.toThrow('today or a valid past date');
    await expect(repository.recordDelivery(draft({recordDate:'2026-02-31'}))).rejects.toThrow();
    expect((await repository.getOverview()).batches).toEqual([]);
  });
  it('appends a sync entry in the same step',async()=>{
    const {deliver,db}=await setup();
    const batch=await deliver('2026-10-12T09:00:00');
    const row=db.raw.prepare("SELECT entity_type,entity_id,operation FROM sync_outbox WHERE entity_type='bitumenBatch'").get() as {entity_type:string;entity_id:string;operation:string};
    expect(row).toEqual({entity_type:'bitumenBatch',entity_id:batch.id,operation:'upsert'});
  });
});

describe('the batch in use',()=>{
  it('is the oldest open batch until another is chosen, then falls back when the choice is cancelled',async()=>{
    const {deliver,repository}=await setup();
    const first=await deliver('2026-10-12T09:00:00'),second=await deliver('2026-10-13T09:00:00',{kg:'8000'});
    let overview=await repository.getOverview();
    expect(overview.batches.map(value=>[value.batchNumber,value.status])).toEqual([['BIT-2026-00001','in_use'],['BIT-2026-00002','waiting']]);
    overview=await repository.setUsingBatch(second.id);
    expect(overview.usingBatchId).toBe(second.id);
    expect(overview.batches.map(value=>[value.batchNumber,value.status])).toEqual([['BIT-2026-00002','in_use'],['BIT-2026-00001','waiting']]);
    await repository.cancelBatch(second.id,'Wrong supplier');
    overview=await repository.getOverview();
    expect(overview.usingBatchId).toBeNull();
    expect(overview.batches.find(value=>value.id===first.id)?.status).toBe('in_use');
    expect(overview.totalRemainingKg).toBe(20000);
  });
  it('can go back to the oldest first, and accepts only an open batch',async()=>{
    const {deliver,repository}=await setup();
    const first=await deliver('2026-10-12T09:00:00'),second=await deliver('2026-10-13T09:00:00',{kg:'8000'});
    await repository.setUsingBatch(second.id);
    expect((await repository.setUsingBatch(null)).usingBatchId).toBeNull();
    await expect(repository.setUsingBatch('nope')).rejects.toThrow('still open');
    await repository.cancelBatch(first.id,'Cancelled');
    await expect(repository.setUsingBatch(first.id)).rejects.toThrow('still open');
  });
});

describe('correcting and cancelling',()=>{
  it('changes details freely and keeps a correction history; a new quantity or date needs a reason',async()=>{
    const {deliver,repository,draft}=await setup();
    const batch=await deliver('2026-10-12T09:00:00');
    const edited=await repository.editBatch(batch.id,{...draft({invoiceNumber:'55871'}),reason:''});
    expect(edited.invoiceNumber).toBe('55871');
    await expect(repository.editBatch(batch.id,{...draft({kg:'19800'}),reason:''})).rejects.toThrow('reason');
    const corrected=await repository.editBatch(batch.id,{...draft({kg:'19800',invoiceNumber:'55871'}),reason:'Ticket re-read'});
    expect(corrected).toMatchObject({deliveredKg:19800,remainingKg:19800,subtotalUsd:12078});
    expect(corrected.correctionHistory.at(-1)).toMatchObject({reason:'Ticket re-read',changes:[{field:'Quantity',before:'20,000 kg',after:'19,800 kg'}]});
    expect(corrected.batchNumber).toBe(batch.batchNumber);
  });
  it('cancels with a reason, keeps the batch visible as Cancelled and stops counting it',async()=>{
    const {deliver,repository,draft}=await setup();
    const batch=await deliver('2026-10-12T09:00:00');
    await expect(repository.cancelBatch(batch.id,'  ')).rejects.toThrow('reason');
    const cancelled=await repository.cancelBatch(batch.id,'Entered twice');
    expect(cancelled).toMatchObject({status:'cancelled',recordStatus:'Cancelled',cancellationReason:'Entered twice'});
    expect((await repository.getOverview()).totalRemainingKg).toBe(0);
    await expect(repository.cancelBatch(batch.id,'again')).rejects.toThrow('already cancelled');
    await expect(repository.editBatch(batch.id,{...draft(),reason:'x'})).rejects.toThrow('cancelled batch cannot be edited');
  });
});

describe('grades',()=>{
  it('adds a grade once, reuses it ignoring case, and deactivates rather than deletes',async()=>{
    const {repository,deliver}=await setup();
    const added=await repository.addGrade('  mc-250 ');
    expect(added.name).toBe('mc-250');
    expect((await repository.addGrade('MC-250')).id).toBe(added.id);
    await expect(repository.addGrade('  ')).rejects.toThrow('grade name');
    const batch=await deliver('2026-10-12T09:00:00',{gradeId:added.id});
    await repository.setGradeActive(added.id,false);
    expect((await repository.getSetup()).grades.find(value=>value.id===added.id)?.isActive).toBe(false);
    expect((await repository.getOverview()).batches.find(value=>value.id===batch.id)?.gradeName).toBe('mc-250');
  });
});

describe('what a supplier delivered in bitumen',()=>{
  it('adds kg and priced amounts, lists Unpriced batches, and leaves out cancelled ones',async()=>{
    const {deliver,repository}=await setup();
    await deliver('2026-10-12T09:00:00');
    await deliver('2026-10-13T09:00:00',{kg:'8000',price:''});
    const gone=await deliver('2026-10-14T09:00:00',{kg:'1000'});
    await repository.cancelBatch(gone.id,'Mistake');
    await deliver('2026-10-14T10:00:00',{supplierId:'other',kg:'500'});
    const summary=supplierBitumenDeliveries((await repository.getOverview()).batches,'khayat');
    expect(summary).toMatchObject({batchCount:2,totalKg:28000,pricedAmountUsd:12200,unpricedNote:'1 Unpriced',cancelledCount:1});
    expect(summary.rows.map(row=>row.batchNumber)).toEqual(['BIT-2026-00002','BIT-2026-00001']);
    expect(summary.rows[0]).toMatchObject({priced:false,priceLabel:'Unpriced'});
    expect(summary.rows[1]).toMatchObject({priceLabel:'$610.00 / t',gradeName:'60/70'});
  });
});

describe('the weighbridge ticket',()=>{
  it('is shown on the batch only when it was filled in',()=>{
    const screen=require('node:fs').readFileSync('src/ui/screens/BitumenScreen.tsx','utf8') as string;
    expect(screen).toContain('{batch.ticketNumber?<Fact label="Weighbridge ticket" value={batch.ticketNumber}/>:null}');
    expect(screen).not.toContain("batch.ticketNumber??'Not recorded'");
  });
});

describe('the Stock section on Home',()=>{
  const home=require('node:fs').readFileSync('src/ui/screens/HomeScreen.tsx','utf8') as string;
  const section=(title:string)=>{const start=home.indexOf(`title="${title}"`);const end=home.indexOf('</ExpandableMenuSection>',start);return home.slice(start,end);};
  it('holds Fuel Tracking and Bitumen Tracking, closed by default, and Fuel no longer sits in Daily Operations',()=>{
    expect(home).toContain("stock:false");
    expect(section('Stock')).toContain('title="Fuel Tracking"');expect(section('Stock')).toContain('title="Bitumen Tracking"');
    expect(section('Daily Operations')).not.toContain('Fuel Tracking');
    expect(home.match(/title="Fuel Tracking"/g)?.length).toBe(1);
  });
  it('numbers the sections in order: Daily Operations, Stock, Records, Reports & Finance, Setup',()=>{
    const markers=[...home.matchAll(/ExpandableMenuSection title="([^"]+)"[^>]*marker="(\d+)"/g)].map(match=>[match[1],match[2]]);
    expect(markers).toEqual([['Daily Operations','01'],['Stock','02'],['Records','03'],['Reports & Finance','04'],['Setup','05']]);
  });
  it('keeps every other Daily Operations item and numbers them 01 to 05',()=>{
    const daily=section('Daily Operations');
    expect([...daily.matchAll(/number="(\d+)" title="([^"]+)"/g)].map(match=>[match[1],match[2]])).toEqual([['01','Project Schedule'],['02','Waste Dump Tracking'],['03','Suppliers'],['04','Daily project reports'],['05','Quick Text']]);
  });
});
