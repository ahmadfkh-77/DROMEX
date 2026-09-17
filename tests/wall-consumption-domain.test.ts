import {describe,expect,it} from 'vitest';

import {
  builtInConcretePurposes,calculateWallArea,calculateWallVolume,describeWallConsumptionQuantity,diffWallConsumption,formatWallArea,
  normalizePurposeLabel,parseWallAreaInput,purposeKey,summarizeWallConsumption,supportsCoveredArea,validateNewPurposeLabel,
  validateWallConsumption,wallConsumptionPurposeLabel,type WallConsumption,type WallConsumptionDraft,
} from '../src/domain/walls';

const base:WallConsumptionDraft={wallId:'wall',usedOn:'2026-09-10',type:'ready_mix',concretePurpose:null,customPurposeId:null,finishedVolumeM3:null,cementBags:null,cementBagKg:null,sandQuantity:null,sandUnit:null,gravelQuantity:null,gravelUnit:null,waterLitres:null,admixtureQuantity:null,admixtureUnit:null,stoneQuantity:null,stoneUnit:null,rebarDiameterMm:null,rebarCount:null,rebarLengthEachM:null,rebarGrade:'',notes:'',area:null};
const saved=(draft:Partial<WallConsumption>):WallConsumption=>({...base,id:'use',totalRebarLengthM:null,totalRebarKg:null,createdAt:'2026-09-10T08:00:00.000Z',customPurposeLabel:null,correctionHistory:[],updatedAt:null,...draft} as WallConsumption);

