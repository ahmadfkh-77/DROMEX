import {describe,expect,it} from 'vitest';

import type {FuelMovement} from '../src/domain/fuel';
import type {BatchDetail,DieselBatchOverview,FillBatchInfo} from '../src/domain/fuelBatches';
import {buildDieselBatchReport} from '../src/domain/dieselBatchReport';

/** DEC-505, Screen F. What the Diesel Batch Report PDF contains for each filter. */
const STARTED='2026-10-01T06:00:00.000Z';
const fill=(id:string,extra:Partial<FuelMovement>):FuelMovement=>({
  id,type:'fill',fuelType:'diesel',correctionHistory:[],confirmedAt:'2026-10-03T07:40:00',litres:100,previousBalanceLitres:null,differenceLitres:null,supplierId:null,supplierName:null,
  equipmentType:'machine',equipmentId:'exc',equipmentName:'Excavator CAT 320',projectId:'p1',projectName:'مشروع طريق حاصبيا',destinationType:'project',companySiteId:null,companySiteName:null,companySiteIsActive:null,
  ticketNumber:null,odometerReading:null,reason:null,notes:null,fuelPriceHistoryId:null,pricePerLitreUsd:null,priceOverrideReason:null,consumptionCostUsd:null,subtotalUsd:null,vatRatePercent:null,vatAmountUsd:null,
  finalTotalUsd:null,paymentStatus:'Unpriced',status:'Active',cancellationReason:null,cancelledAt:null,balanceAfterLitres:0,fuelSource:'tank',fuelStationId:null,fuelStationName:null,batchId:null,...extra,
});
const info=(portions:[string,string,number][],cost:FillBatchInfo['cost']={costUsd:null,pricedLitres:0,unpricedLitres:0,fullyPriced:false}):FillBatchInfo=>({fillId:'x',portions:portions.map(([batchId,batchNumber,litres])=>({batchId,batchNumber,litres,kind:'fill' as const})),shortfallLitres:0,outstandingShortfallLitres:0,cost});
const batch=(id:string,number:string,extra:Partial<BatchDetail>={}):BatchDetail=>({id,batchNumber:number,arrivedAt:'2026-10-01T08:00:00',deliveredLitres:1000,pricePerLitreUsd:1.1,filledLitres:0,adjustmentLitres:0,remainingLitres:1000,status:'in_use',kind:'delivery',invoiceNumber:'55821',supplierName:'Al-Nour Fuel',openingBasis:null,deliveryMovementId:null,openingGaugeMovementId:null,cancellationReason:null,cancelledAt:null,...extra});

const movements=[
  fill('a',{confirmedAt:'2026-10-03T07:40:00',litres:130}),
  fill('b',{confirmedAt:'2026-10-03T11:15:00',litres:70,destinationType:'company_site',projectId:null,projectName:null,companySiteId:'s1',companySiteName:'Quarry Gate – North Stockpile and Crusher Area',equipmentType:'truck',equipmentName:'72-118'}),
  fill('c',{confirmedAt:'2026-10-02T08:05:00',litres:110,projectId:'p2',projectName:'Marjayoun Water Tank'}),
  fill('d',{confirmedAt:'2026-10-02T15:30:00',litres:50,destinationType:'unassigned',projectId:null,projectName:null,equipmentName:'Roller'}),
  fill('e',{confirmedAt:'2026-10-01T09:10:00',litres:150}),
  fill('f',{confirmedAt:'2026-10-02T09:00:00',litres:60,fuelSource:'station',fuelStationId:'st1',fuelStationName:'Hasbaya Highway Station',projectId:'p2',projectName:'Marjayoun Water Tank',consumptionCostUsd:75}),
  fill('g',{confirmedAt:'2026-10-02T10:00:00',litres:20,fuelType:'gasoline',projectId:'p2',projectName:'Marjayoun Water Tank'}),
  fill('h',{confirmedAt:'2026-09-20T10:00:00',litres:40,consumptionCostUsd:42}),
];
const overview:DieselBatchOverview={started:true,startedAt:STARTED,tankLitres:340,overfillAlert:false,outstandingShortfallLitres:0,
  batches:[batch('b4','DSL-2026-00004',{filledLitres:640,adjustmentLitres:-20,remainingLitres:340}),batch('b5','DSL-2026-00005',{arrivedAt:'2026-10-03T12:00:00',invoiceNumber:null,pricePerLitreUsd:null,status:'waiting'})],
  fills:{a:info([['b4','DSL-2026-00004',130]],{costUsd:143,pricedLitres:130,unpricedLitres:0,fullyPriced:true}),b:info([['b4','DSL-2026-00004',70]],{costUsd:77,pricedLitres:70,unpricedLitres:0,fullyPriced:true}),c:info([['b4','DSL-2026-00004',110]],{costUsd:121,pricedLitres:110,unpricedLitres:0,fullyPriced:true}),d:info([['b4','DSL-2026-00004',50]]),e:info([['b4','DSL-2026-00004',150]],{costUsd:165,pricedLitres:150,unpricedLitres:0,fullyPriced:true})},
  adjustments:[{gaugeId:'g1',batchId:'b4',batchNumber:'DSL-2026-00004',litres:-20,calculatedLitres:560,dipLitres:540,confirmedAt:'2026-10-03T06:30:00'}],changes:[]};
