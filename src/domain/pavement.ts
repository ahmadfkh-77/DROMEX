import type {Project} from './loads';

export const pavementSpreadRates=[60,70,80,90,100,110,120,140,160,180,200,240] as const;
export const DEFAULT_PAVEMENT_DENSITY=2.4;

export type PavementCalculationDraft={
  projectId:string;
  name:string;
  lengthM:number|null;
  widthM:number|null;
  areaM2:number;
  spreadRateKgM2:number;
  densityTM3:number;
  looseThicknessFactor:number|null;
  allowancePercent:number;
  notes:string;
};

export type PavementCalculation=PavementCalculationDraft&{
  id:string;
  projectName:string;
  theoreticalKg:number;
  allowanceKg:number;
  plannedKg:number;
  thicknessMm:number;
  looseThicknessMm:number|null;
  createdAt:string;
  updatedAt:string;
};

export type PavementSetup={projects:Project[]};

export type PavementResult={theoreticalKg:number;allowanceKg:number;plannedKg:number;theoreticalTonnes:number;plannedTonnes:number;thicknessMm:number};

export function calculatePavement(areaM2:number,spreadRateKgM2:number,densityTM3:number,allowancePercent=0):PavementResult{
  const theoreticalKg=areaM2*spreadRateKgM2;
  const allowanceKg=theoreticalKg*(allowancePercent/100);
  return{theoreticalKg,allowanceKg,plannedKg:theoreticalKg+allowanceKg,theoreticalTonnes:theoreticalKg/1000,plannedTonnes:(theoreticalKg+allowanceKg)/1000,thicknessMm:spreadRateKgM2/densityTM3};
}

export const variableWidthArea=(lengthM:number,widthStartM:number,widthEndM:number)=>lengthM*((widthStartM+widthEndM)/2);
export const triangleArea=(baseM:number,heightM:number)=>(baseM*heightM)/2;
export const circleArea=(radiusM:number)=>Math.PI*radiusM*radiusM;
export const compactedVolume=(areaM2:number,thicknessMm:number)=>areaM2*(thicknessMm/1000);
export const massFromVolume=(volumeM3:number,densityTM3:number)=>volumeM3*densityTM3;
export const looseVolume=(compactedM3:number,looseFactor:number)=>compactedM3*looseFactor;
export const looseThickness=(compactedThicknessMm:number,looseFactor:number)=>compactedThicknessMm*looseFactor;
export const coverageArea=(tonnes:number,spreadRateKgM2:number)=>(tonnes*1000)/spreadRateKgM2;
export const averageThickness=(tonnes:number,areaM2:number,densityTM3:number)=>(tonnes*1000)/(areaM2*densityTM3);
export const coatLitres=(areaM2:number,rateLM2:number)=>areaM2*rateLM2;
export const appliedEmulsionLitres=(residualLitres:number,residueFraction:number)=>residualLitres/residueFraction;
export const crossfallDifferenceMm=(widthM:number,slopePercent:number)=>widthM*(slopePercent/100)*1000;
export const gradeElevationDifferenceM=(lengthM:number,gradePercent:number)=>lengthM*(gradePercent/100);
export const slopedSurfaceWidth=(horizontalWidthM:number,slopePercent:number)=>horizontalWidthM*Math.sqrt(1+(slopePercent/100)**2);
export const truckLoads=(tonnes:number,payloadTonnes:number)=>Math.ceil(tonnes/payloadTonnes);
export const progressPercent=(actualTonnes:number,plannedTonnes:number)=>(actualTonnes/plannedTonnes)*100;
export const quantityVarianceTonnes=(actualTonnes:number,plannedTonnes:number)=>actualTonnes-plannedTonnes;

export function validatePavementCalculation(draft:PavementCalculationDraft,projects:Project[]):string[]{
  const issues:string[]=[];
  if(!projects.some(project=>project.id===draft.projectId&&project.status==='active'))issues.push('Select an active project.');
  if(!draft.name.trim())issues.push('Enter a section or layer name.');
  if(!Number.isFinite(draft.areaM2)||draft.areaM2<=0)issues.push('Area must be greater than zero.');
  if(!Number.isFinite(draft.spreadRateKgM2)||draft.spreadRateKgM2<=0)issues.push('kg/m² must be greater than zero.');
  if(!Number.isFinite(draft.densityTM3)||draft.densityTM3<=0)issues.push('Compacted density must be greater than zero.');
  if(draft.looseThicknessFactor!==null&&(!Number.isFinite(draft.looseThicknessFactor)||draft.looseThicknessFactor<=1||draft.looseThicknessFactor>2))issues.push('Loose-thickness factor must be greater than 1.00 and no more than 2.00.');
  if(!Number.isFinite(draft.allowancePercent)||draft.allowancePercent<0)issues.push('Allowance cannot be negative.');
  return issues;
}
