import {describe,expect,it} from 'vitest';

import type {CompanyTotalsData} from '../src/domain/companyTotals';
import {applyContractSwitches,buildCompanyDailyReport,type DayInput} from '../src/domain/companyDailyReport';
import {
  contractTotalsTargets,dailyContractProgress,dailyContractTargetTable,finalContractReport,
  type ContractDayEntry,type ContractItem,type ContractLoad,type ContractSiteEntry,
} from '../src/domain/contractQuantities';
import {buildCompanyDailyReportHtml} from '../src/services/companyDailyReportTemplate';
import {companyDailyReportSheets} from '../src/services/companyDailyReportWorkbook';
import {contractProgressRows} from '../src/services/dailyReportWorkbookCore';
import {contractProgressHtml} from '../src/services/dailyReportSectionsTemplate';
import {buildProjectCompletionHtml} from '../src/services/projectCompletionTemplate';
import {buildTotalsHtml} from '../src/services/totalsTemplate';

/**
 * DEC-556, Phase 4. Every report that prints a Quantity Target shows how its used quantity is tracked (AUTOMATIC, LINKED MANUAL or MANUAL),
 * and only that: the figures are the target's own and are computed by the same rules in every mode, so a target looks the same apart from
 * its badge.
 */
const DAY='2026-11-06';
const item=(over:Partial<ContractItem>):ContractItem=>({id:'a',projectId:'p1',name:'Base course',unitId:'u_m3',unitSymbol:'m³',quantity:2000,unitPriceUsd:null,materialIds:['base'],status:'in_progress',completedOn:null,cancelledAt:null,trackingMode:'automatic',...over});
const load=(over:Partial<ContractLoad>):ContractLoad=>({id:'l',source:'company',reference:'L-1',materialId:'base',unitId:'u_m3',unitSymbol:'m³',quantity:1240,date:DAY,status:'Active',contractItemId:'a',...over});
const site=(itemId:string,amount:number,day=DAY):ContractSiteEntry=>({id:`${itemId}-${amount}`,contractItemId:itemId,kind:'entry',entryDate:day,amount,note:null,createdAt:`${day}T08:00:00.000Z`});
const entries=():ContractDayEntry[]=>[
  {item:item({}),loads:[load({quantity:1240})],adjustments:[]},
  {item:item({id:'c',name:'Curb installed',unitId:'u_m',unitSymbol:'m',quantity:1200,materialIds:['concrete'],trackingMode:'linked_manual'}),loads:[load({id:'l2',contractItemId:'c',materialId:'concrete',quantity:340})],adjustments:[],siteEntries:[site('c',1116)]},
  {item:item({id:'m',name:'Site clearance',unitId:'u_m2',unitSymbol:'m²',quantity:8000,materialIds:[],trackingMode:'manual'}),loads:[],adjustments:[],siteEntries:[site('m',2800)]},
];
const BADGES=['AUTOMATIC','LINKED MANUAL','MANUAL'];
const badgesIn=(html:string)=>BADGES.filter(badge=>html.includes(`>${badge}</span>`));

describe('the report data carries how each target is tracked',()=>{
  it('daily target rows and totals targets say AUTOMATIC, LINKED MANUAL or MANUAL',()=>{
    expect(dailyContractTargetTable(entries(),DAY).map(row=>row.tracking)).toEqual(['automatic','linked_manual','manual']);
    expect(contractTotalsTargets(entries(),null).map(row=>row.tracking)).toEqual(['automatic','linked_manual','manual']);
  });
  it('reads the mode of the date asked for, so an earlier report keeps the badge it had',()=>{
    const switched:ContractDayEntry={item:item({id:'c',trackingMode:'linked_manual'}),loads:[load({contractItemId:'c',quantity:12,date:'2026-10-10'})],adjustments:[],
      siteEntries:[{...site('c',12,'2026-10-15'),kind:'opening'}],modeChanges:[{day:'2026-10-15',from:'automatic',to:'linked_manual'}]};
    expect(contractTotalsTargets([switched],'2026-10-12')[0]!.tracking).toBe('automatic');
    expect(contractTotalsTargets([switched],'2026-10-16')[0]!.tracking).toBe('linked_manual');
  });
  it('gives the same percent and warning as an automatic target at the same used quantity',()=>{
    const rows=dailyContractTargetTable([
      {item:item({quantity:100}),loads:[load({quantity:95})],adjustments:[]},
      {item:item({id:'m',quantity:100,materialIds:[],trackingMode:'manual'}),loads:[],adjustments:[],siteEntries:[site('m',95)]},
    ],DAY);
    expect(rows[0]).toMatchObject({used:95,percentUsed:95,warning:'near'});
    expect(rows[1]).toMatchObject({used:95,percentUsed:95,warning:'near'});
  });
});

