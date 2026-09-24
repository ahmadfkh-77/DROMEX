import {calculateBaseVolume,validateBaseDeduction,validateBaseDimensions,validateBaseLifecycle,validateBaseStatusChange,type BaseGeometry,type BaseStatus,type BaseStatusChange,type WallBaseMaterial} from './wallBase';
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
  /**
   * DEC-468. The pre-DEC-468 top-level material consumption. All three of materialType, quantity and
   * quantityUnit are null together on a foundation created under the Lift workflow, where a
   * foundation records a structural envelope only and actual Stone and concrete belong to its lift
   * phases. They are non-null together only on a legacy record, which is shown read-only and never
   * rewritten.
   */
  materialType:WallBaseMaterial|null;concretePurpose:ConcretePurpose|null;customPurposeId:string|null;customPurposeLabel:string|null;
  quantity:number|null;quantityUnit:MaterialUnit|null;manualOverride:boolean;consumptionDate:string|null;
  grossVolumeM3:number;netVolumeM3:number;status:BaseStatus;
  constructedOn:string|null;curingStartedOn:string|null;curedOn:string|null;curingNote:string;
  notes:string;correctionHistory:WallCorrectionEntry[];createdAt:string;updatedAt:string|null;
};
export type FoundationDraft=BaseGeometry&{
  projectId:string;constructionSectionId:string;reference:string;location:string;
  materialType:WallBaseMaterial|null;concretePurpose:ConcretePurpose|null;customPurposeId:string|null;
  quantity:number|null;quantityUnit:MaterialUnit|null;manualOverride:boolean;consumptionDate:string|null;notes:string;
};
export type FoundationCorrectionDraft=FoundationDraft&{correctionReason:string};

/** Same trapezoid formula as everything else in Wall Construction; no second calculation exists. */
export const calculateFoundationVolume=calculateBaseVolume;
/** Same forward-only lifecycle as the legacy base; curing is informational (DEC-463) for a Foundation too. */
export const validateFoundationStatusChange=validateBaseStatusChange;
export const validateFoundationLifecycle=validateBaseLifecycle;

const round=(value:number)=>Number(value.toFixed(9));

/**
 * DEC-468. A foundation's own material record is optional and all-or-nothing: either nothing is
 * recorded at the foundation level at all -- the normal case, because actual Stone and concrete are
 * recorded through Lift phases -- or a complete legacy record is present and validated by
 * the same rules it always was. The calculated structural volume is never substituted for a missing
 * quantity: capacity is not consumption.
 */
export function validateFoundationMaterialRecord(draft:Pick<FoundationDraft,'materialType'|'quantity'|'quantityUnit'|'concretePurpose'|'customPurposeId'|'manualOverride'|'consumptionDate'>&BaseGeometry):string[]{
  const present=[draft.materialType!=null,draft.quantity!=null,draft.quantityUnit!=null];
  const recorded=present.filter(Boolean).length;
  if(recorded===0){
    const issues:string[]=[];
    if(draft.concretePurpose||draft.customPurposeId)issues.push('Remove the concrete / mortar purpose, or record the foundation material, quantity, and unit it belongs to.');
    if(draft.consumptionDate)issues.push('Remove the consumption date, or record the foundation material, quantity, and unit it belongs to.');
    return issues;
  }
  if(recorded<3)return['Record the foundation material, quantity, and unit together, or leave all three empty and record actual Stone and concrete through Lifts.'];
  const issues:string[]=[];
  if(draft.materialType!=='stone'&&!draft.concretePurpose&&!draft.customPurposeId)issues.push('Choose the concrete / mortar purpose for the foundation material.');
  if(draft.concretePurpose&&draft.customPurposeId)issues.push('Choose one concrete / mortar purpose.');
  if(!(draft.quantity!>0))issues.push('Foundation material quantity must be greater than zero.');
  else if(!draft.manualOverride){
    const {netVolumeM3}=calculateBaseVolume(draft);
    if(draft.quantityUnit!=='m3')issues.push('A calculated foundation volume is in m³. Set the unit to m³ or record it as a manual override with its own unit.');
    else if(round(Math.abs(draft.quantity!-netVolumeM3))>0.0005)issues.push('The recorded quantity differs from the calculated volume. Confirm it as a manual override.');
  }
  return issues;
}

/** Geometry rules are shared with the legacy per-wall base; the material record follows the Foundation's own optional rule. */
export function validateFoundationDraft(draft:FoundationDraft):string[]{
  const issues:string[]=[];
  if(!draft.projectId)issues.push('Choose the project this foundation belongs to.');
  if(!draft.constructionSectionId)issues.push('Choose the Construction Section this foundation belongs to.');
  const dimensions=validateBaseDimensions(draft);
  if(dimensions.length)return[...issues,...dimensions];
  issues.push(...validateBaseDeduction(draft));
  issues.push(...validateFoundationMaterialRecord(draft));
  return issues;
}

/** DEC-468. True only for a pre-DEC-468 foundation that really does carry a top-level material consumption. */
export function hasLegacyMaterialRecord(foundation:Pick<Foundation,'materialType'|'quantity'|'quantityUnit'>):boolean{
  return foundation.materialType!=null&&foundation.quantity!=null&&foundation.quantityUnit!=null;
}

/** The recorded quantity as text, or null when the foundation carries no material record at all -- never "null m³", never a zero. */
export function describeFoundationQuantity(foundation:Pick<Foundation,'materialType'|'quantity'|'quantityUnit'>):string|null{
  if(!hasLegacyMaterialRecord(foundation))return null;
  return `${foundation.quantity} ${foundation.quantityUnit==='tonnes'?'t':'m³'}`;
}

/** The unit symbol for a recorded quantity, or null when nothing is recorded -- so a report never implies m³ of nothing. */
export function foundationQuantityUnitSymbol(foundation:Pick<Foundation,'materialType'|'quantity'|'quantityUnit'>):string|null{
  if(!hasLegacyMaterialRecord(foundation))return null;
  return foundation.quantityUnit==='tonnes'?'t':'m³';
}

export type FoundationStatusChange=BaseStatusChange;

const fieldsOf=(foundation:Foundation):[string,string|null][]=>[
  ['Foundation reference',foundation.reference],['Foundation location',foundation.location.trim()||null],
  ['Foundation length (m)',String(foundation.lengthM)],['Foundation height (m)',String(foundation.heightM)],
  ['Foundation bottom thickness (m)',String(foundation.bottomThicknessM)],['Foundation top thickness (m)',String(foundation.topThicknessM)],
  ['Foundation deductions (m³)',String(foundation.deductionM3)],
  ['Calculated gross volume (m³)',String(foundation.grossVolumeM3)],['Calculated net volume (m³)',String(foundation.netVolumeM3)],
  ['Foundation material',foundation.materialType],['Foundation purpose',foundation.customPurposeLabel??foundation.concretePurpose??null],
  ['Recorded quantity',describeFoundationQuantity(foundation)],['Manual override',foundation.manualOverride?'Yes':'No'],
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
