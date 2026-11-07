import {describe,expect,it} from 'vitest';

import {buildCompanyDailyReport,type DayFill,type DayInput,type DayLoadOut,type DaySupplierLoad,type DayWasteDump} from '../src/domain/companyDailyReport';
import {buildWorkbookFromSheets} from '../src/services/businessWorkbook';
import {companyDailyReportSheets} from '../src/services/companyDailyReportWorkbook';

const DAY='2026-11-06';
const out=(over:Partial<DayLoadOut>={}):DayLoadOut=>({id:'l1',status:'Active',time:`${DAY}T07:40:00`,loadNumber:'ASP-1042',itemName:'Asphalt',unitSymbol:'t',quantity:22,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:'T-12',driverName:'Samir',bitumenKg:1100,bitumenApplies:true,...over});
const base=(over:Partial<DayLoadOut>={}):DayLoadOut=>out({id:'b1',loadNumber:'BAS-1',itemName:'Base',unitSymbol:'m³',quantity:14,bitumenKg:null,bitumenApplies:false,...over});
const sup=(over:Partial<DaySupplierLoad>={}):DaySupplierLoad=>({id:'s1',status:'Active',time:`${DAY}T06:50:00`,number:'S-231',itemName:'Sand',unitSymbol:'t',quantity:20,supplierName:'Rami Quarry',deliveredBy:'supplier',projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:null,ticket:'T-8841',...over});
const fill=(over:Partial<DayFill>={}):DayFill=>({id:'f1',status:'Active',time:`${DAY}T06:30:00`,givenTo:'Excavator E-3',fuelType:'diesel',operatorName:null,litres:120,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,...over});
const dump=(over:Partial<DayWasteDump>={}):DayWasteDump=>({id:'w1',status:'Active',time:`${DAY}T08:00:00`,material:'Soil',area:'North pit',truckPlate:'T-07',driverName:'Omar',projectId:null,projectName:null,siteId:'site1',siteName:'Main Plant',...over});
const empty:DayInput={loadsOut:[],supplierLoads:[],fills:[],dumps:[]};
const sheets=(input:Partial<DayInput>)=>companyDailyReportSheets(buildCompanyDailyReport(DAY,{...empty,...input}));
const full=()=>sheets({loadsOut:[out(),out({id:'l2',quantity:22,bitumenKg:null}),base()],supplierLoads:[sup()],fills:[fill()],dumps:[dump()]});

describe('Company Daily Report workbook',()=>{
  it('has a Summary sheet, one sheet per place that has records, and a data dictionary',()=>{
    expect(full().map(s=>s.name)).toEqual(['Summary','Airport Road','Main Plant','Data Dictionary']);
  });
  it('keeps numbers as real numbers with the unit in its own column, so the sheet can be summed',()=>{
    const airport=full().find(s=>s.name==='Airport Road')!;
    const first=airport.rows.find(r=>r['Record ID']==='l1')!;
    expect(first.Quantity).toBe(22);expect(first.Unit).toBe('t');expect(first.Material).toBe('Asphalt');expect(first['Bitumen Used kg']).toBe(1100);
  });
  it('leaves Bitumen Used blank (not a dash, not zero) for non-asphalt rows and for loads that could not be counted',()=>{
    const airport=full().find(s=>s.name==='Airport Road')!;
    expect(airport.rows.find(r=>r['Record ID']==='b1')!['Bitumen Used kg']).toBeNull();
    expect(airport.rows.find(r=>r['Record ID']==='l2')!['Bitumen Used kg']).toBeNull();
  });
  it('lists company loads, supplier loads, fuel and waste dumps as separate record types',()=>{
    const types=new Set([...full().find(s=>s.name==='Airport Road')!.rows,...full().find(s=>s.name==='Main Plant')!.rows].map(r=>r['Record Type']));
    expect([...types].sort()).toEqual(['Company load','Fuel given','Supplier load','Waste dump']);
  });
  it('summarises per material and unit without adding units together',()=>{
    const summary=sheets({loadsOut:[base(),base({id:'b2',unitSymbol:'t',quantity:10})]}).find(s=>s.name==='Summary')!;
    const rows=summary.rows.filter(r=>r.Section==='Company loads');
    expect(rows.map(r=>[r.Material,r.Unit,r.Records,r.Amount])).toEqual([['Base','m³',1,14],['Base','t',1,10]]);
  });
  it('carries the date and only the key figures that exist in the Summary',()=>{
    const summary=sheets({fills:[fill()]}).find(s=>s.name==='Summary')!;
    const figures=summary.rows.filter(r=>r.Section==='Key figure');
    expect(figures).toHaveLength(1);expect(figures[0]).toMatchObject({Date:DAY,Material:'Fuel given',Amount:120,Unit:'litres'});
  });
  it('prints no section, no sheet and no zero row for what was not recorded',()=>{
    const list=sheets({fills:[fill()]});
    expect(list.map(s=>s.name)).toEqual(['Summary','Airport Road','Data Dictionary']);
    expect(list.find(s=>s.name==='Summary')!.rows.some(r=>r.Section==='Supplier loads'||r.Section==='Company loads')).toBe(false);
  });
  it('excludes cancelled records',()=>{
    const list=sheets({loadsOut:[out({status:'Cancelled'})],fills:[fill()]});
    expect(JSON.stringify(list)).not.toContain('ASP-1042');
  });
  it('gives each place sheet a legal, unique Excel name (31 characters, no forbidden characters)',()=>{
    const names=sheets({loadsOut:[out({projectId:'a',projectName:'Airport/Road: [Phase 1] very long project name here'}),out({id:'x',projectId:'b',projectName:'Airport/Road: [Phase 1] very long project name there'})]}).map(s=>s.name);
    expect(new Set(names).size).toBe(names.length);
    for(const name of names){expect(name.length).toBeLessThanOrEqual(31);expect(name).not.toMatch(/[\\/?*[\]:]/);}
  });
  it('builds a real workbook file from the sheets',()=>{
    const bytes=buildWorkbookFromSheets(full());expect(bytes.length).toBeGreaterThan(500);expect(String.fromCharCode(bytes[0]!,bytes[1]!)).toBe('PK');
  });
});
