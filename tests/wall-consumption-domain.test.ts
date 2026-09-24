import {describe,expect,it} from 'vitest';

import {
  builtInConcretePurposes,calculateWallVolume,describeWallConsumptionQuantity,diffWallConsumption,formatVolumeCalculation,
  normalizePurposeLabel,parseWallVolumeInput,purposeKey,summarizeWallConsumption,supportsVolumeCalculation,validateNewPurposeLabel,
  validateWallConsumption,wallConsumptionPurposeLabel,type WallConsumption,type WallConsumptionDraft,
} from '../src/domain/walls';

const base:WallConsumptionDraft={wallId:'wall',usedOn:'2026-09-10',type:'ready_mix',concretePurpose:null,customPurposeId:null,finishedVolumeM3:null,cementBags:null,cementBagKg:null,sandQuantity:null,sandUnit:null,gravelQuantity:null,gravelUnit:null,waterLitres:null,admixtureQuantity:null,admixtureUnit:null,stoneQuantity:null,stoneUnit:null,rebarDiameterMm:null,rebarCount:null,rebarLengthEachM:null,rebarGrade:'',notes:'',volume:null};
const saved=(draft:Partial<WallConsumption>):WallConsumption=>({...base,id:'use',totalRebarLengthM:null,totalRebarKg:null,createdAt:'2026-09-10T08:00:00.000Z',customPurposeLabel:null,correctionHistory:[],updatedAt:null,...draft} as WallConsumption);
const input=(overrides:Partial<Record<'length'|'height'|'bottom'|'top'|'deduction',string>>={})=>({length:'18',height:'4.5',bottom:'0.9',top:'0.5',deduction:'',...overrides});

