import type {Project} from './loads';

export const pavementSpreadRates=[60,70,80,90,100,110,120,140,160,180,200,240] as const;
export const DEFAULT_PAVEMENT_DENSITY=2.4;

/**
 * One road section of a paved area (DEC-518). The width changes in a straight line along the section (an assumption, stated on screen),
 * so its area is length × (width 1 + width 2) ÷ 2. The total of all sections is the net paved area.
 */
export type PavementAreaSection={name:string;lengthM:number;widthStartM:number;widthEndM:number};
/** A section as typed. Text keeps a blank apart from a zero, so an empty field is never counted as 0. */
export type PavementSectionText={name:string;length:string;widthStart:string;widthEnd:string};

export type PavementCalculationDraft={
  projectId:string;
  name:string;
  lengthM:number|null;
  widthM:number|null;
  /** The road sections that make up the area, or null/absent when the area came from length × width or was entered directly. */
  areaSections?:PavementAreaSection[]|null;
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

const round6=(value:number)=>Math.round(value*1e6)/1e6;
export const sectionArea=(section:PavementAreaSection)=>round6(variableWidthArea(section.lengthM,section.widthStartM,section.widthEndM));
export const totalSectionArea=(sections:readonly PavementAreaSection[])=>round6(sections.reduce((sum,section)=>sum+variableWidthArea(section.lengthM,section.widthStartM,section.widthEndM),0));
/** A section with a usable length (above zero) and widths (zero or more, so a section may taper to a point). */
export const isValidAreaSection=(section:PavementAreaSection)=>Number.isFinite(section.lengthM)&&section.lengthM>0&&Number.isFinite(section.widthStartM)&&section.widthStartM>=0&&Number.isFinite(section.widthEndM)&&section.widthEndM>=0;

const sectionNumber=(value:string):number|null=>{const text=value.trim().replace(',','.');if(!text||!/^\d*\.?\d+$|^\d+\.$/.test(text))return null;const parsed=Number(text);return Number.isFinite(parsed)?parsed:null;};

/** A new section starts where the last one ended: its Width 1 is the previous Width 2 (still editable). Empty for the first section. */
export const nextSectionWidthStart=(sections:readonly PavementSectionText[])=>sections.length?sections[sections.length-1]!.widthEnd:'';
/** Duplicating keeps the measurements; a named section is marked as a copy so the two can be told apart. */
export const duplicateSectionText=(section:PavementSectionText):PavementSectionText=>({...section,name:section.name.trim()?`${section.name.trim()} (copy)`:''});

export type PavementSectionsAnalysis={
  /** One line per problem, in the order of the sections; empty when every section is usable. */
  errors:string[];
  /** Each section's own area, or null while that section has a problem. */
  areas:(number|null)[];
  /** The sections as numbers, or null while anything is wrong: nothing is ever counted as zero. */
  sections:PavementAreaSection[]|null;
  /** The sum of all section areas, or null while anything is wrong. */
  totalM2:number|null;
};

/**
 * Checks the typed sections. Length must be above zero and each width zero or more. An empty or invalid field is an error that names its
 * section; it is never treated as 0. At least one section is needed and the total must be above zero.
 */
export function analyzePavementSections(texts:readonly PavementSectionText[]):PavementSectionsAnalysis{
  if(!texts.length)return{errors:['Add at least one road section.'],areas:[],sections:null,totalM2:null};
  const errors:string[]=[],areas:(number|null)[]=[],sections:PavementAreaSection[]=[];
  texts.forEach((text,index)=>{
    const n=index+1,length=sectionNumber(text.length),start=sectionNumber(text.widthStart),end=sectionNumber(text.widthEnd);
    let ok=true;
    if(length===null||length<=0){errors.push(`Section ${n}: enter a length greater than zero, or remove the section.`);ok=false;}
    if(start===null){errors.push(`Section ${n}: enter Width 1 (zero or more).`);ok=false;}
    if(end===null){errors.push(`Section ${n}: enter Width 2 (zero or more).`);ok=false;}
    if(ok){const section={name:text.name.trim(),lengthM:length!,widthStartM:start!,widthEndM:end!};sections.push(section);areas.push(sectionArea(section));}else areas.push(null);
  });
  if(errors.length)return{errors,areas,sections:null,totalM2:null};
  const totalM2=totalSectionArea(sections);
  if(totalM2<=0)return{errors:['The total area must be greater than zero.'],areas,sections:null,totalM2:null};
  return{errors:[],areas,sections,totalM2};
}

export function validatePavementCalculation(draft:PavementCalculationDraft,projects:Project[]):string[]{
  const issues:string[]=[];
  if(!projects.some(project=>project.id===draft.projectId&&project.status==='active'))issues.push('Select an active project.');
  if(!draft.name.trim())issues.push('Enter a section or layer name.');
  if(draft.areaSections){
    if(!draft.areaSections.length)issues.push('Add at least one road section.');
    else if(!draft.areaSections.every(isValidAreaSection))issues.push('Every road section needs a length above zero and widths of zero or more.');
    else if(Math.abs(totalSectionArea(draft.areaSections)-draft.areaM2)>0.0005)issues.push('The area must equal the total of the road sections.');
  }
  if(!Number.isFinite(draft.areaM2)||draft.areaM2<=0)issues.push('Area must be greater than zero.');
  if(!Number.isFinite(draft.spreadRateKgM2)||draft.spreadRateKgM2<=0)issues.push('kg/m² must be greater than zero.');
  if(!Number.isFinite(draft.densityTM3)||draft.densityTM3<=0)issues.push('Compacted density must be greater than zero.');
  if(draft.looseThicknessFactor!==null&&(!Number.isFinite(draft.looseThicknessFactor)||draft.looseThicknessFactor<=1||draft.looseThicknessFactor>2))issues.push('Loose-thickness factor must be greater than 1.00 and no more than 2.00.');
  if(!Number.isFinite(draft.allowancePercent)||draft.allowancePercent<0)issues.push('Allowance cannot be negative.');
  return issues;
}
