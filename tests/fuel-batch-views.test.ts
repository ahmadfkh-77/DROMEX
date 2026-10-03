import {describe,expect,it} from 'vitest';

import type {FuelMovement} from '../src/domain/fuel';
import type {BatchDetail,DieselBatchOverview,FillBatchInfo} from '../src/domain/fuelBatches';
import {batchDestinationTotals,buildFillRows,filterBatchList,fuelDayLabel,fuelHomeBadge,fillSourceTag,groupFillsByDay,projectFuelSummary,splitLine,tankCardRows} from '../src/domain/fuelBatchViews';

/** DEC-492, Screens A, C, D and E. Day cards, source tags, batch totals and the project fuel view. */
const STARTED='2026-10-01T06:00:00.000Z';
let seq=0;
const fill=(extra:Partial<FuelMovement>):FuelMovement=>({
  id:`f${++seq}`,type:'fill',fuelType:'diesel',correctionHistory:[],confirmedAt:'2026-10-03T07:40:00.000Z',litres:100,previousBalanceLitres:null,differenceLitres:null,supplierId:null,supplierName:null,
  equipmentType:'machine',equipmentId:'exc',equipmentName:'Excavator CAT 320',projectId:'p1',projectName:'Hasbaya Road',destinationType:'project',companySiteId:null,companySiteName:null,companySiteIsActive:null,
  ticketNumber:null,odometerReading:null,reason:null,notes:null,fuelPriceHistoryId:null,pricePerLitreUsd:null,priceOverrideReason:null,consumptionCostUsd:null,subtotalUsd:null,vatRatePercent:null,vatAmountUsd:null,
  finalTotalUsd:null,paymentStatus:'Unpriced',status:'Active',cancellationReason:null,cancelledAt:null,balanceAfterLitres:0,fuelSource:'tank',fuelStationId:null,fuelStationName:null,batchId:null,...extra,
});
const info=(portions:[string,string,number][],extra:Partial<FillBatchInfo>={}):FillBatchInfo=>({fillId:'x',portions:portions.map(([batchId,batchNumber,litres])=>({batchId,batchNumber,litres,kind:'fill' as const})),shortfallLitres:0,outstandingShortfallLitres:0,cost:{costUsd:null,pricedLitres:0,unpricedLitres:0,fullyPriced:false},...extra});
const batch=(id:string,number:string,status:BatchDetail['status'],extra:Partial<BatchDetail>={}):BatchDetail=>({id,batchNumber:number,arrivedAt:'2026-10-01T08:00:00Z',deliveredLitres:1000,pricePerLitreUsd:1.1,filledLitres:0,adjustmentLitres:0,remainingLitres:1000,status,kind:'delivery',invoiceNumber:'55821',supplierName:null,openingBasis:null,deliveryMovementId:null,openingGaugeMovementId:null,cancellationReason:null,cancelledAt:null,...extra});
const overview=(extra:Partial<DieselBatchOverview>={}):DieselBatchOverview=>({started:true,startedAt:STARTED,tankLitres:1340,overfillAlert:false,outstandingShortfallLitres:0,batches:[],fills:{},adjustments:[],changes:[],...extra});

describe('dates on day cards',()=>{
  it('writes the full local date with the weekday',()=>{
    expect(fuelDayLabel('2026-10-03')).toBe('Sat 3 Oct 2026');
    expect(fuelDayLabel('2026-12-28')).toBe('Mon 28 Dec 2026');
  });
});

