import {useState} from 'react';
import {KeyboardAvoidingView,Modal,Platform,SafeAreaView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {builtInConcretePurposes,normalizePurposeLabel,validateNewPurposeLabel,type ConcretePurpose,type SavedConcretePurpose} from '../../domain/walls';
import {colors,radius} from '../theme';
import {AppButton,AppField} from './AppPrimitives';
import {SearchableSelect} from './SearchableSelect';

export type PurposeSelection={kind:'builtin';id:ConcretePurpose}|{kind:'custom';id:string};

/**
 * DEC-451. One purpose selector: built-in purposes first, then saved ones marked "Saved purpose".
 * "Add new purpose" opens a focused form; the saved purpose is selected as soon as it exists.
 */
export function ConcretePurposeField({label,value,saved,onSelect,onCreate}:{label:string;value:PurposeSelection|null;saved:SavedConcretePurpose[];onSelect:(value:PurposeSelection)=>void;onCreate:(label:string)=>Promise<SavedConcretePurpose>}){
  const[open,setOpen]=useState(false),[name,setName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const options=[...builtInConcretePurposes.map(purpose=>({id:`builtin:${purpose.id}`,label:purpose.label})),...saved.map(purpose=>({id:`custom:${purpose.id}`,label:purpose.label,detail:'Saved purpose'}))];
  const selectedId=value?`${value.kind}:${value.id}`:'';
  const close=()=>{setOpen(false);setName('');setError(null);};
  const preview=normalizePurposeLabel(name);

  async function save(){
    const issue=validateNewPurposeLabel(name,saved)[0];
    if(issue){setError(issue);return;}
    setBusy(true);setError(null);
    try{const created=await onCreate(name);onSelect({kind:'custom',id:created.id});close();}
    catch(cause){setError(cause instanceof Error?cause.message:'The purpose could not be saved.');}
    finally{setBusy(false);}
  }

  return <View style={styles.field}>
    <SearchableSelect label={label} options={options} selectedId={selectedId} placeholder="Choose a purpose" onSelect={id=>{const[kind,...rest]=id.split(':');const purposeId=rest.join(':');onSelect(kind==='custom'?{kind:'custom',id:purposeId}:{kind:'builtin',id:purposeId as ConcretePurpose});}}/>
    <TouchableOpacity style={styles.addLink} onPress={()=>setOpen(true)} accessibilityRole="button" accessibilityHint="Opens a form to save a purpose for future wall records">
      <Text style={styles.addText}>+ Add new purpose</Text>
    </TouchableOpacity>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.modal}>
        <KeyboardAvoidingView style={styles.sheet} behavior={Platform.OS==='ios'?'padding':undefined}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">New concrete / mortar purpose</Text>
            <TouchableOpacity style={styles.close} onPress={close} accessibilityRole="button"><Text style={styles.closeText}>Close</Text></TouchableOpacity>
          </View>
          <Text style={styles.helper}>The purpose is saved for every future wall record and selected for this one. Saved purposes cannot be renamed or removed, so check the spelling.</Text>
          <AppField label="Purpose name *" value={name} onChangeText={text=>{setName(text);setError(null);}} autoFocus autoCapitalize="sentences" maxLength={80} returnKeyType="done" onSubmitEditing={()=>void save()} placeholder="Example: Parapet cap concrete"/>
          {preview&&preview!==name?<Text style={styles.helper}>Will be saved as “{preview}”.</Text>:null}
          {error?<Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>:null}
          <View style={styles.actions}>
            <AppButton label="Save Purpose" tone="navy" busy={busy} disabled={!preview} onPress={()=>void save()}/>
            <AppButton label="Cancel" tone="secondary" onPress={close}/>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </View>;
}

const styles=StyleSheet.create({
  field:{gap:4},
  addLink:{minHeight:44,alignSelf:'flex-start',justifyContent:'center',paddingRight:12},
  addText:{color:colors.navy,fontSize:13,fontWeight:'900'},
  modal:{flex:1,backgroundColor:colors.background},
  sheet:{flex:1,padding:20,gap:14},
  header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  title:{flex:1,color:colors.ink,fontSize:22,fontWeight:'900'},
  close:{minHeight:44,justifyContent:'center',paddingHorizontal:12,backgroundColor:colors.surface,borderRadius:radius.sm},
  closeText:{color:colors.ink,fontWeight:'800'},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  error:{color:colors.danger,fontSize:13,fontWeight:'800',lineHeight:18},
  actions:{gap:10},
});
