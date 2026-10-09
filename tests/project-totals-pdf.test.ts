import {afterEach,describe,expect,it} from 'vitest';

import {SqliteCompanyTotalsRepository} from '../src/data/repositories/SqliteCompanyTotalsRepository';
import type {CompanyTotalsRecord} from '../src/data/repositories/CompanyTotalsRepository';
import type {RecordSnapshot} from '../src/domain/businessDocuments';
import {emptyInclusion,emptyCompanyTotalsFilters,type CompanyTotalsData} from '../src/domain/companyTotals';
import {LEGACY_LOAD_NUMBER_LABEL} from '../src/domain/loadNumberSeries';
import {companyContactLine,companyLoadReference,customerBox,deliveredByLabel,priceAsRecorded,supplierBox,unitTotals,vatAndTotal} from '../src/domain/projectTotalsPdf';
import {buildTotalsHtml} from '../src/services/totalsTemplate';
import {type SqliteTestDatabase} from './support/sqliteTestDatabase';
import {recordsDatabase} from './support/recordFixtures';

/** Project Totals PDF: the Customer and Supplier boxes and the delivered-loads sections (Owner-approved mockup). */
const snapshot=(over:Partial<RecordSnapshot>):RecordSnapshot=>({
  recordType:'company_load',recordId:'r1',reference:'20261005-A-00123',loadNumber:'ASP-00001',loadNumberSeriesName:'Asphalt',itemKey:'id:asphalt',itemName:'Asphalt, Base Course',unitKey:'t',unitSymbol:'t',quantity:18.5,
  projectId:'p1',projectName:'Highway Link',partyId:'c1',partyName:'Al Amal Contracting',recordedAt:'2026-10-05T09:05:00',enteredAt:null,unitPriceCents:8200,priceBasis:'per_unit',subtotalCents:151700,
  vatRateBasisPoints:1100,vatCents:16687,totalCents:168387,supplierReference:null,...over});
const record=(over:Partial<RecordSnapshot>,extra:Partial<CompanyTotalsRecord>={}):CompanyTotalsRecord=>({key:`k:${over.recordId??'r1'}`,snapshot:snapshot(over),seriesId:null,status:'Active',cancellationReason:null,correctionCount:0,links:[],inclusion:{...emptyInclusion()} as never,
  details:{destination:'Zahle, km 12',driverName:'R. Haddad',truckPlate:'112233',deliveredBy:null},...extra});

const company1=record({recordId:'c1'});
const company2=record({recordId:'c2',reference:'20261005-A-00124',loadNumber:'ASP-00002',quantity:18,recordedAt:'2026-10-05T10:15:00',unitPriceCents:null,totalCents:null,vatCents:null},{details:{destination:null,driverName:'K. Nasr',truckPlate:'445566',deliveredBy:null}});
const legacy=record({recordId:'c0',reference:'20260612-A-00041',loadNumber:null,loadNumberSeriesName:null,itemName:'Asphalt, Binder',quantity:20,recordedAt:'2026-06-12T14:20:00'});
const arabic=record({recordId:'c3',reference:'20261005-A-00125',loadNumber:'AGG-00003',loadNumberSeriesName:'Aggregates',itemName:'Sand',unitKey:'m3',unitSymbol:'m³',quantity:12,partyName:'شركة النور للمقاولات',recordedAt:'2026-10-05T11:40:00'});
const supplierA=record({recordId:'s1',recordType:'supplier_load',reference:'SL-000212',loadNumber:null,loadNumberSeriesName:null,itemName:'Gravel 3/4',partyName:'Saad Quarry',quantity:22,supplierReference:'T-4471',recordedAt:'2026-10-03T07:50:00'},{details:{destination:null,driverName:'M. Saad',truckPlate:'778899',deliveredBy:'supplier'}});
const supplierB=record({recordId:'s2',recordType:'supplier_load',reference:'SL-000214',loadNumber:null,loadNumberSeriesName:null,itemName:'Gravel 3/4',partyName:'محاجر الشمال',quantity:18,recordedAt:'2026-10-04T08:30:00'},{details:{destination:null,driverName:'K. Nasr',truckPlate:'445566',deliveredBy:'company'}});
const cancelled=record({recordId:'x1',reference:'20261005-A-00126',loadNumber:'ASP-00003',quantity:17.5},{status:'Cancelled',cancellationReason:'wrong destination'});

