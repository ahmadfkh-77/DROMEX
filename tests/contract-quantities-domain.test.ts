import {describe,expect,it} from 'vitest';

import {
  applyContractItemEdit,cancelContractItem,candidateContractItems,computeContractUsage,finishContractItem,reopenContractItem,
  summarizeContractProject,validateContractAdjustment,validateContractItemDraft,validateContractReason,
  type ContractAdjustment,type ContractItem,type ContractLoad,
} from '../src/domain/contractQuantities';

const NOW=new Date('2026-10-24T09:00:00.000Z');
const item=(over:Partial<ContractItem>={}):ContractItem=>({
  id:'ci1',projectId:'p1',name:'Base course',unitId:'u_m3',unitSymbol:'m³',quantity:50,unitPriceUsd:20,materialIds:['m_base'],
  status:'in_progress',completedOn:null,cancelledAt:null,...over,
});
const load=(over:Partial<ContractLoad>={}):ContractLoad=>({
  id:'l1',source:'company',reference:'L-1',materialId:'m_base',unitId:'u_m3',unitSymbol:'m³',quantity:10,date:'2026-10-10',status:'Active',contractItemId:'ci1',...over,
});
const adj=(over:Partial<ContractAdjustment>={}):ContractAdjustment=>({id:'a1',contractItemId:'ci1',amount:-2,reason:'Left over',createdAt:'2026-10-11T08:00:00.000Z',...over});

describe('contract usage',()=>{
  it('adds active linked company and supplier loads and reports allowed, used, remaining and percent',()=>{
    const usage=computeContractUsage(item(),[load({quantity:10}),load({id:'l2',source:'supplier',quantity:15.5})],[]);
    expect(usage).toMatchObject({allowed:50,fromLoads:25.5,adjustmentsTotal:0,used:25.5,remaining:24.5,percentUsed:51,overContract:false,overBy:0,warning:'none'});
  });
  it('leaves out cancelled loads, so cancelling reverses use',()=>{
    const usage=computeContractUsage(item(),[load({quantity:10}),load({id:'l2',status:'Cancelled',quantity:30})],[]);
    expect(usage.fromLoads).toBe(10);
    expect(usage.notCounted).toEqual([]);
  });
  it('ignores loads linked to another item or to none',()=>{
    const usage=computeContractUsage(item(),[load(),load({id:'l2',contractItemId:'other'}),load({id:'l3',contractItemId:null})],[]);
    expect(usage.fromLoads).toBe(10);
  });
  it('never counts a load whose unit differs and lists it as not counted, unit differs',()=>{
    const usage=computeContractUsage(item(),[load({id:'l2',unitId:'u_t',unitSymbol:'t',quantity:7})],[]);
    expect(usage.fromLoads).toBe(0);
    expect(usage.notCounted).toEqual([expect.objectContaining({reason:'unit_differs',load:expect.objectContaining({id:'l2'})})]);
  });
  it('lists a load without a quantity as not counted',()=>{
    const usage=computeContractUsage(item(),[load({id:'l2',quantity:null}),load({id:'l3',quantity:0})],[]);
    expect(usage.fromLoads).toBe(0);
    expect(usage.notCounted.map(entry=>entry.reason)).toEqual(['no_quantity','no_quantity']);
  });
  it('shows adjustments separately and adds them to the used total, never changing the loads',()=>{
    const usage=computeContractUsage(item(),[load({quantity:40})],[adj({amount:-5}),adj({id:'a2',amount:1.5,reason:'Re-counted'})]);
    expect(usage).toMatchObject({fromLoads:40,adjustmentsTotal:-3.5,used:36.5,remaining:13.5});
    expect(usage.adjustments).toHaveLength(2);
  });
  it('reversing an adjustment is a new adjustment; the original stays listed',()=>{
    const usage=computeContractUsage(item(),[load({quantity:40})],[adj({amount:-5}),adj({id:'a2',amount:5,reason:'Entered by mistake'})]);
    expect(usage.adjustmentsTotal).toBe(0);
    expect(usage.adjustments.map(value=>value.id)).toEqual(['a1','a2']);
  });
  it('warns at 90 percent, at 100 percent and over, using the true ratio rather than the rounded one',()=>{
    expect(computeContractUsage(item(),[load({quantity:44.9})],[]).warning).toBe('none');
    expect(computeContractUsage(item(),[load({quantity:44.9})],[]).percentUsed).toBe(89.8);
    expect(computeContractUsage(item(),[load({quantity:44.99})],[]).warning).toBe('none');
    expect(computeContractUsage(item(),[load({quantity:45})],[]).warning).toBe('near');
    expect(computeContractUsage(item(),[load({quantity:49.99})],[]).warning).toBe('near');
    expect(computeContractUsage(item(),[load({quantity:50})],[]).warning).toBe('full');
    const over=computeContractUsage(item(),[load({quantity:57.5})],[]);
    expect(over).toMatchObject({warning:'over',overContract:true,overBy:7.5,remaining:0,percentUsed:115});
  });
  it('shows the value used and remaining only with a contract price',()=>{
    expect(computeContractUsage(item(),[load({quantity:10})],[])).toMatchObject({valueUsedUsd:200,valueRemainingUsd:800,contractValueUsd:1000,valueOverUsd:0});
    expect(computeContractUsage(item(),[load({quantity:57.5})],[])).toMatchObject({valueOverUsd:150});
    expect(computeContractUsage(item({unitPriceUsd:null}),[load({quantity:57.5})],[])).toMatchObject({contractValueUsd:null,valueOverUsd:null});
    expect(computeContractUsage(item({unitPriceUsd:null}),[load({quantity:10})],[])).toMatchObject({valueUsedUsd:null,valueRemainingUsd:null});
  });
});