describe('wall material volume calculation',()=>{
  it('uses exactly the section 1 wall volume formula, without allowance',()=>{
    const parsed=parseWallVolumeInput(input({deduction:'2.5'}));
    const expected=calculateWallVolume(18,4.5,.9,.5,2.5);
    expect(parsed).toEqual({issues:[],snapshot:{lengthM:18,heightM:4.5,bottomThicknessM:.9,topThicknessM:.5,deductionM3:2.5,grossVolumeM3:expected.grossVolumeM3,netVolumeM3:expected.netVolumeM3}});
    expect(parsed.snapshot).toMatchObject({grossVolumeM3:56.7,netVolumeM3:54.2});
  });

  it('calculates a Stone volume with no deductions',()=>{
    expect(parseWallVolumeInput(input({length:'10',height:'2',bottom:'0.6',top:'0.6'})).snapshot).toMatchObject({grossVolumeM3:12,deductionM3:0,netVolumeM3:12});
  });

  it('accepts a comma decimal separator like the other DROMEX quantity fields',()=>{
    expect(parseWallVolumeInput(input({length:'12,5',height:'2',bottom:'0,4',top:'0,4',deduction:'1,25'})).snapshot?.netVolumeM3).toBe(8.75);
  });

  it('removes floating-point noise with the same nine-decimal rule as section 1',()=>{
    expect(parseWallVolumeInput(input({length:'0.1',height:'0.3',bottom:'1',top:'1'})).snapshot?.grossVolumeM3).toBe(.03);
  });

  it('formats a calculated volume and says when a quantity was entered directly',()=>{
    expect(formatVolumeCalculation(saved({type:'stone',stoneQuantity:54.2,stoneUnit:'m3',volume:{lengthM:18,heightM:4.5,bottomThicknessM:.9,topThicknessM:.5,deductionM3:2.5,grossVolumeM3:56.7,netVolumeM3:54.2}}))).toBe('54.20 m³ net from 18 m × 4.5 m × 0.9 to 0.5 m, less 2.50 m³');
    expect(formatVolumeCalculation(saved({type:'stone',stoneQuantity:9,stoneUnit:'m3'}))).toBe('Entered directly');
    expect(formatVolumeCalculation(saved({type:'rebar',rebarDiameterMm:12,rebarCount:4,rebarLengthEachM:6}))).toBe('Not applicable');
  });

  it('rejects missing, zero, negative, non-numeric, and over-precise dimensions',()=>{
    expect(parseWallVolumeInput(input({length:''})).issues).toContain('Enter the wall length in metres.');
    expect(parseWallVolumeInput(input({top:''})).issues).toContain('Enter the top thickness in metres.');
    expect(parseWallVolumeInput(input({length:'0'})).issues).toContain('Wall length must be greater than zero with no more than three decimals.');
    expect(parseWallVolumeInput(input({height:'-3'})).issues).toContain('Wall height must be greater than zero with no more than three decimals.');
    expect(parseWallVolumeInput(input({bottom:'abc'})).issues).toContain('Bottom thickness must be greater than zero with no more than three decimals.');
    expect(parseWallVolumeInput(input({top:'0.1234'})).issues).toContain('Top thickness must be greater than zero with no more than three decimals.');
    expect(parseWallVolumeInput(input({deduction:'-1'})).issues).toContain('Volume deductions must be zero or more with no more than three decimals.');
    expect(parseWallVolumeInput(input({length:'Infinity'})).snapshot).toBeNull();
    expect(parseWallVolumeInput(input({height:'NaN'})).snapshot).toBeNull();
  });

  it('rejects deductions that equal or exceed the gross volume',()=>{
    expect(parseWallVolumeInput(input({deduction:'56.7'})).issues).toContain('Volume deductions must be smaller than the gross wall volume.');
    expect(parseWallVolumeInput(input({deduction:'80'})).snapshot).toBeNull();
  });

  it('offers the volume calculator only for Stone and Ready Mix',()=>{
    expect(supportsVolumeCalculation('stone')).toBe(true);
    expect(supportsVolumeCalculation('ready_mix')).toBe(true);
    expect(supportsVolumeCalculation('site_mix')).toBe(false);
    expect(supportsVolumeCalculation('rebar')).toBe(false);
    expect(validateWallConsumption({...base,type:'rebar',rebarDiameterMm:12,rebarCount:4,rebarLengthEachM:12,volume:{lengthM:4,heightM:2,bottomThicknessM:.3,topThicknessM:.3,deductionM3:0}})).toContain('A volume calculation can be recorded only for Stone and Ready Mix.');
  });

  it('rejects an invalid volume calculation supplied to validation',()=>{
    expect(validateWallConsumption({...base,type:'stone',stoneQuantity:9,stoneUnit:'m3',volume:{lengthM:10,heightM:2,bottomThicknessM:.5,topThicknessM:.5,deductionM3:10}})).toContain('Volume deductions must be smaller than the gross wall volume.');
    expect(validateWallConsumption({...base,type:'stone',stoneQuantity:9,stoneUnit:'m3',volume:{lengthM:Number.NaN,heightM:2,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0}})).toContain('Wall length must be greater than zero with no more than three decimals.');
  });

  it('requires Stone with a calculated volume to be recorded in m³',()=>{
    expect(validateWallConsumption({...base,type:'stone',stoneQuantity:9,stoneUnit:'tonnes',volume:{lengthM:10,heightM:2,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0}})).toContain('A calculated volume is in m³. Set the stone unit to m³ or remove the calculation.');
  });

  it('keeps the consumed quantity as the recorded figure, even when edited after calculating',()=>{
    const draft={...base,concretePurpose:'structural' as const,finishedVolumeM3:9.8,volume:{lengthM:10,heightM:2,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0}};
    expect(validateWallConsumption(draft)).toEqual([]);
    expect(describeWallConsumptionQuantity(saved({...draft,volume:{...draft.volume,grossVolumeM3:10,netVolumeM3:10}}))).toBe('9.8 m³');
  });

  it('keeps a historical record without a calculation valid',()=>{
    expect(validateWallConsumption({...base,type:'stone',stoneQuantity:9,stoneUnit:'tonnes'})).toEqual([]);
    const {volume:_volume,...legacy}=base;
    expect(validateWallConsumption({...legacy,type:'stone',stoneQuantity:9,stoneUnit:'tonnes'} as WallConsumptionDraft)).toEqual([]);
  });
});

describe('reusable concrete / mortar purposes',()=>{
  it('trims and collapses internal whitespace',()=>{
    expect(normalizePurposeLabel('  Parapet   cap \t concrete ')).toBe('Parapet cap concrete');
    expect(purposeKey('  PARAPET  Cap concrete')).toBe('parapet cap concrete');
  });

  it('rejects an empty purpose',()=>{
    expect(validateNewPurposeLabel('   ',[])).toEqual(['Enter a purpose name.']);
  });

  it('rejects case-insensitive duplicates of saved and built-in purposes',()=>{
    const existing=[{id:'p1',label:'Parapet cap concrete',createdAt:'2026-09-01'}];
    expect(validateNewPurposeLabel('parapet  CAP concrete',existing)).toEqual(['A purpose named “Parapet cap concrete” already exists.']);
    expect(validateNewPurposeLabel(' structural CONCRETE ',[])).toEqual(['A purpose named “Structural concrete” already exists.']);
  });

  it('rejects an overlong purpose name',()=>{
    expect(validateNewPurposeLabel('x'.repeat(61),[])).toEqual(['Purpose name must be 60 characters or fewer.']);
  });

  it('keeps every built-in purpose',()=>{
    expect(builtInConcretePurposes.map(value=>value.id)).toEqual(['structural','filling','cyclopean_matrix','mortar','footing','coping']);
  });

  it('requires exactly one purpose kind for concrete records',()=>{
    expect(validateWallConsumption({...base,finishedVolumeM3:3,customPurposeId:'p1'})).toEqual([]);
    expect(validateWallConsumption({...base,finishedVolumeM3:3})).toContain('Choose the concrete purpose and enter used m³.');
    expect(validateWallConsumption({...base,finishedVolumeM3:3,concretePurpose:'structural',customPurposeId:'p1'})).toContain('Choose one concrete / mortar purpose.');
  });

  it('labels built-in, saved, and missing purposes',()=>{
    expect(wallConsumptionPurposeLabel(saved({concretePurpose:'coping'}))).toBe('Coping concrete');
    expect(wallConsumptionPurposeLabel(saved({customPurposeId:'p1',customPurposeLabel:'Parapet cap concrete'}))).toBe('Parapet cap concrete');
    expect(wallConsumptionPurposeLabel(saved({type:'stone'}))).toBeNull();
  });
});

