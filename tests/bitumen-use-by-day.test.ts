import {describe,expect,it} from 'vitest';

import {groupUseByDay,mixMadeForLines,useLinesForBatch,useTotals,type BitumenUseRow} from '../src/domain/bitumenUse';

/** The Use from asphalt loads card by day: one group per local day of the load, newest first, with day totals that add up to the batch totals. */
const TODAY='2026-11-06';
let counter=0;
const row=(loadId:string,at:string,mixKg:number,kg:number,extra:Partial<BitumenUseRow>={}):BitumenUseRow=>({
  id:`u${++counter}`,createdAt:'2026-11-06T18:00:00',loadId,batchId:'b1',kind:'use',kg,mixKg,ruleAggregateKg:1000,ruleBitumenKg:40,
  loadNumber:`L-${loadId}`,loadConfirmedAt:at,itemName:'Asphalt Base',note:null,...extra,
});
const lines=(rows:BitumenUseRow[])=>useLinesForBatch(rows,'b1');

describe('grouping by the load day',()=>{
  const rows=[
    row('1','2026-11-06T08:20:00',42500,1700),row('2','2026-11-06T15:40:00',45000,1800),
    row('3','2026-11-05T09:30:00',40000,1600),row('4','2026-11-03T16:00:00',47250,1890),
  ];
  const groups=groupUseByDay(lines(rows),TODAY);
  it('lists the newest day first and marks today',()=>{
    expect(groups.map(group=>group.day)).toEqual(['2026-11-06','2026-11-05','2026-11-03']);
    expect(groups.map(group=>group.isToday)).toEqual([true,false,false]);
  });
  it('lists the loads of a day newest first',()=>{
    expect(groups[0]!.lines.map(line=>line.loadId)).toEqual(['2','1']);
    expect(groups[0]!.count).toBe(2);
  });
  it('totals each day from its own loads, in kg and in mix kg',()=>{
    expect(groups[0]).toMatchObject({mixKg:87500,bitumenKg:3500});
    expect(groups[1]).toMatchObject({mixKg:40000,bitumenKg:1600});
  });
  it('makes the day totals add up to the overall total and to the DEC-527 figures',()=>{
    const all=lines(rows),total=useTotals(all);
    expect(groups.reduce((sum,group)=>sum+group.count,0)).toBe(total.loads);
    expect(Math.round(groups.reduce((sum,group)=>sum+group.mixKg,0)*1000)/1000).toBe(total.mixKg);
    expect(Math.round(groups.reduce((sum,group)=>sum+group.bitumenKg,0)*1000)/1000).toBe(total.bitumenKg);
    expect(total.mixKg).toBe(mixMadeForLines(all).mixKg);
    expect(total.loads).toBe(mixMadeForLines(all).loads);
    expect(total.bitumenKg).toBe(all.reduce((sum,line)=>sum+line.kg,0));
  });
});

describe('which loads count',()=>{
  it('puts a moved load under the day it was confirmed, not the day it was moved',()=>{
    const moved=row('1','2026-11-02T10:00:00',40000,1600,{kind:'moved',createdAt:'2026-11-06T09:00:00'});
    expect(groupUseByDay(lines([moved]),TODAY).map(group=>group.day)).toEqual(['2026-11-02']);
  });
  it('counts a corrected load by its net use',()=>{
    const rows=[row('1','2026-11-05T10:00:00',40000,1600),row('1','2026-11-05T10:00:00',40000,-400,{kind:'correction'})];
    expect(groupUseByDay(lines(rows),TODAY)[0]).toMatchObject({count:1,bitumenKg:1200});
  });
  it('leaves out a cancelled or reversed load from both totals',()=>{
    const rows=[row('1','2026-11-05T10:00:00',40000,1600),row('1','2026-11-05T10:00:00',40000,-1600,{kind:'reversal'}),row('2','2026-11-05T11:00:00',30000,1200)];
    const groups=groupUseByDay(lines(rows),TODAY);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({count:1,mixKg:30000,bitumenKg:1200});
  });
  it('drops a day whose loads are all reversed',()=>{
    const rows=[row('1','2026-11-04T10:00:00',40000,1600),row('1','2026-11-04T10:00:00',40000,-1600,{kind:'reversal'})];
    expect(groupUseByDay(lines(rows),TODAY)).toEqual([]);
  });
  it('has no line for a load whose mix cannot be known (it never gets a use row), so it is in neither total',()=>{
    expect(useTotals(lines([row('1','2026-11-05T10:00:00',40000,1600)]))).toEqual({loads:1,mixKg:40000,bitumenKg:1600});
  });
});

describe('days and rounding',()=>{
  it('splits days at local midnight',()=>{
    const before=new Date(2026,10,5,23,59,59).toISOString(),after=new Date(2026,10,6,0,0,0).toISOString();
    const groups=groupUseByDay(lines([row('1',before,10000,400),row('2',after,10000,400)]),TODAY);
    expect(groups.map(group=>group.day)).toEqual(['2026-11-06','2026-11-05']);
  });
  it('rounds to three decimals so a day total shows no float noise',()=>{
    const rows=[row('1','2026-11-06T08:00:00',33333.333,1333.333),row('2','2026-11-06T09:00:00',33333.334,1333.334)];
    expect(groupUseByDay(lines(rows),TODAY)[0]).toMatchObject({mixKg:66666.667,bitumenKg:2666.667});
  });
  it('handles an empty batch',()=>{
    expect(groupUseByDay([],TODAY)).toEqual([]);
    expect(useTotals([])).toEqual({loads:0,mixKg:0,bitumenKg:0});
  });
});
