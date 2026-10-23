import {describe,expect,it} from 'vitest';

import type {ContractRowView} from '../src/data/repositories/ContractQuantitiesRepository';
import {buildContractReport} from '../src/domain/contractReport';
import {computeContractUsage,summarizeContractProject,type ContractItem,type ContractLoad} from '../src/domain/contractQuantities';
import {buildContractReportHtml} from '../src/services/contractReportTemplate';
import {contractWorkbookSheets} from '../src/services/contractWorkbook';

/**
 * DEC-522 Phase E. The Contract Quantities report: With prices (internal, with savings) and Without prices (client-safe). Used quantities and
 * percentages are identical in both; only prices, values and savings are left out. Units are never added together.
 */
const item=(over:Partial<ContractItem>):ContractItem=>({id:'i',projectId:'p',name:'Item',unitId:'u_m3',unitSymbol:'m³',quantity:100,unitPriceUsd:null,materialIds:['m'],status:'in_progress',completedOn:null,cancelledAt:null,...over});
const load=(itemId:string,quantity:number,over:Partial<ContractLoad>={}):ContractLoad=>({id:`${itemId}-${quantity}`,source:'company',reference:`L-${quantity}`,materialId:'m',unitId:'u_m3',unitSymbol:'m³',quantity,date:'2026-10-14',status:'Active',contractItemId:itemId,...over});
function row(value:ContractItem,loads:ContractLoad[],adjust=0):ContractRowView{
  const usage=computeContractUsage(value,loads,adjust?[{id:`a-${value.id}`,contractItemId:value.id,amount:adjust,reason:'Left on site',createdAt:'2026-10-16T14:40:00.000Z'}]:[]);
  return{item:value,usage,materials:[{id:'m',name:`${value.name} material`,unitId:value.unitId,unitSymbol:value.unitSymbol}]};
}
function sample(){
  const base=item({id:'base',name:'Base course',quantity:500,unitPriceUsd:18});
  const binder=item({id:'binder',name:'Asphalt binder',unitId:'u_t',unitSymbol:'t',quantity:300,unitPriceUsd:62});
  const sub=item({id:'sub',name:'Sub-base',quantity:200,unitPriceUsd:12,status:'complete',completedOn:'2026-10-18'});
  const wearing=item({id:'wear',name:'Wearing course',unitId:'u_t',unitSymbol:'t',quantity:250});
  const gone=item({id:'gone',name:'Kerbs',cancelledAt:'2026-10-02T08:00:00.000Z'});
  const rows=[
    row(base,[load('base',455),load('base',22,{id:'odd',reference:'SL-0412',unitId:'u_t',unitSymbol:'t',source:'supplier'})],-3),
    row(binder,[load('binder',318.5,{unitId:'u_t',unitSymbol:'t'})]),
    row(sub,[load('sub',160)]),
    row(wearing,[load('wear',96,{unitId:'u_t',unitSymbol:'t'})]),
    row(gone,[]),
  ];
  return{rows,summary:summarizeContractProject(rows)};
}
const project={name:'Ain Qana – Jbaa',customerName:'Hashem Contracting',location:'Jbaa'};
const header={companyName:'DROMEX Asphalt Co.',logo:'data:image/png;base64,AAAA',contactLine:'Jbaa · +961 70 123 456'};

