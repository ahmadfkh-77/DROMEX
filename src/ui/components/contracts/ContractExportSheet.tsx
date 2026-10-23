import {useState} from 'react';
import {Text} from 'react-native';

import type {ContractQuantitiesRepository,ContractRowView} from '../../../data/repositories/ContractQuantitiesRepository';
import type {ContractProjectSummary} from '../../../domain/contractQuantities';
import {buildContractReport} from '../../../domain/contractReport';
import type {Project} from '../../../domain/loads';
import {exportAndShareContractReport} from '../../../services/contractReportExport';
import {AppButton,Feedback} from '../AppPrimitives';
import {FocusedSheet} from '../FocusedSheet';
import {SegmentedChoice} from '../SegmentedChoice';
import {useExportHeader} from '../useExportHeader';
import {colors} from '../../theme';

/**
 * DEC-522 Phase E (mockup tab 7). The same export options as the other PDFs: the Header company (remembered for the project), Customize
 * header for this PDF only, and Without prices (client-safe, the default) or With prices (internal, with savings). It only reads records.
 */
export function ContractExportSheet({project,contracts,rows,summary,visible,onClose}:{project:Project;contracts:ContractQuantitiesRepository;rows:ContractRowView[];summary:ContractProjectSummary;visible:boolean;onClose:()=>void}){
  const[prices,setPrices]=useState<'without'|'with'>('without');
  const[busy,setBusy]=useState<null|'pdf'|'excel'>(null),[error,setError]=useState<string|null>(null),[done,setDone]=useState<string|null>(null);
  const{picker,resolve}=useExportHeader(project.id);
  const run=async(kind:'pdf'|'excel')=>{
    setBusy(kind);setError(null);setDone(null);
    try{
      const[chosen,identity]=await Promise.all([resolve(),contracts.getCompanyIdentity()]);
      const company=chosen?{name:chosen.list.companyName,logoUri:chosen.list.logoUri,contactLine:chosen.list.contactLine}:identity;
      const report=buildContractReport(rows,summary,{name:project.name,customerName:project.customerName,location:project.location},{includePrices:prices==='with'});
      await exportAndShareContractReport(report,company,kind);
      setDone(kind==='pdf'?'Report PDF ready to share.':'Report workbook ready to share.');
    }catch(cause){setError(cause instanceof Error?cause.message:'The export could not be created.');}
    finally{setBusy(null);}
  };
  return <FocusedSheet visible={visible} eyebrow="EXPORT" title="Export Quantity Targets" onClose={onClose} footer={<AppButton label="Close" tone="secondary" onPress={onClose}/>}>
    <Text style={{color:colors.muted,fontSize:13,lineHeight:19}}>{project.name} · {summary.itemCount} target{summary.itemCount===1?'':'s'} · as of today</Text>
    {picker}
    <SegmentedChoice label="Prices" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]} selectedId={prices} onSelect={setPrices}/>
    <Text style={{color:colors.muted,fontSize:13,lineHeight:19}}>Without prices leaves out target prices, values and savings. Quantities and percentages are the same in both.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}{done?<Feedback kind="success">{done}</Feedback>:null}
    <AppButton label="Export PDF" busy={busy==='pdf'} disabled={busy!==null} onPress={()=>void run('pdf')}/>
    <AppButton label="Export Excel" tone="secondary" busy={busy==='excel'} disabled={busy!==null} onPress={()=>void run('excel')}/>
  </FocusedSheet>;
}
