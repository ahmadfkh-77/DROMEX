import {describe,expect,it} from 'vitest';

import type {CompanyTotalsRecord} from '../src/data/repositories/CompanyTotalsRepository';
import type {RecordSnapshot} from '../src/domain/businessDocuments';
import {emptyInclusion,type CompanyTotalsData} from '../src/domain/companyTotals';
import {buildTotalsHtml} from '../src/services/totalsTemplate';

/** Company Totals PDF: every Active load behind the totals is listed (Owner-approved mockup), and a one-customer export reads "Totals" over the customer's name. */
const noWbr=(html:string)=>html.replace(/<wbr>/g,'');
const snapshot=(over:Partial<RecordSnapshot>):RecordSnapshot=>({
  recordType:'company_load',recordId:'r1',reference:'20261002-A-00001',loadNumber:'ASP-00001',loadNumberSeriesName:'Asphalt',itemKey:'id:asphalt',itemName:'Asphalt',unitKey:'t',unitSymbol:'t',quantity:37.2,
  projectId:'p1',projectName:'Haret Saida',partyId:'c1',partyName:'Youssef hashem',recordedAt:'2026-10-02T08:41:00',enteredAt:null,unitPriceCents:6200,priceBasis:'per_unit',subtotalCents:230640,
  vatRateBasisPoints:null,vatCents:null,totalCents:230640,supplierReference:null,...over});
const record=(over:Partial<RecordSnapshot>,extra:Partial<CompanyTotalsRecord>={}):CompanyTotalsRecord=>({key:`k:${over.recordId??'r1'}`,snapshot:snapshot(over),seriesId:null,status:'Active',cancellationReason:null,correctionCount:0,links:[],inclusion:{...emptyInclusion()} as never,
  details:{destination:'Saida',driverName:'Ali Nasser',truckPlate:'T-2231',deliveredBy:null,supplierName:'Plant Company'},...extra});

const first=record({recordId:'a'});
const second=record({recordId:'b',reference:'20261003-A-00002',loadNumber:'ASP-00002',quantity:37.3,recordedAt:'2026-10-03T09:15:00',unitPriceCents:null,totalCents:null});
const cancelled=record({recordId:'x',reference:'20261004-A-00003',loadNumber:'ASP-00003',quantity:20,recordedAt:'2026-10-04T07:00:00'},{status:'Cancelled',cancellationReason:'wrong site'});
const data:CompanyTotalsData={usageHiddenReason:null,deliveries:[],usage:[]};
const base={companyName:'DROMEX Asphalt Co.',logo:null,title:'Company Totals',scope:'company' as const,filters:['All dates','Item: Asphalt'],generatedAt:'2026-10-14T10:20:00',data};

describe('Company Totals PDF - Loads delivered',()=>{
  const plain=noWbr(buildTotalsHtml({...base,includePrices:false,loads:[second,cancelled,first]}));
  it('lists every Active load with its series prefix, oldest first, and leaves cancelled loads out',()=>{
    expect(plain).toContain('data-kind="loads-delivered"');
    expect(plain).toContain('Loads delivered · 2 loads');
    expect(plain.indexOf('ASP-00001')).toBeGreaterThan(-1);
    expect(plain.indexOf('ASP-00001')).toBeLessThan(plain.indexOf('ASP-00002'));
    expect(plain).not.toContain('ASP-00003');
    expect(plain).toContain('T-2231');
  });
  it('adds the block to the contents and prints no money without prices',()=>{
    expect(plain).toMatch(/Loads delivered<\/span><span class="contents-figures">2 loads/);
    expect(plain).not.toContain('Price as recorded');
    expect(plain).not.toContain('No price recorded');
  });
  it('with prices adds the price columns and says "No price recorded" for an unpriced load',()=>{
    const priced=noWbr(buildTotalsHtml({...base,includePrices:true,loads:[first,second]}));
    expect(priced).toContain('Price as recorded');
    expect(priced).toContain('No price recorded');
  });
  it('leaves the block out when there are no loads, and for a record-level Loads History',()=>{
    expect(buildTotalsHtml({...base,includePrices:false})).not.toContain('data-kind="loads-delivered"');
    expect(buildTotalsHtml({...base,includePrices:false,loads:[cancelled]})).not.toContain('data-kind="loads-delivered"');
    const history=buildTotalsHtml({...base,title:'Loads History',includePrices:false,records:[first]});
    expect(history).toContain('data-kind="history"');
    expect(history).not.toContain('data-kind="loads-delivered"');
  });
  it('a one-customer export reads Totals with the customer name in bold under the title, never as "Issued to"',()=>{
    const html=buildTotalsHtml({...base,title:'Totals',customerName:'Youssef hashem',includePrices:false,loads:[first,second]});
    expect(html).toContain('<h1><span dir="auto">Totals</span></h1><div class="subtitle"><span dir="auto">Youssef hashem</span></div>');
    expect(html).not.toContain('Issued to');
    expect(html).not.toContain('Company Totals');
    expect(buildTotalsHtml({...base,includePrices:false,loads:[first]})).toContain('Company Totals');
  });
});
