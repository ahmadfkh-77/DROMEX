import {useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';

import type {CompanyTotalsRecord,CompanyTotalsRepository} from '../../../data/repositories/CompanyTotalsRepository';
import type {ProfileRepository} from '../../../data/repositories/ProfileRepository';
import type {RecordSnapshot} from '../../../domain/businessDocuments';
import {buildMaterialTree,type CompanyTotalsData,type MaterialNode,type ProjectNode} from '../../../domain/companyTotals';
import {countCustomerDeliveryFilters,customerDeliveryFilters,customerDeliveryLabels,describeDeliveredLoad,emptyCustomerDeliveryScope,type CustomerDeliveryScope} from '../../../domain/customerDeliveries';
import {companyContactLine} from '../../../domain/projectTotalsPdf';
import {describeTotalsRange,validateTotalsFilters} from '../../../domain/projectTotals';
import {exportAndShareTotals} from '../../../services/documentExport';
import {colors} from '../../theme';
import {AppButton,EmptyState,Feedback} from '../AppPrimitives';
import {DatePickerField} from '../DatePickerField';
import {FocusedSheet,SheetActions} from '../FocusedSheet';
import {SearchableSelect} from '../SearchableSelect';
import {SegmentedChoice} from '../SegmentedChoice';
import {LedgerRow,styles as parts} from '../totals/TotalsParts';

type Choice={id:string;label:string};
const unique=(values:Choice[])=>[...new Map(values.map(value=>[value.id,value])).values()].sort((a,b)=>a.label.localeCompare(b.label,undefined,{sensitivity:'base',numeric:true}));

/**
 * A customer's page: what was delivered to them. Grouped by material with a total per unit (units never added together), a
 * drill-down Material → Project → loads like Totals, and below it the history of delivered loads. Active loads only; use is
 * not recorded per customer, so nothing here is "used". "Delivered vs paid" is only a link to the existing Payments & Balances
 * statement: this page calculates nothing about money.
 */
export function CustomerDeliveries({customer,totals,profiles,onOpenRecord,onOpenPayments}:{customer:{id:string;name:string};totals:CompanyTotalsRepository;profiles:ProfileRepository;
  onOpenRecord:(record:RecordSnapshot)=>void;onOpenPayments:()=>void}){
  const[scope,setScope]=useState<CustomerDeliveryScope>(emptyCustomerDeliveryScope);
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[drill,setDrill]=useState<{material?:{key:string;name:string};project?:{key:string;name:string}}>({});
  const[data,setData]=useState<CompanyTotalsData|null>(null);
  const[choiceData,setChoiceData]=useState<CompanyTotalsData|null>(null);
  const[records,setRecords]=useState<CompanyTotalsRecord[]|null>(null);
  const[status,setStatus]=useState<'loading'|'ready'|'error'>('loading');
  const[error,setError]=useState<string|null>(null);
  const[attempt,setAttempt]=useState(0);
  const[exportOpen,setExportOpen]=useState(false);
  const[exportPrices,setExportPrices]=useState<'without'|'with'>('without');
  const[exporting,setExporting]=useState(false);
  const[message,setMessage]=useState<{kind:'success'|'error';text:string}|null>(null);

  const issues=validateTotalsFilters({fromDate:scope.fromDate,toDate:scope.toDate,itemKey:'',supplierKey:'',unitKey:'',view:'all'});
  const pageFilters=useMemo(()=>customerDeliveryFilters(customer.id,scope),[customer.id,scope]);
  /** The node on screen: the page filters narrowed by the material and project drilled into. */
  const nodeFilters=useMemo(()=>({...pageFilters,itemKey:drill.material?.key??pageFilters.itemKey,projectKey:drill.project?.key??pageFilters.projectKey}),[pageFilters,drill]);

  useEffect(()=>{
    if(issues.length)return;
    let active=true;setStatus('loading');setError(null);
    Promise.all([totals.getCompanyTotals(pageFilters),totals.listRecords(nodeFilters,5000)])
      .then(([next,found])=>{if(active){setData(next);setRecords(found);setStatus('ready');}})
      .catch(cause=>{if(active){setError(cause instanceof Error?cause.message:'Deliveries could not be loaded.');setStatus('error');}});
    return()=>{active=false;};
  },[totals,pageFilters,nodeFilters,attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    let active=true;
    totals.getCompanyTotals(customerDeliveryFilters(customer.id,{...emptyCustomerDeliveryScope(),fromDate:scope.fromDate,toDate:scope.toDate})).then(next=>{if(active)setChoiceData(next);}).catch(()=>{});
    return()=>{active=false;};
  },[totals,customer.id,scope.fromDate,scope.toDate]);

  const tree=useMemo(()=>data?buildMaterialTree(data):[],[data]);
  const material:MaterialNode|undefined=drill.material?tree.find(value=>value.itemKey===drill.material!.key):undefined;
  const project:ProjectNode|undefined=material&&drill.project?material.projects.find(value=>value.projectKey===drill.project!.key):undefined;
  const choices=useMemo(()=>{const rows=choiceData?.deliveries??[];return {
    items:unique(rows.map(row=>({id:row.itemKey,label:row.itemName}))),projects:unique(rows.map(row=>({id:row.projectKey,label:row.projectName})))};},[choiceData]);
  const set=(patch:Partial<CustomerDeliveryScope>)=>{setScope(current=>({...current,...patch}));setDrill({});};
  const active=countCustomerDeliveryFilters(scope);
  const rangeLabel=describeTotalsRange(scope.fromDate,scope.toDate);

  const exportPdf=async()=>{
    setExporting(true);setMessage(null);
    try{
      const [current,company,history]=await Promise.all([totals.getCompanyTotals(pageFilters),profiles.getCompanySettings(),totals.listRecords(pageFilters,5000)]);
      const names={project:choices.projects.find(value=>value.id===scope.projectKey)?.label,item:choices.items.find(value=>value.id===scope.itemKey)?.label};
      await exportAndShareTotals({companyName:company.companyName,logoUri:company.logoUri,contactLine:companyContactLine(company),title:'Customer Deliveries',scope:'company',
        filters:customerDeliveryLabels(customer.name,scope,names),generatedAt:new Date().toISOString(),includePrices:exportPrices==='with',showProject:true,data:current,records:history,issuedTo:customer.name,
        fileName:{scopeName:customer.name,fromDate:scope.fromDate,toDate:scope.toDate}});
      setExportOpen(false);
      setMessage({kind:'success',text:`Customer Deliveries PDF ready to share, ${exportPrices==='with'?'with recorded prices':'without prices'}.`});
    }catch(cause){setMessage({kind:'error',text:cause instanceof Error?cause.message:'The PDF could not be created.'});}
    finally{setExporting(false);}
  };

  const filterBlock=<View style={styles.filterBlock}>
    <Pressable onPress={()=>setFiltersOpen(value=>!value)} style={({pressed})=>[styles.filterBar,pressed&&parts.pressed]} accessibilityRole="button" accessibilityState={{expanded:filtersOpen}}
      accessibilityLabel={`Filters. Covering ${rangeLabel}. ${active?`${active} active`:'None active'}.`}>
      <View style={parts.flex}><Text style={styles.filterCaption}>Covering</Text><Text style={styles.filterRange}>{rangeLabel}</Text></View>
      <Text style={styles.filterCount}>{active?`${active} filter${active===1?'':'s'} on`:'Filter'}</Text>
      <Text style={styles.glyph} importantForAccessibility="no">{filtersOpen?'×':'+'}</Text>
    </Pressable>
    {filtersOpen?<View style={styles.filterPanel}>
      <View style={styles.dates}>
        <View style={styles.dateField}><DatePickerField label="From" value={scope.fromDate} onChange={fromDate=>set({fromDate})} allowClear placeholder="Any date"/></View>
        <View style={styles.dateField}><DatePickerField label="To" value={scope.toDate} onChange={toDate=>set({toDate})} allowClear placeholder="Any date"/></View>
      </View>
      <SearchableSelect label="Project" options={choices.projects} selectedId={scope.projectKey} onSelect={projectKey=>set({projectKey})} placeholder="All projects" allowClear/>
      <SearchableSelect label="Material" options={choices.items} selectedId={scope.itemKey} onSelect={itemKey=>set({itemKey})} placeholder="All materials" allowClear/>
      {active?<AppButton label="Clear filters" tone="secondary" onPress={()=>set(emptyCustomerDeliveryScope())}/>:null}
    </View>:null}
  </View>;

  const trail=[drill.material?.name,drill.project?.name].filter((value):value is string=>Boolean(value));
  const listTitle=drill.material?`Loads${drill.project?` · ${drill.project.name}`:` · ${drill.material.name}`}`:'History of delivered loads';

  return <View style={styles.wrap}>
    <Text style={styles.sectionTitle} accessibilityRole="header">Delivered to this customer</Text>
    {filterBlock}
    {issues.length?<Feedback kind="warning">{issues.join(' ')}</Feedback>
      :status==='error'?<><Feedback kind="error">{error??'Deliveries could not be loaded.'}</Feedback><AppButton label="Try again" tone="secondary" onPress={()=>setAttempt(value=>value+1)}/></>
      :status==='loading'||!data||!records?<View style={styles.center}><ActivityIndicator color={colors.brand}/><Text style={styles.helper}>Loading deliveries…</Text></View>
      :<>
        {trail.length?<Pressable onPress={()=>setDrill(drill.project?{material:drill.material}:{})} style={styles.back} accessibilityRole="button" accessibilityLabel={drill.project?`Back to ${drill.material!.name}`:'Back to all materials'}>
          <Text style={styles.backText}>‹ {drill.project?drill.material!.name:'All materials'}</Text></Pressable>:null}
        {!drill.material?(tree.length?tree.map((value,index)=><LedgerRow key={value.itemKey} card first={index===0} name={value.itemName} units={value.units} view="delivered" usageHidden
          hint="Shows the projects this material was delivered to" onPress={()=>setDrill({material:{key:value.itemKey,name:value.itemName}})}/>)
          :<EmptyState title="Nothing delivered" body={active?'No loads were delivered to this customer for these filters.':'No loads have been delivered to this customer yet.'}/>)
          :!drill.project&&material?material.projects.map((value,index)=><LedgerRow key={value.projectKey} card first={index===0} name={value.projectName} units={value.units} view="delivered" usageHidden
            hint="Shows the loads delivered to this project" onPress={()=>setDrill({material:drill.material,project:{key:value.projectKey,name:value.projectName}})}/>):null}
        {drill.project&&project?<LedgerRow card first name={project.projectName} units={project.units} view="delivered" usageHidden hint="Totals for this project" onPress={()=>undefined}/>:null}
        {records.length?<>
          <Text style={styles.listTitle} accessibilityRole="header">{listTitle} · {records.length}</Text>
          {records.map(record=>{
            const line=describeDeliveredLoad(record);
            return <Pressable key={record.key} onPress={()=>onOpenRecord(record.snapshot)} style={({pressed})=>[styles.load,pressed&&parts.pressed]} accessibilityRole="button" accessibilityHint="Opens the original load"
              accessibilityLabel={`${line.title}. Transaction ${line.transaction}. ${line.when}. ${line.material}. Project ${line.project}. Destination ${line.destination}. ${line.status}.`}>
              <View style={styles.loadTop}><Text style={[styles.loadTitle,line.legacy&&styles.legacy]} numberOfLines={2}>{line.title}</Text><Text style={styles.loadStatus}>{line.status}</Text></View>
              <Text style={styles.loadMeta}>Transaction {line.transaction} · {line.when}</Text>
              <Row label="Material" value={line.material}/>
              <Row label="Project" value={line.project}/>
              <Row label="Destination" value={line.destination} missing={!line.destinationRecorded}/>
            </Pressable>;
          })}
        </>:(tree.length?<Text style={styles.helper}>No loads to list for this selection.</Text>:null)}
        <Pressable onPress={onOpenPayments} style={({pressed})=>[styles.paid,pressed&&parts.pressed]} accessibilityRole="button" accessibilityLabel={`Delivered vs paid. Open payments and balances for ${customer.name}.`}>
          <View style={parts.flex}><Text style={styles.paidTitle}>Delivered vs paid</Text><Text style={styles.paidBody}>See what was paid and what remains in Payments & Balances</Text></View>
          <Text style={parts.chevron} importantForAccessibility="no">›</Text>
        </Pressable>
        {tree.length?<AppButton label={exporting?'Preparing PDF…':'Export PDF'} tone="secondary" onPress={()=>{setExportPrices('without');setExportOpen(true);}} disabled={exporting} hint="The deliveries for these filters, without prices or with recorded prices"/>:null}
        {message?<Feedback kind={message.kind}>{message.text}</Feedback>:null}
      </>}
    <FocusedSheet visible={exportOpen} eyebrow="EXPORT" title="Customer Deliveries PDF" onClose={()=>setExportOpen(false)} footer={<SheetActions primaryLabel="Create PDF" onPrimary={()=>void exportPdf()} onCancel={()=>setExportOpen(false)} busy={exporting}/>}>
      <Text style={styles.helper}>Exactly what is on this page for {customer.name}: {rangeLabel}{active?` · ${active} filter${active===1?'':'s'}`:''}. Not an invoice or bill.</Text>
      <SegmentedChoice mode="tabs" label="Prices" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]} selectedId={exportPrices} onSelect={setExportPrices}/>
      <Text style={styles.helper}>Without prices is the default: no amount appears. With prices adds only recorded prices.</Text>
      {message?.kind==='error'?<Feedback kind="error">{message.text}</Feedback>:null}
    </FocusedSheet>
  </View>;
}

