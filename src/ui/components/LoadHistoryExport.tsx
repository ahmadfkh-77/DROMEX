import {useEffect,useMemo,useRef,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {CompanyHeaderRepository} from '../../data/repositories/CompanyHeaderRepository';
import {listHeaderFrom,type HeaderCompanyKind} from '../../domain/companyHeaders';
import {exportableLoads,loadHistoryFileName,loadHistoryRows,loadHistorySummary,loadHistoryUnitTotals,singleProjectId,type LoadHistoryFilters} from '../../domain/loadHistoryPdf';
import type {ConfirmedLoad} from '../../domain/loads';
import {exportAndShareLoadHistory} from '../../services/documentExport';
import {colors} from '../theme';
import {AppButton,Feedback} from './AppPrimitives';
import {FocusedSheet,SheetActions} from './FocusedSheet';
import {HeaderCompanyPicker} from './HeaderCompanyPicker';

/**
 * Phase 5. "Export PDF" on the Company Loads list: the loads matching the filters on screen as a Load History PDF.
 * It has the shared Header company picker (remembered for the project when the filters name one project). Only
 * Active loads are exported: a cancelled load stays in the app, marked, and is never part of a PDF.
 */
export function LoadHistoryExport({headers,loads,filters,onOpenCompanySetups}:{headers:CompanyHeaderRepository;loads:ConfirmedLoad[];filters:LoadHistoryFilters;onOpenCompanySetups?:()=>void}){
  const[open,setOpen]=useState(false);
  const[kind,setKind]=useState<HeaderCompanyKind>('plant');
  const[remember,setRemember]=useState(false);
  const[busy,setBusy]=useState(false);
  const[message,setMessage]=useState<{kind:'success'|'error';text:string}|null>(null);
  const mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false;},[]);
  const exportable=useMemo(()=>exportableLoads(loads),[loads]);
  const projectId=useMemo(()=>singleProjectId(exportable),[exportable]);
  const onlyCancelled=loads.length>0&&exportable.length===0;
  const summary=useMemo(()=>loadHistorySummary(filters,exportable.length),[filters,exportable.length]);

  function openSheet(){
    setRemember(false);setMessage(null);setKind('plant');setOpen(true);
    if(projectId)headers.getProjectHeaderDefault(projectId).then(stored=>{if(mounted.current)setKind(stored);}).catch(()=>undefined);
  }
  async function exportPdf(){
    setBusy(true);setMessage(null);
    try{
      const header=await headers.resolveHeader(kind);
      if(remember&&projectId)await headers.setProjectHeaderDefault(projectId,header.kind);
      const list=listHeaderFrom(header);
      const generatedAt=new Date().toISOString();
      await exportAndShareLoadHistory({companyName:list.companyName,logoUri:list.logoUri,contactLine:list.contactLine,generatedAt,summary,rows:loadHistoryRows(exportable),totals:loadHistoryUnitTotals(exportable).map(value=>value),fileName:loadHistoryFileName(filters,generatedAt)});
      if(mounted.current){setMessage({kind:'success',text:`Load History PDF ready to share: ${exportable.length} load${exportable.length===1?'':'s'}.`});setOpen(false);}
    }catch(cause){if(mounted.current)setMessage({kind:'error',text:`${cause instanceof Error?cause.message:'The PDF could not be created.'} Nothing was changed.`});}
    finally{if(mounted.current)setBusy(false);}
  }

  return <View style={styles.wrap}>
    <AppButton label={`Export PDF · ${exportable.length} load${exportable.length===1?'':'s'}`} tone="secondary" disabled={!exportable.length} onPress={openSheet}/>
    {onlyCancelled?<Feedback kind="warning">Your filter shows only cancelled loads. PDFs never include cancelled loads, so there is nothing to export. Choose All or Active.</Feedback>:null}
    {message&&!open?<Feedback kind={message.kind}>{message.text}</Feedback>:null}
    <FocusedSheet visible={open} eyebrow="EXPORT PDF" title="Load History" onClose={()=>setOpen(false)}
      footer={<SheetActions primaryLabel="Export PDF" busy={busy} disabled={busy||!exportable.length} onCancel={()=>setOpen(false)} onPrimary={()=>void exportPdf()}/>}>
      <Text style={styles.helper}>Every active load matching your filters, newest first. Cancelled loads are never included. It is a list only, not an invoice or bill.</Text>
      <View style={styles.summary}>
        <Text style={styles.summaryLine}>Period: <Text style={styles.summaryValue}>{summary.period}</Text></Text>
        <Text style={styles.summaryLine}>Customer: <Text style={styles.summaryValue}>{summary.customer}</Text></Text>
        <Text style={styles.summaryLine}>Items: <Text style={styles.summaryValue}>{summary.items}</Text></Text>
        <Text style={styles.summaryLine}>Loads listed: <Text style={styles.summaryValue}>{summary.listed}</Text></Text>
      </View>
      <HeaderCompanyPicker headers={headers} value={kind} onChange={setKind} remember={projectId?{checked:remember,onChange:setRemember}:undefined} onOpenSetups={onOpenCompanySetups?()=>{setOpen(false);onOpenCompanySetups();}:undefined}/>
      {message?.kind==='error'?<Feedback kind="error">{message.text}</Feedback>:null}
    </FocusedSheet>
  </View>;
}

const styles=StyleSheet.create({
  wrap:{gap:10},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  summary:{backgroundColor:colors.creamSoft,borderRadius:12,padding:12,gap:3},
  summaryLine:{color:colors.muted,fontSize:12,fontWeight:'700'},summaryValue:{color:colors.ink,fontWeight:'900'},
});
