import {useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import {colors,radius} from '../../theme';
import {AppButton,Feedback} from '../AppPrimitives';
import {SegmentedChoice} from '../SegmentedChoice';
import {useExportHeader} from '../useExportHeader';

/**
 * DEC-505, Screen F. Export the Diesel Batch Report for what is on screen. Without prices is the default
 * (DEC-373); with prices adds only recorded prices, and missing ones print as Unpriced, never $0.
 */
export function DieselPdfExportPanel({label,scope,projectId,onExport}:{label:string;scope:string;
  /** Phase 5. Set when the export is for one project, so the Header company can be remembered for it. */
  projectId?:string|null;
  /** `company` is the chosen Header company's name, logo and contact line; absent when no picker is offered. */
  onExport:(includePrices:boolean,company?:{name:string;logoUri:string|null;contactLine:string|null})=>Promise<void>}){
  const[prices,setPrices]=useState<'without'|'with'>('without'),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const {picker,resolve}=useExportHeader(projectId);
  const run=async()=>{setBusy(true);setError(null);try{const chosen=await resolve();await onExport(prices==='with',chosen?{name:chosen.list.companyName,logoUri:chosen.list.logoUri,contactLine:chosen.list.contactLine}:undefined);}catch(cause){setError(cause instanceof Error?cause.message:'The PDF could not be created.');}finally{setBusy(false);}};
  return <View style={styles.panel}>
    <Text style={styles.scope}>{scope}</Text>
    <SegmentedChoice label="Prices in the PDF" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]} selectedId={prices} onSelect={setPrices}/>
    {picker}
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppButton label={label} tone="secondary" busy={busy} onPress={()=>void run()}/>
  </View>;
}

const styles=StyleSheet.create({
  panel:{gap:10,padding:14,borderRadius:radius.lg,borderWidth:1,borderColor:'#E8DED0',backgroundColor:colors.surface},
  scope:{color:colors.muted,fontSize:12,lineHeight:17},
});
