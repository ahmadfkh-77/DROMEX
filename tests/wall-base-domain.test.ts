import {describe,expect,it} from 'vitest';

import {
  baseStatusLabels,calculateBaseVolume,CURING_WARNING_BODY,CURING_WARNING_TITLE,describeWallStageLock,describeWallWorkDateNotice,validateBaseLifecycle,validateBaseStatusChange,validateWallBase,validateWallWorkDate,
  type WallBase,type WallBaseDraft,
} from '../src/domain/wallBase';
import {calculateWallVolume} from '../src/domain/walls';

const draft=(overrides:Partial<WallBaseDraft>={}):WallBaseDraft=>({wallId:'wall',reference:'Base A',location:'Km 2+150',lengthM:22,heightM:.8,bottomThicknessM:1.2,topThicknessM:1.2,deductionM3:0,materialType:'ready_mix',concretePurpose:'footing',customPurposeId:null,quantity:21.12,quantityUnit:'m3',manualOverride:false,consumptionDate:'2026-09-01',notes:'',...overrides});
const base=(overrides:Partial<WallBase>={}):WallBase=>({...draft(),id:'base',customPurposeLabel:null,grossVolumeM3:21.12,netVolumeM3:21.12,status:'planned',constructedOn:null,curingStartedOn:null,curedOn:null,curingNote:'',correctionHistory:[],createdAt:'2026-09-01T06:00:00.000Z',updatedAt:null,...overrides});
const cured=base({status:'cured',constructedOn:'2026-09-01',curingStartedOn:'2026-09-01',curedOn:'2026-09-08'});

describe('base volume',()=>{
  it('uses the same shared formula as the wall, with no separate arithmetic',()=>{
    const result=calculateBaseVolume({lengthM:22,heightM:.8,bottomThicknessM:1.4,topThicknessM:1,deductionM3:1.2});
    const shared=calculateWallVolume(22,.8,1.4,1,1.2);
    expect(result).toEqual({grossVolumeM3:shared.grossVolumeM3,netVolumeM3:shared.netVolumeM3});
    expect(result).toMatchObject({grossVolumeM3:21.12,netVolumeM3:19.92});
  });

  it('handles a constant-thickness base and a tapered one',()=>{
    expect(calculateBaseVolume({lengthM:10,heightM:.5,bottomThicknessM:1,topThicknessM:1,deductionM3:0}).netVolumeM3).toBe(5);
    expect(calculateBaseVolume({lengthM:10,heightM:.5,bottomThicknessM:1.2,topThicknessM:.8,deductionM3:0}).netVolumeM3).toBe(5);
  });

  it('refuses a deduction at or above the gross volume, and invalid dimensions',()=>{
    expect(validateWallBase(draft({deductionM3:21.12}))).toContain('Base deductions must be smaller than the gross base volume.');
    expect(validateWallBase(draft({lengthM:0}))).toContain('Base length must be greater than zero with no more than three decimals.');
    expect(validateWallBase(draft({heightM:-1}))).toContain('Base height must be greater than zero with no more than three decimals.');
    expect(validateWallBase(draft({bottomThicknessM:Number.NaN}))).toContain('Base bottom thickness must be greater than zero with no more than three decimals.');
    expect(validateWallBase(draft({deductionM3:-2}))).toContain('Base deductions must be zero or more with no more than three decimals.');
  });

  it('requires a reference, a material, and a purpose for concrete',()=>{
    expect(validateWallBase(draft({reference:'  '}))).toContain('Enter a base reference or description.');
    expect(validateWallBase(draft({concretePurpose:null}))).toContain('Choose the concrete / mortar purpose for the base.');
    expect(validateWallBase(draft({materialType:'stone',concretePurpose:null,quantityUnit:'tonnes',quantity:40,manualOverride:true}))).toEqual([]);
    expect(validateWallBase(draft({concretePurpose:'footing',customPurposeId:'p1'}))).toContain('Choose one concrete / mortar purpose.');
  });

  it('accepts a manual quantity override and keeps the calculated volume beside it',()=>{
    expect(validateWallBase(draft({quantity:23,manualOverride:true}))).toEqual([]);
    expect(validateWallBase(draft({quantity:23,manualOverride:false}))).toContain('The recorded quantity differs from the calculated volume. Confirm it as a manual override.');
    expect(validateWallBase(draft({quantity:0,manualOverride:true}))).toContain('Base quantity must be greater than zero.');
    // Tonnes are allowed only as a deliberate manual override, never as the calculated figure.
    expect(validateWallBase(draft({quantityUnit:'tonnes',manualOverride:false}))).toContain('A calculated base volume is in m³. Set the unit to m³ or record it as a manual override with its own unit.');
    expect(validateWallBase(draft({quantityUnit:'tonnes',quantity:48,manualOverride:true}))).toEqual([]);
  });
});

