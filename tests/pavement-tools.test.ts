import {describe,expect,it} from 'vitest';

import {
  actualResult,coatsResult,geometryNetArea,initialToolsState,layerResult,millingResult,reverseResult,surveyResult,toolNumber,
  type ToolLayer,
} from '../src/domain/pavementTools';

/**
 * The seven optional tools (DEC-339) as pure calculations. These are the same formulas the tools always used, so the SRS acceptance figures
 * (FR-091) still hold; the sample road of 146.0 m² (DEC-518) feeds the rest.
 */
const layer=(extra:Partial<ToolLayer>):ToolLayer=>({name:'L',kind:'granular',thickness:'',density:'2.10',spread:'',looseFactor:'1.20',...extra});

describe('Geometry and Variable Width',()=>{
  const geometry=initialToolsState().geometry;
  it('gives a 100 m section tapering from 6 m to 8 m as 700 m², and adds shapes and takes off deductions',()=>{
    expect(geometryNetArea({...geometry,length:'100',widthStart:'6',widthEnd:'8'})).toBe(700);
    expect(geometryNetArea({...geometry,length:'100',widthStart:'6',widthEnd:'8',triangleBase:'10',triangleHeight:'4',deduction:'20'})).toBe(700);
    expect(geometryNetArea({...geometry,length:'10',widthStart:'4',widthEnd:'4.4'})).toBe(42);
    expect(geometryNetArea({...geometry,length:'1',widthStart:'1',widthEnd:'1',deduction:'50'})).toBe(0);
  });
});

describe('Complete Layer Stack',()=>{
  it('gives 700 compacted m³, 1,470 t at 2.10 and 840 loose m³ at 1.20 for 200 mm over 3,500 m²',()=>{
    expect(layerResult(3500,layer({thickness:'200'}))).toEqual({compactedVolumeM3:700,tonnes:1470,looseVolumeM3:840,looseThicknessMm:0});
  });
  it('uses kg/m² for an asphalt layer and the project factor for its loose thickness, which needs a factor above 1',()=>{
    const wearing=layer({kind:'asphalt',thickness:'40',density:'2.40',spread:'90',looseFactor:'1.20'});
    const result=layerResult(146,wearing);
    expect(result.compactedVolumeM3).toBeCloseTo(5.84,6);expect(result.tonnes).toBeCloseTo(13.14,6);expect(result.looseThicknessMm).toBeCloseTo(48,6);
    expect(layerResult(146,{...wearing,looseFactor:''}).looseThicknessMm).toBe(0);
    expect(layerResult(146,{...wearing,spread:''}).tonnes).toBeCloseTo(5.84*2.4,6);
  });
  it('starts with the five layers and their density and factor',()=>{
    const layers=initialToolsState().layers;
    expect(layers.map(value=>value.name)).toEqual(['Subbase','Base course','Asphalt base','Binder course','Wearing course']);
    expect(layers.map(value=>value.kind)).toEqual(['granular','granular','asphalt','asphalt','asphalt']);
  });
});

describe('Reverse Coverage and Truck Loads',()=>{
  const state={tonnes:'420',density:'2.40',thickness:'50',payload:'20'};
  it('covers 3,500 m² with 420 t at 120 kg/m², gives 50 mm average on 3,500 m² and 21 trucks',()=>{
    expect(reverseResult(3500,{...state,thickness:'50',density:'2.40'}).equivalentKgM2).toBeCloseTo(120,6);
    expect(reverseResult(3500,state).coverageM2).toBeCloseTo(3500,6);
    expect(reverseResult(3500,state).averageThicknessMm).toBeCloseTo(50,6);
    expect(reverseResult(3500,state).trucks).toBe(21);
  });
  it('gives nothing for coverage or thickness without the inputs, and no trucks without a payload',()=>{
    expect(reverseResult(146,{...state,tonnes:''})).toMatchObject({coverageM2:0,averageThicknessMm:0});
    expect(reverseResult(146,{...state,payload:''}).trucks).toBeNull();
  });
});

describe('Prime and Tack Coats',()=>{
  it('gives 1,050 residual litres for 3,500 m² at 0.30 L/m², and 1,750 applied litres at 60% residue',()=>{
    const result=coatsResult(3500,{primeRate:'0.8',tackRate:'0.3',residue:'60'});
    expect(result.tackResidualLitres).toBeCloseTo(1050,6);expect(result.tackAppliedLitres).toBeCloseTo(1750,6);expect(result.primeLitres).toBeCloseTo(2800,6);
  });
  it('gives no applied litres for a residue of 0 or above 100%',()=>{
    expect(coatsResult(146,{primeRate:'',tackRate:'0.3',residue:'0'}).tackAppliedLitres).toBeNull();
    expect(coatsResult(146,{primeRate:'',tackRate:'0.3',residue:'120'}).tackAppliedLitres).toBeNull();
  });
});

describe('Milling',()=>{
  it('gives 175 m³ for 50 mm over 3,500 m², and the mass at the removed-material density',()=>{
    const milled=millingResult(3500,{depth:'50',density:'2.30'});expect(milled).toMatchObject({areaM2:3500,volumeM3:175});expect(milled.tonnes).toBeCloseTo(402.5,6);
    expect(millingResult(146,{depth:'50',density:'2.30'}).tonnes).toBeCloseTo(16.79,6);
  });
});

describe('Crossfall, Slope, and Levels',()=>{
  it('gives 87.5 mm for 3.5 m at 2.5%, 5 m for 500 m at 1%, and 7.002 m for 7 m at 2.5%',()=>{
    const survey=surveyResult({width:'3.5',crossfall:'2.5',length:'500',grade:'1'});expect(survey.crossfallDifferenceMm).toBeCloseTo(87.5,6);expect(survey.riseFallM).toBe(5);
    expect(surveyResult({width:'7',crossfall:'2.5',length:'',grade:''}).slopedWidthM).toBeCloseTo(7.002,3);
  });
});

describe('Actual Delivery and Variance',()=>{
  it('gives 50% progress for 220.5 t of 441 t, a variance of +9 t at 450 t, and 23 trucks for 441 t',()=>{
    expect(actualResult(441,{tonnes:'220.5',payload:'20'})).toMatchObject({progressPercent:50,varianceTonnes:-220.5});
    expect(actualResult(441,{tonnes:'450',payload:'20'}).varianceTonnes).toBe(9);
    expect(actualResult(441,{tonnes:'441',payload:'20'}).trucks).toBe(23);
  });
  it('gives no progress or variance without a planned quantity, and no trucks without a payload',()=>{
    expect(actualResult(0,{tonnes:'10',payload:'20'})).toMatchObject({progressPercent:null,varianceTonnes:null});
    expect(actualResult(441,{tonnes:'10',payload:''}).trucks).toBeNull();
  });
});

describe('typed numbers',()=>{
  it('read a comma as a decimal point and anything that is not a number as 0',()=>{
    expect(toolNumber('4,4')).toBe(4.4);expect(toolNumber('abc')).toBe(0);expect(toolNumber('')).toBe(0);
  });
});
