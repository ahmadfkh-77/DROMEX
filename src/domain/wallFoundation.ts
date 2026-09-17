import type {WallCorrectionEntry} from './walls';

/**
 * DEC-461. The composite foundation model. A base's outer geometry (wallBase.ts) defines its net
 * volume. A Stone core can sit inside that volume; the concrete that fills the rest is estimated,
 * never assumed poured, and is compared against the actual Ready Mix once it is recorded. Stone is
 * never drawn or reported beside the concrete as if it were an adjacent wall-style layer — it is
 * always inside the same outer boundary.
 */
export type FoundationCompositionMode='single'|'composite';
export type StoneCoreMode='simple'|'detailed';
export type FoundationCompositionMaterial='stone'|'ready_mix';

/** Simple mode: a schematic block placed by a normalized position, volume unaffected by where it sits. */
export type StoneCorePosition={xNorm:number;yNorm:number};
/** Detailed mode: a real sub-geometry inside the foundation, using the same trapezoid formula as the base itself. */
export type StoneCoreOffsets={lengthM:number;depthM:number;bottomThicknessM:number;topThicknessM:number;longitudinalOffsetM:number;verticalOffsetM:number;transverseOffsetM:number};

export type FoundationCompositionRecordDraft={baseId:string;wallId:string;materialType:FoundationCompositionMaterial;quantityM3:number;recordedOn:string;notes:string};
export type FoundationCompositionCorrectionDraft=FoundationCompositionRecordDraft&{correctionReason:string};
export type FoundationCompositionRecord=FoundationCompositionRecordDraft&{id:string;cancelledAt:string|null;cancelledReason:string|null;correctionHistory:WallCorrectionEntry[];createdAt:string;updatedAt:string|null};

export type ConcreteVarianceDirection='over'|'under'|'none';
export type ConcreteVariance={varianceM3:number;direction:ConcreteVarianceDirection};

export type FoundationComposition={
  baseId:string;wallId:string;mode:FoundationCompositionMode;stoneCoreMode:StoneCoreMode|null;
  position:StoneCorePosition|null;offsets:StoneCoreOffsets|null;
  netFoundationVolumeM3:number;records:FoundationCompositionRecord[];
  activeStoneM3:number;activeReadyMixM3:number;estimatedConcreteM3:number;
  /** Null until at least one active Ready Mix record exists — there is nothing to compare yet. */
  variance:ConcreteVariance|null;
};

const round=(value:number)=>Number(value.toFixed(9));
const positive=(value:number)=>Number.isFinite(value)&&value>0;
const EPSILON=1e-6;

/** DEC-461. The centre of the foundation footprint, used whenever a Stone core is first placed or reset. */
export function defaultStoneCorePosition():StoneCorePosition{return{xNorm:.5,yNorm:.5};}

/** Keeps a simple-mode position inside the outer boundary; the margin keeps the drawn block fully visible. */
export function clampStoneCorePosition(position:StoneCorePosition,margin=.12):StoneCorePosition{
  const clamp=(value:number)=>Math.min(1-margin,Math.max(margin,value));
  return{xNorm:round(clamp(position.xNorm)),yNorm:round(clamp(position.yNorm))};
}

/** Small typed nudges for the numeric/keyboard alternative to dragging. */
export function nudgeStoneCorePosition(position:StoneCorePosition,axis:'x'|'y',deltaNorm:number,margin=.12):StoneCorePosition{
  const next=axis==='x'?{...position,xNorm:position.xNorm+deltaNorm}:{...position,yNorm:position.yNorm+deltaNorm};
  return clampStoneCorePosition(next,margin);
}

/** DEC-461. Same trapezoid formula as the shared wall/base volume, applied to the Stone core's own sub-geometry. */
export function calculateStoneCoreVolume(offsets:Pick<StoneCoreOffsets,'lengthM'|'depthM'|'bottomThicknessM'|'topThicknessM'>):number{
  return round(offsets.lengthM*offsets.depthM*((offsets.bottomThicknessM+offsets.topThicknessM)/2));
}

export type FoundationGeometry={lengthM:number;heightM:number;bottomThicknessM:number;topThicknessM:number};
/**
 * DEC-461. A detailed Stone core must have positive dimensions and stay fully inside the outer
 * foundation footprint. The transverse offset has no bound here: the diagram is a 2D cross-section,
 * so a third-axis offset is stored as reference information only, never as an engineering coordinate.
 */
