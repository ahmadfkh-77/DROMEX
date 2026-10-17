import {choiceForRate,resolveVatRate,startingVatChoice} from '../../domain/accountVat';
import {VatChoiceControl} from '../components/AccountVatControl';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {StockRepository} from '../../data/repositories/StockRepository';
import {
  emptyStockBatch,emptyStockUse,formatStockQuantity,formatUsd,isOpenStockBatch,previewStockPrice,priceBasisLabels,stockPriceText,stockStatusLabels,
  type StockBatch,type StockBatchDraft,type StockItemOverview,type StockOverview,type StockPriceBasis,type StockSetup,type StockUseDraft,type StockUseRecord,
} from '../../domain/stock';
import {localDateKey} from '../../domain/fuel';
import {AppButton,AppCard,AppField,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {DatePickerField} from '../components/DatePickerField';
import {SearchableSelect} from '../components/SearchableSelect';
import {SegmentedChoice} from '../components/SegmentedChoice';
import {colors,radius} from '../theme';

/**
 * Stock. The list holds Bitumen and Fuel (each opens its own screen, unchanged) and every Catalog item the owner has added, with an Add
 * button. An item is added by recording its first batch. An item page shows its batches (oldest used first), Record use, and the uses
 * recorded; a batch can be edited or cancelled with a reason, and a use can be cancelled with a reason. Nothing recorded is rewritten.
 */
type Mode={kind:'list'}|{kind:'add';itemId:string}|{kind:'item';id:string}|{kind:'batch';id:string}|{kind:'edit';id:string};

const dayLabel=(iso:string)=>new Date(iso).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});

const draftFromBatch=(batch:StockBatch,universal:number):StockBatchDraft=>({
  ...emptyStockBatch,itemId:batch.itemId,recordDate:localDateKey(new Date(batch.arrivedAt)),supplierId:batch.supplierId??'',invoiceNumber:batch.invoiceNumber??'',quantity:String(batch.quantity),
  priceBasis:batch.priceBasis??'per_unit',price:batch.priceUsd==null?'':String(batch.priceUsd),vat:choiceForRate(batch.vatRatePercent,universal),notes:batch.notes??'',
});

