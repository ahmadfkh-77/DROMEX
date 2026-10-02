import {describe,expect,it} from 'vitest';

import {emptyInclusion,type CompanyTotalsData} from '../src/domain/companyTotals';
import {totalsFileName} from '../src/domain/recordFormat';
import {buildTotalsHtml} from '../src/services/totalsTemplate';

/** DEC-487 (1). The Totals PDF: delivered and used quantities, with or without prices. */
const counts=(total:number,included=0)=>({...emptyInclusion(),total,included,open:total-included});
const data:CompanyTotalsData={usageHiddenReason:null,
  deliveries:[
    {source:'supplier_delivery',itemKey:'id:sand',itemName:'Sand <washed>',projectKey:'road',projectName:'Mountain Road',supplierKey:'id:a',supplierName:'Alpha Quarry',unitKey:'m3',unitSymbol:'m³',quantity:12,recordCount:2,valueCents:8000,pricedCount:1,inclusion:counts(2,1)},
    {source:'company_delivery',itemKey:'id:sand',itemName:'Sand <washed>',projectKey:'road',projectName:'Mountain Road',supplierKey:'company',supplierName:'Company loads — own deliveries',unitKey:'t',unitSymbol:'t',quantity:10,recordCount:1,valueCents:null,pricedCount:0,inclusion:counts(1)},
    {source:'supplier_delivery',itemKey:'id:sand',itemName:'Sand <washed>',projectKey:'other',projectName:'رمل الساحل',supplierKey:'id:b',supplierName:'Beta Quarry',unitKey:'t',unitSymbol:'t',quantity:6,recordCount:1,valueCents:null,pricedCount:0,inclusion:counts(1)},
  ],
  usage:[{movement:'used',itemKey:'id:sand',itemName:'Sand <washed>',projectKey:'road',projectName:'Mountain Road',unitKey:'m3',unitSymbol:'m³',quantity:9,recordCount:1}]};
const base={companyName:'DROMEX Plant',logo:null,title:'Company Totals',scope:'company' as const,filters:['1 Aug 2026 – 31 Aug 2026'],generatedAt:'2026-09-02T08:00:00',data};

describe('Totals PDF',()=>{
  const plain=buildTotalsHtml({...base,includePrices:false});
  const priced=buildTotalsHtml({...base,includePrices:true});
  it('prints title, filters, generation time and the prices choice',()=>{
    expect(plain).toContain('Company Totals');
    expect(plain).toContain('1 Aug 2026 – 31 Aug 2026');
    expect(plain).toContain('2 Sep 2026');
    expect(plain).not.toContain('Without prices');
    expect(priced).not.toContain('With recorded prices');
  });
  it('shows delivered and used per unit, never adding units together',()=>{
    expect(plain).toContain('12 m³');
    expect(plain).toContain('16 t');
    expect(plain).toContain('9 m³');
    expect(plain).not.toContain('28');
    expect(plain).toContain('Not recorded');
  });
  it('breaks each material down by project and by supplier, the company apart from suppliers',()=>{
    expect(plain).toContain('Mountain Road');
    expect(plain).toContain('رمل الساحل');
    expect(plain).toContain('Alpha Quarry');
    expect(plain).toContain('Company loads — own deliveries');
    expect(plain).toContain('Delivered minus recorded use');
  });
  it('leaves every amount off without prices, and adds only recorded prices with them',()=>{
    expect(plain).not.toMatch(/\$\d/);
    expect(plain).not.toContain('Recorded value');
    expect(priced).toContain('$80.00');
    expect(priced).toMatch(/3 records unpriced/);
    expect(priced).not.toContain('$0.00');
  });
  it('escapes names, marks text direction, and repeats headings on later pages',()=>{
    expect(plain).toContain('Sand &lt;washed&gt;');
    expect(plain).toContain('dir="auto"');
    expect(plain).toContain('display:table-header-group');
    expect(plain).toContain('break-inside:avoid');
  });
  it('says why use is missing when a filter hides it',()=>{
    expect(buildTotalsHtml({...base,includePrices:false,data:{...data,usage:[],usageHiddenReason:'Use is not recorded per supplier.'}})).toContain('Use is not recorded per supplier.');
  });
});

describe('Totals PDF file name',()=>{
  it('names the scope, period and price choice',()=>{
    expect(totalsFileName({title:'Company Totals',scopeName:null,fromDate:'2026-08-01',toDate:'2026-08-31',includePrices:false})).toBe('Company Totals - Aug 2026 - No prices.pdf');
    expect(totalsFileName({title:'Project Totals',scopeName:'Mountain Road',fromDate:'',toDate:'',includePrices:true})).toBe('Project Totals - Mountain Road - All dates - With prices.pdf');
  });
});

describe('header',()=>{
  it('shows only the title and the date and time on the top right; filters and the price choice move below',()=>{
    const html=buildTotalsHtml({...base,includePrices:false});
    const right=html.slice(html.indexOf('class="head-right"'),html.indexOf('</div></div>',html.indexOf('class="head-right"')));
    expect(right).toContain('Company Totals');
    expect(right).toContain('2 Sep 2026 · 08:00');
    expect(right).not.toContain('1 Aug 2026 – 31 Aug 2026');
    expect(right).not.toContain('Without prices');
    expect(right).not.toContain('Generated');
    expect(html.indexOf('1 Aug 2026 – 31 Aug 2026')).toBeGreaterThan(html.indexOf('class="head-right"'));
  });
});