describe('the report model',()=>{
  it('lists the live items with the true used quantity and percent, separately from loads and adjustments, and leaves cancelled items out',()=>{
    const {rows,summary}=sample();
    const report=buildContractReport(rows,summary,project,{includePrices:true,generatedAt:'2026-10-23T10:00:00.000Z'});
    expect(report.rows.map(value=>value.name)).toEqual(['Base course','Asphalt binder','Sub-base','Wearing course']);
    expect(report.rows[0]).toMatchObject({unit:'m³',contract:500,fromLoads:455,adjustments:-3,used:452,remaining:48,percentUsed:90.4,status:'In progress',leftover:48,savingUsd:864,savingIsEstimate:true});
    expect(report.rows[1]).toMatchObject({used:318.5,remaining:0,percentUsed:106.2,status:'Over contract',leftover:0,savingUsd:0});
    expect(report.rows[2]).toMatchObject({percentUsed:80,status:'Complete 18 Oct 2026',leftover:40,savingUsd:480,savingIsEstimate:false});
    expect(report.rows[3]).toMatchObject({savingUsd:null});
    expect(report.summary).toMatchObject({overallPercentUsed:78.7,basis:'items',itemsComplete:'1 of 4',totalSavingUsd:480,estimatedSavingUsd:864});
    expect(report.savings).toEqual([{name:'Sub-base',leftover:'40 m³',savingUsd:480}]);
    expect(report.overruns).toEqual([{name:'Asphalt binder',overBy:'18.5 t',percentUsed:106.2}]);
    expect(report.notCounted).toEqual([{load:'SL-0412 · 14 Oct 2026',item:'Base course',quantity:'22 t',why:'Unit differs (t, item counts m³)'}]);
    expect(report.fileName).toBe('DROMEX-Contract-Quantities-Ain-Qana-Jbaa-With-Prices-2026-10-23.pdf');
  });
  it('without prices keeps every quantity and percent identical and leaves out prices, values and savings',()=>{
    const {rows,summary}=sample();
    const withPrices=buildContractReport(rows,summary,project,{includePrices:true,generatedAt:'2026-10-23T10:00:00.000Z'});
    const without=buildContractReport(rows,summary,project,{includePrices:false,generatedAt:'2026-10-23T10:00:00.000Z'});
    const quantities=(report:typeof without)=>report.rows.map(value=>[value.contract,value.fromLoads,value.adjustments,value.used,value.remaining,value.percentUsed,value.status]);
    expect(quantities(without)).toEqual(quantities(withPrices));
    expect(without.summary.overallPercentUsed).toBe(withPrices.summary.overallPercentUsed);
    expect(without.rows.every(value=>value.savingUsd===null&&value.leftover===null)).toBe(true);
    expect(without.summary).toMatchObject({totalSavingUsd:null,estimatedSavingUsd:null});
    expect(without.savings).toEqual([]);
    expect(without.title).toBe('Contract Quantities');
    expect(withPrices.title).toBe('Contract Quantities and Savings');
    expect(without.fileName).toContain('Without-Prices');
  });
  it('says so when the project has no live contract items',()=>{
    const report=buildContractReport([],summarizeContractProject([]),project,{includePrices:false,generatedAt:'2026-10-23T10:00:00.000Z'});
    expect(report.empty).toBe(true);
  });
});

describe('the PDF',()=>{
  it('carries the header company logo, name and contact line, the project and customer, and the grouped columns with prices',()=>{
    const {rows,summary}=sample();
    const html=buildContractReportHtml(buildContractReport(rows,summary,project,{includePrices:true,generatedAt:'2026-10-23T10:00:00.000Z'}),header);
    expect(html).toContain('<img class="logo" src="data:image/png;base64,AAAA"');
    expect(html).toContain('DROMEX Asphalt Co.');
    expect(html).toContain('Jbaa · +961 70 123 456');
    expect(html).toContain('Contract Quantities and Savings');
    expect(html).toContain('Hashem Contracting');
    for(const group of ['>Contract<','>Use<','>Balance<','>Saving<'])expect(html).toContain(group);
    expect(html).toContain('A4 landscape');
    expect(html).toContain('counter(pages)');
    expect(html).toContain('$864.00 *');
    expect(html).toContain('Largest saving first');
  });
  it('without prices shows no money, no saving column and no Saving group, with the same used figures',()=>{
    const {rows,summary}=sample();
    const html=buildContractReportHtml(buildContractReport(rows,summary,project,{includePrices:false,generatedAt:'2026-10-23T10:00:00.000Z'}),header);
    expect(html).not.toContain('$');
    expect(html).not.toContain('>Saving<');
    expect(html).toContain('90.4%');
    expect(html).toContain('318.5');
  });
  it('works without a logo and escapes text',()=>{
    const {rows,summary}=sample();
    const html=buildContractReportHtml(buildContractReport(rows,summary,{...project,name:'<Road & Co>'},{includePrices:false,generatedAt:'2026-10-23T10:00:00.000Z'}),{...header,logo:null});
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;Road &amp; Co&gt;');
  });
});

describe('the workbook',()=>{
  it('keeps numbers as numbers, one row per item, and drops price columns without prices',()=>{
    const {rows,summary}=sample();
    const sheets=contractWorkbookSheets(buildContractReport(rows,summary,project,{includePrices:true,generatedAt:'2026-10-23T10:00:00.000Z'}),{name:'DROMEX Asphalt Co.'});
    expect(sheets.map(sheet=>sheet.name)).toEqual(['Report Info','Contract Items','Not Counted','Data Dictionary']);
    expect(sheets[1]!.rows[0]).toMatchObject({Item:'Base course',Unit:'m³','Contract Quantity':500,'From Loads':455,Adjustments:-3,Used:452,Remaining:48,'% Used':90.4,Status:'In progress','Leftover':48,'Saving USD':864,'Saving Is Estimate':'Yes'});
    const without=contractWorkbookSheets(buildContractReport(rows,summary,project,{includePrices:false,generatedAt:'2026-10-23T10:00:00.000Z'}),{name:'DROMEX'});
    expect(Object.keys(without[1]!.rows[0]!)).not.toContain('Saving USD');
    expect(Object.keys(without[1]!.rows[0]!)).not.toContain('Contract Price USD');
    expect(without[1]!.rows[0]).toMatchObject({Used:452,'% Used':90.4});
  });
});
