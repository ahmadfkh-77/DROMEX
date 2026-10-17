import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

import {DATABASE_VERSION} from '../src/data/database/migrations';
import {SqliteBitumenRepository} from '../src/data/repositories/SqliteBitumenRepository';
import type {BitumenDeliveryDraft} from '../src/domain/bitumen';
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
  const repository=new SqliteBitumenRepository(db as never);
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
  return {db,repository,deliver,addLoad,setStatus,tick,batch};
}

describe('migration 59',()=>{
  it('adds the rule, use and adjustment tables and changes no load',async()=>{
    const {db}=await setup();
    expect(DATABASE_VERSION).toBeGreaterThanOrEqual(59);
    const tables=(db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('bitumen_item_rules','bitumen_use','bitumen_adjustments')").all() as {name:string}[]).map(value=>value.name).sort();
    expect(tables).toEqual(['bitumen_adjustments','bitumen_item_rules','bitumen_use']);
    expect((db.raw.prepare('SELECT COUNT(*) c FROM bitumen_use').get() as {c:number}).c).toBe(0);
  });
});

describe('the rules',()=>{
  it('saves a rule per item, lists the items by series, and ticks a whole series keeping a rule already saved',async()=>{
    const {repository}=await setup();
    await repository.saveRule({itemId:'wear',enabled:false,aggregateTons:'1.6',bitumenKg:'56',countFrom:'2026-10-05'});
    const rules=await repository.enableSeries('series_asp','2026-10-13');
    expect(rules.map(rule=>[rule.itemId,rule.enabled,rule.aggregateKg,rule.bitumenKg,rule.countFrom]).sort()).toEqual([['base',true,1600,50,'2026-10-13'],['wear',true,1600,56,'2026-10-05']]);
    const useSetup=await repository.getUseSetup();
    expect(useSetup.series).toEqual([{id:'series_asp',prefix:'ASP',name:'Asphalt',itemIds:['base','wear']}]);
    expect(useSetup.items.map(item=>item.id)).toEqual(['base','wear','sand']);
    expect((await repository.getOverview()).rulesEnabled).toBe(2);
  });
  it('refuses a bad rule or an item that is not on receipts',async()=>{
    const {repository}=await setup();
    await expect(repository.saveRule({itemId:'base',enabled:true,aggregateTons:'0',bitumenKg:'50',countFrom:'2026-10-01'})).rejects.toThrow('greater than zero');
    await expect(repository.saveRule({itemId:'base',enabled:true,aggregateTons:'1.6',bitumenKg:'abc',countFrom:'2026-10-01'})).rejects.toThrow('greater than zero');
    await expect(repository.saveRule({itemId:'nope',enabled:true,aggregateTons:'1.6',bitumenKg:'50',countFrom:'2026-10-01'})).rejects.toThrow('active item');
    await expect(repository.saveRule({itemId:'base',enabled:true,aggregateTons:'1.6',bitumenKg:'50',countFrom:''})).rejects.toThrow('start counting');
  });
});

describe('counting asphalt loads',()=>{
  it('takes 50 kg per 1.6 t from the batch in use, once, and leaves the load itself alone',async()=>{
    const {repository,deliver,addLoad,tick,batch,db}=await setup();
    await deliver('2026-10-12T09:00:00');await tick();
    addLoad('l1','2026-10-13T09:00:00',40000);addLoad('l2','2026-10-13T10:00:00',24000);addLoad('s1','2026-10-13T10:30:00',10000,{itemId:'sand'});
    const before=JSON.stringify(db.raw.prepare('SELECT * FROM loads ORDER BY id').all());
    expect((await repository.syncUse()).added).toBe(2);
    expect((await repository.syncUse()).added).toBe(0);
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:2000,remainingKg:18000});
    const overview=await repository.getOverview();
    expect(useLinesForBatch(overview.useRows!,overview.batches[0]!.id).map(line=>[line.loadNumber,line.kg,line.mixKg])).toEqual(expect.arrayContaining([['ASP-00001',1250,40000],['ASP-00002',750,24000]]));
    expect(JSON.stringify(db.raw.prepare('SELECT * FROM loads ORDER BY id').all())).toBe(before);
  });
  it('ignores loads before the start day and loads of items that are not ticked',async()=>{
    const {repository,deliver,addLoad,tick,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await tick('base','50','2026-10-13');
    addLoad('old','2026-10-12T09:00:00',40000);addLoad('wear','2026-10-13T09:00:00',40000,{itemId:'wear'});
    await repository.syncUse();
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:0,remainingKg:20000});
  });
  it('reverses a cancelled load and counts it again when it is reactivated',async()=>{
    const {repository,deliver,addLoad,setStatus,tick,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await tick();addLoad('l1','2026-10-13T09:00:00',40000);
    await repository.syncUse();
    setStatus('l1','Cancelled');
    await repository.syncUse();
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:0,remainingKg:20000});
    const rows=(await repository.getOverview()).useRows!;
    expect(rows.map(row=>[row.kind,row.kg,row.note])).toEqual([['use',1250,null],['reversal',-1250,'Load cancelled']]);
    setStatus('l1','Active');
    await repository.syncUse();
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:1250,remainingKg:18750});
  });
  it('keeps the rule a load was counted with when the rule is changed afterwards',async()=>{
    const {repository,deliver,addLoad,tick,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await tick();addLoad('l1','2026-10-13T09:00:00',40000);await repository.syncUse();
    await tick('base','55');addLoad('l2','2026-10-13T10:00:00',16000);await repository.syncUse();
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:1250+550});
    const rows=(await repository.getOverview()).useRows!;
    expect(rows.map(row=>[row.loadNumber,row.ruleBitumenKg])).toEqual([['ASP-00001',50],['ASP-00002',55]]);
  });
  it('counts a direct load typed in tons, and lists one in cubic metres instead of guessing',async()=>{
    const {repository,deliver,addLoad,tick,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await tick();
    addLoad('t','2026-10-13T09:00:00',1000,{direct:{quantity:32,unit:'t'}});
    addLoad('m3','2026-10-13T10:00:00',1000,{direct:{quantity:20,unit:'m³'},billed:{quantity:20,unit:'m³'}});
    const result=await repository.syncUse();
    expect((await batch('BIT-2026-00001')).usedKg).toBe(1000);
    expect(result.attention).toEqual([expect.objectContaining({kind:'not_countable',loadNumber:'ASP-00002'})]);
  });
  it('continues in the next batch, then lists what no batch can cover',async()=>{
    const {repository,deliver,addLoad,tick,batch}=await setup();
    await deliver('2026-10-12T09:00:00',{kg:'1000'});await deliver('2026-10-12T10:00:00',{kg:'200'});await tick();
    addLoad('l1','2026-10-13T09:00:00',40000);
    const result=await repository.syncUse();
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:1000,remainingKg:0,status:'closed'});
    expect(await batch('BIT-2026-00002')).toMatchObject({usedKg:200,remainingKg:0});
    expect(result.attention).toEqual([expect.objectContaining({kind:'uncovered',kg:50})]);
  });
});

