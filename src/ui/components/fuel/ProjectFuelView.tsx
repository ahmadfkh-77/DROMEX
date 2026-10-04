import {useMemo,useState,type ReactNode} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {FuelMovement} from '../../../domain/fuel';
import type {DieselBatchOverview} from '../../../domain/fuelBatches';
import {buildFillRows,fuelDayLabel,groupFillsByDay,projectFuelSummary} from '../../../domain/fuelBatchViews';
import {formatLitres,formatMoney} from '../../../domain/fuelFillForm';
import {colors,radius} from '../../theme';
import {EmptyState} from '../AppPrimitives';
import {CollapsibleFilterCard} from '../CollapsibleFilterCard';
import {DatePickerField} from '../DatePickerField';
import {SegmentedChoice} from '../SegmentedChoice';
import {FuelDayCard,GroupHeader,SectionTitle} from './FuelBatchParts';

/**
 * DEC-505, Screen E of the approved design. A project's fuel by source, its cost with unpriced litres
 * counted openly, then its fills one card per day. The project is the only destination here, so the
 * day cards list the fills directly, each with its source tag.
 */
type Props={projectId:string;projectName:string;projectStatus:string;movements:FuelMovement[];overview:DieselBatchOverview;byEquipment:ReactNode;exportAction?:ReactNode};
type Source='all'|'tank_batch'|'before'|'station';