describe('finishing with leftover',()=>{
  it('an in-progress item shows its remaining as an estimated saving only with a price',()=>{
    expect(computeContractUsage(item(),[load({quantity:40})],[])).toMatchObject({leftover:10,savingUsd:200,savingIsEstimate:true});
    expect(computeContractUsage(item({unitPriceUsd:null}),[load({quantity:40})],[])).toMatchObject({leftover:10,savingUsd:null,savingIsEstimate:true});
  });
  it('a finished item records the leftover and its saving as final, with the true used quantity unchanged',()=>{
    const finished=item({status:'complete',completedOn:'2026-10-20'});
    const usage=computeContractUsage(finished,[load({quantity:40})],[]);
    expect(usage).toMatchObject({used:40,percentUsed:80,leftover:10,savingUsd:200,savingIsEstimate:false,lateLoads:[]});
  });
  it('a finished item that went over has no leftover and no saving',()=>{
    const usage=computeContractUsage(item({status:'complete',completedOn:'2026-10-20'}),[load({quantity:52})],[]);
    expect(usage).toMatchObject({leftover:0,savingUsd:0,overBy:2,warning:'over'});
  });
  it('a load dated after Finish still counts and the item is flagged',()=>{
    const finished=item({status:'complete',completedOn:'2026-10-20'});
    const usage=computeContractUsage(finished,[load({quantity:40}),load({id:'l2',quantity:5,date:'2026-10-22'})],[]);
    expect(usage).toMatchObject({used:45,leftover:5,savingUsd:100});
    expect(usage.lateLoads.map(value=>value.id)).toEqual(['l2']);
  });
  it('finish records the date and the leftover in the history, and needs an in-progress item',()=>{
    const usage=computeContractUsage(item(),[load({quantity:40})],[]);
    const result=finishContractItem(item(),usage,'2026-10-20',NOW);
    expect(result.item).toMatchObject({status:'complete',completedOn:'2026-10-20'});
    expect(result.entry).toMatchObject({kind:'finished',contractItemId:'ci1',reason:null,details:{leftover:10,savingUsd:200,used:40}});
    expect(()=>finishContractItem(result.item,usage,'2026-10-21',NOW)).toThrow(/already finished/i);
    expect(()=>finishContractItem(item(),usage,'2026-13-40',NOW)).toThrow(/valid day/i);
  });
  it('reopening needs a reason and keeps the history',()=>{
    const finished=item({status:'complete',completedOn:'2026-10-20'});
    expect(()=>reopenContractItem(finished,'  ',NOW)).toThrow(/reason/i);
    const result=reopenContractItem(finished,' Work continued ',NOW);
    expect(result.item).toMatchObject({status:'in_progress',completedOn:null});
    expect(result.entry).toMatchObject({kind:'reopened',reason:'Work continued',details:{previousCompletedOn:'2026-10-20'}});
    expect(()=>reopenContractItem(item(),'why',NOW)).toThrow(/not finished/i);
  });
});