describe('the batch in use and moving a load',()=>{
  it('counts earlier loads before switching, so they stay with the batch that was in use',async()=>{
    const {repository,deliver,addLoad,tick,batch}=await setup();
    const first=await deliver('2026-10-12T09:00:00'),second=await deliver('2026-10-12T10:00:00',{kg:'8000'});await tick();void first;
    addLoad('l1','2026-10-13T09:00:00',40000);
    await repository.setUsingBatch(second.id);
    addLoad('l2','2026-10-13T11:00:00',24000);
    await repository.syncUse();
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:1250});
    expect(await batch('BIT-2026-00002')).toMatchObject({usedKg:750});
  });
  it('moves a load to another open batch, and refuses one that is too small',async()=>{
    const {repository,deliver,addLoad,tick,batch}=await setup();
    await deliver('2026-10-12T09:00:00');const small=await deliver('2026-10-12T10:00:00',{kg:'100'});const big=await deliver('2026-10-12T11:00:00',{kg:'8000'});await tick();
    addLoad('l1','2026-10-13T09:00:00',40000);await repository.syncUse();
    await expect(repository.moveLoad('l1',small.id)).rejects.toThrow('not enough');
    await repository.moveLoad('l1',big.id);
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:0});
    expect(await batch('BIT-2026-00003')).toMatchObject({usedKg:1250,remainingKg:6750});
    expect((await repository.getOverview()).useRows!.map(row=>row.kind)).toEqual(['use','reversal','moved']);
    await repository.cancelBatch(big.id,'Wrong');
    await expect(repository.moveLoad('l1',big.id)).rejects.toThrow('still open');
  });
});