describe('base lifecycle',()=>{
  it('labels every status',()=>{
    expect(Object.keys(baseStatusLabels)).toEqual(['planned','constructed','curing','cured']);
  });

  it('allows only the forward transitions, each with its own date',()=>{
    expect(validateBaseStatusChange(base(),{status:'constructed',constructedOn:'2026-09-01'})).toEqual([]);
    expect(validateBaseStatusChange(base({status:'constructed',constructedOn:'2026-09-01'}),{status:'curing',curingStartedOn:'2026-09-01'})).toEqual([]);
    expect(validateBaseStatusChange(base({status:'curing',constructedOn:'2026-09-01',curingStartedOn:'2026-09-01'}),{status:'cured',curedOn:'2026-09-08',inspected:true})).toEqual([]);
    expect(validateBaseStatusChange(base(),{status:'cured',curedOn:'2026-09-08'})).toContain('A base moves from planned to constructed, then curing, then cured.');
    expect(validateBaseStatusChange(base(),{status:'curing',curingStartedOn:'2026-09-01'})).toContain('A base moves from planned to constructed, then curing, then cured.');
    expect(validateBaseStatusChange(base({status:'constructed',constructedOn:'2026-09-01'}),{status:'constructed',constructedOn:'2026-09-02'})).toContain('A base moves from planned to constructed, then curing, then cured.');
  });

  it('requires each date and keeps them in order',()=>{
    expect(validateBaseStatusChange(base(),{status:'constructed'})).toContain('Record the construction or pour date.');
    expect(validateBaseStatusChange(base({status:'constructed',constructedOn:'2026-09-05'}),{status:'curing',curingStartedOn:'2026-09-04'})).toContain('Curing cannot start before the base was constructed.');
    expect(validateBaseStatusChange(base({status:'curing',constructedOn:'2026-09-01',curingStartedOn:'2026-09-02'}),{status:'cured',curedOn:'2026-09-01'})).toContain('The cured date cannot be before curing started.');
    // A cured date before both earlier dates is two separate problems, and both are reported.
    expect(validateBaseLifecycle(base({status:'cured',constructedOn:'2026-09-05',curingStartedOn:'2026-09-06',curedOn:'2026-09-04'}))).toHaveLength(2);
    expect(validateBaseLifecycle(cured)).toEqual([]);
  });

  it('never cures a base by elapsed time alone',()=>{
    const curing=base({status:'curing',constructedOn:'2026-09-01',curingStartedOn:'2026-09-01'});
    expect(validateBaseStatusChange(curing,{status:'cured'})).toContain('Record the date the base was confirmed cured.');
    expect(validateBaseStatusChange(curing,{status:'cured',curedOn:'2026-09-08',inspected:false})).toContain('Confirm that the base was inspected and is ready for wall work.');
    expect(validateBaseStatusChange(curing,{status:'cured',curedOn:'2026-09-08',inspected:true})).toEqual([]);
  });

  // DEC-463. Curing is informational: reverting a cured base to curing never blocks or invalidates wall work.
  it('allows reverting a cured base back to curing regardless of whether wall work already exists',()=>{
    expect(validateBaseStatusChange(cured,{status:'curing',curingStartedOn:'2026-09-01'})).toEqual([]);
  });
});

// DEC-463. Curing status is tracked information, not a workflow gate: the only thing that still
// blocks wall work is a missing base, never the base's curing status.
describe('wall stage — curing is informational, never a lock',()=>{
  it('locks wall work only when a base is required and none has been recorded yet',()=>{
    expect(describeWallStageLock(null,false)).toMatchObject({locked:true,reason:'Record the base for this wall before recording wall construction.'});
    expect(validateWallWorkDate(null,false)).toBe('Record the base for this wall before recording wall construction.');
  });

  it.each(['planned','constructed','curing','cured'] as const)('never locks wall work once a base exists, in %s status',status=>{
    const value=base({status,constructedOn:status==='planned'?null:'2026-09-01',curingStartedOn:status==='planned'||status==='constructed'?null:'2026-09-01',curedOn:status==='cured'?'2026-09-08':null});
    expect(describeWallStageLock(value,false)).toMatchObject({locked:false});
    expect(validateWallWorkDate(value,false)).toBeNull();
  });

  it('leaves a legacy wall usable and says its base was never recorded',()=>{
    expect(describeWallStageLock(null,true)).toMatchObject({locked:false,legacy:true,reason:'Base not recorded — legacy wall'});
    expect(validateWallWorkDate(null,true)).toBeNull();
  });

  it('shows a non-blocking curing warning while curing is not yet confirmed, with warning (not error) wording',()=>{
    const planned=describeWallStageLock(base(),false);
    expect(planned).toMatchObject({locked:false,curingConfirmed:false,warningTitle:CURING_WARNING_TITLE,warningBody:CURING_WARNING_BODY});
    expect(planned.warningTitle).not.toMatch(/approved|certified|unsafe/i);
  });

  it('carries no curing warning once cured, or for a legacy wall with no base',()=>{
    expect(describeWallStageLock(cured,false)).toMatchObject({curingConfirmed:true,warningTitle:null,warningBody:null});
    expect(describeWallStageLock(null,true)).toMatchObject({warningTitle:null,warningBody:null});
  });

  it('accepts a wall work date before, during, and after the curing period, never refusing it for chronology',()=>{
    expect(validateWallWorkDate(cured,false)).toBeNull();
    expect(validateWallWorkDate(base({status:'curing',constructedOn:'2026-09-01',curingStartedOn:'2026-09-01'}),false)).toBeNull();
    expect(validateWallWorkDate(base(),false)).toBeNull(); // planned — not cured, but never refused
  });

  it('gives a non-blocking chronology notice only when curing is not confirmed, and none once cured',()=>{
    expect(describeWallWorkDateNotice('2026-09-02',base({status:'curing',constructedOn:'2026-09-01',curingStartedOn:'2026-09-01'}))).toContain('Base curing not confirmed on this work date');
    expect(describeWallWorkDateNotice('2026-09-09',cured)).toBeNull();
    expect(describeWallWorkDateNotice('2026-09-01',null)).toBeNull();
  });
});
