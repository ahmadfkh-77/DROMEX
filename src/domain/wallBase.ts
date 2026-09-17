import type {WallCorrectionEntry} from './walls';
import {calculateWallVolume,type ConcretePurpose,type MaterialUnit} from './walls';

/**
 * DEC-459. Every wall section created from now on is built on a recorded base: its geometry and
 * consumed material, then construction, curing, and an explicit cured confirmation, which is what
 * unlocks wall geometry, layers, and wall-material consumption. Nothing here infers a cured base
 * from elapsed time, and a wall that existed before this feature stays usable as a legacy wall.
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

const round=(value:number)=>Number(value.toFixed(9));
const hasThreeDecimalsAtMost=(value:number)=>Math.abs(value*1000-Math.round(value*1000))<1e-6;
const validPositive=(value:number)=>Number.isFinite(value)&&value>0&&hasThreeDecimalsAtMost(value);

/** DEC-459. The base uses the one shared geometry formula; there is no second calculation. */
export function calculateBaseVolume(geometry:BaseGeometry){
  const result=calculateWallVolume(geometry.lengthM,geometry.heightM,geometry.bottomThicknessM,geometry.topThicknessM,geometry.deductionM3);
  return{grossVolumeM3:result.grossVolumeM3,netVolumeM3:result.netVolumeM3};
}

export function validateWallBase(draft:WallBaseDraft):string[]{
  const issues:string[]=[];
  if(!draft.reference.trim())issues.push('Enter a base reference or description.');
  if(!validPositive(draft.lengthM))issues.push('Base length must be greater than zero with no more than three decimals.');
  if(!validPositive(draft.heightM))issues.push('Base height must be greater than zero with no more than three decimals.');
  if(!validPositive(draft.bottomThicknessM))issues.push('Base bottom thickness must be greater than zero with no more than three decimals.');
  if(!validPositive(draft.topThicknessM))issues.push('Base top thickness must be greater than zero with no more than three decimals.');
  if(!Number.isFinite(draft.deductionM3)||draft.deductionM3<0||!hasThreeDecimalsAtMost(draft.deductionM3))issues.push('Base deductions must be zero or more with no more than three decimals.');
  if(issues.length)return issues;
  const {grossVolumeM3,netVolumeM3}=calculateBaseVolume(draft);
  if(draft.deductionM3>=grossVolumeM3)issues.push('Base deductions must be smaller than the gross base volume.');
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

/** DEC-459. Only forward transitions, each with its own date; curing never completes on its own. */
export function validateBaseStatusChange(base:WallBase,change:BaseStatusChange,context:{wallActivity?:boolean}={}):string[]{
  const issues:string[]=[];
  const from=ORDER.indexOf(base.status),to=ORDER.indexOf(change.status);
  const revertingCure=base.status==='cured'&&change.status==='curing';
  if(revertingCure){
    // A cured base may only step back while nothing has been built on it.
    if(context.wallActivity)issues.push('Wall work is already recorded above this base, so it cannot return to curing. Correct the wall records first.');
    return issues;
  }
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

export type WallStageLock={locked:boolean;legacy:boolean;reason:string};
/** DEC-459. Why wall construction is or is not available, in plain words for the screen and the API. */
export function describeWallStageLock(base:WallBase|null,legacyWall:boolean):WallStageLock{
  if(legacyWall&&!base)return{locked:false,legacy:true,reason:'Base not recorded — legacy wall'};
  if(!base)return{locked:true,legacy:false,reason:'Record the base for this wall before recording wall construction.'};
  if(base.status==='cured')return{locked:false,legacy:false,reason:`Base confirmed cured on ${base.curedOn}.`};
  return{locked:true,legacy:false,reason:`Wall construction is locked until the base is confirmed cured. The base is ${baseStatusLabels[base.status].toLocaleLowerCase('en-US')}.`};
}

/** DEC-459. Wall work can never be dated before the base was confirmed cured. */
export function validateWallWorkDate(usedOn:string,base:WallBase|null,legacyWall:boolean):string|null{
  const lock=describeWallStageLock(base,legacyWall);
  if(lock.legacy)return null;
  if(lock.locked)return lock.reason;
  return base?.curedOn&&usedOn<base.curedOn?`Wall work cannot be dated before the base was confirmed cured on ${base.curedOn}.`:null;
}

export function curingDays(base:Pick<WallBase,'curingStartedOn'|'curedOn'>,today:string):number|null{
  if(!base.curingStartedOn)return null;
  const start=Date.parse(`${base.curingStartedOn}T00:00:00Z`),end=Date.parse(`${base.curedOn??today}T00:00:00Z`);
  if(Number.isNaN(start)||Number.isNaN(end))return null;
  return Math.max(0,Math.round((end-start)/86400000));
}
