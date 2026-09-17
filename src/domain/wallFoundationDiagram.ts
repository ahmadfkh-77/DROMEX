import {wallDiagramToSvg,type DiagramElement,type DiagramPatternDef} from './wallDiagram';
import type {ConcreteVariance,FoundationCompositionMode,StoneCoreMode,StoneCoreOffsets,StoneCorePosition} from './wallFoundation';

/**
 * DEC-461. The composite foundation's own technical drawing: an outer boundary with the Stone core
 * always drawn inside it, never beside it. The concrete region reads as the space surrounding the
 * core, not a second adjacent block. Deterministic from the recorded data; no bitmap, nothing fetched.
 */
export type FoundationDiagramBaseStatus='planned'|'constructed'|'curing'|'cured';
export type FoundationDiagramInput={
  referenceLabel:string;lengthM:number;heightM:number;bottomThicknessM:number;topThicknessM:number;
  status:FoundationDiagramBaseStatus;netFoundationVolumeM3:number;
  mode:FoundationCompositionMode;stoneCoreMode:StoneCoreMode|null;position:StoneCorePosition|null;offsets:StoneCoreOffsets|null;
  activeStoneM3:number;activeReadyMixM3:number;estimatedConcreteM3:number;variance:ConcreteVariance|null;
};
export type FoundationDiagram={width:number;height:number;elements:DiagramElement[];patterns:DiagramPatternDef[];svg:string};

const round=(value:number)=>Number(value.toFixed(9));
const metres=(value:number)=>`${round(value)} m`;
const cubic=(value:number)=>`${round(value)} m³`;
const INK='#17212b',MUTED='#65717d',RESULT='#04545d',STONE_FILL='#8C8579',CONCRETE_FILL='#B9B2A2',CONCRETE_ESTIMATE='#DDD7C9';
const WIDTH=520,PADDING=18;

const statusLabels:Record<FoundationDiagramBaseStatus,string>={planned:'Foundation planned',constructed:'Constructed / poured',curing:'Curing',cured:'Confirmed cured'};

/**
 * Builds the outer trapezoid, an inner Stone-core polygon positioned either by normalized simple-mode
 * coordinates or by detailed-mode offsets, and a legend with volumes and variance. Nothing is drawn as
 * poured until an active Ready Mix record actually exists.
 */
