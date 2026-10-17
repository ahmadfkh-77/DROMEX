import {useMemo,useState} from 'react';
import {View} from 'react-native';

import type {StockRepository} from '../../data/repositories/StockRepository';
import type {StockOverview} from '../../domain/stock';
import {buildStockReport,stockRangeFor,stockRangeLabel,type StockPeriod} from '../../domain/stockReport';
import {exportAndShareStockReport} from '../../services/documentExport';
import {exportAndShareStockWorkbook} from '../../services/stockWorkbookExport';
import {AppButton,AppCard,Feedback} from './AppPrimitives';
import {DatePickerField,todayIso} from './DatePickerField';
import {SearchableSelect} from './SearchableSelect';
import {SegmentedChoice} from './SegmentedChoice';
import {useExportHeader} from './useExportHeader';

/**
 * Export the Stock Report as a PDF or an Excel workbook: all Stock or one item, for all dates, this week, this month or dates chosen on the
 * calendar (the same date field the other screens use), without prices (the default) or with them, under the chosen Header company. On an
 * item's own page the item is fixed. It only reads records.
 */
export function StockExportPanel({repository,overview,itemId}:{repository:StockRepository;overview:StockOverview;/** Fixes the report to this item (the item page). */itemId?:string}){
  const[scope,setScope]=useState<'all'|'one'>(itemId?'one':'all'),[pickedItem,setPickedItem]=useState(itemId??''),[period,setPeriod]=useState<StockPeriod>('all');
  const[fromDate,setFromDate]=useState(''),[toDate,setToDate]=useState(''),[prices,setPrices]=useState<'without'|'with'>('without');
  const[busy,setBusy]=useState<null|'pdf'|'excel'>(null),[error,setError]=useState<string|null>(null),[done,setDone]=useState<string|null>(null);
  const{picker,resolve}=useExportHeader(null);
  const chosenItem=itemId??(scope==='one'?pickedItem:'');
  const range=useMemo(()=>stockRangeFor(period,todayIso(),{fromDate,toDate}),[period,fromDate,toDate]);
  const filter=useMemo(()=>({itemId:chosenItem||undefined,fromDate:range.fromDate,toDate:range.toDate,includePrices:prices==='with'}),[chosenItem,range,prices]);
  const run=async(kind:'pdf'|'excel')=>{
    setBusy(kind);setError(null);setDone(null);
    try{
      if(scope==='one'&&!chosenItem)throw new Error('Choose an item first.');
      const[chosen,identity]=await Promise.all([resolve(),repository.getCompanyIdentity()]);
      const company=chosen?{name:chosen.list.companyName,logoUri:chosen.list.logoUri,contactLine:chosen.list.contactLine}:identity;
      if(kind==='pdf'){await exportAndShareStockReport(buildStockReport(overview,filter),company);setDone('Stock Report ready to share.');}
      else{await exportAndShareStockWorkbook(overview,filter,{name:company.name});setDone('Stock workbook ready to share.');}
    }catch(cause){setError(cause instanceof Error?cause.message:'The export could not be created.');}
    finally{setBusy(null);}
  };
  return <AppCard title="Export" hint={itemId?'A report of this item: batches, uses and what is left.':'One page per item and a summary of everything. Each unit stays on its own line.'}>
    {itemId?null:<SegmentedChoice label="What" options={[{id:'all',label:'All items'},{id:'one',label:'One item'}]} selectedId={scope} onSelect={setScope}/>}
    {!itemId&&scope==='one'?<SearchableSelect label="Item" options={overview.items.map(item=>({id:item.itemId,label:item.itemName,detail:item.unitSymbol}))} selectedId={pickedItem} onSelect={setPickedItem} placeholder="Choose an item"/>:null}
    <SegmentedChoice label="Period" options={[{id:'all',label:'All dates'},{id:'week',label:'This week'},{id:'month',label:'This month'},{id:'custom',label:'Custom'}]} selectedId={period} onSelect={setPeriod} mode="tabs"/>
    {period==='custom'?<View style={{gap:10}}><DatePickerField label="From" value={fromDate} onChange={setFromDate} maxDate={toDate||todayIso()} allowClear placeholder="Any date"/><DatePickerField label="To" value={toDate} onChange={setToDate} maxDate={todayIso()} allowClear placeholder="Any date"/></View>:null}
    <SegmentedChoice label="Prices in the export" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]} selectedId={prices} onSelect={setPrices}/>
    {picker}
    <Feedback kind="warning">{stockRangeLabel(range)} · {prices==='with'?'with prices':'without prices'}</Feedback>
    {error?<Feedback kind="error">{error}</Feedback>:null}{done?<Feedback kind="success">{done}</Feedback>:null}
    <AppButton label="Export PDF" tone="secondary" busy={busy==='pdf'} disabled={busy!==null} onPress={()=>void run('pdf')}/>
    <AppButton label="Export Excel" tone="secondary" busy={busy==='excel'} disabled={busy!==null} onPress={()=>void run('excel')}/>
  </AppCard>;
}