export function StockScreen({repository,onBack,onOpenFuel,onOpenBitumen,onOpenCatalog,fuelBadge,bitumenBadge}:{repository:StockRepository;onBack:()=>void;onOpenFuel:()=>void;onOpenBitumen:()=>void;onOpenCatalog:()=>void;fuelBadge?:string|null;bitumenBadge?:string|null}){
  const[setup,setSetup]=useState<StockSetup|null>(null),[overview,setOverview]=useState<StockOverview|null>(null);
  const[mode,setMode]=useState<Mode>({kind:'list'});
  const[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{const[nextSetup,nextOverview]=await Promise.all([repository.getSetup(),repository.getOverview()]);setSetup(nextSetup);setOverview(nextOverview);},[repository]);
  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load Stock.'));},[refresh]);
  const run=async(action:()=>Promise<void>,success:string):Promise<boolean>=>{setBusy(true);setError(null);setMessage(null);try{await action();await refresh();setMessage(success);return true;}catch(cause){setError(cause instanceof Error?cause.message:'That could not be saved.');return false;}finally{setBusy(false);}};
  const go=(next:Mode)=>{setError(null);setMessage(null);setMode(next);};

  if(!setup||!overview)return <AppPage><PageHeader eyebrow="Stock" title="Stock" onBack={onBack}/>{error?<Feedback kind="error">{error}</Feedback>:<Text style={styles.muted}>Loading stock…</Text>}</AppPage>;

  const item=mode.kind==='item'?overview.items.find(value=>value.itemId===mode.id):undefined;
  const batchItem=mode.kind==='batch'||mode.kind==='edit'?overview.items.find(value=>value.batches.some(batch=>batch.id===mode.id)):undefined;
  const batch=batchItem?.batches.find(value=>mode.kind!=='list'&&mode.kind!=='add'&&value.id===mode.id);

  if(mode.kind==='add'){
    const initial={...emptyStockBatch,itemId:mode.itemId};
    return <AppPage keyboard><PageHeader eyebrow="Stock" title="Add batch" onBack={()=>go(mode.itemId&&overview.items.some(value=>value.itemId===mode.itemId)?{kind:'item',id:mode.itemId}:{kind:'list'})}/>
      {error?<Feedback kind="error">{error}</Feedback>:null}
      <BatchForm setup={setup} initial={initial} busy={busy} submitLabel="Save batch" itemLocked={Boolean(mode.itemId&&overview.items.some(value=>value.itemId===mode.itemId))} onOpenCatalog={onOpenCatalog}
        onSubmit={draft=>{void run(async()=>{const saved=await repository.recordBatch(draft);setMode({kind:'item',id:saved.itemId});},'Batch saved.');}}/>
    </AppPage>;
  }

  if(mode.kind==='edit'&&batch&&batchItem){
    return <AppPage keyboard><PageHeader eyebrow={batchItem.itemName} title={`Edit ${batch.batchNumber}`} onBack={()=>go({kind:'batch',id:batch.id})}/>
      {error?<Feedback kind="error">{error}</Feedback>:null}
      <BatchForm setup={setup} initial={draftFromBatch(batch,setup.vatRatePercent)} busy={busy} submitLabel="Save changes" asksReason itemLocked unitSymbol={batchItem.unitSymbol} onOpenCatalog={onOpenCatalog}
        onSubmit={(draft,reason)=>{void run(async()=>{await repository.editBatch(batch.id,{...draft,reason:reason??''});setMode({kind:'batch',id:batch.id});},'Batch updated. The earlier values are kept in its history.');}}/>
    </AppPage>;
  }

  if(mode.kind==='batch'&&batch&&batchItem){
    return <BatchDetail item={batchItem} batch={batch} busy={busy} error={error} message={message} onBack={()=>go({kind:'item',id:batchItem.itemId})} onEdit={()=>go({kind:'edit',id:batch.id})}
      onCancel={reason=>void run(async()=>{await repository.cancelBatch(batch.id,reason);},'Batch cancelled. It stays on record and is not counted.')}/>;
  }

  if(mode.kind==='item'&&item){
    return <ItemPage item={item} busy={busy} error={error} message={message} onBack={()=>go({kind:'list'})} onAddBatch={()=>go({kind:'add',itemId:item.itemId})} onOpenBatch={id=>go({kind:'batch',id})}
      onUse={draft=>run(async()=>{await repository.recordUse(draft);},'Use recorded. The stock was taken from the oldest open batch first.')}
      onCancelUse={(groupId,reason)=>run(async()=>{await repository.cancelUse(groupId,reason);},'Use cancelled. The stock is back in its batches.')}/>;
  }

  return <AppPage><PageHeader eyebrow="Stock" title="Stock" onBack={onBack}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    <AppCard>
      <StockRow title="Bitumen" sub={bitumenBadge??'Batches in kg'} value={null} onPress={onOpenBitumen}/>
      <StockRow title="Fuel" sub={fuelBadge??'Diesel batches'} value={null} onPress={onOpenFuel}/>
      {overview.items.map(value=><StockRow key={value.itemId} title={value.itemName} sub={`${value.batches.filter(isOpenStockBatch).length} open batch${value.batches.filter(isOpenStockBatch).length===1?'':'es'} · inventory only`} value={formatStockQuantity(value.totalRemaining,value.unitSymbol)} onPress={()=>go({kind:'item',id:value.itemId})}/>)}
    </AppCard>
    {!overview.items.length?<EmptyState title="Nothing else in Stock yet" body="Press Add to bring in any item from your Catalog and record its batches."/>:null}
    <AppButton label="+ Add" onPress={()=>go({kind:'add',itemId:''})}/>
  </AppPage>;
}

