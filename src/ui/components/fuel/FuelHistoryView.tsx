import {useMemo} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {FuelMovement} from '../../../domain/fuel';
import type {DieselBatchOverview} from '../../../domain/fuelBatches';
import {buildHistoryDays,historySummary} from '../../../domain/fuelBatchViews';
import {formatLitres} from '../../../domain/fuelFillForm';
import {colors,radius} from '../../theme';
import {EmptyState} from '../AppPrimitives';
import {FuelDayCard,SectionTitle} from './FuelBatchParts';

/**
 * The Fuel Management History tab in the approved day-card design: a summary of the records shown, then
 * one card per day holding that day's deliveries, dip readings and fills, newest first. Every record opens
 * when tapped, so it can still be corrected or cancelled. Cancelled records stay visible, struck through.
 */
type Props={movements:FuelMovement[];hasAnyRecord:boolean;overview:DieselBatchOverview;tankLitres:number;tankKnown:boolean;dateLabel:string;onSelect:(movement:FuelMovement)=>void};

export function FuelHistoryView({movements,hasAnyRecord,overview,tankLitres,tankKnown,dateLabel,onSelect}:Props){
  const days=useMemo(()=>buildHistoryDays(movements,overview),[movements,overview]);
  const summary=historySummary(movements,tankLitres);
  const byId=useMemo(()=>new Map(movements.map(movement=>[movement.id,movement])),[movements]);
  const open=(id:string)=>{const movement=byId.get(id);if(movement)onSelect(movement);};

  return <View style={styles.view}>
    <View style={styles.card}>
      <SectionTitle title="Fuel history"/>
      <View style={styles.grid}>
        <Tile label="Delivered in" value={formatLitres(summary.deliveredLitres)}/>
        <Tile label="Filled out" value={formatLitres(summary.filledLitres)}/>
        <Tile label="Dip adjustments" value={formatLitres(summary.adjustmentLitres)} tone="amber"/>
        <Tile label="Diesel in tank" value={tankKnown?formatLitres(tankLitres):'Unknown'} tone="navy"/>
      </View>
      <Text style={styles.meta}>{summary.records} record{summary.records===1?'':'s'} · {summary.days} day{summary.days===1?'':'s'} · {dateLabel}</Text>
    </View>

    <SectionTitle title="Records by day" detail="newest first · one card per day"/>
    {days.length?days.map(day=><FuelDayCard key={day.day} card={{day:day.day,label:day.label,total:day.outLitres,groups:day.fills}} onSelectRow={open}
      extraGroups={[{title:'DELIVERIES IN',rows:day.deliveries},{title:'DIP READINGS',rows:day.dips}]}
      headerRight={<Text style={styles.inOut}>{day.inLitres>0?<>In <Text style={styles.inOutValue}>{formatLitres(day.inLitres)}</Text>{'  ·  '}</>:null}Out <Text style={styles.inOutValue}>{formatLitres(day.outLitres)}</Text></Text>}/>)
      :<EmptyState title={hasAnyRecord?'No matching fuel records':'No fuel records yet'} body={hasAnyRecord?'Change or clear one of the filters.':'Set a fuel price or record a purchase, fill, or tank reading.'}/>}
    {days.length?<Text style={styles.meta}>Tap any record to open it, correct it or cancel it. Cancelled records stay visible, struck through, and never count in a total.</Text>:null}
  </View>;
}

function Tile({label,value,tone='white'}:{label:string;value:string;tone?:'white'|'amber'|'navy'}){
  return <View style={[styles.tile,tone==='amber'&&styles.tileAmber,tone==='navy'&&styles.tileNavy]}>
    <Text style={[styles.tileLabel,tone==='navy'&&styles.tileLabelNavy]}>{label.toUpperCase()}</Text>
    <Text style={[styles.tileValue,tone==='amber'&&styles.tileValueAmber,tone==='navy'&&styles.tileValueNavy]}>{value}</Text>
  </View>;
}

const styles=StyleSheet.create({
  view:{gap:16},
  card:{backgroundColor:colors.surface,borderRadius:radius.lg,padding:17,gap:10,borderWidth:1,borderColor:'#E8DED0'},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:8},
  tile:{flexGrow:1,flexBasis:'45%',minWidth:130,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:'#E8DED0',padding:12,gap:2},
  tileAmber:{backgroundColor:'#FFF4DC',borderColor:'#F1CF83'},
  tileNavy:{backgroundColor:colors.navy,borderColor:colors.navy},
  tileLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:.6},
  tileLabelNavy:{color:'#C9D6E6'},
  tileValue:{color:colors.ink,fontSize:20,fontWeight:'900',fontVariant:['tabular-nums']},
  tileValueAmber:{color:colors.warning},
  tileValueNavy:{color:'#FFFFFF'},
  meta:{color:colors.muted,fontSize:12,lineHeight:17},
  inOut:{color:colors.muted,fontSize:13},
  inOutValue:{color:colors.ink,fontSize:14,fontWeight:'900',fontVariant:['tabular-nums']},
});
