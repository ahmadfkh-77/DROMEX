import {describe,expect,it} from 'vitest';

import {
  computeContractUsage,contractHistoryDetail,contractModeChangeSummary,contractTotalsTargets,planTrackingModeChange,
  type ContractItem,type ContractLoad,type ContractModeChange,type ContractSiteEntry,
} from '../src/domain/contractQuantities';

/**
 * DEC-556, Phase 3. Switching how a target's used quantity is tracked. Automatic to a manual mode freezes the calculated value as an opening
 * entry (never a reset to zero). A manual mode back to Automatic must be confirmed first, because the site entries then stop counting (they
 * stay in the database). Figures for dates before a switch keep reading the way the target was tracked then.
 */
const item=(over:Partial<ContractItem>={}):ContractItem=>({
  id:'ci1',projectId:'p1',name:'Curb installed',unitId:'u_m',unitSymbol:'m',quantity:1200,unitPriceUsd:null,materialIds:['m_concrete'],
  status:'in_progress',completedOn:null,cancelledAt:null,trackingMode:'automatic',...over,
});
const load=(over:Partial<ContractLoad>={}):ContractLoad=>({id:'l1',source:'company',reference:'L-1',materialId:'m_concrete',unitId:'u_m',unitSymbol:'m',quantity:12,date:'2026-10-10',status:'Active',contractItemId:'ci1',...over});
const entry=(over:Partial<ContractSiteEntry>={}):ContractSiteEntry=>({id:'e1',contractItemId:'ci1',kind:'entry',entryDate:'2026-10-16',amount:5,note:null,createdAt:'2026-10-16T08:00:00.000Z',...over});
const adjustment={id:'a1',contractItemId:'ci1',amount:-2,reason:'Re-counted',createdAt:'2026-10-11T08:00:00.000Z'};
const today='2026-10-24';
const plan=(target:ContractItem,to:ContractItem['trackingMode'],extra:{loads?:ContractLoad[];entries?:ContractSiteEntry[];fromLoads?:number|null}={})=>{
  const usage=computeContractUsage(target,extra.loads??[],[adjustment],extra.entries??[]);
  return planTrackingModeChange(target,usage,to!,{today,calculatedFromLoads:extra.fromLoads===undefined?null:extra.fromLoads});
};

describe('freezing when a target becomes manual',()=>{
  it('automatic to linked manual carries the loads quantity as an opening entry; used does not change',()=>{
    const result=plan(item(),'linked_manual',{loads:[load({quantity:12}),load({id:'l2',quantity:8})]});
    expect(result).toMatchObject({from:'automatic',to:'linked_manual',opening:{amount:20,date:today},discards:null,startsNewSegment:false,needsConfirm:false,usedBefore:18,usedAfter:18});
    expect(result.opening!.note).toMatch(/switched from Automatic/);
  });
  it('the opening entry plus the existing adjustments equal the used before the switch, never zero',()=>{
    const target=item(),loads=[load({quantity:20})];
    const result=plan(target,'linked_manual',{loads});
    const after=computeContractUsage({...target,trackingMode:'linked_manual'},loads,[adjustment],[entry({kind:'opening',entryDate:today,amount:result.opening!.amount})]);
    expect(after.used).toBe(result.usedBefore);
    expect(after.used).toBeGreaterThan(0);
  });
  it('has no opening entry when nothing was counted from loads',()=>{
    expect(plan(item(),'linked_manual').opening).toBeNull();
  });
  it('refuses automatic to manual while materials are linked, and points to linked manual',()=>{
    expect(()=>plan(item(),'manual')).toThrow('Switch to Linked manual');
    expect(plan(item({materialIds:[]}),'manual',{loads:[]}).opening).toBeNull();
  });
});

describe('going back to automatic',()=>{
  const lm=(over:Partial<ContractItem>={})=>item({trackingMode:'linked_manual',...over});
  it('needs a linked material',()=>{
    expect(()=>plan(lm({materialIds:[]}),'automatic',{fromLoads:30})).toThrow('Link at least one material');
  });
  it('warns that the entries stop counting, with their number and total, and needs confirmation',()=>{
    const result=plan(lm(),'automatic',{entries:[entry({amount:100}),entry({id:'e2',amount:50})],fromLoads:30});
    expect(result).toMatchObject({from:'linked_manual',to:'automatic',opening:null,discards:{count:2,total:150},startsNewSegment:true,needsConfirm:true,usedBefore:148,usedAfter:28});
  });
  it('counts an opening entry among the entries that stop counting',()=>{
    const result=plan(lm(),'automatic',{entries:[entry({kind:'opening',amount:20,entryDate:'2026-10-15'}),entry({amount:5})],fromLoads:25});
    expect(result.discards).toEqual({count:2,total:25});
  });
  it('needs no confirmation when there are no entries to stop counting',()=>{
    const result=plan(lm(),'automatic',{fromLoads:30});
    expect(result).toMatchObject({discards:null,needsConfirm:false,startsNewSegment:true,usedAfter:28});
  });
});

