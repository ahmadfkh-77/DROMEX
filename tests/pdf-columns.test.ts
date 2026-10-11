import {describe,expect,it} from 'vitest';

import type {CompanyTotalsRecord} from '../src/data/repositories/CompanyTotalsRepository';
import type {RecordSnapshot} from '../src/domain/businessDocuments';
import {emptyInclusion,type CompanyTotalsData} from '../src/domain/companyTotals';
import {loadHistoryRows} from '../src/domain/loadHistoryPdf';
import type {ConfirmedLoad} from '../src/domain/loads';
import {breakAfterHyphens,columnWidths,wholePercents,type ColumnSpec} from '../src/services/pdfColumns';
import {buildLoadHistoryHtml,loadHistoryWidths} from '../src/services/loadHistoryTemplate';
import {buildTotalsHtml} from '../src/services/totalsTemplate';

/**
 * One width rule for every list table: each column has room for its longest word, the widths are whole percentages that
 * add up to 100, a load number breaks after a hyphen instead of running into the next column, and a quantity is printed with
 * its unit ("27 M³") so the number and its unit are never far apart.
 */
const sum=(values:readonly number[])=>values.reduce((a,b)=>a+b,0);
const widthsOf=(html:string)=>[...(html.match(/<colgroup>.*?<\/colgroup>/s)?.[0].matchAll(/width:(\d+)%/g)??[])].map(match=>Number(match[1]));

describe('the width rule',()=>{
  const specs:ColumnSpec[]=[
    {header:'Date, time',cells:['10 Sep 2026','8 Sep 2026']},{header:'Load No.',kind:'code',cells:['SUP-20260908-GKQ4-00015','SUP-20260910-GKQ4-00040']},
    {header:'Item',cells:['Karaki water','VES 60cm','Mohamad Kassem']},{header:'Customer',cells:['Fakih Brothers Co. S.A.R.L','Fakih Brothers Co. S.A.R.L']},
    {header:'Truck plate',cells:['M355965','Not recorded']},{header:'Quantity',kind:'number',cells:['27 M³','4000 L','16 Qty','25 M³']},
  ];
  it('adds up to exactly 100 whole percent, whatever the content',()=>{
    for(const content of [specs,specs.slice(0,3),[{header:'A',cells:[]}],[{header:'Name',cells:['x'.repeat(200)]},{header:'Other',cells:['y'.repeat(200)]}]]){
      const widths=columnWidths(content);
      expect(widths.length).toBe(content.length);expect(sum(widths)).toBe(100);expect(widths.every(width=>width>=1&&Number.isInteger(width))).toBe(true);
    }
    expect(columnWidths([])).toEqual([]);
  });
  it('gives every column room for its longest word, so nothing overflows into the next column',()=>{
    const widths=columnWidths(specs);const CHAR=8*(25.4/72)*0.62,PAD=3.8,PAGE=180;
    // the longest word of each column, in millimetres, must fit in the column (a load code is measured between hyphens)
    const longestWord=[11,13,14,9,12,6];
    widths.forEach((width,index)=>expect(width/100*PAGE).toBeGreaterThanOrEqual(longestWord[index]!*CHAR+PAD-0.6));
  });
  it('keeps the quantity column only as wide as its number and unit, and shares the rest with the text columns',()=>{
    const widths=columnWidths(specs);
    expect(widths[5]!).toBeLessThanOrEqual(12);
    expect(widths[3]!).toBeGreaterThan(widths[5]!);
  });
  it('is the same every time for the same content',()=>{expect(columnWidths(specs)).toEqual(columnWidths(specs));});
  it('splits percentages by the largest remainders, and a hyphen followed by a digit gets a break point',()=>{
    expect(wholePercents([1,1,1])).toEqual([34,33,33]);expect(wholePercents([0,0])).toEqual([0,0]);
    expect(breakAfterHyphens('SUP-20260908-GKQ4-00015')).toBe('SUP-<wbr>20260908-<wbr>GKQ4-<wbr>00015');
  });
});

const snapshot=(over:Partial<RecordSnapshot>):RecordSnapshot=>({recordType:'supplier_load',recordId:'r',reference:'SUP-20260908-GKQ4-00031',loadNumber:null,loadNumberSeriesName:null,itemKey:'i',itemName:'VES 60cm',unitKey:'q',unitSymbol:'Qty',quantity:16,
  projectId:'p',projectName:'Highway Link',partyId:'s',partyName:'Mohamad mohsen',recordedAt:'2026-09-08T09:18:00',enteredAt:null,unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null,...over});
