import {useMemo,useState} from 'react';
import {Alert,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {localDateKey,type FuelMovement,type FuelSetup} from '../../../domain/fuel';
import type {BatchDetail,DieselBatchOverview,StartDieselBatchesDraft} from '../../../domain/fuelBatches';
import {buildFillRows,filterBatchList,fuelDayLabel,groupFillsByDay,tankCardRows,type BatchListFilter} from '../../../domain/fuelBatchViews';
import {formatLitres} from '../../../domain/fuelFillForm';
import {colors,radius} from '../../theme';
import {AppButton,AppCard,AppField,EmptyState,Feedback} from '../AppPrimitives';
import {CollapsibleFilterCard} from '../CollapsibleFilterCard';
import {DatePickerField} from '../DatePickerField';
import {SearchableSelect} from '../SearchableSelect';
import {SegmentedChoice} from '../SegmentedChoice';
import {BatchStatusBadge,FuelDayCard,GroupHeader,SectionTitle} from './FuelBatchParts';
import {DieselPdfExportPanel} from './DieselPdfExportPanel';

export type DieselExportFilter={batchId?:string;projectId?:string;companySiteId?:string;stationId?:string;fromDate?:string;toDate?:string};

/**
 * DEC-492, Screen A of the approved design: the tank, the open batches oldest first, then closed batches,
 * outside station fills, history from before batches, and gasoline, each behind its own header.
 */
type Props={
  setup:FuelSetup;
  overview:DieselBatchOverview;
  movements:FuelMovement[];
  ledgerBalance:number;
  hasKnownBalance:boolean;
  lastDipAt:string|null;
  onRecordFill:()=>void;
  onRecordDelivery:()=>void;
  onOpenBatch:(batch:BatchDetail)=>void;
  onOpenHistory:()=>void;
  onStart:(draft:StartDieselBatchesDraft)=>Promise<void>;
  onExport:(filter:DieselExportFilter,includePrices:boolean)=>Promise<void>;
};
type Source='all'|'tank'|'station';
type Status='all'|'open'|'closed'|'cancelled';
const RECENT_DAYS=10;

export function DieselBatchesPanel({setup,overview,movements,ledgerBalance,hasKnownBalance,lastDipAt,onRecordFill,onRecordDelivery,onOpenBatch,onOpenHistory,onStart,onExport}:Props){
  const[open,setOpen]=useState<Set<string>>(new Set());
  const[projectId,setProjectId]=useState(''),[companySiteId,setCompanySiteId]=useState(''),[stationId,setStationId]=useState(''),[source,setSource]=useState<Source>('all'),[status,setStatus]=useState<Status>('all'),[fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState(''),[search,setSearch]=useState('');
  const toggle=(key:string)=>setOpen(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});

  const rows=useMemo(()=>buildFillRows(movements,overview),[movements,overview]);
  const filter:BatchListFilter={status:status==='all'?undefined:status,projectId:projectId||undefined,companySiteId:companySiteId||undefined,fromDate:fromDate||undefined,toDate:toDate||undefined,search:search||undefined};
  const batches=filterBatchList(overview.batches,rows,filter);
  const openBatches=batches.filter(batch=>batch.status==='in_use'||batch.status==='waiting');
  const closedBatches=batches.filter(batch=>batch.status==='closed'||batch.status==='cancelled').reverse();
  const inRange=(day:string)=>(!fromDate||day>=fromDate)&&(!toDate||day<=toDate);
  const matches=(row:typeof rows[number])=>inRange(row.day)&&(!projectId||(row.destinationType==='project'&&row.destinationId===projectId))&&(!companySiteId||(row.destinationType==='company_site'&&row.destinationId===companySiteId));
  const stationName=setup.fuelStations.find(station=>station.id===stationId)?.name;
  const stationRows=rows.filter(row=>row.source.kind==='station'&&matches(row)&&(!stationId||row.stationId===stationId));
  const beforeRows=rows.filter(row=>row.source.kind==='before'&&matches(row));
  const gasolineRows=rows.filter(row=>row.source.kind==='gasoline'&&matches(row));
  const showTank=source!=='station',showStation=source!=='tank';

  const chips:[string,()=>void][]=[];
  if(projectId)chips.push([`Project: ${setup.projects.find(project=>project.id===projectId)?.name??'Selected project'}`,()=>setProjectId('')]);
  if(companySiteId)chips.push([`Site: ${setup.companySites.find(site=>site.id===companySiteId)?.name??'Selected site'}`,()=>setCompanySiteId('')]);
  if(stationId)chips.push([`Station: ${stationName??'Selected station'}`,()=>setStationId('')]);
  if(source!=='all')chips.push([source==='tank'?'From tank only':'Outside stations only',()=>setSource('all')]);
  if(status!=='all')chips.push([`Status: ${status==='open'?'Open':status==='closed'?'Closed':'Cancelled'}`,()=>setStatus('all')]);
  if(fromDate)chips.push([`From ${fuelDayLabel(fromDate)}`,()=>setFromDate('')]);
  if(toDate)chips.push([`To ${fuelDayLabel(toDate)}`,()=>setToDate('')]);
  if(search.trim())chips.push([`Search: ${search.trim()}`,()=>setSearch('')]);
  const clearAll=()=>{setProjectId('');setCompanySiteId('');setStationId('');setSource('all');setStatus('all');setFromDate('');setToDate('');setSearch('');};
  const litres=(list:typeof rows)=>formatLitres(list.reduce((sum,row)=>sum+row.litres,0));

  if(!overview.started)return <StartBatchesCard ledgerBalance={ledgerBalance} hasKnownBalance={hasKnownBalance} onStart={onStart}/>;

  return <View style={styles.panel}>
    <View style={styles.tank} accessibilityLabel={`Diesel in tank ${formatLitres(overview.tankLitres)}`}>
      <Text style={styles.tankLabel}>DIESEL IN TANK</Text>
      <Text style={styles.tankValue}>{formatLitres(overview.tankLitres)}</Text>
      {tankCardRows(overview).map(row=><View key={row.id} style={styles.tankRow}><Text style={styles.tankRowText}>{row.label}</Text><Text style={styles.tankRowText}>{row.value}</Text></View>)}
      <Text style={styles.tankFoot}>{tankCardRows(overview).length} open batch{tankCardRows(overview).length===1?'':'es'} · {lastDipAt?`Last dip ${fuelDayLabel(localDateKey(lastDipAt))}`:'No dip reading since batches started'}</Text>
      {overview.overfillAlert?<View style={styles.overfill} accessibilityRole="alert"><Text style={styles.overfillText}>Overfill Alert: {formatLitres(overview.outstandingShortfallLitres)} filled with no diesel left in any batch. Record the missing delivery or a dip reading.</Text></View>:null}
    </View>

    <View style={styles.pair}>
      <View style={styles.flex}><AppButton label="Record Fill" tone="primary" onPress={onRecordFill}/></View>
      <View style={styles.flex}><AppButton label="Record Delivery" tone="secondary" onPress={onRecordDelivery}/></View>
    </View>

    <CollapsibleFilterCard title="Filter fuel records" summary={chips.length?`${chips.length} filter${chips.length===1?'':'s'} on · ${batches.length} batch${batches.length===1?'':'es'}`:'All batches and fills'}>
      <AppField label="Search batch or invoice number" value={search} onChangeText={setSearch} placeholder="DSL-2026-00004 or 55821"/>
      <SegmentedChoice label="Source" options={[{id:'all',label:'All'},{id:'tank',label:'From tank'},{id:'station',label:'Stations'}]} selectedId={source} onSelect={setSource} mode="tabs"/>
      <SegmentedChoice label="Batch status" options={[{id:'all',label:'All'},{id:'open',label:'Open'},{id:'closed',label:'Closed'},{id:'cancelled',label:'Cancelled'}]} selectedId={status} onSelect={setStatus} mode="tabs"/>
      <SearchableSelect label="Project" options={setup.projects.map(project=>({id:project.id,label:project.name,detail:project.detail}))} selectedId={projectId} onSelect={setProjectId} placeholder="All projects" allowClear/>
      <SearchableSelect label="Company site" options={setup.companySites.map(site=>({id:site.id,label:site.name,detail:site.isActive?undefined:'Inactive'}))} selectedId={companySiteId} onSelect={setCompanySiteId} placeholder="All company sites" allowClear/>
      <SearchableSelect label="Station" options={setup.fuelStations.map(station=>({id:station.id,label:station.name,detail:station.isActive?station.location??undefined:'Inactive'}))} selectedId={stationId} onSelect={setStationId} placeholder="All stations" allowClear/>
      <View style={styles.pair}><View style={styles.flex}><DatePickerField label="From date" value={fromDate} onChange={setFromDate} allowClear/></View><View style={styles.flex}><DatePickerField label="To date" value={toDate} onChange={setToDate} minDate={fromDate||undefined} allowClear/></View></View>
      <DieselPdfExportPanel label="Export PDF" scope="A Diesel Batch Report of the fills that match the project, company site, station and dates chosen above. To export one batch, open it." onExport={includePrices=>onExport({projectId:projectId||undefined,companySiteId:companySiteId||undefined,stationId:stationId||undefined,fromDate:fromDate||undefined,toDate:toDate||undefined},includePrices)}/>
    </CollapsibleFilterCard>
    {chips.length?<View style={styles.chips}>
      {chips.map(([label,remove])=><TouchableOpacity key={label} style={styles.chip} onPress={remove} accessibilityRole="button" accessibilityLabel={`Remove filter ${label}`}><Text style={styles.chipText}>{label}  ×</Text></TouchableOpacity>)}
      <TouchableOpacity style={styles.chip} onPress={clearAll} accessibilityRole="button"><Text style={[styles.chipText,styles.clear]}>Clear all</Text></TouchableOpacity>
    </View>:null}

    {showTank?<>
      <SectionTitle title="Open batches" detail={`${openBatches.length} · oldest first`}/>
      {openBatches.length?openBatches.map(batch=><BatchCard key={batch.id} batch={batch} firstOpen={overview.batches.find(value=>value.status==='in_use')} onPress={()=>onOpenBatch(batch)}/>)
        :<EmptyState title="No open batch" body={chips.length?'No open batch matches these filters.':'Record a diesel delivery to start one.'}/>}

      <GroupHeader title="Closed batches" summary={`${closedBatches.length} · ${formatLitres(closedBatches.filter(batch=>batch.status==='closed').reduce((sum,batch)=>sum+batch.deliveredLitres,0))} delivered`} open={open.has('closed')} onToggle={()=>toggle('closed')}/>
      {open.has('closed')?(closedBatches.length?<View style={styles.list}>{closedBatches.map(batch=><TouchableOpacity key={batch.id} style={styles.closedRow} onPress={()=>onOpenBatch(batch)} accessibilityRole="button" accessibilityLabel={`${batch.batchNumber}, ${batch.status}`}>
        <View style={styles.flex}>
          <Text style={styles.closedNumber}>{batch.batchNumber}{batch.kind==='opening'?' · Opening stock':''}</Text>
          <Text style={[styles.sub,batch.openingBasis==='calculated'&&styles.amber]}>{batch.openingBasis==='calculated'?'Calculated (no dip reading)':`Invoice ${batch.invoiceNumber??'not recorded'}`} · Arrived {fuelDayLabel(localDateKey(batch.arrivedAt))}</Text>
        </View>
        <View style={styles.closedSide}><BatchStatusBadge status={batch.status}/><Text style={styles.sub}>{formatLitres(batch.deliveredLitres)}</Text></View>
      </TouchableOpacity>)}</View>:<EmptyState title="No closed batches" body="A batch closes by itself when its last litre is used."/>):null}
    </>:null}

    {showStation?<>
      <GroupHeader title="Outside station fills" summary={`${stationRows.length} · ${litres(stationRows)}`} open={open.has('station')} onToggle={()=>toggle('station')}/>
      {open.has('station')?(stationRows.length?<View style={styles.list}>{groupFillsByDay(stationRows,{byDestination:true}).slice(0,RECENT_DAYS).map(card=><FuelDayCard key={card.day} card={card}/>)}<Text style={styles.note}>Outside station fills do not change the tank.</Text></View>
        :<EmptyState title="No outside station fills" body="Choose Outside station on Record Fill when equipment is filled away from your tank."/>):null}
    </>:null}

    {showTank?<>
      <GroupHeader title="Before batches history" summary={`${beforeRows.length} fill${beforeRows.length===1?'':'s'} · ${litres(beforeRows)}`} open={open.has('before')} onToggle={()=>toggle('before')}/>
      {open.has('before')?<View style={styles.list}>
        {groupFillsByDay(beforeRows,{byDestination:true}).slice(0,RECENT_DAYS).map(card=><FuelDayCard key={card.day} card={card}/>)}
        <Text style={styles.note}>Records from before diesel batches started are never assigned to a batch. The {RECENT_DAYS} most recent days are shown here.</Text>
        <AppButton label="Open Full Fuel History" tone="secondary" onPress={onOpenHistory}/>
      </View>:null}
      <GroupHeader title="Gasoline" summary={`unchanged · ${gasolineRows.length} fill${gasolineRows.length===1?'':'s'} · ${litres(gasolineRows)}`} open={open.has('gasoline')} onToggle={()=>toggle('gasoline')}/>
      {open.has('gasoline')?<View style={styles.list}>
        {gasolineRows.length?groupFillsByDay(gasolineRows,{byDestination:true}).slice(0,RECENT_DAYS).map(card=><FuelDayCard key={card.day} card={card}/>):<EmptyState title="No gasoline fills" body="Gasoline is bought as needed and never changes the diesel tank."/>}
      </View>:null}
    </>:null}
  </View>;
}

function BatchCard({batch,firstOpen,onPress}:{batch:BatchDetail;firstOpen:BatchDetail|undefined;onPress:()=>void}){
  const available=batch.deliveredLitres+Math.max(batch.adjustmentLitres,0);
  const used=Math.min(1,Math.max(0,available>0?(available-batch.remainingLitres)/available:1));
  const note=batch.adjustmentLitres!==0?`Includes ${formatLitres(batch.adjustmentLitres)} dip adjustment`:batch.status==='waiting'&&firstOpen?`Starts after ${firstOpen.batchNumber} is used up`:null;
  return <TouchableOpacity style={styles.batch} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${batch.batchNumber}, ${batch.status==='in_use'?'open, in use':'open, waiting'}, ${formatLitres(batch.remainingLitres)} remaining`}>
    <View style={styles.batchTop}>
      <View style={styles.flex}><Text style={styles.batchNumber}>{batch.batchNumber}{batch.kind==='opening'?' · Opening stock':''}</Text><Text style={styles.sub}>{batch.kind==='opening'?(batch.openingBasis==='calculated'?'Calculated (no dip reading)':'From a dip reading'):`Invoice ${batch.invoiceNumber??'not recorded'}`} · Arrived {fuelDayLabel(localDateKey(batch.arrivedAt))}</Text></View>
      <BatchStatusBadge status={batch.status}/>
    </View>
    <View style={styles.figures}>
      <Figure label="Delivered" value={formatLitres(batch.deliveredLitres)}/>
      <Figure label="Filled" value={formatLitres(batch.filledLitres)}/>
      <Figure label="Remaining" value={formatLitres(batch.remainingLitres)} strong/>
    </View>
    <View style={styles.bar} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.barFill,{width:`${Math.round(used*100)}%`}]}/></View>
    {note?<Text style={[styles.sub,batch.adjustmentLitres!==0&&styles.amber]}>{note}</Text>:null}
  </TouchableOpacity>;
}

function Figure({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <View style={styles.figure}><Text style={styles.figureLabel}>{label.toUpperCase()}</Text><Text style={[styles.figureValue,strong&&styles.figureStrong]}>{value}</Text></View>;
}

function StartBatchesCard({ledgerBalance,hasKnownBalance,onStart}:{ledgerBalance:number;hasKnownBalance:boolean;onStart:(draft:StartDieselBatchesDraft)=>Promise<void>}){
  const[dip,setDip]=useState(''),[price,setPrice]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const opening=dip.trim()?`${dip.trim()} L from your dip reading`:`${formatLitres(Math.max(ledgerBalance,0))} from the calculated tank balance, labelled "Calculated (no dip reading)"`;
  const start=()=>Alert.alert('Start diesel batches?',`The Opening stock batch will hold ${opening}. From now on every diesel delivery becomes a numbered batch. Earlier records stay as they are, marked "Before batches". This is done once and cannot be undone.`,[
    {text:'Not yet',style:'cancel'},
    {text:'Start Diesel Batches',onPress:()=>{void (async()=>{setBusy(true);setError(null);try{await onStart({dipLitres:dip,pricePerLitreUsd:price});}catch(cause){setError(cause instanceof Error?cause.message:'Diesel batches could not be started.');}finally{setBusy(false);}})();}},
  ]);
  return <AppCard title="Start diesel batches" hint="Track each diesel delivery as its own numbered batch, used first in, first out, so you can see where every delivery went. Nothing you recorded before changes.">
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <View style={styles.startRow}><Text style={styles.sub}>Calculated tank balance now</Text><Text style={styles.startValue}>{hasKnownBalance?formatLitres(ledgerBalance):'Unknown until a dip reading'}</Text></View>
    <AppField label="Dip reading now, in litres (optional, recommended)" value={dip} onChangeText={setDip} keyboardType="decimal-pad" placeholder="Not recorded"/>
    <Text style={styles.sub}>With a dip reading, the Opening stock batch holds exactly what is in the tank. Without one, it uses the calculated balance and is labelled "Calculated (no dip reading)".</Text>
    <AppField label="Opening stock price per litre (optional)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="Unpriced"/>
    <AppButton label="Start Diesel Batches" tone="primary" busy={busy} onPress={start}/>
  </AppCard>;
}

const styles=StyleSheet.create({
  panel:{gap:16},
  flex:{flex:1,minWidth:0},
  pair:{flexDirection:'row',gap:10},
  list:{gap:12},
  tank:{backgroundColor:colors.navy,borderRadius:radius.lg,padding:17,gap:2},
  tankLabel:{color:'#C9D6E6',fontSize:12,fontWeight:'900',letterSpacing:1.2},
  tankValue:{color:colors.cream,fontSize:34,fontWeight:'900',marginBottom:8,fontVariant:['tabular-nums']},
  tankRow:{flexDirection:'row',justifyContent:'space-between',gap:10,paddingVertical:6,borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.18)'},
  tankRowText:{color:colors.cream,fontSize:13,fontVariant:['tabular-nums']},
  tankFoot:{color:'#C9D6E6',fontSize:12,marginTop:8},
  overfill:{marginTop:10,backgroundColor:'#FDECEA',borderRadius:radius.sm,padding:12},
  overfillText:{color:colors.danger,fontSize:13,fontWeight:'800',lineHeight:19},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:8},
  chip:{minHeight:40,justifyContent:'center',paddingHorizontal:12,borderRadius:999,borderWidth:1,borderColor:colors.navy,backgroundColor:colors.surface},
  chipText:{color:colors.navy,fontSize:12,fontWeight:'800'},
  clear:{color:colors.brand},
  batch:{backgroundColor:colors.surface,borderRadius:radius.lg,padding:16,gap:10,borderWidth:1,borderColor:'#E8DED0'},
  batchTop:{flexDirection:'row',alignItems:'flex-start',gap:10},
  batchNumber:{color:colors.ink,fontSize:17,fontWeight:'900'},
  sub:{color:colors.muted,fontSize:12,lineHeight:17},
  amber:{color:colors.warning,fontWeight:'800'},
  figures:{flexDirection:'row',gap:8},
  figure:{flex:1,minWidth:0,gap:2},
  figureLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:.5},
  figureValue:{color:colors.ink,fontSize:16,fontWeight:'900',fontVariant:['tabular-nums']},
  figureStrong:{color:colors.navy},
  bar:{height:6,borderRadius:99,backgroundColor:colors.creamSoft,overflow:'hidden'},
  barFill:{height:6,borderRadius:99,backgroundColor:colors.navy},
  closedRow:{flexDirection:'row',gap:12,backgroundColor:colors.surface,borderRadius:radius.md,padding:14,borderWidth:1,borderColor:'#E8DED0',minHeight:56},
  closedNumber:{color:colors.ink,fontSize:15,fontWeight:'900'},
  closedSide:{alignItems:'flex-end',gap:4},
  note:{color:colors.muted,fontSize:12,lineHeight:17},
  startRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',gap:10},
  startValue:{color:colors.ink,fontSize:16,fontWeight:'900'},
});