const data:CompanyTotalsData={usageHiddenReason:null,deliveries:[],usage:[]};
const base={companyName:'DROMEX Asphalt Co.',logo:null,title:'Project Totals',scope:'project' as const,filters:['1 Sep 2026 to 5 Oct 2026'],generatedAt:'2026-10-05T16:30:00',data,
  contactLine:'Beirut, Lebanon · +961 1 234 567 · info@dromex.example · Tax/VAT: 1234567-001'};
const project=(loads:CompanyTotalsRecord[],customer=customerBox({name:'Al Amal Contracting',isOwnCompany:false}))=>({name:'Highway Link',location:'Zahle',status:'Active',customer,loads});

describe('Customer and Supplier boxes',()=>{
  it('names the customer, or says Internal project for the own company, or Not recorded',()=>{
    expect(customerBox({name:'Al Amal Contracting',isOwnCompany:false})).toEqual({label:'Al Amal Contracting',note:null});
    expect(customerBox({name:'DROMEX Asphalt Co.',isOwnCompany:true}).label).toBe('Internal project');
    expect(customerBox(null).label).toBe('Not recorded');
    expect(customerBox({name:'  ',isOwnCompany:false}).label).toBe('Not recorded');
  });
  it('names one supplier, lists several with a count, and says None in this period',()=>{
    expect(supplierBox([company1,supplierA])).toEqual({label:'Saad Quarry',names:[]});
    expect(supplierBox([supplierA,supplierB,supplierA])).toEqual({label:'Multiple suppliers (2)',names:['Saad Quarry','محاجر الشمال']});
    expect(supplierBox([company1,company2])).toEqual({label:'None in this period',names:[]});
    expect(supplierBox([])).toEqual({label:'None in this period',names:[]});
  });
});

describe('row wording helpers',()=>{
  it('writes the price as recorded and never a false zero',()=>{
    expect(priceAsRecorded(company1.snapshot)).toBe('$82.00 per t');
    expect(priceAsRecorded({...company1.snapshot,priceBasis:'whole'})).toBe('$82.00 for the whole delivery');
    expect(priceAsRecorded(company2.snapshot)).toBe('No price recorded');
    expect(vatAndTotal(company1.snapshot)).toBe('VAT 11% · $1,683.87');
    expect(vatAndTotal({totalCents:5000,vatRateBasisPoints:null})).toBe('$50.00');
    expect(vatAndTotal(company2.snapshot)).toBe('Not recorded');
  });
  it('says who delivered, and Not recorded when nothing is known',()=>{
    expect(deliveredByLabel({driverName:'R. Haddad',truckPlate:'112233',deliveredBy:null})).toEqual({main:'R. Haddad',sub:'112233'});
    expect(deliveredByLabel({driverName:null,truckPlate:'778899',deliveredBy:'supplier'})).toEqual({main:'Supplier delivering',sub:'Plate 778899'});
    expect(deliveredByLabel({driverName:null,truckPlate:null,deliveredBy:null}).main).toBe('Not recorded');
    expect(deliveredByLabel(undefined).main).toBe('Not recorded');
  });
  it('totals each unit on its own',()=>{
    expect(unitTotals([company1,company2,arabic])).toEqual([{unitKey:'m3',unitSymbol:'m³',quantity:12,count:1},{unitKey:'t',unitSymbol:'t',quantity:36.5,count:2}]);
  });
});

