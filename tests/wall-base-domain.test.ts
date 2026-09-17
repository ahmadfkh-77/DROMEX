import {describe,expect,it} from 'vitest';

import {
  baseStatusLabels,calculateBaseVolume,describeWallStageLock,validateBaseLifecycle,validateBaseStatusChange,validateWallBase,validateWallWorkDate,
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
    expect(describeWallStageLock(curing,false).locked).toBe(true);
    expect(validateBaseStatusChange(curing,{status:'cured'})).toContain('Record the date the base was confirmed cured.');
    expect(validateBaseStatusChange(curing,{status:'cured',curedOn:'2026-09-08',inspected:false})).toContain('Confirm that the base was inspected and is ready for wall work.');
    expect(validateBaseStatusChange(curing,{status:'cured',curedOn:'2026-09-08',inspected:true})).toEqual([]);
  });

  it('refuses reverting a cured base while wall work exists, and allows it when none does',()=>{
    expect(validateBaseStatusChange(cured,{status:'curing',curingStartedOn:'2026-09-01'},{wallActivity:true})).toContain('Wall work is already recorded above this base, so it cannot return to curing. Correct the wall records first.');
    expect(validateBaseStatusChange(cured,{status:'curing',curingStartedOn:'2026-09-01'},{wallActivity:false})).toEqual([]);
  });
});

describe('wall stage locking',()=>{
  it('locks wall work until the base is explicitly cured, and explains why',()=>{
    expect(describeWallStageLock(null,false)).toMatchObject({locked:true,reason:'Record the base for this wall before recording wall construction.'});
    expect(describeWallStageLock(base(),false)).toMatchObject({locked:true,reason:'Wall construction is locked until the base is confirmed cured. The base is planned.'});
    expect(describeWallStageLock(base({status:'curing',constructedOn:'2026-09-01',curingStartedOn:'2026-09-01'}),false).reason).toContain('curing');
    expect(describeWallStageLock(cured,false)).toMatchObject({locked:false});
  });

  it('leaves a legacy wall usable and says its base was never recorded',()=>{
    expect(describeWallStageLock(null,true)).toMatchObject({locked:false,legacy:true,reason:'Base not recorded — legacy wall'});
  });

  it('refuses wall work dated before the base was cured',()=>{
    expect(validateWallWorkDate('2026-09-07',cured,false)).toBe('Wall work cannot be dated before the base was confirmed cured on 2026-09-08.');
    expect(validateWallWorkDate('2026-09-08',cured,false)).toBeNull();
    expect(validateWallWorkDate('2026-09-09',cured,false)).toBeNull();
    expect(validateWallWorkDate('2026-09-01',null,true)).toBeNull();
    expect(validateWallWorkDate('2026-09-09',base(),false)).toContain('locked until the base is confirmed cured');
  });
});
