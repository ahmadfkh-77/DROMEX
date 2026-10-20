import {
  analyzePavementSections,DEFAULT_PAVEMENT_DENSITY,pavementSpreadRates,truckLoads,type PavementAreaSection,type PavementCalculation,type PavementCalculationDraft,type PavementSectionText,type PavementSectionsAnalysis,
} from './pavement';

/**
 * The Asphalt Calculator form as typed, and how it becomes a draft or is read back from a saved calculation (DEC-518, DEC-519). The area comes from
 * exactly one of three ways, chosen on the Area page: Length × width, Road sections, or a Direct net area. Each way keeps its own values when the
 * choice is switched, so nothing typed is lost.
 */
export type PavementAreaMode='lw'|'sections'|'direct';
export type PavementForm={
  projectId:string;name:string;areaMode:PavementAreaMode;length:string;width:string;directArea:string;sections:PavementSectionText[];
  rateId:string;customRate:string;density:string;looseFactorId:string;customLooseFactor:string;allowance:string;notes:string;
};
export const looseFactorPresets=[1.15,1.20,1.25,1.30] as const;
export const defaultTruckPayloadTonnes=20;
export const blankSection=():PavementSectionText=>({name:'',length:'',widthStart:'',widthEnd:''});

export const emptyPavementForm=(projectId=''):PavementForm=>({projectId,name:'',areaMode:'lw',length:'',width:'',directArea:'',sections:[blankSection()],rateId:'90',customRate:'',density:DEFAULT_PAVEMENT_DENSITY.toFixed(2),looseFactorId:'',customLooseFactor:'',allowance:'0',notes:''});

/** A number typed in the form; anything that is not a number reads as 0 here, and the callers refuse a result of 0. */
export const formNumber=(value:string)=>{const parsed=Number(value.replace(',','.'));return Number.isFinite(parsed)?parsed:0;};
const optional=(value:string)=>value.trim()?formNumber(value):null;

export type PavementAreaResult={
  /** The net area in m²; 0 while the chosen way does not give a usable area. */
  areaM2:number;
  /** Set only in Road sections: each section's area, the problems, and the total. */
  sections:PavementSectionsAnalysis|null;
};

export function areaOfPavementForm(form:PavementForm):PavementAreaResult{
  if(form.areaMode==='sections'){const analysis=analyzePavementSections(form.sections);return{areaM2:analysis.totalM2??0,sections:analysis};}
  if(form.areaMode==='direct')return{areaM2:formNumber(form.directArea),sections:null};
  return{areaM2:formNumber(form.length)*formNumber(form.width),sections:null};
}

export const rateOfPavementForm=(form:PavementForm)=>form.rateId==='custom'?formNumber(form.customRate):formNumber(form.rateId);
export const looseFactorOfPavementForm=(form:PavementForm)=>form.looseFactorId==='custom'?formNumber(form.customLooseFactor):form.looseFactorId?formNumber(form.looseFactorId):null;

export function draftFromPavementForm(form:PavementForm):PavementCalculationDraft{
  const {areaM2,sections}=areaOfPavementForm(form);
  const areaSections:PavementAreaSection[]|null=form.areaMode==='sections'&&sections?.sections?sections.sections:null;
  return{
    projectId:form.projectId,name:form.name,
    lengthM:form.areaMode==='lw'?optional(form.length):null,widthM:form.areaMode==='lw'?optional(form.width):null,
    areaSections,areaM2,spreadRateKgM2:rateOfPavementForm(form),densityTM3:formNumber(form.density),looseThicknessFactor:looseFactorOfPavementForm(form),
    allowancePercent:formNumber(form.allowance),notes:form.notes,
  };
}

/** A saved calculation reopens in the way its area was given: its road sections, or length × width, or a direct area. */
export function pavementFormFromRecord(record:PavementCalculation):PavementForm{
  const preset=record.looseThicknessFactor!==null&&(looseFactorPresets as readonly number[]).includes(record.looseThicknessFactor);
  const standardRate=(pavementSpreadRates as readonly number[]).includes(record.spreadRateKgM2);
  const base=emptyPavementForm(record.projectId);
  const areaMode:PavementAreaMode=record.areaSections?.length?'sections':record.lengthM&&record.widthM?'lw':'direct';
  return{
    ...base,projectId:record.projectId,name:record.name,areaMode,
    length:areaMode==='lw'?String(record.lengthM):'',width:areaMode==='lw'?String(record.widthM):'',directArea:areaMode==='direct'?String(record.areaM2):'',
    sections:areaMode==='sections'?record.areaSections!.map(section=>({name:section.name,length:String(section.lengthM),widthStart:String(section.widthStartM),widthEnd:String(section.widthEndM)})):base.sections,
    rateId:standardRate?String(record.spreadRateKgM2):'custom',customRate:standardRate?'':String(record.spreadRateKgM2),density:String(record.densityTM3),
    looseFactorId:record.looseThicknessFactor===null?'':preset?record.looseThicknessFactor.toFixed(2):'custom',customLooseFactor:record.looseThicknessFactor!==null&&!preset?String(record.looseThicknessFactor):'',
    allowance:String(record.allowancePercent),notes:record.notes,
  };
}

/** What stops the Area page from moving on, or null when it can: a project, a name, and a usable area. A problem in a road section is named. */
export function areaPageIssue(form:PavementForm,area:PavementAreaResult):string|null{
  if(!form.projectId)return 'Choose a project.';
  if(!form.name.trim())return 'Enter a section or layer name.';
  if(form.areaMode==='sections'&&area.sections&&area.sections.errors.length)return area.sections.errors[0]!;
  if(area.areaM2<=0)return form.areaMode==='lw'?'Enter a length and a width above zero.':form.areaMode==='direct'?'Enter a net area above zero.':'Enter at least one road section.';
  return null;
}

/** What stops the Rate page from moving on, or null when it can. */
export function ratePageIssue(form:PavementForm):string|null{
  if(rateOfPavementForm(form)<=0)return 'Enter a spread rate above zero.';
  if(formNumber(form.density)<=0)return 'Compacted density must be greater than zero.';
  if(form.allowance.trim()&&formNumber(form.allowance)<0)return 'Allowance cannot be negative.';
  const factor=looseFactorOfPavementForm(form);
  if(factor!==null&&(factor<=1||factor>2))return 'Loose-thickness factor must be greater than 1.00 and no more than 2.00.';
  return null;
}

/** Trucks for the planned quantity: tonnes ÷ payload, rounded up. The payload is only on the screen; null until it is above zero. */
export const trucksForPlanned=(plannedTonnes:number,payloadTonnes:number)=>plannedTonnes>0&&payloadTonnes>0?truckLoads(plannedTonnes,payloadTonnes):null;
