import {calculateBaseVolume,validateBaseLifecycle,validateBaseStatusChange,validateWallBase,type BaseGeometry,type BaseStatus,type BaseStatusChange,type WallBaseMaterial} from './wallBase';
import type {WallCorrectionEntry} from './walls';
import type {ConcretePurpose,MaterialUnit} from './walls';

/**
 * DEC-464. A Foundation is an independent, first-class entity: it belongs to a project and a
 * Construction Section, exists before any wall is created, and may or may not ever have a wall
 * linked to it. Its geometry, material, and curing lifecycle reuse the exact same shared functions
 * as the legacy per-wall base (calculateBaseVolume, validateBaseStatusChange, validateBaseLifecycle)
 * so the arithmetic and lifecycle rules are never duplicated or allowed to drift apart.
 */
export type Foundation=BaseGeometry&{
  id:string;projectId:string;constructionSectionId:string;
  /** Set only for a foundation created by migrating a pre-DEC-464 wall base; never set by new code. */
  legacyWallId:string|null;
  reference:string;location:string;
  materialType:WallBaseMaterial;concretePurpose:ConcretePurpose|null;customPurposeId:string|null;customPurposeLabel:string|null;
  quantity:number|null;quantityUnit:MaterialUnit;manualOverride:boolean;consumptionDate:string|null;
  grossVolumeM3:number;netVolumeM3:number;status:BaseStatus;
  constructedOn:string|null;curingStartedOn:string|null;curedOn:string|null;curingNote:string;
  notes:string;correctionHistory:WallCorrectionEntry[];createdAt:string;updatedAt:string|null;
};
export type FoundationDraft=BaseGeometry&{
  projectId:string;constructionSectionId:string;reference:string;location:string;
  materialType:WallBaseMaterial;concretePurpose:ConcretePurpose|null;customPurposeId:string|null;
  quantity:number|null;quantityUnit:MaterialUnit;manualOverride:boolean;consumptionDate:string|null;notes:string;
};
export type FoundationCorrectionDraft=FoundationDraft&{correctionReason:string};

/** Same trapezoid formula as everything else in Wall Construction; no second calculation exists. */
export const calculateFoundationVolume=calculateBaseVolume;
/** Same forward-only lifecycle as the legacy base; curing is informational (DEC-463) for a Foundation too. */
export const validateFoundationStatusChange=validateBaseStatusChange;
export const validateFoundationLifecycle=validateBaseLifecycle;

/** Identical rules to the legacy per-wall base's `validateWallBase`, applied to an independent Foundation draft. */
export function validateFoundationDraft(draft:FoundationDraft):string[]{
  const issues:string[]=[];
  if(!draft.projectId)issues.push('Choose the project this foundation belongs to.');
  if(!draft.constructionSectionId)issues.push('Choose the Construction Section this foundation belongs to.');
  issues.push(...validateWallBase(draft));
  return issues;
}

export type FoundationStatusChange=BaseStatusChange;

const fieldsOf=(foundation:Foundation):[string,string|null][]=>[
  ['Foundation reference',foundation.reference],['Foundation location',foundation.location.trim()||null],
  ['Foundation length (m)',String(foundation.lengthM)],['Foundation height (m)',String(foundation.heightM)],
  ['Foundation bottom thickness (m)',String(foundation.bottomThicknessM)],['Foundation top thickness (m)',String(foundation.topThicknessM)],
  ['Foundation deductions (m³)',String(foundation.deductionM3)],
  ['Calculated gross volume (m³)',String(foundation.grossVolumeM3)],['Calculated net volume (m³)',String(foundation.netVolumeM3)],
  ['Foundation material',foundation.materialType],['Foundation purpose',foundation.customPurposeLabel??foundation.concretePurpose??null],
  ['Recorded quantity',`${foundation.quantity} ${foundation.quantityUnit==='tonnes'?'t':'m³'}`],['Manual override',foundation.manualOverride?'Yes':'No'],
  ['Consumption date',foundation.consumptionDate],['Construction date',foundation.constructedOn],['Curing started',foundation.curingStartedOn],
  ['Cured date',foundation.curedOn],['Curing note',foundation.curingNote.trim()||null],['Foundation notes',foundation.notes.trim()||null],
];
/** DEC-464. Field-level before/after audit, the same reasoned-correction shape used throughout Wall Construction. */
export function diffFoundation(before:Foundation,after:Foundation){
  const next=new Map(fieldsOf(after));
  return fieldsOf(before).flatMap(([field,originalValue])=>{const newValue=next.get(field)??null;return originalValue===newValue?[]:[{field,originalValue,newValue}];});
}

export type FoundationStatusFilter=BaseStatus|'all';
export const foundationStatusFilters:{id:FoundationStatusFilter;label:string}[]=[{id:'all',label:'All statuses'},{id:'planned',label:'Planned'},{id:'constructed',label:'Constructed'},{id:'curing',label:'Curing'},{id:'cured',label:'Cured'}];

/** DEC-464. A foundation is available for a new wall link exactly when it has no wall linked yet — every status is otherwise selectable, never disabled for curing (DEC-463). */
export function isFoundationAvailableForLinking(foundation:Pick<Foundation,'id'>,linkedFoundationIds:ReadonlySet<string>):boolean{
  return!linkedFoundationIds.has(foundation.id);
}
