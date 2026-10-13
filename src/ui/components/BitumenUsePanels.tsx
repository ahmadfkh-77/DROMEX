import {useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {BitumenRepository} from '../../data/repositories/BitumenRepository';
import {bitumenStatusLabels,formatKg,formatTons,isOpenBatch,type BitumenBatch,type BitumenOverview} from '../../domain/bitumen';
import {adjustmentFor,DEFAULT_RULE,rulePercent,useLinesForBatch,type AttentionItem,type BatchLoadUse,type BitumenRule,type BitumenUseSetup} from '../../domain/bitumenUse';
import {fuelDayLabel} from '../../domain/fuelBatchViews';
import {localDateKey} from '../../domain/fuel';
import {AppButton,AppCard,AppField,Feedback} from './AppPrimitives';
import {DatePickerField} from './DatePickerField';
import {SearchableSelect} from './SearchableSelect';
import {SegmentedChoice} from './SegmentedChoice';
import {colors,radius} from '../theme';

/**
 * Phase C screens for bitumen use: what each asphalt load took from a batch (with Move), the history of every count and reversal,
 * the real-amount adjustment, the loads that need attention, and the rules for which items use bitumen. The use is an estimate from the
 * rule; the screens say so. Everything shown is read from saved rows, and every action keeps its history.
 */
const dayOf=(iso:string)=>fuelDayLabel(localDateKey(new Date(iso)));
const ruleText=(aggregateKg:number,bitumenKg:number)=>`${bitumenKg.toLocaleString('en-US',{maximumFractionDigits:3})} kg per ${(aggregateKg/1000).toLocaleString('en-US',{maximumFractionDigits:3})} t`;

export function UseFromLoadsCard({batch,overview,busy,onMove}:{batch:BitumenBatch;overview:BitumenOverview;busy:boolean;onMove:(line:BatchLoadUse)=>void}){
  const rows=overview.useRows??[];
  const lines=useMemo(()=>useLinesForBatch(rows,batch.id),[rows,batch.id]);
  const events=useMemo(()=>[...rows].filter(row=>row.batchId===batch.id).reverse(),[rows,batch.id]);
  const [showHistory,setShowHistory]=useState(false);
  if(!lines.length&&!events.length)return null;
  return <AppCard title="Use from asphalt loads" hint="An estimate from each load's quantity and its rule. Cancelled loads are reversed automatically.">
    {lines.map(line=><View key={line.loadId} style={styles.line}>
      <View style={styles.flex}>
        <Text style={styles.strong}>{line.loadNumber??'Load'} · {line.itemName}</Text>
        <Text style={styles.sub}>{dayOf(line.loadConfirmedAt)} · {formatTons(line.mixKg)} × {ruleText(line.ruleAggregateKg,line.ruleBitumenKg)}</Text>
        {isOpenBatch(batch)?<TouchableOpacity disabled={busy} onPress={()=>onMove(line)} accessibilityRole="button" accessibilityLabel={`Move ${line.loadNumber??'this load'} to another batch`}><Text style={styles.link}>Move to another batch ›</Text></TouchableOpacity>:null}
      </View>
      <Text style={styles.kg}>{formatKg(line.kg)}</Text>
    </View>)}
    {lines.length?<View style={styles.totalLine}><Text style={styles.strong}>Estimated use</Text><Text style={styles.strong}>{formatKg(lines.reduce((sum,line)=>sum+line.kg,0))}</Text></View>:<Text style={styles.sub}>No load is counted in this batch now.</Text>}
    {events.length?<TouchableOpacity onPress={()=>setShowHistory(value=>!value)} accessibilityRole="button" accessibilityState={{expanded:showHistory}}><Text style={styles.link}>{showHistory?'Hide history of use':`Show history of use (${events.length})`}</Text></TouchableOpacity>:null}
    {showHistory?events.map(row=><View key={row.id} style={styles.event}>
      <Text style={styles.sub}>{new Date(row.createdAt).toLocaleString()} · {row.loadNumber??'Load'} · {row.kind==='use'?'Counted':row.kind==='reversal'?(row.note??'Reversed'):row.kind==='moved'?'Moved here':(row.note??'Corrected')}</Text>
      <Text style={[styles.eventKg,row.kg<0&&styles.eventBack]}>{row.kg>0?'−':'+'}{Math.abs(row.kg).toLocaleString('en-US',{maximumFractionDigits:3})} kg from the batch</Text>
    </View>):null}
  </AppCard>;
}

export function MoveLoadCard({line,from,overview,busy,onConfirm,onClose}:{line:BatchLoadUse;from:BitumenBatch;overview:BitumenOverview;busy:boolean;onConfirm:(toBatchId:string)=>void;onClose:()=>void}){
  const targets=overview.batches.filter(batch=>batch.id!==from.id&&isOpenBatch(batch));
  const [chosen,setChosen]=useState(targets[0]?.id??'');
  return <AppCard title={`Move ${line.loadNumber??'this load'}`} hint={`${formatKg(line.kg)} of bitumen (${formatTons(line.mixKg)} of ${line.itemName}) is taken from ${from.batchNumber}.`}>
    {targets.length?targets.map(batch=><TouchableOpacity key={batch.id} style={[styles.option,chosen===batch.id&&styles.optionOn]} onPress={()=>setChosen(batch.id)} accessibilityRole="radio" accessibilityState={{checked:chosen===batch.id}}>
      <View style={styles.flex}><Text style={styles.strong}>{batch.batchNumber}</Text><Text style={styles.sub}>{formatKg(batch.deliveredKg)} delivered · {formatKg(batch.remainingKg)} left · {bitumenStatusLabels[batch.status]}</Text></View>
      <Text style={styles.sub}>{chosen===batch.id?'✓':''}</Text>
    </TouchableOpacity>):<Text style={styles.sub}>There is no other open batch to move it to.</Text>}
    <Text style={styles.sub}>Both batches are recalculated. The load keeps its rule and its {formatKg(line.kg)}.</Text>
    <AppButton label={chosen?`Move this load to ${targets.find(batch=>batch.id===chosen)?.batchNumber??''}`:'Move this load'} busy={busy} disabled={!chosen} onPress={()=>onConfirm(chosen)}/>
    <AppButton label="Cancel" tone="secondary" onPress={onClose}/>
  </AppCard>;
}

export function AdjustCard({batch,busy,onSave,onClose}:{batch:BitumenBatch;busy:boolean;onSave:(real:string,reason:string)=>void;onClose:()=>void}){
  const [real,setReal]=useState(''),[reason,setReason]=useState('');
  const parsed=Number(real.trim().replace(',','.'));
  const valid=/^\d+([.,]\d+)?$/.test(real.trim())&&Number.isFinite(parsed);
  const difference=valid?adjustmentFor(batch.remainingKg,Math.round(parsed*1000)/1000):null;
  return <AppCard title={`Adjust ${batch.batchNumber}`} hint="Type what is really left, from weighing or dipping the tank. The difference is saved as an adjustment with your reason.">
    <View style={styles.fact}><Text style={styles.sub}>Delivered</Text><Text style={styles.strong}>{formatKg(batch.deliveredKg)}</Text></View>
    <View style={styles.fact}><Text style={styles.sub}>Estimated used</Text><Text style={styles.strong}>{formatKg(batch.usedKg)}</Text></View>
    <View style={styles.fact}><Text style={styles.sub}>Estimated left</Text><Text style={styles.strong}>{formatKg(batch.remainingKg)}</Text></View>
    <AppField label="Real amount left (kg) *" value={real} onChangeText={setReal} keyboardType="decimal-pad" placeholder="For example 17900"/>
    {difference!=null&&Math.abs(difference)>0.0005?<Feedback kind="warning">{`Adjustment: ${difference>0?'+':'−'}${Math.abs(difference).toLocaleString('en-US',{maximumFractionDigits:3})} kg. The batch will show ${formatKg(Math.round(parsed*1000)/1000)} left, and later loads continue from that figure.`}</Feedback>:null}
    <AppField label="Reason *" value={reason} onChangeText={setReason} multiline placeholder="For example: weighed the tank"/>
    <AppButton label="Save adjustment" busy={busy} disabled={!valid||!reason.trim()||difference==null||Math.abs(difference)<=0.0005} onPress={()=>onSave(real,reason)}/>
    <AppButton label="Cancel" tone="secondary" onPress={onClose}/>
  </AppCard>;
}

export function AdjustmentsCard({batch,overview}:{batch:BitumenBatch;overview:BitumenOverview}){
  const rows=(overview.adjustments??[]).filter(value=>value.batchId===batch.id);
  if(!rows.length)return null;
  return <AppCard title="Adjustments" hint="Kept on record. They never change a load.">
    {rows.map(value=><View key={value.id} style={styles.line}><View style={styles.flex}><Text style={styles.strong}>{dayOf(value.createdAt)}</Text><Text style={styles.sub}>{value.reason} · estimate {formatKg(value.estimatedBefore)} → real {formatKg(value.realAfter)}</Text></View><Text style={styles.kg}>{value.kg>0?'+':'−'}{Math.abs(value.kg).toLocaleString('en-US',{maximumFractionDigits:3})} kg</Text></View>)}
  </AppCard>;
}

export function AttentionCard({items}:{items:AttentionItem[]}){
  if(!items.length)return null;
  return <AppCard title="Needs attention" hint="These loads could not be fully counted.">
    {items.map(item=><View key={`${item.loadId}-${item.kind}`} style={styles.attention}><Text style={styles.strong}>{item.loadNumber??'Load'} · {item.itemName}</Text><Text style={styles.sub}>{item.kind==='uncovered'?`${formatKg(item.kg)} not covered. `:''}{item.note}</Text></View>)}
  </AppCard>;
}

/** Which items use bitumen and by what rule. A change applies only to loads counted afterwards. */
export function RulesView({repository,onChanged}:{repository:BitumenRepository;onChanged:()=>void}){
  const [setup,setSetup]=useState<BitumenUseSetup|null>(null),[error,setError]=useState<string|null>(null),[message,setMessage]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const [seriesId,setSeriesId]=useState('');
  const load=async()=>setSetup(await repository.getUseSetup());
  useEffect(()=>{void load().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load the rules.'));},[]);// eslint-disable-line react-hooks/exhaustive-deps
  const run=async(action:()=>Promise<void>,success:string)=>{setBusy(true);setError(null);setMessage(null);try{await action();await load();onChanged();setMessage(success);}catch(cause){setError(cause instanceof Error?cause.message:'That could not be saved.');}finally{setBusy(false);}};
  if(!setup)return <Text style={styles.sub}>Loading the rules…</Text>;
  const today=localDateKey(new Date());
  return <View style={styles.wrap}>
    <AppCard title="Items that use bitumen" hint="Tick each asphalt item. Loads of ticked items take bitumen from a batch automatically, by the rule below. Other loads are ignored. A changed rule applies only to loads counted afterwards.">
      {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
      {setup.items.length?setup.items.map(item=><RuleItem key={item.id} item={item} rule={setup.rules.find(rule=>rule.itemId===item.id)} today={today} busy={busy} onSave={draft=>void run(async()=>{await repository.saveRule(draft);},`Rule saved for ${item.name}.`)}/>):<Text style={styles.sub}>No items are used on receipts yet. Add items to the catalog first.</Text>}
    </AppCard>
    {setup.series.length?<AppCard title="Add all items from a series" hint="Ticks every item in a load-number series, such as ASP. After that the list is yours: a later change to the series does not change it.">
      <SearchableSelect label="Series" options={setup.series.map(series=>({id:series.id,label:`${series.prefix} · ${series.name}`,detail:`${series.itemIds.length} item${series.itemIds.length===1?'':'s'}`}))} selectedId={seriesId} onSelect={setSeriesId} placeholder="Select series"/>
      <AppButton label="Add all items from this series" tone="secondary" busy={busy} disabled={!seriesId} onPress={()=>void run(async()=>{await repository.enableSeries(seriesId,today);},'The items of the series are ticked.')}/>
    </AppCard>:null}
  </View>;
}

function RuleItem({item,rule,today,busy,onSave}:{item:BitumenUseSetup['items'][number];rule?:BitumenRule;today:string;busy:boolean;onSave:(draft:{itemId:string;enabled:boolean;aggregateTons:string;bitumenKg:string;countFrom:string})=>void}){
  const [enabled,setEnabled]=useState(rule?.enabled??false);
  const [tons,setTons]=useState(String((rule?.aggregateKg??DEFAULT_RULE.aggregateKg)/1000)),[kg,setKg]=useState(String(rule?.bitumenKg??DEFAULT_RULE.bitumenKg)),[from,setFrom]=useState(rule?.countFrom??today);
  const aggregate=Number(tons.replace(',','.'))*1000,bitumen=Number(kg.replace(',','.'));
  const percent=aggregate>0&&bitumen>0?rulePercent(aggregate,bitumen):null;
  return <View style={[styles.rule,enabled&&styles.ruleOn]}>
    <View style={styles.line}><View style={styles.flex}><Text style={styles.strong}>{item.name}</Text><Text style={styles.sub}>{item.seriesPrefix?`${item.seriesPrefix} series`:item.categoryName}{rule&&!rule.enabled?' · not counted':''}</Text></View></View>
    <SegmentedChoice label="Uses bitumen" options={[{id:'on',label:'Counted'},{id:'off',label:'Not counted'}]} selectedId={enabled?'on':'off'} onSelect={id=>setEnabled(id==='on')}/>
    {enabled?<>
      <View style={styles.pair}><View style={styles.flex}><AppField label="Mix (t)" value={tons} onChangeText={setTons} keyboardType="decimal-pad"/></View><View style={styles.flex}><AppField label="needs bitumen (kg)" value={kg} onChangeText={setKg} keyboardType="decimal-pad"/></View></View>
      <Text style={styles.sub}>Every {tons||'…'} t of mix needs {kg||'…'} kg of bitumen{percent!=null?` = ${percent}% bitumen`:''}.</Text>
      <DatePickerField label="Count loads from" value={from} onChange={setFrom}/>
    </>:null}
    <AppButton label="Save" tone="secondary" busy={busy} onPress={()=>onSave({itemId:item.id,enabled,aggregateTons:tons,bitumenKg:kg,countFrom:from})}/>
  </View>;
}

const styles=StyleSheet.create({
  wrap:{gap:12},
  flex:{flex:1,minWidth:0},
  strong:{color:colors.ink,fontSize:14,fontWeight:'800'},
  sub:{color:colors.muted,fontSize:12,lineHeight:17},
  link:{color:colors.navy,fontSize:12,fontWeight:'800',marginTop:4},
  line:{flexDirection:'row',gap:10,paddingVertical:10,borderTopWidth:1,borderTopColor:colors.line},
  kg:{color:colors.ink,fontSize:15,fontWeight:'900'},
  totalLine:{flexDirection:'row',justifyContent:'space-between',paddingVertical:10,borderTopWidth:1.5,borderTopColor:colors.navy},
  event:{paddingVertical:6,borderTopWidth:1,borderTopColor:colors.line},
  eventKg:{color:colors.ink,fontSize:13,fontWeight:'700'},
  eventBack:{color:colors.success},
  option:{flexDirection:'row',alignItems:'center',gap:10,padding:12,borderWidth:1.5,borderColor:colors.line,borderRadius:radius.md,marginTop:6},
  optionOn:{borderColor:colors.navy,backgroundColor:'#EEF2F7'},
  fact:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:8,borderTopWidth:1,borderTopColor:colors.line},
  attention:{paddingVertical:8,borderTopWidth:1,borderTopColor:colors.line,gap:2},
  rule:{borderWidth:1.5,borderColor:colors.line,borderRadius:radius.md,padding:12,gap:8,marginTop:8,backgroundColor:colors.surface},
  ruleOn:{borderColor:colors.navy,backgroundColor:'#FBFCFE'},
  pair:{flexDirection:'row',gap:10},
});
