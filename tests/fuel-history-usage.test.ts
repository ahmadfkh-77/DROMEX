import {describe,expect,it} from 'vitest';

import type {FuelMovement} from '../src/domain/fuel';
import type {BatchDetail,DieselBatchOverview,FillBatchInfo} from '../src/domain/fuelBatches';
import {buildDieselBatchReport} from '../src/domain/dieselBatchReport';
import {batchDestinationTotals,buildFillRows,buildHistoryDays,filterUsageFills,fuelUsageSummary,groupFillsByDay,historySummary} from '../src/domain/fuelBatchViews';

/** The Fuel Management History and Usage tabs in the approved day-card design (DEC-492, amended 2026-10-03). */
const STARTED='2026-10-01T05:00:00';
let seq=0;
const move=(extra:Partial<FuelMovement>):FuelMovement=>({
  id:`m${++seq}`,type:'fill',fuelType:'diesel',correctionHistory:[],confirmedAt:'2026-10-03T07:40:00',litres:100,previousBalanceLitres:null,differenceLitres:null,supplierId:null,supplierName:null,
  equipmentType:'machine',equipmentId:'exc',equipmentName:'Excavator CAT 320',projectId:'p1',projectName:'مشروع طريق حاصبيا',destinationType:'project',companySiteId:null,companySiteName:null,companySiteIsActive:null,
  ticketNumber:null,odometerReading:null,reason:null,notes:null,fuelPriceHistoryId:null,pricePerLitreUsd:null,priceOverrideReason:null,consumptionCostUsd:null,subtotalUsd:null,vatRatePercent:null,vatAmountUsd:null,
  finalTotalUsd:null,paymentStatus:'Unpriced',status:'Active',cancellationReason:null,cancelledAt:null,balanceAfterLitres:0,fuelSource:'tank',fuelStationId:null,fuelStationName:null,batchId:null,...extra,
});
const info=(portions:[string,string,number][],cost:FillBatchInfo['cost']={costUsd:null,pricedLitres:0,unpricedLitres:0,fullyPriced:false}):FillBatchInfo=>({fillId:'x',portions:portions.map(([batchId,batchNumber,litres])=>({batchId,batchNumber,litres,kind:'fill' as const})),shortfallLitres:0,outstandingShortfallLitres:0,cost});
const batch=(id:string,number:string,extra:Partial<BatchDetail>={}):BatchDetail=>({id,batchNumber:number,arrivedAt:'2026-10-01T08:00:00',deliveredLitres:1000,pricePerLitreUsd:1.1,filledLitres:0,adjustmentLitres:0,remainingLitres:1000,status:'in_use',kind:'delivery',invoiceNumber:'55821',supplierName:'Al-Nour Fuel',openingBasis:null,deliveryMovementId:null,openingGaugeMovementId:null,cancellationReason:null,cancelledAt:null,...extra});

