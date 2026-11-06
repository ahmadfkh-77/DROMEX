import {describe,expect,it} from 'vitest';

import {
  buildCompanyDailyReport,homeFigures,localDay,localTime,materialView,
  type DayFill,type DayLoadOut,type DaySupplierLoad,type DayWasteDump,
} from '../src/domain/companyDailyReport';

const DAY='2026-11-06';
const out=(over:Partial<DayLoadOut>={}):DayLoadOut=>({
  id:'l1',status:'Active',time:`${DAY}T07:40:00`,loadNumber:'ASP-1042',itemName:'Asphalt',unitSymbol:'t',quantity:22,
  projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:'T-12',driverName:'Samir',bitumenKg:1100,...over});
const supplier=(over:Partial<DaySupplierLoad>={}):DaySupplierLoad=>({
  id:'s1',status:'Active',time:`${DAY}T06:50:00`,number:'S-231',itemName:'Sand',unitSymbol:'t',quantity:20,supplierName:'Rami Quarry',
  deliveredBy:'supplier',projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:null,ticket:'T-8841',...over});
const fill=(over:Partial<DayFill>={}):DayFill=>({
  id:'f1',status:'Active',time:`${DAY}T06:30:00`,givenTo:'Excavator E-3',fuelType:'diesel',operatorName:'Hadi',litres:120,
  projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,...over});
const dump=(over:Partial<DayWasteDump>={}):DayWasteDump=>({
  id:'w1',status:'Active',time:`${DAY}T08:00:00`,material:'Soil',area:'North pit',truckPlate:'T-07',driverName:'Omar',
  projectId:null,projectName:null,siteId:'site1',siteName:'Main Plant',...over});
const empty={loadsOut:[],supplierLoads:[],fills:[],dumps:[]};

describe('Company Daily Report - what was recorded',()=>{
  it('shows nothing at all for a day with no records: no places, no tiles, no totals',()=>{
    const report=buildCompanyDailyReport(DAY,empty);
    expect(report.places).toEqual([]);expect(report.tiles).toEqual([]);expect(report.materials).toEqual([]);expect(report.isEmpty).toBe(true);
  });
  it('leaves cancelled records out everywhere',()=>{
    const report=buildCompanyDailyReport(DAY,{loadsOut:[out({id:'a'}),out({id:'b',status:'Cancelled'})],supplierLoads:[supplier({status:'Cancelled'})],fills:[fill({status:'Cancelled'})],dumps:[dump({status:'Cancelled'})]});
    expect(report.places).toHaveLength(1);expect(report.places[0]!.loadsOut).toHaveLength(1);
    expect(report.places[0]!.supplierLoads).toEqual([]);expect(report.places[0]!.fills).toEqual([]);
    expect(report.tiles.map(t=>t.key)).toEqual(['loadsOut']);
  });
  it('lists a place only for the record kinds it has, and never an empty section',()=>{
    const report=buildCompanyDailyReport(DAY,{...empty,fills:[fill()]});
    expect(report.places.map(p=>p.name)).toEqual(['Airport Road']);
    expect(report.places[0]!.sections).toEqual(['fills']);
  });
  it('puts projects first (by name), then company sites, then No project or site',()=>{
    const report=buildCompanyDailyReport(DAY,{loadsOut:[out({id:'1',projectId:null,projectName:null}),out({id:'2',projectId:'p2',projectName:'Beirut Wall'}),out({id:'3'})],supplierLoads:[],fills:[],dumps:[dump()]});
    expect(report.places.map(p=>p.name)).toEqual(['Airport Road','Beirut Wall','Main Plant','No project or site']);
    expect(report.places.map(p=>p.kind)).toEqual(['project','project','site','none']);
  });
  it('orders records inside a place by time',()=>{
    const report=buildCompanyDailyReport(DAY,{...empty,loadsOut:[out({id:'late',time:`${DAY}T09:00:00`}),out({id:'early',time:`${DAY}T07:00:00`})]});
    expect(report.places[0]!.loadsOut.map(l=>l.id)).toEqual(['early','late']);
  });
});

