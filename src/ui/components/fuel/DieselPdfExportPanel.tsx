import {useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {FuelSetup} from '../../../domain/fuel';
import type {BatchDetail} from '../../../domain/fuelBatches';
import {fuelDayLabel} from '../../../domain/fuelBatchViews';
import {colors,radius} from '../../theme';
import {AppButton,Feedback} from '../AppPrimitives';
import {DatePickerField,todayIso} from '../DatePickerField';
import {SearchableSelect} from '../SearchableSelect';
import {SegmentedChoice} from '../SegmentedChoice';
import {useExportHeader} from '../useExportHeader';

/** DEC-506. What a Diesel Batch Report covers. Every field is optional: nothing set means everything. */
export type DieselExportFilter={batchId?:string;projectId?:string;companySiteId?:string;stationId?:string;unassigned?:boolean;fromDate?:string;toDate?:string;supplierId?:string;status?:'open'|'closed'|'cancelled';source?:'tank'|'station'};
export type DieselPdfFilterState={supplierId:string;batchId:string;status:'all'|'open'|'closed'|'cancelled';projectId:string;companySiteId:string;stationId:string;source:'all'|'tank'|'station';fromDate:string;toDate:string};
export const emptyDieselPdfFilters:DieselPdfFilterState={supplierId:'',batchId:'',status:'all',projectId:'',companySiteId:'',stationId:'',source:'all',fromDate:'',toDate:''};

export function dieselFilterFromState(state:DieselPdfFilterState):DieselExportFilter{
  return {
    supplierId:state.supplierId||undefined,batchId:state.batchId||undefined,status:state.status==='all'?undefined:state.status,projectId:state.projectId||undefined,
    companySiteId:state.companySiteId||undefined,stationId:state.stationId||undefined,source:state.source==='all'?undefined:state.source,fromDate:state.fromDate||undefined,toDate:state.toDate||undefined,
  };
}

/** "Al-Nour Fuel Co. · Yard B · 1 Sep – 30 Sep 2026 · without prices" for the line above the Export button. */
export function dieselFilterSummary(state:DieselPdfFilterState,names:{suppliers:Record<string,string>;projects:Record<string,string>;sites:Record<string,string>;stations:Record<string,string>;batches:Record<string,string>},withPrices:boolean):string{
  const parts:string[]=[];
  if(state.supplierId)parts.push(names.suppliers[state.supplierId]??'Selected supplier');
  if(state.batchId)parts.push(names.batches[state.batchId]??'Selected batch');
  if(state.status!=='all')parts.push(`${state.status[0]!.toUpperCase()}${state.status.slice(1)} batches`);
  if(state.projectId)parts.push(names.projects[state.projectId]??'Selected project');
  if(state.companySiteId)parts.push(names.sites[state.companySiteId]??'Selected site');
  if(state.stationId)parts.push(names.stations[state.stationId]??'Selected station');
  if(state.source!=='all')parts.push(state.source==='tank'?'From tank only':'Outside stations only');
  if(state.fromDate||state.toDate)parts.push(`${state.fromDate?fuelDayLabel(state.fromDate):'The start'} – ${state.toDate?fuelDayLabel(state.toDate):'Today'}`);
  else parts.push('All dates');
  parts.push(withPrices?'with prices':'without prices');
  return parts.join(' · ');
}

type Company={name:string;logoUri:string|null;contactLine:string|null};

/**
 * DEC-505, Screen F. Export the Diesel Batch Report. Without prices is the default (DEC-373); with prices adds only
 * recorded prices, and missing ones print as Unpriced, never $0. DEC-506: given `setup`, the panel carries its own
 * filters, pre-filled from the screen it was opened on and changeable before exporting; changing them here never
 * changes the screen's own filters.
 */
export function DieselPdfExportPanel({label,scope,projectId,onExport,setup,batches,initial}:{label:string;scope:string;
  /** Phase 5. Set when the export is for one project, so the Header company can be remembered for it. */
  projectId?:string|null;
  /** `company` is the chosen Header company's name, logo and contact line; absent when no picker is offered. `filters` is set only when the panel shows its own filters. */
  onExport:(includePrices:boolean,company?:Company,filters?:DieselExportFilter)=>Promise<void>;
  setup?:FuelSetup;batches?:BatchDetail[];initial?:Partial<DieselPdfFilterState>}){
  const[prices,setPrices]=useState<'without'|'with'>('without'),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const[filters,setFilters]=useState<DieselPdfFilterState>({...emptyDieselPdfFilters,...initial});
  const initialKey=JSON.stringify(initial??{});
  useEffect(()=>{setFilters({...emptyDieselPdfFilters,...(initial??{})});},[initialKey]);// eslint-disable-line react-hooks/exhaustive-deps
  const set=<K extends keyof DieselPdfFilterState>(key:K,value:DieselPdfFilterState[K])=>setFilters(current=>({...current,[key]:value}));
  const {picker,resolve}=useExportHeader(filters.projectId||projectId);
  const names=useMemo(()=>({
    suppliers:Object.fromEntries((setup?.suppliers??[]).map(item=>[item.id,item.name])),projects:Object.fromEntries((setup?.projects??[]).map(item=>[item.id,item.name])),
    sites:Object.fromEntries((setup?.companySites??[]).map(item=>[item.id,item.name])),stations:Object.fromEntries((setup?.fuelStations??[]).map(item=>[item.id,item.name])),
    batches:Object.fromEntries((batches??[]).map(item=>[item.id,item.batchNumber])),
  }),[batches,setup]);
  const run=async()=>{setBusy(true);setError(null);try{const chosen=await resolve();await onExport(prices==='with',chosen?{name:chosen.list.companyName,logoUri:chosen.list.logoUri,contactLine:chosen.list.contactLine}:undefined,setup?dieselFilterFromState(filters):undefined);}catch(cause){setError(cause instanceof Error?cause.message:'The PDF could not be created.');}finally{setBusy(false);}};
  return <View style={styles.panel}>
    <Text style={styles.scope}>{scope}</Text>
    {setup?<>
      <SearchableSelect label="Supplier" options={setup.suppliers.map(item=>({id:item.id,label:item.name,detail:item.detail}))} selectedId={filters.supplierId} onSelect={value=>set('supplierId',value)} placeholder="All suppliers" allowClear/>
      <SearchableSelect label="Batch" options={(batches??[]).map(item=>({id:item.id,label:item.batchNumber,detail:item.supplierName??'No supplier'}))} selectedId={filters.batchId} onSelect={value=>set('batchId',value)} placeholder="All batches" allowClear/>
      <SegmentedChoice label="Batch status" options={[{id:'all',label:'All'},{id:'open',label:'Open'},{id:'closed',label:'Closed'},{id:'cancelled',label:'Cancelled'}]} selectedId={filters.status} onSelect={value=>set('status',value)} mode="tabs"/>
      <SearchableSelect label="Project" options={setup.projects.map(item=>({id:item.id,label:item.name,detail:item.detail}))} selectedId={filters.projectId} onSelect={value=>set('projectId',value)} placeholder="All projects" allowClear/>
      <SearchableSelect label="Company site" options={setup.companySites.map(item=>({id:item.id,label:item.name,detail:item.isActive?undefined:'Inactive'}))} selectedId={filters.companySiteId} onSelect={value=>set('companySiteId',value)} placeholder="All company sites" allowClear/>
      <SearchableSelect label="Station" options={setup.fuelStations.map(item=>({id:item.id,label:item.name,detail:item.isActive?item.location??undefined:'Inactive'}))} selectedId={filters.stationId} onSelect={value=>set('stationId',value)} placeholder="All stations" allowClear/>
      <SegmentedChoice label="Source" options={[{id:'all',label:'All'},{id:'tank',label:'From tank'},{id:'station',label:'Stations'}]} selectedId={filters.source} onSelect={value=>set('source',value)} mode="tabs"/>
      <View style={styles.pair}><View style={styles.flex}><DatePickerField label="From date" value={filters.fromDate} onChange={value=>set('fromDate',value)} maxDate={filters.toDate||todayIso()} allowClear/></View><View style={styles.flex}><DatePickerField label="To date" value={filters.toDate} onChange={value=>set('toDate',value)} minDate={filters.fromDate||undefined} maxDate={todayIso()} allowClear/></View></View>
    </>:null}
    <SegmentedChoice label="Prices in the PDF" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]} selectedId={prices} onSelect={setPrices}/>
    {picker}
    {setup?<View style={styles.summary}><Text style={styles.summaryText}>Will export: {dieselFilterSummary(filters,names,prices==='with')}.</Text><Text style={styles.summaryNote}>These filters apply only to this export; the screen's own filters are not changed.</Text></View>:null}
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppButton label={label} tone="secondary" busy={busy} onPress={()=>void run()}/>
  </View>;
}

const styles=StyleSheet.create({
  panel:{gap:10,padding:14,borderRadius:radius.lg,borderWidth:1,borderColor:'#E8DED0',backgroundColor:colors.surface},
  scope:{color:colors.muted,fontSize:12,lineHeight:17},
  pair:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
  summary:{backgroundColor:'#EEF2F7',borderWidth:1,borderColor:'#C7D3E2',borderRadius:12,padding:10,gap:4},
  summaryText:{color:colors.ink,fontSize:13,fontWeight:'700',lineHeight:18},
  summaryNote:{color:colors.muted,fontSize:12,lineHeight:17},
});