describe('Daily Report, Quantity Targets section',()=>{
  const progress=dailyContractProgress(entries(),DAY);
  it('shows the badge beside each target name and the same figures',()=>{
    const html=contractProgressHtml(progress,true);
    expect(badgesIn(html)).toEqual(BADGES);
    expect(html).toContain('1116');
    expect(html).toContain('2800');
  });
  it('adds a Tracking column to the Excel sheet',()=>{
    const rows=contractProgressRows(progress,true);
    expect(rows.slice(0,3).map(row=>row.Tracking)).toEqual(['AUTOMATIC','LINKED MANUAL','MANUAL']);
    expect(rows[1]).toMatchObject({'Total Used':1116,'Percent Complete':93});
    expect(rows[3]!.Tracking).toBeNull();
  });
});

describe('Completed Project Report, Quantity targets table',()=>{
  const html=buildProjectCompletionHtml({id:'p1',name:'Zebdine Road',location:'Zebdine',status:'completed'} as never,[],[],[],{name:'DROMEX',logoUri:null,address:'',phone:'',email:''} as never,null,[],{report:finalContractReport(entries()),includeWholeProject:true});
  it('shows the badge beside each target',()=>{
    expect(badgesIn(html)).toEqual(BADGES);
    expect(html).toContain('1,116');
  });
});

describe('Project Totals PDF, target tiles',()=>{
  const data:CompanyTotalsData={usageHiddenReason:null,usage:[],deliveries:[
    {source:'supplier_delivery',itemKey:'id:base',itemName:'BaseCourse',projectKey:'p1',projectName:'Zebdine Road',supplierKey:'s1',supplierName:'Supplier',unitKey:'u_m3',unitSymbol:'m³',quantity:1650,recordCount:76,valueCents:null,pricedCount:0,inclusion:{total:1,included:0,inDraft:0,open:1,includedIn:[]}} as never,
    {source:'supplier_delivery',itemKey:'id:concrete',itemName:'Concrete C25',projectKey:'p1',projectName:'Zebdine Road',supplierKey:'s1',supplierName:'Supplier',unitKey:'u_m3',unitSymbol:'m³',quantity:340,recordCount:42,valueCents:null,pricedCount:0,inclusion:{total:1,included:0,inDraft:0,open:1,includedIn:[]}} as never,
  ]};
  const base={companyName:'DROMEX',logo:null,title:'Project Totals',scope:'project' as const,filters:['All dates'],generatedAt:'2026-11-03T10:00:00',includePrices:false,data};
  it('shows the badge in the target name, and the same figures, for the targets of a material',()=>{
    const html=buildTotalsHtml({...base,targets:contractTotalsTargets(entries(),null)});
    expect(badgesIn(html)).toEqual(['AUTOMATIC','LINKED MANUAL']);
    expect(html).toContain('Curb installed');
  });
  it('prints exactly what it printed before when no targets are given',()=>{
    expect(badgesIn(buildTotalsHtml(base))).toEqual([]);
  });
});

describe('Company Daily Report, Contract target table',()=>{
  const empty:DayInput={loadsOut:[],supplierLoads:[],fills:[],dumps:[]};
  const out={id:'l1',status:'Active' as const,time:`${DAY}T07:40:00`,loadNumber:'ASP-1',itemName:'Asphalt',unitSymbol:'t',quantity:22,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,truckPlate:'T-12',driverName:'Samir',bitumenKg:1100,bitumenApplies:true};
  const report=applyContractSwitches(buildCompanyDailyReport(DAY,{...empty,loadsOut:[out]}),{p1:{rows:dailyContractTargetTable(entries(),DAY)}},{p1:true});
  it('shows the badge beside each target name',()=>{
    expect(badgesIn(buildCompanyDailyReportHtml({logo:null,report}))).toEqual(BADGES);
  });
  it('adds a Tracking column to the Excel sheet',()=>{
    const rows=companyDailyReportSheets(report).find(sheet=>sheet.name==='Contract target')!.rows;
    expect(rows.map(row=>row.Tracking)).toEqual(['AUTOMATIC','LINKED MANUAL','MANUAL']);
    expect(rows[1]).toMatchObject({Item:'Curb installed','Percent Used':93});
  });
});

describe('a target saved before tracking modes existed',()=>{
  it('is shown as AUTOMATIC',()=>{
    const legacy:ContractDayEntry[]=[{item:{...item({}),trackingMode:undefined},loads:[load({})],adjustments:[]}];
    expect(badgesIn(buildProjectCompletionHtml({id:'p1',name:'Z',location:'Z',status:'completed'} as never,[],[],[],{name:'D',logoUri:null,address:'',phone:'',email:''} as never,null,[],{report:finalContractReport(legacy),includeWholeProject:false}))).toEqual(['AUTOMATIC']);
  });
});
