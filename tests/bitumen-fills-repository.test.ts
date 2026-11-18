import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {SqliteBitumenRepository} from '../src/data/repositories/SqliteBitumenRepository';
import {noVatChoice} from '../src/domain/accountVat';
import type {BitumenDeliveryDraft} from '../src/domain/bitumen';
import type {BitumenFillDraft} from '../src/domain/bitumenFills';
import {SEED_TIME,SqliteTestDatabase,migratedDatabaseWithProject} from './support/sqliteTestDatabase';

/** Bitumen Record Fill against a real database (DEC-557): saving, splitting, refusing, cancelling, and sharing a batch with asphalt use. */
const databases:SqliteTestDatabase[]=[];const files:string[]=[];
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});});
afterEach(()=>{vi.useRealTimers();for(const database of databases.splice(0))database.close();for(const file of files.splice(0))fs.rmSync(file,{force:true});});
const clock=(local:string)=>vi.setSystemTime(new Date(local));

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('khayat','Khayat',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,make_model,is_active,created_at,updated_at) VALUES ('trk','T-12','Tanker',1,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('off','X-99',0,'${SEED_TIME}','${SEED_TIME}');
    INSERT INTO company_sites (id,name,name_key,is_active,created_at,updated_at) VALUES ('yard','Main Yard','main yard',1,'${SEED_TIME}','${SEED_TIME}');
  `);
  db.raw.exec('PRAGMA foreign_keys=OFF;');
  const repository=new SqliteBitumenRepository(db as never);
  const deliver=(local:string,kg:string,price='')=>{clock(local);const draft:BitumenDeliveryDraft={recordDate:local.slice(0,10),supplierId:'khayat',invoiceNumber:'1',ticketNumber:'',gradeId:'bitumen_grade_60_70',kg,priceBasis:'per_ton',price,vat:noVatChoice,notes:''};return repository.recordDelivery(draft);};
  const fillDraft=(extra:Partial<BitumenFillDraft>={}):BitumenFillDraft=>({recordDate:'2026-11-10',truckId:'trk',batchId:'',destinationType:'unassigned',projectId:'',companySiteId:'',layerNote:'',kg:'500',ticketNumber:'',notes:'',...extra});
  const fill=(local:string,extra:Partial<BitumenFillDraft>={})=>{clock(local);return repository.recordFill(fillDraft({recordDate:local.slice(0,10),...extra}));};
  const batch=async(number:string)=>(await repository.getOverview()).batches.find(value=>value.batchNumber===number)!;
  const outbox=(type:string)=>db.raw.prepare('SELECT * FROM sync_outbox WHERE entity_type=?').all(type) as {entity_id:string;payload_json:string}[];
  return {db,repository,deliver,fill,fillDraft,batch,outbox};
}

describe('recording a fill',()=>{
  it('takes from the oldest open batch, lowers its remaining kg and writes one outbox entry',async()=>{
    const {repository,deliver,fill,batch,outbox}=await setup();
    await deliver('2026-11-01T08:00:00','10000','800');await deliver('2026-11-05T08:00:00','5000','900');
    const saved=await fill('2026-11-10T09:00:00',{kg:'1500',layerNote:'Tack coat',ticketNumber:'T-1'});
    expect(saved).toMatchObject({totalKg:1500,truckName:'T-12',destinationType:'unassigned',layerNote:'Tack coat',ticketNumber:'T-1',status:'Active',recordDate:'2026-11-10'});
    expect(saved.portions.map(p=>[p.batchNumber,p.kg])).toEqual([['BIT-2026-00001',1500]]);
    expect((await batch('BIT-2026-00001')).remainingKg).toBe(8500);
    expect((await batch('BIT-2026-00001')).filledKg).toBe(1500);
    expect((await batch('BIT-2026-00002')).remainingKg).toBe(5000);
    expect(saved.cost.costUsd).toBe(1200);
    expect(outbox('bitumenFill')).toHaveLength(1);
    expect((await repository.getOverview()).fills).toHaveLength(1);
  });

  it('splits one fill across two batches, shows it as one fill and costs each part at its own price; an unpriced part is Unpriced',async()=>{
    const {deliver,fill,batch}=await setup();
    await deliver('2026-11-01T08:00:00','2000');await deliver('2026-11-05T08:00:00','5000','1000');
    const saved=await fill('2026-11-10T09:00:00',{kg:'3500'});
    expect(saved.portions.map(p=>[p.batchNumber,p.kg])).toEqual([['BIT-2026-00001',2000],['BIT-2026-00002',1500]]);
    expect(saved.cost).toEqual({costUsd:1500,pricedKg:1500,unpricedKg:2000,fullyPriced:false});
    expect((await batch('BIT-2026-00001')).status).toBe('closed');
    expect((await batch('BIT-2026-00002')).remainingKg).toBe(3500);
  });

  it('honours Use this batch first',async()=>{
    const {repository,deliver,fill}=await setup();
    await deliver('2026-11-01T08:00:00','5000');const second=await deliver('2026-11-05T08:00:00','5000');
    await repository.setUsingBatch(second.id);
    expect((await fill('2026-11-10T09:00:00')).portions[0]!.batchNumber).toBe('BIT-2026-00002');
  });

  it('refuses a fill larger than every open batch holds and saves nothing',async()=>{
    const {repository,deliver,fill,outbox}=await setup();
    await deliver('2026-11-01T08:00:00','1000');
    await expect(fill('2026-11-10T09:00:00',{kg:'1200'})).rejects.toThrow(/more than all the open batches hold.*200/);
    expect((await repository.getOverview()).fills).toEqual([]);
    expect(outbox('bitumenFill')).toHaveLength(0);
  });

  it('refuses a future date, a date before the batch arrived, a closed batch, a bad quantity, an unknown or inactive truck',async()=>{
    const {repository,deliver,fill,fillDraft}=await setup();
    const first=await deliver('2026-11-05T08:00:00','5000');
    clock('2026-11-10T09:00:00');
    await expect(repository.recordFill(fillDraft({recordDate:'2026-11-11'}))).rejects.toThrow(/today or a past day/);
    await expect(repository.recordFill(fillDraft({recordDate:'2026-11-04'}))).rejects.toThrow(/No open batch had arrived/);
    await expect(repository.recordFill(fillDraft({kg:'0'}))).rejects.toThrow(/greater than zero/);
    await expect(repository.recordFill(fillDraft({truckId:'off'}))).rejects.toThrow(/truck/i);
    await expect(repository.recordFill(fillDraft({truckId:'nope'}))).rejects.toThrow(/truck/i);
    clock('2026-11-10T10:00:00');await repository.closeBatch(first.id,'2026-11-10','Done');
    await expect(fill('2026-11-10T11:00:00')).rejects.toThrow(/more than all the open batches hold/);
    await expect(repository.recordFill(fillDraft({batchId:first.id}))).rejects.toThrow(/still open/);
  });

  it('checks the destination: an active project, an active company site',async()=>{
    const {deliver,fill}=await setup();
    await deliver('2026-11-01T08:00:00','5000');
    expect(await fill('2026-11-10T09:00:00',{destinationType:'project',projectId:'road'})).toMatchObject({destinationType:'project',projectId:'road',projectName:'Mountain Road'});
    expect(await fill('2026-11-10T09:30:00',{destinationType:'company_site',companySiteId:'yard'})).toMatchObject({companySiteName:'Main Yard'});
    await expect(fill('2026-11-10T09:40:00',{destinationType:'project',projectId:''})).rejects.toThrow(/project/i);
    await expect(fill('2026-11-10T09:50:00',{destinationType:'company_site',companySiteId:'gone'})).rejects.toThrow(/site/i);
  });

  it('keeps the truck and destination names as they were when later profiles are renamed',async()=>{
    const {db,repository,deliver,fill}=await setup();
    await deliver('2026-11-01T08:00:00','5000');
    await fill('2026-11-10T09:00:00',{destinationType:'project',projectId:'road'});
    db.raw.exec("UPDATE truck_profiles SET plate='NEW-1' WHERE id='trk'; UPDATE projects SET name='Renamed' WHERE id='road';");
    const [saved]=(await repository.getOverview()).fills!;
    expect(saved).toMatchObject({truckName:'T-12',projectName:'Mountain Road'});
  });

  it('keeps the chosen fill date apart from the time it was entered',async()=>{
    const {deliver,repository,fillDraft}=await setup();
    await deliver('2026-11-01T08:00:00','5000');
    clock('2026-11-12T15:30:00');
    const saved=await repository.recordFill(fillDraft({recordDate:'2026-11-08'}));
    expect(saved.recordDate).toBe('2026-11-08');
    expect(saved.confirmedAt.slice(0,10)).not.toBe(saved.enteredAt.slice(0,10));
  });
});

describe('cancelling a fill',()=>{
  it('needs a reason, returns the kg, keeps the fill on record and cannot happen twice',async()=>{
    const {repository,deliver,fill,batch,outbox}=await setup();
    await deliver('2026-11-01T08:00:00','5000');
    const saved=await fill('2026-11-10T09:00:00',{kg:'1000'});
    await expect(repository.cancelFill(saved.id,'  ')).rejects.toThrow(/reason/);
    clock('2026-11-10T10:00:00');
    const overview=await repository.cancelFill(saved.id,'Wrong truck');
    expect((await batch('BIT-2026-00001')).remainingKg).toBe(5000);
    expect(overview.fills![0]).toMatchObject({status:'Cancelled',cancellationReason:'Wrong truck',totalKg:1000});
    await expect(repository.cancelFill(saved.id,'Again')).rejects.toThrow(/already cancelled/);
    expect(outbox('bitumenFill')).toHaveLength(2);
  });
});

describe('a fill and a batch',()=>{
  it('blocks cancelling a batch with active fills, and a quantity below what was filled',async()=>{
    const {repository,deliver,fill}=await setup();
    const first=await deliver('2026-11-01T08:00:00','5000');
    const saved=await fill('2026-11-10T09:00:00',{kg:'3000'});
    await expect(repository.cancelBatch(first.id,'Mistake')).rejects.toThrow(/fills/i);
    await expect(repository.editBatch(first.id,{recordDate:'2026-11-01',supplierId:'khayat',invoiceNumber:'1',ticketNumber:'',gradeId:'bitumen_grade_60_70',kg:'2000',priceBasis:'per_ton',price:'',vat:noVatChoice,notes:'',reason:'Recount'})).rejects.toThrow(/fills/i);
    await repository.cancelFill(saved.id,'Wrong');
    await expect(repository.cancelBatch(first.id,'Mistake')).resolves.toBeTruthy();
  });

  it('lets a fill and asphalt use share one batch: a fill cannot take what asphalt loads used, and syncing never touches a fill',async()=>{
    const {db,repository,deliver,fill,batch}=await setup();
    await deliver('2026-11-01T08:00:00','1000');
    db.raw.exec(`INSERT INTO bitumen_use (id,load_id,batch_id,kind,kg,mix_kg,rule_aggregate_kg,rule_bitumen_kg,item_name,created_at) VALUES ('u1','l1',(SELECT id FROM bitumen_batches LIMIT 1),'use',400,12800,1600,50,'Base','${SEED_TIME}')`);
    await expect(fill('2026-11-10T09:00:00',{kg:'700'})).rejects.toThrow(/more than all the open batches hold.*100/);
    const saved=await fill('2026-11-10T09:10:00',{kg:'600'});
    const before=db.raw.prepare('SELECT * FROM bitumen_fills').all(),portions=db.raw.prepare('SELECT * FROM bitumen_fill_portions').all();
    await repository.syncUse();
    expect(db.raw.prepare('SELECT * FROM bitumen_fills').all()).toEqual(before);
    expect(db.raw.prepare('SELECT * FROM bitumen_fill_portions').all()).toEqual(portions);
    expect((await batch('BIT-2026-00001')).remainingKg).toBe(0);
    expect(saved.totalKg).toBe(600);
  });

  it('lets an adjustment count fills in its estimate',async()=>{
    const {repository,deliver,fill,batch}=await setup();
    const first=await deliver('2026-11-01T08:00:00','5000');
    await fill('2026-11-10T09:00:00',{kg:'1000'});
    clock('2026-11-10T10:00:00');
    await repository.adjustBatch(first.id,'3900','Dip');
    expect((await batch('BIT-2026-00001')).adjustmentKg).toBe(-100);
  });
});

describe('previewing a fill',()=>{
  it('shows the split and the cost without saving, and reports Over by when it does not fit',async()=>{
    const {repository,deliver,fillDraft,outbox}=await setup();
    await deliver('2026-11-01T08:00:00','2000');await deliver('2026-11-05T08:00:00','5000','1000');
    clock('2026-11-10T09:00:00');
    const ok=await repository.previewFill(fillDraft({kg:'3500'}));
    expect(ok.issue).toBeNull();expect(ok.portions.map(p=>p.kg)).toEqual([2000,1500]);expect(ok.cost.unpricedKg).toBe(2000);
    const over=await repository.previewFill(fillDraft({kg:'9000'}));
    expect(over).toMatchObject({issue:'over_limit',overByKg:2000});
    expect(outbox('bitumenFill')).toHaveLength(0);
  });
});

describe('setup and backup',()=>{
  it('offers active trucks, active projects and active company sites',async()=>{
    const {repository}=await setup();
    const data=await repository.getFillSetup();
    expect(data.trucks.map(t=>t.name)).toEqual(['T-12']);
    expect(data.projects.map(p=>p.id)).toEqual(['road']);
    expect(data.companySites.map(s=>s.name)).toEqual(['Main Yard']);
  });

  it('keeps every fill, portion and cancellation through a restored database file',async()=>{
    const {db,deliver,fill,repository}=await setup();
    await deliver('2026-11-01T08:00:00','5000');
    const saved=await fill('2026-11-10T09:00:00',{kg:'1000'});await fill('2026-11-10T09:30:00',{kg:'200'});
    clock('2026-11-10T10:00:00');await repository.cancelFill(saved.id,'Wrong truck');
    const file=path.join(os.tmpdir(),`dromex-bit-fill-${Date.now()}.sqlite`);files.push(file);
    db.raw.exec(`VACUUM INTO '${file.replace(/'/g,"''")}'`);
    const restored=new SqliteTestDatabase(file);databases.push(restored);restored.raw.exec('PRAGMA foreign_keys=OFF;');
    const after=await new SqliteBitumenRepository(restored as never).getOverview();
    expect(after.fills!.map(f=>[f.totalKg,f.status])).toEqual([[1000,'Cancelled'],[200,'Active']]);
    expect(after.batches[0]!.remainingKg).toBe(4800);
  });
});
