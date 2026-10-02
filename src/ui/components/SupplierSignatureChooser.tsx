import {useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';

import type {DocumentSigner,SignerDisplay} from '../../domain/documentSigners';
import {AppButton} from './AppPrimitives';
import {SearchableSelect} from './SearchableSelect';
import {SegmentedChoice} from './SegmentedChoice';
import {colors} from '../theme';

export type SupplierSignatureSelection={signerId:string;display:SignerDisplay};

/**
 * DEC-490. Picks the saved signer whose signature goes under the driver's on the Delivery
 * Authorization. Used for the default in Signers and for one load in Load History. Only active signers
 * are offered; a signer without a drawn signature can sign by name only.
 */
export function SupplierSignatureChooser({title,helper,signers,value,busy,saveLabel,removeLabel,onSave}:{title:string;helper:string;signers:DocumentSigner[];value:SupplierSignatureSelection|null;busy:boolean;saveLabel:string;removeLabel:string;onSave:(selection:SupplierSignatureSelection|null)=>void}){
  const active=signers.filter(signer=>signer.isActive);
  const[signerId,setSignerId]=useState(value?.signerId??'');
  const[display,setDisplay]=useState<SignerDisplay>(value?.display??'name_with_signature');
  useEffect(()=>{setSignerId(value?.signerId??'');setDisplay(value?.display??'name_with_signature');},[value?.signerId,value?.display]);
  const chosen=active.find(signer=>signer.id===signerId)??null;
  const drawn=!!chosen?.signature.length;
  const effective:SignerDisplay=drawn?display:'name_only';
  const unchanged=!!value&&value.signerId===signerId&&value.display===effective;
  return <View style={styles.card}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.helper}>{helper}</Text>
    {active.length?<>
      <SearchableSelect label="Signer" options={active.map(signer=>({id:signer.id,label:signer.name,detail:[signer.jobTitle,signer.department].filter(Boolean).join(' · ')||undefined}))} selectedId={signerId} onSelect={setSignerId} placeholder="Choose a saved signer"/>
      {chosen?<SegmentedChoice label="Show on the authorization" options={[{id:'name_with_signature',label:'Name and signature'},{id:'name_only',label:'Name only'}]} selectedId={effective} onSelect={id=>{if(id==='name_only'||drawn)setDisplay(id);}}
        hint={drawn?undefined:`${chosen.name} has no saved signature yet, so only the name is printed. Draw it in Authorized signers to add it.`}/>:null}
      {chosen&&effective==='name_with_signature'?<View style={styles.preview} accessibilityLabel={`Saved signature of ${chosen.name}`}><Svg width="100%" height="100%" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet">{chosen.signature.map((path,index)=><Path key={`${index}-${path.length}`} d={path} fill="none" stroke="#111" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}</Svg></View>:null}
      <AppButton label={saveLabel} busy={busy} disabled={busy||!chosen||unchanged} onPress={()=>{if(chosen)onSave({signerId:chosen.id,display:effective});}}/>
    </>:<Text style={styles.helper}>No active signer yet. Add one in Document settings › Authorized signers.</Text>}
    {value?<AppButton label={removeLabel} tone="secondary" disabled={busy} onPress={()=>onSave(null)}/>:null}
  </View>;
}

const styles=StyleSheet.create({
  card:{backgroundColor:colors.surface,borderRadius:15,borderWidth:1,borderColor:'#D9CFBE',padding:16,gap:12},
  title:{color:colors.ink,fontSize:17,fontWeight:'900'},
  helper:{color:'#4F5B66',fontSize:13,lineHeight:19},
  preview:{height:84,borderRadius:10,borderWidth:1,borderColor:colors.line,backgroundColor:'#FFF'},
});
