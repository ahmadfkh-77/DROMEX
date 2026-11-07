import {describe,expect,it} from 'vitest';

import {buildCompanyDailyReport,placeMaterials,type DayFill,type DayInput,type DayLoadOut,type DaySupplierLoad,type DayWasteDump} from '../src/domain/companyDailyReport';
import {buildCompanyDailyReportHtml} from '../src/services/companyDailyReportTemplate';
import {companyDailyReportSheets} from '../src/services/companyDailyReportWorkbook';

const DAY='2026-11-06';
const out=(over:Partial<DayLoadOut>={}):DayLoadOut=>({id:'l1',status:'Active',time:`${DAY}T07:40:00`,loadNumber:'ASP-1042',itemName:'Asphalt',unitSymbol:'t',quantity:22,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:'T-12',driverName:'Samir',bitumenKg:1100,bitumenApplies:true,...over});
const base=(over:Partial<DayLoadOut>={}):DayLoadOut=>out({id:'b1',loadNumber:'BAS-1',itemName:'Base',unitSymbol:'m³',quantity:14,bitumenKg:null,bitumenApplies:false,...over});
const sup=(over:Partial<DaySupplierLoad>={}):DaySupplierLoad=>({id:'s1',status:'Active',time:`${DAY}T06:50:00`,number:'S-231',itemName:'Sand',unitSymbol:'t',quantity:20,supplierName:'Rami Quarry',deliveredBy:'supplier',projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:null,ticket:'T-8841',...over});
const fill=(over:Partial<DayFill>={}):DayFill=>({id:'f1',status:'Active',time:`${DAY}T06:30:00`,givenTo:'Excavator E-3',fuelType:'diesel',operatorName:null,litres:120,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,...over});
const dump=(over:Partial<DayWasteDump>={}):DayWasteDump=>({id:'w1',status:'Active',time:`${DAY}T08:00:00`,material:'Soil',area:'North pit',truckPlate:'T-07',driverName:'Omar',projectId:null,projectName:null,siteId:'site1',siteName:'Main Plant',...over});
const empty:DayInput={loadsOut:[],supplierLoads:[],fills:[],dumps:[]};
const html=(input:Partial<DayInput>,logo:string|null='data:image/png;base64,AAA')=>buildCompanyDailyReportHtml({logo,report:buildCompanyDailyReport(DAY,{...empty,...input})});

describe('placeMaterials',()=>{
  it('groups a place by material and unit, with company loads and supplier loads kept apart',()=>{
    const list=placeMaterials({loadsOut:[out(),out({id:'l2'}),base()],supplierLoads:[sup({itemName:'Base',unitSymbol:'m³',quantity:14})]});
    expect(list.map(m=>[m.itemName,m.unitSymbol,m.loadsOut.length,m.supplierLoads.length,m.outQuantity,m.inQuantity])).toEqual([['Asphalt','t',2,0,44,0],['Base','m³',1,1,14,14]]);
  });
  it('adds up bitumen only for asphalt and counts loads that could not be counted',()=>{
    const [asphalt,baseMat]=placeMaterials({loadsOut:[out(),out({id:'l2',bitumenKg:null}),base()],supplierLoads:[]});
    expect([asphalt!.bitumenApplies,asphalt!.bitumenKg,asphalt!.uncountedLoads]).toEqual([true,1100,1]);
    expect([baseMat!.bitumenApplies,baseMat!.bitumenKg]).toEqual([false,null]);
  });
});

describe('Company Daily Report PDF',()=>{
  const full=html({loadsOut:[out(),base()],supplierLoads:[sup()],fills:[fill()],dumps:[dump(),dump({id:'w2',time:`${DAY}T10:30:00`})]});
  it('has the issuing company logo and only the title, with no company name or contact lines',()=>{
    expect(full).toContain('<img class="logo" src="data:image/png;base64,AAA"');expect(full).toContain('Company Daily Report');
    expect(full).not.toContain('class="contact"');
  });
  it('states the date and that it is quantities only',()=>{expect(full).toContain('6 November 2026');expect(full).toContain('Quantities only, no prices');});
  it('prints one block per place, in order, with each material in its own table',()=>{
    expect(full.indexOf('Airport Road')).toBeLessThan(full.indexOf('Main Plant'));
    expect(full).toContain('Asphalt (t)');expect(full).toContain('Base (m³)');expect(full).toContain('Sand (t)');
    expect(full).toContain('Total asphalt, company loads');expect(full).toContain('Total sand, supplier loads');
  });
  it('shows the Bitumen used column only in the asphalt table',()=>{
    expect((full.match(/Bitumen used<\/th>/g)??[]).length).toBe(1);expect(full).toContain('1,100 kg');
  });
  it('shows "not counted" for an asphalt load whose bitumen could not be worked out',()=>{
    expect(html({loadsOut:[out({bitumenKg:null})]})).toContain('not counted');
  });
  it('groups waste dumps into one row with a time range and a trip count',()=>{
    expect(full).toContain('08:00-10:30');expect(full).toContain('2 trips');
  });
  it('ends with separate Company loads, Supplier loads and Fuel given total tables',()=>{
    const totals=full.slice(full.lastIndexOf('Totals by material'));
    expect(totals).toContain('Company loads');expect(totals).toContain('Supplier loads');expect(totals).toContain('Fuel given');
  });
  it('prints no sections and no zero figures for what was not recorded',()=>{
    const onlyFuel=html({fills:[fill()]});
    expect(onlyFuel).not.toContain('Supplier loads');expect(onlyFuel).not.toContain('Waste');expect(onlyFuel).not.toContain('Bitumen');expect(onlyFuel).not.toContain('>0 ');
    expect(onlyFuel).toContain('Fuel given');
  });
  it('leaves cancelled records out',()=>{expect(html({loadsOut:[out({status:'Cancelled',loadNumber:'ASP-GONE'})],fills:[fill()]})).not.toContain('ASP-GONE');});
  it('says nothing was recorded when the day is empty',()=>{expect(html({})).toContain('Nothing was recorded on this day');});
  it('escapes record text so a name cannot break the page',()=>{expect(html({loadsOut:[out({driverName:'<b>x</b>'})]})).not.toContain('<b>x</b>');});
  it('repeats table headings and prints the page footer',()=>{expect(full).toContain('thead{display:table-header-group}');expect(full).toContain('counter(page)');});
});

