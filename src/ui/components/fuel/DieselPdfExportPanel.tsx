import {useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import {colors,radius} from '../../theme';
import {AppButton,Feedback} from '../AppPrimitives';
import {SegmentedChoice} from '../SegmentedChoice';

/**
 * DEC-505, Screen F. Export the Diesel Batch Report for what is on screen. Without prices is the default
 * (DEC-373); with prices adds only recorded prices, and missing ones print as Unpriced, never $0.
 */
export function DieselPdfExportPanel({label,scope,onExport}:{label:string;scope:string;onExport:(includePrices:boolean)=>Promise<void>}){
  const[prices,setPrices]=useState<'without'|'with'>('without'),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const run=async()=>{setBusy(true);setError(null);try{await onExport(prices==='with');}catch(cause){setError(cause instanceof Error?cause.message:'The PDF could not be created.');}finally{setBusy(false);}};
  return <View style={styles.panel}>
    <Text style={styles.scope}>{scope}</Text>
    <SegmentedChoice label="Prices in the PDF" options={[{id:'without',label:'Without prices'},{id:'with',label:'With prices'}]} selectedId={prices} onSelect={setPrices}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppButton label={label} tone="secondary" busy={busy} onPress={()=>void run()}/>
  </View>;
}

const styles=StyleSheet.create({
  panel:{gap:10,padding:14,borderRadius:radius.lg,borderWidth:1,borderColor:'#E8DED0',backgroundColor:colors.surface},
  scope:{color:colors.muted,fontSize:12,lineHeight:17},
});
