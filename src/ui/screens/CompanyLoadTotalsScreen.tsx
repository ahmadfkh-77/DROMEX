import {useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,LayoutAnimation,Pressable,StyleSheet,Text,View} from 'react-native';

import type {CompanyTotalsRecord,CompanyTotalsRepository} from '../../data/repositories/CompanyTotalsRepository';
import type {LoadNumberSeriesRepository} from '../../data/repositories/LoadNumberSeriesRepository';
import type {ProfileRepository} from '../../data/repositories/ProfileRepository';
import type {RecordSnapshot} from '../../domain/businessDocuments';
import {buildCompanyLoadTree,emptyCompanyTotalsFilters,LEGACY_SERIES_KEY,LEGACY_SERIES_LABEL,type CompanyLoadGroupNode,type CompanyLoadTotalRow,type CompanyTotalsFilters,type UnitQuantity} from '../../domain/companyTotals';
import {describeTotalsRange,formatTotalQuantity,validateTotalsFilters} from '../../domain/projectTotals';
import {companyContactLine} from '../../domain/projectTotalsPdf';
import {exportAndShareCompanyLoadTotals} from '../../services/documentExport';
import {AppButton,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {DatePickerField} from '../components/DatePickerField';
import {useReducedMotion} from '../components/ExpandableMenu';
import {SearchableSelect} from '../components/SearchableSelect';
import {SegmentedChoice} from '../components/SegmentedChoice';
import {Ledger,RecordRow,styles as parts} from '../components/totals/TotalsParts';
import {colors} from '../theme';

type Status='active'|'cancelled'|'all';
type Choice={id:string;label:string};
const unique=(values:Choice[])=>[...new Map(values.map(value=>[value.id,value])).values()].sort((a,b)=>a.label.localeCompare(b.label));
const loadsWord=(count:number)=>`${count} load${count===1?'':'s'}`;
const unitText=(values:UnitQuantity[])=>values.map(value=>formatTotalQuantity(value.quantity,value.unitSymbol)).join(' · ');

/**
 * DEC-500 (6). Company Load Totals: Number series (or Item) → Project → individual loads, with load
 * counts and per-unit totals. Cancelled loads keep their numbers and are shown apart, never added in.
 */
export function CompanyLoadTotalsScreen({totals,series,profiles,onBack,onOpenRecord}:{totals:CompanyTotalsRepository;series:LoadNumberSeriesRepository;profiles:ProfileRepository;onBack:()=>void;onOpenRecord:(record:RecordSnapshot)=>void}){
  const reducedMotion=useReducedMotion();
  const[filters,setFilters]=useState<CompanyTotalsFilters>(emptyCompanyTotalsFilters);
  const[groupBy,setGroupBy]=useState<'series'|'item'>('series');
  const[status,setStatus]=useState<Status>('active');
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[rows,setRows]=useState<CompanyLoadTotalRow[]|null>(null);
  const[seriesChoices,setSeriesChoices]=useState<Choice[]>([]);
  const[group,setGroup]=useState<CompanyLoadGroupNode|null>(null);
  const[project,setProject]=useState<{key:string;name:string}|null>(null);
  const[loads,setLoads]=useState<CompanyTotalsRecord[]|null>(null);
  const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  const issues=validateTotalsFilters({fromDate:filters.fromDate,toDate:filters.toDate,itemKey:'',supplierKey:'',unitKey:'',view:'all'});
  const set=(patch:Partial<CompanyTotalsFilters>)=>{setFilters(current=>({...current,...patch}));setGroup(null);setProject(null);};

  useEffect(()=>{
    if(issues.length)return;let active=true;setRows(null);setError(null);
    totals.getCompanyLoadTotals(filters).then(found=>{if(active)setRows(found);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Totals could not be calculated.');});
    return()=>{active=false;};
  },[totals,filters]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{series.listSeries().then(list=>setSeriesChoices([...list.map(value=>({id:value.id,label:`${value.prefix} · ${value.displayName}`})),{id:LEGACY_SERIES_KEY,label:LEGACY_SERIES_LABEL}])).catch(()=>{});},[series]);

  const visibleRows=useMemo(()=>rows?.filter(row=>status==='all'||(status==='active'?row.status==='Active':row.status==='Cancelled'))??[],[rows,status]);
  const tree=useMemo(()=>buildCompanyLoadTree(visibleRows,groupBy),[visibleRows,groupBy]);
  const choices=useMemo(()=>({items:unique((rows??[]).map(row=>({id:row.itemKey,label:row.itemName}))),projects:unique((rows??[]).map(row=>({id:row.projectKey,label:row.projectName}))),units:unique((rows??[]).map(row=>({id:row.unitKey,label:row.unitSymbol})))}),[rows]);
  const groupFilters=(target:CompanyLoadGroupNode):CompanyTotalsFilters=>groupBy==='series'?{...filters,seriesId:target.key}:{...filters,itemKey:target.key};
  const currentGroup=group?tree.find(value=>value.key===group.key)??null:null;

  useEffect(()=>{
    if(!currentGroup||!project){setLoads(null);return;}
    let active=true;setLoads(null);
    totals.listCompanyLoads({...groupFilters(currentGroup),projectKey:project.key},status).then(found=>{if(active)setLoads(found);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Loads could not be loaded.');});
    return()=>{active=false;};
  },[currentGroup?.key,project?.key,status,filters,groupBy]); // eslint-disable-line react-hooks/exhaustive-deps

  const back=()=>{if(project){setProject(null);return;}if(group){setGroup(null);return;}onBack();};
  const exportPdf=async()=>{
    setBusy(true);setError(null);setMessage(null);
    try{
      const [all,company]=await Promise.all([totals.listCompanyLoads(filters,status,5000),profiles.getCompanySettings()]);
      const labels=[describeTotalsRange(filters.fromDate,filters.toDate),groupBy==='series'?'Grouped by number series':'Grouped by item',status==='active'?'Active loads':status==='cancelled'?'Cancelled loads only':'Active and cancelled loads',
        ...(filters.itemKey?[`Item: ${choices.items.find(value=>value.id===filters.itemKey)?.label??''}`]:[]),...(filters.projectKey?[`Project: ${choices.projects.find(value=>value.id===filters.projectKey)?.label??''}`]:[]),
        ...(filters.unitKey?[`Unit: ${choices.units.find(value=>value.id===filters.unitKey)?.label??''}`]:[]),...(filters.seriesId?[`Series: ${seriesChoices.find(value=>value.id===filters.seriesId)?.label??''}`]:[])];
      await exportAndShareCompanyLoadTotals({fileName:{projectName:filters.projectKey?choices.projects.find(value=>value.id===filters.projectKey)?.label??null:null,fromDate:filters.fromDate,toDate:filters.toDate},companyName:company.companyName,contactLine:companyContactLine(company),logoUri:company.logoUri,generatedAt:new Date().toISOString(),filters:labels,groupBy,groups:tree,loads:all});
      setMessage('PDF ready to share.');
    }catch(cause){setError(cause instanceof Error?cause.message:'The PDF could not be created.');}finally{setBusy(false);}
  };

  return <AppPage keyboard>
    <PageHeader eyebrow="COMPANY LOAD TOTALS" title={project?.name??currentGroup?.label??'Company loads'} onBack={back}/>
    {!group?<Text style={styles.lead}>Company loads by number series or item, then by project. Each unit is totalled on its own; cancelled loads are listed apart and never counted.</Text>:null}
    <View style={styles.filterBlock}>
      <Pressable onPress={()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.create(180,'easeInEaseOut','opacity'));setFiltersOpen(value=>!value);}} style={({pressed})=>[styles.filterBar,pressed&&parts.pressed]} accessibilityRole="button" accessibilityState={{expanded:filtersOpen}}>
        <View style={parts.flex}><Text style={styles.caption}>Covering</Text><Text style={styles.range}>{describeTotalsRange(filters.fromDate,filters.toDate)}</Text></View>
        <Text style={styles.glyph}>{filtersOpen?'×':'+'}</Text>
      </Pressable>
      {filtersOpen?<View style={styles.panel}>
        <View style={styles.dates}><View style={styles.date}><DatePickerField label="From" value={filters.fromDate} onChange={fromDate=>set({fromDate})} allowClear placeholder="Any date"/></View><View style={styles.date}><DatePickerField label="To" value={filters.toDate} onChange={toDate=>set({toDate})} allowClear placeholder="Any date"/></View></View>
        <SearchableSelect label="Item" options={choices.items} selectedId={filters.itemKey} onSelect={itemKey=>set({itemKey})} placeholder="All items" allowClear/>
        <SearchableSelect label="Project" options={choices.projects} selectedId={filters.projectKey} onSelect={projectKey=>set({projectKey})} placeholder="All projects" allowClear/>
        <SearchableSelect label="Unit" options={choices.units} selectedId={filters.unitKey} onSelect={unitKey=>set({unitKey})} placeholder="All units" allowClear/>
        <SearchableSelect label="Number series" options={seriesChoices} selectedId={filters.seriesId} onSelect={seriesId=>set({seriesId})} placeholder="Any series" allowClear/>
      </View>:null}
    </View>
    <SegmentedChoice mode="tabs" label="Group by" options={[{id:'series',label:'Number series'},{id:'item',label:'Item'}]} selectedId={groupBy} onSelect={value=>{setGroupBy(value);setGroup(null);setProject(null);}}/>
    <SegmentedChoice mode="tabs" label="Status" options={[{id:'active',label:'Active'},{id:'cancelled',label:'Cancelled'},{id:'all',label:'Both'}]} selectedId={status} onSelect={setStatus}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    {issues.length?<Feedback kind="warning">{issues.join(' ')}</Feedback>:!rows?<View style={styles.center}><ActivityIndicator color={colors.brand}/></View>
      :project&&currentGroup?<>
        {!loads?<View style={styles.center}><ActivityIndicator color={colors.brand}/></View>:loads.length?<Ledger title={loadsWord(loads.length)} note="Each load opens its own record.">
          {loads.map((record,index)=><RecordRow key={record.key} record={record} first={index===0} onOpen={()=>onOpenRecord(record.snapshot)}/>)}
        </Ledger>:<EmptyState title="No loads" body="No loads match these filters."/>}
      </>
      :currentGroup?<Ledger title="By project" note={`${currentGroup.label}: ${loadsWord(currentGroup.loadCount)}${currentGroup.units.length?` · ${unitText(currentGroup.units)}`:''}`}>
        {currentGroup.projects.map((value,index)=><GroupRow key={value.projectKey} first={index===0} title={value.projectName} count={value.loadCount} units={value.units} cancelled={value.cancelledCount} onPress={()=>setProject({key:value.projectKey,name:value.projectName})}/>)}
      </Ledger>
      :tree.length?<Ledger title={groupBy==='series'?'By number series':'By item'}>
        {tree.map((value,index)=><GroupRow key={value.key} first={index===0} title={value.label} count={value.loadCount} units={value.units} cancelled={value.cancelledCount} onPress={()=>setGroup(value)}/>)}
      </Ledger>:<EmptyState title="No company loads" body="No company loads match these filters."/>}
    {!issues.length&&rows?<AppButton label="Export PDF" tone="secondary" onPress={()=>void exportPdf()} busy={busy} hint="Every series or item, project and load for these filters"/>:null}
  </AppPage>;
}

function GroupRow({title,count,units,cancelled,first,onPress}:{title:string;count:number;units:UnitQuantity[];cancelled:number;first:boolean;onPress:()=>void}){
  return <Pressable onPress={onPress} style={({pressed})=>[styles.row,!first&&parts.rowRule,pressed&&parts.pressed]} accessibilityRole="button" accessibilityLabel={`${title}: ${loadsWord(count)}, ${unitText(units)||'nothing delivered'}${cancelled?`, ${cancelled} cancelled, not counted`:''}`}>
    <View style={parts.flex}>
      <Text style={styles.rowTitle}>{title}</Text>
      <Text style={styles.rowMeta}>{loadsWord(count)}{cancelled?` · ${cancelled} cancelled, not counted`:''}</Text>
    </View>
    <View style={styles.figures}>{units.length?units.map(unit=><Text key={unit.unitKey} style={styles.figure}>{formatTotalQuantity(unit.quantity,unit.unitSymbol)}</Text>):<Text style={[styles.figure,parts.missing]}>None active</Text>}</View>
    <Text style={parts.chevron}>›</Text>
  </Pressable>;
}

const styles=StyleSheet.create({
  center:{alignItems:'center',paddingVertical:24},
  lead:{color:'#4F5B66',fontSize:14,lineHeight:20},
  filterBlock:{backgroundColor:colors.surface,borderRadius:16,overflow:'hidden',borderWidth:1,borderColor:'#E3DBCD'},
  filterBar:{minHeight:60,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16,paddingVertical:10},
  caption:{color:colors.muted,fontSize:12,fontWeight:'600'},
  range:{color:colors.navy,fontSize:15,fontWeight:'700'},
  glyph:{color:colors.navy,fontSize:22},
  panel:{gap:12,padding:16,borderTopWidth:3,borderTopColor:colors.navy,backgroundColor:'#FCFBF8'},
  dates:{flexDirection:'row',flexWrap:'wrap',gap:10},date:{flexGrow:1,flexBasis:140,minWidth:0},
  row:{minHeight:64,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16,paddingVertical:12},
  rowTitle:{color:colors.ink,fontSize:15,fontWeight:'700'},
  rowMeta:{color:'#4F5B66',fontSize:12,marginTop:2},
  figures:{alignItems:'flex-end',flexShrink:0,maxWidth:'45%'},
  figure:{color:colors.ink,fontSize:15,fontWeight:'700',fontVariant:['tabular-nums']},
});
