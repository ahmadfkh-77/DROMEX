import {useState,type ReactNode} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {
  actualResult,coatsResult,geometryNetArea,initialToolsState,layerResult,millingResult,reverseResult,surveyResult,toolNumber,
  type PavementToolsState,type ToolId,type ToolLayer,
} from '../../domain/pavementTools';
import {AppButton,AppField} from './AppPrimitives';
import {PavementPageFrame,type PavementBandTone} from './PavementPageFrame';
import {colors} from '../theme';

/**
 * The seven optional tools of the Asphalt Calculator as pages (DEC-519, DEC-339). A list of plain rows opens one tool at a time; each tool has its
 * own band, its inputs, and a ruled list of results. The formulas are in `pavementTools.ts` and did not change. The typed values live in the
 * calculator screen, so they survive going to another page and coming back.
 */
export function usePavementTools(){const[state,setState]=useState<PavementToolsState>(initialToolsState);return{state,setState};}
export type PavementToolsHandle=ReturnType<typeof usePavementTools>;

const f=(value:number|null,digits=2)=>value!==null&&Number.isFinite(value)?value.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';

type ToolInfo={id:ToolId;mark:string;title:string;hint:string;tone:PavementBandTone};
export const pavementToolList:ToolInfo[]=[
  {id:'geometry',mark:'G',title:'Geometry and Variable Width',hint:'Triangles, circles and area deductions',tone:'navy'},
  {id:'layers',mark:'L',title:'Complete Layer Stack',hint:'Subbase, base, binder and wearing quantities',tone:'orange'},
  {id:'reverse',mark:'R',title:'Reverse Coverage and Truck Loads',hint:'Coverage, average thickness, whole trucks',tone:'teal'},
  {id:'coats',mark:'C',title:'Prime and Tack Coats',hint:'Litres from L/m², applied and residual',tone:'navy'},
  {id:'milling',mark:'M',title:'Milling',hint:'Removal volume and reclaimed tonnes',tone:'orange'},
  {id:'survey',mark:'S',title:'Crossfall, Slope, and Levels',hint:'Edge difference, rise or fall, sloped width',tone:'teal'},
  {id:'actual',mark:'A',title:'Actual Delivery and Variance',hint:'Received asphalt against the planned amount',tone:'navy'},
];

