import {useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {BitumenRepository} from '../../data/repositories/BitumenRepository';
import {formatKg,isOpenBatch,type BitumenBatch,type BitumenOverview} from '../../domain/bitumen';
import {fillIssueMessages,type BitumenFillDraft,type BitumenFillSetup,type FillPlan} from '../../domain/bitumenFills';
import {activeFillKg,batchFillFigures,batchFillLine,cancelledFillNote,destinationTypeLabel,fillDestinationTotals,fillPreviewLines,fillRowsForBatch,fillTimeText,groupFillsByDay,type FillRow} from '../../domain/bitumenFillViews';
import {localDateKey} from '../../domain/fuel';
import {AppButton,AppCard,AppField,Feedback} from './AppPrimitives';
import {DatePickerField} from './DatePickerField';
import {FuelDestinationFields} from './FuelDestinationFields';
import {Preview,Step} from './fuel/FuelFillForm';
import {SearchableSelect} from './SearchableSelect';
import {colors,radius} from '../theme';

/**
 * DEC-557. Bitumen Record Fill: the figures and bar on a batch, the fills by day, the Record Fill form with its "Before you save" panel,
 * and the line on the batch list. It follows the approved mockup (docs/design/bitumen-fill-mockup.html) and the diesel Record Fill.
 * A fill is never edited or deleted here: a wrong fill is cancelled with a reason and stays on the page, marked Cancelled.
 */
const FIRST_DAYS=5;
const ORANGE='#A83B24';

/** The share of delivered bitumen taken by fills (orange) and by asphalt loads (navy), with what is left. */
export function FillBar({batch}:{batch:BitumenBatch}){
  const figures=batchFillFigures(batch);
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.bar}><View style={[styles.barFills,{flex:figures.fillsShare}]}/><View style={[styles.barAsphalt,{flex:figures.asphaltShare}]}/><View style={{flex:Math.max(0,1-figures.fillsShare-figures.asphaltShare)}}/></View></View>;
}

/** The line and the bar under a batch on the list. Shown when the batch has fills or the Owner has asphalt rules. */
export function BatchFillSummary({batch}:{batch:BitumenBatch}){
  return <><FillBar batch={batch}/><Text style={styles.sub}>{batchFillLine(batch)}</Text></>;
}

function Figure({label,value,color,strong}:{label:string;value:string;color?:string;strong?:boolean}){
  return <View style={styles.figure}><Text style={styles.figureLabel}>{label.toUpperCase()}</Text><Text style={[styles.figureValue,strong&&styles.figureStrong,color?{color}:null]}>{value}</Text></View>;
}

/** The batch page figures once fills exist: delivered, taken by fills, estimated asphalt use, adjustments and what remains, with the bar. */
export function FillFiguresCard({batch,estimated}:{batch:BitumenBatch;estimated:boolean}){
  const figures=batchFillFigures(batch);
  return <View style={styles.figuresCard}>
    <View style={styles.row}><Figure label="Delivered" value={formatKg(figures.deliveredKg)}/><Figure label="Taken by fills" value={formatKg(figures.fillsKg)} color={ORANGE}/></View>
    <View style={styles.row}><Figure label={estimated?'Est. used by asphalt loads':'Used by asphalt loads'} value={formatKg(figures.asphaltKg)} color={colors.navy}/>{Math.abs(figures.adjustmentKg)>0.0005?<Figure label="Adjustments" value={`${figures.adjustmentKg<0?'−':'+'}${formatKg(Math.abs(figures.adjustmentKg))}`}/>:<View style={styles.figure}/>}</View>
    <Figure label={estimated?'Est. remaining':'Remaining'} value={formatKg(figures.remainingKg)} strong/>
    <FillBar batch={batch}/>
    <View style={styles.legend}><Text style={[styles.legendItem,{color:ORANGE}]}>■ Fills</Text><Text style={[styles.legendItem,{color:colors.navy}]}>■ Asphalt loads</Text><Text style={styles.legendItem}>□ Remaining</Text></View>
  </View>;
}