describe('contract item rules',()=>{
  const draft={name:'Base course',unitId:'u_m3',quantity:'50',unitPriceUsd:'20',materialIds:['m_base']};
  it('accepts a valid draft and normalises it',()=>{
    expect(validateContractItemDraft({...draft,name:'  Base   course '})).toEqual({ok:true,value:{name:'Base course',unitId:'u_m3',quantity:50,unitPriceUsd:20,materialIds:['m_base']}});
    expect(validateContractItemDraft({...draft,unitPriceUsd:''})).toMatchObject({ok:true,value:{unitPriceUsd:null}});
  });
  it('rejects a missing name, unit, quantity of zero or less, a bad price and no material',()=>{
    const errors=(over:object)=>{const result=validateContractItemDraft({...draft,...over});return result.ok?[]:result.errors;};
    expect(errors({name:' '})).toContain('Enter the contract item name.');
    expect(errors({unitId:''})).toContain('Choose the unit.');
    expect(errors({quantity:'0'})).toContain('The contract quantity must be greater than zero.');
    expect(errors({quantity:'-3'})).toContain('The contract quantity must be greater than zero.');
    expect(errors({quantity:'abc'})).toContain('The contract quantity must be greater than zero.');
    expect(errors({unitPriceUsd:'-1'})).toContain('Enter the contract price as a number, zero or more.');
    expect(errors({unitPriceUsd:'x'})).toContain('Enter the contract price as a number, zero or more.');
    expect(errors({materialIds:[]})).toContain('Link at least one material.');
  });
  it('validates a reason, trimming and collapsing spaces',()=>{
    expect(validateContractReason('  too   much ','adjusting')).toBe('too much');
    expect(()=>validateContractReason('   ','adjusting')).toThrow('Enter the reason for adjusting this contract item.');
  });
  it('an adjustment needs a non-zero amount and a reason, and cannot push the used quantity below zero',()=>{
    const usage=computeContractUsage(item(),[load({quantity:10})],[]);
    expect(validateContractAdjustment({amount:'-4',reason:' Not used '},usage)).toEqual({amount:-4,reason:'Not used'});
    expect(()=>validateContractAdjustment({amount:'0',reason:'x'},usage)).toThrow(/other than zero/i);
    expect(()=>validateContractAdjustment({amount:'abc',reason:'x'},usage)).toThrow(/other than zero/i);
    expect(()=>validateContractAdjustment({amount:'-4',reason:''},usage)).toThrow(/reason/i);
    expect(()=>validateContractAdjustment({amount:'-10.5',reason:'x'},usage)).toThrow(/below zero/i);
    expect(validateContractAdjustment({amount:'-10',reason:'x'},usage).amount).toBe(-10);
  });
});

describe('editing is allowed and audited, never an overwrite',()=>{
  it('an edit with no counted loads or adjustments needs no reason and still records before and after',()=>{
    const result=applyContractItemEdit(item(),{quantity:60},{hasHistory:false,reason:'',now:NOW});
    expect(result.item.quantity).toBe(60);
    expect(result.entry).toMatchObject({kind:'edited',reason:null,details:{changes:{quantity:{from:50,to:60}}}});
  });
  it('once loads or adjustments exist, every edit needs a reason and keeps the old values',()=>{
    expect(()=>applyContractItemEdit(item(),{unitPriceUsd:25},{hasHistory:true,reason:'',now:NOW})).toThrow(/reason/i);
    const result=applyContractItemEdit(item(),{unitPriceUsd:25,materialIds:['m_base','m_sub'],unitId:'u_t',unitSymbol:'t',name:'Base'},{hasHistory:true,reason:'Tender revised',now:NOW});
    expect(result.item).toMatchObject({unitPriceUsd:25,materialIds:['m_base','m_sub'],unitId:'u_t',unitSymbol:'t',name:'Base',quantity:50});
    expect(result.entry.reason).toBe('Tender revised');
    expect(result.entry.details).toEqual({changes:{
      name:{from:'Base course',to:'Base'},unitId:{from:'u_m3',to:'u_t'},unitSymbol:{from:'m³',to:'t'},
      unitPriceUsd:{from:20,to:25},materialIds:{from:['m_base'],to:['m_base','m_sub']},
    }});
  });
  it('an edit that changes nothing is refused and an invalid new value is refused',()=>{
    expect(()=>applyContractItemEdit(item(),{quantity:50},{hasHistory:false,reason:'',now:NOW})).toThrow(/nothing to change/i);
    expect(()=>applyContractItemEdit(item(),{quantity:0},{hasHistory:false,reason:'',now:NOW})).toThrow(/greater than zero/i);
    expect(()=>applyContractItemEdit(item(),{materialIds:[]},{hasHistory:false,reason:'',now:NOW})).toThrow(/at least one material/i);
  });
  it('a contract item can be cancelled with a reason and is then left out of the project summary',()=>{
    expect(()=>cancelContractItem(item(),'',NOW)).toThrow(/reason/i);
    const result=cancelContractItem(item(),'Created by mistake',NOW);
    expect(result.item.cancelledAt).toBe(NOW.toISOString());
    expect(result.entry).toMatchObject({kind:'cancelled',reason:'Created by mistake'});
    expect(()=>cancelContractItem(result.item,'again',NOW)).toThrow(/already cancelled/i);
  });
});

