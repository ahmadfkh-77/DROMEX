import {describe,expect,it} from 'vitest';

import type {ContractRowView} from '../src/data/repositories/ContractQuantitiesRepository';
import {buildContractReport} from '../src/domain/contractReport';
import {
  computeContractUsage,contractDeliveredLines,contractTrackingLabel,contractTrackingLine,siteEntryPreview,summarizeContractProject,
  type ContractItem,type ContractLoad,type ContractSiteEntry,
} from '../src/domain/contractQuantities';
import {buildContractReportHtml} from '../src/services/contractReportTemplate';
import {contractWorkbookSheets} from '../src/services/contractWorkbook';

/**
 * DEC-556, Phase 2 words and Phase 4 report for the three tracking modes. The wording is the approved mockup's: "Site entries", the badges,
 * and for a Linked manual target the delivered quantity in the material's own unit with the material's name, in the From loads column.
 */
const item=(over:Partial<ContractItem>):ContractItem=>({id:'i',projectId:'p',name:'Item',unitId:'u_m3',unitSymbol:'m³',quantity:100,unitPriceUsd:null,materialIds:['m'],status:'in_progress',completedOn:null,cancelledAt:null,trackingMode:'automatic',...over});
const load=(itemId:string,quantity:number,over:Partial<ContractLoad>={}):ContractLoad=>({id:`${itemId}-${quantity}`,source:'company',reference:`L-${quantity}`,materialId:'concrete',unitId:'u_m3',unitSymbol:'m³',quantity,date:'2026-10-14',status:'Active',contractItemId:itemId,...over});
const entry=(itemId:string,amount:number,day:string,note:string|null=null,over:Partial<ContractSiteEntry>={}):ContractSiteEntry=>({id:`${itemId}-${day}-${amount}`,contractItemId:itemId,kind:'entry',entryDate:day,amount,note,createdAt:`${day}T08:00:00.000Z`,...over});
function row(value:ContractItem,loads:ContractLoad[],entries:ContractSiteEntry[]=[]):ContractRowView{
  const usage=computeContractUsage(value,loads,[],entries);
  return{item:value,usage,materials:value.materialIds.map(id=>({id,name:id==='concrete'?'Concrete C25':'Crushed base',unitId:'u_m3',unitSymbol:'m³'}))};
}
function sample(){
  const auto=item({id:'auto',name:'Base course',quantity:2000,unitPriceUsd:20,materialIds:['base']});
  const linked=item({id:'curb',name:'Curb installed',unitId:'u_m',unitSymbol:'m',quantity:1200,unitPriceUsd:18.5,materialIds:['concrete'],trackingMode:'linked_manual'});
  const manual=item({id:'clear',name:'Site clearance',unitId:'u_m2',unitSymbol:'m²',quantity:8000,materialIds:[],trackingMode:'manual'});
  const rows=[
    row(auto,[load('auto',1240,{materialId:'base'})]),
    row(linked,[load('curb',340),load('curb',10,{id:'l2',source:'supplier'})],[entry('curb',996,'2026-10-19','Block 4 west'),entry('curb',120,'2026-10-20','Block 4 east'),entry('curb',-10,'2026-10-21','Counted twice')]),
    row(manual,[],[entry('clear',2200,'2026-10-15'),entry('clear',600,'2026-10-19','North strip')]),
  ];
  return{rows,summary:summarizeContractProject(rows)};
}
const project={name:'Ain Qana – Jbaa',customerName:'Hashem Contracting',location:'Jbaa'};
const header={companyName:'DROMEX Asphalt Co.',logo:null,contactLine:null} as never;
const build=(includePrices:boolean)=>{const {rows,summary}=sample();return buildContractReport(rows,summary,project,{includePrices,generatedAt:'2026-11-21T10:00:00.000Z'});};

describe('words for the three modes',()=>{
  it('labels the badges',()=>{
    expect(['automatic','linked_manual','manual'].map(mode=>contractTrackingLabel(mode as never))).toEqual(['AUTOMATIC','LINKED MANUAL','MANUAL']);
  });
  it('says "Site entries", never "Entered by hand", under a target\'s name',()=>{
    expect(contractTrackingLine('automatic',['Crushed base'])).toBe('Calculated from linked loads · Crushed base');
    expect(contractTrackingLine('linked_manual',['Concrete C25'])).toBe('Site entries · Concrete C25 linked');
    expect(contractTrackingLine('linked_manual',[])).toBe('Site entries · no material linked');
    expect(contractTrackingLine('manual',[])).toBe('Site entries · no material linked');
  });
  it('previews used and percent after a signed amount, and nothing for zero or text',()=>{
    expect(siteEntryPreview({used:1116,allowed:1200},'-10')).toEqual({usedAfter:1106,percentAfter:92.2});
    expect(siteEntryPreview({used:1116,allowed:1200},'120')).toEqual({usedAfter:1236,percentAfter:103});
    expect(siteEntryPreview({used:0,allowed:100},'0')).toBeNull();
    expect(siteEntryPreview({used:0,allowed:100},'abc')).toBeNull();
  });
});

