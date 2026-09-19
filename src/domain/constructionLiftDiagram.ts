import {wallDiagramToSvg,type DiagramElement,type DiagramPatternDef,type LayerPattern} from './wallDiagram';
import {
  concreteMatrixVariance,estimatedConcreteMatrixVolume,orderLiftsBySequence,
  type ConcreteVariance,type ConstructionLift,type LegacyCompositeStage,type LiftReconciliation,
  type LiftStoneOffsets,type LiftStonePosition,type LiftStatus,type VolumeDimensions,
} from './wallConstructionLift';

/**
 * DEC-466 Phase 4. The technical drawing for the Lift model: one lift, a whole foundation or
 * wall, or a foundation with its linked wall. Nothing here computes a business quantity -- every
 * volume, status, variance and reconciliation total arrives already derived by wallConstructionLift.ts,
 * and this module only decides where it is drawn and how it is labelled. The output is deterministic,
 * self-contained SVG: no script, no external reference, no raster, no model-generated image.
 */

export type LiftDiagramGeometry=VolumeDimensions;
/** The measured Stone sub-geometry, taken from the Stone phase's own calculation snapshot. Null when the quantity was entered without the calculator. */
export type LiftStoneGeometry=VolumeDimensions;

export type LiftDiagramLift={
  id:string;sequence:number;reference:string;startElevationM:number;
  geometry:LiftDiagramGeometry;netLiftVolumeM3:number;status:LiftStatus;
  calculatedStoneVolumeM3:number;actualStoneQuantityM3:number|null;stoneGeometry:LiftStoneGeometry|null;
  estimatedConcreteM3:number;actualReadyMixM3:number|null;variance:ConcreteVariance|null;
  position:LiftStonePosition|null;offsets:LiftStoneOffsets|null;
};

export const STONE_FILL='#8C8579';
export const CONCRETE_POURED_FILL='#B9B2A2';
export const CONCRETE_ESTIMATE_FILL='#DDD7C9';
const INK='#17212b',MUTED='#65717d',RESULT='#04545d',ALERT='#8e2e1b';
export const STONE_PATTERN_ID='stoneHatch';
/** Concrete still to be poured. */
export const CONCRETE_PATTERN_ID='concreteHatch';
/**
 * DEC-469. Concrete that has actually been poured carries its own, denser pattern. Before this a
 * poured lift was drawn as a flat colour with no pattern at all, which left colour as the only thing
 * separating "poured" from "estimated" -- unreadable in grayscale and for a colour-vision deficiency.
 */
export const CONCRETE_POURED_PATTERN_ID='concretePouredHatch';
const PATTERNS:DiagramPatternDef[]=[
  {id:STONE_PATTERN_ID,fill:'none',pattern:'diagonal'},
  {id:CONCRETE_PATTERN_ID,fill:'none',pattern:'dots'},
  {id:CONCRETE_POURED_PATTERN_ID,fill:'none',pattern:'cross'},
];
const concretePatternFor=(poured:boolean)=>poured?CONCRETE_POURED_PATTERN_ID:CONCRETE_PATTERN_ID;

/**
 * The single 2D plane every lift drawing represents. Stated on the figure itself so a longitudinal
 * elevation is never read as recording a transverse placement it does not hold; the transverse offset
 * is entered numerically and is deliberately not draggable here.
 */
export const LIFT_DIAGRAM_PLANE_LABEL='Longitudinal elevation: length × height.';
/** The axis the drawn plane deliberately does not represent, stated wherever the plane label appears. */
export const LIFT_TRANSVERSE_NOTE='Transverse offset is entered numerically, not dragged.';

export const DEFAULT_LIFT_STONE_POSITION:LiftStonePosition={xNorm:.5,yNorm:.5};
/** A finger must travel this far before a touch that began on the Stone becomes a drag, so a tap or a scroll is never mistaken for one. */
export const DRAG_ACTIVATION_THRESHOLD_PX=6;
export const LIFT_NUDGE_STEP_NORM=.05;
export const LIFT_NUDGE_STEP_M=.05;

/**
 * Phone-first geometry. The viewBox is deliberately close to a phone's own content width, so a label
 * drawn at 9 units renders at roughly 9 device-independent pixels instead of shrinking to an
 * unreadable 5 or 6 when the drawing is scaled down to fit. The legend sits below the figure rather
 * than beside it for the same reason: a side column would leave the drawing itself too narrow.
 */
const WIDTH=360,PADDING=14,MIN_REGION_PX=9;
const BOX_TOP=76,BOX_LEFT=PADDING+40,BOX_HEIGHT=150;
const BOX_SPAN=WIDTH-BOX_LEFT-PADDING;

const round=(value:number)=>Number(value.toFixed(9));
const metres=(value:number)=>`${Number(value.toFixed(3))} m`;
const cubic=(value:number)=>`${Number(value.toFixed(3))} m³`;
const clip=(value:string,limit:number)=>value.length>limit?`${value.slice(0,limit-1)}…`:value;
const hasArabic=(value:string)=>/[؀-ۿ]/.test(value);
const clamp=(value:number,low:number,high:number)=>Number.isFinite(value)?Math.min(high,Math.max(low,value)):low;

export const liftStatusText:Record<LiftStatus,string>={planned:'Planned',stone_placed:'Concrete fill pending',completed:'Completed'};

/** The Stone quantity actually recorded for this lift: the entered actual if there is one, otherwise the calculated figure. */
const stoneVolumeOf=(lift:LiftDiagramLift)=>lift.actualStoneQuantityM3??lift.calculatedStoneVolumeM3;
const isDetailed=(lift:LiftDiagramLift)=>lift.offsets!=null;
const averageThickness=(geometry:VolumeDimensions)=>(geometry.bottomThicknessM+geometry.topThicknessM)/2;

/**
 * Projects one persisted lift into the presentation shape. Every number is read from the record or
 * from wallConstructionLift.ts -- the estimated matrix volume comes from the recorded concrete phase when
 * one exists and otherwise from the domain's own formula, and the variance from its own comparison.
 */
