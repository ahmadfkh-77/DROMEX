import {useEffect,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {ContractItemDetail,ContractLoadDetail,ContractQuantitiesRepository} from '../../../data/repositories/ContractQuantitiesRepository';
import {adjustmentPreview,validateContractAdjustment,type ContractItem} from '../../../domain/contractQuantities';
import {AppField,Feedback} from '../AppPrimitives';
import {DatePickerField,todayIso} from '../DatePickerField';
import {FocusedSheet,SheetActions} from '../FocusedSheet';
import {SegmentedChoice} from '../SegmentedChoice';
import {colors} from '../../theme';
import {contractAmount,contractDay,contractPercent,contractUsd} from './ContractParts';

const message=(cause:unknown,fallback:string)=>cause instanceof Error?cause.message:fallback;
export const loadTime=(load:Pick<ContractLoadDetail,'confirmedAt'>)=>new Date(load.confirmedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});

/** Mockup tab 6. A plus or minus line with a required reason; the loads are never changed. */
export function AdjustSheet({detail,contracts,visible,onClose,onDone}:{detail:ContractItemDetail;contracts:ContractQuantitiesRepository;visible:boolean;onClose:()=>void;onDone:()=>void}){
  const[direction,setDirection]=useState<'add'|'take'>('take');
  const[amount,setAmount]=useState('');const[reason,setReason]=useState('');
  const[error,setError]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  useEffect(()=>{if(visible){setDirection('take');setAmount('');setReason('');setError(null);}},[visible]);
  const {item,usage}=detail,unit=item.unitSymbol;
  const preview=adjustmentPreview(usage,direction,amount);
  async function save(){
    setError(null);
    try{validateContractAdjustment({amount:preview?.amount??amount,reason},usage);}catch(cause){setError(message(cause,'Check the amount and the reason.'));return;}
    setBusy(true);
    try{await contracts.addAdjustment(item.id,{amount:preview!.amount,reason});onDone();}catch(cause){setError(message(cause,'Could not save the adjustment.'));}finally{setBusy(false);}
  }
  return <FocusedSheet visible={visible} eyebrow={item.name.toUpperCase()} title="Adjust used quantity" onClose={onClose} footer={<SheetActions primaryLabel="Save adjustment" onPrimary={()=>void save()} onCancel={onClose} busy={busy} disabled={!preview||!reason.trim()}/>}>
    <Text style={styles.helper}>The loads are never changed. This is its own line with a reason, added to Used. A wrong adjustment is undone by a new one in the other direction; the first one stays in the history.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <SegmentedChoice label="Direction" options={[{id:'add' as const,label:'+ Add'},{id:'take' as const,label:'− Take off'}]} selectedId={direction} onSelect={setDirection}/>
    <AppField label={`Amount, ${unit} *`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad"/>
    <AppField label="Reason *" value={reason} onChangeText={setReason} placeholder="For example 3 m³ left on site, not spread"/>
    {preview?<>
      <Preview label="Used" value={`${contractAmount(usage.used)} → ${contractAmount(preview.usedAfter)} ${unit}`}/>
      <Preview label="Quantity used" value={`${contractPercent(usage)} → ${preview.percentAfter.toFixed(1)}%`}/>
    </>:null}
  </FocusedSheet>;
}

/** Mockup tab 6. Finish records the day; the used quantity does not change (honesty rule). */
export function FinishSheet({detail,contracts,visible,onClose,onDone}:{detail:ContractItemDetail;contracts:ContractQuantitiesRepository;visible:boolean;onClose:()=>void;onDone:()=>void}){
  const[day,setDay]=useState(todayIso());const[error,setError]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  useEffect(()=>{if(visible){setDay(todayIso());setError(null);}},[visible]);
  const {item,usage}=detail,unit=item.unitSymbol;
  async function save(){setBusy(true);setError(null);try{await contracts.finishItem(item.id,day);onDone();}catch(cause){setError(message(cause,'Could not finish the item.'));}finally{setBusy(false);}}
  return <FocusedSheet visible={visible} eyebrow="FINISH" title={`Finish ${item.name}?`} onClose={onClose} footer={<SheetActions primaryLabel="Finish item" onPrimary={()=>void save()} onCancel={onClose} busy={busy} disabled={!day}/>}>
    <Text style={styles.helper}>The work for this item is done. Loads can still be added later and will be counted.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <DatePickerField label="Finished on *" value={day} onChange={setDay} maxDate={todayIso()}/>
    <Preview label="Quantity used" value={`${contractAmount(usage.used)} of ${contractAmount(usage.allowed)} ${unit} · ${contractPercent(usage)}`}/>
    <Preview label="Leftover (saving)" value={`${contractAmount(usage.leftover)} ${unit}${usage.savingUsd!==null?` · ${contractUsd(usage.savingUsd)}`:''}`} tone="money"/>
    <Text style={styles.quiet}>The item will show Work: Complete and, separately, Quantity used: {contractPercent(usage)}. The used quantity does not change.</Text>
  </FocusedSheet>;
}

/** Mockup tab 6. Reopening needs a reason; the finish stays in the history. */
export function ReopenSheet({detail,contracts,visible,onClose,onDone}:{detail:ContractItemDetail;contracts:ContractQuantitiesRepository;visible:boolean;onClose:()=>void;onDone:()=>void}){
  const[reason,setReason]=useState('');const[error,setError]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  useEffect(()=>{if(visible){setReason('');setError(null);}},[visible]);
  const {item}=detail;
  async function save(){setBusy(true);setError(null);try{await contracts.reopenItem(item.id,reason);onDone();}catch(cause){setError(message(cause,'Could not reopen the item.'));}finally{setBusy(false);}}
  return <FocusedSheet visible={visible} eyebrow="REOPEN" title={`Reopen ${item.name}?`} onClose={onClose} footer={<SheetActions primaryLabel="Reopen item" onPrimary={()=>void save()} onCancel={onClose} busy={busy} disabled={!reason.trim()}/>}>
    <Text style={styles.helper}>{item.completedOn?`Finished on ${contractDay(item.completedOn)}. `:''}Reopening keeps that in the history and turns the saving back into an estimate.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppField label="Reason *" value={reason} onChangeText={setReason} placeholder="For example Extra 30 m of shoulder added"/>
  </FocusedSheet>;
}

/** Mockup tab 8. A load's important details and what can be done with it. */
export function LoadSheet({load,item,visible,onClose,onEdit,onOpen,onMove,onRemove}:{load:ContractLoadDetail|null;item:ContractItem;visible:boolean;onClose:()=>void;onEdit:()=>void;onOpen:()=>void;onMove:()=>void;onRemove:()=>void}){
  if(!load)return null;
  const company=load.source==='company';
  return <FocusedSheet visible={visible} eyebrow={company?'COMPANY LOAD':'SUPPLIER LOAD'} title={load.reference} onClose={onClose} footer={<ActionButton label="Close" onPress={onClose}/>}>
    <View style={styles.facts}>
      <Fact label="Date · time" value={`${contractDay(load.date)} · ${loadTime(load)}`}/>
      <Fact label="Material" value={load.materialName}/>
      <Fact label="Quantity" value={load.quantity===null?'Not recorded':`${contractAmount(load.quantity)} ${load.unitSymbol}`}/>
      <Fact label={company?'Truck · driver':'Truck · delivery'} value={[load.truckPlate,load.driverName].filter(Boolean).join(' · ')||'Not recorded'}/>
      <Fact label={company?'Customer':'Supplier'} value={load.partyName||'Not recorded'}/>
      {!company?<Fact label="Ticket" value={load.ticketNumber??'Not recorded'}/>:null}
      <Fact label="Status" value={load.status==='Cancelled'?'Cancelled · left out of Used':load.unitId!==item.unitId?`Active · not counted, unit differs (${load.unitSymbol} ≠ ${item.unitSymbol})`:'Active · counted'}/>
    </View>
    <ActionButton label="Edit load (correction with a reason)" tone="navy" onPress={onEdit}/>
    <ActionButton label="Move to another target" onPress={onMove}/>
    <ActionButton label="Remove from this target" onPress={onRemove}/>
    <ActionButton label="Open the full load" onPress={onOpen}/>
    <Text style={styles.helper}>Edit opens the existing reasoned correction. Move and Remove ask for a reason and are kept in the item's history; the load itself is never deleted.</Text>
  </FocusedSheet>;
}

/** Move to another item of the same project with the load's material, or remove from this item; both need a reason. */
export function MoveOrRemoveSheet({mode,load,item,projectId,contracts,visible,onClose,onDone}:{mode:'move'|'remove';load:ContractLoadDetail|null;item:ContractItem;projectId:string;contracts:ContractQuantitiesRepository;visible:boolean;onClose:()=>void;onDone:()=>void}){
  const[targets,setTargets]=useState<ContractItem[]|null>(null);const[target,setTarget]=useState('');
  const[reason,setReason]=useState('');const[error,setError]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!visible||!load)return;
    setReason('');setError(null);setTarget('');setTargets(null);
    if(mode==='move')contracts.candidatesFor(projectId,load.materialId).then(found=>setTargets(found.candidates.filter(value=>value.id!==item.id))).catch(()=>setTargets([]));
  },[visible,load,mode,contracts,projectId,item.id]);
  if(!load)return null;
  async function save(){
    setBusy(true);setError(null);
    try{if(mode==='move')await contracts.moveLoad({source:load!.source,loadId:load!.id},target,reason);else await contracts.unlinkLoad({source:load!.source,loadId:load!.id},reason);onDone();}
    catch(cause){setError(message(cause,'Could not change the load.'));}finally{setBusy(false);}
  }
  return <FocusedSheet visible={visible} eyebrow={load.reference} title={mode==='move'?'Move to another target':'Remove from this target'} onClose={onClose} footer={<SheetActions primaryLabel={mode==='move'?'Move load':'Remove load'} onPrimary={()=>void save()} onCancel={onClose} busy={busy} disabled={!reason.trim()||(mode==='move'&&!target)}/>}>
    <Text style={styles.helper}>{mode==='move'?`The load stops counting in ${item.name} and counts in the item you choose. Both histories keep the reason.`:`The load stops counting in ${item.name} and becomes not linked. The load itself is not changed.`}</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {mode==='move'?(targets===null?<Text style={styles.helper}>Looking for items…</Text>:targets.length?targets.map(value=><TouchableOpacity key={value.id} style={[styles.choice,target===value.id&&styles.choiceOn]} onPress={()=>setTarget(value.id)} accessibilityRole="radio" accessibilityState={{selected:target===value.id}}>
      <View style={styles.radio}>{target===value.id?<View style={styles.radioDot}/>:null}</View><Text style={styles.choiceTitle}>{value.name}</Text><Text style={styles.unit}>{value.unitSymbol}</Text>
    </TouchableOpacity>):<Text style={styles.quiet}>No other target of this project lists {load.materialName}. Add the material to another item first, or remove the load instead.</Text>):null}
    <AppField label="Reason *" value={reason} onChangeText={setReason}/>
  </FocusedSheet>;
}

