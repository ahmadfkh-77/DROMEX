import {useEffect,useMemo,useState} from 'react';
import {StyleSheet,Switch,Text,TouchableOpacity,View} from 'react-native';

import type {BitumenRepository} from '../../data/repositories/BitumenRepository';
import {formatKg,formatTons} from '../../domain/bitumen';
import {groupAttentionByDay,type AttentionItem,type LeftOutBatchOption,type LeftOutLoad} from '../../domain/bitumenUse';
import {fuelDayLabel} from '../../domain/fuelBatchViews';
import {localDateKey} from '../../domain/fuel';
import {AppButton,AppCard,Feedback} from './AppPrimitives';
import {colors,radius} from '../theme';

/**
 * Loads left out of a batch. The Needs attention card groups them by the day each load was made; a load opens a detail view built from its
 * own records, and Add to batch places it by hand. The switch lets today's loads be placed automatically. Nothing here edits a saved row:
 * every placement adds new rows with a note, and a load is never blocked.
 */
const DAY_LOAD_LIMIT=10,FIRST_DAYS=5;
const timeOf=(iso:string)=>{const date=new Date(iso);return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;};
const dayText=(day:string,isToday:boolean)=>isToday?`Today · ${fuelDayLabel(day)}`:fuelDayLabel(day);
const loadsWord=(count:number)=>`${count} load${count===1?'':'s'}`;

export function AutoPlaceSwitch({value,busy,onChange}:{value:boolean;busy:boolean;onChange:(on:boolean)=>void}){
  return <AppCard>
    <TouchableOpacity style={styles.switchRow} disabled={busy} onPress={()=>onChange(!value)} accessibilityRole="switch" accessibilityState={{checked:value,disabled:busy}} accessibilityLabel="Add today's left-out loads to batches automatically">
      <Switch value={value} disabled={busy} onValueChange={onChange} trackColor={{false:'#BDB6A8',true:colors.success}} thumbColor="#FFF"/>
      <View style={styles.flex}>
        <Text style={styles.strong}>Add today's left-out loads to batches automatically</Text>
        <Text style={styles.sub}>{value?'On. Only loads made today are placed, in load order, when Bitumen opens and after a delivery or a batch closure. Earlier days stay for you.':'Off. You choose the batch with Add to batch. Turn it on to place only today\'s loads for you.'}</Text>
      </View>
    </TouchableOpacity>
  </AppCard>;
}

