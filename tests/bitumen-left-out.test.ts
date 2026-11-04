import {describe,expect,it} from 'vitest';

import {
  ADDED_BY_HAND_NOTE,AUTO_PLACED_NOTE,eligibleBatchRooms,groupAttentionByDay,loadUseDetail,planAddToBatch,planAutoPlaceToday,reconcileBitumenUse,useLinesForBatch,
  type BitumenRule,type BitumenUseRow,type UseBatch,type UseLoad,
} from '../src/domain/bitumenUse';

/** Loads left out of a batch: the reproduction, the manual Add to batch, the day groups, the load detail and today's automatic placement. */
const RULE:BitumenRule={itemId:'base',itemName:'Asphalt Mix – Base',enabled:true,aggregateKg:1000,bitumenKg:50,countFrom:'2026-10-01'};
const batch=(id:string,arrivedDay:string,deliveredKg:number,extra:Partial<UseBatch>={}):UseBatch=>({id,arrivedDay,active:true,deliveredKg,adjustmentKg:0,...extra});
const load=(id:string,mixKg:number|null,confirmedAt:string,extra:Partial<UseLoad>={}):UseLoad=>({id,itemId:'base',itemName:'Asphalt Mix – Base',loadNumber:`ASP-${id}`,confirmedAt,active:true,mixKg,...extra});
const stored=(rows:ReturnType<typeof reconcileBitumenUse>['rows'],from=0):BitumenUseRow[]=>rows.map((row,index)=>({...row,id:`u${from+index}`,createdAt:`2026-11-04T10:${String(from+index).padStart(2,'0')}:00`}));
const run=(over:Partial<Parameters<typeof reconcileBitumenUse>[0]>)=>reconcileBitumenUse({rules:[RULE],loads:[],existing:[],batches:[batch('b1','2026-10-20',20000)],usingBatchId:null,...over});
const TODAY='2026-11-04';
const net=(rows:readonly BitumenUseRow[],batchId:string|null)=>Math.round(rows.filter(row=>row.batchId===batchId).reduce((sum,row)=>sum+row.kg,0)*1000)/1000;

describe('the reproduction',()=>{
  it('leaves an unchanged left-out load uncovered even when a batch later has room',()=>{
    // The batch is too small for the load, so the load is left out. A bigger batch arrives; the unchanged load is still not placed.
    const first=run({loads:[load('1',20000,'2026-11-04T09:00:00')],batches:[batch('b1','2026-10-20',200)]});
    expect(first.rows.map(row=>[row.batchId,row.kg])).toEqual([['b1',200],[null,800]]);
    const later=run({loads:[load('1',20000,'2026-11-04T09:00:00')],batches:[batch('b1','2026-10-20',200),batch('b2','2026-11-03',5000)],existing:stored(first.rows)});
    expect(later.rows).toEqual([]);
    expect(later.attention).toEqual([expect.objectContaining({loadId:'1',kind:'uncovered',kg:800})]);
    expect(later.attention[0]!.note).not.toMatch(/Record a delivery/);
    expect(later.attention[0]!.note).toMatch(/Add to batch/);
  });
});

describe('eligible batches',()=>{
  const rows=stored(run({loads:[load('1',20000,'2026-11-04T09:00:00')],batches:[batch('b1','2026-10-20',1500)]}).rows);
  it('lists open batches that had arrived by the load day, with what each has left, batch in use first',()=>{
    const batches=[batch('b1','2026-10-20',1500),batch('b2','2026-11-02',400),batch('b3','2026-11-05',9000),batch('b4','2026-10-01',5000,{closedAt:'2026-10-30T12:00:00'}),batch('b5','2026-10-25',100,{active:false})];
    const rooms=eligibleBatchRooms('2026-11-04T14:20:00',batches,rows,'b2');
    expect(rooms.map(room=>[room.id,room.remainingKg])).toEqual([['b2',400],['b1',500]]);
  });
  it('counts a real-amount adjustment in what is left',()=>{
    const rooms=eligibleBatchRooms('2026-11-04T14:20:00',[batch('b1','2026-10-20',1500,{adjustmentKg:-100})],rows,null);
    expect(rooms[0]!.remainingKg).toBe(400);
  });
});