const delivery1=move({id:'d1',type:'delivery',confirmedAt:'2026-10-01T08:00:00',litres:1000,supplierName:'Al-Nour Fuel',ticketNumber:'55821',equipmentName:null,projectId:null,projectName:null,destinationType:null});
const delivery2=move({id:'d2',type:'delivery',confirmedAt:'2026-10-03T07:00:00',litres:1000,supplierName:'Al-Nour Fuel',equipmentName:null,projectId:null,projectName:null,destinationType:null});
const oldDelivery=move({id:'d0',type:'delivery',confirmedAt:'2026-09-20T08:00:00',litres:500,supplierName:null,equipmentName:null,projectId:null,projectName:null,destinationType:null});
const dip=move({id:'g1',type:'gauge',confirmedAt:'2026-10-03T06:30:00',litres:540,previousBalanceLitres:560,differenceLitres:-20,reason:'Morning dip',equipmentName:null,projectId:null,projectName:null,destinationType:null});
const firstDip=move({id:'g0',type:'gauge',confirmedAt:'2026-09-19T06:30:00',litres:300,previousBalanceLitres:null,differenceLitres:null,equipmentName:null,projectId:null,projectName:null,destinationType:null});
const movements=[
  delivery1,delivery2,oldDelivery,dip,firstDip,
  move({id:'a',confirmedAt:'2026-10-03T07:40:00',litres:130}),
  move({id:'b',confirmedAt:'2026-10-03T11:15:00',litres:70,destinationType:'company_site',projectId:null,projectName:null,companySiteId:'s1',companySiteName:'Quarry Gate',equipmentType:'truck',equipmentId:'trk',equipmentName:'72-118'}),
  move({id:'x',confirmedAt:'2026-10-03T11:20:00',litres:70,status:'Cancelled',cancellationReason:'Typed twice',destinationType:'company_site',projectId:null,projectName:null,companySiteId:'s1',companySiteName:'Quarry Gate',equipmentType:'truck',equipmentId:'trk',equipmentName:'72-118'}),
  move({id:'c',confirmedAt:'2026-10-02T08:05:00',litres:110,projectId:'p2',projectName:'Marjayoun Water Tank',equipmentId:'ldr',equipmentName:'Wheel Loader'}),
  move({id:'f',confirmedAt:'2026-10-02T16:00:00',litres:35,fuelSource:'station',fuelStationId:'st1',fuelStationName:'Hasbaya Highway Station',ticketNumber:'7731',projectId:'p2',projectName:'Marjayoun Water Tank',equipmentType:'truck',equipmentId:'trk',equipmentName:'72-118'}),
  move({id:'u',confirmedAt:'2026-10-02T15:30:00',litres:50,destinationType:'unassigned',projectId:null,projectName:null,equipmentId:'rol',equipmentName:'Roller'}),
];
const overview:DieselBatchOverview={started:true,startedAt:STARTED,tankLitres:1340,overfillAlert:false,outstandingShortfallLitres:0,
  batches:[batch('b4','DSL-2026-00004',{deliveryMovementId:'d1'}),batch('b5','DSL-2026-00005',{deliveryMovementId:'d2',invoiceNumber:null,status:'waiting'})],
  fills:{a:info([['b4','DSL-2026-00004',130]],{costUsd:143,pricedLitres:130,unpricedLitres:0,fullyPriced:true}),b:info([['b4','DSL-2026-00004',70]],{costUsd:77,pricedLitres:70,unpricedLitres:0,fullyPriced:true}),c:info([['b4','DSL-2026-00004',110]],{costUsd:121,pricedLitres:110,unpricedLitres:0,fullyPriced:true}),u:info([['b4','DSL-2026-00004',50]],{costUsd:55,pricedLitres:50,unpricedLitres:0,fullyPriced:true})},
  adjustments:[{gaugeId:'g1',batchId:'b4',batchNumber:'DSL-2026-00004',litres:-20,calculatedLitres:560,dipLitres:540,confirmedAt:'2026-10-03T06:30:00'}],changes:[]};

describe('cancelled fills in day cards',()=>{
  it('can be included for History, flagged with their reason, and never count in totals',()=>{
    const rows=buildFillRows(movements,overview,{includeCancelled:true});
    expect(rows.find(row=>row.id==='x')).toMatchObject({cancelled:true,cancellationReason:'Typed twice'});
    expect(rows.find(row=>row.id==='b')).toMatchObject({cancelled:false,cancellationReason:null});
    const saturday=groupFillsByDay(rows,{byDestination:true})[0]!;
    expect(saturday.total).toBe(200);
    expect(saturday.groups.find(group=>group.type==='company_site')).toMatchObject({total:70});
    expect(saturday.groups.find(group=>group.type==='company_site')!.rows).toHaveLength(2);
  });
  it('stay out by default, as on every other screen',()=>{
    expect(buildFillRows(movements,overview).some(row=>row.id==='x')).toBe(false);
  });
});

describe('History: one card per day with deliveries, dip readings and fills',()=>{
  const days=buildHistoryDays(movements,overview);
  it('makes one card per day, newest first, including days with only a delivery or a reading',()=>{
    expect(days.map(day=>day.label)).toEqual(['Sat 3 Oct 2026','Fri 2 Oct 2026','Thu 1 Oct 2026','Sun 20 Sep 2026','Sat 19 Sep 2026']);
  });
  it('heads each day with the litres in and out, leaving cancelled records out',()=>{
    expect(days.map(day=>[day.inLitres,day.outLitres])).toEqual([[1000,200],[0,195],[1000,0],[500,0],[0,0]]);
  });
  it('lists deliveries with their supplier, batch, invoice and litres in',()=>{
    expect(days[0]!.deliveries).toEqual([expect.objectContaining({id:'d2',title:'Al-Nour Fuel',tag:{kind:'delivery',text:'Delivery · DSL-2026-00005'},detail:'Invoice not recorded',litresText:'+1,000 L',cancelled:false,time:'07:00'})]);
    expect(days[2]!.deliveries[0]).toMatchObject({tag:{kind:'delivery',text:'Delivery · DSL-2026-00004'},detail:'Invoice 55821'});
    expect(days[3]!.deliveries[0]).toMatchObject({title:'Supplier not recorded',tag:{kind:'delivery',text:'Delivery · Before batches'}});
  });
  it('lists dip readings with the calculated figure and where the difference went',()=>{
    expect(days[0]!.dips).toEqual([expect.objectContaining({id:'g1',title:'Dip reading 540 L',tag:{kind:'dip',text:'Calculated 560 L · −20 L on DSL-2026-00004'},litresText:'= 540 L'})]);
    expect(days[4]!.dips[0]!.tag.text).toBe('First reading');
  });
  it('groups the fills by destination exactly like the other day cards, with cancelled fills shown but not counted',()=>{
    expect(days[0]!.fills.map(group=>[group.type,group.name,group.total,group.rows.length])).toEqual([['project','مشروع طريق حاصبيا',130,1],['company_site','Quarry Gate',70,2]]);
    expect(days[1]!.fills.map(group=>[group.type,group.name,group.total])).toEqual([['project','Marjayoun Water Tank',145],['unassigned','Unassigned',50]]);
  });
  it('marks a cancelled delivery or reading and keeps it out of the litres in',()=>{
    const cancelled=buildHistoryDays([{...delivery1,status:'Cancelled',cancellationReason:'Wrong supplier'}],overview)[0]!;
    expect(cancelled.deliveries[0]).toMatchObject({cancelled:true,tag:{kind:'cancelled',text:'Cancelled · Wrong supplier'}});
    expect(cancelled.inLitres).toBe(0);
  });
});