function StockRow({title,sub,value,onPress}:{title:string;sub:string;value:string|null;onPress:()=>void}){
  return <TouchableOpacity style={styles.stockRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}, ${sub}${value?`, ${value} on hand`:''}`}>
    <View style={styles.flex}><Text style={styles.batchNumber}>{title}</Text><Text style={styles.sub}>{sub}</Text></View>
    {value?<Text style={[styles.badge,styles.badgeInUse]}>{value}</Text>:<Text style={styles.chevron} importantForAccessibility="no">›</Text>}
  </TouchableOpacity>;
}

function ItemPage({item,busy,error,message,onBack,onAddBatch,onOpenBatch,onUse,onCancelUse}:{item:StockItemOverview;busy:boolean;error:string|null;message:string|null;onBack:()=>void;onAddBatch:()=>void;onOpenBatch:(id:string)=>void;onUse:(draft:StockUseDraft)=>Promise<boolean>;onCancelUse:(groupId:string,reason:string)=>Promise<boolean>}){
  const[use,setUse]=useState<StockUseDraft>({...emptyStockUse,itemId:item.itemId});
  const open=item.batches.filter(isOpenStockBatch),others=item.batches.filter(value=>!isOpenStockBatch(value)).reverse();
  const[cancelling,setCancelling]=useState<string|null>(null),[reason,setReason]=useState('');
  return <AppPage keyboard><PageHeader eyebrow="Stock" title={item.itemName} onBack={onBack}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    <View style={styles.tank} accessibilityRole="summary"><Text style={styles.tankLabel}>ON HAND</Text><Text style={styles.tankValue}>{formatStockQuantity(item.totalRemaining,item.unitSymbol)}</Text><Text style={styles.tankSub}>{open.length} open batch{open.length===1?'':'es'} · inventory only</Text></View>
    <AppButton label="Add batch" onPress={onAddBatch}/>
    <AppCard title="Record use" hint="Taken from the oldest open batch first, then the next one.">
      <AppField label={`Amount used (${item.unitSymbol}) *`} value={use.quantity} onChangeText={quantity=>setUse(current=>({...current,quantity}))} keyboardType="decimal-pad"/>
      <DatePickerField label="Date *" value={use.usedOn} onChange={usedOn=>setUse(current=>({...current,usedOn}))} maxDate={localDateKey(new Date())}/>
      <AppField label="Note (optional)" value={use.note} onChangeText={note=>setUse(current=>({...current,note}))} multiline/>
      <AppButton label="Save use" busy={busy} disabled={!use.quantity.trim()} onPress={()=>{void onUse(use).then(done=>{if(done)setUse(current=>({...current,quantity:'',note:''}));});}}/>
    </AppCard>
    {open.length?open.map(value=><BatchCard key={value.id} batch={value} unit={item.unitSymbol} onOpen={()=>onOpenBatch(value.id)}/>):<EmptyState title="No open batch" body="Add a batch to put stock on hand."/>}
    {others.length?<AppCard title="Closed and cancelled batches" hint="Kept on record; cancelled batches are never counted.">
      {others.map(value=><TouchableOpacity key={value.id} style={styles.closedRow} onPress={()=>onOpenBatch(value.id)} accessibilityRole="button" accessibilityLabel={`${value.batchNumber}, ${stockStatusLabels[value.status]}`}>
        <View style={styles.flex}><Text style={styles.batchNumber}>{value.batchNumber}</Text><Text style={styles.sub}>{value.supplierName??'No supplier'} · {dayLabel(value.arrivedAt)}</Text></View>
        <View style={styles.closedSide}><Text style={[styles.badge,value.status==='cancelled'&&styles.badgeCancelled]}>{stockStatusLabels[value.status]}</Text><Text style={styles.sub}>{formatStockQuantity(value.quantity,item.unitSymbol)}</Text></View>
      </TouchableOpacity>)}
    </AppCard>:null}
    <AppCard title="Uses recorded" hint="Cancelling a use puts the stock back and keeps the record.">
      {item.uses.length?item.uses.map(record=><UseRow key={record.groupId} record={record} unit={item.unitSymbol} cancelling={cancelling===record.groupId} reason={reason} busy={busy}
        onAskCancel={()=>{setCancelling(record.groupId);setReason('');}} onKeep={()=>{setCancelling(null);setReason('');}} onReason={setReason}
        onConfirm={()=>{void onCancelUse(record.groupId,reason).then(done=>{if(done){setCancelling(null);setReason('');}});}}/>)
        :<Text style={styles.muted}>No use recorded yet.</Text>}
    </AppCard>
  </AppPage>;
}

function UseRow({record,unit,cancelling,reason,busy,onAskCancel,onKeep,onReason,onConfirm}:{record:StockUseRecord;unit:string;cancelling:boolean;reason:string;busy:boolean;onAskCancel:()=>void;onKeep:()=>void;onReason:(value:string)=>void;onConfirm:()=>void}){
  const cancelled=record.status==='Cancelled';
  return <View style={styles.useRow}>
    <View style={styles.useTop}><View style={styles.flex}><Text style={[styles.batchNumber,cancelled&&styles.struck]}>{formatStockQuantity(record.quantity,unit)}</Text><Text style={styles.sub}>{record.usedOn}{record.note?` · ${record.note}`:''}</Text></View>{cancelled?<Text style={[styles.badge,styles.badgeCancelled]}>Cancelled</Text>:null}</View>
    {record.lines.map(line=><Text key={line.batchId} style={styles.sub}>{line.batchNumber}: {formatStockQuantity(line.quantity,unit)}</Text>)}
    {cancelled?<Text style={styles.sub}>Reason: {record.cancellationReason}</Text>
      :cancelling?<View style={styles.cancelBox}><AppField label="Reason *" value={reason} onChangeText={onReason} multiline placeholder="Why is it being cancelled?"/><AppButton label="Cancel this use" tone="danger" busy={busy} disabled={!reason.trim()} onPress={onConfirm}/><AppButton label="Keep it" tone="secondary" onPress={onKeep}/></View>
      :<AppButton label="Cancel this use" tone="secondary" onPress={onAskCancel}/>}
  </View>;
}

function BatchCard({batch,unit,onOpen}:{batch:StockBatch;unit:string;onOpen:()=>void}){
  const used=batch.quantity>0?Math.min(1,Math.max(0,batch.usedQuantity/batch.quantity)):0;
  return <TouchableOpacity style={styles.batch} onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${batch.batchNumber}, ${stockStatusLabels[batch.status]}, ${formatStockQuantity(batch.remainingQuantity,unit)} remaining`}>
    <View style={styles.batchTop}>
      <View style={styles.flex}><Text style={styles.batchNumber}>{batch.batchNumber}</Text><Text style={styles.sub}>{batch.supplierName??'No supplier'} · {dayLabel(batch.arrivedAt)}</Text></View>
      <Text style={[styles.badge,batch.status==='in_use'&&styles.badgeInUse,batch.status==='waiting'&&styles.badgeWaiting]}>{stockStatusLabels[batch.status]}</Text>
    </View>
    <View style={styles.figures}><Figure label="Received" value={formatStockQuantity(batch.quantity,unit)}/><Figure label="Used" value={formatStockQuantity(batch.usedQuantity,unit)}/><Figure label="Remaining" value={formatStockQuantity(batch.remainingQuantity,unit)} strong/></View>
    <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.barFill,{width:`${Math.round(used*100)}%`}]}/></View>
  </TouchableOpacity>;
}