describe('the report model for the three modes',()=>{
  it('carries the badge, the site entries and the true used quantity for each target',()=>{
    const report=build(true);
    expect(report.rows.map(value=>value.tracking)).toEqual(['AUTOMATIC','LINKED MANUAL','MANUAL']);
    expect(report.rows[0]).toMatchObject({fromLoads:1240,siteEntries:null,used:1240,manual:false});
    expect(report.rows[1]).toMatchObject({siteEntries:1106,used:1106,percentUsed:92.2,manual:true});
    expect(report.rows[2]).toMatchObject({siteEntries:2800,used:2800,percentUsed:35});
    expect(report.trackedBySiteEntries).toBe(2);
  });
  it('shows the delivered quantity with the material name for a Linked manual target only',()=>{
    const report=build(true);
    expect(report.rows[0]!.delivered).toBe('');
    expect(report.rows[1]!.delivered).toBe('350 m³ Concrete C25');
    expect(report.rows[2]!.delivered).toBe('');
  });
  it('lists the site entries oldest first with a running total and the correction note',()=>{
    const [curb,clear]=build(true).siteEntries;
    expect(curb).toMatchObject({name:'Curb installed',tracking:'LINKED MANUAL',unit:'m',total:1106});
    expect(curb!.entries.map(value=>[value.date,value.amount,value.totalAfter,value.note])).toEqual([['2026-10-19',996,996,'Block 4 west'],['2026-10-20',120,1116,'Block 4 east'],['2026-10-21',-10,1106,'Counted twice']]);
    expect(clear!.total).toBe(2800);
  });
  it('keeps used and percent identical with and without prices',()=>{
    const withPrices=build(true),without=build(false);
    expect(without.rows.map(value=>[value.used,value.percentUsed,value.siteEntries])).toEqual(withPrices.rows.map(value=>[value.used,value.percentUsed,value.siteEntries]));
    expect(without.siteEntries).toEqual(withPrices.siteEntries);
    expect(without.rows.every(value=>value.savingUsd===null)).toBe(true);
  });
});

describe('the report PDF for the three modes',()=>{
  const html=(prices:boolean)=>buildContractReportHtml(build(prices),header);
  it('has the Site entries column and badges, and the subtitle under the Targets title instead of a legend',()=>{
    const page=html(true);
    expect(page).toContain('<th class="num">Site entries</th>');
    for(const badge of ['AUTOMATIC','LINKED MANUAL','MANUAL'])expect(page).toContain(`>${badge}</span>`);
    expect(page).toContain('<b>Site entries</b> track LINKED MANUAL and MANUAL targets. AUTOMATIC targets are calculated from loads.');
    expect(page).not.toContain('How "Used" is tracked');
    expect(page).not.toContain('Entered by hand');
    expect(page).not.toContain('reference, not');
  });
  it('shows the delivered quantity and the material name in the From loads column of a Linked manual target',()=>{
    const page=html(true);
    const curb=page.slice(page.indexOf('Curb installed'));
    const loadsCell=/<td class="num g">1,?200<\/td><td class="num g">([\s\S]*?)<\/td>/.exec(curb);
    expect(loadsCell?.[1]).toContain('350');
    expect(loadsCell?.[1]).toContain('m³');
    expect(loadsCell?.[1]).toContain('Concrete C25');
  });
  it('lists the entries in a Site entries section, in both versions',()=>{
    for(const prices of [true,false]){
      const page=html(prices);
      expect(page).toContain('Counted twice');
      expect(page).toContain('Block 4 west');
      expect(page).toContain('LINKED MANUAL · 3 entries · total 1106');
    }
  });
});

describe('the report workbook for the three modes',()=>{
  const sheets=contractWorkbookSheets(build(true),{name:'DROMEX'});
  it('has Tracking, Site Entries and the delivered column, numeric where it is a number',()=>{
    const targets=sheets.find(sheet=>sheet.name==='Targets')!.rows;
    expect(targets.map(value=>value.Tracking)).toEqual(['AUTOMATIC','LINKED MANUAL','MANUAL']);
    expect(targets[0]).toMatchObject({'From Loads':1240,'Site Entries':null});
    expect(targets[1]).toMatchObject({'From Loads':null,'Site Entries':1106,Used:1106});
    expect(targets[1]!['Delivered In Loads (Not Counted)']).toContain('Concrete C25');
  });
  it('adds a Site Entries sheet only when a manual target has entries',()=>{
    expect(sheets.find(sheet=>sheet.name==='Site Entries')!.rows).toHaveLength(5);
    const {rows,summary}=(()=>{const value=item({id:'a'});const r=[row(value,[load('a',10,{materialId:'m'})])];return{rows:r,summary:summarizeContractProject(r)};})();
    const plain=contractWorkbookSheets(buildContractReport(rows,summary,project,{includePrices:true,generatedAt:'2026-11-21T10:00:00.000Z'}),{name:'DROMEX'});
    expect(plain.some(sheet=>sheet.name==='Site Entries')).toBe(false);
  });
});

describe('the From loads box',()=>{
  it('names each delivered material in its own unit with its load count, and is empty for the other modes',()=>{
    const [auto,linked,manual]=sample().rows;
    const name=(id:string)=>id==='concrete'?'Concrete C25':id;
    expect(contractDeliveredLines(linked!.usage,name)).toEqual(['350 m³ · Concrete C25 · 2 loads']);
    expect(contractDeliveredLines(auto!.usage,name)).toEqual([]);
    expect(contractDeliveredLines(manual!.usage,name)).toEqual([]);
  });
});
