import {useMemo,useState} from 'react';
import {Alert,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {localDateKey,type FuelMovement} from '../../../domain/fuel';
import type {BatchDetail,DieselBatchOverview} from '../../../domain/fuelBatches';
import {batchDestinationTotals,buildFillRows,fuelDayLabel,groupFillsByDay} from '../../../domain/fuelBatchViews';
import {formatLitres,formatMoney} from '../../../domain/fuelFillForm';
import {colors,radius} from '../../theme';
import {AppButton,AppField,EmptyState,Feedback} from '../AppPrimitives';
import {BatchStatusBadge,FuelDayCard,SectionTitle} from './FuelBatchParts';

/**
 * DEC-505, Screen C of the approved design: one batch, its four figures, its details, where its diesel
 * went, any dip adjustments, and its fills one card per day. Cancelling needs a reason and keeps the number.
 */
type Props={
  batch:BatchDetail;
  overview:DieselBatchOverview;
  movements:FuelMovement[];
  onBack:()=>void;
  onRecordFill:(batch:BatchDetail)=>void;
  onCancel:(batch:BatchDetail,reason:string)=>Promise<void>;
  exportAction?:React.ReactNode;
};

export function DieselBatchPage({batch,overview,movements,onBack,onRecordFill,onCancel,exportAction}:Props){
  const[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const rows=useMemo(()=>buildFillRows(movements,overview,{batchId:batch.id}),[batch.id,movements,overview]);
  const days=groupFillsByDay(rows,{byDestination:true});
  const totals=batchDestinationTotals(rows);
  const adjustments=overview.adjustments.filter(adjustment=>adjustment.batchId===batch.id);
  const open=batch.status==='in_use'||batch.status==='waiting';
  const subtitle=batch.kind==='opening'?`Opening stock · ${batch.openingBasis==='calculated'?'Calculated (no dip reading)':'From a dip reading'}`:`Invoice ${batch.invoiceNumber??'not recorded'}`;

  const confirmCancel=()=>Alert.alert(`Cancel ${batch.batchNumber}?`,batch.kind==='delivery'?'The delivery behind this batch is cancelled too. Fills that drew from it are moved to the other batches, and any litres no batch can cover show an Overfill Alert. The batch number is never reused.':'The Opening stock batch is cancelled. Fills that drew from it are moved to the other batches. The batch number is never reused.',[
    {text:'Keep batch',style:'cancel'},
    {text:'Cancel Batch',style:'destructive',onPress:()=>{void (async()=>{setBusy(true);setError(null);try{await onCancel(batch,reason);setReason('');}catch(cause){setError(cause instanceof Error?cause.message:'The batch could not be cancelled.');}finally{setBusy(false);}})();}},
  ]);

  const group=(type:'project'|'company_site'|'unassigned',label:string)=>{const list=totals.filter(total=>total.type===type);return list.length?<View key={type} style={styles.destGroup}><Text style={styles.destLabel}>{label}</Text>{list.map(total=><View key={`${type}:${total.name}`} style={styles.destRow}><Text style={styles.destName}>{total.name}</Text><Text style={styles.destValue}>{formatLitres(total.litres)}</Text></View>)}</View>:null;};

  // The summary is the second child so it stays visible while the page scrolls (Screen C, item 2).
  return <ScrollView contentContainerStyle={styles.page} stickyHeaderIndices={[1]}>
    <View style={styles.head}>
      <TouchableOpacity style={styles.back} onPress={onBack} accessibilityRole="button"><Text style={styles.backText}>Back</Text></TouchableOpacity>
      <Text style={styles.eyebrow}>DIESEL BATCH</Text>
      <View style={styles.titleRow}><Text style={styles.title}>{batch.batchNumber}</Text><BatchStatusBadge status={batch.status}/></View>
      <Text style={styles.sub}>{subtitle} · Arrived {fuelDayLabel(localDateKey(batch.arrivedAt))}</Text>
      {batch.status==='cancelled'?<Feedback kind="error">Cancelled{batch.cancelledAt?` on ${fuelDayLabel(localDateKey(batch.cancelledAt))}`:''}: {batch.cancellationReason??'No reason recorded'}</Feedback>:null}
    </View>

    <View style={styles.stickyWrap}><View style={styles.summary}>
      <Tile label="Delivered" value={formatLitres(batch.deliveredLitres)}/>
      <Tile label="Filled" value={formatLitres(batch.filledLitres)}/>
      <Tile label="Adjustments" value={formatLitres(batch.adjustmentLitres)} tone="amber"/>
      <Tile label="Remaining" value={formatLitres(batch.remainingLitres)} tone="navy"/>
    </View></View>
    {overview.overfillAlert&&open?<View style={styles.overfill} accessibilityRole="alert"><Text style={styles.overfillText}>Overfill Alert on the tank: {formatLitres(overview.outstandingShortfallLitres)} filled with no diesel left in any batch.</Text></View>:null}

    {open?<AppButton label="Record Fill" tone="primary" onPress={()=>onRecordFill(batch)}/>:null}

    <View style={styles.card}>
      <SectionTitle title="Batch details"/>
      <Detail label="Supplier" value={batch.supplierName??'Not recorded'}/>
      <Detail label="Invoice number" value={batch.invoiceNumber??'Not recorded'}/>
      <Detail label="Arrival date" value={fuelDayLabel(localDateKey(batch.arrivedAt))}/>
      <Detail label="Price per litre" value={batch.pricePerLitreUsd==null?'Unpriced':formatMoney(batch.pricePerLitreUsd)}/>
      <Detail label="Fuel type" value="Diesel"/>
    </View>

    <View style={styles.card}>
      <SectionTitle title="Totals by destination"/>
      {totals.length?[group('project','PROJECTS'),group('company_site','COMPANY SITES'),group('unassigned','UNASSIGNED')]:<Text style={styles.sub}>No fills have drawn from this batch yet.</Text>}
    </View>

    {adjustments.map(adjustment=><View key={`${adjustment.gaugeId}:${adjustment.batchId}`} style={styles.adjustment}>
      <Text style={styles.adjustmentTitle}>Dip adjustment · {fuelDayLabel(localDateKey(adjustment.confirmedAt))}</Text>
      <Detail label="Calculated remaining" value={formatLitres(adjustment.calculatedLitres)}/>
      <Detail label="Dip reading" value={formatLitres(adjustment.dipLitres)}/>
      <Detail label="Adjustment on this batch" value={formatLitres(adjustment.litres)} strong/>
    </View>)}

    <SectionTitle title="Fills by day" detail="newest first · one card per day"/>
    {days.length?days.map(card=><FuelDayCard key={card.day} card={card}/>):<EmptyState title="No fills yet" body={open?'Fills from the tank draw from this batch when it is the oldest open one, or when you choose it on Record Fill.':'No fill drew from this batch.'}/>}

    {exportAction}

    {batch.status!=='cancelled'?<View style={styles.danger}>
      {error?<Feedback kind="error">{error}</Feedback>:null}
      <AppField label="Cancellation reason *" value={reason} onChangeText={setReason} multiline/>
      <AppButton label="Cancel Batch" tone="danger" busy={busy} disabled={!reason.trim()} onPress={confirmCancel}/>
      <Text style={styles.dangerNote}>Requires a reason. The batch number {batch.batchNumber} is never reused.</Text>
    </View>:null}
  </ScrollView>;
}

function Tile({label,value,tone='white'}:{label:string;value:string;tone?:'white'|'amber'|'navy'}){
  return <View style={[styles.tile,tone==='amber'&&styles.tileAmber,tone==='navy'&&styles.tileNavy]}>
    <Text style={[styles.tileLabel,tone==='navy'&&styles.tileLabelNavy]}>{label.toUpperCase()}</Text>
    <Text style={[styles.tileValue,tone==='amber'&&styles.tileValueAmber,tone==='navy'&&styles.tileValueNavy]}>{value}</Text>
  </View>;
}

function Detail({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text style={[styles.detailValue,strong&&styles.detailStrong]}>{value}</Text></View>;
}

const styles=StyleSheet.create({
  page:{padding:20,paddingBottom:42,gap:16},
  back:{backgroundColor:colors.surface,padding:10,borderRadius:radius.sm,minHeight:42,justifyContent:'center'},
  backText:{color:colors.ink,fontWeight:'800'},
  stickyWrap:{backgroundColor:colors.background,paddingVertical:6},
  head:{gap:6,alignItems:'flex-start'},
  eyebrow:{color:colors.brand,fontSize:11,fontWeight:'900',letterSpacing:1.4,marginTop:8},
  titleRow:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:10},
  title:{color:colors.ink,fontSize:26,fontWeight:'900'},
  sub:{color:colors.muted,fontSize:13,lineHeight:19},
  summary:{flexDirection:'row',flexWrap:'wrap',gap:8},
  tile:{flexGrow:1,flexBasis:'45%',minWidth:140,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:'#E8DED0',padding:12,gap:2},
  tileAmber:{backgroundColor:'#FFF4DC',borderColor:'#F1CF83'},
  tileNavy:{backgroundColor:colors.navy,borderColor:colors.navy},
  tileLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:.6},
  tileLabelNavy:{color:'#C9D6E6'},
  tileValue:{color:colors.ink,fontSize:20,fontWeight:'900',fontVariant:['tabular-nums']},
  tileValueAmber:{color:colors.warning},
  tileValueNavy:{color:'#FFFFFF'},
  overfill:{backgroundColor:'#FDECEA',borderRadius:radius.md,borderWidth:1,borderColor:'#F3B4AE',padding:12},
  overfillText:{color:colors.danger,fontSize:13,fontWeight:'800',lineHeight:19},
  card:{backgroundColor:colors.surface,borderRadius:radius.lg,padding:17,gap:10,borderWidth:1,borderColor:'#E8DED0'},
  detail:{flexDirection:'row',justifyContent:'space-between',gap:14},
  detailLabel:{color:colors.muted,fontSize:13},
  detailValue:{color:colors.ink,fontSize:13,fontWeight:'700',textAlign:'right',flexShrink:1},
  detailStrong:{fontWeight:'900'},
  destGroup:{gap:2},
  destLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:.8,marginTop:4},
  destRow:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:7,borderTopWidth:1,borderTopColor:'#EFEAE1'},
  destName:{color:colors.ink,fontSize:13,flex:1,minWidth:0},
  destValue:{color:colors.ink,fontSize:13,fontWeight:'900',fontVariant:['tabular-nums']},
  adjustment:{backgroundColor:'#FFF4DC',borderRadius:radius.md,borderWidth:1,borderColor:'#F1CF83',padding:14,gap:6},
  adjustmentTitle:{color:colors.warning,fontSize:13,fontWeight:'900'},
  danger:{marginTop:12,paddingTop:16,borderTopWidth:1,borderTopColor:colors.line,gap:10},
  dangerNote:{color:colors.muted,fontSize:12,textAlign:'center'},
});
