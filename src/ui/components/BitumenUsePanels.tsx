import {useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {BitumenRepository} from '../../data/repositories/BitumenRepository';
import {bitumenStatusLabels,formatKg,formatTons,isOpenBatch,type BitumenBatch,type BitumenOverview} from '../../domain/bitumen';
import {adjustmentFor,DEFAULT_RULE,loadsText,groupUseByDay,rulePercent,useLinesForBatch,useTotals,type BatchLoadUse,type BitumenRule,type BitumenUseSetup} from '../../domain/bitumenUse';
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

const DAY_LOAD_LIMIT=10,FIRST_DAYS=5;
const timeOf=(iso:string)=>{const date=new Date(iso);return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};
const kgText=(kg:number)=>kg.toLocaleString('en-US',{maximumFractionDigits:3});
const tonText=(kg:number)=>(kg/1000).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3});

/** A figure with its caption: the mix is navy and in tons, the bitumen is orange and in kg, so the two are never confused (DEC-527). */
function Figure({caption,value,unit,bitumen,big}:{caption:string;value:string;unit:string;bitumen?:boolean;big?:boolean}){
  return <View style={styles.figure}><Text style={styles.caption}>{caption}</Text><Text style={[styles.figureValue,big&&styles.figureBig,bitumen?styles.bitumenColor:styles.mixColor]}>{value}<Text style={styles.unit}> {unit}</Text></Text></View>;
}