describe('choosing the contract item for a load',()=>{
  const a=item({id:'a',materialIds:['m_base']}),b=item({id:'b',materialIds:['m_base','m_sub']}),c=item({id:'c',projectId:'p2',materialIds:['m_base']});
  it('preselects the only candidate, asks when there are several, and saves unlinked when there are none',()=>{
    expect(candidateContractItems([a,c],'p1','m_base')).toEqual({candidates:[a],preselectedId:'a'});
    expect(candidateContractItems([a,b,c],'p1','m_base')).toMatchObject({candidates:[a,b],preselectedId:null});
    expect(candidateContractItems([a,b,c],'p1','m_other')).toEqual({candidates:[],preselectedId:null});
  });
  it('leaves out cancelled items but keeps finished ones visible to choose',()=>{
    const cancelled=item({id:'x',cancelledAt:NOW.toISOString()}),done=item({id:'d',status:'complete',completedOn:'2026-10-01'});
    expect(candidateContractItems([cancelled,done],'p1','m_base').candidates.map(value=>value.id)).toEqual(['d']);
  });
  it('returns nothing for a load with no project',()=>{
    expect(candidateContractItems([a],null,'m_base')).toEqual({candidates:[],preselectedId:null});
  });
});

describe('project summary',()=>{
  const steel=item({id:'s',name:'Steel',unitId:'u_t',unitSymbol:'t',quantity:20,unitPriceUsd:800,materialIds:['m_steel']});
  const asphalt=item({id:'as',name:'Asphalt',unitId:'u_t',unitSymbol:'t',quantity:100,unitPriceUsd:null,materialIds:['m_asph']});
  it('sums the saving of finished items, ranks savings and overruns, and reports the average percent used',()=>{
    const done=item({status:'complete',completedOn:'2026-10-20'});
    const rows=[
      {item:done,usage:computeContractUsage(done,[load({quantity:40})],[])},
      {item:steel,usage:computeContractUsage(steel,[load({id:'s1',contractItemId:'s',materialId:'m_steel',unitId:'u_t',unitSymbol:'t',quantity:24})],[])},
      {item:asphalt,usage:computeContractUsage(asphalt,[load({id:'a1',contractItemId:'as',materialId:'m_asph',unitId:'u_t',unitSymbol:'t',quantity:60})],[])},
    ];
    const summary=summarizeContractProject(rows);
    expect(summary.totalSavingUsd).toBe(200);
    expect(summary.savings.map(value=>value.name)).toEqual(['Base course']);
    expect(summary.overruns.map(value=>[value.name,value.overBy])).toEqual([['Steel',4]]);
    expect(summary.overallPercentUsed).toBe(86.7);
    expect(summary.overallBasis).toBe('items');
    expect(summary.completeCount).toBe(1);
  });
  it('weights by contract value when every item has a price, and reports null with no items',()=>{
    const a=item({quantity:10,unitPriceUsd:10}),b=item({id:'b',quantity:10,unitPriceUsd:30});
    const summary=summarizeContractProject([{item:a,usage:computeContractUsage(a,[load({quantity:10})],[])},{item:b,usage:computeContractUsage(b,[load({id:'l9',contractItemId:'b',quantity:5})],[])}]);
    expect(summary.overallBasis).toBe('value');
    expect(summary.overallPercentUsed).toBe(62.5);
    expect(summarizeContractProject([])).toMatchObject({overallPercentUsed:null,totalSavingUsd:0,savings:[],overruns:[]});
  });
  it('leaves cancelled items out and never counts an in-progress estimate in the total saving',()=>{
    const cancelled=item({id:'x',cancelledAt:NOW.toISOString()});
    const summary=summarizeContractProject([{item:cancelled,usage:computeContractUsage(cancelled,[],[])},{item:item(),usage:computeContractUsage(item(),[load({quantity:40})],[])}]);
    expect(summary.totalSavingUsd).toBe(0);
    expect(summary.estimatedSavingUsd).toBe(200);
    expect(summary.itemCount).toBe(1);
  });
});

