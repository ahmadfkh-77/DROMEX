import {useMemo,useState} from 'react';
import {Alert,Modal,Pressable,StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';
import type {QuarryDailyCounter} from '../../domain/quarry';
import {buildCounterBoard,counterPlaceName,type CounterUnitTotal} from '../../domain/supplierCounters';
import {colors} from '../theme';

const quantityText=(value:number)=>String(Number(value.toFixed(3)));
const unitsText=(units:CounterUnitTotal[])=>units.map(unit=>`${quantityText(unit.quantity)} ${unit.symbol}`.trim()).join(' · ');
const plural=(count:number,word:string)=>`${count} ${word}${count===1?'':'s'}`;
const truckName=(counter:QuarryDailyCounter)=>counter.deliveryMethod==='supplier'?(counter.truckPlate?`Supplier Delivering · ${counter.truckPlate}`:'Supplier Delivering'):`${counter.truckPlate} · ${counter.driverName}`;
const timeText=(value:string)=>new Date(value).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});

/**
 * Today's truck counters: grouped by place, compact rows, a +1 Trip button on every open counter, the trips of a
 * counter on tap (each one opens the existing reasoned correction), and Finish for a truck that is done today.
 */
export function SupplierTruckCounters({counters,finishedKeys,busy,incrementing,incrementQuantity,onIncrementQuantity,onBeginIncrement,onConfirmIncrement,onCloseIncrement,onFinish,onResume,onFinishAll,onEditTrip}:{
  counters:QuarryDailyCounter[];finishedKeys:ReadonlySet<string>;busy:boolean;
  incrementing:QuarryDailyCounter|null;incrementQuantity:string;onIncrementQuantity:(value:string)=>void;
  onBeginIncrement:(counter:QuarryDailyCounter)=>void;onConfirmIncrement:()=>void;onCloseIncrement:()=>void;
  onFinish:(key:string)=>void;onResume:(key:string)=>void;onFinishAll:(keys:string[])=>void;onEditTrip:(purchaseId:string)=>void}){
  const[place,setPlace]=useState<string|null>(null);
  const[expandedKey,setExpandedKey]=useState<string|null>(null);
  const[finishing,setFinishing]=useState<QuarryDailyCounter|null>(null);
  const[finishedOpen,setFinishedOpen]=useState(false);
  const activePlace=place&&counters.some(counter=>counterPlaceName(counter)===place)?place:null;
  const board=useMemo(()=>buildCounterBoard(counters,finishedKeys,activePlace),[counters,finishedKeys,activePlace]);
  const open=board.groups.flatMap(group=>group.counters);
  const summary=[plural(board.summary.trucks,'truck'),plural(board.summary.trips,'trip'),unitsText(board.summary.units),board.summary.places>1?plural(board.summary.places,'place'):''].filter(Boolean).join(' · ');
  const confirmFinishAll=()=>Alert.alert('Finish all counters?',`${plural(open.length,'counter')} will move to Finished today. The trips already recorded stay as they are, and you can resume any of them.`,[{text:'Keep open',style:'cancel'},{text:'Finish all',onPress:()=>onFinishAll(open.map(counter=>counter.key))}]);
  return <View style={styles.section}>
    <View style={styles.heading}><View style={styles.copy}><Text style={styles.title}>Today's truck counters</Text>{counters.length?<Text style={styles.summary}>{summary}</Text>:<Text style={styles.summary}>Each +1 creates one separate timestamped supplier load with the same selected pricing rules.</Text>}</View>{open.length>1?<TouchableOpacity style={styles.finishAll} onPress={confirmFinishAll} accessibilityRole="button" accessibilityLabel="Finish all open counters"><Text style={styles.finishAllText}>Finish all</Text></TouchableOpacity>:null}</View>
    {board.places.length>1?<View style={styles.chips}>{[null,...board.places].map(name=><TouchableOpacity key={name??'all'} style={[styles.chip,activePlace===name&&styles.chipOn]} onPress={()=>setPlace(name)} accessibilityRole="button" accessibilityState={{selected:activePlace===name}}><Text style={[styles.chipText,activePlace===name&&styles.chipTextOn]} numberOfLines={1}>{name??'All places'}</Text></TouchableOpacity>)}</View>:null}
    {!counters.length?<View style={styles.empty}><Text style={styles.emptyTitle}>No counters for today</Text><Text style={styles.summary}>Confirm the first supplier load for a truck or supplier delivery. Its daily counter will appear here automatically.</Text></View>:null}
    {counters.length&&!open.length&&!board.finished.length?<Text style={styles.summary}>Nothing to show for this place.</Text>:null}
    {counters.length&&!open.length&&board.finished.length?<Text style={styles.summary}>Every counter is finished for today. Open Finished today to resume one.</Text>:null}
    {board.groups.map(group=><View key={group.name} style={styles.group}>
      <View style={styles.groupHead}><Text style={styles.groupName} numberOfLines={1}>{group.name}</Text><Text style={styles.groupTotal}>{plural(group.tripCount,'trip')} · {unitsText(group.units)}</Text></View>
      {group.counters.map(counter=>{const expanded=expandedKey===counter.key;const confirming=incrementing?.key===counter.key;return <View key={counter.key} style={styles.counter}>
        <Pressable style={styles.top} onPress={()=>setExpandedKey(expanded?null:counter.key)} accessibilityRole="button" accessibilityState={{expanded}} accessibilityLabel={`${truckName(counter)}, ${counter.itemName}, ${plural(counter.tripCount,'trip')}, ${quantityText(counter.totalQuantityCubicMetres)} ${counter.unitSymbol}. ${expanded?'Hide':'Show'} trips`}>
          <View style={styles.copy}><Text style={styles.truck} numberOfLines={1}>{truckName(counter)}</Text><Text style={styles.item} numberOfLines={1}>{counter.itemName}</Text><Text style={styles.supplier} numberOfLines={1}>{counter.supplierName}</Text></View>
          <View style={styles.trips}><Text style={styles.tripsValue}>{counter.tripCount}</Text><Text style={styles.tripsLabel}>{counter.tripCount===1?'TRIP':'TRIPS'}</Text></View>
          <Text style={styles.qty}>{quantityText(counter.totalQuantityCubicMetres)} {counter.unitSymbol}</Text>
        </Pressable>
        {expanded?<View style={styles.tripList}>{counter.trips.map((trip,index)=>{const cancelled=trip.status==='Cancelled';return <View key={trip.id} style={[styles.tripRow,cancelled&&styles.tripCancelled]}>
          <Text style={styles.tripNo}>{index+1}</Text><Text style={styles.tripTime}>{timeText(trip.confirmedAt)}</Text>
          <Text style={[styles.tripQty,cancelled&&styles.struck]}>{quantityText(trip.quantity)} {counter.unitSymbol}</Text>
          <TouchableOpacity style={styles.tripEdit} onPress={()=>onEditTrip(trip.id)} accessibilityRole="button" accessibilityLabel={`${cancelled?'Open':'Edit'} trip ${index+1}`}><Text style={styles.tripEditText}>{cancelled?'Cancelled':'Edit'}</Text></TouchableOpacity>
        </View>;})}<Text style={styles.tripHint}>Edit opens the correction with a reason. Cancelling a trip is done there too; a cancelled trip stays listed and is left out of the totals.</Text></View>:null}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.plus} disabled={busy} onPress={()=>onBeginIncrement(counter)} accessibilityRole="button" accessibilityLabel={`Add one trip for ${truckName(counter)}`}><Text style={styles.plusText}>+1 Trip</Text></TouchableOpacity>
          <TouchableOpacity style={styles.finish} onPress={()=>setFinishing(counter)} accessibilityRole="button" accessibilityLabel={`Finish ${truckName(counter)}`}><Text style={styles.finishText}>Finish</Text></TouchableOpacity>
        </View>
        {confirming?<View style={styles.panel}><Text style={styles.panelTitle}>Confirm this trip</Text><Text style={styles.summary}>The previous trip quantity is ready. Change it only if this truck carried a different quantity this time.</Text>
          <Text style={styles.fieldLabel}>This trip quantity *</Text><TextInput style={styles.input} value={incrementQuantity} onChangeText={onIncrementQuantity} keyboardType="decimal-pad"/>
          <View style={styles.panelActions}><TouchableOpacity style={styles.panelClose} disabled={busy} onPress={onCloseIncrement} accessibilityRole="button"><Text style={styles.panelCloseText}>Close</Text></TouchableOpacity><TouchableOpacity style={styles.panelConfirm} disabled={busy} onPress={onConfirmIncrement} accessibilityRole="button"><Text style={styles.panelConfirmText}>{busy?'Adding...':'Confirm +1 Trip'}</Text></TouchableOpacity></View></View>:null}
      </View>;})}
    </View>)}
    {board.finished.length?<View style={styles.done}>
      <Pressable style={styles.doneHead} onPress={()=>setFinishedOpen(value=>!value)} accessibilityRole="button" accessibilityState={{expanded:finishedOpen}}><Text style={styles.doneTitle}>Finished today · {board.finished.length}</Text><Text style={styles.doneChevron}>{finishedOpen?'⌃':'⌄'}</Text></Pressable>
      {finishedOpen?board.finished.map(counter=><View key={counter.key} style={styles.doneRow}><View style={styles.copy}><Text style={styles.doneName} numberOfLines={1}>{truckName(counter)} · {counter.itemName}</Text><Text style={styles.supplier} numberOfLines={1}>{counterPlaceName(counter)}</Text></View><View style={styles.doneRight}><Text style={styles.doneTotal}>{plural(counter.tripCount,'trip')} · {quantityText(counter.totalQuantityCubicMetres)} {counter.unitSymbol}</Text><TouchableOpacity onPress={()=>onResume(counter.key)} accessibilityRole="button" accessibilityLabel={`Resume ${truckName(counter)}`} hitSlop={{top:10,bottom:10,left:10,right:10}}><Text style={styles.resume}>Resume</Text></TouchableOpacity></View></View>):null}
    </View>:null}
    <Modal visible={finishing!==null} transparent animationType="fade" onRequestClose={()=>setFinishing(null)}><View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={()=>setFinishing(null)} accessibilityLabel="Close"/>
      {finishing?<View style={styles.sheet}><Text style={styles.sheetTitle}>Finish this counter?</Text><Text style={styles.summary}>No more trips will be added to it today. The trips already recorded stay exactly as they are. You can resume it from Finished today.</Text>
        <View style={styles.sheetBox}><Text style={styles.truck}>{truckName(finishing)}</Text><Text style={styles.item}>{finishing.itemName} · {counterPlaceName(finishing)}</Text><Text style={styles.supplier}>{plural(finishing.tripCount,'trip')} · {quantityText(finishing.totalQuantityCubicMetres)} {finishing.unitSymbol}</Text></View>
        <TouchableOpacity style={styles.sheetPrimary} onPress={()=>{onFinish(finishing.key);if(expandedKey===finishing.key)setExpandedKey(null);setFinishing(null);}} accessibilityRole="button"><Text style={styles.sheetPrimaryText}>Finish counter</Text></TouchableOpacity>
        <TouchableOpacity style={styles.sheetSecondary} onPress={()=>setFinishing(null)} accessibilityRole="button"><Text style={styles.sheetSecondaryText}>Keep it open</Text></TouchableOpacity>
      </View>:null}
    </View></Modal>
  </View>;
}

