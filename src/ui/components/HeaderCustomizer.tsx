import {useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {HeaderCustomization} from '../../domain/companyHeaders';
import {colors} from '../theme';
import {AppField} from './AppPrimitives';

/**
 * DEC-506. Lets the person decide, for this one PDF, what the header prints: the logo, the name, and which contact
 * details. It never changes the saved company; "Customize header" is closed until opened.
 */
export function HeaderCustomizer({value,onChange}:{value:HeaderCustomization;onChange:(next:HeaderCustomization)=>void}){
  const[open,setOpen]=useState(false);
  const toggle=(key:'showLogo'|'address'|'phone'|'email'|'taxVatNumber')=>onChange({...value,[key]:!value[key]});
  const changed=!value.showLogo||value.name.trim()!==''||!value.address||!value.phone||!value.email||!value.taxVatNumber;
  const chip=(key:'showLogo'|'address'|'phone'|'email'|'taxVatNumber',label:string)=><TouchableOpacity key={key} style={[styles.chip,value[key]&&styles.chipOn]} onPress={()=>toggle(key)} accessibilityRole="checkbox" accessibilityState={{checked:value[key]}} accessibilityLabel={label}>
    <Text style={[styles.chipText,value[key]&&styles.chipTextOn]}>{value[key]?'☑':'☐'} {label}</Text></TouchableOpacity>;
  return <View style={styles.card}>
    <TouchableOpacity style={styles.row} onPress={()=>setOpen(current=>!current)} accessibilityRole="button" accessibilityState={{expanded:open}}>
      <View style={styles.flex}><Text style={styles.title}>Customize header</Text><Text style={styles.helper}>{changed?'Changed for this PDF only':'Logo, name and details of the header company'}</Text></View>
      <Text style={styles.mark}>{open?'−':'+'}</Text>
    </TouchableOpacity>
    {open?<View style={styles.body}>
      <AppField label="Name on the PDF" value={value.name} onChangeText={name=>onChange({...value,name})} placeholder="Use the company name"/>
      <View style={styles.chips}>{chip('showLogo','Logo')}{chip('address','Address')}{chip('phone','Phone')}{chip('email','Email')}{chip('taxVatNumber','Tax / VAT no.')}</View>
      <Text style={styles.helper}>Only this PDF changes. The saved company, its logo and its details stay as they are.</Text>
    </View>:null}
  </View>;
}

const styles=StyleSheet.create({
  card:{borderWidth:1,borderColor:'#E8DED0',borderRadius:14,backgroundColor:colors.cream,padding:12,gap:8},
  row:{flexDirection:'row',alignItems:'center',gap:10,minHeight:44},
  flex:{flex:1,minWidth:0},
  title:{color:colors.ink,fontSize:14,fontWeight:'800'},
  helper:{color:colors.muted,fontSize:12,lineHeight:17},
  mark:{color:colors.navy,fontSize:22,fontWeight:'800',width:28,textAlign:'center'},
  body:{gap:10},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:8},
  chip:{minHeight:40,paddingHorizontal:12,borderRadius:999,borderWidth:1,borderColor:colors.navy,backgroundColor:colors.surface,justifyContent:'center'},
  chipOn:{backgroundColor:'#EAF1F6'},
  chipText:{color:colors.navy,fontSize:12,fontWeight:'700'},
  chipTextOn:{color:colors.navy},
});
