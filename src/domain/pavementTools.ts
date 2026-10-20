import {
  appliedEmulsionLitres,averageThickness,circleArea,coatLitres,compactedVolume,coverageArea,crossfallDifferenceMm,gradeElevationDifferenceM,looseThickness,looseVolume,massFromVolume,progressPercent,quantityVarianceTonnes,slopedSurfaceWidth,triangleArea,truckLoads,variableWidthArea,
} from './pavement';

/**
 * The seven optional tools of the Asphalt Calculator (DEC-339), as pure calculations over the text the owner typed. They use the same formulas as
 * before; only the screens around them changed (DEC-519). Nothing here recommends a thickness, a rate or a factor: every one is typed.
 */
export type ToolId='geometry'|'layers'|'reverse'|'coats'|'milling'|'survey'|'actual';
export type LayerKind='granular'|'asphalt';
export type ToolLayer={name:string;kind:LayerKind;thickness:string;density:string;spread:string;looseFactor:string};
export type GeometryState={length:string;widthStart:string;widthEnd:string;deduction:string;triangleBase:string;triangleHeight:string;circleRadius:string};
export type ReverseState={tonnes:string;density:string;thickness:string;payload:string};
export type CoatsState={primeRate:string;tackRate:string;residue:string};
export type MillingState={depth:string;density:string};
export type SurveyState={width:string;crossfall:string;length:string;grade:string};
export type ActualState={tonnes:string;payload:string};
export type PavementToolsState={geometry:GeometryState;layers:ToolLayer[];reverse:ReverseState;coats:CoatsState;milling:MillingState;survey:SurveyState;actual:ActualState};

/** A number typed in a tool; anything that is not a number reads as 0, as it always has in these tools. */
export const toolNumber=(value:string)=>{const parsed=Number(value.replace(',','.'));return Number.isFinite(parsed)?parsed:0;};
const n=toolNumber;

export const initialToolLayers=():ToolLayer[]=>[
  {name:'Subbase',kind:'granular',thickness:'',density:'2.10',spread:'',looseFactor:'1.20'},
  {name:'Base course',kind:'granular',thickness:'',density:'2.20',spread:'',looseFactor:'1.18'},
  {name:'Asphalt base',kind:'asphalt',thickness:'',density:'2.40',spread:'',looseFactor:''},
  {name:'Binder course',kind:'asphalt',thickness:'',density:'2.40',spread:'',looseFactor:''},
  {name:'Wearing course',kind:'asphalt',thickness:'',density:'2.40',spread:'',looseFactor:''},
];
export const initialToolsState=():PavementToolsState=>({
  geometry:{length:'',widthStart:'',widthEnd:'',deduction:'0',triangleBase:'0',triangleHeight:'0',circleRadius:'0'},
  layers:initialToolLayers(),
  reverse:{tonnes:'',density:'2.40',thickness:'',payload:'20'},
  coats:{primeRate:'',tackRate:'',residue:'60'},
  milling:{depth:'',density:'2.30'},
  survey:{width:'',crossfall:'',length:'',grade:''},
  actual:{tonnes:'',payload:'20'},
});

export const geometryNetArea=(geometry:GeometryState)=>Math.max(0,variableWidthArea(n(geometry.length),n(geometry.widthStart),n(geometry.widthEnd))+triangleArea(n(geometry.triangleBase),n(geometry.triangleHeight))+circleArea(n(geometry.circleRadius))-n(geometry.deduction));

export type LayerResult={compactedVolumeM3:number;tonnes:number;looseVolumeM3:number;looseThicknessMm:number};
export function layerResult(areaM2:number,layer:ToolLayer):LayerResult{
  const volume=compactedVolume(areaM2,n(layer.thickness));
  const tonnes=layer.kind==='asphalt'&&n(layer.spread)>0?(areaM2*n(layer.spread))/1000:massFromVolume(volume,n(layer.density));
  const loose=layer.kind==='granular'?looseVolume(volume,n(layer.looseFactor)):0;
  const looseMm=layer.kind==='asphalt'&&n(layer.looseFactor)>1?looseThickness(n(layer.thickness),n(layer.looseFactor)):0;
  return{compactedVolumeM3:volume,tonnes,looseVolumeM3:loose,looseThicknessMm:looseMm};
}

export type ReverseResult={equivalentKgM2:number;coverageM2:number;averageThicknessMm:number;trucks:number|null};
export function reverseResult(areaM2:number,reverse:ReverseState):ReverseResult{
  return{
    equivalentKgM2:n(reverse.thickness)*n(reverse.density),
    coverageM2:n(reverse.tonnes)>0&&n(reverse.thickness)>0&&n(reverse.density)>0?coverageArea(n(reverse.tonnes),n(reverse.thickness)*n(reverse.density)):0,
    averageThicknessMm:n(reverse.tonnes)>0&&areaM2>0&&n(reverse.density)>0?averageThickness(n(reverse.tonnes),areaM2,n(reverse.density)):0,
    trucks:n(reverse.payload)>0?truckLoads(n(reverse.tonnes),n(reverse.payload)):null,
  };
}

export type CoatsResult={primeLitres:number;tackResidualLitres:number;tackAppliedLitres:number|null};
export function coatsResult(areaM2:number,coats:CoatsState):CoatsResult{
  const residue=n(coats.residue)/100,tack=coatLitres(areaM2,n(coats.tackRate));
  return{primeLitres:coatLitres(areaM2,n(coats.primeRate)),tackResidualLitres:tack,tackAppliedLitres:residue>0&&residue<=1?appliedEmulsionLitres(tack,residue):null};
}

export type MillingResult={areaM2:number;volumeM3:number;tonnes:number};
export function millingResult(areaM2:number,milling:MillingState):MillingResult{const volume=compactedVolume(areaM2,n(milling.depth));return{areaM2,volumeM3:volume,tonnes:massFromVolume(volume,n(milling.density))};}

export type SurveyResult={crossfallDifferenceMm:number;riseFallM:number;slopedWidthM:number};
export const surveyResult=(survey:SurveyState):SurveyResult=>({crossfallDifferenceMm:crossfallDifferenceMm(n(survey.width),n(survey.crossfall)),riseFallM:gradeElevationDifferenceM(n(survey.length),n(survey.grade)),slopedWidthM:slopedSurfaceWidth(n(survey.width),n(survey.crossfall))});

export type ActualResult={plannedTonnes:number;progressPercent:number|null;varianceTonnes:number|null;trucks:number|null};
export function actualResult(plannedTonnes:number,actual:ActualState):ActualResult{
  const actualTonnes=n(actual.tonnes);
  return{plannedTonnes,progressPercent:plannedTonnes>0?progressPercent(actualTonnes,plannedTonnes):null,varianceTonnes:plannedTonnes>0?quantityVarianceTonnes(actualTonnes,plannedTonnes):null,trucks:n(actual.payload)>0?truckLoads(actualTonnes,n(actual.payload)):null};
}