const names={projects:[{id:'p1',name:'مشروع طريق حاصبيا'},{id:'p2',name:'Marjayoun Water Tank'}],companySites:[{id:'s1',name:'Quarry Gate – North Stockpile and Crusher Area'}],stations:[{id:'st1',name:'Hasbaya Highway Station'}]};
const report=(filter:Parameters<typeof buildDieselBatchReport>[0]['filter'])=>buildDieselBatchReport({movements,overview,names,filter,exportedAt:'2026-10-03T18:42:00'});

describe('a single batch',()=>{
  const single=report({batchId:'b4',includePrices:false});
  it('names the batch and its invoice, and writes every applied filter in full',()=>{
    expect(single.scopeLabel).toBe('DSL-2026-00004 · Invoice 55821');
    expect(single.metadata).toEqual([
      {label:'Batch',value:'DSL-2026-00004'},{label:'Exported',value:'Sat 3 Oct 2026, 18:42'},
      {label:'Project filter',value:'All projects'},{label:'Site filter',value:'All sites'},
      {label:'Station filter',value:'All stations'},{label:'Supplier',value:'All suppliers'},{label:'Date range',value:'All dates'},{label:'Prices',value:'Excluded'},
    ]);
  });
  it('summarises delivered, filled, adjustments and remaining',()=>{
    expect(single.summary).toEqual({deliveredLitres:1000,filledLitres:510,adjustmentLitres:-20,remainingLitres:340,filteredNote:null});
  });
  it('has sections for projects, company sites and unassigned, each destination by day, newest first, with totals',()=>{
    expect(single.sections.map(section=>[section.title,section.destinations.map(destination=>[destination.name,destination.total])])).toEqual([
      ['PROJECTS',[['Marjayoun Water Tank',110],['مشروع طريق حاصبيا',280]]],
      ['COMPANY SITES',[['Quarry Gate – North Stockpile and Crusher Area',70]]],
      ['UNASSIGNED',[['Unassigned',50]]],
    ]);
    const arabic=single.sections[0]!.destinations[1]!;
    expect(arabic.totalLabel).toBe('Project total');
    expect(arabic.days.map(day=>[day.label,day.total,day.rows.map(row=>[row.equipment,row.type,row.source,row.litres])])).toEqual([
      ['Sat 3 Oct 2026',130,[['Excavator CAT 320','Machine','Tank · DSL-2026-00004','130 L']]],
      ['Thu 1 Oct 2026',150,[['Excavator CAT 320','Machine','Tank · DSL-2026-00004','150 L']]],
    ]);
    expect(single.sections[1]!.destinations[0]!.totalLabel).toBe('Site total');
  });
  it('ends with the batch totals, the tank, totals by destination and the dip adjustment',()=>{
    expect(single.batchTotals).toEqual([{batchNumber:'DSL-2026-00004',delivered:'1,000 L',deliveryDetail:'Invoice 55821 · Al-Nour Fuel · Thu 1 Oct 2026',filled:'640 L',adjustments:'−20 L',remaining:'340 L',status:'Open · In use'}]);
    expect(single.tank).toEqual({litres:'340 L',overfill:'None'});
    expect(single.destinationTotals.at(-1)).toEqual({label:'Total filled',litres:'510 L'});
    expect(single.adjustments).toEqual([{label:'Dip adjustment · Sat 3 Oct 2026 · DSL-2026-00004',detail:'Calculated remaining 560 L · Dip reading 540 L · Adjustment −20 L'}]);
    expect(single.fileName).toBe('Diesel-Batch-Report-DSL-2026-00004.pdf');
  });
});