describe('source tags (D2)',()=>{
  it('names the batch, the split, the station, or Before batches, in words',()=>{
    const tracked=fill({});
    expect(fillSourceTag(tracked,info([['b4','DSL-2026-00004',100]]))).toEqual({kind:'tank_batch',text:'Tank · DSL-2026-00004'});
    expect(fillSourceTag(tracked,info([['b4','DSL-2026-00004',30],['b5','DSL-2026-00005',30]]))).toEqual({kind:'tank_batch',text:'Tank · DSL-2026-00004 + DSL-2026-00005 · Split'});
    expect(fillSourceTag(fill({fuelSource:'station',fuelStationName:'Hasbaya Highway Station'}),undefined)).toEqual({kind:'station',text:'Outside station · Hasbaya Highway Station'});
    expect(fillSourceTag(fill({}),undefined)).toEqual({kind:'before',text:'Before batches'});
    expect(fillSourceTag(fill({fuelType:'gasoline'}),undefined)).toEqual({kind:'gasoline',text:'Gasoline'});
  });
  it('says plainly when an overfilled fill has no batch at all',()=>{
    expect(fillSourceTag(fill({}),info([],{shortfallLitres:40,outstandingShortfallLitres:40}))).toEqual({kind:'tank_batch',text:'Tank · No diesel left · Overfill Alert'});
  });
  it('writes the split line for a fill drawn from more than one batch, including any shortfall',()=>{
    expect(splitLine(info([['b4','DSL-2026-00004',340],['b5','DSL-2026-00005',60]]))).toBe('340 L from DSL-2026-00004 · 60 L from DSL-2026-00005');
    expect(splitLine(info([['b4','DSL-2026-00004',100]]))).toBeNull();
    expect(splitLine(info([['b4','DSL-2026-00004',100]],{shortfallLitres:30,outstandingShortfallLitres:30}))).toBe('100 L from DSL-2026-00004 · 30 L not covered by any batch');
  });
});

describe('one card per day (D1a)',()=>{
  const moves=[
    fill({id:'a',confirmedAt:'2026-10-03T08:10:00',litres:130,projectName:'Hasbaya Road'}),
    fill({id:'b',confirmedAt:'2026-10-03T09:15:00',litres:70,destinationType:'company_site',projectId:null,projectName:null,companySiteId:'s1',companySiteName:'Quarry Gate',equipmentType:'truck',equipmentName:'72-118',odometerReading:'184220'}),
    fill({id:'c',confirmedAt:'2026-10-01T09:10:00',litres:150,projectName:'Hasbaya Road'}),
    fill({id:'d',confirmedAt:'2026-10-01T10:45:00',litres:90,projectName:'Hasbaya Road',equipmentType:'truck',equipmentName:'72-118'}),
    fill({id:'e',confirmedAt:'2026-10-01T16:20:00',litres:40,destinationType:'company_site',projectId:null,projectName:null,companySiteId:'s2',companySiteName:'Main Yard',equipmentName:'Generator'}),
    fill({id:'f',confirmedAt:'2026-10-02T15:30:00',litres:50,destinationType:'unassigned',projectId:null,projectName:null,equipmentName:'Roller'}),
    fill({id:'g',confirmedAt:'2026-10-02T08:05:00',litres:110,projectName:'Ain Ebel School'}),
    fill({id:'x',confirmedAt:'2026-10-02T09:00:00',litres:999,status:'Cancelled'}),
    {...fill({id:'y'}),type:'delivery'} as FuelMovement,
  ];
  const rows=buildFillRows(moves,overview({fills:{a:info([['b4','DSL-2026-00004',130]])}}));

  it('makes exactly one card per day, newest first, with every fill of that day inside it',()=>{
    const days=groupFillsByDay(rows,{byDestination:true});
    expect(days.map(day=>[day.label,day.total,day.groups.flatMap(group=>group.rows).length])).toEqual([['Sat 3 Oct 2026',200,2],['Fri 2 Oct 2026',160,2],['Thu 1 Oct 2026',280,3]]);
  });

  it('groups each day by projects, then company sites, then unassigned, alphabetically, each with its total',()=>{
    const [, friday, thursday]=groupFillsByDay(rows,{byDestination:true});
    expect(friday!.groups.map(group=>[group.type,group.name,group.total])).toEqual([['project','Ain Ebel School',110],['unassigned','Unassigned',50]]);
    expect(thursday!.groups.map(group=>[group.type,group.name,group.total])).toEqual([['project','Hasbaya Road',240],['company_site','Main Yard',40]]);
    expect(thursday!.groups[0]!.rows.map(row=>row.time)).toEqual(['09:10','10:45']);
    expect(groupFillsByDay(rows,{byDestination:true})[0]!.groups.map(group=>group.type)).toEqual(['project','company_site']);
  });

  it('keeps the rows flat inside the day when the screen is already one destination',()=>{
    const days=groupFillsByDay(rows,{byDestination:false});
    expect(days[2]!.groups).toHaveLength(1);
    expect(days[2]!.groups[0]).toMatchObject({type:'all',total:280});
  });

  it('labels each row with equipment, type, source, time and any odometer or receipt, and leaves out cancelled fills and other records',()=>{
    const row=rows.find(value=>value.id==='b')!;
    expect(row).toMatchObject({equipmentLabel:'72-118 · Truck',source:{kind:'before',text:'Before batches'},time:expect.stringMatching(/^\d\d:\d\d$/),detail:'Odometer 184,220',litres:70});
    expect(rows.find(value=>value.id==='a')!.source.text).toBe('Tank · DSL-2026-00004');
    expect(rows.some(value=>value.id==='x'||value.id==='y')).toBe(false);
  });

  it('shows a station receipt number on the row',()=>{
    const [row]=buildFillRows([fill({fuelSource:'station',fuelStationName:'Highway',ticketNumber:'R-7731'})],overview());
    expect(row!.detail).toBe('Receipt R-7731');
  });
});

