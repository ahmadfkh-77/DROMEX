import {describe,expect,it} from 'vitest';

import type {BitumenBatch} from '../src/domain/bitumen';
import {buildBitumenBatchReport} from '../src/domain/bitumenBatchReport';
import type {BitumenFill} from '../src/domain/bitumenFills';
import {buildBitumenBatchHtml} from '../src/services/bitumenBatchTemplate';

/** The fills section of the Bitumen Batch Report (DEC-557), following the approved PDF mockup. */
const COMPANY={companyName:'DROMEX',logo:null,contactLine:null};
const batch=(extra:Partial<BitumenBatch>={}):BitumenBatch=>({id:'b1',batchNumber:'BIT-2026-00007',arrivedAt:'2026-11-03T08:00:00.000Z',supplierId:'s',supplierName:'Al-Nour Bitumen Co.',gradeId:'g',gradeName:'MC-70',invoiceNumber:'55821',ticketNumber:null,notes:null,
  deliveredKg:30000,usedKg:14950,filledKg:8400,adjustmentKg:-150,remainingKg:6500,priceBasis:'per_ton',priceUsd:610,vatRatePercent:null,subtotalUsd:18300,totalUsd:18300,pricePerTonUsd:610,priced:true,status:'in_use',recordStatus:'Active',
  cancellationReason:null,cancelledAt:null,correctionHistory:[],createdAt:'2026-11-03T08:00:00.000Z',closure:null,closureHistory:[],...extra});
const fill=(id:string,day:string,time:string,kg:number,extra:Partial<BitumenFill>={}):BitumenFill=>({
  id,recordDate:day,confirmedAt:`${day}T${time}:00`,enteredAt:`${day}T${time}:00`,truckId:'t',truckName:'72-118',destinationType:'project',projectId:'p1',projectName:'Hasbaya Road',companySiteId:null,companySiteName:null,
  layerNote:null,ticketNumber:null,notes:null,totalKg:kg,portions:[{batchId:'b1',batchNumber:'BIT-2026-00007',kg,pricePerKgUsd:0.61}],cost:{costUsd:null,pricedKg:0,unpricedKg:0,fullyPriced:false},status:'Active',cancellationReason:null,cancelledAt:null,...extra});
const FILLS:BitumenFill[]=[
  fill('f1','2026-11-04','09:20',600,{truckName:'41-903',projectId:'p2',projectName:'Water Tank'}),
  fill('f2','2026-11-04','15:45',600,{destinationType:'unassigned',projectId:null,projectName:null}),
  fill('f3','2026-11-04','11:20',900,{status:'Cancelled',cancellationReason:'Wrong truck',cancelledAt:'2026-11-04T12:00:00.000Z'}),
  fill('f4','2026-11-05','08:05',2000),
  fill('f5','2026-11-06','07:30',2500,{layerNote:'Tack coat, km 4 to 6',ticketNumber:'T-5519'}),
];
const report=(options:{includePrices:boolean;fills?:readonly BitumenFill[];estimated?:boolean},b:BitumenBatch=batch())=>buildBitumenBatchReport(b,{exportedAt:'2026-11-18T09:40:00',fills:FILLS,estimated:true,...options});

describe('a batch with no fills',()=>{
  it('prints as before: no fills figure, no section',()=>{
    const result=report({includePrices:false,fills:[],estimated:false},batch({filledKg:0}));
    expect(result.fills).toBeNull();
    expect(result.figures.map(f=>f.label)).toEqual(['Delivered','Used','Adjustments','Remaining']);
    expect(buildBitumenBatchHtml(result,COMPANY)).not.toContain('FILLS INTO TRUCKS');
  });
});