describe('Company Daily Report - totals',()=>{
  it('counts only what exists in the tiles and sums fuel in litres',()=>{
    const report=buildCompanyDailyReport(DAY,{loadsOut:[out({id:'a'}),out({id:'b'})],supplierLoads:[],fills:[fill({litres:120}),fill({id:'f2',litres:90})],dumps:[dump()]});
    expect(report.tiles).toEqual([{key:'loadsOut',value:2,unit:null},{key:'fuel',value:210,unit:'L'},{key:'waste',value:1,unit:null}]);
  });
  it('never adds different units together: one material row per item and unit',()=>{
    const report=buildCompanyDailyReport(DAY,{...empty,loadsOut:[out({id:'a',itemName:'Base',unitSymbol:'t',quantity:10,bitumenKg:null}),out({id:'b',itemName:'Base',unitSymbol:'m³',quantity:14,bitumenKg:null})]});
    const base=report.materials.filter(m=>m.itemName==='Base');
    expect(base.map(m=>[m.unitSymbol,m.outQuantity])).toEqual([['m³',14],['t',10]]);
  });
  it('totals delivered out and arrived in separately for the same material',()=>{
    const report=buildCompanyDailyReport(DAY,{...empty,loadsOut:[out({itemName:'Sand',unitSymbol:'t',quantity:5,bitumenKg:null})],supplierLoads:[supplier({quantity:20})]});
    const sand=report.materials.find(m=>m.itemName==='Sand')!;
    expect([sand.outLoads,sand.outQuantity,sand.inLoads,sand.inQuantity]).toEqual([1,5,1,20]);
  });
  it('sums the bitumen used by asphalt loads and keeps unknown ("-") loads out of the total',()=>{
    const report=buildCompanyDailyReport(DAY,{...empty,loadsOut:[out({id:'a',bitumenKg:1100}),out({id:'b',bitumenKg:null,bitumenApplies:true}),out({id:'c',bitumenKg:800})]});
    expect(report.materials[0]!.bitumenKg).toBe(1900);expect(report.bitumenKg).toBe(1900);
    expect(report.places[0]!.loadsOut.map(l=>l.bitumenKg)).toEqual([1100,null,800]);
  });
  it('has no bitumen figure when no asphalt load has one',()=>{
    const report=buildCompanyDailyReport(DAY,{...empty,loadsOut:[out({bitumenKg:null,bitumenApplies:false})]});
    expect(report.bitumenKg).toBeNull();expect(report.materials[0]!.bitumenKg).toBeNull();
  });
});

describe('Company Daily Report - by material',()=>{
  const report=buildCompanyDailyReport(DAY,{
    loadsOut:[out({id:'a'}),out({id:'b',projectId:'p2',projectName:'Beirut Wall'}),out({id:'c',itemName:'Base',unitSymbol:'t',bitumenKg:null})],
    supplierLoads:[supplier({itemName:'Asphalt',quantity:40})],fills:[],dumps:[]});
  it('lists every record of one material and unit, grouped by place, with load counts and quantities',()=>{
    const view=materialView(report,'Asphalt','t')!;
    expect(view.outLoads).toBe(2);expect(view.outQuantity).toBe(44);expect(view.inLoads).toBe(1);expect(view.inQuantity).toBe(40);
    expect(view.places.map(p=>[p.name,p.loadsOut.length,p.supplierLoads.length])).toEqual([['Airport Road',1,1],['Beirut Wall',1,0]]);
  });
  it('returns null for a material nobody moved that day',()=>{expect(materialView(report,'Gravel','t')).toBeNull();});
});

describe('Company Daily Report - dates and Home figures',()=>{
  it('uses the local day and time of a record',()=>{
    expect(localDay('2026-11-06T07:40:00')).toBe('2026-11-06');expect(localTime('2026-11-06T07:40:00')).toBe('07:40');
  });
  it('shows no zero figure on Home: only what exists today',()=>{
    expect(homeFigures(buildCompanyDailyReport(DAY,empty))).toEqual([]);
    expect(homeFigures(buildCompanyDailyReport(DAY,{...empty,fills:[fill({litres:820})]}))).toEqual([{key:'fuel',value:820,unit:'L'}]);
  });
});