export function AttentionCard({items,onOpen}:{items:AttentionItem[];onOpen:(item:AttentionItem)=>void}){
  const today=localDateKey(new Date());
  const groups=useMemo(()=>groupAttentionByDay(items,today),[items,today]);
  const [opened,setOpened]=useState<Record<string,boolean>>({}),[more,setMore]=useState<Record<string,boolean>>({}),[olderShown,setOlderShown]=useState(false);
  if(!groups.length)return null;
  const isOpen=(day:string,isToday:boolean)=>opened[day]??isToday;
  const shown=olderShown?groups:groups.slice(0,FIRST_DAYS);
  const notCovered=groups.reduce((sum,group)=>sum+group.count,0);
  return <AppCard title="Needs attention" hint={`${loadsWord(notCovered)} not fully counted. Each is in no batch, or only part of it is. Nothing is blocked. Tap a load to see why, then use Add to batch to choose the batch yourself. Older days are never placed automatically.`}>
    {shown.map(group=>{
      const open=isOpen(group.day,group.isToday),limited=!more[group.day]&&group.items.length>DAY_LOAD_LIMIT;
      return <View key={group.day} style={styles.day}>
        <TouchableOpacity style={styles.dayHead} onPress={()=>setOpened(current=>({...current,[group.day]:!open}))} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${dayText(group.day,group.isToday)}, ${loadsWord(group.count)} not counted`}>
          <View style={styles.flex}><Text style={styles.strong}>{dayText(group.day,group.isToday)}</Text><Text style={styles.dayNote}>{loadsWord(group.count)} not counted{group.uncoveredKg>0?` · ${formatKg(group.uncoveredKg)}`:''}</Text></View>
          <Text style={styles.count}>{group.count}</Text><Text style={styles.chevron}>{open?'⌄':'›'}</Text>
        </TouchableOpacity>
        {open?<>
          {(limited?group.items.slice(0,DAY_LOAD_LIMIT):group.items).map(item=><TouchableOpacity key={`${item.loadId}-${item.kind}`} style={styles.item} onPress={()=>onOpen(item)} accessibilityRole="button" accessibilityLabel={`${item.loadNumber??'Load'}, ${item.itemName}, ${item.kind==='uncovered'?`${formatKg(item.kg)} not covered`:'cannot be counted'}`}>
            <Text style={styles.time}>{timeOf(item.confirmedAt)}</Text>
            <View style={styles.flex}><Text style={styles.strong}>{item.loadNumber??'Load'}</Text><Text style={styles.sub}>{item.itemName}</Text></View>
            <View style={styles.kgBox}>{item.kind==='uncovered'?<><Text style={styles.kgRed}>{formatKg(item.kg)}</Text><Text style={styles.kgNote}>not covered</Text></>:<Text style={styles.kgNote}>Not countable</Text>}</View>
          </TouchableOpacity>)}
          {limited?<TouchableOpacity style={styles.more} onPress={()=>setMore(current=>({...current,[group.day]:true}))} accessibilityRole="button"><Text style={styles.moreText}>Show {group.items.length-DAY_LOAD_LIMIT} more</Text></TouchableOpacity>:null}
        </>:null}
      </View>;
    })}
    {!olderShown&&groups.length>FIRST_DAYS?<TouchableOpacity style={styles.more} onPress={()=>setOlderShown(true)} accessibilityRole="button"><Text style={styles.moreText}>Show older days ({groups.length-FIRST_DAYS} more)</Text></TouchableOpacity>:null}
  </AppCard>;
}

/** The detail of one left-out load and the Add to batch picker. `onChanged` runs after a placement so the lists refresh. */
export function LeftOutLoadView({repository,item,busy,onBack,onChanged,onOpenLoad}:{repository:BitumenRepository;item:AttentionItem;busy:boolean;onBack:()=>void;onChanged:(message:string)=>void;onOpenLoad:(item:AttentionItem)=>void}){
  const [data,setData]=useState<LeftOutLoad|null|undefined>(undefined),[error,setError]=useState<string|null>(null),[picking,setPicking]=useState(false),[chosen,setChosen]=useState<string|null>(null),[working,setWorking]=useState(false);
  useEffect(()=>{let live=true;void repository.getLeftOutLoad(item.loadId).then(value=>{if(live)setData(value);}).catch(cause=>{if(live){setData(null);setError(cause instanceof Error?cause.message:'Could not read this load.');}});return()=>{live=false;};},[repository,item.loadId]);
  if(data===undefined)return <Text style={styles.sub}>Loading the load…</Text>;
  const detail=data?.detail,uncovered=detail?.uncoveredKg??0;
  const names=new Map((data?.batches??[]).map(batch=>[batch.batchId,batch.batchNumber]));
  const pickable=(option:LeftOutBatchOption)=>option.state==='fits'||option.state==='partial';
  const selected=data?.batches.find(option=>option.batchId===chosen&&pickable(option));
  const addKg=selected?Math.min(uncovered,selected.remainingKg):0;
  const place=async()=>{
    if(!selected)return;
    setWorking(true);setError(null);
    try{const result=await repository.addLoadToBatch(item.loadId,selected.batchId);onChanged(result.uncoveredKg>0?`${formatKg(result.addedKg)} added to ${selected.batchNumber}. ${formatKg(result.uncoveredKg)} of ${item.loadNumber??'the load'} is still not covered and stays listed.`:`${item.loadNumber??'The load'} is now counted in ${selected.batchNumber}.`);}
    catch(cause){setError(cause instanceof Error?cause.message:'That could not be saved.');setWorking(false);}
  };
  return <View style={styles.wrap}>
    <AppCard title={item.loadNumber??'Load'} hint={`${fuelDayLabel(localDateKey(new Date(item.confirmedAt)))} · ${timeOf(item.confirmedAt)} · ${item.itemName}`}>
      {uncovered>0?<Text style={styles.kgRedBig}>{formatKg(uncovered)} not covered</Text>:null}
      {error?<Feedback kind="error">{error}</Feedback>:null}
      {!detail?<Text style={styles.sub}>{item.note}</Text>:null}
    </AppCard>
    {detail?<AppCard title="Asphalt mix and bitumen">
      <Fact label="Mix quantity" value={`${formatKg(detail.mixKg)} · ${formatTons(detail.mixKg)}`}/>
      <Text style={styles.rule}>Counted with the rule: every {formatTons(detail.ruleAggregateKg)} of mix needs {formatKg(detail.ruleBitumenKg)} of bitumen = {detail.percent.toLocaleString('en-US',{maximumFractionDigits:4})}%.</Text>
      <Fact label="Bitumen required for this load" value={formatKg(detail.requiredKg)} strong/>
      {detail.byBatch.map(entry=><Fact key={entry.batchId} label={`Counted in ${names.get(entry.batchId)??'a batch'}`} value={formatKg(entry.kg)}/>)}
      {!detail.byBatch.length?<Fact label="Counted in any batch" value="0 kg"/>:null}
      <Fact label="Not covered" value={formatKg(uncovered)} danger={uncovered>0}/>
      <Text style={styles.sub}>{uncovered>0?'This part is in no batch. Room in a batch does not place it by itself.':'Every kg of this load is now in a batch.'}</Text>
    </AppCard>:null}
    {detail&&uncovered>0&&!picking?<AppButton label="Add to batch" onPress={()=>{setError(null);setPicking(true);}}/>:null}
    {detail&&picking?<AppCard title="Add to batch" hint={`Only open batches that had arrived by the day of this load are offered. New rows are added with the note "Added by hand from Needs attention"; nothing already recorded is edited or deleted.`}>
      {(data?.batches??[]).map(option=>{
        const ok=pickable(option),on=chosen===option.batchId&&ok;
        return <TouchableOpacity key={option.batchId} disabled={!ok} style={[styles.option,on&&styles.optionOn,!ok&&styles.optionOff]} onPress={()=>setChosen(option.batchId)} accessibilityRole="radio" accessibilityState={{checked:on,disabled:!ok}}>
          <View style={styles.flex}>
            <Text style={styles.strong}>{option.batchNumber}{option.inUse?' · In use':''}</Text>
            {ok?<Text style={styles.sub}>Left now {formatKg(option.remainingKg)} · after adding {formatKg(Math.max(0,option.remainingKg-uncovered))}</Text>:<Text style={styles.sub}>{option.state==='closed'?'Closed. It takes no new use.':option.state==='later'?'Arrived after the day of this load.':'Nothing left.'}</Text>}
            {option.state==='partial'?<Text style={styles.warn}>Not enough for the whole load: only {formatKg(option.remainingKg)} would be added and {formatKg(uncovered-option.remainingKg)} stays listed.</Text>:null}
          </View>
          <Text style={[styles.badge,option.state==='fits'&&styles.badgeOk,option.state==='partial'&&styles.badgeWarn]}>{option.state==='fits'?'Fits':option.state==='partial'?'Not enough':option.state==='closed'?'Closed':option.state==='later'?'Too late':'Empty'}</Text>
        </TouchableOpacity>;
      })}
      <AppButton label={selected?`Add ${formatKg(addKg)} to ${selected.batchNumber}`:'Choose a batch'} disabled={!selected} busy={working||busy} onPress={()=>void place()}/>
      <AppButton label="Cancel" tone="secondary" onPress={()=>{setPicking(false);setChosen(null);}}/>
    </AppCard>:null}
    <AppButton label="Open the full load" tone="navy" disabled={!detail&&!item.loadId} onPress={()=>onOpenLoad(item)}/>
    <AppButton label="Back to Bitumen" tone="secondary" onPress={onBack}/>
  </View>;
}

function Fact({label,value,strong=false,danger=false}:{label:string;value:string;strong?:boolean;danger?:boolean}){
  return <View style={styles.fact}><Text style={[styles.sub,styles.flex]}>{label}</Text><Text style={[styles.factValue,strong&&styles.strong,danger&&styles.kgRed]}>{value}</Text></View>;
}

const styles=StyleSheet.create({
  wrap:{gap:12},
  flex:{flex:1,minWidth:0},
  strong:{color:colors.ink,fontSize:14,fontWeight:'800'},
  sub:{color:colors.muted,fontSize:12,lineHeight:17},
  warn:{color:colors.warning,fontSize:12,lineHeight:17,fontWeight:'700',marginTop:4},
  switchRow:{flexDirection:'row',alignItems:'center',gap:12,minHeight:56},
  day:{borderWidth:1,borderColor:'#E2B659',backgroundColor:'#FFF1D6',borderRadius:radius.md,marginTop:8,overflow:'hidden'},
  dayHead:{flexDirection:'row',alignItems:'center',gap:8,minHeight:52,paddingHorizontal:12,paddingVertical:8},
  dayNote:{color:'#7A5200',fontSize:12},
  count:{backgroundColor:colors.brand,color:'#FFF',borderRadius:99,fontWeight:'900',fontSize:13,minWidth:30,textAlign:'center',paddingVertical:4,paddingHorizontal:8,overflow:'hidden'},
  chevron:{color:colors.navy,fontSize:20,fontWeight:'900',width:18,textAlign:'center'},
  item:{flexDirection:'row',alignItems:'center',gap:10,minHeight:56,paddingHorizontal:12,paddingVertical:8,backgroundColor:'#FFF',borderTopWidth:1,borderTopColor:'#E2B659'},
  time:{width:46,color:colors.muted,fontSize:12},
  kgBox:{alignItems:'flex-end'},
  kgRed:{color:colors.danger,fontSize:15,fontWeight:'900'},
  kgRedBig:{color:colors.danger,fontSize:17,fontWeight:'900'},
  kgNote:{color:colors.muted,fontSize:11},
  more:{minHeight:48,alignItems:'center',justifyContent:'center',borderWidth:1.5,borderStyle:'dashed',borderColor:colors.navy,borderRadius:radius.md,marginTop:8},
  moreText:{color:colors.navy,fontWeight:'800',fontSize:14},
  fact:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:8,borderTopWidth:1,borderTopColor:colors.line},
  factValue:{color:colors.ink,fontSize:14,fontWeight:'700',textAlign:'right'},
  rule:{backgroundColor:colors.cream,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:10,color:colors.ink,fontSize:13,lineHeight:19,marginVertical:6},
  option:{flexDirection:'row',alignItems:'center',gap:10,padding:12,borderWidth:1.5,borderColor:colors.line,borderRadius:radius.md,marginTop:6,backgroundColor:'#FFF',minHeight:56},
  optionOn:{borderColor:colors.brand,backgroundColor:'#FFF3EE'},
  optionOff:{backgroundColor:'#F2EFE9',opacity:.85},
  badge:{fontSize:11,fontWeight:'800',color:colors.muted,borderWidth:1,borderColor:colors.line,borderRadius:99,paddingHorizontal:8,paddingVertical:3,overflow:'hidden'},
  badgeOk:{color:colors.success,borderColor:'#9BD0AF',backgroundColor:'#E3F3E9'},
  badgeWarn:{color:'#7A5200',borderColor:'#E2B659',backgroundColor:'#FFF1D6'},
});
