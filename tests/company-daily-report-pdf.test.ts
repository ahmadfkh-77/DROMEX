import {describe,expect,it} from 'vitest';

import {buildCompanyDailyReport,placeMaterials,type DayFill,type DayInput,type DayLoadOut,type DaySupplierLoad,type DayWasteDump} from '../src/domain/companyDailyReport';
import {buildCompanyDailyReportHtml} from '../src/services/companyDailyReportTemplate';

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
