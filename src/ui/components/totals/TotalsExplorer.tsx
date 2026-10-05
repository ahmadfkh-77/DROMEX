import {useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,LayoutAnimation,Pressable,StyleSheet,Text,View} from 'react-native';

import type {BusinessDocumentRepository} from '../../../data/repositories/BusinessDocumentRepository';
import type {CompanyTotalsRecord,CompanyTotalsRepository,UsageRecord} from '../../../data/repositories/CompanyTotalsRepository';
import type {LoadNumberSeriesRepository} from '../../../data/repositories/LoadNumberSeriesRepository';
import type {ProfileRepository} from '../../../data/repositories/ProfileRepository';
import {exportAndShareTotals} from '../../../services/documentExport';
import {inclusionFilterLabels,type InclusionFilter,type RecordSnapshot} from '../../../domain/businessDocuments';
import {
  buildMaterialTree,COMPANY_SUPPLIER_KEY,countCompanyFilters,treeTotals,unitDifferences,emptyCompanyTotalsFilters,LEGACY_SERIES_KEY,LEGACY_SERIES_LABEL,NO_PROJECT_KEY,
  type CompanyTotalsData,type CompanyTotalsFilters,type MaterialNode,type ProjectNode,type SupplierNode,type TotalsView,type UnitMeasures,
} from '../../../domain/companyTotals';
import {describeTotalsRange,formatTotalQuantity,validateTotalsFilters,type ProjectFuelFill} from '../../../domain/projectTotals';
import {companyContactLine,customerBox} from '../../../domain/projectTotalsPdf';
import type {DocumentStart} from '../../documentFlow';
import {colors} from '../../theme';
import {formatDay} from '../../totalsPresentation';
import {AppButton,EmptyState,Feedback} from '../AppPrimitives';
import {DatePickerField} from '../DatePickerField';
import {useReducedMotion} from '../ExpandableMenu';
import {FocusedSheet,SheetActions} from '../FocusedSheet';
import {SearchableSelect} from '../SearchableSelect';
import {SegmentedChoice} from '../SegmentedChoice';
import {DocumentStartSheet,type StartQuery} from './DocumentStartSheet';
import {Ledger,LedgerRow,MeasureRow,QuietButton,RecordRow,SummaryBand,styles as parts} from './TotalsParts';

/** A project also carries what its Totals PDF header shows: its customer, location and status (read from the project, never recalculated). */
export type ExplorerScope={kind:'company'}|{kind:'project';projectId:string;projectName:string;customerId?:string;customerName?:string;location?:string|null;status?:string};
type Node={key:string;name:string};
/** Where the explorer is: nothing chosen is the top level; a supplier (or "all records") is the records level. */
export type ExplorerLevel={material?:Node;project?:Node;supplier?:Node};
export const ALL_RECORDS:Node={key:'',name:'All records'};

const viewOptions:{id:TotalsView;label:string}[]=[{id:'all',label:'All'},{id:'delivered',label:'Delivered'},{id:'used',label:'Used'}];
const inclusionOptions=(Object.keys(inclusionFilterLabels) as InclusionFilter[]).map(id=>({id,label:inclusionFilterLabels[id]}));
type Choice={id:string;label:string};
const unique=(values:Choice[])=>[...new Map(values.map(value=>[value.id,value])).values()].sort((a,b)=>a.label.localeCompare(b.label,undefined,{sensitivity:'base',numeric:true}));

/**
 * DEC-500 (1). Company Totals and Project Totals share this explorer. Company: Material → Project →
 * Supplier → records. Project: Material → Supplier → records (the project is fixed). Every level shows
 * one summary band and one ruled list; every figure comes from buildMaterialTree. The parent owns the
 * level so its Back button can step up one level at a time.
 */