function BatchDetail({item,batch,busy,error,message,onBack,onEdit,onCancel}:{item:StockItemOverview;batch:StockBatch;busy:boolean;error:string|null;message:string|null;onBack:()=>void;onEdit:()=>void;onCancel:(reason:string)=>void}){
  const[cancelOpen,setCancelOpen]=useState(false),[reason,setReason]=useState('');
  const cancelled=batch.status==='cancelled',unit=item.unitSymbol;
  const uses=item.uses.flatMap(record=>record.lines.filter(line=>line.batchId===batch.id).map(line=>({record,line})));
  return <AppPage keyboard><PageHeader eyebrow={item.itemName} title={batch.batchNumber} onBack={onBack}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    <AppCard>
      <Text style={[styles.badge,batch.status==='in_use'&&styles.badgeInUse,batch.status==='waiting'&&styles.badgeWaiting,cancelled&&styles.badgeCancelled,{alignSelf:'flex-start'}]}>{stockStatusLabels[batch.status]}</Text>
      <Fact label="Supplier" value={batch.supplierName??'Not recorded'}/><Fact label="Arrived" value={dayLabel(batch.arrivedAt)}/><Fact label="Invoice" value={batch.invoiceNumber??'Not recorded'}/>
      <Fact label="Price" value={stockPriceText(batch,unit)}/>
      {batch.totalUsd!=null?<Fact label={batch.vatRatePercent?`Total (incl. VAT ${batch.vatRatePercent}%)`:'Total'} value={formatUsd(batch.totalUsd)}/>:null}
      {batch.notes?<Fact label="Notes" value={batch.notes}/>:null}
    </AppCard>
    <View style={styles.batch}><View style={styles.figures}><Figure label="Received" value={formatStockQuantity(batch.quantity,unit)}/><Figure label="Used" value={formatStockQuantity(batch.usedQuantity,unit)}/><Figure label="Remaining" value={formatStockQuantity(batch.remainingQuantity,unit)} strong/></View></View>
    <AppCard title="Where it went" hint="Every use that took stock from this batch.">
      {uses.length?uses.map(({record,line},index)=><View key={`${record.groupId}-${index}`} style={styles.fact}><Text style={[styles.sub,record.status==='Cancelled'&&styles.struck]}>{record.usedOn}{record.note?` · ${record.note}`:''}{record.status==='Cancelled'?' · cancelled':''}</Text><Text style={[styles.factValue,record.status==='Cancelled'&&styles.struck]}>−{formatStockQuantity(line.quantity,unit)}</Text></View>):<Text style={styles.muted}>Nothing used from this batch yet.</Text>}
    </AppCard>
    {cancelled?<AppCard title="Cancelled" hint={batch.cancelledAt?new Date(batch.cancelledAt).toLocaleString():undefined}><Text style={styles.body}>{batch.cancellationReason}</Text></AppCard>:<>
      <AppButton label="Edit batch" tone="secondary" onPress={onEdit}/>
      {cancelOpen?<AppCard title="Cancel this batch" hint="It stays on record as Cancelled and is never counted. A batch with recorded use cannot be cancelled."><AppField label="Reason *" value={reason} onChangeText={setReason} multiline placeholder="Why is it being cancelled?"/><AppButton label="Cancel batch" tone="danger" busy={busy} disabled={!reason.trim()} onPress={()=>onCancel(reason)}/><AppButton label="Keep batch" tone="secondary" onPress={()=>{setCancelOpen(false);setReason('');}}/></AppCard>
        :<AppButton label="Cancel batch" tone="danger" onPress={()=>setCancelOpen(true)}/>}
    </>}
    {batch.correctionHistory.length?<AppCard title="Correction history">{batch.correctionHistory.map((entry,index)=><View key={`${entry.at}-${index}`} style={styles.history}><Text style={styles.sub}>{new Date(entry.at).toLocaleString()} · {entry.reason}</Text>{entry.changes.map(change=><Text key={change.field} style={styles.body}>{change.field}: {change.before} → {change.after}</Text>)}</View>)}</AppCard>:null}
  </AppPage>;
}