describe('Loads History PDF',()=>{
  const snap=(id:string,day:string,quantity:number,priceCents:number|null):import('../src/domain/businessDocuments').RecordSnapshot=>({recordType:'supplier_load',recordId:id,reference:`QP-${id}`,loadNumber:null,loadNumberSeriesName:null,itemKey:'id:sand',itemName:'Sand',unitKey:'m3',unitSymbol:'m³',quantity,projectId:'road',projectName:'Mountain Road',partyId:'a',partyName:'Alpha Quarry',recordedAt:`${day}T09:30:00`,enteredAt:null,unitPriceCents:priceCents,priceBasis:'per_unit',subtotalCents:priceCents==null?null:priceCents*quantity,vatRateBasisPoints:priceCents==null?null:0,vatCents:priceCents==null?null:0,totalCents:priceCents==null?null:priceCents*quantity,supplierReference:'T-88'});
  const records=[snap('2','2026-08-12',4,null),snap('1','2026-08-10',8,1000)].map(snapshot=>({key:`supplier_load:${snapshot.recordId}`,snapshot,seriesId:null,status:'Active' as const,cancellationReason:null,correctionCount:0,links:[],inclusion:{state:'not_included' as const}}));
  const history=(includePrices:boolean)=>buildTotalsHtml({...base,title:'Loads History',issuedTo:'Alpha Quarry',includePrices,records,data:{...data,deliveries:[data.deliveries[0]!],usage:[]}});
  it('lists every delivery oldest first with date, time, references, project, supplier and quantity',()=>{
    const html=history(false);
    expect(html).toContain('Loads History');
    const right=html.slice(html.indexOf('class="head-right"'),html.indexOf('</div></div>',html.indexOf('class="head-right"')));
    expect(right).toContain('Issued to: <span dir="auto">Alpha Quarry</span>');
    expect(right.indexOf('Loads History')).toBeLessThan(right.indexOf('Alpha Quarry'));
    expect(right.indexOf('Alpha Quarry')).toBeLessThan(right.indexOf('2 Sep 2026'));
    expect(html).toContain('Loads history · 2 loads');
    expect(html.indexOf('QP-1')).toBeLessThan(html.indexOf('QP-2'));
    for(const text of ['10 Aug 2026','09:30','Supplier ticket T-88','Mountain Road','Alpha Quarry','8 m³','4 m³'])expect(html).toContain(text);
    expect(html).toContain('12 m³');
  });
  it('is not a billing document: no number, no signer, and it says so',()=>{
    const html=history(false);
    expect(html).toContain('not an invoice or bill');
    expect(html).not.toMatch(/INV-|BILL-|Bill to|Billed to|Due date/);
  });
  it('adds prices only when chosen, never as $0.00',()=>{
    expect(history(false)).not.toMatch(/\$\d/);
    const priced=history(true);
    expect(priced).toContain('$80.00');
    expect(priced).toContain('No price recorded');
    expect(priced).not.toContain('$0.00');
  });
});

describe('Loads History file name',()=>{
  it('names the item, project, supplier, period and price choice',()=>{
    expect(totalsFileName({title:'Loads History',scopeName:'Sand Mountain Road Alpha Quarry',fromDate:'2026-08-01',toDate:'2026-08-31',includePrices:false})).toBe('Loads History - Sand Mountain Road Alpha Quarry - Aug 2026 - No prices.pdf');
  });
});

describe('project column',()=>{
  it('can hide the Project column of a Loads History',()=>{
    const snapshot={recordType:'supplier_load' as const,recordId:'1',reference:'QP-1',loadNumber:null,loadNumberSeriesName:null,itemKey:'id:sand',itemName:'Sand',unitKey:'m3',unitSymbol:'m³',quantity:8,projectId:'road',projectName:'Hidden Project Name',partyId:'a',partyName:'Alpha Quarry',recordedAt:'2026-08-10T09:30:00',enteredAt:null,unitPriceCents:null,priceBasis:'per_unit' as const,subtotalCents:null,vatRateBasisPoints:null,vatCents:null,totalCents:null,supplierReference:null};
    const records=[{key:'supplier_load:1',snapshot,seriesId:null,status:'Active' as const,cancellationReason:null,correctionCount:0,links:[],inclusion:{state:'not_included' as const}}];
    const input={...base,title:'Loads History',includePrices:false,records,data:{usageHiddenReason:null,usage:[],deliveries:[]}};
    const shown=buildTotalsHtml(input),hidden=buildTotalsHtml({...input,showProject:false});
    const table=(html:string)=>html.slice(html.indexOf('class="grid history"'));
    expect(table(shown)).toContain('<th>Project</th>');
    expect(table(shown)).toContain('Hidden Project Name');
    expect(table(hidden)).not.toContain('<th>Project</th>');
    expect(table(hidden)).not.toContain('Hidden Project Name');
  });
});