export function TotalsExplorer({scope,totals,documents,series,profiles,loadFuelFills,level,onLevel,onOpenRecord,onOpenReport,onCreateDocument,onFilters,refreshToken=0}:{
  scope:ExplorerScope;totals:CompanyTotalsRepository;documents:BusinessDocumentRepository;series:LoadNumberSeriesRepository;
  /** Company name and logo for the Totals PDF; without it the Export PDF action is not offered. */
  profiles?:ProfileRepository;
  /** Project Totals only: the project's fuel fills for a date range, offered as an optional PDF section. */
  loadFuelFills?:(range:{fromDate:string;toDate:string})=>Promise<ProjectFuelFill[]>;
  level:ExplorerLevel;onLevel:(level:ExplorerLevel)=>void;onOpenRecord:(record:RecordSnapshot)=>void;onOpenReport:(usage:UsageRecord)=>void;onCreateDocument:(start:DocumentStart)=>void;
  /** Reports the filters, so a parent can show other sections for the same dates and view. */
  onFilters?:(filters:CompanyTotalsFilters)=>void;refreshToken?:number;
}){
  const reducedMotion=useReducedMotion();
  const fixedProject=scope.kind==='project'?scope.projectId:'';
  const[filters,setFilters]=useState<CompanyTotalsFilters>(()=>({...emptyCompanyTotalsFilters(),projectKey:fixedProject}));
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[data,setData]=useState<CompanyTotalsData|null>(null);
  const[choiceData,setChoiceData]=useState<CompanyTotalsData|null>(null);
  const[seriesChoices,setSeriesChoices]=useState<Choice[]>([]);
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[error,setError]=useState<string|null>(null);
  const[attempt,setAttempt]=useState(0);
  const[records,setRecords]=useState<CompanyTotalsRecord[]|null>(null);
  const[selecting,setSelecting]=useState(false);
  const[selected,setSelected]=useState<Set<string>>(()=>new Set());
  const[usage,setUsage]=useState<{title:string;filters:CompanyTotalsFilters;movement:'used'|'transported'}|null>(null);
  const[start,setStart]=useState<StartQuery|null>(null);
  const[exporting,setExporting]=useState(false);
  const[exportOpen,setExportOpen]=useState(false);
  const[exportPrices,setExportPrices]=useState<'without'|'with'>('without');
  const[exportProject,setExportProject]=useState<'show'|'hide'>('show');
  const[exportFuel,setExportFuel]=useState<'leave'|'include'>('leave');
  /** Fuel belongs to the whole project, so it is offered on the project's top level only. */
  const fuelChoiceShown=Boolean(loadFuelFills)&&scope.kind==='project'&&!level.material;
  const[exportMessage,setExportMessage]=useState<{kind:'success'|'error';text:string}|null>(null);

  const issues=validateTotalsFilters({fromDate:filters.fromDate,toDate:filters.toDate,itemKey:'',supplierKey:'',unitKey:'',view:'all'});
  const set=(patch:Partial<CompanyTotalsFilters>)=>setFilters(current=>({...current,...patch}));
  const nodeFilters:CompanyTotalsFilters=useMemo(()=>({...filters,
    itemKey:level.material?.key??filters.itemKey,
    projectKey:fixedProject||(level.project?.key??filters.projectKey),
    supplierKey:level.supplier?.key||filters.supplierKey}),[filters,level,fixedProject]);
  const atRecords=Boolean(level.supplier);
  useEffect(()=>{onFilters?.(filters);},[filters,onFilters]);

  useEffect(()=>{
    if(issues.length)return;
    let active=true;setStatus('loading');setError(null);
    totals.getCompanyTotals(filters).then(next=>{if(active){setData(next);setStatus('ready');}}).catch(cause=>{if(active){setError(cause instanceof Error?cause.message:'Totals could not be calculated.');setStatus('error');}});
    return()=>{active=false;};
  },[totals,filters,attempt,refreshToken]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{
    let active=true;
    totals.getCompanyTotals({...emptyCompanyTotalsFilters(),fromDate:filters.fromDate,toDate:filters.toDate,projectKey:fixedProject}).then(next=>{if(active)setChoiceData(next);}).catch(()=>{});
    series.listSeries().then(list=>{if(active)setSeriesChoices([...list.map(value=>({id:value.id,label:`${value.prefix} · ${value.displayName}${value.isActive?'':' (inactive)'}`})),{id:LEGACY_SERIES_KEY,label:LEGACY_SERIES_LABEL}]);}).catch(()=>{});
    return()=>{active=false;};
  },[totals,series,filters.fromDate,filters.toDate,fixedProject,refreshToken]);
  useEffect(()=>{
    if(!atRecords){setRecords(null);setSelecting(false);setSelected(new Set());return;}
    let active=true;setRecords(null);
    totals.listRecords(nodeFilters).then(found=>{if(active)setRecords(found);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Records could not be loaded.');});
    return()=>{active=false;};
  },[atRecords,totals,nodeFilters,attempt,refreshToken]);

  const tree=useMemo(()=>data?buildMaterialTree(data):[],[data]);
  const material:MaterialNode|undefined=level.material?tree.find(value=>value.itemKey===level.material!.key):undefined;
  const place:ProjectNode|undefined=material?(scope.kind==='project'?material.projects[0]:level.project?material.projects.find(value=>value.projectKey===level.project!.key):undefined):undefined;
  const supplier:SupplierNode|undefined=place&&level.supplier?.key?place.suppliers.find(value=>value.supplierKey===level.supplier!.key):undefined;
  const choices=useMemo(()=>{
    const rows=choiceData?[...choiceData.deliveries,...choiceData.usage]:[];
    return {
      items:unique(rows.map(row=>({id:row.itemKey,label:row.itemName}))),
      projects:unique(rows.map(row=>({id:row.projectKey,label:row.projectName}))),
      suppliers:unique((choiceData?.deliveries??[]).map(row=>({id:row.supplierKey,label:row.supplierName}))),
      units:unique(rows.map(row=>({id:row.unitKey,label:row.unitSymbol}))),
    };
  },[choiceData]);

  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.create(180,'easeInEaseOut','opacity'));};
  const go=(next:ExplorerLevel)=>{animate();onLevel(next);};
  const rangeLabel=describeTotalsRange(filters.fromDate,filters.toDate);
  const active=countCompanyFilters({...filters,projectKey:fixedProject?'':filters.projectKey});
  const usageHidden=Boolean(data?.usageHiddenReason);
  const scopeName=scope.kind==='project'?scope.projectName:'All projects';
  const trail=[scopeName,level.material?.name,scope.kind==='company'?level.project?.name:undefined,level.supplier?.name].filter((value):value is string=>Boolean(value));
  const context=trail.slice(1).join(' › ')||scopeName;
  const openStart=(presetKeys?:string[])=>setStart({context,filters:nodeFilters,presetKeys});

  const filterBlock=<View style={styles.filterBlock}>
    <Pressable onPress={()=>{animate();setFiltersOpen(value=>!value);}} style={({pressed})=>[styles.filterBar,pressed&&parts.pressed]} accessibilityRole="button" accessibilityState={{expanded:filtersOpen}}
      accessibilityLabel={`Filters. Covering ${rangeLabel}. ${active?`${active} active`:'None active'}.`}>
      <View style={parts.flex}><Text style={styles.filterCaption}>Covering</Text><Text style={styles.filterRange}>{rangeLabel}</Text></View>
      <Text style={styles.filterCount}>{active?`${active} filter${active===1?'':'s'} on`:'Filter'}</Text>
      <Text style={styles.toggleGlyph} importantForAccessibility="no">{filtersOpen?'×':'+'}</Text>
    </Pressable>
    {filtersOpen?<View style={styles.filterPanel}>
      <View style={styles.dates}>
        <View style={styles.dateField}><DatePickerField label="From" value={filters.fromDate} onChange={fromDate=>set({fromDate})} allowClear placeholder="Any date"/></View>
        <View style={styles.dateField}><DatePickerField label="To" value={filters.toDate} onChange={toDate=>set({toDate})} allowClear placeholder="Any date"/></View>
      </View>
      <SearchableSelect label="Material / item" options={choices.items} selectedId={filters.itemKey} onSelect={itemKey=>set({itemKey})} placeholder="All items" allowClear/>
      {scope.kind==='company'?<SearchableSelect label="Project" options={choices.projects} selectedId={filters.projectKey} onSelect={projectKey=>set({projectKey})} placeholder="All projects" allowClear/>:null}
      <SearchableSelect label="Supplier" options={choices.suppliers} selectedId={filters.supplierKey} onSelect={supplierKey=>set({supplierKey})} placeholder="All suppliers and company loads" allowClear/>
      <SearchableSelect label="Unit" options={choices.units} selectedId={filters.unitKey} onSelect={unitKey=>set({unitKey})} placeholder="All units" allowClear/>
      <SearchableSelect label="Company-load number series" options={seriesChoices} selectedId={filters.seriesId} onSelect={seriesId=>set({seriesId})} placeholder="Any series" allowClear/>
      <SegmentedChoice mode="tabs" label="Show" options={viewOptions} selectedId={filters.view} onSelect={view=>set({view})}/>
      <SegmentedChoice mode="tabs" label="Document status" options={inclusionOptions} selectedId={filters.inclusion} onSelect={inclusion=>set({inclusion})}/>
      {active?<AppButton label="Clear all filters" tone="secondary" onPress={()=>setFilters({...emptyCompanyTotalsFilters(),projectKey:fixedProject})}/>:null}
    </View>:null}
  </View>;

  if(issues.length)return <>{filterBlock}<Feedback kind="warning">{issues.join(' ')}</Feedback></>;
  if(status==='error')return <>{filterBlock}<Feedback kind="error">{error??'Totals could not be calculated.'}</Feedback><AppButton label="Try again" tone="secondary" onPress={()=>setAttempt(value=>value+1)}/></>;
  if(status==='loading'||!data)return <>{filterBlock}<View style={styles.center}><ActivityIndicator color={colors.brand}/><Text style={styles.helper}>Calculating totals…</Text></View></>;

  /** DEC-500. The PDF covers exactly what is on screen: the filters and the level drilled into. */
  const exportPdf=async(includePrices:boolean,showProject:boolean,includeFuel:boolean)=>{
    if(!profiles)return;
    setExporting(true);setExportMessage(null);
    try{
      // On the records level the PDF is a Loads History: every load behind these totals, listed.
      const fuel=includeFuel&&fuelChoiceShown?await loadFuelFills!({fromDate:filters.fromDate,toDate:filters.toDate}):undefined;
      // Project Totals (not on a records level): the customer and supplier boxes and every Active load behind the totals.
      const projectScope=scope.kind==='project'&&!atRecords;
      const [current,company,history,projectLoads,customers]=await Promise.all([totals.getCompanyTotals(nodeFilters),profiles.getCompanySettings(),atRecords?totals.listRecords(nodeFilters,5000):Promise.resolve(undefined),projectScope?totals.listRecords(nodeFilters,5000):Promise.resolve([] as CompanyTotalsRecord[]),projectScope?profiles.listCustomers():Promise.resolve([])]);
      const contactLine=companyContactLine(company);
      const found=scope.kind==='project'&&scope.customerId?customers.find(value=>value.id===scope.customerId):undefined;
      const project=scope.kind==='project'&&projectScope?{name:scope.projectName,location:scope.location??null,status:scope.status??'Active',customer:customerBox(found?{name:found.name,isOwnCompany:found.isOwnCompany}:scope.customerName?{name:scope.customerName,isOwnCompany:false}:null),loads:projectLoads}:undefined;
      const label=(list:Choice[],id:string)=>list.find(value=>value.id===id)?.label??id;
      const labels=[rangeLabel,...trail.slice(1),
        ...(filters.itemKey&&!level.material?[`Item: ${label(choices.items,filters.itemKey)}`]:[]),
        ...(filters.projectKey&&scope.kind==='company'&&!level.project?[`Project: ${label(choices.projects,filters.projectKey)}`]:[]),
        ...(filters.supplierKey&&!level.supplier?[`Supplier: ${label(choices.suppliers,filters.supplierKey)}`]:[]),
        ...(filters.unitKey?[`Unit: ${label(choices.units,filters.unitKey)}`]:[]),
        ...(filters.seriesId?[`Series: ${label(seriesChoices,filters.seriesId)}`]:[]),
        ...(filters.view!=='all'?[filters.view==='delivered'?'Delivered only':'Used only']:[]),
        ...(filters.inclusion!=='all'?[`Document status: ${inclusionFilterLabels[filters.inclusion]}`]:[])];
      const title=atRecords?'Loads History':scope.kind==='project'?'Project Totals':'Company Totals';
      const parts=[level.material?.name,scope.kind==='project'?scope.projectName:level.project?.name,level.supplier?.key?level.supplier.name:undefined];
      await exportAndShareTotals({companyName:company.companyName,logoUri:company.logoUri,title,scope:scope.kind,filters:labels,generatedAt:new Date().toISOString(),includePrices,showProject,fuel,data:current,records:history,issuedTo:issuedTo(level.supplier,history),contactLine,project,
        fileName:{scopeName:parts.filter(Boolean).join(' ')||null,fromDate:filters.fromDate,toDate:filters.toDate}});
      setExportMessage({kind:'success',text:`${title} PDF ready to share, ${includePrices?'with recorded prices':'without prices'}.`});
    }catch(cause){setExportMessage({kind:'error',text:cause instanceof Error?cause.message:'The PDF could not be created.'});}
    finally{setExporting(false);}
  };
  const askExport=()=>{setExportPrices('without');setExportProject('show');setExportFuel('leave');setExportOpen(true);};
  const createButton=<>
    <QuietButton label="Create document" onPress={()=>openStart()} hint="Choose records, who the document is for, and its type"/>
    {profiles?<QuietButton label={exporting?'Preparing PDF…':'Export PDF'} onPress={askExport} disabled={exporting} hint="Without prices or with recorded prices"/>:null}
  </>;
  const usageNotice=data.usageHiddenReason?<Text style={styles.notice}>{data.usageHiddenReason}</Text>:null;
  const usageLedger=(units:UnitMeasures[],base:CompanyTotalsFilters)=>{
    const lines=units.flatMap(unit=>[unit.used?{movement:'used' as const,unit,measure:unit.used}:null,unit.transported?{movement:'transported' as const,unit,measure:unit.transported}:null]).filter((value):value is NonNullable<typeof value>=>value!=null);
    if(!lines.length||filters.view==='delivered'||usageHidden)return null;
    return <Ledger separate title="Recorded on site" note="From Daily Reports. Use is not recorded per supplier, so it is never split by supplier.">
      {lines.map((line,index)=><MeasureRow key={`${line.movement}-${line.unit.unitKey}`} card first={index===0} label={`${line.movement==='used'?'Used':'Transported'} · ${line.unit.unitSymbol}`} quantity={line.measure.quantity} unitSymbol={line.unit.unitSymbol} recordCount={line.measure.recordCount}
        onPress={()=>setUsage({title:`${level.material?.name??''} ${line.movement} (${line.unit.unitSymbol})`,filters:{...base,unitKey:line.unit.unitKey},movement:line.movement})}/>)}
      {filters.view==='all'?unitDifferences(units).map(line=><View key={`difference-${line.unitKey}`} style={[styles.difference,parts.card]} accessible accessibilityLabel={`Delivered minus recorded use: ${formatTotalQuantity(line.difference,line.unitSymbol)}. Not an inventory balance.`}>
        <View style={parts.flex}><Text style={styles.differenceLabel}>Delivered minus recorded use · {line.unitSymbol}</Text><Text style={styles.helper}>Not an inventory balance: only what was recorded as delivered and used.</Text></View>
        <Text style={styles.usageQty}>{formatTotalQuantity(line.difference,line.unitSymbol)}</Text>
      </View>):null}
    </Ledger>;
  };

  let body;
  if(atRecords){
    const count=records?.length??0;
    const headUnits=supplier?.units.map(unit=>({unitKey:unit.unitKey,unitSymbol:unit.unitSymbol,delivered:{quantity:unit.quantity,recordCount:unit.recordCount},used:null,transported:null}))??place?.units.map(unit=>({...unit,used:null,transported:null}))??material?.units.map(unit=>({...unit,used:null,transported:null}))??[];
    body=<>
      <SummaryBand trail={trail.slice(0,-1)} title={level.supplier!.name} units={headUnits} view={filters.view==='used'?'all':'delivered'} usageHidden inclusion={supplier?.inclusion??place?.inclusion??material?.inclusion??null} value={supplier?.value??null}>
        {createButton}
        <QuietButton label={selecting?'Stop selecting':'Select records'} onPress={()=>{setSelecting(value=>!value);setSelected(new Set());}} hint="Tick individual records for a document"/>
      </SummaryBand>
      {filters.view==='used'?<Text style={styles.notice}>Showing delivered records. Use records are listed under Recorded on site.</Text>:null}
      {!records?<View style={styles.center}><ActivityIndicator color={colors.brand}/></View>
        :count?<Ledger separate title="Original records" note="Each record opens its own screen. Document status is read from issued and draft documents, never stored on the record.">
          {records.map((record,index)=><RecordRow key={record.key} record={record} card first={index===0} selectable={selecting} selected={selected.has(record.key)}
            onToggle={()=>setSelected(current=>{const next=new Set(current);if(next.has(record.key))next.delete(record.key);else next.add(record.key);return next;})} onOpen={()=>onOpenRecord(record.snapshot)}/>)}
        </Ledger>:<EmptyState title="No records match" body="Widen the dates or clear a filter."/>}
      {count>=500?<Text style={styles.helper}>Showing the first 500 records. Narrow the dates to see the rest.</Text>:null}
      {selecting?<AppButton label={selected.size?`Create document from ${selected.size} selected`:'Tick records to continue'} disabled={!selected.size} onPress={()=>openStart([...selected])}/>:null}
    </>;
  }else if(material&&(place||scope.kind==='project')){
    const node=place;
    body=<>
      <SummaryBand trail={trail.slice(0,-1)} title={scope.kind==='project'?material.itemName:level.project!.name} units={node?.units??[]} view={filters.view} usageHidden={usageHidden} inclusion={node?.inclusion??null} value={node?.value??null}>{createButton}</SummaryBand>
      {usageNotice}
      {node?.suppliers.length&&filters.view!=='used'?<Ledger separate title="Delivered by" note="Suppliers first, then the company’s own loads, which are not a supplier.">
        {node.suppliers.map((value,index)=><LedgerRow key={value.supplierKey} card first={index===0} name={value.supplierName} tag={value.source==='company_delivery'?'Own loads, not a supplier':undefined}
          units={value.units.map(unit=>({unitKey:unit.unitKey,unitSymbol:unit.unitSymbol,delivered:{quantity:unit.quantity,recordCount:unit.recordCount},used:null,transported:null}))}
          view="delivered" inclusion={value.inclusion} value={value.value} hint="Opens this source’s original records" onPress={()=>go({...level,supplier:{key:value.supplierKey,name:value.supplierName}})}/>)}
      </Ledger>:null}
      {node?usageLedger(node.units,nodeFilters):null}
      {node?.suppliers.length&&filters.view!=='used'?<AppButton label="Show every delivered record" tone="secondary" onPress={()=>go({...level,supplier:ALL_RECORDS})}/>:null}
      {!node?<EmptyState title="Nothing recorded here" body="No records match the current filters."/>:null}
    </>;
  }else if(material){
    body=<>
      <SummaryBand trail={trail.slice(0,-1)} title={material.itemName} units={material.units} view={filters.view} usageHidden={usageHidden} inclusion={material.inclusion} value={material.value}>{createButton}</SummaryBand>
      {usageNotice}
      <Ledger separate title="By project" note="Only projects with records for this material appear.">
        {material.projects.map((value,index)=><LedgerRow key={value.projectKey} card first={index===0} name={value.projectName} units={value.units} view={filters.view} usageHidden={usageHidden} inclusion={value.inclusion} value={value.value}
          hint="Opens this project’s suppliers and records" onPress={()=>go({material:level.material,project:{key:value.projectKey,name:value.projectName}})}/>)}
      </Ledger>
      {filters.view!=='used'?<AppButton label="Show every delivered record" tone="secondary" onPress={()=>go({...level,supplier:ALL_RECORDS})}/>:null}
    </>;
  }else{
    const whole=treeTotals(tree);
    body=<>
      <SummaryBand trail={[]} title={scopeName} lead={`${whole.materialCount} material${whole.materialCount===1?'':'s'} · ${rangeLabel}`} view={filters.view} usageHidden={usageHidden} inclusion={whole.inclusion} value={whole.value}>{createButton}</SummaryBand>
      {usageNotice}
      {tree.length?<Ledger separate title="Materials" note="Each unit stays on its own line. Delivered and used are never added together.">
        {tree.map((value,index)=><LedgerRow key={value.itemKey} card first={index===0} name={value.itemName} units={value.units} view={filters.view} usageHidden={usageHidden} inclusion={value.inclusion} value={value.value}
          hint={scope.kind==='project'?'Opens this material’s suppliers and records':'Opens the projects with this material'} onPress={()=>go({material:{key:value.itemKey,name:value.itemName}})}/>)}
      </Ledger>:<EmptyState title="Nothing recorded for these filters" body={`No deliveries or recorded use ${filters.fromDate||filters.toDate?`between ${formatDay(filters.fromDate||null)} and ${formatDay(filters.toDate||null)}`:'yet'}. Widen the dates or clear a filter.`}/>}
    </>;
  }

  return <>
    {filterBlock}
    {exportMessage?<Feedback kind={exportMessage.kind}>{exportMessage.text}</Feedback>:null}
    {body}
    <UsageSheet query={usage} totals={totals} onClose={()=>setUsage(null)} onOpen={report=>{setUsage(null);onOpenReport(report);}}/>
    <FocusedSheet visible={exportOpen} eyebrow="EXPORT PDF" title={atRecords?'Loads History':scope.kind==='project'?'Project Totals':'Company Totals'} onClose={()=>setExportOpen(false)}
      footer={<SheetActions primaryLabel="Export PDF" onCancel={()=>setExportOpen(false)} onPrimary={()=>{setExportOpen(false);void exportPdf(exportPrices==='with',exportProject==='show',exportFuel==='include');}}/>}>
      <Text style={styles.helper}>{atRecords?'Every load listed here, with its totals. It is not an invoice or bill.':'Covers the filters and the level you are looking at.'}</Text>
      <SegmentedChoice label="Prices" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]} selectedId={exportPrices} onSelect={setExportPrices}/>
      {fuelChoiceShown?<SegmentedChoice label="Fuel" options={[{id:'leave',label:'Leave out'},{id:'include',label:'Include fuel list'}]} selectedId={exportFuel} onSelect={setExportFuel}/>:null}
      {fuelChoiceShown&&exportFuel==='include'?<Text style={styles.helper}>Adds fuel per type and equipment and every fill in the Covering dates. Prices and cost appear only with prices.</Text>:null}
      {atRecords?<SegmentedChoice label="Project column" options={[{id:'show',label:'Show project'},{id:'hide',label:'Hide project'}]} selectedId={exportProject} onSelect={setExportProject}/>:null}
    </FocusedSheet>
    <DocumentStartSheet visible={!!start} documents={documents} query={start} onClose={()=>setStart(null)} onStart={value=>{setStart(null);setSelecting(false);setSelected(new Set());onCreateDocument(value);}}/>
  </>;
}