describe('Supplier loads: who drove',()=>{
  const company=(driverName:string|null,id='s2')=>sup({id,deliveredBy:'company',driverName,truckPlate:'M355965'});
  it('prints the name of the driver of a supplier load our company delivered, never "Our driver"',()=>{
    const page=html({supplierLoads:[company('Ali Nasser'),company('Omar Haddad','s3')]});
    expect(page).toContain('Ali Nasser');expect(page).toContain('Omar Haddad');expect(page).not.toContain('Our driver');
  });
  it('still says Supplier delivering when the supplier brought it, and a dash when our driver has no recorded name',()=>{
    const page=html({supplierLoads:[sup({deliveredBy:'supplier'}),company(null,'s4')]});
    expect(page).toContain('Supplier delivering');expect(page).not.toContain('Our driver');
  });
  it('puts the driver name in the Driver column of the workbook',()=>{
    const rows=companyDailyReportSheets(buildCompanyDailyReport(DAY,{...empty,supplierLoads:[company('Ali Nasser')]})).find(s=>s.name==='Airport Road')!.rows;
    expect(rows[0]).toMatchObject({Driver:'Ali Nasser','Delivered By':'Our driver'});
  });
});

describe('Record tables fill the whole width',()=>{
  const sums=(page:string)=>[...page.matchAll(/<table class="rec"><colgroup>(.*?)<\/colgroup>/g)].map(m=>[...m[1]!.matchAll(/width:(\d+)%/g)].reduce((a,b)=>a+Number(b[1]),0));
  const input={loadsOut:[out(),base()],supplierLoads:[sup()],fills:[fill()],dumps:[dump()]};
  it('every record table adds up to 100% of its box, so there is no empty strip on the right',()=>{
    const widths=sums(html(input));expect(widths.length).toBeGreaterThan(3);for(const w of widths)expect(w).toBe(100);
  });
  it('does the same with prices on',()=>{
    const priced=buildCompanyDailyReportHtml({logo:null,prices:true,report:buildCompanyDailyReport(DAY,{...empty,loadsOut:[out({priceBasis:'per_unit',unitPriceCents:6200,amountCents:136400}),base()],supplierLoads:[sup()],fills:[fill()],dumps:[dump()]})});
    const widths=sums(priced);expect(widths.length).toBeGreaterThan(3);for(const w of widths)expect(w).toBe(100);
  });
  it('keeps the first five columns the same width in every table so they line up',()=>{
    const firstFive=[...html(input).matchAll(/<table class="rec"><colgroup>(.*?)<\/colgroup>/g)].map(m=>[...m[1]!.matchAll(/width:(\d+)%/g)].slice(0,5).map(x=>x[1]).join(','));
    expect(new Set(firstFive).size).toBe(1);
  });
});

describe('Fuel given uses the Daily Report fuel structure',()=>{
  const fuelOnly=html({fills:[fill({givenTo:'M355965',equipmentType:'truck'}),fill({id:'f2',givenTo:'Excavator E-3',equipmentType:'machine',litres:80})]});
  const table=fuelOnly.slice(fuelOnly.indexOf('Fuel given'));
  it('has Time, Equipment, Truck or machine, Fuel type and Litres, and none of the load columns',()=>{
    for(const heading of ['>Time<','>Equipment<','>Truck or machine<','>Fuel type<','>Litres<'])expect(table).toContain(heading);
    for(const gone of ['>Load no.<','>Details<','>Driver<'])expect(table.slice(0,table.indexOf('Total fuel given'))).not.toContain(gone);
  });
  it('says Truck or Machine for each fill, from the fuel record',()=>{
    expect(table).toContain('>Truck<');expect(table).toContain('>Machine<');expect(table).toContain('M355965');expect(table).toContain('Excavator E-3');
  });
  it('shows a dash when the record does not say, and puts the type in the workbook',()=>{
    expect(html({fills:[fill({equipmentType:null})]})).toContain('<span dir="auto">-</span>');
    const rows=companyDailyReportSheets(buildCompanyDailyReport(DAY,{...empty,fills:[fill({equipmentType:'machine'})]})).find(s=>s.name==='Airport Road')!.rows;
    expect(rows[0]).toMatchObject({'Record Type':'Fuel given','Equipment Type':'Machine',Details:'Excavator E-3'});
  });
});
