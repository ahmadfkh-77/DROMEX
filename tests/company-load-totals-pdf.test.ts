import {describe,expect,it} from 'vitest';

import type {CompanyTotalsRecord} from '../src/data/repositories/CompanyTotalsRepository';
import type {RecordSnapshot} from '../src/domain/businessDocuments';
import {buildCompanyLoadTree,type CompanyLoadTotalRow} from '../src/domain/companyTotals';
import {buildCompanyLoadTotalsHtml} from '../src/services/companyLoadTotalsTemplate';

/** DEC-487 (6). The Company Load Totals PDF: filters, load counts, per-unit totals, project grouping, repeated headings. */
const rows:CompanyLoadTotalRow[]=[
  {seriesKey:'s_asp',seriesLabel:'ASP · Asphalt',itemKey:'id:a',itemName:'Asphalt',projectKey:'road',projectName:'Mountain Road',unitKey:'unit_ton',unitSymbol:'t',status:'Active',quantity:38.5,loadCount:2},
  {seriesKey:'s_asp',seriesLabel:'ASP · Asphalt',itemKey:'id:a',itemName:'Asphalt',projectKey:'road',projectName:'Mountain Road',unitKey:'unit_ton',unitSymbol:'t',status:'Cancelled',quantity:50,loadCount:1},
  {seriesKey:'s_asp',seriesLabel:'ASP · Asphalt',itemKey:'id:c',itemName:'Concrete',projectKey:'road',projectName:'Mountain Road',unitKey:'unit_m3',unitSymbol:'m³',status:'Active',quantity:6,loadCount:1},
  {seriesKey:'legacy',seriesLabel:'Legacy loads — no generated load number',itemKey:'id:a',itemName:'Asphalt',projectKey:'__none__',projectName:'No project — direct customer deliveries',unitKey:'unit_ton',unitSymbol:'t',status:'Active',quantity:7,loadCount:1},
];
const snap=(id:string,loadNumber:string|null,quantity:number,unitSymbol='t'):RecordSnapshot=>({recordType:'company_load',recordId:id,reference:`TX-${id}`,loadNumber,loadNumberSeriesName:loadNumber?'Asphalt':null,itemKey:'id:a',itemName:'Asphalt <hot>',unitKey:unitSymbol==='t'?'unit_ton':'unit_m3',unitSymbol,quantity,projectId:'road',projectName:'Mountain Road',partyId:'c',partyName:'Road Co',recordedAt:'2026-08-10T09:05:00',enteredAt:null,unitPriceCents:null,priceBasis:'per_unit',subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null});
const record=(snapshot:RecordSnapshot,status:'Active'|'Cancelled'='Active',seriesId:string|null='s_asp'):CompanyTotalsRecord=>({key:`company_load:${snapshot.recordId}`,snapshot,seriesId,status,cancellationReason:status==='Cancelled'?'Duplicate ticket':null,correctionCount:status==='Active'?1:0,links:[],inclusion:{state:'not_included'}});
const loads=[record(snap('1','ASP-2026-001',20)),record(snap('2','ASP-2026-002',18.5)),record(snap('3','ASP-2026-003',50),'Cancelled'),record(snap('4','ASP-2026-004',6,'m³')),record(snap('5',null,7),'Active',null)];

describe('Company Load Totals PDF',()=>{
  const html=buildCompanyLoadTotalsHtml({companyName:'DROMEX Plant',logo:null,generatedAt:'2026-09-02T08:00:00',filters:['1 Aug 2026 – 31 Aug 2026','Grouped by number series'],groupBy:'series',groups:buildCompanyLoadTree(rows,'series'),loads});
  it('prints the filters and the generated time',()=>{
    expect(html).toContain('Company Load Totals');
    expect(html).toContain('1 Aug 2026 – 31 Aug 2026');
    expect(html).toContain('Grouped by number series');
    expect(html).toContain('2 Sep 2026');
  });
  it('gives load counts and per-unit totals per group and project, never combining units',()=>{
    expect(html).toContain('ASP · Asphalt');
    expect(html).toContain('38.5 t');
    expect(html).toContain('6 m³');
    expect(html).not.toContain('44.5');
    expect(html).toMatch(/3 loads/);
  });
  it('lists cancelled loads apart and never adds them in',()=>{
    expect(html).toContain('Cancelled — not counted');
    expect(html).toContain('Duplicate ticket');
    expect(html).not.toContain('88.5');
  });
  it('lists each load with its number and the legacy wording, escaped',()=>{
    expect(html).toContain('ASP-2026-001');
    expect(html).toContain('Legacy load — no generated load number');
    expect(html).toContain('Asphalt &lt;hot&gt;');
    expect(html).toContain('Corrected 1×');
  });
  it('repeats headings on every page and keeps group headings with their rows',()=>{
    expect(html).toContain('display:table-header-group');
    expect(html).toMatch(/<thead>[\s\S]*Load number[\s\S]*<\/thead>/);
    expect(html).toContain('break-after:avoid');
  });
});
