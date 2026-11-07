import {describe,expect,it} from 'vitest';

import {buildCompanyDailyReport,sumAmounts,type DayFill,type DayInput,type DayLoadOut,type DaySupplierLoad} from '../src/domain/companyDailyReport';
import {buildCompanyDailyReportHtml} from '../src/services/companyDailyReportTemplate';
import {companyDailyReportSheets} from '../src/services/companyDailyReportWorkbook';

const DAY='2026-11-06';
const out=(over:Partial<DayLoadOut>={}):DayLoadOut=>({id:'l1',status:'Active',time:`${DAY}T07:40:00`,loadNumber:'ASP-1042',itemName:'Asphalt',unitSymbol:'t',quantity:22,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:'T-12',driverName:'Samir',bitumenKg:1100,bitumenApplies:true,priceBasis:'per_unit',unitPriceCents:6200,amountCents:136400,...over});
const unpriced=(over:Partial<DayLoadOut>={}):DayLoadOut=>out({id:'l2',loadNumber:'ASP-1044',priceBasis:null,unitPriceCents:null,amountCents:null,...over});
const sup=(over:Partial<DaySupplierLoad>={}):DaySupplierLoad=>({id:'s1',status:'Active',time:`${DAY}T06:50:00`,number:'S-231',itemName:'Sand',unitSymbol:'t',quantity:20,supplierName:'Rami Quarry',deliveredBy:'supplier',projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:null,ticket:'T-8841',priceBasis:'per_unit',unitPriceCents:800,amountCents:16000,...over});
const fill=(over:Partial<DayFill>={}):DayFill=>({id:'f1',status:'Active',time:`${DAY}T06:30:00`,givenTo:'Excavator E-3',fuelType:'diesel',operatorName:null,litres:120,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,unitPriceCents:90,amountCents:10800,...over});
const empty:DayInput={loadsOut:[],supplierLoads:[],fills:[],dumps:[]};
const report=(input:Partial<DayInput>)=>buildCompanyDailyReport(DAY,{...empty,...input});
const html=(input:Partial<DayInput>,prices:boolean)=>buildCompanyDailyReportHtml({logo:null,report:report(input),prices});

describe('sumAmounts',()=>{
  it('adds only recorded amounts and counts the unpriced ones, never treating them as zero',()=>{
    expect(sumAmounts([{amountCents:100},{amountCents:null},{amountCents:250},{}])).toEqual({cents:350,priced:2,unpriced:2});
  });
});

describe('Company Daily Report PDF - Prices switch',()=>{
  it('is off by default: no price columns, and the header says quantities only',()=>{
    const off=buildCompanyDailyReportHtml({logo:null,report:report({loadsOut:[out()]})});
    expect(off).toContain('Quantities only, no prices');expect(off).not.toContain('>Price<');expect(off).not.toContain('$62.00');expect(off).not.toContain('1,364.00');
  });
  it('with prices on, the header says prices included and the priced table gets Price and Amount columns',()=>{
    const on=html({loadsOut:[out()]},true);
    expect(on).toContain('Prices included');expect(on).not.toContain('Quantities only, no prices');
    expect(on).toContain('>Price<');expect(on).toContain('>Amount<');expect(on).toContain('$62.00');expect(on).toContain('$1,364.00');
  });
  it('shows Unpriced (never $0.00) for a record without a price and counts it in the total row',()=>{
    const on=html({loadsOut:[out(),unpriced()]},true);
    expect(on).toContain('Unpriced');expect(on).not.toContain('$0.00');expect(on).toContain('1 unpriced');
  });
  it('adds price columns only to tables where at least one price was recorded',()=>{
    const on=html({loadsOut:[out(),out({id:'b',itemName:'Base',unitSymbol:'m³',loadNumber:'B-1',bitumenKg:null,bitumenApplies:false,priceBasis:null,unitPriceCents:null,amountCents:null})]},true);
    expect((on.match(/>Price</g)??[]).length).toBe(1);
  });
  it('shows an as-a-whole price as such, with its amount',()=>{
    const on=html({loadsOut:[out({priceBasis:'whole',unitPriceCents:null,amountCents:50000})]},true);
    expect(on).toContain('As a whole');expect(on).toContain('$500.00');
  });
  it('never adds company loads (sales), supplier loads (purchases) and fuel (cost) into one total',()=>{
    const on=html({loadsOut:[out()],supplierLoads:[sup()],fills:[fill()]},true);
    expect(on).toContain('Company loads value');expect(on).toContain('Supplier loads value');expect(on).toContain('Fuel cost');
    expect(on).not.toContain('$1,632.00');// 1364.00 + 160.00 + 108.00 would be the mixed total
  });
  it('excludes cancelled records from every money figure',()=>{
    const on=html({loadsOut:[out(),out({id:'gone',status:'Cancelled',amountCents:999900})]},true);
    expect(on).not.toContain('9,999.00');
  });
  it('shows fuel price per litre and cost when prices are on, and nothing when off',()=>{
    expect(html({fills:[fill()]},true)).toContain('$0.90');
    expect(html({fills:[fill()]},true)).toContain('$108.00');
    expect(html({fills:[fill()]},false)).not.toContain('$108.00');
  });
});

describe('Company Daily Report workbook - Prices switch',()=>{
  const sheetsFor=(prices:boolean)=>companyDailyReportSheets(report({loadsOut:[out(),unpriced()],supplierLoads:[sup()],fills:[fill()]}),{prices});
  it('has no price columns when prices are off',()=>{
    expect(Object.keys(sheetsFor(false).find(s=>s.name==='Airport Road')!.rows[0]!)).not.toContain('Amount USD');
  });
  it('adds numeric Unit Price, Basis and Amount columns when on, blank (not zero) for an unpriced record',()=>{
    const rows=sheetsFor(true).find(s=>s.name==='Airport Road')!.rows;
    expect(rows.find(r=>r['Record ID']==='l1')).toMatchObject({'Unit Price USD':62,'Price Basis':'Per unit','Amount USD':1364});
    expect(rows.find(r=>r['Record ID']==='l2')).toMatchObject({'Unit Price USD':null,'Amount USD':null});
  });
  it('adds value and unpriced counts to the Summary, per kind and never mixed',()=>{
    const summary=sheetsFor(true).find(s=>s.name==='Summary')!.rows;
    const company=summary.find(r=>r.Section==='Company loads')!;
    expect(company).toMatchObject({'Value USD':1364,'Unpriced Records':1});
    expect(summary.find(r=>r.Section==='Supplier loads')).toMatchObject({'Value USD':160,'Unpriced Records':0});
    expect(summary.find(r=>r.Section==='Fuel given')).toMatchObject({'Value USD':108});
  });
});