/** Mockup tab 5 (last screen). The project's unlinked loads of the item's materials; ticked loads are linked with one reason. */
export function LinkLoadsSheet({detail,contracts,visible,onClose,onDone}:{detail:ContractItemDetail;contracts:ContractQuantitiesRepository;visible:boolean;onClose:()=>void;onDone:()=>void}){
  const[loads,setLoads]=useState<ContractLoadDetail[]|null>(null);const[ticked,setTicked]=useState<Set<string>>(new Set());
  const[reason,setReason]=useState('');const[error,setError]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  const {item}=detail;
  useEffect(()=>{if(!visible)return;setTicked(new Set());setReason('');setError(null);setLoads(null);contracts.linkableLoads(item.id).then(setLoads).catch(cause=>{setLoads([]);setError(message(cause,'Could not list the loads.'));});},[visible,contracts,item.id]);
  const toggle=(id:string)=>setTicked(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  async function save(){
    setBusy(true);setError(null);
    try{await contracts.linkLoads(item.id,(loads??[]).filter(value=>ticked.has(value.id)).map(load=>({source:load.source,loadId:load.id})),reason);onDone();}
    catch(cause){setError(message(cause,'Could not link the loads.'));}finally{setBusy(false);}
  }
  return <FocusedSheet visible={visible} eyebrow={item.name.toUpperCase()} title="Link older loads" onClose={onClose} footer={<SheetActions primaryLabel={ticked.size?`Link ${ticked.size} load${ticked.size===1?'':'s'}`:'Link loads'} onPrimary={()=>void save()} onCancel={onClose} busy={busy} disabled={!ticked.size||!reason.trim()}/>}>
    <Text style={styles.helper}>Loads of this project and of this item's materials that count toward no target yet. Linking them later needs a reason, kept in the history.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {loads===null?<Text style={styles.helper}>Looking for loads…</Text>:loads.length?loads.map(load=><TouchableOpacity key={load.id} style={[styles.choice,ticked.has(load.id)&&styles.choiceOn]} onPress={()=>toggle(load.id)} accessibilityRole="checkbox" accessibilityState={{checked:ticked.has(load.id)}}>
      <View style={[styles.box,ticked.has(load.id)&&styles.boxOn]}>{ticked.has(load.id)?<Text style={styles.tick}>✓</Text>:null}</View>
      <View style={styles.flex}><Text style={styles.choiceTitle}>{load.reference} · {contractDay(load.date)}</Text><Text style={styles.helper}>{load.materialName} · {load.source==='company'?'Company':'Supplier'}{load.partyName?` · ${load.partyName}`:''}</Text></View>
      <Text style={[styles.unit,load.unitId!==item.unitId&&styles.unitBad]}>{load.quantity===null?'—':contractAmount(load.quantity)} {load.unitSymbol}</Text>
    </TouchableOpacity>):<Text style={styles.quiet}>No unlinked loads of {detail.materials.map(material=>material.name).join(', ')||'these materials'} in this project.</Text>}
    <AppField label="Reason *" value={reason} onChangeText={setReason} placeholder="For example Recorded before quantity targets"/>
  </FocusedSheet>;
}

