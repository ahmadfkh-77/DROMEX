import {useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {BatchDetail} from '../../domain/fuelBatches';
import type {QuarryPurchase} from '../../domain/quarry';
import {buildSupplierDeliveriesPdf,supplierPdfChoices,type SupplierDeliveriesPdf} from '../../domain/supplierDeliveriesPdf';
import {supplierDieselDeliveries} from '../../domain/supplierDiesel';
import {colors} from '../theme';
import {AppButton,Feedback} from './AppPrimitives';
import {DatePickerField,todayIso} from './DatePickerField';
import {SegmentedChoice} from './SegmentedChoice';
import {useExportHeader} from './useExportHeader';

type Company={name:string;logoUri:string|null;contactLine:string|null};

/**
 * DEC-506. The Export PDF sheet of one supplier on the Supplier Loads page: what I received from this supplier.
 * It chooses prices, which projects and sites, which materials, the dates and the header, then builds the PDF from
 * the records as they are now. Nothing is saved or changed by exporting.
 */
export function SupplierDeliveriesExport({supplier,purchases,batches,defaultCompany,onExport,onClose}:{
  supplier:{id:string;name:string};purchases:QuarryPurchase[];batches:BatchDetail[]|null;
  /** The saved company, used when the app offers no Header company picker. */
  defaultCompany:()=>Promise<Company>;
  onExport:(report:SupplierDeliveriesPdf,company:Company)=>Promise<void>;onClose:()=>void;
}){
  const choices=useMemo(()=>supplierPdfChoices(purchases,supplier.id),[purchases,supplier.id]);
  const dieselCount=useMemo(()=>batches?supplierDieselDeliveries(batches,supplier.id).batchCount:0,[batches,supplier.id]);
  const[prices,setPrices]=useState<'without'|'with'>('without');
  const[destinations,setDestinations]=useState<Set<string>>(()=>new Set(choices.destinations.map(value=>value.key)));
  const[items,setItems]=useState<Set<string>>(()=>new Set(choices.items.map(value=>value.id)));
  const[includeDiesel,setIncludeDiesel]=useState(true);
  const[fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState('');
  const[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const {picker,resolve}=useExportHeader(null);
  const toggle=(set:Set<string>,key:string,apply:(next:Set<string>)=>void)=>{const next=new Set(set);if(next.has(key))next.delete(key);else next.add(key);apply(next);};
  const check=(label:string,detail:string,on:boolean,onPress:()=>void)=><TouchableOpacity key={label+detail} style={[styles.option,on&&styles.optionOn]} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{checked:on}} accessibilityLabel={`${label}. ${detail}`}>
    <Text style={styles.optionTitle}>{on?'☑':'☐'} {label}</Text><Text style={styles.optionDetail}>{detail}</Text></TouchableOpacity>;
  const nothingChosen=!destinations.size||!items.size;
  const run=async()=>{
    setBusy(true);setError(null);
    try{
      const chosen=await resolve();
      const company:Company=chosen?{name:chosen.list.companyName,logoUri:chosen.list.logoUri,contactLine:chosen.list.contactLine}:await defaultCompany();
      // Everything ticked means no filter, so a load added later is never silently left out.
      const everyDestination=destinations.size===choices.destinations.length,everyItem=items.size===choices.items.length;
      const report=buildSupplierDeliveriesPdf({supplierId:supplier.id,supplierName:supplier.name,purchases,batches:batches??undefined,generatedAt:new Date().toISOString(),
        filters:{fromDate:fromDate||undefined,toDate:toDate||undefined,itemIds:everyItem?[]:[...items],destinationKeys:everyDestination?[]:[...destinations],includePrices:prices==='with',includeDiesel:includeDiesel&&dieselCount>0}});
      await onExport(report,company);
    }catch(cause){setError(cause instanceof Error?cause.message:'The PDF could not be created.');}
    finally{setBusy(false);}
  };
  return <View style={styles.panel}>
    <Text style={styles.title}>Export PDF · {supplier.name}</Text>
    <Text style={styles.helper}>Everything received from this supplier, grouped by project or site, every load listed with its number. Nothing is changed by exporting.</Text>
    <SegmentedChoice label="Prices" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]} selectedId={prices} onSelect={setPrices}/>
    <Text style={styles.label}>Projects and sites</Text>
    {choices.destinations.length?choices.destinations.map(destination=>check(destination.type==='company_site'?`${destination.name} (Site)`:destination.type==='unassigned'?'Unassigned deliveries':destination.name,`${destination.count} deliver${destination.count===1?'y':'ies'}`,destinations.has(destination.key),()=>toggle(destinations,destination.key,setDestinations))):<Text style={styles.helper}>No active deliveries yet.</Text>}
    <Text style={styles.label}>Materials</Text>
    {choices.items.map(item=>check(item.name,`${item.quantity} ${item.unitSymbol} · ${item.count} deliver${item.count===1?'y':'ies'}`,items.has(item.id),()=>toggle(items,item.id,setItems)))}
    {dieselCount>0?check('Diesel delivered by this supplier',`${dieselCount} batch${dieselCount===1?'':'es'} · litres only`,includeDiesel,()=>setIncludeDiesel(value=>!value)):null}
    <View style={styles.pair}><View style={styles.flex}><DatePickerField label="From date" value={fromDate} onChange={setFromDate} maxDate={toDate||todayIso()} allowClear/></View><View style={styles.flex}><DatePickerField label="To date" value={toDate} onChange={setToDate} minDate={fromDate||undefined} maxDate={todayIso()} allowClear/></View></View>
    {picker}
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppButton label="Export PDF" tone="primary" busy={busy} disabled={nothingChosen} onPress={()=>void run()}/>
    <AppButton label="Close" tone="secondary" onPress={onClose}/>
  </View>;
}

const styles=StyleSheet.create({
  panel:{gap:10,padding:14,borderRadius:16,borderWidth:1,borderColor:'#E8DED0',backgroundColor:colors.surface},
  title:{color:colors.ink,fontSize:15,fontWeight:'800'},
  helper:{color:colors.muted,fontSize:12,lineHeight:17},
  label:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:.8,textTransform:'uppercase',marginTop:4},
  option:{minHeight:48,borderRadius:12,borderWidth:1.5,borderColor:colors.line,backgroundColor:colors.surface,paddingHorizontal:12,paddingVertical:8,justifyContent:'center'},
  optionOn:{borderColor:colors.navy,backgroundColor:'#EAF1F6'},
  optionTitle:{color:colors.ink,fontSize:14,fontWeight:'800'},
  optionDetail:{color:colors.muted,fontSize:12},
  pair:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
});