export function liftDiagramLiftFrom(lift:ConstructionLift):LiftDiagramLift{
  const estimatedConcreteM3=lift.concretePhase
    ?lift.concretePhase.estimatedMatrixVolumeM3
    :estimatedConcreteMatrixVolume(lift.netLiftVolumeM3,lift.stonePhase.calculatedStoneVolumeM3);
  const actualReadyMixM3=lift.concretePhase?.actualReadyMixQuantityM3??null;
  const reference=lift.concretePhase?.calculationMethod==='independent'&&lift.concretePhase.independentCalculation
    ?lift.concretePhase.independentCalculation.netVolumeM3:estimatedConcreteM3;
  return{
    id:lift.id,sequence:lift.sequence,reference:lift.reference,startElevationM:lift.startElevationM,
    geometry:lift.geometry,netLiftVolumeM3:lift.netLiftVolumeM3,status:lift.status,
    calculatedStoneVolumeM3:lift.stonePhase.calculatedStoneVolumeM3,actualStoneQuantityM3:lift.stonePhase.actualStoneQuantityM3,
    stoneGeometry:lift.stonePhase.calculationSnapshot,
    estimatedConcreteM3,actualReadyMixM3,
    variance:actualReadyMixM3==null?null:concreteMatrixVariance(reference,actualReadyMixM3),
    position:lift.stonePhase.position,offsets:lift.stonePhase.offsets,
  };
}

/**
 * DEC-469. The lift as an editor is previewing it, with the estimated concrete matrix **re-derived**
 * from the Stone being previewed. The Stone editor previously overrode the Stone volume but kept the
 * saved lift's estimate, so entering 4.5 m³ of Stone in a 9 m³ lift drew "Stone 4.5" beside
 * "Concrete estimated 9" -- 13.5 m³ of material in a 9 m³ lift. A recorded concrete phase keeps its
 * own estimate, because that figure is history rather than a live derivation.
 */
export function withPreviewedStone(lift:LiftDiagramLift,preview:{
  calculatedStoneVolumeM3:number;actualStoneQuantityM3:number|null;stoneGeometry:LiftStoneGeometry|null;
  position:LiftStonePosition|null;offsets:LiftStoneOffsets|null;status:LiftStatus;
}):LiftDiagramLift{
  return{
    ...lift,...preview,
    estimatedConcreteM3:lift.actualReadyMixM3!=null
      ?lift.estimatedConcreteM3
      :estimatedConcreteMatrixVolume(lift.netLiftVolumeM3,preview.calculatedStoneVolumeM3),
  };
}

/**
 * DEC-469. Parses a typed offset, accepting a partially typed decimal. The controls keep the raw text
 * and only commit the parsed number, because re-rendering `String(Number(text))` on every keystroke
 * destroyed the decimal point the moment it was typed -- `Number('0.')` is `0`, which renders as
 * `"0"`, so `0.5` could never be entered at all. A comma is accepted as a decimal separator, matching
 * the rest of the app's numeric fields.
 */
export function parseOffsetText(text:string):number{
  const trimmed=text.trim().replace(',','.');
  if(!trimmed)return Number.NaN;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(trimmed)?Number(trimmed):Number.NaN;
}

/**
 * Whether typed text already represents this committed value, so a value arriving back from the
 * parent (a nudge, a reset, a clamp) only replaces the text when it genuinely differs -- which is what
 * lets a half-typed `"0."` survive.
 */
export function offsetTextMatchesValue(text:string,value:number):boolean{
  const parsed=parseOffsetText(text);
  return Number.isFinite(parsed)&&Number.isFinite(value)&&round(parsed)===round(value);
}

// ---------------------------------------------------------------------------------------------
// Drag geometry. All of it is pure arithmetic on the diagram's own coordinate space, so the gesture
// handler in the UI and the drawing itself can never disagree about where the Stone region is.
// ---------------------------------------------------------------------------------------------

export type LiftDragBounds={boxLeft:number;boxTop:number;boxWidth:number;boxHeight:number;stoneWidthPx:number;stoneHeightPx:number};

/**
 * The draggable box is the rectangle inscribed in the lift's trapezoid -- as wide as its narrower end
 * -- so a Stone region anywhere inside it is inside the structural envelope too, with no separate
 * safety margin to keep in step.
 */
/**
 * DEC-469. How much of each axis the Stone region occupies, so that the **drawn area** matches the
 * Stone's share of the lift volume: scaling both axes by the square root of the volume ratio makes
 * area proportional to volume. The previous code fixed the width at 32% of the envelope whatever the
 * volume and halved the height again, so a Stone filling half a lift was drawn at roughly a tenth of
 * it -- the Owner spotted this on the device. Capped below the full width so a concrete margin is
 * always visible, and floored so a very small Stone stays findable (disclosed as exaggerated).
 */
export function stoneLinearFraction(lift:LiftDiagramLift):number{
  const volume=stoneVolumeOf(lift);
  if(!(volume>0))return 0;
  const ratio=clamp(volume/Math.max(lift.netLiftVolumeM3,.001),0,1);
  return Math.min(.92,Math.sqrt(ratio));
}

export function liftDragBounds(lift:LiftDiagramLift):LiftDragBounds{
  const maxThickness=Math.max(lift.geometry.bottomThicknessM,lift.geometry.topThicknessM)||1;
  const scale=(BOX_SPAN-30)/maxThickness;
  const narrowHalf=(Math.min(lift.geometry.bottomThicknessM,lift.geometry.topThicknessM)*scale)/2;
  const centreX=BOX_LEFT+BOX_SPAN/2;
  const boxWidth=Math.max(48,narrowHalf*2),boxLeft=centreX-boxWidth/2;
  const fraction=stoneLinearFraction(lift);
  return{
    boxLeft:round(boxLeft),boxTop:BOX_TOP,boxWidth:round(boxWidth),boxHeight:BOX_HEIGHT,
    stoneWidthPx:round(Math.max(MIN_REGION_PX,boxWidth*fraction)),
    stoneHeightPx:round(Math.max(MIN_REGION_PX,BOX_HEIGHT*fraction)),
  };
}