describe('adjusting the real amount',()=>{
  it('records the difference with a reason, and later loads continue from the new figure',async()=>{
    const {repository,deliver,addLoad,tick,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await tick();addLoad('l1','2026-10-13T09:00:00',40000);await repository.syncUse();
    const overview=await repository.adjustBatch((await batch('BIT-2026-00001')).id,'18650','Weighed the tank');
    expect(overview.adjustments).toEqual([expect.objectContaining({kg:-100,estimatedBefore:18750,realAfter:18650,reason:'Weighed the tank'})]);
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:1250,adjustmentKg:-100,remainingKg:18650});
    addLoad('l2','2026-10-13T10:00:00',16000);await repository.syncUse();
    expect((await batch('BIT-2026-00001')).remainingKg).toBe(18150);
  });
  it('needs a reason and a real difference, and refuses a cancelled batch',async()=>{
    const {repository,deliver}=await setup();
    const one=await deliver('2026-10-12T09:00:00');
    await expect(repository.adjustBatch(one.id,'19000','  ')).rejects.toThrow('reason');
    await expect(repository.adjustBatch(one.id,'20000','Same')).rejects.toThrow('nothing to adjust');
    await expect(repository.adjustBatch(one.id,'abc','x')).rejects.toThrow('greater than zero');
    expect((await repository.adjustBatch(one.id,'0','Tank empty')).batches[0]).toMatchObject({remainingKg:0,status:'closed'});
    await repository.cancelBatch(one.id,'Mistake');
    await expect(repository.adjustBatch(one.id,'100','x')).rejects.toThrow('still on record');
  });
});

describe('the batch report with use',()=>{
  it('lists the counted loads with their rule, leaves cancelled loads out, shows adjustments, and says the figures are estimates',async()=>{
    const {repository,deliver,addLoad,setStatus,tick}=await setup();
    await deliver('2026-10-12T09:00:00');await tick();
    addLoad('l1','2026-10-13T09:00:00',40000);addLoad('l2','2026-10-13T10:00:00',24000);addLoad('l3','2026-10-13T11:00:00',32000);
    await repository.syncUse();setStatus('l3','Cancelled');await repository.syncUse();
    const batchId=(await repository.getOverview()).batches[0]!.id;
    const overview=await repository.adjustBatch(batchId,'17900','Weighed the tank');
    const {buildBitumenBatchReport}=await import('../src/domain/bitumenBatchReport');
    const {buildBitumenBatchHtml}=await import('../src/services/bitumenBatchTemplate');
    const report=buildBitumenBatchReport(overview.batches[0]!,{includePrices:false,useRows:overview.useRows,adjustments:overview.adjustments,estimated:true});
    expect(report.estimated).toBe(true);
    expect(report.figures.map(figure=>[figure.label,figure.kg])).toEqual([['Delivered','20,000 kg'],['Est. used','2,000 kg'],['Adjustments','-100 kg'],['Est. remaining','17,900 kg']]);
    expect(report.use!.rows.map(row=>[row.load,row.mix,row.rule,row.kg])).toEqual([['ASP-00002','24 t','50 kg per 1.6 t','750 kg'],['ASP-00001','40 t','50 kg per 1.6 t','1,250 kg']]);
    expect(report.use!.total).toBe('2,000 kg');
    expect(report.adjustments!.rows).toEqual([expect.objectContaining({reason:'Weighed the tank',kg:'−100'})]);
    const page=buildBitumenBatchHtml(report,{companyName:'DROMEX',logo:null,contactLine:null});
    expect(page).toContain('BATCH FIGURES (ESTIMATED USE)');expect(page).toContain('USE FROM ASPHALT LOADS');expect(page).toContain('ADJUSTMENTS');
    expect(page).not.toContain('ASP-00003');
    for(const group of page.matchAll(/<colgroup>(.*?)<\/colgroup>/g))expect([...group[1]!.matchAll(/width:(\d+)%/g)].reduce((sum,width)=>sum+Number(width[1]),0)).toBe(100);
  });
  it('keeps the earlier report unchanged when no rule is used',async()=>{
    const {deliver}=await setup();
    const {buildBitumenBatchReport}=await import('../src/domain/bitumenBatchReport');
    const report=buildBitumenBatchReport(await deliver('2026-10-12T09:00:00'),{includePrices:false});
    expect(report.estimated).toBe(false);expect(report.use).toBeNull();expect(report.adjustments).toBeNull();
    expect(report.figures.map(figure=>figure.label)).toEqual(['Delivered','Used','Adjustments','Remaining']);
  });
});

