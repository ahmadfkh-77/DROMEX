import {describe,expect,it} from 'vitest';

import {
  computeContractUsage,contractTotalsTargets,contractTrackingMode,dailyContractProgress,dailyContractTargetTable,deliveredFromLoads,
  validateContractItemDraft,validateSiteEntry,
  type ContractItem,type ContractLoad,type ContractSiteEntry,
} from '../src/domain/contractQuantities';

/**
 * Site entries (tracking modes, Phase 1). A target is tracked AUTOMATIC (loads), LINKED MANUAL (materials linked for reference, used entered by
 * hand) or MANUAL (no material, used entered by hand). The honesty rule is unchanged: the used quantity is the real one, however it is tracked.
 */
const item=(over:Partial<ContractItem>={}):ContractItem=>({
  id:'ci1',projectId:'p1',name:'Curb installed',unitId:'u_m',unitSymbol:'m',quantity:1200,unitPriceUsd:20,materialIds:['m_concrete'],
  status:'in_progress',completedOn:null,cancelledAt:null,trackingMode:'linked_manual',...over,
});
const load=(over:Partial<ContractLoad>={}):ContractLoad=>({
  id:'l1',source:'company',reference:'L-1',materialId:'m_concrete',unitId:'u_m3',unitSymbol:'m³',quantity:10,date:'2026-10-10',status:'Active',contractItemId:'ci1',...over,
});
const entry=(over:Partial<ContractSiteEntry>={}):ContractSiteEntry=>({id:'e1',contractItemId:'ci1',kind:'entry',entryDate:'2026-10-11',amount:100,note:null,createdAt:'2026-10-11T08:00:00.000Z',...over});

describe('tracking mode',()=>{
  it('treats a target without a mode as automatic',()=>{
    expect(contractTrackingMode({})).toBe('automatic');
    expect(contractTrackingMode({trackingMode:'manual'})).toBe('manual');
  });
});

describe('used for each mode',()=>{
  it('AUTOMATIC is exactly as before and ignores site entries that do not belong to it',()=>{
    const automatic=item({trackingMode:'automatic',unitId:'u_m3',unitSymbol:'m³'});
    const usage=computeContractUsage(automatic,[load({quantity:12})],[],[entry({amount:999})]);
    expect(usage).toMatchObject({fromLoads:12,siteEntriesTotal:0,used:12,tracking:'automatic'});
    expect(usage.siteEntries).toEqual([]);
  });

  it('LINKED MANUAL used is the site entries; linked loads in another unit are never counted nor listed as not counted',()=>{
    const usage=computeContractUsage(item(),[load({quantity:340})],[],[entry({amount:96}),entry({id:'e2',amount:120,entryDate:'2026-10-12'})]);
    expect(usage).toMatchObject({tracking:'linked_manual',fromLoads:0,siteEntriesTotal:216,used:216,remaining:984,percentUsed:18});
    expect(usage.countedLoads).toEqual([]);
    expect(usage.notCounted).toEqual([]);
  });

  it('LINKED MANUAL keeps showing what was delivered in the material\'s own unit, never added to used',()=>{
    const loads=[load({quantity:340}),load({id:'l2',source:'supplier',quantity:10}),load({id:'l3',status:'Cancelled',quantity:99}),load({id:'l4',contractItemId:'other',quantity:50})];
    const usage=computeContractUsage(item(),loads,[],[entry({amount:100})]);
    expect(usage.used).toBe(100);
    expect(usage.deliveredFromLoads).toEqual([{materialId:'m_concrete',unitId:'u_m3',unitSymbol:'m³',quantity:350,loadCount:2}]);
  });

  it('keeps different delivered units apart and leaves out loads without a quantity',()=>{
    const rows=deliveredFromLoads(item(),[load({quantity:5}),load({id:'l2',unitId:'u_t',unitSymbol:'t',quantity:7}),load({id:'l3',quantity:null})]);
    expect(rows).toEqual(expect.arrayContaining([
      {materialId:'m_concrete',unitId:'u_m3',unitSymbol:'m³',quantity:5,loadCount:1},
      {materialId:'m_concrete',unitId:'u_t',unitSymbol:'t',quantity:7,loadCount:1},
    ]));
    expect(rows).toHaveLength(2);
  });

  it('AUTOMATIC and MANUAL show no delivered figure',()=>{
    expect(computeContractUsage(item({trackingMode:'automatic',unitId:'u_m3',unitSymbol:'m³'}),[load()],[]).deliveredFromLoads).toEqual([]);
    expect(computeContractUsage(item({trackingMode:'manual',materialIds:[]}),[],[],[entry()]).deliveredFromLoads).toEqual([]);
  });

  it('MANUAL used is the site entries plus visible adjustments, in the target unit',()=>{
    const manual=item({trackingMode:'manual',materialIds:[],name:'Site clearance',unitId:'u_m2',unitSymbol:'m²',quantity:8000});
    const usage=computeContractUsage(manual,[],[{id:'a1',contractItemId:'ci1',amount:-100,reason:'Re-measured',createdAt:'2026-10-13T08:00:00.000Z'}],[entry({amount:600}),entry({id:'e2',amount:700})]);
    expect(usage).toMatchObject({tracking:'manual',siteEntriesTotal:1300,adjustmentsTotal:-100,used:1200,remaining:6800,percentUsed:15});
  });

  it('counts an opening entry (the frozen value from automatic) with the entries after it',()=>{
    const usage=computeContractUsage(item({trackingMode:'manual',materialIds:[]}),[],[],[entry({id:'o',kind:'opening',amount:455}),entry({id:'e2',amount:45})]);
    expect(usage.used).toBe(500);
    expect(usage.siteEntries.map(value=>value.kind)).toEqual(['opening','entry']);
  });

  it('a negative correction reduces used', ()=>{
    const usage=computeContractUsage(item(),[],[],[entry({amount:120}),entry({id:'e2',amount:-10,note:'Counted twice'})]);
    expect(usage.used).toBe(110);
  });

  it('ignores entries that belong to another target',()=>{
    expect(computeContractUsage(item(),[],[],[entry({contractItemId:'other',amount:500})]).used).toBe(0);
  });
});