describe('filters',()=>{
  it('by project keeps only that project and says Filled counts only matching fills',()=>{
    const result=report({projectId:'p2',includePrices:false});
    expect(result.sections.map(section=>section.title)).toEqual(['PROJECTS']);
    expect(result.sections[0]!.destinations.map(destination=>[destination.name,destination.total])).toEqual([['Marjayoun Water Tank',170]]);
    expect(result.metadata.find(item=>item.label==='Project filter')!.value).toBe('Marjayoun Water Tank');
    expect(result.summary.filledLitres).toBe(170);
    expect(result.summary.filteredNote).toBe('Filled counts only the fills that match the filters.');
    expect(result.scopeLabel).toBe('Batches that supplied the filtered fills');
  });
  it('by site keeps only that company site',()=>{
    const result=report({companySiteId:'s1',includePrices:false});
    expect(result.sections.map(section=>[section.title,section.destinations.length])).toEqual([['COMPANY SITES',1]]);
  });
  it('by station keeps only that station’s fills, which never belong to a batch',()=>{
    const result=report({stationId:'st1',includePrices:false});
    expect(result.sections[0]!.destinations[0]!.days[0]!.rows.map(row=>row.source)).toEqual(['Outside station · Hasbaya Highway Station']);
    expect(result.batchTotals).toEqual([]);
  });
  it('by date range keeps only the days inside it, inclusively, and lists the batches that arrived in it',()=>{
    const result=report({fromDate:'2026-10-02',toDate:'2026-10-02',includePrices:false});
    const days=result.sections.flatMap(section=>section.destinations.flatMap(destination=>destination.days.map(day=>day.label)));
    expect(new Set(days)).toEqual(new Set(['Fri 2 Oct 2026']));
    expect(result.metadata.find(item=>item.label==='Date range')!.value).toBe('Fri 2 Oct 2026 – Fri 2 Oct 2026');
    expect(result.fileName).toBe('Diesel-Batch-Report-2026-10-02-to-2026-10-02.pdf');
  });
  it('never includes gasoline or cancelled fills, and keeps records from before batches with their label',()=>{
    const all=report({includePrices:false});
    const sources=all.sections.flatMap(section=>section.destinations.flatMap(destination=>destination.days.flatMap(day=>day.rows.map(row=>row.source))));
    expect(sources).not.toContain('Gasoline');
    expect(sources).toContain('Before batches');
  });
  it('says so when nothing matches',()=>{
    const empty=report({projectId:'p1',fromDate:'2025-01-01',toDate:'2025-01-31',includePrices:false});
    expect(empty.empty).toBe(true);
    expect(empty.sections).toEqual([]);
  });
});

describe('with prices',()=>{
  it('adds price and cost columns: the batch price for a single batch, Unpriced when missing, never $0',()=>{
    const single=report({batchId:'b4',includePrices:true});
    const row=single.sections[0]!.destinations[1]!.days[0]!.rows[0]!;
    expect(row).toMatchObject({price:'$1.10',cost:'$143.00'});
    expect(single.metadata.find(item=>item.label==='Prices')!.value).toBe('Included');
    const unpricedBatch=report({batchId:'b5',includePrices:true});
    expect(unpricedBatch.empty).toBe(true);
  });
  it('uses each fill’s own recorded cost across batches, and Unpriced for a fill without one',()=>{
    const all=report({includePrices:true});
    const rows=all.sections.flatMap(section=>section.destinations.flatMap(destination=>destination.days.flatMap(day=>day.rows)));
    expect(rows.find(row=>row.source==='Outside station · Hasbaya Highway Station')).toMatchObject({cost:'$75.00'});
    expect(rows.find(row=>row.equipment==='Roller')).toMatchObject({cost:'Unpriced'});
  });
  it('leaves every money column out without prices',()=>{
    const row=report({batchId:'b4',includePrices:false}).sections[0]!.destinations[0]!.days[0]!.rows[0]!;
    expect(row.price).toBeUndefined();
    expect(row.cost).toBeUndefined();
  });
});
