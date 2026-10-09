import {StyleSheet,Text,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';

import type {DocumentSigner,SignerDisplay} from '../../domain/documentSigners';
import {colors} from '../theme';
import {SearchableSelect} from './SearchableSelect';
import {SegmentedChoice} from './SegmentedChoice';

export type HeaderSignerValue={signerId:string|null;display:SignerDisplay|null};

/**
 * Picks the saved signer (Authorized signers) whose name and signature print under a header company.
 * It stores a LINK only: no second signature exists. A signer with no drawn signature can sign by name only.
 */
export function HeaderSignerField({signers,value,onChange,helper}:{signers:DocumentSigner[];value:HeaderSignerValue;onChange:(value:HeaderSignerValue)=>void;helper?:string}){
  const active=signers.filter(signer=>signer.isActive);
  const chosen=active.find(signer=>signer.id===value.signerId)??null;
  const drawn=!!chosen?.signature.length;
  const display:SignerDisplay=drawn&&value.display==='name_with_signature'?'name_with_signature':'name_only';
  const lostSigner=!!value.signerId&&!chosen;
  return <View style={styles.wrap}>
    {helper?<Text style={styles.helper}>{helper}</Text>:null}
    {active.length?<>
      <SearchableSelect label="Signer" options={active.map(signer=>({id:signer.id,label:signer.name,detail:[signer.jobTitle,signer.department].filter(Boolean).join(' · ')||undefined}))}
        selectedId={value.signerId??''} onSelect={id=>{if(!id){onChange({signerId:null,display:null});return;}const next=active.find(signer=>signer.id===id);onChange({signerId:id,display:next?.signature.length?'name_with_signature':'name_only'});}} placeholder="Choose a saved signer" allowClear/>
      {chosen?<SegmentedChoice label="Show on the document" options={[{id:'name_with_signature',label:'Name and signature'},{id:'name_only',label:'Name only'}]} selectedId={display}
        onSelect={id=>{if(id==='name_only'||drawn)onChange({signerId:chosen.id,display:id});}} hint={drawn?undefined:`${chosen.name} has no saved signature yet, so only the name is printed. Draw it in Authorized signers to add it.`}/>:null}
      {chosen&&display==='name_with_signature'?<View style={styles.preview} accessibilityLabel={`Saved signature of ${chosen.name}`}><Svg width="100%" height="100%" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet">{chosen.signature.map((path,index)=><Path key={`${index}-${path.length}`} d={path} fill="none" stroke="#111" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}</Svg></View>:null}
      {lostSigner?<Text style={styles.warning}>The chosen signer is disabled or missing, so no signature prints. Choose another signer or leave this empty.</Text>:null}
    </>:<Text style={styles.helper}>No active signer yet. Add one in Document settings › Authorized signers. The signature area is simply left off until then.</Text>}
    <Text style={styles.helper}>Manage signers in Document settings › Authorized signers.</Text>
  </View>;
}

const styles=StyleSheet.create({
  wrap:{gap:12},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  preview:{height:84,borderRadius:10,borderWidth:1,borderColor:colors.line,backgroundColor:'#FFF'},
  warning:{color:'#6B4A0E',backgroundColor:'#FFF3D8',borderWidth:1,borderColor:'#E3C681',padding:12,borderRadius:12,fontWeight:'700',fontSize:13,lineHeight:19,overflow:'hidden'},
});