describe('Project Totals PDF',()=>{
  const loads=[company1,company2,legacy,arabic,supplierA,supplierB,cancelled];
  const plain=buildTotalsHtml({...base,includePrices:false,project:project(loads)});
  const priced=buildTotalsHtml({...base,includePrices:true,project:project(loads)});

  it('heads the page with the Company Settings contact line and the customer',()=>{
    expect(plain).toContain('DROMEX Asphalt Co.');
    expect(plain).toContain('Beirut, Lebanon · +961 1 234 567 · info@dromex.example · Tax/VAT: 1234567-001');
    expect(plain).toContain('Customer: <span dir="auto">Al Amal Contracting</span>');
    expect(plain).toContain('border-bottom:2px solid #C84B31');
  });
  it('shows the two boxes, the project row, and several suppliers by name',()=>{
    expect(plain).toContain('class="two"');
    expect(plain).toContain('Multiple suppliers (2)');
    expect(plain).toContain('Saad Quarry');
    expect(plain).toContain('محاجر الشمال');
    expect(plain).toContain('Highway Link');
    expect(plain).toContain('Zahle');
  });
  it('reads Internal project on the own company and None in this period without suppliers',()=>{
    const html=buildTotalsHtml({...base,includePrices:false,project:project([company1],customerBox({name:'DROMEX Asphalt Co.',isOwnCompany:true}))});
    expect(html).toContain('<div class="subtitle"><span dir="auto">Internal project</span></div>');
    expect(html).toContain('None in this period');
    expect(html).not.toContain('Supplier loads delivered');
  });
  it('keeps company loads and supplier loads in separate labelled sections',()=>{
    expect(plain).toContain('Company loads delivered · own deliveries');
    expect(plain).toContain('Supplier loads delivered · incoming from suppliers');
    expect(plain.indexOf('Company loads delivered · own')).toBeLessThan(plain.indexOf('Supplier loads delivered · incoming'));
    expect(plain).toContain('SL-000212');
    expect(plain).toContain('T-4471');
    expect(plain).toContain('Supplier delivering');
    expect(plain).toContain('778899');
  });
  it('lists each load with its load number next to its transaction number, in separate Supplier, Customer, Driver and Truck plate columns',()=>{
    for(const text of ['ASP-00001','20261005-A-00123','Transaction 20261005-A-00123','ASP series','R. Haddad','112233','AGG-00003','شركة النور للمقاولات','Plant Company'])expect(plain).toContain(text);
    expect(plain).toContain('<th>Supplier</th><th>Customer</th><th>Driver</th><th>Truck plate</th><th>Unit</th><th class="num">Quantity</th>');
    expect(plain).not.toContain('Supplier or customer');
    expect(plain).toContain('<td class="num">18.5</td>');
    expect(plain).toContain('<td>t</td>');
  });
  it('labels a load with no generated number as legacy and never invents one',()=>{
    expect(plain).toContain(LEGACY_LOAD_NUMBER_LABEL);
    expect(plain).toContain('20260612-A-00041');
  });
  it('says Not recorded for a missing destination, and keeps units apart in each section total',()=>{
    expect(plain).toContain('<span class="missing">Not recorded</span>');
    expect(plain).toContain('56.5 t');
    expect(plain).toContain('12 m³');
    expect(plain).not.toContain('68.5');
  });
  it('never lists a cancelled load',()=>{
    expect(plain).not.toContain('ASP-00003');
    expect(plain).not.toContain('20261005-A-00126');
    expect(plain).not.toContain('CANCELLED');
  });
  it('leaves every amount, price and VAT off without prices',()=>{
    expect(plain).not.toMatch(/\$\d/);
    expect(plain).not.toContain('Price as recorded');
    expect(plain).not.toContain('VAT 11%');
    expect(plain).not.toContain('VAT ·');
  });
  it('adds only the recorded price and VAT columns with prices, and never a false zero',()=>{
    expect(priced).toContain('Price as recorded');
    expect(priced).toContain('$82.00 per t');
    expect(priced).toContain('VAT 11% · $1,683.87');
    expect(priced).toContain('No price recorded');
    expect(priced).not.toContain('$0.00');
  });
  it('marks text direction, repeats headings, and fits long names',()=>{
    expect(plain).toContain('dir="auto">شركة النور للمقاولات');
    expect(plain).toContain('thead{display:table-header-group}');
    expect(plain).toContain('overflow-wrap:anywhere');
  });
  it('is not an invoice and changes no document status',()=>{
    expect(plain).toContain('not an invoice or bill');
  });
  it('leaves out an empty section and prints no customer boxes outside a project',()=>{
    const onlySupplier=buildTotalsHtml({...base,includePrices:false,project:project([supplierA])});
    expect(onlySupplier).not.toContain('Company loads delivered');
    expect(onlySupplier).toContain('Supplier loads delivered');
    const company=buildTotalsHtml({...base,title:'Company Totals',scope:'company',includePrices:false});
    expect(company).not.toContain('class="two"');
    expect(company).not.toContain('Company loads delivered');
  });
});