describe('the same warnings and honesty rule in every mode',()=>{
  const cases:{mode:'automatic'|'linked_manual'|'manual'}[]=[{mode:'automatic'},{mode:'linked_manual'},{mode:'manual'}];
  const at=(mode:'automatic'|'linked_manual'|'manual',used:number)=>{
    const target=item({trackingMode:mode,quantity:100,unitId:'u_m3',unitSymbol:'m³',materialIds:mode==='manual'?[]:['m_concrete']});
    return mode==='automatic'?computeContractUsage(target,[load({quantity:used})],[]):computeContractUsage(target,[],[],[entry({amount:used})]);
  };
  for(const {mode} of cases){
    it(`${mode}: none below 90%, near at 90%, full at 100%, over above, judged on the true ratio`,()=>{
      expect(at(mode,89.96).warning).toBe('none');
      expect(at(mode,89.96).percentUsed).toBe(90);
      expect(at(mode,90).warning).toBe('near');
      expect(at(mode,100).warning).toBe('full');
      expect(at(mode,120)).toMatchObject({warning:'over',overContract:true,overBy:20,remaining:0});
    });
  }
});

describe('site entries as of a date',()=>{
  const target=item();
  const entries=[entry({id:'e1',entryDate:'2026-10-10',amount:100}),entry({id:'e2',entryDate:'2026-10-12',amount:50,createdAt:'2026-10-20T08:00:00.000Z'})];
  it('follows the day of the entry, not the day it was typed',()=>{
    const progress=dailyContractProgress([{item:target,loads:[],adjustments:[],siteEntries:entries}],'2026-10-12');
    expect(progress.targets).toHaveLength(1);
    expect(progress.targets[0]).toMatchObject({usedToday:50});
    expect(progress.targets[0]!.usage.used).toBe(150);
    const earlier=dailyContractProgress([{item:target,loads:[],adjustments:[],siteEntries:entries}],'2026-10-11');
    expect(earlier.targets).toHaveLength(0);
    expect(earlier.summary.overallPercentUsed).toBeCloseTo(8.3,1);
  });
  it('splits the Company Daily Report row into before today and today',()=>{
    const rows=dailyContractTargetTable([{item:target,loads:[],adjustments:[],siteEntries:entries}],'2026-10-12');
    expect(rows[0]).toMatchObject({usedBefore:100,usedToday:50,used:150});
  });
  it('gives the Totals PDF the same used figure as the target page',()=>{
    const [row]=contractTotalsTargets([{item:target,loads:[],adjustments:[],siteEntries:entries}],null);
    expect(row).toMatchObject({counted:150,percentUsed:12.5});
    expect(contractTotalsTargets([{item:target,loads:[],adjustments:[],siteEntries:entries}],'2026-10-10')[0]).toMatchObject({counted:100});
  });
});