export function ProjectFuelView({projectId,projectName,projectStatus,movements,overview,byEquipment,exportAction}:Props){
  const[source,setSource]=useState<Source>('all'),[fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState(''),[equipmentOpen,setEquipmentOpen]=useState(false);
  const projectMovements=useMemo(()=>movements.filter(movement=>movement.projectId===projectId),[movements,projectId]);
  const summary=useMemo(()=>projectFuelSummary(projectId,projectMovements,overview),[overview,projectId,projectMovements]);
  const rows=useMemo(()=>buildFillRows(projectMovements,overview).filter(row=>(source==='all'||row.source.kind===source)&&(!fromDate||row.day>=fromDate)&&(!toDate||row.day<=toDate)),[fromDate,overview,projectMovements,source,toDate]);
  const days=groupFillsByDay(rows,{byDestination:false});
  const filtersOn=(source!=='all'?1:0)+(fromDate?1:0)+(toDate?1:0);

  return <View style={styles.view}>
    <View style={styles.project}>
      <Text style={styles.projectLabel}>PROJECT</Text>
      <Text style={styles.projectName}>{projectName}</Text>
      <Text style={styles.projectStatus}>{projectStatus}</Text>
    </View>

    <View style={styles.card}>
      <SectionTitle title="Fuel for this project"/>
      <View style={styles.big}><Text style={styles.bigLabel}>Total fuel</Text><Text style={styles.bigValue}>{formatLitres(summary.totalLitres)}</Text></View>
      <Row label="From tank · batches" value={formatLitres(summary.tankBatchLitres)}/>
      <Row label="From tank · before batches" value={formatLitres(summary.beforeBatchesLitres)}/>
      {summary.gasolineLitres>0?<Row label="Gasoline" value={formatLitres(summary.gasolineLitres)}/>:null}
      <Row label="Outside stations" value={formatLitres(summary.stationLitres)}/>
      <View style={styles.cost}>
        <Text style={styles.costLabel}>Fuel cost</Text>
        <View style={styles.costSide}>
          <Text style={styles.costValue}>{summary.costUsd==null?'Unpriced':formatMoney(summary.costUsd)}</Text>
          {summary.costUsd!=null&&summary.unpricedLitres>0?<Text style={styles.costNote}>+ {formatLitres(summary.unpricedLitres)} Unpriced</Text>:null}
        </View>
      </View>
      <Text style={styles.meta}>{summary.fillCount} fill{summary.fillCount===1?'':'s'} · {summary.equipmentCount} equipment · {summary.dayCount} day{summary.dayCount===1?'':'s'}</Text>
    </View>

    {summary.bySource.length?<View style={styles.card}>
      <SectionTitle title="By source"/>
      {summary.bySource.map(item=><Row key={item.key} label={item.label} value={formatLitres(item.litres)}/>)}
    </View>:null}

    <CollapsibleFilterCard title="Filter project fuel" summary={filtersOn?`${filtersOn} filter${filtersOn===1?'':'s'} on · ${rows.length} fill${rows.length===1?'':'s'}`:`${rows.length} fill${rows.length===1?'':'s'}`}>
      <SegmentedChoice label="Source" options={[{id:'all',label:'All'},{id:'tank_batch',label:'Batches'},{id:'before',label:'Before'},{id:'station',label:'Stations'}]} selectedId={source} onSelect={setSource} mode="tabs"/>
      <View style={styles.pair}><View style={styles.flex}><DatePickerField label="From date" value={fromDate} onChange={setFromDate} allowClear/></View><View style={styles.flex}><DatePickerField label="To date" value={toDate} onChange={setToDate} minDate={fromDate||undefined} allowClear/></View></View>
      {filtersOn?<TouchableOpacity style={styles.clear} onPress={()=>{setSource('all');setFromDate('');setToDate('');}} accessibilityRole="button"><Text style={styles.clearText}>Clear all</Text></TouchableOpacity>:null}
    </CollapsibleFilterCard>
    <GroupHeader title="By equipment" summary={`${summary.equipmentCount} equipment`} open={equipmentOpen} onToggle={()=>setEquipmentOpen(value=>!value)}/>
    {equipmentOpen?byEquipment:null}

    <SectionTitle title="Fills by day" detail="newest first · one card per day"/>
    {days.length?days.map(card=><FuelDayCard key={card.day} card={card}/>):<EmptyState title={filtersOn?'No fills match these filters':'No fuel recorded for this project'} body={filtersOn?'Change or clear the filters.':'Fills recorded to this project appear here, one card per day.'}/>}
    {fromDate||toDate?<Text style={styles.meta}>Showing {fromDate?fuelDayLabel(fromDate):'the start'} to {toDate?fuelDayLabel(toDate):'today'}.</Text>:null}
    {exportAction}
  </View>;
}

function Row({label,value}:{label:string;value:string}){
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>;
}

const styles=StyleSheet.create({
  view:{gap:16},
  flex:{flex:1,minWidth:0},
  pair:{flexDirection:'row',gap:10},
  project:{backgroundColor:colors.navy,borderRadius:radius.lg,padding:17,gap:4},
  projectLabel:{color:'#C9D6E6',fontSize:11,fontWeight:'900',letterSpacing:1.2},
  projectName:{color:colors.cream,fontSize:17,fontWeight:'900'},
  projectStatus:{color:'#C9D6E6',fontSize:12,marginTop:2},
  card:{backgroundColor:colors.surface,borderRadius:radius.lg,padding:17,gap:6,borderWidth:1,borderColor:'#E8DED0'},
  big:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',gap:10,paddingVertical:4},
  bigLabel:{color:colors.ink,fontSize:14,fontWeight:'800'},
  bigValue:{color:colors.navy,fontSize:26,fontWeight:'900',fontVariant:['tabular-nums']},
  row:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:7,borderTopWidth:1,borderTopColor:'#EFEAE1'},
  rowLabel:{color:colors.ink,fontSize:13,flex:1,minWidth:0},
  rowValue:{color:colors.ink,fontSize:13,fontWeight:'900',fontVariant:['tabular-nums']},
  cost:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:12,paddingTop:9,marginTop:2,borderTopWidth:1.5,borderTopColor:colors.ink},
  costLabel:{color:colors.ink,fontSize:13,fontWeight:'800'},
  costSide:{alignItems:'flex-end'},
  costValue:{color:colors.ink,fontSize:15,fontWeight:'900',fontVariant:['tabular-nums']},
  costNote:{color:colors.muted,fontSize:12},
  meta:{color:colors.muted,fontSize:12},
  clear:{minHeight:44,justifyContent:'center',alignSelf:'flex-start'},
  clearText:{color:colors.brand,fontSize:13,fontWeight:'900'},
});