function Preview({label,value,tone}:{label:string;value:string;tone?:'money'}){return <View style={styles.preview}><Text style={styles.previewLabel}>{label}</Text><Text style={[styles.previewValue,tone==='money'&&styles.money]}>{value}</Text></View>;}
function Fact({label,value}:{label:string;value:string}){return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;}
function ActionButton({label,onPress,tone='secondary'}:{label:string;onPress:()=>void;tone?:'navy'|'secondary'}){return <TouchableOpacity style={[styles.action,tone==='navy'&&styles.actionNavy]} onPress={onPress} accessibilityRole="button"><Text style={[styles.actionText,tone==='navy'&&styles.actionTextNavy]}>{label}</Text></TouchableOpacity>;}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  quiet:{backgroundColor:'#EEF2F6',borderColor:'#D3DDE7',borderWidth:1,borderRadius:12,padding:10,color:'#24384D',fontSize:13,lineHeight:19,overflow:'hidden'},
  preview:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:12,paddingHorizontal:12,paddingVertical:10},
  previewLabel:{color:colors.muted,fontSize:13,fontWeight:'600'},
  previewValue:{color:colors.navy,fontSize:16,fontWeight:'800',flexShrink:1,textAlign:'right'},
  money:{color:'#17693B'},
  facts:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:14,paddingVertical:6},
  fact:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:7,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line},
  factLabel:{color:colors.muted,fontSize:13},
  factValue:{color:colors.ink,fontSize:13,fontWeight:'800',flexShrink:1,textAlign:'right'},
  action:{minHeight:48,borderRadius:12,borderWidth:1.5,borderColor:colors.navy,alignItems:'center',justifyContent:'center',paddingHorizontal:14,backgroundColor:colors.surface},
  actionNavy:{backgroundColor:colors.navy},
  actionText:{color:colors.navy,fontSize:14,fontWeight:'800',textAlign:'center'},
  actionTextNavy:{color:'#FFF'},
  choice:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1.5,borderColor:'#CFC8BB',borderRadius:12,paddingHorizontal:12,paddingVertical:8,backgroundColor:colors.surface},
  choiceOn:{borderColor:colors.navy,backgroundColor:'#F1F5FA'},
  choiceTitle:{flex:1,color:colors.ink,fontSize:14,fontWeight:'800'},
  radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:colors.navy,alignItems:'center',justifyContent:'center'},
  radioDot:{width:11,height:11,borderRadius:6,backgroundColor:colors.navy},
  box:{width:24,height:24,borderRadius:6,borderWidth:2,borderColor:colors.navy,alignItems:'center',justifyContent:'center'},
  boxOn:{backgroundColor:colors.navy},
  tick:{color:'#FFF',fontWeight:'900'},
  unit:{color:colors.navy,backgroundColor:'#E8EDF3',fontSize:12,fontWeight:'800',borderRadius:8,paddingHorizontal:8,paddingVertical:3,overflow:'hidden'},
  unitBad:{color:colors.danger,backgroundColor:'#FDECEA'},
});