/** Converts a touch measured in screen pixels from the rendered SVG's top-left into the diagram's own coordinate space. */
export function viewBoxPointFromTouch(touch:{x:number;y:number},rendered:{width:number;height:number},diagram:{width:number;height:number}):{x:number;y:number}{
  if(rendered.width<=0||rendered.height<=0)return{x:0,y:0};
  const scale=rendered.width/diagram.width;
  return{x:touch.x/scale,y:touch.y/scale};
}

/**
 * Simple mode. Clamping to [0,1] is exact rather than approximate: the drawn position is always
 * `boxLeft + xNorm*(boxWidth-stoneWidthPx)`, so any value in that range keeps the whole Stone region
 * inside the lift envelope.
 */
export function liftStonePositionFromViewBoxPoint(point:{x:number;y:number},bounds:LiftDragBounds):LiftStonePosition{
  const spanX=bounds.boxWidth-bounds.stoneWidthPx,spanY=bounds.boxHeight-bounds.stoneHeightPx;
  // The region is grabbed at its centre, so half of it is taken off before normalizing.
  const xNorm=spanX>0?clamp((point.x-bounds.stoneWidthPx/2-bounds.boxLeft)/spanX,0,1):.5;
  const yNorm=spanY>0?clamp((point.y-bounds.stoneHeightPx/2-bounds.boxTop)/spanY,0,1):.5;
  return{xNorm:Number(xNorm.toFixed(4)),yNorm:Number(yNorm.toFixed(4))};
}

/** True only when the touch began on (or just beside) the drawn Stone region, which is what makes a drag deliberate. */
export function stoneTouchesRegion(point:{x:number;y:number},bounds:LiftDragBounds,position:LiftStonePosition):boolean{
  const margin=Math.min(bounds.stoneWidthPx,bounds.stoneHeightPx)*.4;
  const x=bounds.boxLeft+position.xNorm*(bounds.boxWidth-bounds.stoneWidthPx);
  const y=bounds.boxTop+position.yNorm*(bounds.boxHeight-bounds.stoneHeightPx);
  return point.x>=x-margin&&point.x<=x+bounds.stoneWidthPx+margin&&point.y>=y-margin&&point.y<=y+bounds.stoneHeightPx+margin;
}

/**
 * A gesture becomes a drag only when it began on the Stone region and has travelled past the
 * activation threshold. A touch that began anywhere else is never claimed, whatever direction it
 * moves in, which is what leaves ordinary vertical page scrolling untouched; a deliberate vertical
 * drag that started on the Stone is still honoured.
 */
export function shouldClaimDragGesture(gesture:{dx:number;dy:number;onStone:boolean}):boolean{
  if(!gesture.onStone)return false;
  return Math.hypot(gesture.dx,gesture.dy)>DRAG_ACTIVATION_THRESHOLD_PX;
}

export type NudgeDirection='left'|'right'|'up'|'down';

export function nudgeLiftStonePosition(position:LiftStonePosition,direction:NudgeDirection,step=LIFT_NUDGE_STEP_NORM):LiftStonePosition{
  const dx=direction==='left'?-step:direction==='right'?step:0;
  const dy=direction==='up'?-step:direction==='down'?step:0;
  return{xNorm:Number(clamp(position.xNorm+dx,0,1).toFixed(4)),yNorm:Number(clamp(position.yNorm+dy,0,1).toFixed(4))};
}

export function resetLiftStonePosition():LiftStonePosition{return{...DEFAULT_LIFT_STONE_POSITION};}

/** The measured Stone extents a detailed placement has to fit inside its lift; null when nothing was measured. */
function stoneExtents(lift:LiftDiagramLift){
  const stone=lift.stoneGeometry;
  if(!stone)return null;
  return{
    lengthM:stone.lengthM,heightM:stone.heightM,
    thicknessM:Math.max(stone.bottomThicknessM,stone.topThicknessM),
    liftLengthM:lift.geometry.lengthM,liftHeightM:lift.geometry.heightM,
    liftThicknessM:Math.min(lift.geometry.bottomThicknessM,lift.geometry.topThicknessM),
  };
}

/** The furthest each offset can travel with the complete measured Stone geometry still inside the lift. */
function offsetLimits(lift:LiftDiagramLift){
  const extents=stoneExtents(lift);
  if(!extents)return null;
  return{
    longitudinal:Math.max(0,round(extents.liftLengthM-extents.lengthM)),
    vertical:Math.max(0,round(extents.liftHeightM-extents.heightM)),
    transverse:Math.max(0,round((extents.liftThicknessM-extents.thicknessM)/2)),
  };
}

/**
 * Detailed mode. The pixel delta is converted into real metres through the diagram's current scale,
 * then clamped so the measured Stone geometry stays inside the lift. The transverse offset is carried
 * through untouched: the drawn plane does not represent it, so dragging must never appear to set it.
 */
export function liftStoneOffsetsFromViewBoxPoint(point:{x:number;y:number},lift:LiftDiagramLift,bounds:LiftDragBounds):LiftStoneOffsets{
  const extents=stoneExtents(lift);
  const transverseOffsetM=lift.offsets?.transverseOffsetM??0;
  if(!extents)return{longitudinalOffsetM:0,verticalOffsetM:0,transverseOffsetM};
  const alongM=((point.x-bounds.boxLeft)/bounds.boxWidth)*extents.liftLengthM;
  const fromBottomM=((bounds.boxTop+bounds.boxHeight-point.y)/bounds.boxHeight)*extents.liftHeightM;
  return clampLiftStoneOffsets({
    longitudinalOffsetM:round(alongM-extents.lengthM/2),
    verticalOffsetM:round(fromBottomM-extents.heightM/2),
    transverseOffsetM,
  },lift);
}

export function clampLiftStoneOffsets(offsets:LiftStoneOffsets,lift:LiftDiagramLift):LiftStoneOffsets{
  const limits=offsetLimits(lift);
  if(!limits)return offsets;
  return{
    longitudinalOffsetM:round(clamp(offsets.longitudinalOffsetM,0,limits.longitudinal)),
    verticalOffsetM:round(clamp(offsets.verticalOffsetM,0,limits.vertical)),
    transverseOffsetM:round(clamp(offsets.transverseOffsetM,-limits.transverse,limits.transverse)),
  };
}