const record=(over:Partial<RecordSnapshot>,details:CompanyTotalsRecord['details']):CompanyTotalsRecord=>({key:'k'+(over.reference??''),snapshot:snapshot(over),seriesId:null,status:'Active',cancellationReason:null,correctionCount:0,links:[],inclusion:{...emptyInclusion()} as never,details});
const data:CompanyTotalsData={usageHiddenReason:null,deliveries:[],usage:[]};
const base={companyName:'DROMEX Asphalt Co.',logo:null,title:'Customer Deliveries',scope:'company' as const,filters:['All dates'],generatedAt:'2026-10-05T16:30:00',data,contactLine:null};
const longCustomer='Fakih Brothers Co. S.A.R.L';
const photoRows=[
  record({reference:'SUP-20260903-GKQ4-00015',itemName:'Karaki water',unitSymbol:'L',quantity:4000,recordedAt:'2026-09-03T17:47:00',partyName:'Karaki water'},{destination:null,driverName:null,truckPlate:null,deliveredBy:'supplier',customerName:longCustomer}),
  record({reference:'SUP-20260908-GKQ4-00031'},{destination:null,driverName:'Mohamad mohsen',truckPlate:'M355965',deliveredBy:'company',customerName:longCustomer}),
  record({reference:'SUP-20260908-GKQ4-00032',itemName:'Mohamad sharaf',unitSymbol:'M³',quantity:27,partyName:'Mohamad sharaf',supplierReference:'0009309'},{destination:null,driverName:'Ali kazem',truckPlate:'M333299',deliveredBy:'company',customerName:longCustomer}),
  record({reference:'SUP-20260915-GKQ4-00050',itemName:'Jawad Fakih',unitSymbol:'Gal',quantity:1,partyName:'Jawad Fakih'},{destination:null,driverName:null,truckPlate:null,deliveredBy:'supplier',customerName:longCustomer}),
];
const listHtml=(prices:boolean)=>buildTotalsHtml({...base,includePrices:prices,records:photoRows} as never);

describe('the loads list of the Totals PDFs',()=>{
  it('prints the quantity with its unit and has no separate Unit column',()=>{
    const html=listHtml(false);
    expect(html).not.toContain('<th>Unit</th>');
    for(const text of ['4000 L','16 Qty','27 M³','1 Gal'])expect(html).toContain(`<td class="num">${text}</td>`);
    expect(html).toContain('<th>Truck plate</th><th class="num">Quantity</th><th>Project</th>');
  });
  it('lets a load number break after each hyphen and never forces it onto one line',()=>{
    const html=listHtml(false);
    expect(html).toContain('<span class="ln">SUP-<wbr>20260908-<wbr>GKQ4-<wbr>00031</span>');
    expect(html).not.toMatch(/\.ln\{[^}]*nowrap/);
  });
  it('has widths that add up to 100, with and without prices, and a wide enough Load No. column',()=>{
    for(const prices of [false,true]){
      const widths=widthsOf(listHtml(prices));
      expect(sum(widths)).toBe(100);expect(widths.length).toBe(prices?11:9);
    }
    const plain=widthsOf(listHtml(false));
    expect(plain[1]!).toBeGreaterThanOrEqual(11);
    expect(plain[7]!).toBeLessThanOrEqual(12);
  });
});

describe('the Load History PDF',()=>{
  const load=(over:Partial<ConfirmedLoad>)=>({id:'x',transactionNumber:'20260908-A-00031',confirmedAt:'2026-09-08T09:18:00',customerName:longCustomer,itemName:'Sand',outputUnitSymbol:'t',billedQuantity:25,status:'Active',correctionHistory:[],companyName:'DROMEX S.A.R.L.',loadNumber:'ASP-00001',driverName:'Ali kazem',truckPlate:'M333299',...over}) as ConfirmedLoad;
  const rows=loadHistoryRows([load({}),load({id:'y',transactionNumber:'20260910-A-00040',loadNumber:'AGGREGATES-00002',itemName:'Deformed ribbed reinforcing bar grade 60, galvanised'}),load({id:'z',loadNumber:null as never,driverName:null as never,truckPlate:null as never})],'DROMEX S.A.R.L.');
  it('adds up to 100, with nine columns, and breaks the load number after the hyphen',()=>{
    const widths=loadHistoryWidths(rows);expect(widths.length).toBe(9);expect(sum(widths)).toBe(100);
    const html=buildLoadHistoryHtml({companyName:'DROMEX',logo:null,contactLine:null,generatedAt:'2026-10-09T16:20:00',summary:{period:'All dates',customer:'All customers',items:'All items',status:'Active loads',listed:'3'},rows,totals:[]});
    expect(widthsOf(html)).toEqual(widths);expect(html).toContain('<span class="ln">ASP-<wbr>00001</span>');expect(html).not.toMatch(/\.ln\{[^}]*nowrap/);
  });
});
