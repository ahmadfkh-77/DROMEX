import {useCallback,useEffect,useRef,useState} from 'react';
import {StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';

import type {CompanyHeaderRepository} from '../../data/repositories/CompanyHeaderRepository';
import type {LoadNameStatus,LoadNameUpdateRecord} from '../../domain/loadCompanyName';
import {colors} from '../theme';
import {AppButton,AppCard,Feedback} from './AppPrimitives';
import {FocusedSheet,SheetActions} from './FocusedSheet';

/**
 * Settings › Company setups › Name on my loads. PDFs and Excel always print the current Plant Company name on my own loads;
 * this card is the one explicit, confirmed action that also updates the name (and, by default, the address, phone, email,
 * Tax/VAT number and receipt footer) saved on the loads themselves, cancelled loads included. It shows what will change
 * before anything is written, asks for a backup first, and keeps a history of every update.
 */
export function LoadCompanyNameCard({headers,plantName,onOpenBackup,onChanged}:{headers:CompanyHeaderRepository;plantName:string;onOpenBackup?:()=>void;onChanged?:()=>void}){
  const[includeDetails,setIncludeDetails]=useState(true);
  const[status,setStatus]=useState<LoadNameStatus|null>(null);
  const[history,setHistory]=useState<LoadNameUpdateRecord[]>([]);
  const[open,setOpen]=useState(false);const[note,setNote]=useState('');const[backedUp,setBackedUp]=useState(false);
  const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);
  const mounted=useRef(true);useEffect(()=>()=>{mounted.current=false;},[]);

  const refresh=useCallback(async()=>{
    try{const[next,records]=await Promise.all([headers.getLoadNameStatus(includeDetails),headers.listLoadNameUpdates()]);if(mounted.current){setStatus(next);setHistory(records);}}
    catch{if(mounted.current)setError('The loads could not be read.');}
  },[headers,includeDetails]);
  useEffect(()=>{void refresh();},[refresh,plantName]);

  const needing=status?.needing??0;
  function openSheet(){setNote('');setBackedUp(false);setError(null);setMessage(null);setOpen(true);}
  async function update(){
    setBusy(true);setError(null);
    try{
      const result=await headers.updateLoadCompanyName({includeDetails,note});
      if(!mounted.current)return;
      setOpen(false);setMessage(`${result.updated} load${result.updated===1?'':'s'} now carry ${result.records[0]?.newName??plantName}.`);
      await refresh();onChanged?.();
    }catch(cause){if(mounted.current)setError(`${cause instanceof Error?cause.message:'The update failed.'} Nothing was changed.`);}
    finally{if(mounted.current)setBusy(false);}
  }

  return <AppCard title="03 · Name on my loads" hint="Loads you made before a rename still carry the old company name. PDFs and Excel already print the current name. This updates the name saved on the loads themselves.">
    {!plantName?<Feedback kind="warning">Save the Plant Company name first.</Feedback>:null}
    {message?<Feedback kind="success">{message}</Feedback>:null}
    {status?<>
      <View style={styles.row}><Text style={styles.label}>Current Plant Company</Text><Text style={styles.value}>{status.currentName||'Not set'}</Text></View>
      <View style={styles.row}><Text style={styles.label}>Loads to update</Text><Text style={styles.value}>{needing} of {status.totalLoads}</Text></View>
      {status.groups.map(group=><View key={`${group.detailsOnly}|${group.oldName}`} style={styles.row}><Text style={styles.small}>{group.oldName}{group.detailsOnly?' (details only)':''}</Text><Text style={styles.value}>{group.count}</Text></View>)}
    </>:null}
    <TouchableOpacity style={styles.check} onPress={()=>setIncludeDetails(value=>!value)} accessibilityRole="checkbox" accessibilityState={{checked:includeDetails}}>
      <View style={[styles.box,includeDetails&&styles.boxOn]}/><Text style={styles.checkText}>Also update the address, phone, email, Tax/VAT number and receipt footer</Text>
    </TouchableOpacity>
    <AppButton label={needing?'Update the name on my loads…':'All loads already carry this name'} disabled={!plantName||!needing} onPress={openSheet}/>
    {history.length?<View style={styles.history}>
      <Text style={styles.heading}>History of updates</Text>
      {history.map(record=><View key={record.id} style={styles.historyRow}>
        <Text style={styles.small}>{new Date(record.updatedAt).toLocaleString()}</Text>
        <Text style={styles.value}>{record.detailsOnly?`${record.newName} (details only)`:`${record.oldName} → ${record.newName}`} · {record.loadsCount} load{record.loadsCount===1?'':'s'}</Text>
        {record.note?<Text style={styles.small}>Note: {record.note}</Text>:null}
      </View>)}
    </View>:null}
    <FocusedSheet visible={open} eyebrow="NAME ON MY LOADS" title={`Update the name on ${needing} load${needing===1?'':'s'}?`} onClose={()=>setOpen(false)}
      footer={<SheetActions primaryLabel={`Update ${needing} load${needing===1?'':'s'}`} busy={busy} disabled={!backedUp||!needing} onCancel={()=>setOpen(false)} onPrimary={()=>void update()}/>}>
      <View style={styles.panel}>
        <Text style={styles.label}>From</Text>
        {status?.groups.map(group=><Text key={`${group.detailsOnly}|${group.oldName}`} style={styles.value}>{group.oldName}{group.detailsOnly?' (details only)':''} · {group.count}</Text>)}
        <Text style={[styles.label,styles.gap]}>To</Text><Text style={styles.valueStrong}>{status?.currentName}</Text>
        <Text style={styles.small}>{includeDetails?'The address, phone, email, Tax/VAT number and receipt footer are copied from the Plant Company profile too.':'Only the company name changes. The address and other details stay as saved.'}</Text>
      </View>
      <Text style={styles.small}>Cancelled and archived loads are updated too, so the history reads the same. Customer names, outside supplier names, load numbers, quantities, prices, payments, signatures and dates are not touched.</Text>
      <Text style={styles.label}>Note (optional)</Text>
      <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="e.g. Company renamed to DROMEX S.A.R.L." placeholderTextColor="#89939B" maxLength={300}/>
      <View style={styles.warn}>
        <Text style={styles.warnTitle}>Make a backup first</Text>
        <Text style={styles.small}>This changes saved loads and cannot be undone except by restoring a backup.</Text>
        {onOpenBackup?<TouchableOpacity onPress={()=>{setOpen(false);onOpenBackup();}} accessibilityRole="button"><Text style={styles.link}>Create a backup now</Text></TouchableOpacity>:null}
      </View>
      <TouchableOpacity style={styles.check} onPress={()=>setBackedUp(value=>!value)} accessibilityRole="checkbox" accessibilityState={{checked:backedUp}}>
        <View style={[styles.box,backedUp&&styles.boxOn]}/><Text style={styles.checkText}>I have made a backup</Text>
      </TouchableOpacity>
      {error?<Feedback kind="error">{error}</Feedback>:null}
    </FocusedSheet>
  </AppCard>;
}

