import {useCallback,useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {ContributingRecord,ContributingRecordQuery,ProjectTotalsRepository} from '../../data/repositories/ProjectTotalsRepository';
import {fuelTypeLabels} from '../../domain/fuel';
import type {Project} from '../../domain/loads';
import {
  buildItemLedger,constructionSourceLabels,deliverySourceLabels,describeTotalsRange,emptyTotalsFilters,formatTotalQuantity,
  summarizeConstruction,summarizeFuel,totalsFilterChoices,validateTotalsFilters,
  type ItemLedgerEntry,type Measure,type ProjectTotalsData,type ProjectTotalsFilters,type TotalsView,
} from '../../domain/projectTotals';
import {AppButton,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {DatePickerField} from '../components/DatePickerField';
import {useReducedMotion} from '../components/ExpandableMenu';
import {FocusedSheet} from '../components/FocusedSheet';
import {SearchableSelect} from '../components/SearchableSelect';
import {SegmentedChoice} from '../components/SegmentedChoice';
import {colors} from '../theme';

type Drill={title:string;query:ContributingRecordQuery};
const viewOptions:{id:TotalsView;label:string}[]=[{id:'all',label:'All'},{id:'delivered',label:'Delivered'},{id:'used',label:'Used'}];

/**
 * DEC-481. A project's operational ledger of quantities. Every figure is produced by
 * domain/projectTotals.ts from repository aggregates; this screen only arranges and labels them. Each
 * total states what it counts, in which unit, over which dates, and whether it is delivered or used.
 */
export function ProjectTotalsScreen({project,repository,onBack}:{project:Project;repository:ProjectTotalsRepository;onBack:()=>void}){
  const reducedMotion=useReducedMotion();
  const[filters,setFilters]=useState<ProjectTotalsFilters>(emptyTotalsFilters);
  const[data,setData]=useState<ProjectTotalsData|null>(null);
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[loadError,setLoadError]=useState<string|null>(null);
  const[reload,setReload]=useState(0);
  const[openItems,setOpenItems]=useState<Set<string>>(()=>new Set());
  const[drill,setDrill]=useState<Drill|null>(null);
  const[records,setRecords]=useState<ContributingRecord[]|null>(null);
  const[recordsError,setRecordsError]=useState<string|null>(null);

  const filterIssues=validateTotalsFilters(filters);
  const range={fromDate:filters.fromDate,toDate:filters.toDate};
  useEffect(()=>{
    if(filterIssues.length)return;
    let active=true;setStatus('loading');setLoadError(null);
    repository.getProjectTotals(project.id,range).then(next=>{if(active){setData(next);setStatus('ready');}}).catch(cause=>{if(active){setLoadError(cause instanceof Error?cause.message:'Totals could not be calculated.');setStatus('error');}});
    return()=>{active=false;};
  },[project.id,repository,filters.fromDate,filters.toDate,reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const rangeLabel=describeTotalsRange(filters.fromDate,filters.toDate);
  const ledger=useMemo(()=>data?buildItemLedger(data,filters):[],[data,filters]);
  const fuel=useMemo(()=>data&&filters.view!=='delivered'?summarizeFuel(data.fuel):[],[data,filters.view]);
  const construction=useMemo(()=>data&&filters.view!=='delivered'?summarizeConstruction(data.construction):[],[data,filters.view]);
  const choices=useMemo(()=>data?totalsFilterChoices(data):{items:[],suppliers:[],units:[]},[data]);
  const set=(patch:Partial<ProjectTotalsFilters>)=>setFilters(current=>({...current,...patch}));
  const toggleItem=(key:string)=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setOpenItems(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});};

  const openDrill=useCallback((next:Drill)=>{
    setDrill(next);setRecords(null);setRecordsError(null);
    repository.listContributingRecords(project.id,next.query).then(setRecords).catch(cause=>setRecordsError(cause instanceof Error?cause.message:'Records could not be loaded.'));
  },[project.id,repository]);

  const nothing=data&&!ledger.length&&!fuel.length&&!construction.length;
  return <AppPage keyboard>
    <PageHeader eyebrow="PROJECT TOTALS" title={project.name} onBack={onBack}/>
    <Text style={styles.helper}>Delivered and used quantities are separate facts and are never added together. Every total stays in its own unit; nothing is converted.</Text>

    <View style={styles.filters}>
      <View style={styles.dates}>
        <View style={styles.flex}><DatePickerField label="From" value={filters.fromDate} onChange={fromDate=>set({fromDate})} allowClear placeholder="Any date"/></View>
        <View style={styles.flex}><DatePickerField label="To" value={filters.toDate} onChange={toDate=>set({toDate})} allowClear placeholder="Any date"/></View>
      </View>
      <SearchableSelect label="Item" options={choices.items} selectedId={filters.itemKey} onSelect={itemKey=>set({itemKey})} placeholder="All items" allowClear/>
      <SearchableSelect label="Supplier" options={choices.suppliers} selectedId={filters.supplierKey} onSelect={supplierKey=>set({supplierKey})} placeholder="All suppliers" allowClear/>
      <SearchableSelect label="Unit" options={choices.units} selectedId={filters.unitKey} onSelect={unitKey=>set({unitKey})} placeholder="All units" allowClear/>
      <SegmentedChoice mode="tabs" label="Show" options={viewOptions} selectedId={filters.view} onSelect={view=>set({view})}/>
      <Text style={styles.rangeLine}>Covering: <Text style={styles.rangeValue}>{rangeLabel}</Text></Text>
      {filters.supplierKey?<Text style={styles.helper}>Recorded use is not kept per supplier, so it is hidden while a supplier is selected.</Text>:null}
    </View>

    {filterIssues.length?<Feedback kind="warning">{filterIssues.join(' ')}</Feedback>
      :status==='loading'?<View style={styles.center}><ActivityIndicator color={colors.brand}/><Text style={styles.helper}>Calculating totals…</Text></View>
      :status==='error'?<View style={styles.center}><Feedback kind="error">{loadError??'Totals could not be calculated.'}</Feedback><AppButton label="Try again" tone="secondary" onPress={()=>setReload(value=>value+1)}/></View>
      :nothing?<EmptyState title="Nothing recorded for these filters" body={`No deliveries, recorded use, fuel or construction materials for ${project.name} in ${rangeLabel.toLocaleLowerCase()}. Widen the dates or clear a filter.`}/>
      :<>
        {ledger.length?<Text style={styles.sectionTitle}>Materials by item</Text>:null}
        {ledger.map(item=><ItemCard key={item.itemKey} item={item} rangeLabel={rangeLabel} open={openItems.has(item.itemKey)} onToggle={()=>toggleItem(item.itemKey)} filters={filters} onDrill={openDrill}/>)}

        {fuel.length?<>
          <Text style={styles.sectionTitle}>Fuel used</Text>
          <Text style={styles.helper}>Equipment fills to this project, {rangeLabel.toLocaleLowerCase()}. Each fuel type is totalled on its own.</Text>
          {fuel.map(type=><View key={type.fuelType} style={styles.card}>
            <MeasureRow label={`Total used · ${fuelTypeLabels[type.fuelType]}`} value={{quantity:type.litres,recordCount:type.recordCount}} unitSymbol="L" strong/>
            {type.equipment.map(equipment=><MeasureRow key={equipment.equipmentName} label={equipment.equipmentName} value={{quantity:equipment.litres,recordCount:equipment.recordCount}} unitSymbol="L"/>)}
          </View>)}
        </>:null}

        {construction.length?<>
          <Text style={styles.sectionTitle}>Wall and foundation materials used</Text>
          <Text style={styles.helper}>Actual quantities only, {rangeLabel.toLocaleLowerCase()}. Each source is listed separately and never added together or to Daily Report use, because one pour may be recorded in more than one place.</Text>
          {construction.map(group=><View key={`${group.materialKey}-${group.unitKey}`} style={styles.card}>
            <Text style={styles.cardTitle}>{group.materialLabel} <Text style={styles.unit}>· {group.unitSymbol}</Text></Text>
            {group.sources.map(source=><MeasureRow key={source.source} label={`Used · ${constructionSourceLabels[source.source]}`} value={source} unitSymbol={group.unitSymbol}/>)}
          </View>)}
        </>:null}
      </>}

    <FocusedSheet visible={!!drill} eyebrow="CONTRIBUTING RECORDS" title={drill?.title??''} onClose={()=>setDrill(null)} footer={<AppButton label="Close" tone="secondary" onPress={()=>setDrill(null)}/>}>
      {recordsError?<Feedback kind="error">{recordsError}</Feedback>:!records?<ActivityIndicator color={colors.brand}/>
        :records.length?records.map(record=><View key={`${record.source}-${record.id}`} style={styles.recordRow}>
          <View style={styles.flex}><Text style={styles.recordRef}>{record.reference}</Text><Text style={styles.helper}>{[record.date,record.party].filter(Boolean).join(' · ')}</Text></View>
          <Text style={styles.recordQty}>{formatTotalQuantity(record.quantity,record.unitSymbol)}</Text>
        </View>)
        :<Text style={styles.helper}>No records match.</Text>}
      {records&&records.length>=100?<Text style={styles.helper}>Showing the newest 100 records.</Text>:null}
    </FocusedSheet>
  </AppPage>;
}

function ItemCard({item,rangeLabel,open,onToggle,filters,onDrill}:{item:ItemLedgerEntry;rangeLabel:string;open:boolean;onToggle:()=>void;filters:ProjectTotalsFilters;onDrill:(drill:Drill)=>void}){
  const dates={fromDate:filters.fromDate,toDate:filters.toDate};
  return <View style={styles.card}>
    <View style={styles.cardHead}>
      <View style={styles.flex}><Text style={styles.cardTitle}>{item.itemName}</Text><Text style={styles.helper}>{rangeLabel} · {item.recordCount} record{item.recordCount===1?'':'s'}</Text></View>
    </View>
    {item.units.map(unit=><View key={unit.unitKey} style={styles.unitBlock}>
      <Text style={styles.unitLabel}>{unit.unitSymbol}</Text>
      {filters.view!=='used'?<MeasureRow label={`Total delivered · ${unit.unitSymbol}`} value={unit.delivered} unitSymbol={unit.unitSymbol} strong
        onPress={unit.delivered?()=>onDrill({title:`${item.itemName} delivered (${unit.unitSymbol})`,query:{kind:'delivery',itemKey:item.itemKey,unitKey:unit.unitKey,supplierKey:filters.supplierKey||undefined,...dates}}):undefined}/>:null}
      {filters.view!=='delivered'&&!item.usageHiddenBySupplierFilter?<MeasureRow label={`Total used · ${unit.unitSymbol}`} value={unit.used} unitSymbol={unit.unitSymbol} strong
        onPress={unit.used?()=>onDrill({title:`${item.itemName} used (${unit.unitSymbol})`,query:{kind:'usage',movement:'used',itemKey:item.itemKey,unitKey:unit.unitKey,...dates}}):undefined}/>:null}
      {unit.difference!=null?<MeasureRow label="Delivered minus recorded use" value={{quantity:unit.difference,recordCount:0}} showCount={false} unitSymbol={unit.unitSymbol} note="Not an inventory balance: only what was recorded as delivered and used."/>:null}
      {unit.transported?<MeasureRow label={`Transported (recorded) · ${unit.unitSymbol}`} value={unit.transported} unitSymbol={unit.unitSymbol}
        onPress={()=>onDrill({title:`${item.itemName} transported (${unit.unitSymbol})`,query:{kind:'usage',movement:'transported',itemKey:item.itemKey,unitKey:unit.unitKey,...dates}})}/>:null}
      {open&&unit.delivered?unit.delivered.sources.map(source=><MeasureRow key={source.source} label={`  ${deliverySourceLabels[source.source]}`} value={source} unitSymbol={unit.unitSymbol}/>):null}
    </View>)}
    {item.suppliers.length?<TouchableOpacity style={styles.disclosure} onPress={onToggle} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`Suppliers and sources for ${item.itemName}`}>
      <Text style={styles.disclosureText}>Suppliers and sources · {item.suppliers.length}</Text><Text style={styles.helper}>{open?'Tap to hide':'Tap to view'}</Text>
    </TouchableOpacity>:null}
    {open?item.suppliers.map(supplier=><View key={supplier.supplierKey} style={styles.supplier}>
      <Text style={styles.supplierName}>{supplier.supplierName}</Text>
      {supplier.units.map(value=><MeasureRow key={value.unitKey} label={`Delivered · ${value.unitSymbol}`} value={value} unitSymbol={value.unitSymbol}
        onPress={()=>onDrill({title:`${item.itemName} from ${supplier.supplierName} (${value.unitSymbol})`,query:{kind:'delivery',itemKey:item.itemKey,unitKey:value.unitKey,supplierKey:supplier.supplierKey,source:supplier.source,fromDate:filters.fromDate,toDate:filters.toDate}})}/>)}
    </View>):null}
  </View>;
}

function MeasureRow({label,value,unitSymbol,strong=false,note,onPress,showCount=true}:{label:string;value:Measure|null;unitSymbol:string;strong?:boolean;note?:string;onPress?:()=>void;showCount?:boolean}){
  const content=<>
    <View style={styles.flex}><Text style={[styles.measureLabel,strong&&styles.measureStrong]}>{label}</Text>{note?<Text style={styles.note}>{note}</Text>:null}</View>
    <View style={styles.measureValueBox}>
      {value?<Text style={[styles.measureValue,strong&&styles.measureStrong]}>{formatTotalQuantity(value.quantity,unitSymbol)}</Text>:<Text style={styles.notRecorded}>Not recorded</Text>}
      {value&&showCount?<Text style={styles.count}>{value.recordCount} record{value.recordCount===1?'':'s'}{onPress?' · View':''}</Text>:null}
    </View>
  </>;
  return onPress?<TouchableOpacity style={styles.measure} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value?formatTotalQuantity(value.quantity,unitSymbol):'Not recorded'}. View records.`}>{content}</TouchableOpacity>:<View style={styles.measure}>{content}</View>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  filters:{backgroundColor:colors.surface,borderRadius:16,padding:14,gap:12,borderTopWidth:3,borderTopColor:colors.navy},
  dates:{flexDirection:'row',flexWrap:'wrap',gap:10},
  rangeLine:{color:colors.muted,fontSize:12,fontWeight:'700'},rangeValue:{color:colors.navy,fontWeight:'900'},
  center:{alignItems:'center',gap:12,paddingVertical:24},
  sectionTitle:{color:colors.ink,fontSize:19,fontWeight:'900',marginTop:4},
  card:{backgroundColor:colors.surface,borderRadius:16,padding:14,gap:8,borderLeftWidth:3,borderLeftColor:colors.navy},
  cardHead:{flexDirection:'row',alignItems:'flex-start',gap:10},
  cardTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},unit:{color:colors.muted,fontWeight:'800'},
  unitBlock:{gap:2,paddingTop:6,borderTopWidth:1,borderTopColor:colors.line},
  unitLabel:{alignSelf:'flex-start',color:colors.navy,backgroundColor:'#E8F0F6',borderRadius:8,paddingHorizontal:8,paddingVertical:2,fontSize:12,fontWeight:'900',overflow:'hidden'},
  measure:{minHeight:44,flexDirection:'row',alignItems:'center',gap:10,paddingVertical:4},
  measureLabel:{color:colors.ink,fontSize:13,fontWeight:'700'},measureStrong:{fontWeight:'900'},
  measureValueBox:{alignItems:'flex-end',flexShrink:0,maxWidth:'50%'},
  measureValue:{color:colors.ink,fontSize:15,fontWeight:'800'},
  notRecorded:{color:colors.muted,fontSize:13,fontStyle:'italic'},
  count:{color:colors.muted,fontSize:11},
  note:{color:colors.muted,fontSize:11,lineHeight:15},
  disclosure:{minHeight:48,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderTopWidth:1,borderTopColor:colors.line,paddingTop:6},
  disclosureText:{color:colors.brandDark,fontSize:13,fontWeight:'900'},
  supplier:{gap:2,paddingLeft:10,borderLeftWidth:2,borderLeftColor:colors.line},
  supplierName:{color:colors.ink,fontSize:14,fontWeight:'900'},
  recordRow:{flexDirection:'row',alignItems:'center',gap:10,padding:12,borderRadius:11,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line},
  recordRef:{color:colors.ink,fontSize:14,fontWeight:'900'},recordQty:{color:colors.ink,fontSize:14,fontWeight:'800'},
});
