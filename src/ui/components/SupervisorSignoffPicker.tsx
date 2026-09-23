import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {
  addSupervisorSignoff,moveSupervisorSignoff,removeSupervisorSignoff,setSupervisorSignoffDisplay,
  type SignoffDisplay,type Supervisor,type SupervisorSignoffSnapshot,
} from '../../domain/supervisors';
import {colors} from '../theme';
import {SearchableSelect} from './SearchableSelect';
import {SegmentedChoice} from './SegmentedChoice';

const hasUsableSignature=(supervisor:Supervisor|undefined)=>!!supervisor&&supervisor.signature.length>0&&!supervisor.signatureDamaged;

/**
 * DEC-479. Chooses who signs off one Daily Report, in order, and whether each signs by name only or
 * with their saved signature. Every change goes through domain/supervisors.ts, which copies the chosen
 * signature into the report; an archived supervisor already on the report stays exactly as recorded.
 */
export function SupervisorSignoffPicker({supervisors,value,onChange}:{supervisors:Supervisor[];value:SupervisorSignoffSnapshot[];onChange:(next:SupervisorSignoffSnapshot[])=>void}){
  const available=supervisors.filter(supervisor=>!value.some(signoff=>signoff.supervisorId===supervisor.id));
  return <View style={styles.list}>
    {value.length?value.map((signoff,index)=>{
      const profile=supervisors.find(supervisor=>supervisor.id===signoff.supervisorId);
      const canSign=hasUsableSignature(profile);
      return <View key={signoff.supervisorId} style={styles.item}>
        <View style={styles.itemTop}>
          <Text style={styles.order}>{index+1}</Text>
          <View style={styles.flex}>
            <Text style={styles.name}>{signoff.name}</Text>
            {signoff.jobTitle?<Text style={styles.helper}>{signoff.jobTitle}</Text>:null}
          </View>
        </View>
        {profile&&canSign
          ?<SegmentedChoice<SignoffDisplay> label="Sign-off" options={[{id:'name_only',label:'Name only'},{id:'name_with_signature',label:'Name + saved signature'}]} selectedId={signoff.display}
            onSelect={display=>onChange(setSupervisorSignoffDisplay(value,signoff.supervisorId,display,supervisors))}/>
          :<Text style={styles.helper}>{!profile?`Kept as recorded: ${signoff.display==='name_with_signature'?'name with signature':'name only'}. This supervisor is archived.`:'No saved signature — signs off by name only.'}</Text>}
        <View style={styles.actions}>
          {index>0?<Quiet label="↑ Up" onPress={()=>onChange(moveSupervisorSignoff(value,signoff.supervisorId,-1))} accessibilityLabel={`Move ${signoff.name} up`}/>:null}
          {index<value.length-1?<Quiet label="↓ Down" onPress={()=>onChange(moveSupervisorSignoff(value,signoff.supervisorId,1))} accessibilityLabel={`Move ${signoff.name} down`}/>:null}
          <Quiet label="Remove" danger onPress={()=>onChange(removeSupervisorSignoff(value,signoff.supervisorId))} accessibilityLabel={`Remove ${signoff.name} from this sign-off`}/>
        </View>
      </View>;
    }):<Text style={styles.helper}>No supervisor sign-off on this report. It is optional.</Text>}
    {available.length?<SearchableSelect label="Add supervisor" selectedId="" placeholder="Choose a saved supervisor"
      options={available.map(supervisor=>({id:supervisor.id,label:supervisor.name,detail:[supervisor.jobTitle,hasUsableSignature(supervisor)?'Saved signature':'Name only'].filter(Boolean).join(' · ')}))}
      onSelect={id=>{const supervisor=available.find(candidate=>candidate.id===id);if(supervisor)onChange(addSupervisorSignoff(value,supervisor,hasUsableSignature(supervisor)?'name_with_signature':'name_only'));}}/>
      :!supervisors.length?<Text style={styles.helper}>Save supervisors in PDF Settings → Supervisors to add a sign-off.</Text>:null}
  </View>;
}

function Quiet({label,onPress,accessibilityLabel,danger=false}:{label:string;onPress:()=>void;accessibilityLabel:string;danger?:boolean}){
  return <TouchableOpacity style={styles.quiet} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}><Text style={[styles.quietText,danger&&styles.danger]}>{label}</Text></TouchableOpacity>;
}

const styles=StyleSheet.create({
  list:{gap:12},flex:{flex:1,minWidth:0},
  helper:{color:colors.muted,fontSize:12,lineHeight:18},
  item:{gap:8,padding:12,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface},
  itemTop:{flexDirection:'row',alignItems:'center',gap:10},
  order:{minWidth:26,height:26,borderRadius:13,borderWidth:1,borderColor:colors.navy,color:colors.navy,textAlign:'center',lineHeight:24,fontSize:12,fontWeight:'900'},
  name:{color:colors.ink,fontSize:15,fontWeight:'900'},
  actions:{flexDirection:'row',flexWrap:'wrap',columnGap:14},
  quiet:{minHeight:44,justifyContent:'center'},quietText:{color:colors.brandDark,fontSize:13,fontWeight:'900'},danger:{color:colors.danger},
});