function BatchForm({setup,initial,busy,submitLabel,asksReason=false,itemLocked=false,unitSymbol,onOpenCatalog,onSubmit}:{setup:StockSetup;initial:StockBatchDraft;busy:boolean;submitLabel:string;asksReason?:boolean;itemLocked?:boolean;unitSymbol?:string;onOpenCatalog:()=>void;onSubmit:(draft:StockBatchDraft,reason?:string)=>void}){
  const[draft,setDraft]=useState<StockBatchDraft>(initial),[reason,setReason]=useState('');
  const set=<K extends keyof StockBatchDraft>(key:K,value:StockBatchDraft[K])=>setDraft(current=>({...current,[key]:value}));
  const chosen=setup.catalogItems.find(value=>value.id===draft.itemId);
  const needsUnit=!itemLocked&&Boolean(chosen)&&!chosen!.inStock&&!chosen!.unitSymbol;
  const unit=unitSymbol??(chosen?.unitSymbol??setup.units.find(value=>value.id===draft.unitId)?.symbol??'');
  const preview=useMemo(()=>previewStockPrice(draft,setup.vatRatePercent),[draft,setup.vatRatePercent]);
  const vatRate=resolveVatRate(draft.vat,setup.vatRatePercent);
  const basisUnit=draft.priceBasis==='per_unit'?`per ${unit||'unit'}`:'for the whole batch';
  return <>
    <AppCard title="1 · Item">
      {itemLocked?<Text style={styles.body}>{chosen?.name??'Item'}{unit?` · counted in ${unit}`:''}</Text>:<>
        <SearchableSelect label="Item (from your Catalog) *" options={setup.catalogItems.map(value=>({id:value.id,label:value.name,detail:`${value.categoryName}${value.unitSymbol?` · ${value.unitSymbol}`:''}${value.inStock?' · in Stock':''}`}))} selectedId={draft.itemId} onSelect={id=>set('itemId',id)} placeholder="Select item"/>
        {needsUnit?<SearchableSelect label="Counted in *" options={setup.units.map(value=>({id:value.id,label:value.name,detail:value.symbol}))} selectedId={draft.unitId} onSelect={id=>set('unitId',id)} placeholder="Select unit"/>:null}
        {chosen&&!chosen.inStock&&chosen.unitSymbol?<Text style={styles.sub}>Counted in {chosen.unitSymbol}. The first batch adds this item to Stock.</Text>:null}
        <Text style={styles.sub}>Not in the list? Add it in the Catalog first, then come back.</Text>
        <AppButton label="Open Catalog" tone="secondary" onPress={onOpenCatalog}/>
      </>}
    </AppCard>
    <AppCard title="2 · Delivery">
      <SearchableSelect label="Supplier (optional)" options={setup.suppliers.map(value=>({id:value.id,label:value.name}))} selectedId={draft.supplierId} onSelect={id=>setDraft(current=>({...current,supplierId:id,vat:asksReason?current.vat:startingVatChoice(setup.suppliers.find(value=>value.id===id)?.vat)}))} placeholder="Select supplier" allowClear/>
      <DatePickerField label="Date *" value={draft.recordDate} onChange={value=>set('recordDate',value)} maxDate={localDateKey(new Date())}/>
      <AppField label={`Quantity${unit?` (${unit})`:''} *`} value={draft.quantity} onChangeText={value=>set('quantity',value)} keyboardType="decimal-pad"/>
      <AppField label="Invoice no. (optional)" value={draft.invoiceNumber} onChangeText={value=>set('invoiceNumber',value)}/>
    </AppCard>
    <AppCard title="3 · Price (optional)" hint="Left empty, it is saved as Unpriced, never as zero. VAT is added only if you choose it.">
      <SegmentedChoice label="Price basis" options={(['per_unit','whole'] as StockPriceBasis[]).map(id=>({id,label:priceBasisLabels[id]}))} selectedId={draft.priceBasis} onSelect={id=>set('priceBasis',id)}/>
      <AppField label={`Price ${basisUnit} (USD)`} value={draft.price} onChangeText={value=>set('price',value)} keyboardType="decimal-pad"/>
      <VatChoiceControl value={draft.vat} onChange={vat=>set('vat',vat)} universalRatePercent={setup.vatRatePercent} hint="No VAT is added unless you choose it."/>
      {preview&&preview.totalUsd!=null?<View style={styles.totals}><Fact label="Subtotal" value={formatUsd(preview.subtotalUsd??0)}/>{vatRate>0?<Fact label={`VAT ${vatRate}%`} value={formatUsd(preview.vatAmountUsd??0)}/>:null}<Fact label="Total" value={formatUsd(preview.totalUsd)}/></View>:null}
      <AppField label="Notes (optional)" value={draft.notes} onChangeText={value=>set('notes',value)} multiline/>
    </AppCard>
    {asksReason?<AppCard title="Reason" hint="Needed when the quantity or the date changes. The old values are kept in the batch's history."><AppField label="Reason" value={reason} onChangeText={setReason} multiline/></AppCard>:null}
    <AppButton label={submitLabel} busy={busy} onPress={()=>onSubmit(draft,asksReason?reason:undefined)}/>
  </>;
}

