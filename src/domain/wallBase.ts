import type {WallCorrectionEntry} from './walls';
import {calculateWallVolume,type ConcretePurpose,type MaterialUnit} from './walls';

/**
 * DEC-459/460, refined by DEC-463. Every wall section created from now on is built on a recorded
 * base: its geometry, consumed material, construction, and curing. Recording a base remains
 * required before wall geometry, layers, or wall-material consumption can be entered — but curing
 * itself is tracked information only. DEC-463 removed the earlier rule that locked wall work until
 * the base was explicitly confirmed cured: a base in any status (planned, constructed, curing, or
 * cured) may have its wall recorded, edited, and dated freely. Nothing here infers a cured base
 * from elapsed time, curing is never inferred either, and a wall that existed before this feature
 * stays usable as a legacy wall.
 */
export type BaseStatus='planned'|'constructed'|'curing'|'cured';
export const baseStatusLabels:Record<BaseStatus,string>={planned:'Planned',constructed:'Constructed / poured',curing:'Curing',cured:'Cured'};
const ORDER:BaseStatus[]=['planned','constructed','curing','cured'];

export type BaseGeometry={lengthM:number;heightM:number;bottomThicknessM:number;topThicknessM:number;deductionM3:number};
export type WallBaseMaterial='ready_mix'|'site_mix'|'stone';
export type WallBaseDraft=BaseGeometry&{wallId:string;reference:string;location:string;materialType:WallBaseMaterial;concretePurpose:ConcretePurpose|null;customPurposeId:string|null;quantity:number|null;quantityUnit:MaterialUnit;manualOverride:boolean;consumptionDate:string|null;notes:string};
export type WallBaseCorrectionDraft=WallBaseDraft&{correctionReason:string};
export type WallBase=WallBaseDraft&{id:string;customPurposeLabel:string|null;grossVolumeM3:number;netVolumeM3:number;status:BaseStatus;constructedOn:string|null;curingStartedOn:string|null;curedOn:string|null;curingNote:string;correctionHistory:WallCorrectionEntry[];createdAt:string;updatedAt:string|null};
export type BaseStatusChange={status:BaseStatus;constructedOn?:string|null;curingStartedOn?:string|null;curedOn?:string|null;curingNote?:string;inspected?:boolean};
/** The status/date shape shared by a legacy wall base and the independent Foundation (DEC-464), so the one set of curing/lifecycle functions below serves both without duplicating the logic. */
export type CuringLifecycle=Pick<WallBase,'status'|'constructedOn'|'curingStartedOn'|'curedOn'>;

const round=(value:number)=>Number(value.toFixed(9));
const hasThreeDecimalsAtMost=(value:number)=>Math.abs(value*1000-Math.round(value*1000))<1e-6;
const validPositive=(value:number)=>Number.isFinite(value)&&value>0&&hasThreeDecimalsAtMost(value);

/** DEC-459. The base uses the one shared geometry formula; there is no second calculation. */
export function calculateBaseVolume(geometry:BaseGeometry){
  const result=calculateWallVolume(geometry.lengthM,geometry.heightM,geometry.bottomThicknessM,geometry.topThicknessM,geometry.deductionM3);
  return{grossVolumeM3:result.grossVolumeM3,netVolumeM3:result.netVolumeM3};
}

/**
 * DEC-468. The dimension rules alone, with no material opinion, so a wall base and a Foundation can
 * share exactly one copy of the geometry checks while keeping their own material policy: a legacy
 * per-wall base still requires a recorded consumption, a Foundation records a structural envelope
 * and leaves its materials to the Lift phases.
 */
export function validateBaseDimensions(draft:BaseGeometry&{reference:string}):string[]{
  const issues:string[]=[];
  if(!draft.reference.trim())issues.push('Enter a base reference or description.');
  if(!validPositive(draft.lengthM))issues.push('Base length must be greater than zero with no more than three decimals.');
  if(!validPositive(draft.heightM))issues.push('Base height must be greater than zero with no more than three decimals.');
  if(!validPositive(draft.bottomThicknessM))issues.push('Base bottom thickness must be greater than zero with no more than three decimals.');
  if(!validPositive(draft.topThicknessM))issues.push('Base top thickness must be greater than zero with no more than three decimals.');
  if(!Number.isFinite(draft.deductionM3)||draft.deductionM3<0||!hasThreeDecimalsAtMost(draft.deductionM3))issues.push('Base deductions must be zero or more with no more than three decimals.');
  return issues;
}

/** Only meaningful once `validateBaseDimensions` is clean, which is why it is kept separate. */
export function validateBaseDeduction(draft:BaseGeometry):string[]{
  const {grossVolumeM3}=calculateBaseVolume(draft);
  return draft.deductionM3>=grossVolumeM3?['Base deductions must be smaller than the gross base volume.']:[];
}

/** The legacy per-wall base, unchanged: it has always required a recorded material consumption. */
export function validateWallBase(draft:Omit<WallBaseDraft,'wallId'>):string[]{
  const issues:string[]=validateBaseDimensions(draft);
  if(issues.length)return issues;
  const {netVolumeM3}=calculateBaseVolume(draft);
  issues.push(...validateBaseDeduction(draft));
  const concrete=draft.materialType!=='stone';
  if(concrete&&!draft.concretePurpose&&!draft.customPurposeId)issues.push('Choose the concrete / mortar purpose for the base.');
  if(draft.concretePurpose&&draft.customPurposeId)issues.push('Choose one concrete / mortar purpose.');
  if(draft.quantity==null||!(draft.quantity>0))issues.push('Base quantity must be greater than zero.');
  else if(!draft.manualOverride){
    if(draft.quantityUnit!=='m3')issues.push('A calculated base volume is in m³. Set the unit to m³ or record it as a manual override with its own unit.');
    else if(issues.length===0&&round(Math.abs(draft.quantity-netVolumeM3))>0.0005)issues.push('The recorded quantity differs from the calculated volume. Confirm it as a manual override.');
  }
  return issues;
}

