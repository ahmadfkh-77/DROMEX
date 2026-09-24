import {wallDiagramToSvg,type DiagramElement,type DiagramPatternDef,type WallGeometry} from './wallDiagram';

/**
 * DEC-474. The Foundation structural envelope: the one figure that explains a foundation's overall
 * geometry, and nothing else.
 *
 * Before this existed the report drew a foundation by calling the wall diagram with an empty layer
 * list, which printed "No layers recorded" over an empty cross-section. That was wrong twice over: a
 * foundation is not built from wall layers, so the layer vocabulary does not apply to it at all, and
 * the empty-state text read as though the foundation's materials were missing when in fact they are
 * recorded through its Lifts and printed directly below.
 *
 * So this figure deliberately shows only the structural envelope -- reference, the four measured
 * dimensions, and the gross/net volumes with any deduction between them. It carries no Stone or
 * concrete quantity and no Lift geometry, because the Lift diagrams beneath it are what explain the
 * actual construction. The two are complementary: this one is the container, those are the contents.
 *
 * Like every other DROMEX figure it is deterministic inline SVG generated from the recorded numbers,
 * so the PDF stores no bitmap and fetches nothing.
 */
export type FoundationEnvelopeStatus='planned'|'constructed'|'curing'|'cured';
export type FoundationEnvelopeInput={
  referenceLabel:string;
  geometry:WallGeometry;
  status:FoundationEnvelopeStatus;
  grossVolumeM3:number;
  deductionM3:number;
  netVolumeM3:number;
};
export type FoundationEnvelopeDiagram={width:number;height:number;elements:DiagramElement[];patterns:DiagramPatternDef[];svg:string};

const round=(value:number)=>Number(value.toFixed(9));
const metres=(value:number)=>`${Number(value.toFixed(3))} m`;
const cubic=(value:number)=>`${Number(value.toFixed(3))} m³`;
const clip=(value:string,limit:number)=>value.length>limit?`${value.slice(0,limit-1)}…`:value;
const hasArabic=(value:string)=>/[؀-ۿ]/.test(value);

const INK='#17212b',MUTED='#65717d',RESULT='#04545d',PAPER='#EFEAE0',ENVELOPE_FILL='#CFC6B6';
const WIDTH=760,PADDING=18,ELEVATION_LEFT=PADDING+52,HEIGHT=250;

export const foundationEnvelopeStatusLabels:Record<FoundationEnvelopeStatus,string>={
  planned:'Planned',constructed:'Constructed / poured',curing:'Curing',cured:'Confirmed cured',
};

/**
 * Builds the elevation and the cross-section side by side, then states the volumes underneath. A
 * planned foundation is drawn as a dashed outline and never filled, so the drawing never implies a
 * foundation was poured before it actually was.
 */