export function buildFoundationDiagram(input:FoundationDiagramInput):FoundationDiagram{
  const elements:DiagramElement[]=[];
  const rect=(x:number,y:number,width:number,height:number,fill:string,stroke:string|null=INK,dash?:string)=>elements.push({kind:'rect',x:round(x),y:round(y),width:round(Math.max(0,width)),height:round(Math.max(0,height)),fill,stroke,dash});
  const polygon=(points:[number,number][],fill:string,stroke=INK)=>elements.push({kind:'polygon',points:points.map(([x,y])=>[round(x),round(y)] as [number,number]),fill,stroke});
  const write=(value:string,x:number,y:number,options:{size?:number;weight?:number;fill?:string;anchor?:'start'|'middle'|'end'}={})=>elements.push({kind:'text',value,x:round(x),y:round(y),size:options.size??10,weight:options.weight??400,fill:options.fill??INK,anchor:options.anchor??'start',rtl:false});

  const boxTop=54,boxLeft=PADDING+70,boxWidth=WIDTH-boxLeft-PADDING-140,boxHeight=180;
  const boxBottom=boxTop+boxHeight,centreX=boxLeft+boxWidth/2;
  const maxThickness=Math.max(input.bottomThicknessM,input.topThicknessM);
  const scale=(boxWidth-30)/(maxThickness||1);
  const hasStone=input.activeStoneM3>0,hasReadyMix=input.activeReadyMixM3>0;
  const isComposite=input.mode==='composite';

  write(input.referenceLabel,PADDING,24,{size:13,weight:700});
  write(statusLabels[input.status],WIDTH-PADDING,24,{size:10,weight:700,anchor:'end',fill:RESULT});
  write('Cross-section, generated from the recorded geometry. Not to scale.',PADDING,38,{size:8,fill:MUTED});

  // Outer foundation boundary: an empty outline until any composite material is actually recorded.
  const outerBottomHalf=(input.bottomThicknessM*scale)/2,outerTopHalf=(input.topThicknessM*scale)/2;
  const outerPoints:[number,number][]=[[centreX-outerBottomHalf,boxBottom],[centreX+outerBottomHalf,boxBottom],[centreX+outerTopHalf,boxTop],[centreX-outerTopHalf,boxTop]];
  if(!isComposite||(!hasStone&&!hasReadyMix)){
    polygon(outerPoints,'none',INK);
  }else{
    // Concrete fills the outer trapezoid first, so the Stone core drawn afterwards reads as sitting
    // inside it -- never as a block beside it.
    polygon(outerPoints,hasReadyMix?CONCRETE_FILL:CONCRETE_ESTIMATE,INK);
    if(!hasReadyMix)write('Estimated space — not yet poured',centreX,boxBottom+14,{size:8,anchor:'middle',fill:MUTED});
  }

  if(isComposite&&hasStone){
    const coreHeightFraction=Math.min(.85,Math.sqrt(Math.max(.02,input.activeStoneM3/Math.max(input.netFoundationVolumeM3,.001))));
    if(input.stoneCoreMode==='detailed'&&input.offsets){
      const o=input.offsets;
      const coreLeft=boxLeft+(o.longitudinalOffsetM/input.lengthM)*boxWidth;
      const coreWidthPx=(o.lengthM/input.lengthM)*boxWidth;
      const coreBottomY=boxBottom-(o.verticalOffsetM/input.heightM)*boxHeight;
      const coreTopY=coreBottomY-(o.depthM/input.heightM)*boxHeight;
      const bHalf=(o.bottomThicknessM*scale)/2,tHalf=(o.topThicknessM*scale)/2,coreCentreX=coreLeft+coreWidthPx/2;
      polygon([[coreCentreX-bHalf,coreBottomY],[coreCentreX+bHalf,coreBottomY],[coreCentreX+tHalf,coreTopY],[coreCentreX-tHalf,coreTopY]],STONE_FILL);
      write('Detailed geometry',boxLeft,boxTop-4,{size:8,anchor:'start',fill:RESULT});
    }else{
      const position=input.position??{xNorm:.5,yNorm:.5};
      const coreWidthPx=Math.max(24,boxWidth*.32),coreHeightPx=Math.max(20,boxHeight*coreHeightFraction*.5);
      const coreX=boxLeft+position.xNorm*(boxWidth-coreWidthPx),coreY=boxTop+position.yNorm*(boxHeight-coreHeightPx);
      rect(coreX,coreY,coreWidthPx,coreHeightPx,STONE_FILL);
      write('Schematic placement — not to scale',boxLeft,boxTop-4,{size:8,anchor:'start',fill:RESULT});
    }
  }

  write(`${metres(input.lengthM)} long`,centreX,boxBottom+28,{size:9,anchor:'middle'});
  write(`Bottom ${metres(input.bottomThicknessM)} · Top ${metres(input.topThicknessM)}`,centreX,boxTop-16,{size:9,anchor:'middle',fill:MUTED});

  // Legend
  const legendX=boxLeft+boxWidth+24;
  let cursor=boxTop+4;
  const legendLine=(label:string,value:string,fill=INK)=>{write(label,legendX,cursor,{size:9,fill:MUTED});write(value,legendX,cursor+13,{size:11,weight:700,fill});cursor+=32;};
  write('Foundation composition',legendX,boxTop-16,{size:10,weight:700});
  legendLine('Net foundation volume',cubic(input.netFoundationVolumeM3));
  if(isComposite){
    legendLine('Stone recorded',hasStone?cubic(input.activeStoneM3):'None recorded',STONE_FILL);
    legendLine('Estimated concrete remaining',cubic(input.estimatedConcreteM3),RESULT);
    if(hasReadyMix)legendLine('Actual Ready Mix recorded',cubic(input.activeReadyMixM3));
    if(input.variance)legendLine('Variance (actual vs. estimated)',`${input.variance.direction==='none'?'Matches estimate':input.variance.direction==='over'?'+':''}${cubic(input.variance.varianceM3)}${input.variance.direction==='under'?'':''}`.trim(),input.variance.direction==='none'?MUTED:INK);
  }else{
    write('Single-material base — not using the composite Stone-core model.',legendX,cursor,{size:9,fill:MUTED});
  }

  const stoneSwatch=legendX,swatchY=boxBottom-6;
  if(isComposite){
    rect(stoneSwatch,swatchY,10,10,STONE_FILL);write('Stone',stoneSwatch+14,swatchY+9,{size:8,fill:MUTED});
    rect(stoneSwatch,swatchY+16,10,10,hasReadyMix?CONCRETE_FILL:CONCRETE_ESTIMATE);write(hasReadyMix?'Concrete (poured)':'Concrete (estimated)',stoneSwatch+14,swatchY+25,{size:8,fill:MUTED});
  }

  const height=round(Math.max(boxBottom+50,cursor+10));
  const patterns:DiagramPatternDef[]=[];
  const diagram={width:WIDTH,height,elements,patterns,legend:[],exaggerated:false};
  return{width:WIDTH,height,elements,patterns,svg:wallDiagramToSvg(diagram)};
}