describe('loads counted, grouped by day',()=>{
  it('groups active linked loads by day, newest first, totals only the counted ones and keeps cancelled apart',async()=>{
    const {groupContractLoadsByDay}=await import('../src/domain/contractQuantities');
    const loads=[
      load({id:'a',date:'2026-10-22',quantity:20}),load({id:'b',date:'2026-10-22',quantity:18,source:'supplier'}),
      load({id:'c',date:'2026-10-14',quantity:20}),load({id:'d',date:'2026-10-14',quantity:22,unitId:'u_t',unitSymbol:'t'}),
      load({id:'e',date:'2026-10-20',quantity:5,status:'Cancelled'}),load({id:'f',date:'2026-10-21',contractItemId:'other'}),
    ];
    const {days,cancelled}=groupContractLoadsByDay(item(),loads);
    expect(days.map(day=>[day.day,day.countedQuantity,day.countedCount,day.notCountedCount])).toEqual([['2026-10-22',38,2,0],['2026-10-14',20,1,1]]);
    expect(days[1]!.loads.map(entry=>[entry.load.id,entry.notCountedReason])).toEqual([['c',null],['d','unit_differs']]);
    expect(cancelled.map(value=>value.id)).toEqual(['e']);
  });
});

describe('words for the screens',()=>{
  it('describes what an edit changes, in the item units',async()=>{
    const {contractChangeLines}=await import('../src/domain/contractQuantities');
    expect(contractChangeLines(item(),{name:'Base course',unitId:'u_m3',unitSymbol:'m³',quantity:550,unitPriceUsd:20,materialIds:['m_base']},{m_base:'BaseCourse 0/40'})).toEqual(['Contract quantity 50 → 550 m³']);
    expect(contractChangeLines(item(),{name:'Base',unitId:'u_t',unitSymbol:'t',quantity:50,unitPriceUsd:null,materialIds:['m_base','m_sub']},{m_base:'BaseCourse 0/40',m_sub:'Sub-base'})).toEqual([
      'Name Base course → Base','Unit m³ → t','Contract price $20.00 → not set','Materials added: Sub-base',
    ]);
    expect(contractChangeLines(item(),{name:'Base course',unitId:'u_m3',unitSymbol:'m³',quantity:50,unitPriceUsd:20,materialIds:[]},{m_base:'BaseCourse 0/40'})).toEqual(['Materials removed: BaseCourse 0/40']);
  });
  it('labels every history line',async()=>{
    const {contractHistoryLabel}=await import('../src/domain/contractQuantities');
    expect(['created','edited','finished','reopened','cancelled','adjusted','load_linked','load_moved','load_unlinked'].map(kind=>contractHistoryLabel(kind as never))).toEqual([
      'Created','Edited','Finished','Reopened','Cancelled','Adjusted','Load linked','Load moved','Load removed',
    ]);
  });
});

describe('the Adjust dialog preview',()=>{
  it('shows Used and percent after the amount, signed by the chosen direction',async()=>{
    const {adjustmentPreview}=await import('../src/domain/contractQuantities');
    expect(adjustmentPreview({used:455,allowed:500},'take','3')).toEqual({amount:'-3',usedAfter:452,percentAfter:90.4});
    expect(adjustmentPreview({used:455,allowed:500},'add','2,5')).toEqual({amount:'2.5',usedAfter:457.5,percentAfter:91.5});
    expect(adjustmentPreview({used:455,allowed:500},'add','')).toBeNull();
    expect(adjustmentPreview({used:455,allowed:500},'take','-4')).toBeNull();
  });
});