export function buildFoundationEnvelopeDiagram(input:FoundationEnvelopeInput):FoundationEnvelopeDiagram{
  const {geometry}=input;
  const elements:DiagramElement[]=[];
  const rect=(x:number,y:number,width:number,height:number,fill:string,stroke:string|null=INK,dash?:string)=>
    elements.push({kind:'rect',x:round(x),y:round(y),width:round(Math.max(0,width)),height:round(Math.max(0,height)),fill,stroke,dash});
  // The serializer draws polygons without a dash pattern, so a planned foundation reads as unpoured
  // through its unfilled paper tone and muted outline instead.
  const polygon=(points:[number,number][],fill:string,stroke=INK)=>
    elements.push({kind:'polygon',points:points.map(([x,y])=>[round(x),round(y)] as [number,number]),fill,stroke});
  const line=(x1:number,y1:number,x2:number,y2:number,stroke=INK,dash?:string)=>
    elements.push({kind:'line',x1:round(x1),y1:round(y1),x2:round(x2),y2:round(y2),stroke,dash});
  const write=(value:string,x:number,y:number,options:{size?:number;weight?:number;fill?:string;anchor?:'start'|'middle'|'end';rtl?:boolean}={})=>
    elements.push({kind:'text',value,x:round(x),y:round(y),size:options.size??10,weight:options.weight??400,fill:options.fill??INK,anchor:options.anchor??'start',rtl:options.rtl??false});
  /** Right-to-left text is drawn from its right edge so an Arabic reference stays inside its own column. */
  const label=(value:string,left:number,right:number,y:number,options:{size?:number;weight?:number;fill?:string}={})=>
    hasArabic(value)?write(value,right,y,{...options,anchor:'end',rtl:true}):write(value,left,y,options);

  const planned=input.status==='planned',tapered=geometry.bottomThicknessM!==geometry.topThicknessM;
  const fill=planned?'none':ENVELOPE_FILL,stroke=planned?MUTED:INK,dash=planned?'4 3':undefined;

  const bandTop=64,bandHeight=132;
  const elevationWidth=330,sectionLeft=ELEVATION_LEFT+elevationWidth+30,sectionWidth=200;
  const elevationBoxWidth=elevationWidth-70,elevationBoxHeight=bandHeight-46;
  const elevationX=ELEVATION_LEFT,elevationY=bandTop+12;
  const maxThickness=Math.max(geometry.bottomThicknessM,geometry.topThicknessM);
  const scale=(sectionWidth-40)/(maxThickness||1);
  const centre=sectionLeft+sectionWidth/2;

  // Heading. The reference names the foundation; the envelope volume is the single headline number.
  label(clip(input.referenceLabel,60),PADDING,WIDTH/2+60,24,{size:13,weight:700});
  write(`Structural envelope ${cubic(input.netVolumeM3)}`,WIDTH-PADDING,24,{size:10,weight:700,anchor:'end',fill:RESULT});
  write('Foundation structural envelope',PADDING,40,{size:9,weight:700,fill:RESULT});
  write(`${foundationEnvelopeStatusLabels[input.status]} · Generated from the recorded dimensions. Not to scale.`,PADDING,52,{size:8,fill:MUTED});

  // Elevation: length along the bottom, height up the left side.
  write('Elevation',elevationX,bandTop,{size:10,weight:700});
  rect(elevationX,elevationY,elevationBoxWidth,elevationBoxHeight,fill,stroke,dash);
  line(elevationX,elevationY+elevationBoxHeight+10,elevationX+elevationBoxWidth,elevationY+elevationBoxHeight+10);
  write(`Length ${metres(geometry.lengthM)}`,elevationX+elevationBoxWidth/2,elevationY+elevationBoxHeight+22,{size:9,anchor:'middle'});
  line(elevationX-12,elevationY,elevationX-12,elevationY+elevationBoxHeight);
  write(`Height ${metres(geometry.heightM)}`,elevationX-16,elevationY+elevationBoxHeight/2,{size:9,anchor:'end'});

  // Cross-section: the bottom and top thickness, tapered when they differ.
  write('Cross-section',sectionLeft,bandTop,{size:10,weight:700});
  const sectionTop=elevationY,sectionBottom=elevationY+elevationBoxHeight;
  polygon([
    [centre-geometry.bottomThicknessM*scale/2,sectionBottom],
    [centre+geometry.bottomThicknessM*scale/2,sectionBottom],
    [centre+geometry.topThicknessM*scale/2,sectionTop],
    [centre-geometry.topThicknessM*scale/2,sectionTop],
  ],planned?PAPER:ENVELOPE_FILL,stroke);
  if(tapered)write('Tapered section',sectionLeft+sectionWidth,bandTop,{size:9,anchor:'end',fill:RESULT});
  write(`Top thickness ${metres(geometry.topThicknessM)}`,centre,sectionTop-6,{size:9,anchor:'middle'});
  line(centre-geometry.bottomThicknessM*scale/2,sectionBottom+10,centre+geometry.bottomThicknessM*scale/2,sectionBottom+10);
  write(`Bottom thickness ${metres(geometry.bottomThicknessM)}`,centre,sectionBottom+22,{size:9,anchor:'middle'});

  // The volumes. A deduction line is printed only when something was actually deducted, and the net
  // line only when it differs from the gross, so nothing prints a meaningless "0 m³ deducted".
  const hasDeduction=round(input.deductionM3)>0;
  const netDiffers=hasDeduction||round(input.netVolumeM3)!==round(input.grossVolumeM3);
  let cursor=bandTop+bandHeight+42;
  write('Structural volume',PADDING,cursor,{size:10,weight:700});
  cursor+=16;
  write(`Gross structural volume ${cubic(input.grossVolumeM3)}`,PADDING,cursor,{size:9});
  if(hasDeduction){cursor+=14;write(`Deductions ${cubic(input.deductionM3)}`,PADDING,cursor,{size:9,fill:MUTED});}
  if(netDiffers){cursor+=14;write(`Net structural volume ${cubic(input.netVolumeM3)}`,PADDING,cursor,{size:9,weight:700,fill:RESULT});}

  const height=Math.max(HEIGHT,cursor+PADDING);
  const diagram={width:WIDTH,height,elements,patterns:[] as DiagramPatternDef[]};
  return{...diagram,svg:wallDiagramToSvg({...diagram,legend:[],exaggerated:false})};
}