/** Typed offsets are reported, never silently corrected, so a value that would put Stone outside its lift is visible as an error. */
export function validateLiftStoneOffsets(offsets:LiftStoneOffsets,lift:LiftDiagramLift):string[]{
  const limits=offsetLimits(lift);
  if(!limits)return['Stone needs measured dimensions before a detailed position can be checked. Use the Stone calculator first.'];
  const issues:string[]=[];
  const check=(value:number,low:number,high:number,message:string)=>{
    if(!Number.isFinite(value))issues.push(`${message} must be a number.`);
    else if(value<low-1e-9||value>high+1e-9)issues.push(`${message} of ${metres(value)} would place the Stone outside this lift. Enter between ${metres(low)} and ${metres(high)}.`);
  };
  check(offsets.longitudinalOffsetM,0,limits.longitudinal,'Offset along the lift');
  check(offsets.verticalOffsetM,0,limits.vertical,'Offset above the lift base');
  check(offsets.transverseOffsetM,-limits.transverse,limits.transverse,'Transverse offset');
  return issues;
}

export function nudgeLiftStoneOffsets(offsets:LiftStoneOffsets,direction:NudgeDirection,lift:LiftDiagramLift,step=LIFT_NUDGE_STEP_M):LiftStoneOffsets{
  const along=direction==='left'?-step:direction==='right'?step:0;
  const vertical=direction==='down'?-step:direction==='up'?step:0;
  return clampLiftStoneOffsets({
    longitudinalOffsetM:round(offsets.longitudinalOffsetM+along),
    verticalOffsetM:round(offsets.verticalOffsetM+vertical),
    transverseOffsetM:offsets.transverseOffsetM,
  },lift);
}

/** Centres the measured Stone geometry in its lift, on the drawn plane only; the transverse offset returns to zero. */
export function resetLiftStoneOffsets(lift:LiftDiagramLift):LiftStoneOffsets{
  const limits=offsetLimits(lift);
  if(!limits)return{longitudinalOffsetM:0,verticalOffsetM:0,transverseOffsetM:0};
  return{longitudinalOffsetM:round(limits.longitudinal/2),verticalOffsetM:round(limits.vertical/2),transverseOffsetM:0};
}