describe('History summary',()=>{
  it('totals litres in, litres out and dip adjustments for the records shown, and counts records and days',()=>{
    expect(historySummary(movements,1340)).toEqual({deliveredLitres:2500,filledLitres:395,adjustmentLitres:-20,tankLitres:1340,records:11,days:5});
  });
});

describe('Usage: fuel used by destination',()=>{
  it('totals every destination by source, with cost and unpriced litres, and counts destinations',()=>{
    expect(fuelUsageSummary(movements,overview,{})).toMatchObject({totalLitres:395,tankBatchLitres:360,beforeBatchesLitres:0,stationLitres:35,costUsd:396,unpricedLitres:35,fillCount:5,equipmentCount:4,dayCount:2,destinationCount:4});
  });
  it('lists totals by destination with the id a tap needs',()=>{
    expect(batchDestinationTotals(buildFillRows(movements,overview))).toEqual([
      {type:'project',destinationId:'p2',name:'Marjayoun Water Tank',litres:145},
      {type:'project',destinationId:'p1',name:'مشروع طريق حاصبيا',litres:130},
      {type:'company_site',destinationId:'s1',name:'Quarry Gate',litres:70},
      {type:'unassigned',destinationId:null,name:'Unassigned',litres:50},
    ]);
  });
  it('filters to one destination type, one destination, a date range or a search',()=>{
    const ids=(filter:Parameters<typeof filterUsageFills>[1])=>filterUsageFills(movements,filter).map(fill=>fill.id);
    expect(ids({destinationType:'company_site'})).toEqual(['b']);
    expect(ids({destinationType:'project',destinationId:'p2'})).toEqual(['c','f']);
    expect(ids({destinationType:'unassigned'})).toEqual(['u']);
    expect(ids({fromDate:'2026-10-03',toDate:'2026-10-03'})).toEqual(['a','b']);
    expect(ids({query:'hasbaya highway'})).toEqual(['f']);
    expect(ids({query:'roller'})).toEqual(['u']);
    expect(ids({query:'marjayoun'})).toEqual(['c','f']);
    expect(ids({})).not.toContain('x');
  });
  it('summarises only the destination chosen',()=>{
    expect(fuelUsageSummary(movements,overview,{destinationType:'project',destinationId:'p2'})).toMatchObject({totalLitres:145,stationLitres:35,destinationCount:1});
  });
});

describe('exporting one destination',()=>{
  const names={projects:[{id:'p1',name:'مشروع طريق حاصبيا'},{id:'p2',name:'Marjayoun Water Tank'}],companySites:[{id:'s1',name:'Quarry Gate'}],stations:[{id:'st1',name:'Hasbaya Highway Station'}]};
  it('exports only the unassigned fills when asked',()=>{
    const report=buildDieselBatchReport({movements,overview,names,filter:{unassigned:true,includePrices:false},exportedAt:'2026-10-03T18:00:00'});
    expect(report.sections.map(section=>section.title)).toEqual(['UNASSIGNED']);
    expect(report.metadata.find(item=>item.label==='Site filter')!.value).toBe('Unassigned only');
    expect(report.summary.filteredNote).not.toBeNull();
  });
  it('exports one company site',()=>{
    const report=buildDieselBatchReport({movements,overview,names,filter:{companySiteId:'s1',includePrices:false},exportedAt:'2026-10-03T18:00:00'});
    expect(report.sections.map(section=>[section.title,section.destinations.map(destination=>destination.total)])).toEqual([['COMPANY SITES',[70]]]);
  });
});