describe('Add to batch by hand',()=>{
  const left=stored(run({loads:[load('1',20000,'2026-11-04T09:00:00')],batches:[batch('b1','2026-10-20',200)]}).rows);// 200 in b1, 800 uncovered
  it('moves the whole uncovered part when the batch has room, with new rows and a clear note',()=>{
    const plan=planAddToBatch(left,'b2',5000);
    expect(plan.map(row=>[row.batchId,row.kind,row.kg,row.note])).toEqual([[null,'reversal',-800,ADDED_BY_HAND_NOTE],['b2','moved',800,ADDED_BY_HAND_NOTE]]);
    const after=[...left,...stored(plan,10)];
    expect(net(after,null)).toBe(0);expect(net(after,'b1')).toBe(200);expect(net(after,'b2')).toBe(800);
  });
  it('adds only what fits and keeps the rest uncovered',()=>{
    const plan=planAddToBatch(left,'b2',300);
    const after=[...left,...stored(plan,10)];
    expect(net(after,'b2')).toBe(300);expect(net(after,null)).toBe(500);
  });
  it('adds nothing when there is no room or nothing is uncovered, and never changes existing rows',()=>{
    expect(planAddToBatch(left,'b2',0)).toEqual([]);
    const placed=[...left,...stored(planAddToBatch(left,'b2',5000),10)];
    expect(planAddToBatch(placed,'b2',5000)).toEqual([]);
    expect(placed.slice(0,left.length)).toEqual(left);
  });
  it('does not count the load twice: reconcile adds nothing after a placement, and the total still matches the rule',()=>{
    const placed=[...left,...stored(planAddToBatch(left,'b2',5000),10)];
    const again=run({loads:[load('1',20000,'2026-11-04T09:00:00')],batches:[batch('b1','2026-10-20',200),batch('b2','2026-11-03',5000)],existing:placed});
    expect(again.rows).toEqual([]);expect(again.attention).toEqual([]);
    expect(net(placed,'b1')+net(placed,'b2')+net(placed,null)).toBe(1000);
  });
  it('keeps the load in the batch lines of the batch it was added to',()=>{
    const placed=[...left,...stored(planAddToBatch(left,'b2',5000),10)];
    expect(useLinesForBatch(placed,'b2').map(line=>[line.loadNumber,line.kg,line.mixKg])).toEqual([['ASP-1',800,20000]]);
  });
  it('a cancelled load afterwards is reversed from the batch it was added to',()=>{
    const placed=[...left,...stored(planAddToBatch(left,'b2',5000),10)];
    const cancel=run({loads:[load('1',20000,'2026-11-04T09:00:00',{active:false})],batches:[batch('b1','2026-10-20',200),batch('b2','2026-11-03',5000)],existing:placed});
    const all=[...placed,...stored(cancel.rows,20)];
    expect(net(all,'b1')+net(all,'b2')+net(all,null)).toBe(0);
  });
  it('a corrected load adds only the difference after a placement', ()=>{
    const placed=[...left,...stored(planAddToBatch(left,'b2',5000),10)];
    const corrected=run({loads:[load('1',10000,'2026-11-04T09:00:00')],batches:[batch('b1','2026-10-20',200),batch('b2','2026-11-03',5000)],existing:placed});
    const all=[...placed,...stored(corrected.rows,20)];
    expect(net(all,'b1')+net(all,'b2')+net(all,null)).toBe(500);
  });
});

describe('the day groups',()=>{
  const items=(ids:Array<[string,string,number]>)=>ids.map(([id,at,kg])=>({loadId:id,loadNumber:`ASP-${id}`,itemName:'Asphalt',kind:'uncovered' as const,kg,note:'',confirmedAt:at}));
  it('groups by the load day in local time, newest day first, loads in time order, today flagged, with counts and kg',()=>{
    const groups=groupAttentionByDay(items([['51','2026-10-28T09:15:00',780],['59','2026-11-04T14:20:00',870],['52','2026-10-28T13:50:00',960],['58','2026-11-04T11:05:00',1055],['57','2026-11-02T16:40:00',900]]),TODAY);
    expect(groups.map(group=>[group.day,group.isToday,group.count,group.uncoveredKg])).toEqual([['2026-11-04',true,2,1925],['2026-11-02',false,1,900],['2026-10-28',false,2,1740]]);
    expect(groups[0]!.items.map(item=>item.loadId)).toEqual(['58','59']);
  });
  it('moves a load to an older day group when the day changes',()=>{
    const list=items([['1','2026-11-04T09:00:00',100]]);
    expect(groupAttentionByDay(list,'2026-11-04')[0]!.isToday).toBe(true);
    expect(groupAttentionByDay(list,'2026-11-05')[0]!.isToday).toBe(false);
  });
  it('keeps a load that cannot be counted in its day with its explanation',()=>{
    const groups=groupAttentionByDay([{loadId:'9',loadNumber:'ASP-9',itemName:'Asphalt',kind:'not_countable',kg:0,note:'The quantity is not in tons or kg, so the bitumen cannot be calculated.',confirmedAt:'2026-11-04T08:00:00'}],TODAY);
    expect(groups[0]!.count).toBe(1);expect(groups[0]!.items[0]!.note).toMatch(/not in tons or kg/);
  });
});