export function PavementTools({tools,areaM2,plannedTonnes,onUseArea,onBack,error,message}:{tools:PavementToolsHandle;areaM2:number;plannedTonnes:number;onUseArea:(area:number)=>void;onBack:()=>void;error?:string|null;message?:string|null}){
  const[tool,setTool]=useState<ToolId|null>(null);const[openLayer,setOpenLayer]=useState<number|null>(4);
  const{state,setState}=tools;
  const set=<K extends keyof PavementToolsState>(key:K,changes:Partial<PavementToolsState[K]>)=>setState(current=>({...current,[key]:{...(current[key] as object),...(changes as object)}} as PavementToolsState));
  const updateLayer=(index:number,key:keyof ToolLayer,value:string)=>setState(current=>({...current,layers:current.layers.map((layer,i)=>i===index?{...layer,[key]:value}:layer)}));
  const planned=plannedTonnes>0?`${f(plannedTonnes,3)} t`:'—';
  const geometryArea=geometryNetArea(state.geometry);
  const reverse=reverseResult(areaM2,state.reverse),coats=coatsResult(areaM2,state.coats),milling=millingResult(areaM2,state.milling),survey=surveyResult(state.survey),actual=actualResult(plannedTonnes,state.actual);
  const summary=(id:ToolId):string|null=>{
    if(id==='geometry')return geometryArea>0?`${f(geometryArea)} m²`:null;
    if(id==='reverse')return toolNumber(state.reverse.tonnes)>0&&reverse.trucks!==null?`${reverse.trucks} truck${reverse.trucks===1?'':'s'}`:null;
    if(id==='coats')return coats.primeLitres>0||coats.tackResidualLitres>0?`${f(coats.primeLitres>0?coats.primeLitres:coats.tackResidualLitres,1)} L`:null;
    if(id==='milling')return toolNumber(state.milling.depth)>0?`${f(milling.tonnes,3)} t`:null;
    if(id==='survey')return survey.crossfallDifferenceMm>0?`${f(survey.crossfallDifferenceMm,1)} mm`:null;
    if(id==='actual')return toolNumber(state.actual.tonnes)>0&&actual.progressPercent!==null?`${f(actual.progressPercent,1)}%`:null;
    return null;
  };

  if(!tool)return <PavementPageFrame band={{mark:'+',title:'More tools',hint:`Each tool uses the area: ${areaM2>0?`${f(areaM2)} m²`:'not set yet'}.`,tone:'navy'}} onBack={onBack} error={error} message={message}
    bar={{label:'PLANNED',value:planned,secondary:{label:'Back to result',onPress:onBack}}}>
    <View>{pavementToolList.map(info=>{const value=summary(info.id);return <TouchableOpacity key={info.id} style={styles.listRow} onPress={()=>setTool(info.id)} accessibilityRole="button" accessibilityLabel={`${info.title}. ${info.hint}`}>
      <View style={styles.copy}><Text style={styles.listTitle}>{info.title}</Text><Text style={styles.hint}>{info.hint}</Text></View>{value?<Text style={styles.listValue}>{value}</Text>:null}<Text style={styles.chevron}>›</Text>
    </TouchableOpacity>;})}</View>
  </PavementPageFrame>;

  const info=pavementToolList.find(value=>value.id===tool)!;
  const frame=(barLabel:string,barValue:string,children:ReactNode)=><PavementPageFrame band={{mark:info.mark,title:info.title,hint:info.hint,tone:info.tone}} onBack={()=>setTool(null)} error={error} message={message}
    bar={{label:barLabel,value:barValue,secondary:{label:'Back to tools',onPress:()=>setTool(null)}}}>{children}</PavementPageFrame>;
  const two=(a:ReactNode,b:ReactNode)=><View style={styles.two}><View style={styles.half}>{a}</View><View style={styles.half}>{b}</View></View>;
  const field=(label:string,value:string,onChange:(value:string)=>void,placeholder?:string)=><AppField variant="open" label={label} value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholder={placeholder}/>;

  if(tool==='geometry'){const g=state.geometry;return frame('NET CALCULATED AREA',`${f(geometryArea)} m²`,<>
    <Text style={styles.note}>Several widths along the road? Use Road sections in 1 · Area. This tool adds shapes and takes away areas. Variable section area = length × average of start and end widths.</Text>
    <Group label="SECTION">{two(field('Section length (m)',g.length,value=>set('geometry',{length:value})),field('Start width (m)',g.widthStart,value=>set('geometry',{widthStart:value})))}{two(field('End width (m)',g.widthEnd,value=>set('geometry',{widthEnd:value})),field('Deductions (m²)',g.deduction,value=>set('geometry',{deduction:value})))}</Group>
    <Group label="EXTRA SHAPES">{two(field('Triangle base (m)',g.triangleBase,value=>set('geometry',{triangleBase:value})),field('Triangle height (m)',g.triangleHeight,value=>set('geometry',{triangleHeight:value})))}{field('Circle radius (m)',g.circleRadius,value=>set('geometry',{circleRadius:value}))}</Group>
    <Group label="RESULT"><Row label="Net calculated area" value={`${f(geometryArea)} m²`} big/></Group>
    <AppButton label="Use This Net Area" disabled={geometryArea<=0} onPress={()=>onUseArea(geometryArea)}/>
  </>);}

  if(tool==='layers'){
    const current=openLayer===null?null:state.layers[openLayer]??null;const currentResult=current?layerResult(areaM2,current):null;
    return frame(current?.kind==='granular'?'MASS CROSS-CHECK':'REQUIRED ASPHALT',currentResult?`${f(currentResult.tonnes,3)} t`:'—',<>
      <Text style={styles.note}>Asphalt mass uses kg/m². Loose thickness requires the project/paver factor. Granular material shows compacted and estimated loose volume.</Text>
      <View>{state.layers.map((layer,index)=>{const result=layerResult(areaM2,layer),filled=toolNumber(layer.thickness)>0,open=openLayer===index;return <TouchableOpacity key={layer.name} style={[styles.listRow,open&&styles.listRowOpen]} onPress={()=>setOpenLayer(open?null:index)} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${layer.name}, ${layer.kind}. ${open?'Close':'Open'}`}>
        <View style={styles.copy}><Text style={styles.listTitle}>{layer.name}</Text><Text style={styles.hint}>{filled?`${f(result.compactedVolumeM3)} m³ compacted`:layer.kind==='asphalt'?'Asphalt · enter thickness':'Granular · enter thickness'}</Text></View>{filled?<Text style={styles.listValue}>{f(result.tonnes,3)} t</Text>:null}<Text style={styles.chevron}>{open?'×':'+'}</Text>
      </TouchableOpacity>;})}</View>
      {current&&currentResult&&openLayer!==null?<Group label={current.name.toUpperCase()}>
        {two(field('Compacted thickness (mm)',current.thickness,value=>updateLayer(openLayer,'thickness',value)),field('Density (t/m³)',current.density,value=>updateLayer(openLayer,'density',value)))}
        {current.kind==='asphalt'?two(field('Spread rate (kg/m²)',current.spread,value=>updateLayer(openLayer,'spread',value)),field('Loose-thickness factor',current.looseFactor,value=>updateLayer(openLayer,'looseFactor',value),'Project value')):field('Loose-volume factor',current.looseFactor,value=>updateLayer(openLayer,'looseFactor',value))}
        <Row label="Compacted volume" value={`${f(currentResult.compactedVolumeM3)} m³`}/>
        <Row label={current.kind==='asphalt'?'Required asphalt':'Mass cross-check'} value={`${f(currentResult.tonnes,3)} t`} big/>
        {current.kind==='granular'?<Row label="Estimated loose volume" value={`${f(currentResult.looseVolumeM3)} m³`}/>:<Row label="Before compaction · loose" value={currentResult.looseThicknessMm>0?`${f(currentResult.looseThicknessMm,1)} mm`:'Enter factor'}/>}
      </Group>:null}
    </>);
  }

  if(tool==='reverse'){const r=state.reverse;return frame('WHOLE TRUCKS',reverse.trucks===null?'—':String(reverse.trucks),<>
    <Group label="INPUTS">{two(field('Available / delivered tonnes',r.tonnes,value=>set('reverse',{tonnes:value})),field('Density (t/m³)',r.density,value=>set('reverse',{density:value})))}{two(field('Target thickness (mm)',r.thickness,value=>set('reverse',{thickness:value})),field('Truck payload (t)',r.payload,value=>set('reverse',{payload:value})))}</Group>
    <Group label="RESULTS"><Row label="Equivalent kg/m²" value={`${f(reverse.equivalentKgM2,1)} kg/m²`}/><Row label="Coverage at target" value={`${f(reverse.coverageM2)} m²`}/><Row label="Average thickness on current area" value={`${f(reverse.averageThicknessMm,1)} mm`}/><Row label="Whole trucks" value={reverse.trucks===null?'—':String(reverse.trucks)} big/></Group>
  </>);}

  if(tool==='coats'){const c=state.coats;return frame('PRIME APPLIED',`${f(coats.primeLitres)} L`,<>
    <Group label="INPUTS">{two(field('Prime coat applied rate (L/m²)',c.primeRate,value=>set('coats',{primeRate:value})),field('Tack residual rate (L/m²)',c.tackRate,value=>set('coats',{tackRate:value})))}{field('Emulsion residue (%)',c.residue,value=>set('coats',{residue:value}))}</Group>
    <Group label="RESULTS"><Row label="Prime applied emulsion" value={`${f(coats.primeLitres)} L`}/><Row label="Tack residual" value={`${f(coats.tackResidualLitres)} L`}/><Row label="Applied tack emulsion" value={coats.tackAppliedLitres===null?'—':`${f(coats.tackAppliedLitres)} L`} big/></Group>
    <Text style={styles.note}>Use only the rates specified for this project. DROMEX does not select engineering application rates.</Text>
  </>);}

  if(tool==='milling'){const m=state.milling;return frame('RECLAIMED MASS',`${f(milling.tonnes,3)} t`,<>
    <Group label="INPUTS">{two(field('Milling depth (mm)',m.depth,value=>set('milling',{depth:value})),field('Removed-material density (t/m³)',m.density,value=>set('milling',{density:value})))}</Group>
    <Group label="RESULTS"><Row label="Milling area" value={`${f(milling.areaM2)} m²`}/><Row label="Removal volume" value={`${f(milling.volumeM3)} m³`}/><Row label="Estimated reclaimed mass" value={`${f(milling.tonnes,3)} t`} big/></Group>
  </>);}

  if(tool==='survey'){const s=state.survey;return frame('SLOPED WIDTH',`${f(survey.slopedWidthM,3)} m`,<>
    <Group label="CROSSFALL">{two(field('Horizontal width (m)',s.width,value=>set('survey',{width:value})),field('Crossfall (%)',s.crossfall,value=>set('survey',{crossfall:value})))}</Group>
    <Group label="LONGITUDINAL">{two(field('Road length (m)',s.length,value=>set('survey',{length:value})),field('Longitudinal grade (%)',s.grade,value=>set('survey',{grade:value})))}</Group>
    <Group label="RESULTS"><Row label="Crossfall edge difference" value={`${f(survey.crossfallDifferenceMm,1)} mm`}/><Row label="Longitudinal rise / fall" value={`${f(survey.riseFallM,3)} m`}/><Row label="Actual sloped width" value={`${f(survey.slopedWidthM,3)} m`} big/></Group>
  </>);}

  const a=state.actual;return frame('PROGRESS',actual.progressPercent===null?'—':`${f(actual.progressPercent,1)}%`,<>
    <Group label="INPUTS">{two(field('Actual delivered (t)',a.tonnes,value=>set('actual',{tonnes:value})),field('Truck payload (t)',a.payload,value=>set('actual',{payload:value})))}</Group>
    <Group label="RESULTS"><Row label="Planned" value={`${f(actual.plannedTonnes,3)} t`}/><Row label="Progress" value={actual.progressPercent===null?'—':`${f(actual.progressPercent,1)}%`}/><Row label="Variance" value={actual.varianceTonnes===null?'—':`${actual.varianceTonnes>=0?'+':''}${f(actual.varianceTonnes,3)} t`}/><Row label="Actual trucks" value={actual.trucks===null?'—':String(actual.trucks)} big/></Group>
  </>);
}

function Group({label,children}:{label:string;children:ReactNode}){return <View style={styles.group}><Text style={styles.groupLabel}>{label}</Text>{children}</View>;}
function Row({label,value,big=false}:{label:string;value:string;big?:boolean}){return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={[styles.rowValue,big&&styles.rowBig]}>{value}</Text></View>;}

const styles=StyleSheet.create({
  group:{borderTopWidth:1,borderTopColor:colors.line,paddingTop:12,gap:8},
  groupLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1.2},
  note:{color:colors.navy,backgroundColor:'#E9EEF4',borderRadius:12,padding:12,fontSize:13,lineHeight:19},
  two:{flexDirection:'row',gap:12},half:{flex:1,minWidth:0},
  listRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:14,minHeight:60,borderBottomWidth:1,borderBottomColor:'#E0DACD'},
  listRowOpen:{backgroundColor:'#EEF2F7',borderRadius:10,paddingHorizontal:10,borderBottomWidth:0},
  copy:{flex:1,minWidth:0,gap:2},listTitle:{color:colors.navy,fontSize:15,fontWeight:'800'},hint:{color:colors.muted,fontSize:12,lineHeight:17},
  listValue:{color:colors.resultDark,fontSize:13,fontWeight:'900',textAlign:'right'},chevron:{color:colors.brand,fontSize:24,fontWeight:'700',minWidth:22,textAlign:'center'},
  row:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',gap:10,paddingVertical:11,paddingHorizontal:2,borderBottomWidth:1,borderBottomColor:'#E6E0D4'},
  rowLabel:{color:colors.muted,fontSize:12,flex:1},rowValue:{color:colors.resultDark,fontSize:17,fontWeight:'900'},rowBig:{fontSize:24},
});