/**
 * "Issued to" on a Loads History: the supplier for Supplier Loads; for the company's own loads, the
 * customer when every load belongs to one customer. Nothing when mixed or not on a records level.
 */
function issuedTo(supplier:Node|undefined,history:CompanyTotalsRecord[]|undefined):string|null{
  if(!supplier?.key||!history)return null;
  if(supplier.key!==COMPANY_SUPPLIER_KEY)return supplier.name;
  const customers=[...new Set(history.map(record=>record.snapshot.partyName))];
  return customers.length===1?customers[0]!:null;
}

/** The Daily Reports behind one Used or Transported figure. */
function UsageSheet({query,totals,onClose,onOpen}:{query:{title:string;filters:CompanyTotalsFilters;movement:'used'|'transported'}|null;totals:CompanyTotalsRepository;onClose:()=>void;onOpen:(report:UsageRecord)=>void}){
  const[rows,setRows]=useState<UsageRecord[]|null>(null);
  const[error,setError]=useState<string|null>(null);
  useEffect(()=>{
    if(!query)return;let active=true;setRows(null);setError(null);
    totals.listUsageRecords(query.filters,query.movement).then(found=>{if(active)setRows(found);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Records could not be loaded.');});
    return()=>{active=false;};
  },[query,totals]);
  return <FocusedSheet visible={!!query} eyebrow="DAILY REPORTS" title={query?.title??''} onClose={onClose} footer={<View style={parts.flex}><AppButton label="Close" tone="secondary" onPress={onClose}/></View>}>
    {error?<Feedback kind="error">{error}</Feedback>:!rows?<View style={styles.center}><ActivityIndicator color={colors.brand}/></View>
      :rows.length?<View style={parts.ledger}>{rows.map((row,index)=><Pressable key={row.reportId} onPress={()=>onOpen(row)} style={({pressed})=>[styles.usageRow,index>0&&parts.rowRule,pressed&&parts.pressed]} accessibilityRole="button"
        accessibilityLabel={`Daily Report ${formatDay(row.workDate)}, ${row.projectName}, ${formatTotalQuantity(row.quantity,row.unitSymbol)}. Open report.`}>
        <View style={parts.flex}><Text style={styles.usageTitle}>Daily Report · {formatDay(row.workDate)}</Text><Text style={styles.helper}>{row.projectName}</Text></View>
        <Text style={styles.usageQty}>{formatTotalQuantity(row.quantity,row.unitSymbol)}</Text><Text style={parts.chevron}>›</Text>
      </Pressable>)}</View>:<Text style={styles.helper}>No reports match.</Text>}
    {query?.filters.projectKey===NO_PROJECT_KEY?<Text style={styles.helper}>Use is always recorded on a project.</Text>:null}
  </FocusedSheet>;
}

const styles=StyleSheet.create({
  center:{alignItems:'center',gap:12,paddingVertical:24},
  helper:{color:'#4F5B66',fontSize:13,lineHeight:19},
  notice:{color:'#4F5B66',fontSize:13,lineHeight:19,backgroundColor:colors.surface,borderRadius:12,padding:12},
  filterBlock:{backgroundColor:colors.surface,borderRadius:16,overflow:'hidden',borderWidth:1,borderColor:'#E3DBCD'},
  filterBar:{minHeight:60,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16,paddingVertical:10},
  filterCaption:{color:colors.muted,fontSize:12,fontWeight:'600'},
  filterRange:{color:colors.navy,fontSize:15,fontWeight:'700',marginTop:1},
  filterCount:{color:colors.brandDark,fontSize:13,fontWeight:'700'},
  toggleGlyph:{color:colors.navy,fontSize:22,lineHeight:24,fontWeight:'500'},
  filterPanel:{gap:12,padding:16,paddingTop:14,borderTopWidth:3,borderTopColor:colors.navy,backgroundColor:'#FCFBF8'},
  dates:{flexDirection:'row',flexWrap:'wrap',gap:10},dateField:{flexGrow:1,flexBasis:140,minWidth:0},
  difference:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,paddingVertical:10,backgroundColor:'#FAF8F4'},
  differenceLabel:{color:colors.ink,fontSize:14,fontWeight:'600'},
  usageRow:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,paddingVertical:10},
  usageTitle:{color:colors.ink,fontSize:14,fontWeight:'700'},
  usageQty:{color:colors.ink,fontSize:15,fontWeight:'700',fontVariant:['tabular-nums']},
});