const styles=StyleSheet.create({
  row:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:6,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line},
  label:{fontSize:13,fontWeight:'700',color:colors.ink},value:{fontSize:14,fontWeight:'700',color:colors.ink,flexShrink:1,textAlign:'right'},valueStrong:{fontSize:18,fontWeight:'900',color:colors.navy},
  small:{fontSize:12,color:colors.muted,lineHeight:18,flexShrink:1},gap:{marginTop:10},
  check:{flexDirection:'row',alignItems:'flex-start',gap:10,paddingVertical:10,minHeight:48},box:{width:24,height:24,borderRadius:6,borderWidth:2,borderColor:colors.navy,marginTop:1},boxOn:{backgroundColor:colors.navy},checkText:{flex:1,fontSize:14,color:colors.ink,fontWeight:'600'},
  history:{marginTop:12,gap:6},heading:{fontSize:13,fontWeight:'900',color:colors.navy,letterSpacing:.5},historyRow:{paddingVertical:6,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,gap:2},
  panel:{backgroundColor:'#FFFFFF',borderRadius:14,padding:14,gap:4,borderWidth:1,borderColor:colors.line},
  input:{minHeight:48,borderWidth:1.5,borderColor:colors.line,borderRadius:12,backgroundColor:'#FFFFFF',paddingHorizontal:12,fontSize:15,color:colors.ink},
  warn:{backgroundColor:'#FFF4DC',borderColor:'#F1CF83',borderWidth:1,borderRadius:12,padding:12,gap:4},warnTitle:{fontWeight:'800',color:colors.ink},link:{color:colors.navy,fontWeight:'800',textDecorationLine:'underline',paddingVertical:8},
});