describe('the figures and the section',()=>{
  it('adds Taken by fills after Delivered and names asphalt use as such',()=>{
    const result=report({includePrices:false});
    expect(result.figures.map(f=>[f.label,f.kg])).toEqual([['Delivered','30,000 kg'],['Taken by fills','8,400 kg'],['Est. used by asphalt loads','14,950 kg'],['Adjustments','-150 kg'],['Est. remaining','6,500 kg']]);
  });

  it('groups by day newest first with day totals that skip a cancelled fill, and a closing total that equals the days',()=>{
    const {fills}=report({includePrices:false});
    expect(fills!.days.map(day=>[day.date,day.count,day.kg])).toEqual([['Fri 6 Nov 2026',1,'2,500 kg'],['Thu 5 Nov 2026',1,'2,000 kg'],['Wed 4 Nov 2026',2,'1,200 kg']]);
    expect(fills!.total).toBe('5,700 kg');
    expect(fills!.fillCount).toBe(4);expect(fills!.dayCount).toBe(3);expect(fills!.cancelledCount).toBe(1);
    const cancelled=fills!.days[2]!.rows.find(row=>row.cancelled)!;
    expect(cancelled).toMatchObject({kg:'900 kg',note:'Cancelled · Wrong truck · not counted'});
    expect(fills!.days[2]!.rows.map(row=>row.time)).toEqual(['15:45','11:20','09:20']);
  });

  it('lists the destinations biggest first with Unassigned last, counting only active fills',()=>{
    const {fills}=report({includePrices:false});
    expect(fills!.byDestination.map(row=>[row.name,row.count,row.kg])).toEqual([['Project · Hasbaya Road',2,'4,500 kg'],['Project · Water Tank',1,'600 kg'],['Unassigned',1,'600 kg']]);
  });

  it('shows the layer note and ticket, and says when a fill was split across batches',()=>{
    const split=fill('f9','2026-11-06','10:00',1500,{totalKg:7200,portions:[{batchId:'b1',batchNumber:'BIT-2026-00007',kg:1500,pricePerKgUsd:0.61},{batchId:'b2',batchNumber:'BIT-2026-00008',kg:5700,pricePerKgUsd:null}]});
    const rows=report({includePrices:false,fills:[...FILLS,split]}).fills!.days[0]!.rows;
    expect(rows.find(row=>row.layer==='Tack coat, km 4 to 6')!.ticket).toBe('T-5519');
    expect(rows.find(row=>row.split)!.split).toBe('part of a 7,200 kg fill');
  });
});

describe('prices',()=>{
  it('leaves money out without prices',()=>{
    const page=buildBitumenBatchHtml(report({includePrices:false}),COMPANY);
    const section=page.slice(page.indexOf('FILLS INTO TRUCKS'),page.indexOf('USE FROM ASPHALT LOADS')||undefined);
    expect(section).not.toContain('$');expect(section).not.toContain('>Cost<');
    expect(report({includePrices:false}).fills!.totalCost).toBeNull();
  });

  it('adds a Cost column from each fill\'s own batch price, and says Unpriced instead of zero',()=>{
    const priced=report({includePrices:true}).fills!;
    expect(priced.days[0]!.rows[0]!.cost).toBe('$1,525.00');
    expect(priced.days[0]!.cost).toBe('$1,525.00');
    expect(priced.totalCost).toBe('$3,477.00');
    const unpriced=report({includePrices:true,fills:[fill('u','2026-11-06','07:30',300,{portions:[{batchId:'b1',batchNumber:'B',kg:300,pricePerKgUsd:null}]})]}).fills!;
    expect(unpriced.days[0]!.rows[0]!.cost).toBe('Unpriced');
    expect(unpriced.totalCost).toBe('Unpriced');
    const mixed=report({includePrices:true,fills:[fill('m1','2026-11-06','07:30',1000),fill('m2','2026-11-06','08:30',300,{portions:[{batchId:'b1',batchNumber:'B',kg:300,pricePerKgUsd:null}]})]}).fills!;
    expect(mixed.totalCost).toBe('$610.00 + 300 kg Unpriced');
  });
});

describe('the page',()=>{
  const page=buildBitumenBatchHtml(report({includePrices:true}),COMPANY);
  it('puts FILLS INTO TRUCKS before USE FROM ASPHALT LOADS, with a by-destination and a by-day table and a closing row',()=>{
    expect(page.indexOf('FILLS INTO TRUCKS')).toBeGreaterThan(0);
    expect(page.indexOf('FILLS INTO TRUCKS')).toBeLessThan(page.indexOf('>HISTORY<'));
    expect(page).toContain('By destination');expect(page).toContain('By day');
    expect(page).toContain('Taken by fills · 4 fills · 3 days');
    expect(page).toContain('Cancelled · Wrong truck · not counted');
  });
  it('escapes names so a truck or project cannot break the page',()=>{
    const hostile=buildBitumenBatchHtml(report({includePrices:false,fills:[fill('x','2026-11-06','07:30',100,{truckName:'<b>T</b>',projectName:'A & B'})]}),COMPANY);
    expect(hostile).not.toContain('<b>T</b>');expect(hostile).toContain('A &amp; B');
  });
  it('lists each fill in History with the kg leaving, and a cancelled fill with the kg coming back',()=>{
    const {history}=report({includePrices:false});
    expect(history.map(row=>row.kg)).toContain('−2,000');
    expect(history.some(row=>row.event.startsWith('Fill · Truck 72-118'))).toBe(true);
    const back=history.find(row=>row.event.startsWith('Fill cancelled'))!;
    expect(back).toMatchObject({kg:'+900'});expect(back.event).toContain('Wrong truck');
  });
});
