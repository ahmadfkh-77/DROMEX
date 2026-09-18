import {useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {Foundation,FoundationStatusChange} from '../../domain/foundations';
import {baseStatusLabels,curingDays} from '../../domain/wallBase';
import {colors} from '../theme';
import {AppButton,AppField} from './AppPrimitives';
import {DatePickerField} from './DatePickerField';

const today=()=>new Date().toISOString().slice(0,10);

/**
 * DEC-464. Checkpoint 4's Curing stage: construction date, curing start, elapsed days, and the
 * cured confirmation. This never gates the Wall/Layers/History stages (DEC-463) -- it only ever
 * moves the foundation's own tracked lifecycle forward.
 */
export function FoundationCuringPanel({foundation,busy,onChangeStatus}:{
  foundation:Foundation;busy:boolean;onChangeStatus:(change:FoundationStatusChange)=>Promise<void>;
}){
  const[dates,setDates]=useState({constructedOn:today(),curingStartedOn:today(),curedOn:today()});
  const[inspected,setInspected]=useState(false);
  const[curingNote,setCuringNote]=useState('');
  const[error,setError]=useState<string|null>(null);
  const elapsed=curingDays(foundation,today());

  async function run(action:()=>Promise<void>){setError(null);try{await action();}catch(cause){setError(cause instanceof Error?cause.message:'The status could not be saved.');}}

  return <View style={styles.card}>
    <Text style={styles.summaryLine}>Status {baseStatusLabels[foundation.status]}{foundation.constructedOn?` · constructed ${foundation.constructedOn}`:''}{foundation.curingStartedOn?` · curing from ${foundation.curingStartedOn}`:''}{foundation.curedOn?` · cured ${foundation.curedOn}`:''}</Text>
    {elapsed!=null?<Text style={styles.summaryLine}>{elapsed} curing day{elapsed===1?'':'s'} so far</Text>:null}
    {foundation.status==='planned'?<>
      <DatePickerField label="Construction / pour date *" value={dates.constructedOn} onChange={constructedOn=>setDates({...dates,constructedOn})}/>
      <AppButton label="Mark Foundation Constructed" tone="navy" busy={busy} onPress={()=>void run(()=>onChangeStatus({status:'constructed',constructedOn:dates.constructedOn}))}/>
    </>:null}
    {foundation.status==='constructed'?<>
      <DatePickerField label="Curing start date *" value={dates.curingStartedOn} onChange={curingStartedOn=>setDates({...dates,curingStartedOn})}/>
      <AppButton label="Start Curing" tone="navy" busy={busy} onPress={()=>void run(()=>onChangeStatus({status:'curing',curingStartedOn:dates.curingStartedOn}))}/>
    </>:null}
    {foundation.status==='curing'?<>
      <DatePickerField label="Cured confirmation date *" value={dates.curedOn} onChange={curedOn=>setDates({...dates,curedOn})}/>
      <AppField label="Curing note" value={curingNote} onChangeText={setCuringNote} placeholder="Optional"/>
      <TouchableOpacity style={styles.checkRow} onPress={()=>setInspected(!inspected)} accessibilityRole="checkbox" accessibilityState={{checked:inspected}}>
        <View style={[styles.check,inspected&&styles.checkOn]}>{inspected?<Text style={styles.checkMark}>✓</Text>:null}</View>
        <Text style={styles.checkLabel}>The foundation has been inspected and is ready</Text>
      </TouchableOpacity>
      <AppButton label="Confirm Foundation Is Cured" tone="navy" busy={busy} disabled={!inspected} onPress={()=>void run(()=>onChangeStatus({status:'cured',curedOn:dates.curedOn,inspected,curingNote}))} hint="Wall work is already available regardless -- this only records curing"/>
    </>:null}
    {foundation.status==='cured'?<Text style={styles.ready}>Foundation confirmed cured on {foundation.curedOn}.</Text>:null}
    {error?<Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  card:{gap:10},
  summaryLine:{color:colors.muted,fontSize:12,lineHeight:17},
  ready:{color:colors.success,fontSize:12,fontWeight:'800',lineHeight:17},
  checkRow:{minHeight:44,flexDirection:'row',alignItems:'center',gap:9},
  check:{width:22,height:22,borderRadius:6,borderWidth:2,borderColor:colors.muted,alignItems:'center',justifyContent:'center'},
  checkOn:{borderColor:colors.navy,backgroundColor:colors.navy},
  checkMark:{color:'#FFFFFF',fontSize:13,fontWeight:'900'},
  checkLabel:{flex:1,color:colors.ink,fontSize:12,fontWeight:'700',lineHeight:17},
  error:{color:colors.danger,fontSize:12,fontWeight:'800',lineHeight:17},
});