describe('moving between the two manual modes and refusals',()=>{
  it('keeps every entry when moving between linked manual and manual',()=>{
    const result=plan(item({trackingMode:'manual',materialIds:[]}),'linked_manual',{entries:[entry()]});
    expect(result).toMatchObject({discards:null,opening:null,startsNewSegment:false,needsConfirm:false,usedBefore:3,usedAfter:3});
    expect(()=>plan(item({trackingMode:'linked_manual'}),'manual',{entries:[entry()]})).toThrow('no material');
  });
  it('refuses the same mode and a cancelled target',()=>{
    expect(()=>plan(item(),'automatic')).toThrow('already tracked');
    expect(()=>plan(item({cancelledAt:'2026-10-01T00:00:00.000Z'}),'linked_manual')).toThrow('cancelled');
  });
});

describe('figures for dates before a switch keep reading the way the target was tracked then',()=>{
  const changes:ContractModeChange[]=[{day:'2026-10-15',from:'automatic',to:'linked_manual'}];
  const target=item({trackingMode:'linked_manual'});
  const entries=[entry({id:'o',kind:'opening',entryDate:'2026-10-15',amount:12,note:'Calculated from loads when switched from Automatic'}),entry({id:'e',entryDate:'2026-10-16',amount:5})];
  const used=(asOf:string|null)=>contractTotalsTargets([{item:target,loads:[load({quantity:12})],adjustments:[],siteEntries:entries,modeChanges:changes}],asOf)[0]!.counted;
  it('reads the loads before the switch day, the opening entry from it, and then the entries',()=>{
    expect(used('2026-10-12')).toBe(12);
    expect(used('2026-10-15')).toBe(12);
    expect(used('2026-10-16')).toBe(17);
    expect(used(null)).toBe(17);
  });
  it('never counts the loads and the opening entry together',()=>{
    for(const day of ['2026-10-10','2026-10-14','2026-10-15','2026-10-20',null])expect(used(day)).toBeLessThanOrEqual(17);
  });
  it('after a return to automatic, the earlier segment counts only for its own dates',()=>{
    const back:ContractModeChange[]=[...changes,{day:'2026-10-20',from:'linked_manual',to:'automatic'}];
    const automatic=item({trackingMode:'automatic'});
    const read=(asOf:string|null)=>contractTotalsTargets([{item:automatic,loads:[load({quantity:12}),load({id:'l2',quantity:3,date:'2026-10-18'})],adjustments:[],siteEntries:entries.map(value=>({...value,segment:1})),modeChanges:back}],asOf)[0]!.counted;
    expect(read('2026-10-17')).toBe(17);
    expect(read('2026-10-19')).toBe(17);
    expect(read('2026-10-20')).toBe(15);
    expect(read(null)).toBe(15);
  });
  it('is unchanged for a target that never switched',()=>{
    const plain=item();
    expect(contractTotalsTargets([{item:plain,loads:[load({quantity:12})],adjustments:[],siteEntries:[],modeChanges:[]}],'2026-10-12')[0]!.counted).toBe(12);
  });
});

describe('words for the mode-switch screens',()=>{
  const base={from:'automatic' as const,to:'linked_manual' as const,opening:null,discards:null,startsNewSegment:false,needsConfirm:false,usedBefore:18,usedAfter:18};
  it('says used does not change and names the opening value when loads are carried over',()=>{
    expect(contractModeChangeSummary({...base,opening:{amount:19.5,date:today,note:'x'}},'t')).toEqual({tone:'green',headline:'Used does not change.',body:'The 19.5 t counted from loads is kept as the starting point (Opening value), then you add site entries on top.'});
  });
  it('warns in red with the number and total of entries that stop counting',()=>{
    const result=contractModeChangeSummary({...base,from:'linked_manual',to:'automatic',discards:{count:2,total:29.5},needsConfirm:true,usedBefore:29.5,usedAfter:19.5,startsNewSegment:true},'m');
    expect(result.tone).toBe('red');
    expect(result.headline).toBe('2 site entries (29.5 m) will stop counting.');
    expect(result.body).toContain('never deleted');
    expect(contractModeChangeSummary({...base,from:'linked_manual',to:'automatic',discards:{count:1,total:5}},'m').headline).toBe('1 site entry (5 m) will stop counting.');
  });
  it('has a calm line when nothing is lost',()=>{
    expect(contractModeChangeSummary({...base,from:'manual',to:'linked_manual'},'m').tone).toBe('blue');
    expect(contractModeChangeSummary({...base,from:'linked_manual',to:'automatic'},'m').headline).toBe('Used is calculated from the loads again.');
  });
  it('describes a tracking change in the history and nothing else',()=>{
    expect(contractHistoryDetail('edited',{changes:{trackingMode:{from:'automatic',to:'linked_manual'}},usedBefore:18,usedAfter:18})).toBe('Tracking: AUTOMATIC → LINKED MANUAL · Used 18 → 18');
    expect(contractHistoryDetail('edited',{changes:{name:{from:'a',to:'b'}}})).toBeNull();
    expect(contractHistoryDetail('created',{})).toBeNull();
  });
});