describe('a batch page lists the fills that drew from it',()=>{
  const moves=[fill({id:'a',litres:400,projectName:'Hasbaya Road'}),fill({id:'b',litres:50,destinationType:'company_site',projectId:null,projectName:null,companySiteName:'Main Yard'}),fill({id:'c',litres:20})];
  const over=overview({fills:{a:info([['b4','DSL-2026-00004',340],['b5','DSL-2026-00005',60]]),b:info([['b5','DSL-2026-00005',50]]),c:info([['b4','DSL-2026-00004',20]])}});

  it('counts only the litres each fill took from this batch, keeping the split line',()=>{
    const rows=buildFillRows(moves,over,{batchId:'b5'});
    expect(rows.map(row=>[row.id,row.litres])).toEqual([['a',60],['b',50]]);
    expect(rows[0]!.splitLine).toBe('340 L from DSL-2026-00004 · 60 L from DSL-2026-00005');
  });

  it('totals the batch by project, company site and unassigned',()=>{
    expect(batchDestinationTotals(buildFillRows(moves,over,{batchId:'b4'}))).toEqual([{type:'project',destinationId:'p1',name:'Hasbaya Road',litres:360}]);
    expect(batchDestinationTotals(buildFillRows(moves,over,{batchId:'b5'}))).toEqual([{type:'project',destinationId:'p1',name:'Hasbaya Road',litres:60},{type:'company_site',destinationId:null,name:'Main Yard',litres:50}]);
  });
});

describe('the tank card (Screen A)',()=>{
  it('lists every open batch with its remaining litres, oldest first',()=>{
    const rows=tankCardRows(overview({batches:[batch('b3','DSL-2026-00003','closed',{remainingLitres:0}),batch('b4','DSL-2026-00004','in_use',{remainingLitres:340}),batch('b5','DSL-2026-00005','waiting',{remainingLitres:1000})]}));
    expect(rows).toEqual([{id:'b4',label:'DSL-2026-00004 · In use',value:'340 L'},{id:'b5',label:'DSL-2026-00005 · Waiting',value:'1,000 L'}]);
  });
});

describe('the Home entry point',()=>{
  it('shows the diesel in the tank and the batch in use, or the overfill, and nothing before tracking starts',()=>{
    expect(fuelHomeBadge(overview({batches:[batch('b4','DSL-2026-00004','in_use')]}))).toBe('1,340 L in tank · DSL-2026-00004 in use');
    expect(fuelHomeBadge(overview({tankLitres:0,overfillAlert:true}))).toBe('0 L in tank · Overfill Alert');
    expect(fuelHomeBadge(overview({tankLitres:0}))).toBe('0 L in tank · No open batch');
    expect(fuelHomeBadge(overview({started:false}))).toBeNull();
  });
});