describe('the load detail',()=>{
  it('shows the mix, the rule, the bitumen required, what each batch counts and what is not covered',()=>{
    const rows=stored(run({loads:[load('1',20000,'2026-11-04T09:00:00')],batches:[batch('b1','2026-10-20',200)]}).rows);
    const detail=loadUseDetail(rows)!;
    expect(detail).toMatchObject({loadNumber:'ASP-1',mixKg:20000,ruleAggregateKg:1000,ruleBitumenKg:50,percent:5,requiredKg:1000,uncoveredKg:800});
    expect(detail.byBatch).toEqual([{batchId:'b1',kg:200}]);
  });
  it('is null for a load with no rows', ()=>{expect(loadUseDetail([])).toBeNull();});
});

describe("today's automatic placement",()=>{
  const batches=[batch('b1','2026-10-20',200),batch('b2','2026-11-03',5000)];
  const leftOut=(...entries:Array<[string,string,number]>)=>stored(run({loads:entries.map(([id,at,mix])=>load(id,mix,at)),batches:[batch('b1','2026-10-20',200)]}).rows);
  it('places only loads of today, in load order, with the automatic note',()=>{
    const existing=leftOut(['1','2026-11-04T09:00:00',10000],['2','2026-11-04T10:00:00',10000]);// b1 takes 200 of load 1; 300 + 500 uncovered
    const plan=planAutoPlaceToday({rows:existing,batches,usingBatchId:null,today:TODAY});
    const all=[...existing,...stored(plan,10)];
    expect(plan.every(row=>row.note===AUTO_PLACED_NOTE)).toBe(true);
    expect(net(all,null)).toBe(0);expect(net(all,'b2')).toBe(800);
    expect(plan.map(row=>row.loadId)).toEqual(['1','1','2','2']);
  });
  it('never places a load from an earlier day', ()=>{
    const existing=leftOut(['1','2026-11-03T09:00:00',10000]);
    expect(planAutoPlaceToday({rows:existing,batches,usingBatchId:null,today:TODAY})).toEqual([]);
  });
  it('uses the batch in use first, then the oldest, and skips closed batches and batches that arrived later',()=>{
    const existing=leftOut(['1','2026-11-04T09:00:00',10000]);
    const many=[batch('b1','2026-10-20',200),batch('b2','2026-10-25',5000),batch('b3','2026-11-01',5000),batch('b4','2026-10-22',5000,{closedAt:'2026-11-04T08:00:00'}),batch('b5','2026-11-05',5000)];
    const inUse=planAutoPlaceToday({rows:existing,batches:many,usingBatchId:'b3',today:TODAY});
    expect(inUse.filter(row=>row.kind==='moved').map(row=>[row.batchId,row.kg])).toEqual([['b3',300]]);
    const oldest=planAutoPlaceToday({rows:existing,batches:many,usingBatchId:null,today:TODAY});
    expect(oldest.filter(row=>row.kind==='moved').map(row=>[row.batchId,row.kg])).toEqual([['b2',300]]);
  });
  it('places what fits and leaves the rest uncovered', ()=>{
    const existing=leftOut(['1','2026-11-04T09:00:00',10000]);
    const plan=planAutoPlaceToday({rows:existing,batches:[batch('b1','2026-10-20',200),batch('b2','2026-11-03',100)],usingBatchId:null,today:TODAY});
    expect(net([...existing,...stored(plan,10)],null)).toBe(200);
  });
  it('adds no duplicate rows when run again',()=>{
    const existing=leftOut(['1','2026-11-04T09:00:00',10000]);
    const once=[...existing,...stored(planAutoPlaceToday({rows:existing,batches,usingBatchId:null,today:TODAY}),10)];
    expect(planAutoPlaceToday({rows:once,batches,usingBatchId:null,today:TODAY})).toEqual([]);
  });
  it('does not touch a cancelled load, whose net is zero',()=>{
    const first=leftOut(['1','2026-11-04T09:00:00',10000]);
    const cancel=run({loads:[load('1',10000,'2026-11-04T09:00:00',{active:false})],batches:[batch('b1','2026-10-20',200)],existing:first});
    const rows=[...first,...stored(cancel.rows,10)];
    expect(planAutoPlaceToday({rows,batches,usingBatchId:null,today:TODAY})).toEqual([]);
  });
});