function Row({label,value,missing=false}:{label:string;value:string;missing?:boolean}){
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={[styles.rowValue,missing&&styles.missing]}>{value}</Text></View>;
}

const styles=StyleSheet.create({
  wrap:{gap:10},sectionTitle:{color:colors.navy,fontSize:19,fontWeight:'900'},center:{alignItems:'center',paddingVertical:20,gap:6},helper:{color:colors.muted,fontSize:13.5,lineHeight:19},
  filterBlock:{borderWidth:1,borderColor:colors.line,borderRadius:14,backgroundColor:colors.surface,overflow:'hidden'},
  filterBar:{flexDirection:'row',alignItems:'center',gap:10,padding:12,minHeight:56},filterCaption:{color:colors.muted,fontSize:10.5,fontWeight:'800',textTransform:'uppercase',letterSpacing:.6},
  filterRange:{color:colors.ink,fontSize:14,fontWeight:'800'},filterCount:{color:colors.brand,fontSize:12.5,fontWeight:'800'},glyph:{color:colors.brand,fontSize:22,fontWeight:'700',width:22,textAlign:'center'},
  filterPanel:{gap:12,padding:12,borderTopWidth:1,borderTopColor:colors.line},dates:{flexDirection:'row',gap:10},dateField:{flex:1},
  back:{minHeight:44,justifyContent:'center'},backText:{color:colors.navy,fontSize:15,fontWeight:'800'},
  listTitle:{color:colors.navy,fontSize:13,fontWeight:'900',textTransform:'uppercase',letterSpacing:.4,marginTop:6},
  load:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:14,padding:12,gap:3},loadTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',gap:8},
  loadTitle:{flex:1,color:colors.navy,fontSize:15,fontWeight:'900'},legacy:{color:colors.muted,fontStyle:'italic',fontWeight:'500',fontSize:13},loadStatus:{color:colors.success,fontSize:11.5,fontWeight:'800'},
  loadMeta:{color:colors.muted,fontSize:12.5,marginBottom:2},row:{flexDirection:'row',justifyContent:'space-between',gap:10},rowLabel:{color:colors.muted,fontSize:12.5},
  rowValue:{flex:1,color:colors.ink,fontSize:13,fontWeight:'700',textAlign:'right'},missing:{color:colors.muted,fontStyle:'italic',fontWeight:'500'},
  paid:{flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:colors.line,borderRadius:14,backgroundColor:colors.surface,padding:14,minHeight:60},
  paidTitle:{color:colors.navy,fontSize:15,fontWeight:'900'},paidBody:{color:colors.muted,fontSize:12.5,marginTop:2},
});