describe('wall covered-area calculation',()=>{
  it('shares the length x height face area with the volume calculator',()=>{
    const area=calculateWallArea(20,4);
    expect(area).toEqual({grossAreaM2:80,deductionM2:0,netAreaM2:80});
    expect(calculateWallVolume(20,4,.8,.4).grossVolumeM3).toBeCloseTo(area.grossAreaM2*.6,9);
  });

  it('calculates Stone gross area without deductions',()=>{
    expect(parseWallAreaInput({length:'15.5',height:'4',deduction:''})).toEqual({issues:[],snapshot:{lengthM:15.5,heightM:4,deductionM2:0,grossAreaM2:62,netAreaM2:62}});
  });

  it('subtracts opening deductions from the gross area',()=>{
    expect(parseWallAreaInput({length:'18',height:'4',deduction:'10'}).snapshot).toEqual({lengthM:18,heightM:4,deductionM2:10,grossAreaM2:72,netAreaM2:62});
  });

  it('accepts a comma decimal separator like the other DROMEX quantity fields',()=>{
    expect(parseWallAreaInput({length:'12,5',height:'2',deduction:'1,25'}).snapshot?.netAreaM2).toBe(23.75);
  });

  it('removes floating-point noise with the same nine-decimal rule as the volume calculator',()=>{
    expect(calculateWallArea(.1,.3).grossAreaM2).toBe(.03);
    expect(calculateWallArea(4.125,3.333).grossAreaM2).toBe(13.748625);
    expect(formatWallArea(13.748625)).toBe('13.75 m²');
  });

  it('shows a missing area as Area not recorded and never as zero',()=>{
    expect(formatWallArea(null)).toBe('Area not recorded');
    expect(formatWallArea(undefined)).toBe('Area not recorded');
  });

  it('rejects missing, zero, negative, and non-numeric dimensions',()=>{
    expect(parseWallAreaInput({length:'',height:'4',deduction:''}).issues).toContain('Enter the wall length in metres.');
    expect(parseWallAreaInput({length:'0',height:'4',deduction:''}).issues).toContain('Wall length must be greater than zero with no more than three decimals.');
    expect(parseWallAreaInput({length:'-3',height:'4',deduction:''}).issues).toContain('Wall length must be greater than zero with no more than three decimals.');
    expect(parseWallAreaInput({length:'10',height:'abc',deduction:''}).issues).toContain('Wall height must be greater than zero with no more than three decimals.');
    expect(parseWallAreaInput({length:'10',height:'4',deduction:'-1'}).issues).toContain('Openings and deductions must be zero or more with no more than three decimals.');
    expect(parseWallAreaInput({length:'10',height:'Infinity',deduction:''}).snapshot).toBeNull();
    expect(parseWallAreaInput({length:'NaN',height:'4',deduction:''}).snapshot).toBeNull();
  });

  it('rejects more than three decimals (millimetre precision)',()=>{
    expect(parseWallAreaInput({length:'10.1234',height:'4',deduction:''}).issues).toContain('Wall length must be greater than zero with no more than three decimals.');
  });

  it('rejects deductions that equal or exceed the gross area',()=>{
    expect(parseWallAreaInput({length:'10',height:'4',deduction:'40'}).issues).toContain('Openings and deductions must be smaller than the gross wall area.');
    expect(parseWallAreaInput({length:'10',height:'4',deduction:'41'}).snapshot).toBeNull();
  });

  it('offers covered area only for Stone and Ready Mix',()=>{
    expect(supportsCoveredArea('stone')).toBe(true);
    expect(supportsCoveredArea('ready_mix')).toBe(true);
    expect(supportsCoveredArea('site_mix')).toBe(false);
    expect(supportsCoveredArea('rebar')).toBe(false);
    expect(validateWallConsumption({...base,type:'rebar',rebarDiameterMm:12,rebarCount:4,rebarLengthEachM:12,area:{lengthM:4,heightM:2,deductionM2:0}})).toContain('Covered area can be recorded only for Stone and Ready Mix.');
  });

  it('keeps consumed quantity independent from covered area',()=>{
    const draft={...base,concretePurpose:'structural' as const,finishedVolumeM3:4.5,area:{lengthM:15.5,heightM:4,deductionM2:0}};
    expect(validateWallConsumption(draft)).toEqual([]);
    const entry=saved({...draft,area:{lengthM:15.5,heightM:4,deductionM2:0,grossAreaM2:62,netAreaM2:62}});
    expect(describeWallConsumptionQuantity(entry)).toBe('4.5 m³');
    expect(entry.finishedVolumeM3).toBe(4.5);
  });

  it('rejects an invalid area snapshot supplied to validation',()=>{
    expect(validateWallConsumption({...base,type:'stone',stoneQuantity:9,stoneUnit:'m3',area:{lengthM:10,heightM:4,deductionM2:50}})).toContain('Openings and deductions must be smaller than the gross wall area.');
    expect(validateWallConsumption({...base,type:'stone',stoneQuantity:9,stoneUnit:'m3',area:{lengthM:Number.NaN,heightM:4,deductionM2:0}})).toContain('Wall length must be greater than zero with no more than three decimals.');
  });

  it('keeps a historical record without area valid',()=>{
    expect(validateWallConsumption({...base,type:'stone',stoneQuantity:9,stoneUnit:'tonnes'})).toEqual([]);
    const {area:_area,...legacy}=base;
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

  it('records quantity, purpose, date, and area before and after values',()=>{
    const after=saved({type:'ready_mix',usedOn:'2026-09-09',customPurposeId:'p1',customPurposeLabel:'Parapet cap concrete',finishedVolumeM3:5,notes:'Pour 1',area:{lengthM:15.5,heightM:4,deductionM2:0,grossAreaM2:62,netAreaM2:62}});
    expect(diffWallConsumption(before,after)).toEqual([
      {field:'Used on',originalValue:'2026-09-10',newValue:'2026-09-09'},
      {field:'Concrete / mortar purpose',originalValue:'Structural concrete',newValue:'Parapet cap concrete'},
      {field:'Concrete volume (m³)',originalValue:'4.5',newValue:'5'},
      {field:'Area length (m)',originalValue:null,newValue:'15.5'},
      {field:'Area height (m)',originalValue:null,newValue:'4'},
      {field:'Openings / deductions (m²)',originalValue:null,newValue:'0'},
      {field:'Gross area (m²)',originalValue:null,newValue:'62'},
      {field:'Net covered area (m²)',originalValue:null,newValue:'62'},
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

  it('recalculates totals, covered areas, and keeps custom purposes out of the built-in buckets',()=>{
    const entries=[
      saved({id:'a',concretePurpose:'structural',finishedVolumeM3:4.5,area:{lengthM:15.5,heightM:4,deductionM2:0,grossAreaM2:62,netAreaM2:62}}),
      saved({id:'b',customPurposeId:'p1',customPurposeLabel:'Parapet cap concrete',finishedVolumeM3:1.25}),
      saved({id:'c',type:'stone',stoneQuantity:9,stoneUnit:'m3',area:{lengthM:18,heightM:4,deductionM2:10,grossAreaM2:72,netAreaM2:62}}),
      saved({id:'d',type:'stone',stoneQuantity:3,stoneUnit:'tonnes'}),
    ];
    expect(summarizeWallConsumption(entries)).toMatchObject({structural:4.5,filling:0,otherConcrete:1.25,stoneM3:9,stoneT:3,readyMixAreaM2:62,stoneAreaM2:62,areaRecords:2});
  });
});