describe('filtering the batch list',()=>{
  const batches=[batch('b3','DSL-2026-00003','closed',{arrivedAt:'2026-09-20T08:00:00Z'}),batch('b4','DSL-2026-00004','in_use',{arrivedAt:'2026-10-01T08:00:00Z'}),batch('b5','DSL-2026-00005','cancelled',{arrivedAt:'2026-10-02T08:00:00Z'})];
  const rows=buildFillRows([fill({id:'a',projectId:'p1'}),fill({id:'b',destinationType:'company_site',projectId:null,projectName:null,companySiteId:'s1',companySiteName:'Main Yard'})],overview({fills:{a:info([['b3','DSL-2026-00003',100]]),b:info([['b4','DSL-2026-00004',100]])}}));
  it('keeps every batch with no filter',()=>{expect(filterBatchList(batches,rows,{}).map(value=>value.id)).toEqual(['b3','b4','b5']);});
  it('filters by status, project, company site, search and arrival date',()=>{
    expect(filterBatchList(batches,rows,{status:'open'}).map(value=>value.id)).toEqual(['b4']);
    expect(filterBatchList(batches,rows,{status:'cancelled'}).map(value=>value.id)).toEqual(['b5']);
    expect(filterBatchList(batches,rows,{projectId:'p1'}).map(value=>value.id)).toEqual(['b3']);
    expect(filterBatchList(batches,rows,{companySiteId:'s1'}).map(value=>value.id)).toEqual(['b4']);
    expect(filterBatchList(batches,rows,{fromDate:'2026-10-01'}).map(value=>value.id)).toEqual(['b4','b5']);
    expect(filterBatchList(batches,rows,{toDate:'2026-09-30'}).map(value=>value.id)).toEqual(['b3']);
    expect(filterBatchList(batches,rows,{search:'00004'}).map(value=>value.id)).toEqual(['b4']);
    expect(filterBatchList(batches,rows,{search:'55821'}).map(value=>value.id)).toEqual(['b3','b4','b5']);
  });
});

describe('the project fuel view (Screen E)',()=>{
  const moves=[
    fill({id:'a',litres:400,consumptionCostUsd:null,confirmedAt:'2026-10-04T08:10:00'}),
    fill({id:'b',litres:45,fuelSource:'station',fuelStationName:'Hasbaya Highway Station',equipmentId:'trk',equipmentType:'truck',equipmentName:'72-118',confirmedAt:'2026-10-04T09:00:00'}),
    fill({id:'c',litres:130,consumptionCostUsd:143,confirmedAt:'2026-10-03T07:40:00'}),
    fill({id:'d',litres:200,consumptionCostUsd:210,confirmedAt:'2026-09-05T08:00:00'}),
    fill({id:'e',litres:20,projectId:'other',projectName:'Other'}),
  ];
  const over=overview({batches:[batch('b4','DSL-2026-00004','in_use'),batch('b5','DSL-2026-00005','waiting',{invoiceNumber:null})],fills:{
    a:info([['b4','DSL-2026-00004',340],['b5','DSL-2026-00005',60]],{cost:{costUsd:374,pricedLitres:340,unpricedLitres:60,fullyPriced:false}}),
    c:info([['b4','DSL-2026-00004',130]],{cost:{costUsd:143,pricedLitres:130,unpricedLitres:0,fullyPriced:true}}),
  }});
  const summary=projectFuelSummary('p1',moves,over);

  it('totals tank batches, before batches and outside stations separately and together',()=>{
    expect(summary).toMatchObject({totalLitres:775,tankBatchLitres:530,beforeBatchesLitres:200,stationLitres:45,gasolineLitres:0,fillCount:4,equipmentCount:2,dayCount:3});
  });

  it('adds priced costs and counts unpriced litres, never as zero',()=>{
    expect(summary).toMatchObject({costUsd:727,unpricedLitres:105});
  });

  it('lists litres by source: each batch with its invoice, before batches, and each station',()=>{
    expect(summary.bySource).toEqual([
      {key:'batch:b4',label:'DSL-2026-00004 · Invoice 55821',litres:470},
      {key:'batch:b5',label:'DSL-2026-00005 · Invoice not recorded',litres:60},
      {key:'before',label:'Before batches',litres:200},
      {key:'station:Hasbaya Highway Station',label:'Outside station · Hasbaya Highway Station',litres:45},
    ]);
  });
});