function Figure({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <View style={styles.figure}><Text style={styles.figureLabel}>{label.toUpperCase()}</Text><Text style={[styles.figureValue,strong&&styles.figureStrong]}>{value}</Text></View>;
}
function Fact({label,value}:{label:string;value:string}){return <View style={styles.fact}><Text style={styles.sub}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  muted:{color:colors.muted,fontSize:13},
  body:{color:colors.ink,fontSize:14,lineHeight:20},
  sub:{color:colors.muted,fontSize:12,lineHeight:17},
  struck:{textDecorationLine:'line-through'},
  chevron:{color:colors.navy,fontSize:22,fontWeight:'700'},
  tank:{backgroundColor:colors.navy,borderRadius:radius.lg,padding:16,gap:2},
  tankLabel:{color:'#D5E4EF',fontSize:11,fontWeight:'900',letterSpacing:1.1},
  tankValue:{color:colors.cream,fontSize:28,fontWeight:'900'},
  tankSub:{color:'#D5E4EF',fontSize:12},
  stockRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:12,borderTopWidth:1,borderTopColor:colors.line,minHeight:56},
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
  useRow:{gap:6,paddingVertical:10,borderTopWidth:1,borderTopColor:colors.line},
  useTop:{flexDirection:'row',alignItems:'flex-start',gap:10},
  cancelBox:{gap:8},
});