describe('closing a batch by hand',()=>{
  it('closes a batch that still has bitumen, keeps the leftover, and moves new loads to the next batch',async()=>{
    const {repository,deliver,addLoad,tick,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await deliver('2026-10-14T08:00:00');await tick();
    addLoad('l1','2026-10-14T09:00:00',40000);await repository.syncUse();
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:1250,remainingKg:18750,status:'in_use'});
    clock('2026-10-14T10:00:00');
    const overview=await repository.closeBatch((await batch('BIT-2026-00001')).id,'2026-10-14','Tank changed');
    const closed=overview.batches.find(value=>value.batchNumber==='BIT-2026-00001')!;
    expect(closed.status).toBe('closed');
    expect(closed.closure).toMatchObject({leftover:18750,reason:'Tank changed',closedOn:'2026-10-14',reopenedAt:null});
    expect(overview.batches.find(value=>value.batchNumber==='BIT-2026-00002')!.status).toBe('in_use');
    expect(overview.totalRemainingKg).toBe(20000);
    addLoad('l2',new Date('2026-10-14T11:00:00').toISOString(),40000);await repository.syncUse();
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:1250,remainingKg:18750,status:'closed'});
    expect(await batch('BIT-2026-00002')).toMatchObject({usedKg:1250,remainingKg:18750,status:'in_use'});
  });
  it('lets a load confirmed before the closing still be counted against the closed batch',async()=>{
    const {repository,deliver,addLoad,tick,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await deliver('2026-10-14T08:00:00');
    clock('2026-10-14T10:00:00');
    await repository.closeBatch((await batch('BIT-2026-00001')).id,'2026-10-14','Tank changed');
    await tick();addLoad('early',new Date('2026-10-14T09:00:00').toISOString(),40000);await repository.syncUse();
    expect(await batch('BIT-2026-00001')).toMatchObject({usedKg:1250,status:'closed'});
  });
  it('reopens a batch with a reason and keeps both records in its history',async()=>{
    const {repository,deliver,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await deliver('2026-10-14T08:00:00');
    clock('2026-10-14T10:00:00');
    const id=(await batch('BIT-2026-00001')).id;
    await repository.closeBatch(id,'2026-10-14','Tank changed');
    const reopened=(await repository.reopenBatch(id,'Closed the wrong tank')).batches.find(value=>value.id===id)!;
    expect(reopened.closure).toBeNull();expect(reopened.status).toBe('in_use');
    expect(reopened.closureHistory).toHaveLength(1);
    expect(reopened.closureHistory[0]).toMatchObject({leftover:20000,reopenReason:'Closed the wrong tank'});
    await repository.closeBatch(id,'2026-10-14','Changed again');
    expect((await batch('BIT-2026-00001')).closureHistory).toHaveLength(2);
  });
  it('refuses without a reason, twice, for a future day, for a cancelled batch, and when nothing was closed',async()=>{
    const {repository,deliver,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await deliver('2026-10-13T09:00:00');
    clock('2026-10-14T10:00:00');
    const first=(await batch('BIT-2026-00001')).id,second=(await batch('BIT-2026-00002')).id;
    await expect(repository.closeBatch(first,'2026-10-14','  ')).rejects.toThrow('reason');
    await expect(repository.closeBatch(first,'2026-10-15','Tank changed')).rejects.toThrow('future');
    await repository.closeBatch(first,'2026-10-14','Tank changed');
    await expect(repository.closeBatch(first,'2026-10-14','Again')).rejects.toThrow('still open');
    await expect(repository.reopenBatch(second,'Oops')).rejects.toThrow('not closed by hand');
    await expect(repository.reopenBatch(first,' ')).rejects.toThrow('reason');
    await repository.cancelBatch(second,'Wrong delivery');
    await expect(repository.closeBatch(second,'2026-10-14','x')).rejects.toThrow('still open');
  });
  it('clears the batch chosen to use first when that batch is closed',async()=>{
    const {repository,deliver,batch}=await setup();
    await deliver('2026-10-12T09:00:00');await deliver('2026-10-13T09:00:00');
    clock('2026-10-14T10:00:00');
    const second=(await batch('BIT-2026-00002')).id;
    await repository.setUsingBatch(second);
    const overview=await repository.closeBatch(second,'2026-10-14','Done with it');
    expect(overview.usingBatchId).toBeNull();
    expect(overview.batches.find(value=>value.batchNumber==='BIT-2026-00001')!.status).toBe('in_use');
  });
});

describe('the screens',()=>{
  const fsRead=(path:string)=>require('node:fs').readFileSync(path,'utf8') as string;
  it('offer the rules, the real-amount adjustment, moving a load and the attention list, and count loads when they open',()=>{
    const screen=fsRead('src/ui/screens/BitumenScreen.tsx'),panels=fsRead('src/ui/components/BitumenUsePanels.tsx'),app=fsRead('src/ui/DromexApp.tsx');
    expect(screen).toContain('Asphalt items and rules');expect(screen).toContain('Adjust the real amount left');expect(screen).toContain('repository.syncUse()');expect(screen).toContain('<AttentionCard');
    expect(panels).toContain('Move to another batch');expect(panels).toContain('Add all items from a series');expect(panels).toContain('Count loads from');
    expect(app).toContain('bitumenRepository.syncUse()');
  });
});
