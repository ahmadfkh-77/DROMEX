import {useCallback,useEffect,useMemo,useState} from 'react';
import {Alert,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {BitumenRepository} from '../../data/repositories/BitumenRepository';
import {
  bitumenStatusLabels,emptyBitumenDelivery,formatKg,formatTons,formatUsd,isOpenBatch,previewBitumenPrice,priceBasisLabels,priceText,
  type BitumenBatch,type BitumenDeliveryDraft,type BitumenOverview,type BitumenPriceBasis,type BitumenSetup,
} from '../../domain/bitumen';
import {localDateKey} from '../../domain/fuel';
import {buildBitumenBatchReport} from '../../domain/bitumenBatchReport';
import {exportAndShareBitumenBatchReport} from '../../services/documentExport';
import {AppButton,AppCard,AppField,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {useExportHeader} from '../components/useExportHeader';
import {DatePickerField} from '../components/DatePickerField';
import {SearchableSelect} from '../components/SearchableSelect';
import {SegmentedChoice} from '../components/SegmentedChoice';
import {colors,radius} from '../theme';

/**
 * Bitumen Tracking (Phase B). Batches of bitumen in kg: the list with the batch in use, Record delivery, a batch's detail with
 * Edit and Cancel (both with a reason), and "Use this batch first". Nothing is used from a batch yet; the asphalt rule that
 * estimates use comes in a later phase. Every recorded fact is kept: a correction keeps its history and a cancelled batch stays visible.
 */
type Mode={kind:'list'}|{kind:'record'}|{kind:'detail';id:string}|{kind:'edit';id:string};

const draftFromBatch=(batch:BitumenBatch):BitumenDeliveryDraft=>({
  recordDate:localDateKey(new Date(batch.arrivedAt)),supplierId:batch.supplierId??'',invoiceNumber:batch.invoiceNumber??'',ticketNumber:batch.ticketNumber??'',gradeId:batch.gradeId??'',
  kg:String(batch.deliveredKg),priceBasis:batch.priceBasis??'per_ton',price:batch.priceUsd==null?'':String(batch.priceUsd),vat:batch.vatRatePercent!=null&&batch.vatRatePercent>0,notes:batch.notes??'',
});

export function BitumenScreen({repository,onBack,initialBatchId}:{repository:BitumenRepository;onBack:()=>void;initialBatchId?:string|null}){
  const[setup,setSetup]=useState<BitumenSetup|null>(null),[overview,setOverview]=useState<BitumenOverview|null>(null);
  const[mode,setMode]=useState<Mode>(initialBatchId?{kind:'detail',id:initialBatchId}:{kind:'list'});
  const[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{const[nextSetup,nextOverview]=await Promise.all([repository.getSetup(),repository.getOverview()]);setSetup(nextSetup);setOverview(nextOverview);},[repository]);
  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load bitumen tracking.'));},[refresh]);
  const run=async(action:()=>Promise<void>,success:string)=>{setBusy(true);setError(null);setMessage(null);try{await action();await refresh();setMessage(success);}catch(cause){setError(cause instanceof Error?cause.message:'That could not be saved.');}finally{setBusy(false);}};

  if(!setup||!overview)return <AppPage><PageHeader eyebrow="Bitumen" title="Bitumen Tracking" onBack={onBack}/>{error?<Feedback kind="error">{error}</Feedback>:<Text style={styles.muted}>Loading bitumen batches…</Text>}</AppPage>;

  const batch=mode.kind==='detail'||mode.kind==='edit'?overview.batches.find(value=>value.id===mode.id):undefined;
  const back=()=>{setError(null);setMode({kind:'list'});};

  if(mode.kind==='record'){
    return <AppPage keyboard><PageHeader eyebrow="Bitumen" title="Record delivery" onBack={back}/>
      {error?<Feedback kind="error">{error}</Feedback>:null}
      <DeliveryForm setup={setup} initial={emptyBitumenDelivery} busy={busy} submitLabel="Save delivery" onAddGrade={async name=>{const grade=await repository.addGrade(name);await refresh();return grade;}}
        onSubmit={draft=>{void run(async()=>{const saved=await repository.recordDelivery(draft);setMode({kind:'detail',id:saved.id});},'Delivery saved as a new bitumen batch.');}}/>
    </AppPage>;
  }

  if(mode.kind==='edit'&&batch){
    return <AppPage keyboard><PageHeader eyebrow="Bitumen" title={`Edit ${batch.batchNumber}`} onBack={()=>setMode({kind:'detail',id:batch.id})}/>
      {error?<Feedback kind="error">{error}</Feedback>:null}
      <DeliveryForm setup={setup} initial={draftFromBatch(batch)} busy={busy} submitLabel="Save changes" asksReason onAddGrade={async name=>{const grade=await repository.addGrade(name);await refresh();return grade;}}
        onSubmit={(draft,reason)=>{void run(async()=>{await repository.editBatch(batch.id,{...draft,reason:reason??''});setMode({kind:'detail',id:batch.id});},'Batch updated. The earlier values are kept in its history.');}}/>
    </AppPage>;
  }

  if(mode.kind==='detail'&&batch){
    return <BatchDetail repository={repository} batch={batch} overview={overview} busy={busy} error={error} message={message} onBack={back} onEdit={()=>{setError(null);setMessage(null);setMode({kind:'edit',id:batch.id});}}
      onUseFirst={()=>Alert.alert(`Use ${batch.batchNumber} first?`,`New bitumen use will be taken from this batch first.\n\nFigures already recorded do not change. You can switch back at any time.`,[{text:'Cancel',style:'cancel'},{text:`Yes, use ${batch.batchNumber} first`,onPress:()=>void run(async()=>{await repository.setUsingBatch(batch.id);},'This batch is now the one in use.')}])}
      onGoBackToOldest={()=>void run(async()=>{await repository.setUsingBatch(null);},'The oldest open batch is in use again.')}
      onCancel={reason=>void run(async()=>{await repository.cancelBatch(batch.id,reason);},'Batch cancelled. It stays on record and is not counted.')}/>;
  }

  const open=overview.batches.filter(isOpenBatch),others=overview.batches.filter(value=>!isOpenBatch(value)).reverse();
  return <AppPage><PageHeader eyebrow="Bitumen" title="Bitumen batches" onBack={onBack}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    <View style={styles.tank} accessibilityRole="summary"><Text style={styles.tankLabel}>BITUMEN IN STORAGE</Text><Text style={styles.tankValue}>{formatKg(overview.totalRemainingKg)}</Text><Text style={styles.tankSub}>{open.length} open batch{open.length===1?'':'es'} · {formatTons(overview.totalRemainingKg)}</Text></View>
    <AppButton label="Record bitumen delivery" onPress={()=>{setError(null);setMessage(null);setMode({kind:'record'});}}/>
    {open.length?open.map(value=><BatchCard key={value.id} batch={value} chosen={overview.usingBatchId===value.id} busy={busy} onOpen={()=>{setError(null);setMessage(null);setMode({kind:'detail',id:value.id});}}
      onUseFirst={()=>Alert.alert(`Use ${value.batchNumber} first?`,`New bitumen use will be taken from this batch first.\n\nFigures already recorded do not change. You can switch back at any time.`,[{text:'Cancel',style:'cancel'},{text:`Yes, use ${value.batchNumber} first`,onPress:()=>void run(async()=>{await repository.setUsingBatch(value.id);},'This batch is now the one in use.')}])}/>)
      :<EmptyState title="No open bitumen batch" body="Record a bitumen delivery to start one."/>}
    {others.length?<AppCard title="Closed and cancelled batches" hint="Kept on record; cancelled batches are never counted.">
      {others.map(value=><TouchableOpacity key={value.id} style={styles.closedRow} onPress={()=>setMode({kind:'detail',id:value.id})} accessibilityRole="button" accessibilityLabel={`${value.batchNumber}, ${bitumenStatusLabels[value.status]}`}>
        <View style={styles.flex}><Text style={styles.batchNumber}>{value.batchNumber}</Text><Text style={styles.sub}>{value.supplierName??'No supplier'} · {value.gradeName}</Text></View>
        <View style={styles.closedSide}><Text style={[styles.badge,value.status==='cancelled'&&styles.badgeCancelled]}>{bitumenStatusLabels[value.status]}</Text><Text style={styles.sub}>{formatKg(value.deliveredKg)}</Text></View>
      </TouchableOpacity>)}
    </AppCard>:null}
  </AppPage>;
}

function BatchCard({batch,chosen,busy,onOpen,onUseFirst}:{batch:BitumenBatch;chosen:boolean;busy:boolean;onOpen:()=>void;onUseFirst:()=>void}){
  const used=batch.deliveredKg>0?Math.min(1,Math.max(0,batch.usedKg/batch.deliveredKg)):0;
  return <TouchableOpacity style={styles.batch} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${batch.batchNumber}, ${bitumenStatusLabels[batch.status]}, ${formatKg(batch.remainingKg)} remaining`}>
    <View style={styles.batchTop}>
      <View style={styles.flex}><Text style={styles.batchNumber}>{batch.batchNumber}</Text><Text style={styles.sub}>{batch.supplierName??'No supplier'} · {batch.gradeName} · {new Date(batch.arrivedAt).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</Text></View>
      <Text style={[styles.badge,batch.status==='in_use'&&styles.badgeInUse,batch.status==='waiting'&&styles.badgeWaiting]}>{chosen&&batch.status==='in_use'?'Open · Using now':bitumenStatusLabels[batch.status]}</Text>
    </View>
    <View style={styles.figures}><Figure label="Delivered" value={formatKg(batch.deliveredKg)}/><Figure label="Used" value={formatKg(batch.usedKg)}/><Figure label="Remaining" value={formatKg(batch.remainingKg)} strong/></View>
    <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.barFill,{width:`${Math.round(used*100)}%`}]}/></View>
    {batch.status==='waiting'?<AppButton label="Use this batch first" busy={busy} onPress={onUseFirst}/>:null}
  </TouchableOpacity>;
}

function Figure({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <View style={styles.figure}><Text style={styles.figureLabel}>{label.toUpperCase()}</Text><Text style={[styles.figureValue,strong&&styles.figureStrong]}>{value}</Text></View>;
}

function Fact({label,value}:{label:string;value:string}){return <View style={styles.fact}><Text style={styles.sub}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;}

function BatchDetail({repository,batch,overview,busy,error,message,onBack,onEdit,onUseFirst,onGoBackToOldest,onCancel}:{repository:BitumenRepository;batch:BitumenBatch;overview:BitumenOverview;busy:boolean;error:string|null;message:string|null;onBack:()=>void;onEdit:()=>void;onUseFirst:()=>void;onGoBackToOldest:()=>void;onCancel:(reason:string)=>void}){
  const[cancelOpen,setCancelOpen]=useState(false),[reason,setReason]=useState('');
  const chosen=overview.usingBatchId===batch.id,cancelled=batch.status==='cancelled';
  return <AppPage keyboard><PageHeader eyebrow="Bitumen" title={batch.batchNumber} onBack={onBack}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    <AppCard>
      <Text style={[styles.badge,batch.status==='in_use'&&styles.badgeInUse,batch.status==='waiting'&&styles.badgeWaiting,cancelled&&styles.badgeCancelled,{alignSelf:'flex-start'}]}>{chosen&&batch.status==='in_use'?'Open · Using now':bitumenStatusLabels[batch.status]}</Text>
      <Fact label="Supplier" value={batch.supplierName??'Not recorded'}/><Fact label="Grade" value={batch.gradeName}/>
      <Fact label="Arrived" value={new Date(batch.arrivedAt).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}/>
      <Fact label="Invoice" value={batch.invoiceNumber??'Not recorded'}/>{batch.ticketNumber?<Fact label="Weighbridge ticket" value={batch.ticketNumber}/>:null}
      <Fact label="Price" value={priceText(batch)}/>
      {batch.totalUsd!=null?<Fact label={batch.vatRatePercent?`Total (incl. VAT ${batch.vatRatePercent}%)`:'Total'} value={formatUsd(batch.totalUsd)}/>:null}
      {batch.notes?<Fact label="Notes" value={batch.notes}/>:null}
    </AppCard>
    <View style={styles.batch}><View style={styles.figures}><Figure label="Delivered" value={formatKg(batch.deliveredKg)}/><Figure label="Used" value={formatKg(batch.usedKg)}/><Figure label="Remaining" value={formatKg(batch.remainingKg)} strong/></View><Text style={styles.sub}>{formatTons(batch.deliveredKg)} delivered. Use from asphalt loads is added in a later step, so nothing has been used yet.</Text></View>
    {cancelled?<AppCard title="Cancelled" hint={batch.cancelledAt?new Date(batch.cancelledAt).toLocaleString():undefined}><Text style={styles.body}>{batch.cancellationReason}</Text></AppCard>:<>
      {chosen?<AppButton label="Go back to oldest first" tone="secondary" busy={busy} onPress={onGoBackToOldest}/>:batch.status==='waiting'?<AppButton label="Use this batch first" busy={busy} onPress={onUseFirst}/>:null}
      <AppButton label="Edit batch" tone="secondary" onPress={onEdit}/>
      {cancelOpen?<AppCard title="Cancel this batch" hint="It stays on record as Cancelled and is never counted."><AppField label="Reason *" value={reason} onChangeText={setReason} multiline placeholder="Why is it being cancelled?"/><AppButton label="Cancel batch" tone="danger" busy={busy} disabled={!reason.trim()} onPress={()=>onCancel(reason)}/><AppButton label="Keep batch" tone="secondary" onPress={()=>{setCancelOpen(false);setReason('');}}/></AppCard>
        :<AppButton label="Cancel batch" tone="danger" onPress={()=>setCancelOpen(true)}/>}
    </>}
    <ExportPanel repository={repository} batch={batch}/>
    {batch.correctionHistory.length?<AppCard title="Correction history">{batch.correctionHistory.map((entry,index)=><View key={`${entry.at}-${index}`} style={styles.history}><Text style={styles.sub}>{new Date(entry.at).toLocaleString()} · {entry.reason}</Text>{entry.changes.map(change=><Text key={change.field} style={styles.body}>{change.field}: {change.before} → {change.after}</Text>)}</View>)}</AppCard>:null}
  </AppPage>;
}

/** Export PDF for one batch: without prices (the default) or with prices, under the chosen Header company. */
function ExportPanel({repository,batch}:{repository:BitumenRepository;batch:BitumenBatch}){
  const[prices,setPrices]=useState<'without'|'with'>('without'),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[done,setDone]=useState<string|null>(null);
  const{picker,resolve}=useExportHeader(null);
  const run=async()=>{
    setBusy(true);setError(null);setDone(null);
    try{
      const[chosen,identity]=await Promise.all([resolve(),repository.getCompanyIdentity()]);
      const company=chosen?{name:chosen.list.companyName,logoUri:chosen.list.logoUri,contactLine:chosen.list.contactLine}:identity;
      await exportAndShareBitumenBatchReport(buildBitumenBatchReport(batch,{includePrices:prices==='with'}),company);
      setDone('Bitumen Batch Report ready to share.');
    }catch(cause){setError(cause instanceof Error?cause.message:'The PDF could not be created.');}
    finally{setBusy(false);}
  };
  return <AppCard title="Export PDF" hint="A report of this batch: figures, delivery detail and history.">
    <SegmentedChoice label="Prices in the PDF" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]} selectedId={prices} onSelect={setPrices}/>
    {picker}
    {error?<Feedback kind="error">{error}</Feedback>:null}{done?<Feedback kind="success">{done}</Feedback>:null}
    <AppButton label="Export PDF" tone="secondary" busy={busy} onPress={()=>void run()}/>
  </AppCard>;
}

function DeliveryForm({setup,initial,busy,submitLabel,asksReason=false,onSubmit,onAddGrade}:{setup:BitumenSetup;initial:BitumenDeliveryDraft;busy:boolean;submitLabel:string;asksReason?:boolean;onSubmit:(draft:BitumenDeliveryDraft,reason?:string)=>void;onAddGrade:(name:string)=>Promise<{id:string;name:string}>}){
  const[draft,setDraft]=useState<BitumenDeliveryDraft>(initial),[reason,setReason]=useState(''),[newGrade,setNewGrade]=useState(''),[gradeError,setGradeError]=useState<string|null>(null);
  const set=<K extends keyof BitumenDeliveryDraft>(key:K,value:BitumenDeliveryDraft[K])=>setDraft(current=>({...current,[key]:value}));
  const preview=useMemo(()=>previewBitumenPrice(draft,setup.vatRatePercent),[draft,setup.vatRatePercent]);
  const kg=Number(draft.kg.replace(',','.'));
  const basisUnit=draft.priceBasis==='per_ton'?'per ton':draft.priceBasis==='per_kg'?'per kg':'for the whole batch';
  return <>
    <AppCard title="1 · Supplier">
      <SearchableSelect label="Supplier *" options={setup.suppliers.map(value=>({id:value.id,label:value.name}))} selectedId={draft.supplierId} onSelect={id=>set('supplierId',id)} placeholder="Select supplier"/>
      <DatePickerField label="Date *" value={draft.recordDate} onChange={value=>set('recordDate',value)} maxDate={localDateKey(new Date())}/>
      <AppField label="Invoice no. (optional)" value={draft.invoiceNumber} onChangeText={value=>set('invoiceNumber',value)}/>
      <AppField label="Weighbridge ticket (optional)" value={draft.ticketNumber} onChangeText={value=>set('ticketNumber',value)}/>
    </AppCard>
    <AppCard title="2 · Bitumen">
      <SearchableSelect label="Grade *" options={setup.grades.filter(value=>value.isActive||value.id===draft.gradeId).map(value=>({id:value.id,label:value.name,detail:value.isActive?undefined:'Inactive'}))} selectedId={draft.gradeId} onSelect={id=>set('gradeId',id)} placeholder="Select grade"/>
      <AppField label="Add a grade (optional)" value={newGrade} onChangeText={setNewGrade} placeholder="For example MC-250"/>
      {newGrade.trim()?<AppButton label="Add this grade" tone="secondary" onPress={()=>{setGradeError(null);onAddGrade(newGrade).then(grade=>{set('gradeId',grade.id);setNewGrade('');}).catch(cause=>setGradeError(cause instanceof Error?cause.message:'The grade could not be added.'));}}/>:null}
      {gradeError?<Feedback kind="error">{gradeError}</Feedback>:null}
      <AppField label="Delivered quantity (kg) *" value={draft.kg} onChangeText={value=>set('kg',value)} keyboardType="decimal-pad" placeholder="For example 8000"/>
      {Number.isFinite(kg)&&kg>0?<Text style={styles.sub}>= {formatTons(kg)}</Text>:null}
    </AppCard>
    <AppCard title="3 · Price (optional)" hint="Left empty, it is saved as Unpriced, never as zero.">
      <SegmentedChoice label="Price basis" options={(['per_ton','per_kg','whole'] as BitumenPriceBasis[]).map(id=>({id,label:priceBasisLabels[id]}))} selectedId={draft.priceBasis} onSelect={id=>set('priceBasis',id)}/>
      <AppField label={`Price ${basisUnit} (USD)`} value={draft.price} onChangeText={value=>set('price',value)} keyboardType="decimal-pad" placeholder="For example 610"/>
      <SegmentedChoice label="VAT" options={[{id:'no',label:'No VAT'},{id:'yes',label:`VAT ${setup.vatRatePercent}%`}]} selectedId={draft.vat?'yes':'no'} onSelect={id=>set('vat',id==='yes')}/>
      {preview&&preview.totalUsd!=null?<View style={styles.totals}><Fact label="Subtotal" value={formatUsd(preview.subtotalUsd??0)}/>{draft.vat?<Fact label={`VAT ${setup.vatRatePercent}%`} value={formatUsd(preview.vatAmountUsd??0)}/>:null}<Fact label="Total" value={formatUsd(preview.totalUsd)}/></View>:null}
      <AppField label="Notes (optional)" value={draft.notes} onChangeText={value=>set('notes',value)} multiline/>
    </AppCard>
    {asksReason?<AppCard title="Reason" hint="Needed when the quantity or the date changes. The old values are kept in the batch's history."><AppField label="Reason" value={reason} onChangeText={setReason} multiline/></AppCard>:null}
    <AppButton label={submitLabel} busy={busy} onPress={()=>onSubmit(draft,asksReason?reason:undefined)}/>
  </>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  muted:{color:colors.muted,fontSize:13},
  body:{color:colors.ink,fontSize:14,lineHeight:20},
  sub:{color:colors.muted,fontSize:12,lineHeight:17},
  tank:{backgroundColor:colors.navy,borderRadius:radius.lg,padding:16,gap:2},
  tankLabel:{color:'#D5E4EF',fontSize:11,fontWeight:'900',letterSpacing:1.1},
  tankValue:{color:colors.cream,fontSize:28,fontWeight:'900'},
  tankSub:{color:'#D5E4EF',fontSize:12},
  batch:{backgroundColor:colors.surface,borderRadius:radius.lg,padding:16,gap:10,borderWidth:1,borderColor:'#E8DED0'},
  batchTop:{flexDirection:'row',alignItems:'flex-start',gap:10},
  batchNumber:{color:colors.navy,fontSize:16,fontWeight:'900'},
  badge:{color:colors.navy,fontSize:11,fontWeight:'800',borderRadius:999,borderWidth:1,borderColor:'#C7D3E2',backgroundColor:'#EEF2F7',paddingHorizontal:9,paddingVertical:3,overflow:'hidden'},
  badgeInUse:{color:colors.success,borderColor:'#9FD2B3',backgroundColor:'#E6F3EC'},
  badgeWaiting:{color:colors.warning,borderColor:'#F1CF83',backgroundColor:'#FFF4DC'},
  badgeCancelled:{color:colors.danger,borderColor:'#EBB5B0',backgroundColor:'#FBE9E7'},
  figures:{flexDirection:'row',gap:8},
  figure:{flex:1,minWidth:0},
  figureLabel:{color:colors.muted,fontSize:10,fontWeight:'800',letterSpacing:.6},
  figureValue:{color:colors.ink,fontSize:14,fontWeight:'800'},
  figureStrong:{color:colors.brand,fontSize:15},
  bar:{height:8,borderRadius:999,backgroundColor:'#E8DED0',overflow:'hidden'},
  barFill:{height:'100%',backgroundColor:colors.brand},
  closedRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,borderTopWidth:1,borderTopColor:colors.line},
  closedSide:{alignItems:'flex-end',gap:4},
  fact:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:8,borderTopWidth:1,borderTopColor:colors.line},
  factValue:{color:colors.ink,fontSize:14,fontWeight:'700',flexShrink:1,textAlign:'right'},
  totals:{marginTop:4},
  history:{gap:2,paddingVertical:8,borderTopWidth:1,borderTopColor:colors.line},
});