describe('record details from the database',()=>{
  const databases:SqliteTestDatabase[]=[];
  afterEach(()=>{for(const database of databases.splice(0))database.close();});
  it('returns destination, driver, truck and delivery method with each Active record, and nothing changes',async()=>{
    const fixture=await recordsDatabase(databases);
    fixture.companyLoad('sand',{project:'road',quantity:10,unit:'t',loadNumber:'AGG-00001'});
    fixture.supplierLoad('sand',{supplier:'sup_a',project:'road',quantity:8,unit:'m³'});
    const before=fixture.db.raw.prepare("SELECT COUNT(*) n FROM loads").get() as {n:number};
    const records=await new SqliteCompanyTotalsRepository(fixture.db as never).listRecords({...emptyCompanyTotalsFilters(),projectKey:'road'});
    expect(records.length).toBe(2);
    for(const entry of records){
      expect(entry.details).toBeDefined();
      expect(entry.details!.driverName).not.toBe('');
      expect(entry.details!.truckPlate).not.toBe('');
    }
    expect(records.find(entry=>entry.snapshot.recordType==='supplier_load')!.details!.deliveredBy).toBe('supplier');
    expect(records.find(entry=>entry.snapshot.recordType==='company_load')!.details!.deliveredBy).toBeNull();
    expect((fixture.db.raw.prepare('SELECT COUNT(*) n FROM loads').get() as {n:number}).n).toBe(before.n);
  });
});

describe('company contact line',()=>{
  it('joins address, phone, email and Tax/VAT in that order and skips what is not saved',()=>{
    expect(companyContactLine({address:'Beirut',phone:'+961 1 234 567',email:'info@dromex.example',taxVatNumber:'1234567-001'})).toBe('Beirut · +961 1 234 567 · info@dromex.example · Tax/VAT: 1234567-001');
    expect(companyContactLine({address:null,phone:' +961 1 ',email:null,taxVatNumber:'  '})).toBe('+961 1');
    expect(companyContactLine({address:null,phone:null,email:null,taxVatNumber:null})).toBeNull();
  });
});

describe('company load reference',()=>{
  it('shows the prefix of the saved number as the series, and just the transaction for a legacy load',()=>{
    expect(companyLoadReference({reference:'20261005-A-00123',loadNumber:'ASP-00001'})).toBe('Transaction 20261005-A-00123 · ASP series');
    expect(companyLoadReference({reference:'20261005-A-00125',loadNumber:'AGG-00003'})).toBe('Transaction 20261005-A-00125 · AGG series');
    expect(companyLoadReference({reference:'20261005-A-00130',loadNumber:'ASP-2026-001'})).toBe('Transaction 20261005-A-00130 · ASP-2026 series');
    expect(companyLoadReference({reference:'20260612-A-00041',loadNumber:null})).toBe('Transaction 20260612-A-00041');
  });
});
