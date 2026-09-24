import {useCallback,useEffect,useMemo,useState,type ReactNode} from 'react';
import {ActivityIndicator,LayoutAnimation,Pressable,StyleSheet,Text,View} from 'react-native';

import type {ContributingRecord,ContributingRecordQuery,ProjectTotalsRepository} from '../../data/repositories/ProjectTotalsRepository';
import {fuelTypeLabels} from '../../domain/fuel';
import type {Project} from '../../domain/loads';
import {
  buildItemLedger,constructionSourceLabels,countActiveTotalsFilters,describeTotalsRange,emptyTotalsFilters,formatTotalQuantity,
  splitItemSources,summarizeConstruction,summarizeFuel,totalsFilterChoices,validateTotalsFilters,
  type ItemLedgerEntry,type ItemLedgerSupplier,type Measure,type ProjectTotalsData,type ProjectTotalsFilters,type TotalsView,
} from '../../domain/projectTotals';
import {AppButton,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {DatePickerField} from '../components/DatePickerField';
import {useReducedMotion} from '../components/ExpandableMenu';
import {FocusedSheet} from '../components/FocusedSheet';
import {SearchableSelect} from '../components/SearchableSelect';
import {SegmentedChoice} from '../components/SegmentedChoice';
import {colors} from '../theme';

type Drill={title:string;query:ContributingRecordQuery};
type SupplierFocus={item:ItemLedgerEntry;supplier:ItemLedgerSupplier};
const viewOptions:{id:TotalsView;label:string}[]=[{id:'all',label:'All'},{id:'delivered',label:'Delivered'},{id:'used',label:'Used'}];
const records=(count:number)=>`${count} record${count===1?'':'s'}`;

/**
 * DEC-481. A project's operational ledger of quantities, read as Item -> its whole-project Delivered and
 * Used totals -> the suppliers (and the company's own loads) that delivered it -> one supplier's totals
 * and records. Every figure is produced by domain/projectTotals.ts from repository aggregates; this
 * screen only arranges and labels them. Each total states what it counts, in which unit, over which
 * dates, and whether it is delivered or used.
 */
export function ProjectTotalsScreen({project,repository,onBack}:{project:Project;repository:ProjectTotalsRepository;onBack:()=>void}){
  const reducedMotion=useReducedMotion();
  const[filters,setFilters]=useState<ProjectTotalsFilters>(emptyTotalsFilters);
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[data,setData]=useState<ProjectTotalsData|null>(null);
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[loadError,setLoadError]=useState<string|null>(null);
  const[reload,setReload]=useState(0);
  const[openItems,setOpenItems]=useState<Set<string>>(()=>new Set());
  const[drill,setDrill]=useState<Drill|null>(null);
  const[focus,setFocus]=useState<SupplierFocus|null>(null);

  const filterIssues=validateTotalsFilters(filters);
  const range={fromDate:filters.fromDate,toDate:filters.toDate};
  useEffect(()=>{
    if(filterIssues.length)return;
    let active=true;setStatus('loading');setLoadError(null);
    repository.getProjectTotals(project.id,range).then(next=>{if(active){setData(next);setStatus('ready');}}).catch(cause=>{if(active){setLoadError(cause instanceof Error?cause.message:'Totals could not be calculated.');setStatus('error');}});
    return()=>{active=false;};
  },[project.id,repository,filters.fromDate,filters.toDate,reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const rangeLabel=describeTotalsRange(filters.fromDate,filters.toDate);
  const activeFilters=countActiveTotalsFilters(filters);
  const ledger=useMemo(()=>data?buildItemLedger(data,filters):[],[data,filters]);
  const fuel=useMemo(()=>data&&filters.view!=='delivered'?summarizeFuel(data.fuel):[],[data,filters.view]);
  const construction=useMemo(()=>data&&filters.view!=='delivered'?summarizeConstruction(data.construction):[],[data,filters.view]);
  const choices=useMemo(()=>data?totalsFilterChoices(data):{items:[],suppliers:[],units:[]},[data]);
  const set=(patch:Partial<ProjectTotalsFilters>)=>setFilters(current=>({...current,...patch}));
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.create(200,'easeInEaseOut','opacity'));};
  const toggleItem=(key:string)=>{animate();setOpenItems(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});};
  const toggleFilters=()=>{animate();setFiltersOpen(value=>!value);};
  const openDrill=useCallback((next:Drill)=>setDrill(next),[]);

  const nothing=data&&!ledger.length&&!fuel.length&&!construction.length;
  return <AppPage keyboard>
    <PageHeader eyebrow="PROJECT TOTALS" title={project.name} onBack={onBack}/>
    <Text style={styles.lead}>Delivered and used are separate records and are never added together. Every total stays in its own unit; nothing is converted.</Text>

    <View style={styles.filterBlock}>
      <Pressable onPress={toggleFilters} style={({pressed})=>[styles.filterBar,pressed&&styles.pressed]} accessibilityRole="button" accessibilityState={{expanded:filtersOpen}}
        accessibilityLabel={`Filters. Covering ${rangeLabel}. ${activeFilters?`${activeFilters} active`:'None active'}.`} accessibilityHint={filtersOpen?'Hides the filters':'Shows date, item, supplier, unit, and delivered or used filters'}>
        <View style={styles.flex}>
          <Text style={styles.filterCaption}>Covering</Text>
          <Text style={styles.filterRange}>{rangeLabel}</Text>
        </View>
        <Text style={styles.filterCount}>{activeFilters?`${activeFilters} filter${activeFilters===1?'':'s'} on`:'Filter'}</Text>
        <Text style={styles.toggleGlyph} importantForAccessibility="no">{filtersOpen?'×':'+'}</Text>
      </Pressable>
      {filtersOpen?<View style={styles.filterPanel}>
        <View style={styles.dates}>
          <View style={styles.dateField}><DatePickerField label="From" value={filters.fromDate} onChange={fromDate=>set({fromDate})} allowClear placeholder="Any date"/></View>
          <View style={styles.dateField}><DatePickerField label="To" value={filters.toDate} onChange={toDate=>set({toDate})} allowClear placeholder="Any date"/></View>
        </View>
        <SearchableSelect label="Item" options={choices.items} selectedId={filters.itemKey} onSelect={itemKey=>set({itemKey})} placeholder="All items" allowClear/>
        <SearchableSelect label="Supplier" options={choices.suppliers} selectedId={filters.supplierKey} onSelect={supplierKey=>set({supplierKey})} placeholder="All suppliers" allowClear/>
        <SearchableSelect label="Unit" options={choices.units} selectedId={filters.unitKey} onSelect={unitKey=>set({unitKey})} placeholder="All units" allowClear/>
        <SegmentedChoice mode="tabs" label="Show" options={viewOptions} selectedId={filters.view} onSelect={view=>set({view})}/>
        {activeFilters?<AppButton label="Clear all filters" tone="secondary" onPress={()=>setFilters(emptyTotalsFilters())}/>:null}
      </View>:null}
    </View>
    {filters.supplierKey?<Text style={styles.notice}>Only deliveries from the selected supplier are shown. Use is recorded per item, not per supplier, so it is hidden while a supplier is selected.</Text>:null}

    {filterIssues.length?<Feedback kind="warning">{filterIssues.join(' ')}</Feedback>
      :status==='loading'?<View style={styles.center}><ActivityIndicator color={colors.brand}/><Text style={styles.helper}>Calculating totals…</Text></View>
      :status==='error'?<View style={styles.center}><Feedback kind="error">{loadError??'Totals could not be calculated.'}</Feedback><AppButton label="Try again" tone="secondary" onPress={()=>setReload(value=>value+1)}/></View>
      :nothing?<EmptyState title="Nothing recorded for these filters" body={`No deliveries, recorded use, fuel or construction materials for ${project.name} in ${rangeLabel.toLocaleLowerCase()}. Widen the dates or clear a filter.`}/>
      :<>
        {ledger.length?<Section title="Materials" count={`${ledger.length} item${ledger.length===1?'':'s'}`}>
          <View style={styles.itemCards}>
            {ledger.map(item=><View key={item.itemKey} style={styles.itemCard}>
              <ItemRow item={item} view={filters.view} open={openItems.has(item.itemKey)} onToggle={()=>toggleItem(item.itemKey)} filters={filters} onSupplier={supplier=>setFocus({item,supplier})} onDrill={openDrill}/>
            </View>)}
          </View>
        </Section>:null}

        {fuel.length?<Section title="Fuel used" note={`Equipment fills to this project. Each fuel type is totalled on its own; diesel and gasoline are never added together.`}>
          <View style={styles.itemCards}>
            {fuel.map(type=><View key={type.fuelType} style={styles.itemCard}>
              <View style={styles.cardHead}>
                <Text style={styles.itemName}>{fuelTypeLabels[type.fuelType]}</Text>
                <Text style={styles.itemMeta}>{records(type.recordCount)}</Text>
              </View>
              <View style={styles.tiles}>
                <View style={[styles.tile,styles.tileUsed]} accessible accessibilityLabel={`${fuelTypeLabels[type.fuelType]} used: ${formatTotalQuantity(type.litres,'L')}`}>
                  <Text style={[styles.tileLabel,styles.tileLabelUsed]}>Used</Text>
                  <Value measure={{quantity:type.litres,recordCount:type.recordCount}} unitSymbol="L"/>
                </View>
              </View>
              <View style={styles.cardLines}>
                <Text style={styles.linesCaption}>By equipment</Text>
                {type.equipment.map(equipment=><LedgerLine key={equipment.equipmentName} label={equipment.equipmentName} value={{quantity:equipment.litres,recordCount:equipment.recordCount}} unitSymbol="L"/>)}
              </View>
            </View>)}
          </View>
        </Section>:null}

        {construction.length?<Section title="Wall and foundation materials used" note="Actual quantities only. Each source is listed on its own and never added together or to Daily Report use, because one pour may be recorded in more than one place.">
          <View style={styles.itemCards}>
            {construction.map(group=><View key={`${group.materialKey}-${group.unitKey}`} style={styles.itemCard}>
              <View style={styles.cardHead}>
                <Text style={styles.itemName}>{group.materialLabel}</Text>
                <Text style={styles.itemMeta}>Used, in {group.unitSymbol}</Text>
              </View>
              <View style={styles.cardLines}>
                <Text style={styles.linesCaption}>By source, each counted on its own</Text>
                {group.sources.map(source=><LedgerLine key={source.source} label={constructionSourceLabels[source.source]} value={source} unitSymbol={group.unitSymbol}/>)}
              </View>
            </View>)}
          </View>
        </Section>:null}
      </>}

    <SupplierSheet focus={focus} projectId={project.id} filters={filters} rangeLabel={rangeLabel} repository={repository} onClose={()=>setFocus(null)}/>
    <RecordsSheet drill={drill} projectId={project.id} repository={repository} onClose={()=>setDrill(null)}/>
  </AppPage>;
}