/** Where this batch's fills went (a card), then one card per day, newest first, grouped by destination. */
export function FillsByDayCard({batch,overview,busy,onCancelFill}:{batch:BitumenBatch;overview:BitumenOverview;busy:boolean;onCancelFill:(fillId:string,reason:string)=>void}){
  const rows=useMemo(()=>fillRowsForBatch(overview.fills??[],batch.id),[overview.fills,batch.id]);
  const days=useMemo(()=>groupFillsByDay(rows),[rows]);
  const totals=useMemo(()=>fillDestinationTotals(rows),[rows]);
  const[olderShown,setOlderShown]=useState(false),[cancelling,setCancelling]=useState<string|null>(null),[reason,setReason]=useState('');
  if(!rows.length)return null;
  const shown=olderShown?days:days.slice(0,FIRST_DAYS);
  return <>
    <AppCard title="Taken by fills, by destination" hint="Cancelled fills are not counted.">
      {totals.length?totals.map(total=><View key={total.key} style={styles.fact}><Text style={[styles.strong,styles.flex]}>{total.name}</Text><Text style={styles.kg}>{formatKg(total.kg)}</Text></View>):<Text style={styles.sub}>Every fill of this batch is cancelled.</Text>}
      <View style={styles.totalLine}><Text style={styles.strong}>Total taken by fills</Text><Text style={[styles.kg,{color:ORANGE}]}>{formatKg(activeFillKg(rows))}</Text></View>
    </AppCard>
    <AppCard title="Fills by day" hint="Newest first, one card per day.">
      {shown.map(day=><View key={day.day} style={styles.day}>
        <View style={styles.dayHead}><View style={styles.flex}><Text style={styles.dayTitle}>{day.label}{day.isToday?'  · TODAY':''}</Text></View><View><Text style={styles.sub}>Day total</Text><Text style={[styles.kg,{color:ORANGE}]}>{formatKg(day.total)}</Text></View></View>
        {day.groups.map(group=><View key={group.key} style={styles.group}>
          <Text style={styles.groupTitle}>{group.type==='unassigned'?'UNASSIGNED':`${destinationTypeLabel[group.type].toUpperCase()}  `}{group.type==='unassigned'?'':<Text style={styles.groupName}>{group.name}</Text>}</Text>
          {group.rows.map(row=><FillLine key={row.fillId} row={row} busy={busy} open={cancelling===row.fillId} reason={reason} onReason={setReason} onOpen={()=>{setCancelling(row.fillId);setReason('');}} onClose={()=>setCancelling(null)} onConfirm={()=>{onCancelFill(row.fillId,reason);setCancelling(null);setReason('');}}/>)}
          <View style={styles.groupTotal}><Text style={styles.sub}>{group.type==='unassigned'?'Unassigned':group.type==='project'?'Project':'Site'} total</Text><Text style={styles.strong}>{formatKg(group.total)}</Text></View>
        </View>)}
      </View>)}
      {!olderShown&&days.length>FIRST_DAYS?<TouchableOpacity style={styles.more} onPress={()=>setOlderShown(true)} accessibilityRole="button"><Text style={styles.moreText}>Show earlier days ({days.length-FIRST_DAYS} more)</Text></TouchableOpacity>:null}
    </AppCard>
  </>;
}

