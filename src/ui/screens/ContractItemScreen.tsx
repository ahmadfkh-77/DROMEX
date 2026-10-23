import {useCallback,useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {ContractItemDetail,ContractLoadDetail,ContractQuantitiesRepository} from '../../data/repositories/ContractQuantitiesRepository';
import {contractHistoryLabel,groupContractLoadsByDay} from '../../domain/contractQuantities';
import {localDateKey} from '../../domain/fuel';
import type {Project} from '../../domain/loads';
import {AppButton,AppCard,AppPage,Feedback,PageHeader} from '../components/AppPrimitives';
import {SegmentedChoice} from '../components/SegmentedChoice';
import {AdjustSheet,FinishSheet,LinkLoadsSheet,LoadSheet,MoveOrRemoveSheet,ReopenSheet,loadTime} from '../components/contracts/ContractItemSheets';
import {ContractBar,ContractFigures,ContractPill,ContractWorkAndUse,contractAmount,contractDay,contractPercent,contractUsd} from '../components/contracts/ContractParts';
import {colors} from '../theme';

type Sheet=null|'adjust'|'finish'|'reopen'|'link'|'load'|'move'|'remove';
type SourceFilter='all'|'company'|'supplier';
const whenText=(at:string)=>`${contractDay(localDateKey(new Date(at)))} · ${new Date(at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;

/**
 * DEC-522 Phase D2 (mockup tabs 2, 6 and 8). One contract item: its state, From loads / Adjustments / Used kept apart, the Not counted
 * loads, the loads counted grouped by day (each load opens its details, Edit, Move, Remove and Open), the adjustments and the history.
 * Every figure comes from the repository and the domain; this screen does no arithmetic.
 */
export function ContractItemScreen({project,contracts,contractItemId,onBack,onEdit,onEditLoad,onOpenLoad}:{
  project:Project;contracts:ContractQuantitiesRepository;contractItemId:string;onBack:()=>void;onEdit:()=>void;
  /** Opens the existing reasoned correction of the load. */
  onEditLoad:(load:ContractLoadDetail)=>void;
  onOpenLoad:(load:ContractLoadDetail)=>void;
}){
  const[detail,setDetail]=useState<ContractItemDetail|null>(null);
  const[error,setError]=useState<string|null>(null);
  const[sheet,setSheet]=useState<Sheet>(null);
  const[selected,setSelected]=useState<ContractLoadDetail|null>(null);
  const[filter,setFilter]=useState<SourceFilter>('all');
  const[openDays,setOpenDays]=useState<Set<string>|null>(null);
  const[showCancelled,setShowCancelled]=useState(false);
  const[message,setMessage]=useState<string|null>(null);
  const load=useCallback(()=>{setError(null);contracts.getItem(contractItemId).then(setDetail).catch(cause=>setError(cause instanceof Error?cause.message:'Could not open the contract item.'));},[contracts,contractItemId]);
  useEffect(load,[load]);
  const done=(text:string)=>{setSheet(null);setSelected(null);setMessage(text);load();};

  const grouped=useMemo(()=>{
    if(!detail)return null;
    const all=[...detail.loadsByDay.days.flatMap(day=>day.loads.map(entry=>entry.load)),...detail.loadsByDay.cancelled];
    return groupContractLoadsByDay(detail.item,filter==='all'?all:all.filter(value=>value.source===filter));
  },[detail,filter]);
  const firstDay=grouped?.days[0]?.day;
  const isOpen=(day:string)=>openDays?openDays.has(day):day===firstDay;
  const toggleDay=(day:string)=>setOpenDays(current=>{const next=new Set(current??(firstDay?[firstDay]:[]));if(next.has(day))next.delete(day);else next.add(day);return next;});

  if(error)return <AppPage><PageHeader eyebrow="Contract item" title="Contract item" onBack={onBack}/><Feedback kind="error">{error}</Feedback><AppButton label="Try again" tone="secondary" onPress={load}/></AppPage>;
  if(!detail||!grouped)return <AppPage><PageHeader eyebrow="Contract item" title="Contract item" onBack={onBack}/><View style={styles.center}><ActivityIndicator size="large" color={colors.brand}/></View></AppPage>;
  const {item,usage}=detail,unit=item.unitSymbol,cancelled=Boolean(item.cancelledAt),complete=item.status==='complete';

  return <AppPage>
    <PageHeader eyebrow="Contract item" title={item.name} onBack={onBack}/>
    {message?<Feedback kind="success">{message}</Feedback>:null}
    {cancelled?<Feedback kind="warning">This contract item was cancelled. It stays in the history with its loads listed, and is left out of the project totals.</Feedback>:null}

    <View style={[styles.card,usage.warning==='over'&&!complete?styles.cardOver:usage.warning!=='none'&&!complete?styles.cardNear:complete?styles.cardDone:null]}>
      <View style={styles.head}>
        <View style={styles.flex}><Text style={styles.allowed}>{contractAmount(usage.allowed)} {unit} allowed</Text><Text style={styles.helper}>{item.unitPriceUsd!==null?`${contractUsd(item.unitPriceUsd)} / ${unit} · contract value ${contractUsd(usage.contractValueUsd!)}`:'No contract price'}</Text></View>
        <ContractPill item={item} usage={usage}/>
      </View>
      <ContractBar item={item} usage={usage}/>
      <ContractWorkAndUse item={item} usage={usage}/>
      <ContractFigures item={item} usage={usage}/>
      {!complete&&usage.warning==='near'?<Text style={styles.amber}><Text style={styles.bold}>90% of the contract is used.</Text> {contractAmount(usage.remaining)} {unit} left. Loads can still be recorded; going over is allowed and will be shown as over contract.</Text>:null}
      {!complete&&usage.warning==='full'?<Text style={styles.amber}><Text style={styles.bold}>The contract quantity is reached.</Text> Loads can still be recorded; going over is allowed and will be shown as over contract.</Text>:null}
      {usage.overContract?<Text style={styles.red}><Text style={styles.bold}>Over contract by {contractAmount(usage.overBy)} {unit} ({contractPercent(usage)} used).</Text> All loads are kept and counted.{usage.valueOverUsd!==null?` Value over contract: ${contractUsd(usage.valueOverUsd)}.`:''}</Text>:null}
      {complete&&usage.lateLoads.length?<Text style={styles.amber}><Text style={styles.bold}>A load was added after this item was finished.</Text> {usage.lateLoads.map(value=>`${value.reference} · ${contractDay(value.date)} · ${contractAmount(value.quantity!)} ${unit}`).join('; ')} {usage.lateLoads.length===1?'is':'are'} counted. Reopen the item if the work continued.</Text>:null}
      {complete&&!usage.overContract?<Text style={styles.green}><Text style={styles.bold}>{usage.savingUsd!==null?`Saving: ${contractAmount(usage.leftover)} ${unit} · ${contractUsd(usage.savingUsd)}`:`Leftover: ${contractAmount(usage.leftover)} ${unit}`}</Text>{usage.savingUsd!==null?` (${contractAmount(usage.leftover)} ${unit} × ${contractUsd(item.unitPriceUsd!)}).`:'.'}{item.completedOn?` Finished on ${contractDay(item.completedOn)}.`:''}</Text>:null}
      <View style={styles.facts}>
        <Fact label={`From loads (${usage.countedLoads.length})`} value={`${contractAmount(usage.fromLoads)} ${unit}`}/>
        <Fact label={`Adjustments (${usage.adjustments.length})`} value={usage.adjustments.length?`${usage.adjustmentsTotal<0?'− ':'+ '}${contractAmount(Math.abs(usage.adjustmentsTotal))} ${unit}`:'none'}/>
        <Fact label="Used" value={`${contractAmount(usage.used)} ${unit}`} strong/>
        {usage.valueUsedUsd!==null&&usage.valueRemainingUsd!==null?<Fact label="Value used · remaining" value={`${contractUsd(usage.valueUsedUsd)} · ${contractUsd(usage.valueRemainingUsd)}`}/>:null}
      </View>
      {!cancelled?<View style={styles.actions}>
        <View style={styles.flex}><AppButton label="Adjust" tone="secondary" onPress={()=>setSheet('adjust')}/></View>
        <View style={styles.flex}>{complete?<AppButton label="Reopen" tone="secondary" onPress={()=>setSheet('reopen')}/>:<AppButton label="Finish" tone="navy" onPress={()=>setSheet('finish')}/>}</View>
      </View>:null}
      <AppButton label={cancelled?'Open item details':'Edit item'} tone="secondary" onPress={onEdit}/>
    </View>

    {usage.notCounted.length?<AppCard title={`Not counted (${usage.notCounted.length})`} hint="Linked to this item but left out of Used. Never converted or guessed.">
      {usage.notCounted.map(entry=><View key={entry.load.id} style={styles.row}><Text style={styles.rowText}>{entry.load.reference} · {contractDay(entry.load.date)} · {entry.load.quantity===null?'no quantity':`${contractAmount(entry.load.quantity)} ${entry.load.unitSymbol}`}</Text><Text style={[styles.unit,styles.unitBad]}>{entry.reason==='unit_differs'?`unit differs: ${entry.load.unitSymbol} ≠ ${unit}`:'no quantity'}</Text></View>)}
    </AppCard>:null}

    <AppCard title="Loads counted" hint={`${usage.countedLoads.length} load${usage.countedLoads.length===1?'':'s'} · ${contractAmount(usage.fromLoads)} ${unit} from loads. Adjustments are listed below.`}>
      <SegmentedChoice mode="tabs" options={[{id:'all' as const,label:'All'},{id:'company' as const,label:'Company'},{id:'supplier' as const,label:'Supplier'}]} selectedId={filter} onSelect={setFilter}/>
      {!grouped.days.length?<Text style={styles.helper}>{filter==='all'?'No loads count toward this item yet.':`No ${filter} loads count toward this item.`}</Text>:null}
      {grouped.days.map(day=>{const open=isOpen(day.day);return <View key={day.day} style={styles.day}>
        <TouchableOpacity style={styles.dayHead} onPress={()=>toggleDay(day.day)} accessibilityRole="button" accessibilityState={{expanded:open}}>
          <View style={styles.flex}><Text style={styles.dayTitle}>{contractDay(day.day)}</Text><Text style={styles.helper}>{day.loads.length} load{day.loads.length===1?'':'s'}{day.notCountedCount?` · ${day.notCountedCount} not counted`:''}</Text></View>
          <Text style={styles.dayTotal}>{contractAmount(day.countedQuantity)} {unit}</Text><Text style={styles.mark}>{open?'×':'+'}</Text>
        </TouchableOpacity>
        {open?day.loads.map(({load:value,notCountedReason})=><LoadRow key={value.id} load={value} notCounted={notCountedReason!==null} itemUnit={unit} onOpen={()=>{setSelected(value);setSheet('load');}} onEdit={()=>onEditLoad(value)} onMove={()=>{setSelected(value);setSheet('move');}}/>):null}
      </View>;})}
      {grouped.cancelled.length?<View style={styles.day}>
        <TouchableOpacity style={styles.dayHead} onPress={()=>setShowCancelled(value=>!value)} accessibilityRole="button" accessibilityState={{expanded:showCancelled}}>
          <View style={styles.flex}><Text style={styles.dayTitle}>Cancelled loads</Text><Text style={styles.helper}>{grouped.cancelled.length} · left out of Used</Text></View><Text style={styles.mark}>{showCancelled?'×':'+'}</Text>
        </TouchableOpacity>
        {showCancelled?grouped.cancelled.map(value=><LoadRow key={value.id} load={value} notCounted itemUnit={unit} onOpen={()=>{setSelected(value);setSheet('load');}} onEdit={()=>onEditLoad(value)} onMove={()=>{setSelected(value);setSheet('move');}}/>):null}
      </View>:null}
      {!cancelled?<AppButton label="Link older loads" tone="secondary" onPress={()=>setSheet('link')}/>:null}
    </AppCard>

    <AppCard title="Adjustments">
      {usage.adjustments.length?usage.adjustments.map(value=><View key={value.id} style={styles.history}>
        <View style={styles.row}><Text style={styles.historyTitle}>{whenText(value.createdAt)}</Text><Text style={styles.amount}>{value.amount<0?'− ':'+ '}{contractAmount(Math.abs(value.amount))} {unit}</Text></View>
        <Text style={styles.helper}>Reason: {value.reason}</Text>
      </View>):<Text style={styles.helper}>No adjustments. Used is exactly the loads counted.</Text>}
    </AppCard>

    <AppCard title="History">
      {detail.history.map(line=><View key={line.id} style={styles.history}><Text style={styles.historyTitle}>{whenText(line.createdAt)} · {contractHistoryLabel(line.kind)}</Text>{line.reason?<Text style={styles.helper}>{line.reason}</Text>:null}</View>)}
    </AppCard>
    <Text style={styles.helper}>{project.name}</Text>

    <AdjustSheet detail={detail} contracts={contracts} visible={sheet==='adjust'} onClose={()=>setSheet(null)} onDone={()=>done('Adjustment saved. It is listed below with its reason.')}/>
    <FinishSheet detail={detail} contracts={contracts} visible={sheet==='finish'} onClose={()=>setSheet(null)} onDone={()=>done('Item finished. The quantity used did not change.')}/>
    <ReopenSheet detail={detail} contracts={contracts} visible={sheet==='reopen'} onClose={()=>setSheet(null)} onDone={()=>done('Item reopened. The finish stays in the history.')}/>
    <LinkLoadsSheet detail={detail} contracts={contracts} visible={sheet==='link'} onClose={()=>setSheet(null)} onDone={()=>done('Loads linked. They now count toward this item.')}/>
    <LoadSheet load={selected} item={item} visible={sheet==='load'} onClose={()=>{setSheet(null);setSelected(null);}} onEdit={()=>{if(selected){setSheet(null);onEditLoad(selected);}}} onOpen={()=>{if(selected){setSheet(null);onOpenLoad(selected);}}} onMove={()=>setSheet('move')} onRemove={()=>setSheet('remove')}/>
    <MoveOrRemoveSheet mode={sheet==='remove'?'remove':'move'} load={selected} item={item} projectId={item.projectId} contracts={contracts} visible={sheet==='move'||sheet==='remove'} onClose={()=>{setSheet(null);setSelected(null);}} onDone={()=>done(sheet==='remove'?'Load removed from this item.':'Load moved to the other item.')}/>
  </AppPage>;
}

function LoadRow({load,notCounted,itemUnit,onOpen,onEdit,onMove}:{load:ContractLoadDetail;notCounted:boolean;itemUnit:string;onOpen:()=>void;onEdit:()=>void;onMove:()=>void}){
  const company=load.source==='company';
  return <View style={[styles.load,notCounted&&styles.loadNotCounted]}>
    <TouchableOpacity onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${load.reference}, open details`}>
      <View style={styles.loadTop}><Text style={styles.loadRef}>{load.reference}</Text><Text style={[styles.source,company?styles.sourceCompany:styles.sourceSupplier]}>{company?'COMPANY':'SUPPLIER'}</Text><Text style={styles.helper}>{loadTime(load)}</Text>
        <Text style={[styles.loadQty,notCounted&&styles.struck]}>{load.quantity===null?'—':contractAmount(load.quantity)} {load.unitSymbol}</Text></View>
      <Text style={styles.loadLine}>{[load.materialName,load.truckPlate,load.driverName].filter(Boolean).join(' · ')}</Text>
      <Text style={styles.loadLine}>{company?`Customer: ${load.partyName||'not recorded'}`:`${load.partyName}${load.ticketNumber?` · Ticket ${load.ticketNumber}`:''}`}</Text>
      {load.status==='Cancelled'?<Text style={styles.notCounted}>Cancelled · left out of Used</Text>:notCounted?<Text style={styles.notCounted}>Not counted: load {load.unitSymbol} · item {itemUnit}</Text>:null}
    </TouchableOpacity>
    <View style={styles.loadActions}>
      <TouchableOpacity style={styles.link} onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${load.reference}`}><Text style={styles.linkText}>Edit</Text></TouchableOpacity>
      <TouchableOpacity style={styles.link} onPress={onMove} accessibilityRole="button" accessibilityLabel={`Move ${load.reference}`}><Text style={styles.linkText}>Move</Text></TouchableOpacity>
    </View>
  </View>;
}

function Fact({label,value,strong=false}:{label:string;value:string;strong?:boolean}){return <View style={[styles.fact,strong&&styles.factStrong]}><Text style={[styles.factLabel,strong&&styles.factLabelStrong]}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;}

const styles=StyleSheet.create({
  center:{alignItems:'center',paddingVertical:30},
  flex:{flex:1,minWidth:0},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  bold:{fontWeight:'800'},
  card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:16,padding:14,gap:10},
  cardNear:{borderColor:'#EFC979'},cardOver:{borderColor:'#F0ABA4'},cardDone:{borderColor:'#A9D8B8'},
  head:{flexDirection:'row',alignItems:'flex-start',gap:10},
  allowed:{color:colors.ink,fontSize:17,fontWeight:'800'},
  amber:{backgroundColor:'#FFF4DC',borderColor:'#EFC979',borderWidth:1,borderRadius:12,padding:10,color:'#5E3A00',fontSize:13,lineHeight:19,overflow:'hidden'},
  red:{backgroundColor:'#FDECEA',borderColor:'#F0ABA4',borderWidth:1,borderRadius:12,padding:10,color:'#6E120B',fontSize:13,lineHeight:19,overflow:'hidden'},
  green:{backgroundColor:'#E6F4EA',borderColor:'#A9D8B8',borderWidth:1,borderRadius:12,padding:10,color:'#0F4627',fontSize:13,lineHeight:19,overflow:'hidden'},
  facts:{borderTopWidth:1,borderTopColor:'#EEE9DF',paddingTop:6},
  fact:{flexDirection:'row',justifyContent:'space-between',gap:10,paddingVertical:4},
  factStrong:{borderTopWidth:1,borderTopColor:'#EEE9DF',marginTop:2,paddingTop:6},
  factLabel:{color:colors.muted,fontSize:13},
  factLabelStrong:{color:colors.ink,fontWeight:'800'},
  factValue:{color:colors.ink,fontSize:14,fontWeight:'800'},
  actions:{flexDirection:'row',gap:8},
  row:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},
  rowText:{flex:1,color:colors.ink,fontSize:13},
  unit:{color:colors.navy,backgroundColor:'#E8EDF3',fontSize:12,fontWeight:'800',borderRadius:8,paddingHorizontal:8,paddingVertical:3,overflow:'hidden'},
  unitBad:{color:colors.danger,backgroundColor:'#FDECEA'},
  day:{borderWidth:1,borderColor:colors.line,borderRadius:14,overflow:'hidden'},
  dayHead:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:12,paddingVertical:8,backgroundColor:'#F2EEE6'},
  dayTitle:{color:colors.ink,fontSize:14,fontWeight:'800'},
  dayTotal:{color:colors.navy,fontSize:16,fontWeight:'800'},
  mark:{color:colors.navy,fontSize:22,fontWeight:'800',width:24,textAlign:'center'},
  load:{paddingHorizontal:12,paddingTop:10,borderTopWidth:1,borderTopColor:'#EEE9DF',gap:2},
  loadNotCounted:{backgroundColor:'#FFFAF2'},
  loadTop:{flexDirection:'row',alignItems:'center',gap:8},
  loadRef:{color:colors.ink,fontSize:14,fontWeight:'800'},
  source:{fontSize:10,fontWeight:'800',borderRadius:6,paddingHorizontal:7,paddingVertical:2,overflow:'hidden',letterSpacing:.3},
  sourceCompany:{backgroundColor:'#FBE6DF',color:colors.brandDark},
  sourceSupplier:{backgroundColor:'#E8EDF3',color:colors.navy},
  loadQty:{marginLeft:'auto',color:colors.ink,fontSize:16,fontWeight:'800'},
  struck:{textDecorationLine:'line-through',color:colors.muted},
  loadLine:{color:'#3C4854',fontSize:12.5},
  notCounted:{color:colors.danger,fontSize:12,fontWeight:'700'},
  loadActions:{flexDirection:'row',gap:18},
  link:{minHeight:44,justifyContent:'center'},
  linkText:{color:colors.brand,fontSize:14,fontWeight:'800'},
  history:{paddingVertical:8,borderTopWidth:1,borderTopColor:'#EEE9DF',gap:2},
  historyTitle:{color:colors.ink,fontSize:14,fontWeight:'800'},
  amount:{color:colors.navy,fontSize:14,fontWeight:'800'},
});