const styles=StyleSheet.create({
  section:{gap:11},
  heading:{flexDirection:'row',alignItems:'flex-start',gap:10},
  copy:{flex:1,minWidth:0},
  title:{color:colors.ink,fontSize:19,fontWeight:'700'},
  summary:{color:colors.muted,fontSize:13,lineHeight:19,fontWeight:'500'},
  finishAll:{minHeight:44,justifyContent:'center',paddingHorizontal:12,borderWidth:1.5,borderColor:colors.navy,borderRadius:11},
  finishAllText:{color:colors.navy,fontSize:12,fontWeight:'800'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:7},
  chip:{minHeight:40,justifyContent:'center',paddingHorizontal:13,borderRadius:20,borderWidth:1.5,borderColor:'#CFC6B6',backgroundColor:colors.surface,maxWidth:'100%'},
  chipOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  chipText:{color:'#3C4854',fontSize:12,fontWeight:'800'},
  chipTextOn:{color:'#FFF'},
  empty:{borderWidth:1,borderColor:colors.line,borderStyle:'dashed',borderRadius:15,padding:16,gap:5},
  emptyTitle:{color:colors.ink,fontSize:17,fontWeight:'700'},
  group:{gap:7},
  groupHead:{flexDirection:'row',alignItems:'baseline',gap:8,paddingHorizontal:2},
  groupName:{flex:1,color:colors.brand,fontSize:13,fontWeight:'800'},
  groupTotal:{color:colors.muted,fontSize:11,fontWeight:'600'},
  counter:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.line,overflow:'hidden'},
  top:{flexDirection:'row',alignItems:'center',gap:10,padding:11,minHeight:64},
  truck:{color:colors.navy,fontSize:14,fontWeight:'800'},
  item:{color:colors.brandDark,fontSize:12,fontWeight:'800',marginTop:1},
  supplier:{color:colors.muted,fontSize:11,marginTop:1},
  trips:{minWidth:46,alignItems:'center',backgroundColor:colors.navy,borderRadius:11,paddingHorizontal:6,paddingVertical:4},
  tripsValue:{color:'#FFF',fontSize:17,fontWeight:'900',lineHeight:19},
  tripsLabel:{color:'#F2A184',fontSize:8,fontWeight:'800',letterSpacing:.7},
  qty:{minWidth:56,textAlign:'right',color:colors.ink,fontSize:12,fontWeight:'800'},
  tripList:{borderTopWidth:1,borderTopColor:'#EEE9DF',backgroundColor:'#FBF9F4'},
  tripRow:{flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:11,paddingVertical:4,minHeight:48,borderBottomWidth:1,borderBottomColor:'#F0EBE0'},
  tripCancelled:{opacity:.6},
  tripNo:{width:22,height:22,borderRadius:6,backgroundColor:'#E8EDF3',color:colors.navy,textAlign:'center',lineHeight:22,fontSize:10,fontWeight:'900',overflow:'hidden'},
  tripTime:{color:colors.muted,fontSize:12},
  tripQty:{flex:1,textAlign:'right',color:colors.ink,fontSize:13,fontWeight:'800'},
  struck:{textDecorationLine:'line-through'},
  tripEdit:{minHeight:44,minWidth:64,alignItems:'center',justifyContent:'center'},
  tripEditText:{color:colors.brand,fontSize:13,fontWeight:'800'},
  tripHint:{color:colors.muted,fontSize:11,lineHeight:16,padding:11},
  actions:{flexDirection:'row',gap:8,padding:11,paddingTop:2},
  plus:{flex:1,minHeight:48,justifyContent:'center',alignItems:'center',backgroundColor:colors.brand,borderRadius:12},
  plusText:{color:'#FFF',fontSize:16,fontWeight:'800'},
  finish:{minHeight:48,minWidth:76,justifyContent:'center',alignItems:'center',borderWidth:1.5,borderColor:colors.ink,borderRadius:12,paddingHorizontal:14},
  finishText:{color:colors.ink,fontSize:13,fontWeight:'800'},
  panel:{margin:11,marginTop:0,backgroundColor:'#FFF',borderRadius:13,padding:13,gap:8,borderWidth:1,borderColor:'#D9E3E8'},
  panelTitle:{color:colors.ink,fontSize:15,fontWeight:'700'},
  fieldLabel:{color:colors.ink,fontSize:13,fontWeight:'700'},
  input:{minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,paddingVertical:11,color:colors.ink,backgroundColor:'#FCFBF8'},
  panelActions:{flexDirection:'row',gap:9},
  panelClose:{flex:1,minHeight:48,justifyContent:'center',borderWidth:1,borderColor:colors.navy,borderRadius:11,alignItems:'center'},
  panelCloseText:{color:colors.navy,fontWeight:'700'},
  panelConfirm:{flex:2,minHeight:48,justifyContent:'center',backgroundColor:colors.navy,borderRadius:11,alignItems:'center'},
  panelConfirmText:{color:'#FFF',fontWeight:'700'},
  done:{borderWidth:1,borderStyle:'dashed',borderColor:'#B9B09C',borderRadius:14,paddingHorizontal:12},
  doneHead:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  doneTitle:{color:'#3C4854',fontSize:13,fontWeight:'800'},
  doneChevron:{color:'#3C4854',fontSize:18,fontWeight:'900'},
  doneRow:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:9,borderTopWidth:1,borderTopColor:'#E8E3D8'},
  doneName:{color:colors.ink,fontSize:12,fontWeight:'800'},
  doneRight:{alignItems:'flex-end',gap:4},
  doneTotal:{color:colors.ink,fontSize:12,fontWeight:'800'},
  resume:{color:colors.brand,fontSize:13,fontWeight:'800'},
  overlay:{flex:1,backgroundColor:'rgba(8,27,45,.55)',justifyContent:'flex-end'},
  sheet:{backgroundColor:colors.background,borderTopLeftRadius:24,borderTopRightRadius:24,padding:18,paddingBottom:26,gap:10},
  sheetTitle:{color:colors.ink,fontSize:20,fontWeight:'900'},
  sheetBox:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:12,padding:12,gap:2},
  sheetPrimary:{minHeight:48,justifyContent:'center',alignItems:'center',backgroundColor:colors.navy,borderRadius:12},
  sheetPrimaryText:{color:'#FFF',fontSize:15,fontWeight:'800'},
  sheetSecondary:{minHeight:48,justifyContent:'center',alignItems:'center',borderWidth:1.5,borderColor:colors.navy,borderRadius:12},
  sheetSecondaryText:{color:colors.navy,fontSize:15,fontWeight:'800'},
});
