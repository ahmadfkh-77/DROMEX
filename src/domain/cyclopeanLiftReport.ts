import {
  deriveLiftStatus,orderLiftsBySequence,reconcileLifts,
  type CyclopeanLift,type CyclopeanLiftParentType,type LiftReconciliation,type StonePhase,
} from './wallCyclopeanLift';

/**
 * DEC-467. The as-of projection a Daily Report needs: a lift seen exactly as it stood on one work
 * date, with nothing that happened afterwards. This module never computes a quantity of its own --
 * it removes the phases that had not happened yet and then re-derives status through
 * `deriveLiftStatus` and totals through `reconcileLifts`, so the report can never disagree with the
 * live screens about what a lift means.
 */

/** Work dates in DROMEX are plain `YYYY-MM-DD`, so the date part of a timestamp compares directly. */
const dateOf=(timestamp:string)=>timestamp.slice(0,10);

/** The date a Stone phase belongs to: its own recorded work date, or the lift's creation date when it carries none. */
const stoneDateOf=(lift:CyclopeanLift)=>lift.stonePhase.workDate??dateOf(lift.createdAt);
/** The date a concrete matrix phase belongs to, with the same fallback. */
const concreteDateOf=(lift:CyclopeanLift)=>lift.concretePhase?.workDate??dateOf(lift.updatedAt??lift.createdAt);

const stoneRecorded=(phase:StonePhase)=>phase.actualStoneQuantityM3!=null||phase.workDate!=null;

/** A Stone phase stripped back to "nothing recorded yet": the lift reads as Planned, with no invented quantity. */
const plannedStonePhase=(phase:StonePhase):StonePhase=>({
  calculationSnapshot:null,calculatedStoneVolumeM3:0,actualStoneQuantityM3:null,manualOverride:false,
  workDate:null,position:phase.position,offsets:phase.offsets,notes:phase.notes,
});

/**
 * The lift as it stood on `asOf`, or null when it did not exist yet. A phase recorded later is
 * removed rather than blanked in place, and the concrete phase is dropped whenever its own Stone
 * phase is not yet visible, so a pour can never appear without the Stone it surrounds.
 */
export function projectLiftAsOf(lift:CyclopeanLift,asOf:string):CyclopeanLift|null{
  if(dateOf(lift.createdAt)>asOf)return null;
  const stoneVisible=stoneRecorded(lift.stonePhase)&&stoneDateOf(lift)<=asOf;
  const stonePhase=stoneVisible?lift.stonePhase:plannedStonePhase(lift.stonePhase);
  const concreteVisible=stoneVisible&&lift.concretePhase!=null&&concreteDateOf(lift)<=asOf;
  const concretePhase=concreteVisible?lift.concretePhase:null;
  const correctionHistory=lift.correctionHistory.filter(entry=>dateOf(entry.correctedAt)<=asOf);
  const projected={...lift,stonePhase,concretePhase,correctionHistory};
  return{...projected,status:deriveLiftStatus(projected)};
}

/** Every lift that existed by the report date, in construction order, each already projected to that date. */
export function liftsAsOf(lifts:CyclopeanLift[],asOf:string):CyclopeanLift[]{
  return orderLiftsBySequence(lifts.flatMap(lift=>{
    const projected=projectLiftAsOf(lift,asOf);
    return projected?[projected]:[];
  }));
}

/**
 * Whether this lift did anything on exactly this date -- created, Stone placed, concrete poured, or
 * corrected. Used to decide whether a foundation or wall belongs in that day's report at all, the
 * same way a foundation's own construction/curing dates already do.
 */
export function liftHasActivityOn(lift:CyclopeanLift,date:string):boolean{
  if(dateOf(lift.createdAt)===date)return true;
  if(stoneRecorded(lift.stonePhase)&&stoneDateOf(lift)===date)return true;
  if(lift.concretePhase&&concreteDateOf(lift)===date)return true;
  return lift.correctionHistory.some(entry=>dateOf(entry.correctedAt)===date);
}

export type CyclopeanLiftReportGroup={
  parentType:CyclopeanLiftParentType;parentId:string;parentReference:string;
  parentNetVolumeM3:number;lifts:CyclopeanLift[];reconciliation:LiftReconciliation;
};

/**
 * One parent's visible lifts plus its reconciliation on that date. The totals are whatever
 * `reconcileLifts` makes of the projected lifts -- there is no second set of report arithmetic.
 */
export function buildLiftReportGroup(input:{
  parentType:CyclopeanLiftParentType;parentId:string;parentReference:string;
  parentNetVolumeM3:number;lifts:CyclopeanLift[];asOf:string;
}):CyclopeanLiftReportGroup{
  const lifts=liftsAsOf(input.lifts,input.asOf);
  return{
    parentType:input.parentType,parentId:input.parentId,parentReference:input.parentReference,
    parentNetVolumeM3:input.parentNetVolumeM3,lifts,
    reconciliation:reconcileLifts(input.parentNetVolumeM3,lifts),
  };
}

/** The Stone figure a report shows for a lift: the entered actual when there is one, otherwise the calculated one. */
export function reportStoneVolume(lift:CyclopeanLift):number{
  return lift.stonePhase.actualStoneQuantityM3??lift.stonePhase.calculatedStoneVolumeM3;
}

/** True when either phase's quantity was typed rather than taken from its calculator. */
export function liftHasManualOverride(lift:CyclopeanLift):boolean{
  return lift.stonePhase.manualOverride||(lift.concretePhase?.manualOverride??false);
}
