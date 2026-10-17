import {useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import {closureText,type BatchClosure} from '../../domain/batchClosure';
import {localDateKey} from '../../domain/fuel';
import {AppButton,AppCard,AppField,Feedback} from './AppPrimitives';
import {DatePickerField} from './DatePickerField';
import {colors} from '../theme';

/**
 * Close a batch by hand, the same on Bitumen, Diesel and Stock. The card shows what is left, asks for the day (from the calendar) and a
 * reason, and says which batch takes over. A closed batch shows what was left over and why, and can be reopened with a reason; every close
 * and reopen stays in its history.
 */
export function CloseBatchCard({batchLabel,leftoverText,nextText,busy,onConfirm,onClose}:{batchLabel:string;leftoverText:string;nextText:string;busy:boolean;onConfirm:(closedOn:string,reason:string)=>void;onClose:()=>void}){
  const [closedOn,setClosedOn]=useState(localDateKey(new Date())),[reason,setReason]=useState('');
  return <AppCard title={`Close ${batchLabel}?`} hint="It will show Closed and nothing more is taken from it. What is left stays on record with your reason.">
    <Feedback kind="warning">{leftoverText}</Feedback>
    <DatePickerField label="Date closed *" value={closedOn} onChange={setClosedOn} maxDate={localDateKey(new Date())}/>
    <AppField label="Reason *" value={reason} onChangeText={setReason} multiline placeholder="For example: tank changed, new delivery started"/>
    <Text style={styles.note}>{nextText}</Text>
    <AppButton label="Close batch" busy={busy} disabled={!reason.trim()||!closedOn} onPress={()=>onConfirm(closedOn,reason)}/>
    <AppButton label="Cancel" tone="secondary" onPress={onClose}/>
  </AppCard>;
}

export function ReopenBatchCard({batchLabel,busy,onConfirm,onClose}:{batchLabel:string;busy:boolean;onConfirm:(reason:string)=>void;onClose:()=>void}){
  const [reason,setReason]=useState('');
  return <AppCard title={`Reopen ${batchLabel}?`} hint="The batch becomes open again. What was counted while it was closed stays where it is, and the closing stays in its history.">
    <AppField label="Reason *" value={reason} onChangeText={setReason} multiline placeholder="For example: closed the wrong batch"/>
    <AppButton label="Reopen batch" busy={busy} disabled={!reason.trim()} onPress={()=>onConfirm(reason)}/>
    <AppButton label="Cancel" tone="secondary" onPress={onClose}/>
  </AppCard>;
}

/** The record of closing a batch by hand: what was left over, the day and the reason, then every earlier close and reopen. */
export function ClosureCard({closure,history,format,busy,onReopen}:{closure:BatchClosure|null;history:readonly BatchClosure[];format:(value:number)=>string;busy?:boolean;onReopen?:()=>void}){
  const earlier=history.filter(value=>value.reopenedAt);
  if(!closure&&!earlier.length)return null;
  return <AppCard title={closure?'Closed by hand':'Closing history'} hint={closure?undefined:'This batch was closed by hand and reopened.'}>
    {closure?<Text style={styles.body}>{closureText(closure,format)}</Text>:null}
    {earlier.map(value=><View key={value.id} style={styles.history}>
      <Text style={styles.sub}>{closureText(value,format)}</Text>
      <Text style={styles.sub}>Reopened {new Date(value.reopenedAt!).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})} · {value.reopenReason}</Text>
    </View>)}
    {closure&&onReopen?<AppButton label="Reopen this batch" tone="secondary" busy={busy} onPress={onReopen}/>:null}
  </AppCard>;
}

const styles=StyleSheet.create({
  body:{color:colors.ink,fontSize:14,lineHeight:20},
  sub:{color:colors.muted,fontSize:12,lineHeight:17},
  note:{color:colors.navy,fontSize:12,lineHeight:17,backgroundColor:'#EEF2F7',borderRadius:12,padding:10},
  history:{gap:2,paddingVertical:8,borderTopWidth:1,borderTopColor:colors.line},
});
