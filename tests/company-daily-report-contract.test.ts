import {describe,expect,it} from 'vitest';

import {dailyContractTargetTable,type ContractAdjustment,type ContractDayEntry,type ContractItem,type ContractLoad} from '../src/domain/contractQuantities';
import {applyContractSwitches,buildCompanyDailyReport,type DayInput,type DayLoadOut} from '../src/domain/companyDailyReport';
import {buildCompanyDailyReportHtml} from '../src/services/companyDailyReportTemplate';
import {companyDailyReportSheets} from '../src/services/companyDailyReportWorkbook';

const DAY='2026-11-06';
const item=(over:Partial<ContractItem>={}):ContractItem=>({id:'c1',projectId:'p1',name:'Asphalt',unitId:'t',unitSymbol:'t',quantity:1000,unitPriceUsd:null,materialIds:['m1'],status:'in_progress',completedOn:null,cancelledAt:null,...over});
const load=(over:Partial<ContractLoad>={}):ContractLoad=>({id:'x1',source:'company',reference:'ASP-1',materialId:'m1',unitId:'t',unitSymbol:'t',quantity:22,date:DAY,status:'Active',contractItemId:'c1',...over});
const adjustment=(over:Partial<ContractAdjustment>={}):ContractAdjustment=>({id:'a1',contractItemId:'c1',amount:10,reason:'recount',createdAt:'2026-10-01T08:00:00',...over});
const entry=(over:Partial<ContractDayEntry>={}):ContractDayEntry=>({item:item(),loads:[],adjustments:[],...over});

describe('dailyContractTargetTable - the real figures of the Contract Quantities rules',()=>{
  it('gives contract quantity, used before today, used today, % used and left',()=>{
    const rows=dailyContractTargetTable([entry({loads:[load({id:'a',date:'2026-11-01',quantity:400}),load({id:'b',quantity:22}),load({id:'c',quantity:22})]})],DAY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({name:'Asphalt',unitSymbol:'t',quantity:1000,usedBefore:400,usedToday:44,used:444,percentUsed:44.4,left:556});
  });
  it('counts reasoned adjustments in what was used, on the day they were made',()=>{
    const rows=dailyContractTargetTable([entry({loads:[load({quantity:100})],adjustments:[adjustment({amount:50})]})],DAY);
    expect(rows[0]).toMatchObject({usedBefore:50,usedToday:100,used:150});
  });
  it('ignores loads after the day and loads of other units (never converted)',()=>{
    const rows=dailyContractTargetTable([entry({loads:[load({date:'2026-11-09',quantity:999}),load({id:'y',unitId:'m3',unitSymbol:'m³',quantity:50})]})],DAY);
    expect(rows[0]).toMatchObject({usedBefore:0,usedToday:0,used:0,percentUsed:0,left:1000});
  });
  it('shows a target that did not move today, and leaves cancelled targets out',()=>{
    const rows=dailyContractTargetTable([entry({loads:[load({date:'2026-11-01',quantity:10})]}),entry({item:item({id:'c2',cancelledAt:'2026-10-02T00:00:00'})})],DAY);
    expect(rows.map(r=>r.itemId)).toEqual(['c1']);expect(rows[0]!.usedToday).toBe(0);
  });
  it('reports an overrun honestly: more than 100% and left never below zero',()=>{
    const rows=dailyContractTargetTable([entry({item:item({quantity:20}),loads:[load({quantity:22})]})],DAY);
    expect(rows[0]).toMatchObject({percentUsed:110,left:0,overBy:2});
  });
});

const out=(over:Partial<DayLoadOut>={}):DayLoadOut=>({id:'l1',status:'Active',time:`${DAY}T07:40:00`,loadNumber:'ASP-1042',itemName:'Asphalt',unitSymbol:'t',quantity:22,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:'T-12',driverName:'Samir',bitumenKg:1100,bitumenApplies:true,...over});
const empty:DayInput={loadsOut:[],supplierLoads:[],fills:[],dumps:[]};
const rows=dailyContractTargetTable([entry({loads:[load({date:'2026-11-01',quantity:400}),load({quantity:44})]})],DAY);
const report=(included:boolean)=>applyContractSwitches(buildCompanyDailyReport(DAY,{...empty,loadsOut:[out(),out({id:'x2',projectId:null,projectName:null})]}),{p1:{rows}},{p1:included});

describe('Contract target on the Company Daily Report',()=>{
  it('attaches a target table only to project places, never to sites or No project',()=>{
    const places=report(true).places;
    expect(places.find(p=>p.key==='project:p1')!.contract).toMatchObject({available:true,included:true});
    expect(places.find(p=>p.kind==='none')!.contract).toBeUndefined();
  });
  it('prints the Contract target table for a project whose switch is ON',()=>{
    const html=buildCompanyDailyReportHtml({logo:null,report:report(true)});
    expect(html).toContain('Contract target');expect(html).toContain('Used before today');expect(html).toContain('44.4%');expect(html).toContain('556 tons');
  });
  it('prints no table and says "contract target not included" when the switch is OFF but targets exist',()=>{
    const html=buildCompanyDailyReportHtml({logo:null,report:report(false)});
    expect(html).not.toContain('Used before today');expect(html).toContain('contract target not included');
  });
  it('says nothing about contract targets for a project that has none',()=>{
    const none=applyContractSwitches(buildCompanyDailyReport(DAY,{...empty,loadsOut:[out()]}),{},{});
    const html=buildCompanyDailyReportHtml({logo:null,report:none});
    expect(html).not.toContain('contract target');expect(html).not.toContain('Contract target');
  });
  it('adds a Contract target sheet only for projects whose switch is ON, with numbers as numbers',()=>{
    const on=companyDailyReportSheets(report(true)).find(s=>s.name==='Contract target')!;
    expect(on.rows[0]).toMatchObject({Project:'Airport Road',Item:'Asphalt',Unit:'t','Contract Quantity':1000,'Used Before Today':400,'Used Today':44,'Percent Used':44.4,Left:556});
    expect(companyDailyReportSheets(report(false)).some(s=>s.name==='Contract target')).toBe(false);
  });
});