export function UseFromLoadsCard({batch,overview,busy,onMove}:{batch:BitumenBatch;overview:BitumenOverview;busy:boolean;onMove:(line:BatchLoadUse)=>void}){
  const rows=overview.useRows??[];
  const lines=useMemo(()=>useLinesForBatch(rows,batch.id),[rows,batch.id]);
  const events=useMemo(()=>[...rows].filter(row=>row.batchId===batch.id).reverse(),[rows,batch.id]);
  const today=localDateKey(new Date());
  const days=useMemo(()=>groupUseByDay(lines,today),[lines,today]);
  const totals=useMemo(()=>useTotals(lines),[lines]);
  const [showHistory,setShowHistory]=useState(false);
  const [opened,setOpened]=useState<Record<string,boolean>>({}),[more,setMore]=useState<Record<string,boolean>>({}),[olderShown,setOlderShown]=useState(false);
  if(!lines.length&&!events.length)return null;
  // Today is open at first; with no loads today the newest day is open. Older days start closed.
  const firstOpen=days.some(day=>day.isToday)?today:days[0]?.day;
  const isOpen=(day:string)=>opened[day]??(day===firstOpen);
  const shown=olderShown?days:days.slice(0,FIRST_DAYS);
  return <AppCard title="Use from asphalt loads" hint="An estimate from each load's quantity and its rule. Cancelled loads are reversed automatically.">
    {lines.length?<View style={styles.strip} accessibilityRole="summary" accessibilityLabel={`All days, estimate: ${loadsText(totals.loads)}, ${tonText(totals.mixKg)} tons of asphalt mix, ${kgText(totals.bitumenKg)} kilograms of bitumen`}>
      <Text style={styles.stripLabel}>ALL DAYS · ESTIMATE</Text>
      <View style={styles.stripCells}>
        <View style={styles.stripCell}><Text style={styles.stripCaption}>LOADS</Text><Text style={styles.stripValue}>{totals.loads}</Text></View>
        <View style={[styles.stripCell,styles.stripDivider]}><Text style={styles.stripCaption}>ASPHALT MIX</Text><Text style={styles.stripValue}>{tonText(totals.mixKg)}<Text style={styles.stripUnit}> t</Text></Text></View>
        <View style={[styles.stripCell,styles.stripDivider]}><Text style={styles.stripCaption}>BITUMEN USED</Text><Text style={[styles.stripValue,styles.stripBitumen]}>{kgText(totals.bitumenKg)}<Text style={styles.stripUnit}> kg</Text></Text></View>
      </View>
    </View>:<Text style={styles.sub}>No load is counted in this batch now.</Text>}
    {shown.map(group=>{
      const open=isOpen(group.day),limited=!more[group.day]&&group.lines.length>DAY_LOAD_LIMIT;
      return <View key={group.day} style={[styles.day,open&&styles.dayOpen]}>
        <TouchableOpacity style={styles.dayHead} onPress={()=>setOpened(current=>({...current,[group.day]:!open}))} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${group.isToday?'Today, ':''}${fuelDayLabel(group.day)}, ${loadsText(group.count)}, ${tonText(group.mixKg)} tons of mix, ${kgText(group.bitumenKg)} kilograms of bitumen`}>
          <View style={styles.flex}><View style={styles.dayTitleRow}><Text style={styles.dayTitle}>{fuelDayLabel(group.day)}</Text>{group.isToday?<Text style={styles.todayTag}>TODAY</Text>:null}</View><Text style={styles.sub}>{loadsText(group.count)}</Text></View>
          <Text style={[styles.pm,open&&styles.pmOpen]}>{open?'×':'+'}</Text>
        </TouchableOpacity>
        <View style={styles.daySum}><Figure caption="ASPHALT MIX" value={tonText(group.mixKg)} unit="t"/><View style={styles.sumDivider}/><Figure caption="BITUMEN USED" value={kgText(group.bitumenKg)} unit="kg" bitumen/></View>
        {open?<View style={styles.loads}>
          {(limited?group.lines.slice(0,DAY_LOAD_LIMIT):group.lines).map(line=><View key={line.loadId} style={styles.loadCard}>
            <View style={styles.loadTop}><Text style={[styles.strong,styles.flex]}>{line.loadNumber??'Load'}<Text style={styles.itemName}> · {line.itemName}</Text></Text><Text style={styles.sub}>{timeOf(line.loadConfirmedAt)}</Text></View>
            <View style={styles.loadFigures}><Figure caption="MIX WEIGHT" value={tonText(line.mixKg)} unit="t"/><View style={styles.sumDivider}/><Figure caption="BITUMEN USED" value={kgText(line.kg)} unit="kg" bitumen/></View>
            <View style={styles.loadFoot}><Text style={[styles.sub,styles.flex]}>Rule: {ruleText(line.ruleAggregateKg,line.ruleBitumenKg)}</Text>
              {isOpenBatch(batch)?<TouchableOpacity style={styles.moveButton} disabled={busy} onPress={()=>onMove(line)} accessibilityRole="button" accessibilityLabel={`Move ${line.loadNumber??'this load'} to another batch`}><Text style={styles.link}>Move to another batch ›</Text></TouchableOpacity>:null}
            </View>
          </View>)}
          {limited?<TouchableOpacity style={styles.more} onPress={()=>setMore(current=>({...current,[group.day]:true}))} accessibilityRole="button"><Text style={styles.moreText}>Show {group.lines.length-DAY_LOAD_LIMIT} more</Text></TouchableOpacity>:null}
        </View>:null}
      </View>;
    })}
    {!olderShown&&days.length>FIRST_DAYS?<TouchableOpacity style={styles.more} onPress={()=>setOlderShown(true)} accessibilityRole="button"><Text style={styles.moreText}>Show older days ({days.length-FIRST_DAYS} more)</Text></TouchableOpacity>:null}
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
  strip:{backgroundColor:colors.navy,borderRadius:radius.md,padding:12,marginBottom:12},
  stripLabel:{color:'#BFD0E3',fontSize:11,fontWeight:'800',letterSpacing:0.9},
  stripCells:{flexDirection:'row',marginTop:8},
  stripCell:{flexShrink:0,paddingRight:12},
  stripDivider:{flex:1,paddingLeft:12,borderLeftWidth:1,borderLeftColor:'rgba(255,255,255,0.22)'},
  stripCaption:{color:'#BFD0E3',fontSize:10.5,fontWeight:'800',letterSpacing:0.8},
  stripValue:{color:'#FFF',fontSize:20,fontWeight:'900'},
  stripBitumen:{color:'#FFC9B8'},
  stripUnit:{fontSize:12,fontWeight:'700',color:'#DCE6F1'},
  day:{borderWidth:1.5,borderColor:colors.line,borderRadius:radius.md,marginBottom:10,overflow:'hidden',backgroundColor:colors.surface},
  dayOpen:{borderColor:colors.navy},
  dayHead:{flexDirection:'row',alignItems:'center',gap:10,minHeight:52,paddingHorizontal:12,paddingVertical:8,backgroundColor:'#EAF0F7'},
  dayTitleRow:{flexDirection:'row',alignItems:'center',gap:6},
  dayTitle:{color:colors.navy,fontSize:15.5,fontWeight:'800'},
  todayTag:{backgroundColor:colors.brand,color:'#FFF',fontSize:10.5,fontWeight:'800',borderRadius:99,paddingHorizontal:8,paddingVertical:2,overflow:'hidden'},
  pm:{width:32,height:32,borderRadius:16,borderWidth:1.5,borderColor:colors.navy,color:colors.navy,fontSize:20,fontWeight:'900',lineHeight:28,textAlign:'center',overflow:'hidden'},
  pmOpen:{backgroundColor:colors.navy,color:'#FFF'},
  daySum:{flexDirection:'row',paddingVertical:9,paddingHorizontal:12},
  sumDivider:{width:1,backgroundColor:colors.line,marginHorizontal:12},
  figure:{flex:1},
  caption:{color:colors.muted,fontSize:10.5,fontWeight:'800',letterSpacing:0.8},
  figureValue:{fontSize:17,fontWeight:'900'},
  figureBig:{fontSize:20},
  unit:{fontSize:12,fontWeight:'700',color:colors.muted},
  mixColor:{color:colors.navy},
  bitumenColor:{color:'#A83B24'},
  loads:{borderTopWidth:1,borderTopColor:colors.line,backgroundColor:'#EFEBE2',padding:10,gap:10},
  loadCard:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.sm+2,paddingHorizontal:12,paddingTop:10,paddingBottom:4},
  loadTop:{flexDirection:'row',alignItems:'baseline',gap:8},
  itemName:{color:colors.muted,fontWeight:'600'},
  loadFigures:{flexDirection:'row',marginTop:6},
  loadFoot:{flexDirection:'row',alignItems:'center',gap:8,marginTop:2},
  moveButton:{minHeight:44,justifyContent:'center',paddingLeft:8},
  more:{minHeight:44,alignItems:'center',justifyContent:'center',borderWidth:1.5,borderStyle:'dashed',borderColor:colors.navy,borderRadius:radius.sm+2,marginBottom:10},
  moreText:{color:colors.navy,fontWeight:'800',fontSize:13},
  line:{flexDirection:'row',gap:10,paddingVertical:10,borderTopWidth:1,borderTopColor:colors.line},
  kg:{color:colors.ink,fontSize:15,fontWeight:'900'},
  totalLine:{flexDirection:'row',justifyContent:'space-between',paddingVertical:10,borderTopWidth:1.5,borderTopColor:colors.navy},
  mixLine:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',gap:10,paddingBottom:6},
  mixText:{flex:1,color:colors.navy,fontSize:14,fontWeight:'800'},
  mixValue:{color:colors.navy,fontSize:14,fontWeight:'900',flexShrink:0},
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