function FillLine({row,busy,open,reason,onReason,onOpen,onClose,onConfirm}:{row:FillRow;busy:boolean;open:boolean;reason:string;onReason:(value:string)=>void;onOpen:()=>void;onClose:()=>void;onConfirm:()=>void}){
  const cancelled=cancelledFillNote(row);
  return <View style={[styles.fillCard,row.cancelled&&styles.fillCancelled]}>
    <View style={styles.fillTop}><View style={styles.flex}>
      <Text style={[styles.strong,row.cancelled&&styles.struck]}>Truck {row.truckName}</Text>
      <Text style={styles.sub}>{fillTimeText(row.confirmedAt,row.enteredAt,row.day)} · {row.split?`part of a ${formatKg(row.totalKg)} fill`:'one fill'}{row.ticketNumber?` · Ticket ${row.ticketNumber}`:''}</Text>
      {row.layerNote?<Text style={styles.body}>{row.layerNote}</Text>:null}{row.notes?<Text style={styles.sub}>{row.notes}</Text>:null}
    </View><Text style={[styles.kg,row.cancelled?styles.struck:{color:ORANGE}]}>{formatKg(row.kg)}</Text></View>
    {cancelled?<Text style={[styles.sub,{color:colors.danger}]}>{cancelled}</Text>:null}
    {!row.cancelled&&!open?<TouchableOpacity style={styles.cancelLink} disabled={busy} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Cancel the fill of ${formatKg(row.kg)} into truck ${row.truckName}`}><Text style={styles.link}>Cancel this fill</Text></TouchableOpacity>:null}
    {open?<View style={styles.cancelBox}><AppField label="Reason *" value={reason} onChangeText={onReason} multiline placeholder="Why is this fill being cancelled?"/><Text style={styles.sub}>It stays on record as Cancelled, and its kg returns to the batch.</Text><AppButton label="Cancel fill" tone="danger" busy={busy} disabled={!reason.trim()} onPress={onConfirm}/><AppButton label="Keep fill" tone="secondary" onPress={onClose}/></View>:null}
  </View>;
}

/** One batch's choices for the Record Fill form, oldest first, with what each has left. */
const batchChoices=(overview:BitumenOverview)=>overview.batches.filter(isOpenBatch).map(batch=>({id:batch.id,label:`${batch.batchNumber} · Invoice ${batch.invoiceNumber??'not recorded'}`,detail:`${batch.status==='in_use'?(overview.usingBatchId===batch.id?'Using now':'Oldest open batch'):'Waiting'} · ${formatKg(batch.remainingKg)} remaining`}));

export function emptyFillDraft(batchId=''):BitumenFillDraft{
  return {recordDate:localDateKey(new Date()),truckId:'',batchId,destinationType:'project',projectId:'',companySiteId:'',layerNote:'',kg:'',ticketNumber:'',notes:''};
}

/** The Record Fill form: Batch, Truck, Destination, Quantity and date, then Before you save. Over the limit, Save stays off and the field stays editable. */
export function RecordFillView({repository,overview,setup,startBatchId,busy,error,onSave,onRecordDelivery}:{repository:BitumenRepository;overview:BitumenOverview;setup:BitumenFillSetup;startBatchId:string;busy:boolean;error:string|null;onSave:(draft:BitumenFillDraft)=>void;onRecordDelivery:()=>void}){
  const options=batchChoices(overview),defaultId=overview.usingBatchId&&options.some(option=>option.id===overview.usingBatchId)?overview.usingBatchId:options[0]?.id??'';
  const[draft,setDraft]=useState<BitumenFillDraft>(()=>emptyFillDraft(startBatchId&&startBatchId!==defaultId?startBatchId:''));
  const[plan,setPlan]=useState<FillPlan|null>(null),[note,setNote]=useState<string|null>(null);
  const project=setup.projects.find(value=>value.id===draft.projectId&&draft.destinationType==='project');
  const sites=useMemo(()=>setup.companySites.map(site=>({id:site.id,name:site.name,isActive:true,createdAt:'',updatedAt:''})),[setup.companySites]);
  const set=(patch:Partial<BitumenFillDraft>)=>setDraft(current=>({...current,...patch}));

  useEffect(()=>{
    if(!draft.kg.trim()){setPlan(null);setNote(null);return;}
    let cancelled=false;
    const timer=setTimeout(()=>{repository.previewFill(draft).then(result=>{if(!cancelled){setPlan(result);setNote(null);}}).catch(cause=>{if(!cancelled){setPlan(null);setNote(cause instanceof Error?cause.message:'The preview is not available.');}});},250);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[repository,overview,draft.kg,draft.batchId,draft.recordDate]);// eslint-disable-line react-hooks/exhaustive-deps

  const over=plan?.issue==='over_limit'?plan:null;
  const lines=plan?fillPreviewLines(plan):[];
  const destinationReady=draft.destinationType==='unassigned'||(draft.destinationType==='project'&&Boolean(draft.projectId))||(draft.destinationType==='company_site'&&Boolean(draft.companySiteId));
  const ready=Boolean(draft.truckId)&&Boolean(draft.kg.trim())&&destinationReady&&plan!=null&&plan.issue==null;
  const holds=over?Math.round((over.totalKg-over.overByKg)*1000)/1000:0;
  return <View style={styles.form}>
    <Text style={styles.helper}>Bitumen put into a truck from a batch. It is taken from the oldest batch first.</Text>
    {over?<View style={styles.alert} accessibilityRole="alert"><Text style={styles.alertTitle}>This fill is more than what is left</Text><Text style={styles.alertText}>The open batches hold {formatKg(holds)} in total. Lower the amount, or record the new delivery first.</Text></View>:null}
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <Step number={1} title="Batch">
      {options.length?<>
        <SearchableSelect label="Batch *" options={options} selectedId={draft.batchId||defaultId} onSelect={id=>set({batchId:id===defaultId?'':id})} placeholder="Select batch"/>
        <Text style={styles.hint}>{overview.usingBatchId?'The batch in use is selected. Pick another batch only if this fill should come from it.':'Pre-selected automatically. You can change it to another open batch.'}</Text>
      </>:<View style={styles.empty}><Text style={styles.emptyTitle}>No open batch</Text><Text style={styles.emptyBody}>No bitumen batch has bitumen left. Record a bitumen delivery first.</Text></View>}
    </Step>
    <Step number={2} title="Truck">
      <SearchableSelect label="Truck *" options={setup.trucks.map(truck=>({id:truck.id,label:truck.name,detail:truck.detail??'Saved truck profile'}))} selectedId={draft.truckId} onSelect={truckId=>set({truckId})} placeholder="Select truck"/>
    </Step>
    <Step number={3} title="Destination">
      <FuelDestinationFields wording={{label:'Where will it be used *',hints:{project:'Bitumen used on a construction project',company_site:'Bitumen used at a saved company location, such as the plant or yard',unassigned:'Where the bitumen went was not recorded'},siteHelp:'No active company sites are saved yet. Add one from Company Sites, then choose it here.'}}
        value={{destinationType:draft.destinationType,projectId:draft.projectId,companySiteId:draft.companySiteId}} onChange={next=>set(next)} projects={setup.projects.map(value=>({id:value.id,name:value.name,detail:value.detail}))} companySites={sites}/>
      <AppField label="Layer or use (optional)" value={draft.layerNote} onChangeText={layerNote=>set({layerNote})} placeholder="For example tack coat, prime coat"/>
    </Step>
    <Step number={4} title="Quantity and date">
      <View style={styles.pair}>
        <View style={styles.flex}><AppField label="Bitumen (kg) *" value={draft.kg} onChangeText={kg=>set({kg})} keyboardType="decimal-pad" placeholder="For example 7200"/></View>
        <View style={styles.flex}><DatePickerField label="Date *" value={draft.recordDate} onChange={recordDate=>set({recordDate})} minDate={project?.startDate??undefined} maxDate={project?.endDate??localDateKey(new Date())}/></View>
      </View>
      <Text style={styles.hint}>From the weighbridge ticket or the truck's gauge.</Text>
      <AppField label="Ticket no. (optional)" value={draft.ticketNumber} onChangeText={ticketNumber=>set({ticketNumber})} placeholder="Not recorded"/>
      <AppField label="Note (optional)" value={draft.notes} onChangeText={notes=>set({notes})} placeholder="Add a note" multiline/>
    </Step>
    {lines.length?<Preview lines={lines} tone={over?'neutral':'batch'}/>:null}
    {!lines.length&&plan?.issue&&plan.issue!=='over_limit'?<Feedback kind="warning">{issueText(plan)}</Feedback>:null}
    {!plan&&note?<Text style={styles.hint}>{note}</Text>:null}
    <AppButton label="Save Fill" busy={busy} disabled={!ready} onPress={()=>onSave(draft)}/>
    {over||!options.length?<AppButton label="Record bitumen delivery" tone="secondary" onPress={onRecordDelivery}/>:null}
  </View>;
}

const issueText=(plan:FillPlan)=>plan.issue?fillIssueMessages[plan.issue]:'';

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  row:{flexDirection:'row',gap:10},
  form:{gap:16},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  hint:{color:colors.muted,fontSize:12,lineHeight:17},
  sub:{color:colors.muted,fontSize:12,lineHeight:17},
  body:{color:colors.ink,fontSize:13,lineHeight:19},
  strong:{color:colors.ink,fontSize:14,fontWeight:'800'},
  kg:{color:colors.ink,fontSize:15,fontWeight:'900'},
  struck:{textDecorationLine:'line-through',color:colors.muted},
  link:{color:colors.navy,fontSize:12,fontWeight:'800'},
  pair:{flexDirection:'row',gap:10,alignItems:'flex-start'},
  empty:{gap:6,padding:14,borderRadius:radius.md,borderWidth:1,borderStyle:'dashed',borderColor:colors.line,backgroundColor:colors.cream},
  emptyTitle:{color:colors.ink,fontSize:14,fontWeight:'900'},
  emptyBody:{color:colors.muted,fontSize:13,lineHeight:19},
  alert:{backgroundColor:'#FBE9E7',borderWidth:1,borderColor:'#EBB5B0',borderRadius:radius.md,padding:14,gap:4},
  alertTitle:{color:colors.danger,fontSize:14,fontWeight:'900'},
  alertText:{color:colors.danger,fontSize:13,lineHeight:19},
  bar:{flexDirection:'row',height:8,borderRadius:999,backgroundColor:'#E8DED0',overflow:'hidden'},
  barFills:{backgroundColor:colors.brand},
  barAsphalt:{backgroundColor:colors.navy},
  figuresCard:{backgroundColor:colors.surface,borderRadius:radius.lg,padding:16,gap:10,borderWidth:1,borderColor:'#E8DED0'},
  figure:{flex:1,minWidth:0},
  figureLabel:{color:colors.muted,fontSize:10,fontWeight:'800',letterSpacing:.6},
  figureValue:{color:colors.ink,fontSize:15,fontWeight:'800'},
  figureStrong:{color:colors.brand,fontSize:20},
  legend:{flexDirection:'row',gap:14,flexWrap:'wrap'},
  legendItem:{color:colors.muted,fontSize:11,fontWeight:'700'},
  fact:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,paddingVertical:8,borderTopWidth:1,borderTopColor:colors.line},
  totalLine:{flexDirection:'row',justifyContent:'space-between',paddingVertical:10,borderTopWidth:1.5,borderTopColor:colors.navy},
  day:{borderWidth:1.5,borderColor:colors.line,borderRadius:radius.md,marginBottom:10,overflow:'hidden',backgroundColor:colors.surface},
  dayHead:{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:12,paddingVertical:10,backgroundColor:'#EAF0F7'},
  dayTitle:{color:colors.navy,fontSize:15,fontWeight:'800'},
  group:{padding:10,gap:8,borderTopWidth:1,borderTopColor:colors.line},
  groupTitle:{color:colors.muted,fontSize:11,fontWeight:'800',letterSpacing:.8},
  groupName:{color:ORANGE,fontSize:13,fontWeight:'900',letterSpacing:0},
  groupTotal:{flexDirection:'row',justifyContent:'space-between',paddingTop:6,borderTopWidth:1,borderTopColor:colors.line},
  fillCard:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm+2,padding:12,gap:4},
  fillCancelled:{backgroundColor:'#FBF3F1',borderColor:'#EBB5B0'},
  fillTop:{flexDirection:'row',alignItems:'flex-start',gap:10},
  cancelLink:{minHeight:44,justifyContent:'center'},
  cancelBox:{gap:8,marginTop:6},
  more:{minHeight:44,alignItems:'center',justifyContent:'center',borderWidth:1.5,borderStyle:'dashed',borderColor:colors.navy,borderRadius:radius.sm+2,marginTop:4},
  moreText:{color:colors.navy,fontWeight:'800',fontSize:13},
});