describe('wall consumption correction diff',()=>{
  const before=saved({type:'ready_mix',concretePurpose:'structural',finishedVolumeM3:4.5,notes:'Pour 1'});

  it('reports no change when every value is equal',()=>{
    expect(diffWallConsumption(before,{...before})).toEqual([]);
  });

  it('records quantity, purpose, date, and volume calculation before and after values',()=>{
    const after=saved({type:'ready_mix',usedOn:'2026-09-09',customPurposeId:'p1',customPurposeLabel:'Parapet cap concrete',finishedVolumeM3:5,notes:'Pour 1',volume:{lengthM:10,heightM:1,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0,grossVolumeM3:5,netVolumeM3:5}});
    expect(diffWallConsumption(before,after)).toEqual([
      {field:'Used on',originalValue:'2026-09-10',newValue:'2026-09-09'},
      {field:'Concrete / mortar purpose',originalValue:'Structural concrete',newValue:'Parapet cap concrete'},
      {field:'Concrete volume (m³)',originalValue:'4.5',newValue:'5'},
      {field:'Calculation length (m)',originalValue:null,newValue:'10'},
      {field:'Calculation height (m)',originalValue:null,newValue:'1'},
      {field:'Calculation bottom thickness (m)',originalValue:null,newValue:'0.5'},
      {field:'Calculation top thickness (m)',originalValue:null,newValue:'0.5'},
      {field:'Calculation deductions (m³)',originalValue:null,newValue:'0'},
      {field:'Calculated gross volume (m³)',originalValue:null,newValue:'5'},
      {field:'Calculated net volume (m³)',originalValue:null,newValue:'5'},
    ]);
  });

  it('records a unit correction',()=>{
    const stone=saved({type:'stone',stoneQuantity:9,stoneUnit:'m3'});
    expect(diffWallConsumption(stone,{...stone,stoneUnit:'tonnes'})).toEqual([{field:'Stone',originalValue:'9 m³',newValue:'9 t'}]);
  });

  it('ignores whitespace-only note differences',()=>{
    expect(diffWallConsumption(before,{...before,notes:'  Pour 1 '})).toEqual([]);
  });
});

describe('wall consumption summaries and descriptions',()=>{
  it('omits missing site-mix ingredients instead of printing zeros',()=>{
    expect(describeWallConsumptionQuantity(saved({type:'site_mix',concretePurpose:'mortar',cementBags:12,sandQuantity:1.5,sandUnit:'m3'}))).toBe('12 cement bags · 1.5 m³ sand');
  });

  it('describes stone, rebar, and ready mix',()=>{
    expect(describeWallConsumptionQuantity(saved({type:'stone',stoneQuantity:9,stoneUnit:'tonnes'}))).toBe('9 t stone');
    expect(describeWallConsumptionQuantity(saved({type:'rebar',rebarDiameterMm:16,rebarCount:40,rebarLengthEachM:12,totalRebarKg:757.648}))).toBe('40 bars × 12 m · 757.6 kg');
  });

  it('recalculates totals and keeps custom purposes out of the built-in buckets',()=>{
    const entries=[
      saved({id:'a',concretePurpose:'structural',finishedVolumeM3:4.5,volume:{lengthM:9,heightM:1,bottomThicknessM:.5,topThicknessM:.5,deductionM3:0,grossVolumeM3:4.5,netVolumeM3:4.5}}),
      saved({id:'b',customPurposeId:'p1',customPurposeLabel:'Parapet cap concrete',finishedVolumeM3:1.25}),
      saved({id:'c',type:'stone',stoneQuantity:9,stoneUnit:'m3'}),
      saved({id:'d',type:'stone',stoneQuantity:3,stoneUnit:'tonnes'}),
    ];
    expect(summarizeWallConsumption(entries)).toMatchObject({structural:4.5,filling:0,otherConcrete:1.25,stoneM3:9,stoneT:3,calculatedRecords:1});
  });
});