describe('saving rules per mode',()=>{
  const draft=(over:Record<string,unknown>={})=>({name:'T',unitId:'u',quantity:'10',unitPriceUsd:'',materialIds:[] as string[],...over}) as never;
  it('AUTOMATIC still needs at least one material (and is the default)',()=>{
    expect(validateContractItemDraft(draft())).toMatchObject({ok:false,errors:['Link at least one material.']});
    expect(validateContractItemDraft(draft({trackingMode:'automatic'}))).toMatchObject({ok:false});
    expect(validateContractItemDraft(draft({materialIds:['m']}))).toMatchObject({ok:true,value:{trackingMode:'automatic'}});
  });
  it('LINKED MANUAL saves with or without materials',()=>{
    expect(validateContractItemDraft(draft({trackingMode:'linked_manual'}))).toMatchObject({ok:true,value:{trackingMode:'linked_manual',materialIds:[]}});
    expect(validateContractItemDraft(draft({trackingMode:'linked_manual',materialIds:['m']}))).toMatchObject({ok:true,value:{materialIds:['m']}});
  });
  it('MANUAL saves with no material and refuses one',()=>{
    expect(validateContractItemDraft(draft({trackingMode:'manual'}))).toMatchObject({ok:true,value:{trackingMode:'manual',materialIds:[]}});
    expect(validateContractItemDraft(draft({trackingMode:'manual',materialIds:['m']}))).toMatchObject({ok:false,errors:['A Manual target has no material. Choose Linked manual to keep one for reference.']});
  });
});

describe('validating a site entry',()=>{
  const ok={date:'2026-10-20',amount:'120',note:''};
  const context={today:'2026-10-24',earliest:'2026-08-01',used:100};
  it('accepts a positive amount with no note',()=>{
    expect(validateSiteEntry(ok,context)).toEqual({date:'2026-10-20',amount:120,note:null});
    expect(validateSiteEntry({...ok,amount:'1,5',note:'  Block   4 '},context)).toEqual({date:'2026-10-20',amount:1.5,note:'Block 4'});
  });
  it('refuses zero and text, a future day, a bad date and a day before the project began',()=>{
    expect(()=>validateSiteEntry({...ok,amount:'0'},context)).toThrow('other than zero');
    expect(()=>validateSiteEntry({...ok,amount:'abc'},context)).toThrow('other than zero');
    expect(()=>validateSiteEntry({...ok,date:'2026-10-25'},context)).toThrow('today or a past day');
    expect(()=>validateSiteEntry({...ok,date:'2026-02-30'},context)).toThrow('valid day');
    expect(()=>validateSiteEntry({...ok,date:'2026-07-31'},context)).toThrow('before the project');
  });
  it('requires a reason for a negative correction and refuses one that takes used below zero',()=>{
    expect(()=>validateSiteEntry({...ok,amount:'-10'},context)).toThrow('reason');
    expect(validateSiteEntry({...ok,amount:'-10',note:'Counted twice'},context)).toEqual({date:'2026-10-20',amount:-10,note:'Counted twice'});
    expect(()=>validateSiteEntry({...ok,amount:'-101',note:'x'},context)).toThrow('below zero');
  });
});
