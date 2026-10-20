import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {colors} from '../theme';

/** A short fixed choice shown as one switch, the same as Delivered to on New Supplier Load. Every option is visible and one tap changes it. */
export function OpenSwitch<T extends string>({label,options,selectedId,onSelect}:{label?:string;options:{id:T;label:string}[];selectedId:T;onSelect:(id:T)=>void}){
  return <View style={styles.field}>
    {label?<Text style={styles.label}>{label}</Text>:null}
    <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={label}>{options.map(option=>{const checked=option.id===selectedId;return <TouchableOpacity key={option.id} style={[styles.option,checked&&styles.optionOn]} onPress={()=>onSelect(option.id)} activeOpacity={.75} accessibilityRole="radio" accessibilityState={{checked}} accessibilityLabel={option.label}><Text style={[styles.text,checked&&styles.textOn]} numberOfLines={2}>{option.label}</Text></TouchableOpacity>;})}</View>
  </View>;
}

const styles=StyleSheet.create({
  field:{gap:6},
  label:{color:'#3C4854',fontSize:12,fontWeight:'700'},
  track:{flexDirection:'row',backgroundColor:'#E8E3D8',borderRadius:12,padding:3,gap:3},
  option:{flex:1,minHeight:44,borderRadius:9,alignItems:'center',justifyContent:'center',paddingHorizontal:4},
  optionOn:{backgroundColor:colors.navy},
  text:{color:colors.muted,fontSize:12,fontWeight:'800',textAlign:'center'},
  textOn:{color:'#FFF'},
});
