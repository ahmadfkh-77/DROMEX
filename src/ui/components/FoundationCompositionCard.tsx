import {useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {Foundation} from '../../domain/foundations';
import {formatCubicMetres} from '../../domain/walls';
import type {FoundationComposition,FoundationCompositionMaterial,FoundationCompositionMode,FoundationCompositionRecord,StoneCoreMode,StoneCoreOffsets,StoneCorePosition} from '../../domain/wallFoundation';
import {colors,radius} from '../theme';
import {AppButton,AppCard,AppField} from './AppPrimitives';
import {DatePickerField} from './DatePickerField';
import {FoundationDiagramView} from './FoundationDiagramView';

const today=()=>new Date().toISOString().slice(0,10);
const n=(value:string)=>{const parsed=Number(value.trim().replace(',','.'));return Number.isFinite(parsed)?parsed:Number.NaN;};

/**
 * DEC-461. The composite foundation model's own workspace: a Stone core inside the base's outer
 * volume, with concrete filling the rest estimated rather than assumed poured. This card is additive
 * on top of the base's existing single recorded material -- it never replaces that field.
 */
export function FoundationCompositionCard({base,composition,busy,onSetMode,onSavePosition,onSaveOffsets,onAddRecord,onCancelRecord,onCorrectRecord}:{
  base:Foundation;composition:FoundationComposition|null;busy:boolean;
  onSetMode:(mode:FoundationCompositionMode,stoneCoreMode?:StoneCoreMode)=>Promise<void>;
  onSavePosition:(position:StoneCorePosition)=>Promise<void>;
  onSaveOffsets:(offsets:StoneCoreOffsets)=>Promise<void>;
  onAddRecord:(materialType:FoundationCompositionMaterial,quantityM3:number,recordedOn:string,notes:string)=>Promise<void>;
  onCancelRecord:(recordId:string,reason:string)=>Promise<void>;
  onCorrectRecord:(recordId:string,quantityM3:number,recordedOn:string,notes:string,reason:string)=>Promise<void>;
}){
  const[error,setError]=useState<string|null>(null);
  const[recordMaterial,setRecordMaterial]=useState<FoundationCompositionMaterial>('stone');
  const[recordQuantity,setRecordQuantity]=useState('');
  const[recordDate,setRecordDate]=useState(today());
  const[recordNotes,setRecordNotes]=useState('');
  const[offsetsForm,setOffsetsForm]=useState({length:'',depth:'',bottom:'',top:'',longitudinal:'',vertical:'',transverse:'0'});
  const[cancelling,setCancelling]=useState<string|null>(null);
  const[cancelReason,setCancelReason]=useState('');

  async function run(action:()=>Promise<void>){setError(null);try{await action();}catch(cause){setError(cause instanceof Error?cause.message:'That change could not be saved.');}}

  if(!composition)return null;
  const mode=composition.mode,stoneCoreMode=composition.stoneCoreMode;

  return <AppCard title="Foundation composition" hint="Optional. Tracks a Stone core inside this base's outer volume separately from the single material recorded above.">
    <View style={styles.summary}>
      <Text style={styles.summaryLine}>Net foundation capacity: <Text style={styles.strong}>{formatCubicMetres(composition.netFoundationVolumeM3)}</Text></Text>
      <Text style={styles.summaryLine}>{base.lengthM} m × {base.heightM} m × {base.bottomThicknessM===base.topThicknessM?`${base.bottomThicknessM} m`:`${base.bottomThicknessM} to ${base.topThicknessM} m`}</Text>
    </View>

    <View style={styles.toggleRow} accessibilityRole="radiogroup" accessibilityLabel="Foundation composition mode">
      {([{id:'single',label:'Single material'},{id:'composite',label:'Composite (Stone core + concrete)'}] as const).map(option=>{
        const on=mode===option.id;
        return <TouchableOpacity key={option.id} style={[styles.toggle,on&&styles.toggleOn]} disabled={busy} accessibilityRole="radio" accessibilityState={{checked:on}}
          onPress={()=>void run(()=>onSetMode(option.id,option.id==='composite'?stoneCoreMode??'simple':undefined))}>
          <Text style={[styles.toggleText,on&&styles.toggleTextOn]}>{option.label}</Text>
        </TouchableOpacity>;
      })}
    </View>

    {mode==='composite'?<>
      <View style={styles.toggleRow} accessibilityRole="radiogroup" accessibilityLabel="Stone-core mode">
        {([{id:'simple',label:'Simple (schematic)'},{id:'detailed',label:'Detailed (measured)'}] as const).map(option=>{
          const on=stoneCoreMode===option.id;
          return <TouchableOpacity key={option.id} style={[styles.toggle,on&&styles.toggleOn]} disabled={busy} accessibilityRole="radio" accessibilityState={{checked:on}}
            onPress={()=>void run(()=>onSetMode('composite',option.id))}>
            <Text style={[styles.toggleText,on&&styles.toggleTextOn]}>{option.label}</Text>
          </TouchableOpacity>;
        })}
      </View>

      <View style={styles.results}>
        <Result label="Stone recorded" value={composition.activeStoneM3>0?formatCubicMetres(composition.activeStoneM3):'None recorded'}/>
        <Result label="Estimated concrete remaining" value={formatCubicMetres(composition.estimatedConcreteM3)} strong/>
      </View>
      {composition.activeReadyMixM3>0?<View style={styles.results}>
        <Result label="Actual Ready Mix recorded" value={formatCubicMetres(composition.activeReadyMixM3)}/>
        <Result label={`Variance (actual vs. estimate)${composition.variance?.direction==='none'?' — matches':composition.variance?.direction==='over'?' — over':' — under'}`} value={composition.variance?formatCubicMetres(Math.abs(composition.variance.varianceM3)):'—'}/>
      </View>:null}

      <FoundationDiagramView caption={stoneCoreMode==='detailed'?'Detailed geometry, measured from the recorded offsets.':'Schematic placement — not to scale. Drag the Stone core, or use the nudge buttons below.'}
        draggable={stoneCoreMode==='simple'} onDragPosition={position=>void run(()=>onSavePosition(position))}
        input={{
        referenceLabel:base.reference,lengthM:base.lengthM,heightM:base.heightM,bottomThicknessM:base.bottomThicknessM,topThicknessM:base.topThicknessM,
        status:base.status,netFoundationVolumeM3:composition.netFoundationVolumeM3,mode,stoneCoreMode,position:composition.position,offsets:composition.offsets,
        activeStoneM3:composition.activeStoneM3,activeReadyMixM3:composition.activeReadyMixM3,estimatedConcreteM3:composition.estimatedConcreteM3,variance:composition.variance,
      }}/>

      {stoneCoreMode==='simple'?<View style={styles.placement}>
        <Text style={styles.label}>Stone-core position</Text>
        <View style={styles.nudgeRow}>
          <NudgeButton label="◀" onPress={()=>void run(()=>onSavePosition(nudge(composition.position,'x',-.08)))}/>
          <View style={styles.nudgeColumn}>
            <NudgeButton label="▲" onPress={()=>void run(()=>onSavePosition(nudge(composition.position,'y',-.08)))}/>
            <NudgeButton label="▼" onPress={()=>void run(()=>onSavePosition(nudge(composition.position,'y',.08)))}/>
          </View>
          <NudgeButton label="▶" onPress={()=>void run(()=>onSavePosition(nudge(composition.position,'x',.08)))}/>
          <AppButton label="Reset to Centre" tone="secondary" onPress={()=>void run(()=>onSavePosition({xNorm:.5,yNorm:.5}))}/>
        </View>
      </View>:<View style={styles.placement}>
        <Text style={styles.label}>Stone-core geometry (m)</Text>
        <View style={styles.pair}>
          <View style={styles.flex}><AppField label="Length *" value={offsetsForm.length} onChangeText={length=>setOffsetsForm({...offsetsForm,length})} keyboardType="decimal-pad"/></View>
          <View style={styles.flex}><AppField label="Height / depth *" value={offsetsForm.depth} onChangeText={depth=>setOffsetsForm({...offsetsForm,depth})} keyboardType="decimal-pad"/></View>
        </View>
        <View style={styles.pair}>
          <View style={styles.flex}><AppField label="Bottom thickness/width *" value={offsetsForm.bottom} onChangeText={bottom=>setOffsetsForm({...offsetsForm,bottom})} keyboardType="decimal-pad"/></View>
          <View style={styles.flex}><AppField label="Top thickness/width *" value={offsetsForm.top} onChangeText={top=>setOffsetsForm({...offsetsForm,top})} keyboardType="decimal-pad"/></View>
        </View>
        <View style={styles.pair}>
          <View style={styles.flex}><AppField label="Longitudinal offset" value={offsetsForm.longitudinal} onChangeText={longitudinal=>setOffsetsForm({...offsetsForm,longitudinal})} keyboardType="decimal-pad" placeholder="0"/></View>
          <View style={styles.flex}><AppField label="Vertical offset" value={offsetsForm.vertical} onChangeText={vertical=>setOffsetsForm({...offsetsForm,vertical})} keyboardType="decimal-pad" placeholder="0"/></View>
        </View>
        <AppField label="Transverse offset (reference only, not to scale)" value={offsetsForm.transverse} onChangeText={transverse=>setOffsetsForm({...offsetsForm,transverse})} keyboardType="decimal-pad"/>
        <AppButton label="Save Stone-Core Geometry" tone="secondary" busy={busy} onPress={()=>void run(()=>onSaveOffsets({
          lengthM:n(offsetsForm.length),depthM:n(offsetsForm.depth),bottomThicknessM:n(offsetsForm.bottom),topThicknessM:n(offsetsForm.top),
          longitudinalOffsetM:offsetsForm.longitudinal.trim()?n(offsetsForm.longitudinal):0,verticalOffsetM:offsetsForm.vertical.trim()?n(offsetsForm.vertical):0,transverseOffsetM:offsetsForm.transverse.trim()?n(offsetsForm.transverse):0,
        }))}/>
      </View>}

      <View style={styles.recordForm}>
        <Text style={styles.label}>Record Stone or Ready Mix</Text>
        <View style={styles.toggleRow}>
          {([{id:'stone',label:'Stone'},{id:'ready_mix',label:'Ready Mix'}] as const).map(option=>{
            const on=recordMaterial===option.id;
            return <TouchableOpacity key={option.id} style={[styles.toggle,on&&styles.toggleOn]} onPress={()=>setRecordMaterial(option.id)} accessibilityRole="radio" accessibilityState={{checked:on}}><Text style={[styles.toggleText,on&&styles.toggleTextOn]}>{option.label}</Text></TouchableOpacity>;
          })}
        </View>
        <View style={styles.pair}>
          <View style={styles.flex}><AppField label="Quantity (m³) *" value={recordQuantity} onChangeText={setRecordQuantity} keyboardType="decimal-pad"/></View>
          <View style={styles.flex}><DatePickerField label="Recorded on" value={recordDate} onChange={setRecordDate}/></View>
        </View>
        <AppField label="Notes" value={recordNotes} onChangeText={setRecordNotes} placeholder="Optional"/>
        <AppButton label={`Record ${recordMaterial==='stone'?'Stone':'Ready Mix'}`} busy={busy} disabled={!(n(recordQuantity)>0)} onPress={()=>void run(async()=>{
          await onAddRecord(recordMaterial,n(recordQuantity),recordDate,recordNotes);setRecordQuantity('');setRecordNotes('');
        })}/>
      </View>

      {composition.records.length?<View style={styles.recordsList}>
        <Text style={styles.label}>Recorded quantities</Text>
        {composition.records.map(record=><CompositionRecordRow key={record.id} record={record} busy={busy}
          cancelling={cancelling===record.id} cancelReason={cancelReason}
          onStartCancel={()=>{setCancelling(record.id);setCancelReason('');}}
          onCancelReasonChange={setCancelReason}
          onConfirmCancel={()=>void run(async()=>{await onCancelRecord(record.id,cancelReason);setCancelling(null);setCancelReason('');})}
          onDiscardCancel={()=>{setCancelling(null);setCancelReason('');}}
          onCorrect={(quantityM3,recordedOn,notes,reason)=>run(()=>onCorrectRecord(record.id,quantityM3,recordedOn,notes,reason))}/>)}
      </View>:null}

      <Text style={styles.hint}>Estimated concrete is never recorded as poured. Record the actual Ready Mix once it is delivered to compare it against this estimate.</Text>
    </>:null}

    {error?<Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>:null}
  </AppCard>;
}

function nudge(position:StoneCorePosition|null,axis:'x'|'y',delta:number):StoneCorePosition{
  const base=position??{xNorm:.5,yNorm:.5};
  const next=axis==='x'?{...base,xNorm:base.xNorm+delta}:{...base,yNorm:base.yNorm+delta};
  const margin=.12;
  return{xNorm:Math.min(1-margin,Math.max(margin,next.xNorm)),yNorm:Math.min(1-margin,Math.max(margin,next.yNorm))};
}

function NudgeButton({label,onPress}:{label:string;onPress:()=>void}){
  return <TouchableOpacity style={styles.nudgeButton} onPress={onPress} accessibilityRole="button" accessibilityLabel={`Move Stone core ${label==='◀'?'left':label==='▶'?'right':label==='▲'?'up':'down'}`}><Text style={styles.nudgeText}>{label}</Text></TouchableOpacity>;
}

function Result({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <View style={[styles.result,strong&&styles.resultStrong]}><Text style={[styles.resultLabel,strong&&styles.resultLabelStrong]}>{label}</Text><Text style={[styles.resultValue,strong&&styles.resultValueStrong]}>{value}</Text></View>;
}

function CompositionRecordRow({record,busy,cancelling,cancelReason,onStartCancel,onCancelReasonChange,onConfirmCancel,onDiscardCancel,onCorrect}:{
  record:FoundationCompositionRecord;busy:boolean;cancelling:boolean;cancelReason:string;
  onStartCancel:()=>void;onCancelReasonChange:(value:string)=>void;onConfirmCancel:()=>void;onDiscardCancel:()=>void;
  onCorrect:(quantityM3:number,recordedOn:string,notes:string,reason:string)=>void;
}){
  const[editing,setEditing]=useState(false);
  const[quantity,setQuantity]=useState(String(record.quantityM3));
  const[date,setDate]=useState(record.recordedOn);
  const[notes,setNotes]=useState(record.notes);
  const[reason,setReason]=useState('');
  const cancelled=!!record.cancelledAt;

  return <View style={[styles.recordRow,cancelled&&styles.recordCancelled]}>
    <Text style={styles.recordTitle}>{record.materialType==='stone'?'Stone':'Ready Mix'} · {record.quantityM3} m³{cancelled?' · CANCELLED':''}</Text>
    <Text style={styles.recordDetail}>Recorded {record.recordedOn}{record.notes?` · ${record.notes}`:''}</Text>
    {cancelled?<Text style={styles.recordDetail}>Cancelled: {record.cancelledReason}</Text>:null}
    {!cancelled&&!editing&&!cancelling?<View style={styles.recordActions}>
      <AppButton label="Correct" tone="secondary" onPress={()=>setEditing(true)}/>
      <AppButton label="Cancel" tone="danger" onPress={onStartCancel}/>
    </View>:null}
    {editing?<View style={styles.correctForm}>
      <View style={styles.pair}>
        <View style={styles.flex}><AppField label="Quantity (m³) *" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad"/></View>
        <View style={styles.flex}><DatePickerField label="Recorded on" value={date} onChange={setDate}/></View>
      </View>
      <AppField label="Notes" value={notes} onChangeText={setNotes}/>
      <AppField label="Correction reason *" value={reason} onChangeText={setReason} multiline/>
      <View style={styles.recordActions}>
        <AppButton label="Save Correction" busy={busy} disabled={!reason.trim()} onPress={()=>{onCorrect(n(quantity),date,notes,reason);setEditing(false);setReason('');}}/>
        <AppButton label="Discard" tone="secondary" onPress={()=>setEditing(false)}/>
      </View>
    </View>:null}
    {cancelling?<View style={styles.correctForm}>
      <AppField label="Cancellation reason *" value={cancelReason} onChangeText={onCancelReasonChange} multiline/>
      <View style={styles.recordActions}>
        <AppButton label="Confirm Cancel" tone="danger" busy={busy} disabled={!cancelReason.trim()} onPress={onConfirmCancel}/>
        <AppButton label="Discard" tone="secondary" onPress={onDiscardCancel}/>
      </View>
    </View>:null}
  </View>;
}

const styles=StyleSheet.create({
  summary:{gap:2,marginBottom:4},
  summaryLine:{color:colors.muted,fontSize:12,lineHeight:17},
  strong:{color:colors.ink,fontWeight:'900'},
  toggleRow:{flexDirection:'row',gap:6,flexWrap:'wrap',marginBottom:8},
  toggle:{minHeight:40,justifyContent:'center',alignItems:'center',borderRadius:10,borderWidth:1,borderColor:colors.line,paddingHorizontal:11,paddingVertical:8,backgroundColor:colors.surface},
  toggleOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  toggleText:{color:colors.muted,fontSize:12,fontWeight:'900'},
  toggleTextOn:{color:'#FFFFFF'},
  results:{flexDirection:'row',gap:6,marginBottom:8},
  result:{flex:1,borderRadius:10,paddingHorizontal:10,paddingVertical:8,backgroundColor:colors.surface},
  resultStrong:{backgroundColor:colors.result},
  resultLabel:{color:colors.muted,fontSize:11,fontWeight:'800'},
  resultLabelStrong:{color:'#E3F6F4'},
  resultValue:{color:colors.ink,fontSize:14,fontWeight:'900'},
  resultValueStrong:{color:'#FFFFFF'},
  placement:{gap:10,marginTop:10},
  label:{color:colors.ink,fontSize:12,fontWeight:'900'},
  nudgeRow:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},
  nudgeColumn:{gap:6},
  nudgeButton:{width:44,height:36,borderRadius:9,borderWidth:1,borderColor:colors.line,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface},
  nudgeText:{color:colors.navy,fontSize:14,fontWeight:'900'},
  pair:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
  recordForm:{gap:10,marginTop:12,backgroundColor:colors.surface,borderRadius:radius.md,padding:12},
  recordsList:{gap:8,marginTop:12},
  recordRow:{backgroundColor:colors.surface,borderRadius:radius.md,padding:11,gap:4,borderLeftWidth:4,borderLeftColor:colors.navy},
  recordCancelled:{borderLeftColor:colors.danger,opacity:.7},
  recordTitle:{color:colors.ink,fontSize:13,fontWeight:'900'},
  recordDetail:{color:colors.muted,fontSize:11,lineHeight:16},
  recordActions:{flexDirection:'row',gap:8,marginTop:4},
  correctForm:{gap:8,marginTop:6},
  hint:{color:colors.muted,fontSize:11,lineHeight:16,marginTop:10},
  error:{color:colors.danger,fontSize:12,fontWeight:'800',lineHeight:17,marginTop:8},
});