/**
 * DEC-459, refined by DEC-463. Only forward transitions, each with its own date; curing never
 * completes on its own. Reverting a cured base back to curing is always allowed, including when
 * wall work already exists above it: curing chronology is informational and a correction here
 * never invalidates, blocks, or removes any wall record.
 */
export function validateBaseStatusChange(base:CuringLifecycle,change:BaseStatusChange):string[]{
  const issues:string[]=[];
  const from=ORDER.indexOf(base.status),to=ORDER.indexOf(change.status);
  const revertingCure=base.status==='cured'&&change.status==='curing';
  if(revertingCure)return issues;
  if(to!==from+1)issues.push('A base moves from planned to constructed, then curing, then cured.');
  if(issues.length)return issues;
  if(change.status==='constructed'&&!change.constructedOn)issues.push('Record the construction or pour date.');
  if(change.status==='curing'){
    if(!change.curingStartedOn)issues.push('Record the date curing started.');
    else if(base.constructedOn&&change.curingStartedOn<base.constructedOn)issues.push('Curing cannot start before the base was constructed.');
  }
  if(change.status==='cured'){
    if(!change.curedOn)issues.push('Record the date the base was confirmed cured.');
    else{
      if(base.curingStartedOn&&change.curedOn<base.curingStartedOn)issues.push('The cured date cannot be before curing started.');
      if(base.constructedOn&&change.curedOn<base.constructedOn)issues.push('The cured date cannot be before the base was constructed.');
    }
    if(change.inspected!==true)issues.push('Confirm that the base was inspected and is ready for wall work.');
  }
  return issues;
}

/** Checks a stored base for internally inconsistent dates, for example after a correction. */
export function validateBaseLifecycle(base:Pick<WallBase,'status'|'constructedOn'|'curingStartedOn'|'curedOn'>):string[]{
  const issues:string[]=[];
  if(base.curingStartedOn&&base.constructedOn&&base.curingStartedOn<base.constructedOn)issues.push('Curing cannot start before the base was constructed.');
  if(base.curedOn&&base.curingStartedOn&&base.curedOn<base.curingStartedOn)issues.push('The cured date cannot be before curing started.');
  if(base.curedOn&&base.constructedOn&&base.curedOn<base.constructedOn)issues.push('The cured date cannot be before the base was constructed.');
  if(base.status==='cured'&&!base.curedOn)issues.push('A cured base must record the date it was confirmed cured.');
  if(base.status!=='planned'&&!base.constructedOn)issues.push('Record the construction or pour date.');
  return issues;
}

export const CURING_WARNING_TITLE='Base curing is not yet confirmed';
export const CURING_WARNING_BODY='You can continue recording wall planning and work. Confirm curing separately when the base is ready.';

export type WallStageLock={locked:boolean;legacy:boolean;curingConfirmed:boolean;reason:string;warningTitle:string|null;warningBody:string|null};
/**
 * DEC-459/460, refined by DEC-463. `locked` is true only when this wall requires a base and none
 * has been recorded yet — the one thing that still blocks wall work. Curing status never locks
 * anything: once a base exists in any status, `locked` is false and `warningTitle`/`warningBody`
 * carry a non-blocking notice for the screen to show beside the wall sections, which stay open,
 * editable, and saveable regardless of curing. The notice is deliberately not "approved" or
 * "certified" wording, and never implies the foundation is unsafe.
 */
export function describeWallStageLock(base:CuringLifecycle|null,legacyWall:boolean):WallStageLock{
  if(legacyWall&&!base)return{locked:false,legacy:true,curingConfirmed:true,reason:'Base not recorded — legacy wall',warningTitle:null,warningBody:null};
  if(!base)return{locked:true,legacy:false,curingConfirmed:false,reason:'Record the base for this wall before recording wall construction.',warningTitle:null,warningBody:null};
  const curingConfirmed=base.status==='cured';
  return{
    locked:false,legacy:false,curingConfirmed,
    reason:curingConfirmed?`Base confirmed cured on ${base.curedOn}.`:`Base is ${baseStatusLabels[base.status].toLocaleLowerCase('en-US')}.`,
    warningTitle:curingConfirmed?null:CURING_WARNING_TITLE,
    warningBody:curingConfirmed?null:CURING_WARNING_BODY,
  };
}

/** DEC-463. The only thing that still blocks wall work is a missing base; curing chronology never refuses a date. */
export function validateWallWorkDate(base:CuringLifecycle|null,legacyWall:boolean):string|null{
  const lock=describeWallStageLock(base,legacyWall);
  return lock.legacy||!lock.locked?null:lock.reason;
}

/**
 * DEC-463. A non-blocking, purely informational chronology note: the date is always recorded
 * exactly as entered regardless of what this returns.
 */
export function describeWallWorkDateNotice(usedOn:string,base:CuringLifecycle|null):string|null{
  if(!base||base.status==='cured')return null;
  return `Base curing not confirmed on this work date (base is ${baseStatusLabels[base.status].toLocaleLowerCase('en-US')}).`;
}

export function curingDays(base:Pick<WallBase,'curingStartedOn'|'curedOn'>,today:string):number|null{
  if(!base.curingStartedOn)return null;
  const start=Date.parse(`${base.curingStartedOn}T00:00:00Z`),end=Date.parse(`${base.curedOn??today}T00:00:00Z`);
  if(Number.isNaN(start)||Number.isNaN(end))return null;
  return Math.max(0,Math.round((end-start)/86400000));
}