export function validateStoneCoreOffsets(offsets:StoneCoreOffsets,foundation:FoundationGeometry):string[]{
  const issues:string[]=[];
  if(!positive(offsets.lengthM))issues.push('Stone core length must be greater than zero.');
  if(!positive(offsets.depthM))issues.push('Stone core height/depth must be greater than zero.');
  if(!positive(offsets.bottomThicknessM))issues.push('Stone core bottom thickness/width must be greater than zero.');
  if(!positive(offsets.topThicknessM))issues.push('Stone core top thickness/width must be greater than zero.');
  if(offsets.longitudinalOffsetM<0||offsets.verticalOffsetM<0)issues.push('Offsets cannot be negative.');
  if(!Number.isFinite(offsets.transverseOffsetM))issues.push('Enter a transverse offset, or zero if not applicable.');
  if(issues.length)return issues;
  if(offsets.longitudinalOffsetM+offsets.lengthM>foundation.lengthM+EPSILON)issues.push('The Stone core extends beyond the foundation length. Reduce its length or its longitudinal offset.');
  if(offsets.verticalOffsetM+offsets.depthM>foundation.heightM+EPSILON)issues.push('The Stone core extends beyond the foundation height/depth. Reduce its depth or its vertical offset.');
  if(offsets.bottomThicknessM>foundation.bottomThicknessM+EPSILON)issues.push('The Stone core bottom thickness/width cannot exceed the foundation bottom thickness.');
  if(offsets.topThicknessM>foundation.topThicknessM+EPSILON)issues.push('The Stone core top thickness/width cannot exceed the foundation top thickness.');
  return issues;
}

/** Active (non-cancelled) recorded quantity for one material, corrections already reflected by the caller. */
export function aggregateActiveQuantity(records:FoundationCompositionRecord[],materialType:FoundationCompositionMaterial):number{
  return round(records.filter(record=>record.materialType===materialType&&!record.cancelledAt).reduce((total,record)=>total+record.quantityM3,0));
}

/** DEC-461. Estimated concrete is always net foundation volume minus active Stone, never negative, never a stored poured fact. */
export function estimatedConcreteVolume(netFoundationVolumeM3:number,activeStoneM3:number):number{
  return round(Math.max(0,netFoundationVolumeM3-activeStoneM3));
}

/** Refuses a Stone quantity that would make the active total exceed the foundation's net volume. */
export function validateStoneCapacity(netFoundationVolumeM3:number,activeStoneM3ExcludingThis:number,proposedQuantityM3:number):string[]{
  if(!positive(proposedQuantityM3))return['Stone quantity must be greater than zero.'];
  const total=round(activeStoneM3ExcludingThis+proposedQuantityM3);
  if(total>round(netFoundationVolumeM3)+EPSILON)return[`Recording ${proposedQuantityM3} m³ of Stone would bring the total to ${total} m³, more than the foundation's net volume of ${round(netFoundationVolumeM3)} m³. Reduce the quantity or correct the foundation geometry first.`];
  return[];
}

/** DEC-461. Reducing the foundation's own geometry can never silently strand already-recorded Stone. */
export function validateFoundationVolumeAgainstStone(newNetFoundationVolumeM3:number,activeStoneM3:number):string[]{
  if(round(activeStoneM3)>round(newNetFoundationVolumeM3)+EPSILON)return[`This foundation already has ${activeStoneM3} m³ of Stone recorded, more than the proposed net volume of ${newNetFoundationVolumeM3} m³. Correct or cancel Stone records first.`];
  return[];
}

export function validateCompositionRecordDraft(draft:Pick<FoundationCompositionRecordDraft,'materialType'|'quantityM3'|'recordedOn'>):string[]{
  const issues:string[]=[];
  if(!positive(draft.quantityM3))issues.push(`${draft.materialType==='stone'?'Stone':'Ready Mix'} quantity must be greater than zero.`);
  if(!draft.recordedOn)issues.push('Choose the date this quantity was recorded.');
  return issues;
}

/** DEC-461. Never labelled waste — a business rule for that would have to be separate and explicit. */
export function concreteVariance(estimatedConcreteM3:number,actualReadyMixM3:number):ConcreteVariance{
  const varianceM3=round(actualReadyMixM3-estimatedConcreteM3);
  const direction:ConcreteVarianceDirection=varianceM3>EPSILON?'over':varianceM3<-EPSILON?'under':'none';
  return{varianceM3,direction};
}

/** Assembles the read-model the screen, diagram, PDF, and workbook all share. */
export function buildFoundationComposition(input:{
  baseId:string;wallId:string;mode:FoundationCompositionMode;stoneCoreMode:StoneCoreMode|null;
  position:StoneCorePosition|null;offsets:StoneCoreOffsets|null;netFoundationVolumeM3:number;records:FoundationCompositionRecord[];
}):FoundationComposition{
  const activeStoneM3=aggregateActiveQuantity(input.records,'stone');
  const activeReadyMixM3=aggregateActiveQuantity(input.records,'ready_mix');
  const estimatedConcreteM3=estimatedConcreteVolume(input.netFoundationVolumeM3,activeStoneM3);
  return{
    baseId:input.baseId,wallId:input.wallId,mode:input.mode,stoneCoreMode:input.stoneCoreMode,position:input.position,offsets:input.offsets,
    netFoundationVolumeM3:input.netFoundationVolumeM3,records:input.records,activeStoneM3,activeReadyMixM3,estimatedConcreteM3,
    variance:activeReadyMixM3>0?concreteVariance(estimatedConcreteM3,activeReadyMixM3):null,
  };
}