/** The spoken equivalent of the drawing, so the placement can be read and checked without seeing it. */
export function describeStonePlacement(lift:LiftDiagramLift):string{
  const extents=stoneExtents(lift);
  if(isDetailed(lift)&&extents){
    const offsets=lift.offsets!;
    return `Stone placed ${metres(offsets.longitudinalOffsetM)} along the lift, ${metres(offsets.verticalOffsetM)} above its base, `
      +`${metres(offsets.transverseOffsetM)} across. Each nudge moves it ${metres(LIFT_NUDGE_STEP_M)}. ${LIFT_DIAGRAM_PLANE_LABEL}`;
  }
  const position=lift.position??DEFAULT_LIFT_STONE_POSITION;
  const across=position.xNorm<=.33?'left':position.xNorm>=.67?'right':'centre';
  const down=position.yNorm<=.33?'top':position.yNorm>=.67?'bottom':'middle';
  return `Stone shown at the ${down} ${across} of the lift, schematic placement only. `
    +`Each nudge moves it ${Math.round(LIFT_NUDGE_STEP_NORM*100)} percent of the lift.`;
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

export type LiftDiagramLegendEntry={marker:string;label:string;value:string;fill:string;pattern:LayerPattern;patternId:string};
export type LiftDiagram={
  width:number;height:number;elements:DiagramElement[];patterns:DiagramPatternDef[];
  legend:LiftDiagramLegendEntry[];svg:string;dragBounds:LiftDragBounds;exaggerated:boolean;
  plane:string;stoneVolumeM3:number;
};

/** A small drawing surface the single-lift figure, the stack and the combined view all share. */
function canvas(){
  const elements:DiagramElement[]=[];
  return{
    elements,
    rect:(x:number,y:number,width:number,height:number,fill:string,stroke:string|null=INK,dash?:string)=>
      elements.push({kind:'rect',x:round(x),y:round(y),width:round(Math.max(0,width)),height:round(Math.max(0,height)),fill,stroke,dash}),
    polygon:(points:[number,number][],fill:string,stroke:string=INK)=>
      elements.push({kind:'polygon',points:points.map(([x,y])=>[round(x),round(y)] as [number,number]),fill,stroke}),
    line:(x1:number,y1:number,x2:number,y2:number,stroke=INK,dash?:string)=>
      elements.push({kind:'line',x1:round(x1),y1:round(y1),x2:round(x2),y2:round(y2),stroke,dash}),
    circle:(cx:number,cy:number,r:number,fill:string,stroke=INK)=>elements.push({kind:'circle',cx:round(cx),cy:round(cy),r,fill,stroke}),
    write:(value:string,x:number,y:number,options:{size?:number;weight?:number;fill?:string;anchor?:'start'|'middle'|'end';rtl?:boolean}={})=>
      elements.push({kind:'text',value,x:round(x),y:round(y),size:options.size??10,weight:options.weight??400,fill:options.fill??INK,anchor:options.anchor??'start',rtl:options.rtl??false}),
  };
}
type Canvas=ReturnType<typeof canvas>;

/** Right-to-left text is drawn from its own right edge so it stays inside its column instead of running off the figure. */
function labelText(page:Canvas,value:string,left:number,right:number,y:number,options:{size?:number;weight?:number;fill?:string}={}){
  if(hasArabic(value))page.write(value,right,y,{...options,anchor:'end',rtl:true});
  else page.write(value,left,y,options);
}

/** The Stone region for one lift, drawn inside a given envelope box. Returns whether it had to be widened to stay visible. */
function drawStoneRegion(page:Canvas,lift:LiftDiagramLift,bounds:LiftDragBounds,marker:string,options:{markers:boolean}={markers:true}):boolean{
  const extents=stoneExtents(lift);
  if(isDetailed(lift)&&extents){
    const offsets=clampLiftStoneOffsets(lift.offsets!,lift);
    const rawWidth=(extents.lengthM/extents.liftLengthM)*bounds.boxWidth;
    const rawHeight=(extents.heightM/extents.liftHeightM)*bounds.boxHeight;
    const width=Math.max(MIN_REGION_PX,rawWidth),height=Math.max(MIN_REGION_PX,rawHeight);
    const left=clamp(bounds.boxLeft+(offsets.longitudinalOffsetM/extents.liftLengthM)*bounds.boxWidth,bounds.boxLeft,bounds.boxLeft+bounds.boxWidth-width);
    const bottom=bounds.boxTop+bounds.boxHeight-(offsets.verticalOffsetM/extents.liftHeightM)*bounds.boxHeight;
    const top=clamp(bottom-height,bounds.boxTop,bounds.boxTop+bounds.boxHeight-height);
    page.polygon([[left,top+height],[left+width,top+height],[left+width,top],[left,top]],STONE_FILL);
    page.polygon([[left,top+height],[left+width,top+height],[left+width,top],[left,top]],`url(#${STONE_PATTERN_ID})`,'none');
    if(options.markers){page.circle(left+width/2,top+height/2,7,'#FFFFFF');page.write(marker,left+width/2,top+height/2+3,{size:8,weight:700,anchor:'middle'});}
    return rawWidth<MIN_REGION_PX||rawHeight<MIN_REGION_PX;
  }
  const position=lift.position??DEFAULT_LIFT_STONE_POSITION;
  const x=bounds.boxLeft+clamp(position.xNorm,0,1)*(bounds.boxWidth-bounds.stoneWidthPx);
  const y=bounds.boxTop+clamp(position.yNorm,0,1)*(bounds.boxHeight-bounds.stoneHeightPx);
  page.rect(x,y,bounds.stoneWidthPx,bounds.stoneHeightPx,STONE_FILL);
  page.rect(x,y,bounds.stoneWidthPx,bounds.stoneHeightPx,`url(#${STONE_PATTERN_ID})`,null);
  if(options.markers){page.circle(x+bounds.stoneWidthPx/2,y+bounds.stoneHeightPx/2,7,'#FFFFFF');page.write(marker,x+bounds.stoneWidthPx/2,y+bounds.stoneHeightPx/2+3,{size:8,weight:700,anchor:'middle'});}
  return false;
}

/** The concrete fill for a lift: absent while planned, an estimated space once Stone is placed, the poured matrix once recorded. */
function concreteFillFor(lift:LiftDiagramLift):string{
  if(lift.status==='planned')return 'none';
  return lift.actualReadyMixM3!=null?CONCRETE_POURED_FILL:CONCRETE_ESTIMATE_FILL;
}

export function buildLiftDiagram(lift:LiftDiagramLift,options:{contextLabel?:string|null}={}):LiftDiagram{
  const page=canvas();
  const bounds=liftDragBounds(lift);
  const maxThickness=Math.max(lift.geometry.bottomThicknessM,lift.geometry.topThicknessM)||1;
  const scale=(BOX_SPAN-30)/maxThickness;
  const centreX=BOX_LEFT+BOX_SPAN/2,boxBottom=BOX_TOP+BOX_HEIGHT;
  const bottomHalf=(lift.geometry.bottomThicknessM*scale)/2,topHalf=(lift.geometry.topThicknessM*scale)/2;
  const hasStone=stoneVolumeOf(lift)>0&&lift.status!=='planned';
  const poured=lift.actualReadyMixM3!=null;

  labelText(page,clip(lift.reference,30),PADDING,WIDTH-PADDING,24,{size:13,weight:700});
  // Suppressed when the reference already is exactly that, so the heading is not printed twice.
  if(lift.reference.trim()!==`Lift ${lift.sequence}`)page.write(`Lift ${lift.sequence}`,PADDING,39,{size:9,weight:700,fill:RESULT});
  page.write(liftStatusText[lift.status],WIDTH-PADDING,39,{size:9,weight:700,anchor:'end',fill:poured?RESULT:MUTED});
  if(options.contextLabel)page.write(clip(options.contextLabel,44),PADDING,52,{size:8,fill:MUTED});
  page.write(LIFT_DIAGRAM_PLANE_LABEL,PADDING,options.contextLabel?64:52,{size:8,fill:MUTED});
  page.write(LIFT_TRANSVERSE_NOTE,PADDING,options.contextLabel?74:62,{size:8,fill:MUTED});

  // The envelope is drawn first and filled with the concrete state, so the Stone region placed on top
  // of it always reads as sitting inside the matrix rather than as a slab standing beside it.
  const envelope:[number,number][]=[[centreX-bottomHalf,boxBottom],[centreX+bottomHalf,boxBottom],[centreX+topHalf,BOX_TOP],[centreX-topHalf,BOX_TOP]];
  page.polygon(envelope,concreteFillFor(lift));
  // Concrete always carries a pattern once it exists, a different one poured than estimated, so the
  // two never rely on colour alone (DEC-469).
  if(lift.status!=='planned')page.polygon(envelope,`url(#${concretePatternFor(poured)})`,'none');

  const exaggerated=hasStone?drawStoneRegion(page,lift,bounds,String(lift.sequence)):false;
  if(hasStone&&!isDetailed(lift))page.write('Schematic placement — not to scale',bounds.boxLeft,BOX_TOP-8,{size:8,fill:RESULT});
  if(hasStone&&!poured)page.write('Estimated concrete space',centreX,boxBottom+14,{size:8,anchor:'middle',fill:MUTED});

  page.write(`Start elevation ${metres(lift.startElevationM)} · height ${metres(lift.geometry.heightM)}`,centreX,boxBottom+28,{size:9,anchor:'middle'});
  page.write(`Bottom ${metres(lift.geometry.bottomThicknessM)} · Top ${metres(lift.geometry.topThicknessM)}`,centreX,BOX_TOP-22,{size:9,anchor:'middle',fill:MUTED});
  page.write(`${metres(lift.geometry.lengthM)} long`,centreX,boxBottom+42,{size:9,anchor:'middle',fill:MUTED});

  const legend:LiftDiagramLegendEntry[]=[];
  // A planned lift has no Stone swatch to show: nothing has been recorded, so nothing is coloured in.
  legend.push({marker:String(lift.sequence),label:'Stone recorded',value:hasStone?cubic(stoneVolumeOf(lift)):'None recorded',fill:hasStone?STONE_FILL:'none',pattern:'diagonal',patternId:STONE_PATTERN_ID});
  legend.push({marker:`${lift.sequence}C`,label:poured?'Concrete matrix recorded':'Concrete matrix estimated',value:cubic(poured?lift.actualReadyMixM3!:lift.estimatedConcreteM3),fill:poured?CONCRETE_POURED_FILL:CONCRETE_ESTIMATE_FILL,pattern:poured?'cross':'dots',patternId:concretePatternFor(poured)});

  // The legend sits under the drawing, one row per phase, with the value right-aligned so the
  // numbers form a readable column on a narrow screen.
  let cursor=boxBottom+62;
  page.write('Lift quantities',PADDING,cursor,{size:10,weight:700});
  cursor+=17;
  const legendLine=(label:string,value:string,fill=INK)=>{
    page.write(label,PADDING,cursor,{size:9,fill:MUTED});
    page.write(value,WIDTH-PADDING,cursor,{size:10,weight:700,anchor:'end',fill});
    cursor+=17;
  };
  legendLine('Lift structural volume',cubic(lift.netLiftVolumeM3));
  for(const entry of legend){
    page.rect(PADDING,cursor-9,12,11,entry.fill,INK,entry.fill==='none'?'3 2':undefined);
    if(entry.fill!=='none')page.rect(PADDING,cursor-9,12,11,`url(#${entry.patternId})`,null);
    page.write(entry.marker,PADDING+18,cursor,{size:8,weight:700,fill:RESULT});
    page.write(entry.label,PADDING+36,cursor,{size:9,fill:MUTED});
    page.write(entry.value,WIDTH-PADDING,cursor,{size:10,weight:700,anchor:'end'});
    cursor+=18;
  }
  if(lift.variance)legendLine('Variance (actual vs. estimated)',
    lift.variance.direction==='none'?'Matches estimate':`${lift.variance.direction==='over'?'+':'−'}${cubic(Math.abs(lift.variance.varianceM3))}`,
    lift.variance.direction==='none'?MUTED:ALERT);
  if(exaggerated){
    page.write('Thin Stone shown wider than scale so it stays visible.',PADDING,cursor,{size:8,fill:ALERT});
    page.write('The measurements listed are the recorded ones.',PADDING,cursor+11,{size:8,fill:ALERT});
    cursor+=24;
  }

  const height=round(cursor+10);
  const model={width:WIDTH,height,elements:page.elements,patterns:PATTERNS,legend:[],exaggerated};
  return{width:WIDTH,height,elements:page.elements,patterns:PATTERNS,legend,svg:wallDiagramToSvg(model),dragBounds:bounds,exaggerated,plane:LIFT_DIAGRAM_PLANE_LABEL,stoneVolumeM3:round(stoneVolumeOf(lift))};
}

// ---------------------------------------------------------------------------------------------
// Stacks: every lift in a foundation or wall, and the combined foundation + wall schematic
// ---------------------------------------------------------------------------------------------

export type StackDiagramInput={
  title:string;contextLabel:string|null;parentLabel:string;
  parentNetVolumeM3:number;lifts:LiftDiagramLift[];reconciliation:LiftReconciliation;
  curingNote?:string|null;legacyStage?:LegacyCompositeStage|null;selectedLiftId?:string|null;
};
/** Projects a parent's persisted lifts into the stack input, so no screen has to map them itself. */
export function stackInputFrom(params:Omit<StackDiagramInput,'lifts'>&{lifts:ConstructionLift[]}):StackDiagramInput{
  return{...params,lifts:params.lifts.map(liftDiagramLiftFrom)};
}

export type StackBand={liftId:string;sequence:number;reference:string;status:LiftStatus;top:number;height:number;parentLabel:string};
export type StackDiagram={
  width:number;height:number;elements:DiagramElement[];patterns:DiagramPatternDef[];svg:string;
  bands:StackBand[];legend:LiftDiagramLegendEntry[];unallocated:number;overAllocated:boolean;
  compact:boolean;selected:StackBand|null;exaggerated:boolean;
};

// The band column is kept to under half the width so each lift's reference, status and volumes have
// a readable column of their own beside it rather than being squeezed against the edge.
const STACK_LEFT=PADDING+26,STACK_SPAN=WIDTH-STACK_LEFT-PADDING;
const BAND_WIDTH_FRACTION=.42;
const COMPACT_THRESHOLD=8;

/** Lays one parent's ordered lifts into the page, growing upward from `bottomY` the way they are built. */
function layoutStack(page:Canvas,input:StackDiagramInput,bottomY:number,compact:boolean):{bands:StackBand[];topY:number;exaggerated:boolean}{
  const ordered=orderLiftsBySequence(input.lifts);
  const bandHeight=compact?15:48,gap=compact?3:9;
  const maxThickness=Math.max(...ordered.map(value=>averageThickness(value.geometry)),.001);
  const centreX=STACK_LEFT+STACK_SPAN*BAND_WIDTH_FRACTION/2;
  const bands:StackBand[]=[];
  let exaggerated=false;

  for(const[index,lift]of ordered.entries()){
    const top=bottomY-(index+1)*bandHeight-index*gap;
    const width=Math.max(44,(averageThickness(lift.geometry)/maxThickness)*STACK_SPAN*BAND_WIDTH_FRACTION);
    const left=centreX-width/2;
    const bounds:LiftDragBounds={boxLeft:left,boxTop:top,boxWidth:width,boxHeight:bandHeight,
      stoneWidthPx:Math.max(14,width*.32),stoneHeightPx:Math.max(6,bandHeight*.45)};
    const poured=lift.actualReadyMixM3!=null;
    page.rect(left,top,width,bandHeight,concreteFillFor(lift),INK,lift.status==='planned'?'4 3':undefined);
    if(lift.status!=='planned')page.rect(left,top,width,bandHeight,`url(#${concretePatternFor(poured)})`,null);
    if(stoneVolumeOf(lift)>0&&lift.status!=='planned'){
      if(drawStoneRegion(page,lift,bounds,String(lift.sequence),{markers:!compact}))exaggerated=true;
    }
    page.circle(STACK_LEFT-14,top+bandHeight/2,8,'#FFFFFF');
    page.write(String(lift.sequence),STACK_LEFT-14,top+bandHeight/2+3,{size:8,weight:700,anchor:'middle'});
    if(!compact){
      const textLeft=STACK_LEFT+STACK_SPAN*BAND_WIDTH_FRACTION+10;
      labelText(page,clip(lift.reference,22),textLeft,WIDTH-PADDING,top+13,{size:9,weight:700});
      page.write(liftStatusText[lift.status],textLeft,top+26,{size:8,fill:lift.status==='completed'?RESULT:MUTED});
      page.write(`${cubic(lift.netLiftVolumeM3)} · Stone ${cubic(stoneVolumeOf(lift))}`,textLeft,top+39,{size:8,fill:MUTED});
    }
    bands.push({liftId:lift.id,sequence:lift.sequence,reference:lift.reference,status:lift.status,top:round(top),height:bandHeight,parentLabel:input.parentLabel});
  }

  let topY=ordered.length?bottomY-ordered.length*bandHeight-(ordered.length-1)*gap:bottomY;
  const unallocated=input.reconciliation.remainingUnallocatedVolumeM3;
  if(unallocated>1e-9){
    const height=compact?13:22;
    topY-=gap+height;
    page.rect(STACK_LEFT+STACK_SPAN*.15,topY,STACK_SPAN*.7,height,'none',MUTED,'3 3');
    page.write(`Unallocated structural volume ${cubic(unallocated)}`,STACK_LEFT+STACK_SPAN*.15+6,topY+height-7,{size:8,fill:MUTED});
  }
  if(input.reconciliation.overAllocated){
    topY-=gap+18;
    page.rect(STACK_LEFT,topY,STACK_SPAN,18,'#FBEAE7',ALERT);
    page.write(`Over-allocated by ${cubic(input.reconciliation.overAllocationM3)} — lifts exceed the ${input.parentLabel.toLowerCase()} envelope.`,STACK_LEFT+6,topY+12,{size:8,weight:700,fill:ALERT});
  }
  return{bands,topY,exaggerated};
}

function stackLegendEntries(bands:StackBand[]):LiftDiagramLegendEntry[]{
  const anyPoured=bands.some(band=>band.status==='completed');
  return[
    {marker:'▦',label:'Stone',value:'Placed inside its lift',fill:STONE_FILL,pattern:'diagonal',patternId:STONE_PATTERN_ID},
    {marker:'▩',label:anyPoured?'Concrete matrix (recorded)':'Concrete matrix (estimated)',value:'Fills around the Stone',fill:anyPoured?CONCRETE_POURED_FILL:CONCRETE_ESTIMATE_FILL,pattern:anyPoured?'cross':'dots',patternId:concretePatternFor(anyPoured)},
    {marker:'▢',label:'Planned lift',value:'Envelope only',fill:'none',pattern:'solid',patternId:CONCRETE_PATTERN_ID},
  ];
}

function drawLegend(page:Canvas,entries:LiftDiagramLegendEntry[],x:number,startY:number):number{
  let cursor=startY;
  page.write('Legend',x,cursor,{size:10,weight:700});
  cursor+=8;
  for(const entry of entries){
    cursor+=17;
    page.rect(x,cursor-9,12,11,entry.fill==='none'?'none':entry.fill,INK,entry.fill==='none'?'3 2':undefined);
    if(entry.fill!=='none')page.rect(x,cursor-9,12,11,`url(#${entry.patternId})`,null);
    page.write(entry.marker,x+18,cursor,{size:8,weight:700,fill:RESULT});
    page.write(entry.label,x+30,cursor,{size:8,weight:700});
    page.write(entry.value,x+30,cursor+10,{size:8,fill:MUTED});
    cursor+=10;
  }
  return cursor+10;
}

function drawSelectedDetail(page:Canvas,input:StackDiagramInput,y:number):number{
  const selected=input.lifts.find(value=>value.id===input.selectedLiftId);
  if(!selected)return y;
  page.rect(PADDING,y,WIDTH-PADDING*2,44,'#F7F5F0',INK);
  labelText(page,clip(selected.reference,40),PADDING+8,WIDTH-PADDING-8,y+16,{size:10,weight:700});
  page.write(`Lift ${selected.sequence} · ${liftStatusText[selected.status]}`,PADDING+8,y+29,{size:8,fill:MUTED});
  page.write(`Structural ${cubic(selected.netLiftVolumeM3)} · Stone ${cubic(stoneVolumeOf(selected))} · Concrete ${cubic(selected.actualReadyMixM3??selected.estimatedConcreteM3)}`,PADDING+8,y+40,{size:8,fill:MUTED});
  return y+54;
}

function finishStack(page:Canvas,input:StackDiagramInput,bands:StackBand[],_topY:number,compact:boolean,exaggerated:boolean,bottomY:number):StackDiagram{
  const legend=stackLegendEntries(bands);
  let cursor=drawLegend(page,legend,PADDING,bottomY+30);
  if(input.curingNote){page.write(clip(input.curingNote,72),PADDING,cursor,{size:8,fill:MUTED});cursor+=14;}
  if(input.legacyStage){
    page.rect(PADDING,cursor,WIDTH-PADDING*2,48,'#F2EFE8',MUTED,'4 3');
    page.write(input.legacyStage.label,PADDING+8,cursor+15,{size:9,weight:700,fill:MUTED});
    page.write(`Stone ${cubic(input.legacyStage.activeStoneM3)} · estimated concrete ${cubic(input.legacyStage.estimatedConcreteM3)}`,PADDING+8,cursor+28,{size:8,fill:MUTED});
    page.write('Recorded before ordered lifts. Never re-drawn as lifts.',PADDING+8,cursor+41,{size:8,fill:MUTED});
    cursor+=58;
  }
  if(input.selectedLiftId)cursor=drawSelectedDetail(page,input,cursor);
  if(exaggerated){page.write('Thin Stone regions are shown wider than scale so they stay visible; the listed measurements are the recorded ones.',PADDING,cursor,{size:8,fill:ALERT});cursor+=14;}
  const height=round(cursor+10);
  const model={width:WIDTH,height,elements:page.elements,patterns:PATTERNS,legend:[],exaggerated};
  return{
    width:WIDTH,height,elements:page.elements,patterns:PATTERNS,svg:wallDiagramToSvg(model),
    bands,legend,unallocated:round(input.reconciliation.remainingUnallocatedVolumeM3),
    overAllocated:input.reconciliation.overAllocated,compact,
    selected:bands.find(band=>band.liftId===input.selectedLiftId)??null,exaggerated,
  };
}

/** Header shared by the single-parent stack and each half of the combined schematic. */
function drawStackHeader(page:Canvas,input:StackDiagramInput,y:number):number{
  labelText(page,clip(input.title,26),PADDING,WIDTH-PADDING-60,y,{size:13,weight:700});
  page.write(input.parentLabel,WIDTH-PADDING,y,{size:10,weight:700,anchor:'end',fill:RESULT});
  if(input.contextLabel)labelText(page,clip(input.contextLabel,40),PADDING,WIDTH-PADDING,y+13,{size:9,fill:MUTED});
  page.write(`Envelope ${cubic(input.parentNetVolumeM3)} · allocated ${cubic(input.reconciliation.totalAllocatedLiftVolumeM3)}`,PADDING,y+26,{size:8,fill:MUTED});
  page.write(LIFT_DIAGRAM_PLANE_LABEL,PADDING,y+37,{size:8,fill:MUTED});
  return y+47;
}

export function buildConstructionLiftStackDiagram(input:StackDiagramInput):StackDiagram{
  const page=canvas();
  const compact=input.lifts.length>COMPACT_THRESHOLD;
  const headerBottom=drawStackHeader(page,input,26);
  const bandHeight=compact?15:48,gap=compact?3:9;
  const stackHeight=input.lifts.length?input.lifts.length*bandHeight+(input.lifts.length-1)*gap:0;
  const bottomY=headerBottom+stackHeight+(compact?26:34);
  const {bands,topY,exaggerated}=layoutStack(page,input,bottomY,compact);
  page.line(PADDING,bottomY,STACK_LEFT+STACK_SPAN*BAND_WIDTH_FRACTION+8,bottomY);
  page.write('Base of the first lift',PADDING,bottomY+12,{size:8,fill:MUTED});
  if(!input.lifts.length&&!input.legacyStage)page.write('No lifts recorded yet.',STACK_LEFT,bottomY-14,{size:9,fill:MUTED});
  return finishStack(page,input,bands,topY,compact,exaggerated,bottomY);
}

export type CombinedDiagramInput={foundation:StackDiagramInput;wall:StackDiagramInput|null};

/**
 * The foundation with the wall standing on it: one drawing, two clearly separated parents, so a lift
 * can never be read as belonging to the wrong one.
 */
export function buildCombinedConstructionLiftDiagram(input:CombinedDiagramInput):StackDiagram{
  const page=canvas();
  const foundationCompact=input.foundation.lifts.length>COMPACT_THRESHOLD;
  const wallCompact=(input.wall?.lifts.length??0)>COMPACT_THRESHOLD;
  const compact=foundationCompact||wallCompact||true;
  const bandHeight=15,gap=3;
  const headerBottom=drawStackHeader(page,input.foundation,26);

  const wallCount=input.wall?.lifts.length??0;
  const wallHeight=wallCount?wallCount*bandHeight+(wallCount-1)*gap:0;
  const foundationCount=input.foundation.lifts.length;
  const foundationHeight=foundationCount?foundationCount*bandHeight+(foundationCount-1)*gap:0;

  const wallBottom=headerBottom+26+wallHeight;
  let bands:StackBand[]=[],exaggerated=false;
  if(input.wall){
    page.write(`${input.wall.parentLabel}: ${clip(input.wall.title,30)}`,PADDING,headerBottom+14,{size:9,weight:700,fill:RESULT});
    const laid=layoutStack(page,{...input.wall,selectedLiftId:input.wall.selectedLiftId??null},wallBottom,true);
    bands=bands.concat(laid.bands);
    exaggerated=exaggerated||laid.exaggerated;
  }else{
    page.write('No wall linked to this foundation yet.',PADDING,headerBottom+14,{size:9,fill:MUTED});
  }

  // The construction joint: everything above it is the wall, everything below it the foundation.
  const jointY=wallBottom+10;
  page.line(PADDING,jointY,WIDTH-PADDING,jointY,INK,'6 3');
  page.write('Construction joint — wall above, foundation below',PADDING,jointY-5,{size:8,fill:MUTED});

  const foundationBottom=jointY+22+foundationHeight;
  page.write(`${input.foundation.parentLabel}: ${clip(input.foundation.title,30)}`,PADDING,jointY+14,{size:9,weight:700,fill:RESULT});
  const laidFoundation=layoutStack(page,input.foundation,foundationBottom,true);
  bands=bands.concat(laidFoundation.bands);
  exaggerated=exaggerated||laidFoundation.exaggerated;

  page.line(PADDING,foundationBottom,STACK_LEFT+STACK_SPAN*BAND_WIDTH_FRACTION+8,foundationBottom);
  page.write('Base of the foundation',PADDING,foundationBottom+12,{size:8,fill:MUTED});
  if(input.wall?.curingNote)page.write(clip(input.wall.curingNote,72),PADDING,foundationBottom+24,{size:8,fill:ALERT});

  return finishStack(page,{...input.foundation,selectedLiftId:input.foundation.selectedLiftId??null},bands,laidFoundation.topY,compact,exaggerated,foundationBottom+(input.wall?.curingNote?14:0));
}