function Section({title,count,note,children}:{title:string;count?:string;note?:string;children:ReactNode}){
  return <View style={styles.section}>
    <View style={styles.sectionHead}><Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>{count?<Text style={styles.sectionCount}>{count}</Text>:null}</View>
    {note?<Text style={styles.sectionNote}>{note}</Text>:null}
    {children}
  </View>;
}

/**
 * One item: its whole-project totals per unit, Delivered and Used in their own columns. The header
 * toggles the list of sources that delivered it; each source opens its own totals and records.
 */
function ItemRow({item,view,open,onToggle,filters,onSupplier,onDrill}:{item:ItemLedgerEntry;view:TotalsView;open:boolean;onToggle:()=>void;filters:ProjectTotalsFilters;onSupplier:(supplier:ItemLedgerSupplier)=>void;onDrill:(drill:Drill)=>void}){
  const sources=splitItemSources(item);
  const showDelivered=view!=='used';
  const showUsed=view!=='delivered'&&!item.usageHiddenBySupplierFilter;
  const dates={fromDate:filters.fromDate,toDate:filters.toDate};
  const deliveredBy=sources.suppliers.length+(sources.company?1:0);
  return <View>
    <Pressable onPress={onToggle} style={({pressed})=>[styles.itemHead,pressed&&styles.pressed]} android_ripple={{color:'#EFE9DF'}}
      accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${open?'Hide':'Show'} suppliers for ${item.itemName}`}>
      <View style={styles.flex}>
        <Text style={styles.itemName}>{item.itemName}</Text>
        <Text style={styles.itemMeta}>{records(item.recordCount)}{showDelivered?` · ${deliveredBy?`${deliveredBy} source${deliveredBy===1?'':'s'}`:'no deliveries'}`:''}</Text>
      </View>
      <View style={[styles.toggle,open&&styles.toggleOpen]}><Text style={[styles.toggleGlyph,open&&styles.toggleGlyphOpen]} importantForAccessibility="no">{open?'×':'+'}</Text></View>
    </Pressable>

    {/* Delivered and Used never share a box: two quiet tints, each always labelled in words. */}
    <View style={styles.tiles}>
      {showDelivered?<View style={[styles.tile,styles.tileDelivered]} accessible
        accessibilityLabel={`${item.itemName} delivered: ${item.units.map(unit=>unit.delivered?formatTotalQuantity(unit.delivered.quantity,unit.unitSymbol):`not recorded in ${unit.unitSymbol}`).join(', ')}`}>
        <Text style={[styles.tileLabel,styles.tileLabelDelivered]}>Delivered</Text>
        {item.units.map(unit=><Value key={unit.unitKey} measure={unit.delivered} unitSymbol={unit.unitSymbol}/>)}
      </View>:null}
      {showUsed?<View style={[styles.tile,styles.tileUsed]} accessible
        accessibilityLabel={`${item.itemName} used: ${item.units.map(unit=>unit.used?formatTotalQuantity(unit.used.quantity,unit.unitSymbol):`not recorded in ${unit.unitSymbol}`).join(', ')}`}>
        <Text style={[styles.tileLabel,styles.tileLabelUsed]}>Used</Text>
        {item.units.map(unit=><Value key={unit.unitKey} measure={unit.used} unitSymbol={unit.unitSymbol}/>)}
      </View>:null}
    </View>

    {open?<View style={styles.expanded}>
      <Text style={styles.subhead}>Delivered by</Text>
      {sources.suppliers.length||sources.company?<View style={styles.sourceCards}>
        {[...sources.suppliers,...(sources.company?[sources.company]:[])].map(supplier=>
          <SourceRow key={supplier.supplierKey} supplier={supplier} company={supplier===sources.company} onPress={()=>onSupplier(supplier)}/>)}
      </View>:<Text style={styles.absent}>No deliveries recorded for this item {filters.fromDate||filters.toDate?'in this period':'on this project'}.</Text>}

      {showUsed&&item.units.some(unit=>unit.used||unit.transported)?<>
        <Text style={styles.subhead}>Recorded on site</Text>
        <View style={[styles.sourceList,styles.linesInset]}>
          {item.units.map(unit=><View key={unit.unitKey}>
            {unit.used?<LedgerLine label={`Used in Daily Reports · ${unit.unitSymbol}`} value={unit.used} unitSymbol={unit.unitSymbol}
              onPress={()=>onDrill({title:`${item.itemName} used (${unit.unitSymbol})`,query:{kind:'usage',movement:'used',itemKey:item.itemKey,unitKey:unit.unitKey,...dates}})}/>:null}
            {unit.transported?<LedgerLine label={`Transported (recorded) · ${unit.unitSymbol}`} value={unit.transported} unitSymbol={unit.unitSymbol}
              onPress={()=>onDrill({title:`${item.itemName} transported (${unit.unitSymbol})`,query:{kind:'usage',movement:'transported',itemKey:item.itemKey,unitKey:unit.unitKey,...dates}})}/>:null}
            {unit.difference!=null?<LedgerLine label="Delivered minus recorded use" value={{quantity:unit.difference,recordCount:0}} showCount={false} unitSymbol={unit.unitSymbol} note="Not an inventory balance: only what was recorded as delivered and used."/>:null}
          </View>)}
        </View>
      </>:null}
    </View>:null}
  </View>;
}

function SourceRow({supplier,company=false,onPress}:{supplier:ItemLedgerSupplier;company?:boolean;onPress:()=>void}){
  const name=company?'Company deliveries':supplier.supplierName;
  const summary=supplier.units.map(unit=>formatTotalQuantity(unit.quantity,unit.unitSymbol)).join(', ');
  return <Pressable onPress={onPress} style={({pressed})=>[styles.source,company&&styles.sourceCompany,pressed&&styles.pressed]} android_ripple={{color:'#EFE9DF'}} accessibilityRole="button"
    accessibilityLabel={`${name}${company?', own loads':''}: delivered ${summary}. Open totals and records.`}>
    <View style={styles.flex}>
      <Text style={styles.sourceName}>{name}</Text>
      {company?<Text style={styles.sourceTag}>Own loads, not a supplier</Text>:null}
      {supplier.units.map(unit=><Text key={unit.unitKey} style={styles.sourceFigure}><Text style={styles.number}>{formatTotalQuantity(unit.quantity,unit.unitSymbol)}</Text>  {records(unit.recordCount)}</Text>)}
    </View>
    <Text style={styles.chevron} importantForAccessibility="no">›</Text>
  </Pressable>;
}

/** A whole-project figure in its column; an absent measure says so in the unit it is missing from. */
function Value({measure,unitSymbol}:{measure:Measure|null;unitSymbol:string}){
  return <View style={styles.valueCell}>
    {measure?<><Text style={styles.value}>{formatTotalQuantity(measure.quantity,unitSymbol)}</Text><Text style={styles.valueCount}>{records(measure.recordCount)}</Text></>
      :<><Text style={styles.notRecorded}>Not recorded</Text><Text style={styles.valueCount}>in {unitSymbol}</Text></>}
  </View>;
}

function LedgerLine({label,value,unitSymbol,strong=false,indent=false,note,onPress,showCount=true}:{label:string;value:Measure|null;unitSymbol:string;strong?:boolean;indent?:boolean;note?:string;onPress?:()=>void;showCount?:boolean}){
  const content=<>
    <View style={styles.flex}><Text style={[styles.lineLabel,strong&&styles.lineStrong,indent&&styles.lineIndent]}>{label}</Text>{note?<Text style={styles.note}>{note}</Text>:null}</View>
    <View style={styles.lineValueBox}>
      {value?<Text style={[styles.lineValue,strong&&styles.lineStrong]}>{formatTotalQuantity(value.quantity,unitSymbol)}</Text>:<Text style={styles.notRecorded}>Not recorded</Text>}
      {value&&showCount?<Text style={styles.valueCount}>{records(value.recordCount)}</Text>:null}
    </View>
    {onPress?<Text style={styles.chevron} importantForAccessibility="no">›</Text>:null}
  </>;
  const spoken=`${label}: ${value?formatTotalQuantity(value.quantity,unitSymbol):'Not recorded'}`;
  return onPress?<Pressable onPress={onPress} style={({pressed})=>[styles.line,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={`${spoken}. View records.`}>{content}</Pressable>
    :<View style={styles.line} accessible accessibilityLabel={spoken}>{content}</View>;
}

/** One supplier (or the company's own loads) for one item: its delivered totals and the records behind them. */
function SupplierSheet({focus,projectId,filters,rangeLabel,repository,onClose}:{focus:SupplierFocus|null;projectId:string;filters:ProjectTotalsFilters;rangeLabel:string;repository:ProjectTotalsRepository;onClose:()=>void}){
  const[rows,setRows]=useState<{unitKey:string;unitSymbol:string;records:ContributingRecord[]}[]|null>(null);
  const[error,setError]=useState<string|null>(null);
  const[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!focus)return;
    let active=true;setRows(null);setError(null);
    const {item,supplier}=focus;
    Promise.all(supplier.units.map(unit=>repository.listContributingRecords(projectId,{kind:'delivery',itemKey:item.itemKey,unitKey:unit.unitKey,supplierKey:supplier.supplierKey,source:supplier.source,fromDate:filters.fromDate,toDate:filters.toDate})
      .then(found=>({unitKey:unit.unitKey,unitSymbol:unit.unitSymbol,records:found}))))
      .then(found=>{if(active)setRows(found);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Records could not be loaded.');});
    return()=>{active=false;};
  },[focus,projectId,repository,filters.fromDate,filters.toDate,attempt]);
  const company=focus?.supplier.source==='company_delivery';
  const name=focus?(company?'Company deliveries':focus.supplier.supplierName):'';
  return <FocusedSheet visible={!!focus} eyebrow={company?'OWN LOADS':'SUPPLIER TOTALS'} title={name} onClose={onClose} footer={<View style={styles.flex}><AppButton label="Close" tone="secondary" onPress={onClose}/></View>}>
    {focus?<>
      <Text style={styles.sheetContext}><Text style={styles.sheetItem}>{focus.item.itemName}</Text>{'\n'}{rangeLabel}</Text>
      <View style={styles.group}>
        {focus.supplier.units.map((unit,index)=><View key={unit.unitKey}>
          {index?<View style={styles.divider}/>:null}
          <View style={styles.block}><LedgerLine label={`Delivered · ${unit.unitSymbol}`} value={unit} unitSymbol={unit.unitSymbol} strong/></View>
        </View>)}
      </View>
      <Text style={styles.notice}>Use is not recorded per supplier. {focus.item.itemName}'s Used total on the Totals screen covers every source.</Text>
      <Text style={styles.subhead}>Records</Text>
      {error?<><Feedback kind="error">{error}</Feedback><AppButton label="Try again" tone="secondary" onPress={()=>setAttempt(value=>value+1)}/></>
        :!rows?<View style={styles.center}><ActivityIndicator color={colors.brand}/></View>
        :rows.map(group=><View key={group.unitKey} style={styles.recordGroup}>
          {rows.length>1?<Text style={styles.recordGroupTitle}>In {group.unitSymbol}</Text>:null}
          {group.records.length?<View style={styles.group}>{group.records.map((record,index)=><View key={`${record.source}-${record.id}`}>{index?<View style={styles.divider}/>:null}<RecordRow record={record}/></View>)}</View>
            :<Text style={styles.absent}>No records match.</Text>}
          {group.records.length>=100?<Text style={styles.helper}>Showing the newest 100 records.</Text>:null}
        </View>)}
    </>:null}
  </FocusedSheet>;
}

/** The records behind one recorded-use or transported total. */
function RecordsSheet({drill,projectId,repository,onClose}:{drill:Drill|null;projectId:string;repository:ProjectTotalsRepository;onClose:()=>void}){
  const[rows,setRows]=useState<ContributingRecord[]|null>(null);
  const[error,setError]=useState<string|null>(null);
  useEffect(()=>{
    if(!drill)return;
    let active=true;setRows(null);setError(null);
    repository.listContributingRecords(projectId,drill.query).then(found=>{if(active)setRows(found);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Records could not be loaded.');});
    return()=>{active=false;};
  },[drill,projectId,repository]);
  return <FocusedSheet visible={!!drill} eyebrow="CONTRIBUTING RECORDS" title={drill?.title??''} onClose={onClose} footer={<View style={styles.flex}><AppButton label="Close" tone="secondary" onPress={onClose}/></View>}>
    {error?<Feedback kind="error">{error}</Feedback>:!rows?<View style={styles.center}><ActivityIndicator color={colors.brand}/></View>
      :rows.length?<View style={styles.group}>{rows.map((record,index)=><View key={`${record.source}-${record.id}`}>{index?<View style={styles.divider}/>:null}<RecordRow record={record}/></View>)}</View>
      :<Text style={styles.absent}>No records match.</Text>}
    {rows&&rows.length>=100?<Text style={styles.helper}>Showing the newest 100 records.</Text>:null}
  </FocusedSheet>;
}

function RecordRow({record}:{record:ContributingRecord}){
  return <View style={styles.record} accessible accessibilityLabel={`${record.reference}, ${[record.date,record.party].filter(Boolean).join(', ')}, ${formatTotalQuantity(record.quantity,record.unitSymbol)}`}>
    <View style={styles.flex}><Text style={styles.recordRef}>{record.reference}</Text><Text style={styles.recordMeta}>{[record.date,record.party].filter(Boolean).join(' · ')}</Text></View>
    <Text style={[styles.recordQty,styles.number]}>{formatTotalQuantity(record.quantity,record.unitSymbol)}</Text>
  </View>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  number:{fontVariant:['tabular-nums']},
  pressed:{backgroundColor:'#F7F4EE'},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  lead:{color:'#4F5B66',fontSize:14,lineHeight:20},
  notice:{color:'#4F5B66',fontSize:13,lineHeight:19,backgroundColor:colors.surface,borderRadius:12,padding:12},
  center:{alignItems:'center',gap:12,paddingVertical:24},

  filterBlock:{backgroundColor:colors.surface,borderRadius:16,overflow:'hidden'},
  filterBar:{minHeight:60,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16,paddingVertical:10},
  filterCaption:{color:colors.muted,fontSize:12,fontWeight:'600'},
  filterRange:{color:colors.navy,fontSize:15,fontWeight:'700',marginTop:1},
  filterCount:{color:colors.brandDark,fontSize:13,fontWeight:'700'},
  filterPanel:{gap:12,padding:16,paddingTop:14,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,backgroundColor:'#FCFBF8'},
  dates:{flexDirection:'row',flexWrap:'wrap',gap:10},dateField:{flexGrow:1,flexBasis:140,minWidth:0},

  section:{gap:10,marginTop:6},
  sectionHead:{flexDirection:'row',alignItems:'baseline',gap:8},
  sectionTitle:{color:colors.ink,fontSize:18,fontWeight:'800',flexShrink:1},
  sectionCount:{color:colors.muted,fontSize:13,fontWeight:'600',fontVariant:['tabular-nums']},
  sectionNote:{color:'#4F5B66',fontSize:13,lineHeight:19},

  // Grouped surface used inside the sheets (supplier totals, record lists).
  group:{backgroundColor:colors.surface,borderRadius:16,overflow:'hidden',borderWidth:1,borderColor:'#E3DBCD'},
  divider:{height:StyleSheet.hairlineWidth,backgroundColor:colors.line,marginHorizontal:16},
  block:{paddingHorizontal:16,paddingVertical:8},

  // Each item, fuel type and material is its own card so one never visually runs into the next.
  itemCards:{gap:16},
  itemCard:{backgroundColor:colors.surface,borderRadius:16,overflow:'hidden',borderWidth:1,borderColor:'#D9CFBE',shadowColor:'#17212B',shadowOpacity:.08,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:2},
  itemHead:{minHeight:56,flexDirection:'row',alignItems:'center',gap:12,paddingLeft:16,paddingRight:12,paddingTop:14,paddingBottom:10},
  cardHead:{paddingHorizontal:16,paddingTop:14,paddingBottom:10},
  itemName:{color:colors.ink,fontSize:17,lineHeight:22,fontWeight:'700'},
  itemMeta:{color:colors.muted,fontSize:12,marginTop:2},
  cardLines:{marginHorizontal:16,marginBottom:12,marginTop:4,paddingTop:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line},
  linesCaption:{color:colors.muted,fontSize:12,fontWeight:'600'},

  // Delivered and Used: two soft tints (cool for arriving, warm for consumed), never loud.
  tiles:{flexDirection:'row',gap:10,paddingHorizontal:12,paddingBottom:12},
  tile:{flex:1,minWidth:0,borderRadius:12,paddingHorizontal:12,paddingVertical:10,gap:8},
  tileDelivered:{backgroundColor:'#EEF3F8'},
  tileUsed:{backgroundColor:'#F6F0E6'},
  tileLabel:{fontSize:12,fontWeight:'700',letterSpacing:.3},
  tileLabelDelivered:{color:colors.navy},
  tileLabelUsed:{color:'#6E4B1F'},
  toggle:{width:36,height:36,borderRadius:18,borderWidth:1,borderColor:colors.line,alignItems:'center',justifyContent:'center'},
  toggleOpen:{backgroundColor:colors.navy,borderColor:colors.navy},
  toggleGlyph:{color:colors.navy,fontSize:22,lineHeight:24,fontWeight:'500'},
  toggleGlyphOpen:{color:'#FFF8ED'},

  valueCell:{minWidth:0},
  value:{color:colors.ink,fontSize:18,fontWeight:'700',fontVariant:['tabular-nums']},
  valueCount:{color:'#5A6570',fontSize:12,marginTop:1},
  notRecorded:{color:'#5A6570',fontSize:14,fontStyle:'italic'},

  expanded:{backgroundColor:'#FAF8F4',paddingHorizontal:12,paddingTop:12,paddingBottom:14,gap:8,borderTopWidth:1,borderTopColor:'#E3DBCD'},
  subhead:{color:colors.navy,fontSize:13,fontWeight:'700',marginTop:2,paddingHorizontal:4},
  sourceCards:{gap:8},
  sourceList:{backgroundColor:colors.surface,borderRadius:12,borderWidth:1,borderColor:'#E3DBCD',overflow:'hidden'},
  linesInset:{paddingHorizontal:12},
  source:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:14,paddingVertical:11,backgroundColor:colors.surface,borderRadius:12,borderWidth:1,borderColor:'#E3DBCD'},
  sourceCompany:{backgroundColor:'#F7F4EE'},
  sourceName:{color:colors.ink,fontSize:15,fontWeight:'700'},
  sourceTag:{color:colors.brandDark,fontSize:12,fontWeight:'600',marginTop:1},
  sourceFigure:{color:colors.muted,fontSize:13,marginTop:2},
  chevron:{color:colors.navy,fontSize:22,fontWeight:'600',paddingLeft:2},
  absent:{color:colors.muted,fontSize:13,lineHeight:19,fontStyle:'italic'},

  line:{minHeight:48,flexDirection:'row',alignItems:'center',gap:10,paddingVertical:6,paddingHorizontal:2},
  lineLabel:{color:colors.ink,fontSize:14,fontWeight:'500'},
  lineStrong:{fontWeight:'700'},
  lineIndent:{color:'#4F5B66',paddingLeft:12},
  lineValueBox:{alignItems:'flex-end',flexShrink:0,maxWidth:'55%'},
  lineValue:{color:colors.ink,fontSize:15,fontWeight:'600',fontVariant:['tabular-nums']},
  note:{color:colors.muted,fontSize:12,lineHeight:16,marginTop:1},

  sheetContext:{color:colors.muted,fontSize:13,lineHeight:19},
  sheetItem:{color:colors.ink,fontSize:16,fontWeight:'700'},
  recordGroup:{gap:8},
  recordGroupTitle:{color:colors.muted,fontSize:12,fontWeight:'600'},
  record:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,paddingVertical:10},
  recordRef:{color:colors.ink,fontSize:14,fontWeight:'700'},
  recordMeta:{color:colors.muted,fontSize:12,marginTop:1},
  recordQty:{color:colors.ink,fontSize:14,fontWeight:'600'},
});
