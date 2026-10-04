import {useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {FuelDestinationType,FuelMovement} from '../../../domain/fuel';
import type {DieselBatchOverview} from '../../../domain/fuelBatches';
import {batchDestinationTotals,buildFillRows,filterUsageFills,fuelUsageSummary,groupFillsByDay,type DestinationTotal,type UsageFilter} from '../../../domain/fuelBatchViews';
import {formatLitres,formatMoney} from '../../../domain/fuelFillForm';
import {colors,radius} from '../../theme';
import {AppField,EmptyState} from '../AppPrimitives';
import {CollapsibleFilterCard} from '../CollapsibleFilterCard';
import {DatePickerField} from '../DatePickerField';
import {SegmentedChoice} from '../SegmentedChoice';
import {DieselPdfExportPanel} from './DieselPdfExportPanel';
import type {DieselExportFilter} from './DieselBatchesPanel';
import {FuelDayCard,SectionTitle} from './FuelBatchParts';

/**
 * The Fuel Management Usage tab in the approved design, the same as a project's Equipment Fuel view but
 * for every destination: the fuel used by source and its cost, totals by destination, totals by source,
 * then the fills one card per day. Tapping a project, site or Unassigned shows only its fills and offers a
 * PDF of just that destination.
 */
type Props={movements:FuelMovement[];overview:DieselBatchOverview;onSelectFill:(fill:FuelMovement)=>void;onExport:(filter:DieselExportFilter,includePrices:boolean)=>Promise<void>};
type TypeChoice='all'|FuelDestinationType;
const LABEL:Record<FuelDestinationType,string>={project:'PROJECTS',company_site:'COMPANY SITES',unassigned:'UNASSIGNED'};

export function FuelUsageView({movements,overview,onSelectFill,onExport}:Props){
  const[type,setType]=useState<TypeChoice>('all'),[chosen,setChosen]=useState<DestinationTotal|null>(null),[query,setQuery]=useState(''),[fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState('');
  const filter:UsageFilter={destinationType:chosen?chosen.type:type==='all'?undefined:type,destinationId:chosen?.destinationId??undefined,fromDate:fromDate||undefined,toDate:toDate||undefined,query:query||undefined};
  const fills=useMemo(()=>filterUsageFills(movements,filter),[movements,filter.destinationType,filter.destinationId,filter.fromDate,filter.toDate,filter.query]);
  const summary=fuelUsageSummary(movements,overview,filter);
  const rows=useMemo(()=>buildFillRows(fills,overview),[fills,overview]);
  const totals=batchDestinationTotals(buildFillRows(filterUsageFills(movements,{...filter,destinationType:type==='all'?undefined:type,destinationId:undefined}),overview));
  const days=groupFillsByDay(rows,{byDestination:true});
  const byId=useMemo(()=>new Map(movements.map(movement=>[movement.id,movement])),[movements]);
  const hasAnyFill=movements.some(movement=>movement.type==='fill'&&movement.status==='Active');
  const filtersOn=(type!=='all'?1:0)+(query.trim()?1:0)+(fromDate?1:0)+(toDate?1:0);
  const exportFilter:DieselExportFilter={fromDate:fromDate||undefined,toDate:toDate||undefined,...(chosen?chosen.type==='project'?{projectId:chosen.destinationId??undefined}:chosen.type==='company_site'?{companySiteId:chosen.destinationId??undefined}:{unassigned:true}:{})};

  return <View style={styles.view}>
    <View style={styles.card}>
      <SectionTitle title={chosen?chosen.name:'Fuel used by destination'}/>
      <View style={styles.big}><Text style={styles.bigLabel}>Total fuel used</Text><Text style={styles.bigValue}>{formatLitres(summary.totalLitres)}</Text></View>
      <Row label="From tank · batches" value={formatLitres(summary.tankBatchLitres)}/>
      <Row label="From tank · before batches" value={formatLitres(summary.beforeBatchesLitres)}/>
      {summary.gasolineLitres>0?<Row label="Gasoline" value={formatLitres(summary.gasolineLitres)}/>:null}
      <Row label="Outside stations" value={formatLitres(summary.stationLitres)}/>
      <View style={styles.cost}>
        <Text style={styles.costLabel}>Fuel cost</Text>
        <View style={styles.costSide}><Text style={styles.costValue}>{summary.costUsd==null?'Unpriced':formatMoney(summary.costUsd)}</Text>{summary.costUsd!=null&&summary.unpricedLitres>0?<Text style={styles.costNote}>+ {formatLitres(summary.unpricedLitres)} Unpriced</Text>:null}</View>
      </View>
      <Text style={styles.meta}>{summary.fillCount} fill{summary.fillCount===1?'':'s'} · {summary.equipmentCount} equipment · {summary.destinationCount} destination{summary.destinationCount===1?'':'s'} · {summary.dayCount} day{summary.dayCount===1?'':'s'}</Text>
    </View>

    {chosen?<View style={styles.chosen}>
      <Text style={styles.chosenText}>Showing only {chosen.type==='unassigned'?'Unassigned fills':chosen.name}</Text>
      <TouchableOpacity style={styles.chip} onPress={()=>setChosen(null)} accessibilityRole="button" accessibilityLabel="Show every destination again"><Text style={styles.chipText}>Show all destinations  ×</Text></TouchableOpacity>
    </View>:totals.length?<View style={styles.card}>
      <SectionTitle title="By destination"/>
      {(['project','company_site','unassigned'] as const).map(kind=>{const list=totals.filter(total=>total.type===kind);return list.length?<View key={kind} style={styles.destGroup}>
        <Text style={styles.destLabel}>{LABEL[kind]}</Text>
        {list.map(total=><TouchableOpacity key={`${kind}:${total.destinationId??total.name}`} style={styles.destRow} onPress={()=>setChosen(total)} accessibilityRole="button" accessibilityLabel={`${total.name}, ${formatLitres(total.litres)}`} accessibilityHint="Shows only this destination's fills and its PDF">
          <Text style={styles.destName}>{total.name}</Text><Text style={styles.destValue}>{formatLitres(total.litres)}  ›</Text>
        </TouchableOpacity>)}
      </View>:null;})}
      <Text style={styles.meta}>Tap a destination to show only its fills and export its own PDF.</Text>
    </View>:null}

    {summary.bySource.length?<View style={styles.card}>
      <SectionTitle title="By source"/>
      {summary.bySource.map(item=><Row key={item.key} label={item.label} value={formatLitres(item.litres)}/>)}
    </View>:null}

    <CollapsibleFilterCard title="Filter fuel usage" summary={filtersOn?`${filtersOn} filter${filtersOn===1?'':'s'} on · ${fills.length} fill${fills.length===1?'':'s'}`:`${fills.length} fill${fills.length===1?'':'s'}`}>
      <SegmentedChoice label="Destinations" options={[{id:'all',label:'All'},{id:'project',label:'Projects'},{id:'company_site',label:'Sites'},{id:'unassigned',label:'Unassigned'}]} selectedId={type} onSelect={next=>{setType(next);setChosen(null);}} mode="tabs"/>
      <AppField label="Search destination, equipment, station or note" value={query} onChangeText={setQuery} autoCorrect={false} returnKeyType="search"/>
      <View style={styles.pair}><View style={styles.flex}><DatePickerField label="From date" value={fromDate} onChange={setFromDate} allowClear/></View><View style={styles.flex}><DatePickerField label="To date" value={toDate} onChange={setToDate} minDate={fromDate||undefined} allowClear/></View></View>
      {filtersOn?<TouchableOpacity style={styles.clear} onPress={()=>{setType('all');setQuery('');setFromDate('');setToDate('');setChosen(null);}} accessibilityRole="button"><Text style={styles.clearText}>Clear all</Text></TouchableOpacity>:null}
    </CollapsibleFilterCard>

    <SectionTitle title="Fills by day" detail="newest first · one card per day"/>
    {days.length?days.map(card=><FuelDayCard key={card.day} card={card} onSelectRow={id=>{const fill=byId.get(id);if(fill)onSelectFill(fill);}}/>)
      :<EmptyState title={hasAnyFill?'No fills match':'No equipment fills yet'} body={hasAnyFill?'Change or clear the filters, or show every destination.':'Record an equipment fill and choose where the fuel went. Each day appears here as its own card.'}/>}

    <DieselPdfExportPanel label={chosen?`Export ${chosen.type==='unassigned'?'Unassigned':chosen.name} PDF`:'Export Usage PDF'} scope={chosen?`A Diesel Batch Report of every diesel fill to ${chosen.type==='unassigned'?'no destination (Unassigned)':chosen.name}${fromDate||toDate?' in the dates chosen':''}, by day.`:'A Diesel Batch Report of every diesel fill in the dates chosen, by destination and day. Tap a destination above for its own PDF.'} onExport={includePrices=>onExport(exportFilter,includePrices)}/>
  </View>;
}

function Row({label,value}:{label:string;value:string}){
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>;
}

const styles=StyleSheet.create({
  view:{gap:16},
  flex:{flex:1,minWidth:0},
  pair:{flexDirection:'row',gap:10},
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
  meta:{color:colors.muted,fontSize:12,lineHeight:17},
  destGroup:{gap:2},
  destLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:.8,marginTop:4},
  destRow:{minHeight:48,flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12,borderTopWidth:1,borderTopColor:'#EFEAE1'},
  destName:{color:colors.ink,fontSize:13,flex:1,minWidth:0},
  destValue:{color:colors.navy,fontSize:13,fontWeight:'900',fontVariant:['tabular-nums']},
  chosen:{gap:8,padding:14,borderRadius:radius.lg,backgroundColor:'#EAF1F6',borderWidth:1,borderColor:colors.navy},
  chosenText:{color:colors.navy,fontSize:13,fontWeight:'900'},
  chip:{alignSelf:'flex-start',minHeight:40,justifyContent:'center',paddingHorizontal:12,borderRadius:999,borderWidth:1,borderColor:colors.navy,backgroundColor:colors.surface},
  chipText:{color:colors.navy,fontSize:12,fontWeight:'800'},
  clear:{minHeight:44,justifyContent:'center',alignSelf:'flex-start'},
  clearText:{color:colors.brand,fontSize:13,fontWeight:'900'},
});
