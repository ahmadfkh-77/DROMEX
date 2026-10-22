import {Pressable,StyleSheet,Text,View} from 'react-native';

import type {DriverChoice} from '../../../domain/totalsDrivers';
import {colors} from '../../theme';
import {SegmentedChoice} from '../SegmentedChoice';

export type DriverTotalChoice = 'all' | 'selected';

/**
 * Export PDF → "Drivers on the PDF". Ticking drivers lists only their company loads, grouped by driver; nothing ticked lists every
 * load as the PDF always did. The Total choice decides whether the one Total number counts every truck or only the ticked drivers.
 * It never changes a record.
 */
export function DriverPicker({choices,selected,onChange,total,onTotal}:{choices:DriverChoice[];selected:string[];onChange:(keys:string[])=>void;total:DriverTotalChoice;onTotal:(value:DriverTotalChoice)=>void}){
  const toggle=(key:string)=>onChange(selected.includes(key)?selected.filter(value=>value!==key):[...selected,key]);
  const loads=choices.filter(choice=>selected.includes(choice.key)).reduce((sum,choice)=>sum+choice.loadCount,0);
  return <View style={styles.wrap}>
    <Text style={styles.label}>Drivers on the PDF</Text>
    <Text style={styles.hint}>Tick the drivers whose loads are listed. Nothing ticked lists every driver.</Text>
    <View style={styles.links}>
      <Pressable onPress={()=>onChange(choices.map(choice=>choice.key))} accessibilityRole="button" style={styles.link}><Text style={styles.linkText}>Select all</Text></Pressable>
      <Pressable onPress={()=>onChange([])} accessibilityRole="button" style={styles.link}><Text style={styles.linkText}>Clear</Text></Pressable>
    </View>
    {choices.map(choice=>{
      const on=selected.includes(choice.key);
      const meta=`${choice.plates.length?`${choice.plates.join(', ')} · `:''}${choice.loadCount} load${choice.loadCount===1?'':'s'}`;
      return <Pressable key={choice.key} style={styles.option} onPress={()=>toggle(choice.key)} accessibilityRole="checkbox" accessibilityState={{checked:on}} accessibilityLabel={`${choice.name}. ${meta}`}>
        <View style={[styles.box,on&&styles.boxOn]}>{on?<Text style={styles.tick}>✓</Text>:null}</View>
        <View style={styles.copy}><Text style={styles.name} numberOfLines={2}>{choice.name}</Text><Text style={styles.meta}>{meta}</Text></View>
      </Pressable>;
    })}
    {selected.length?<>
      <Text style={styles.hint}>{selected.length} driver{selected.length===1?'':'s'} selected · {loads} load{loads===1?'':'s'}</Text>
      <SegmentedChoice label="Total number on the PDF" options={[{id:'all',label:'Whole amount delivered'},{id:'selected',label:'Selected drivers only'}]} selectedId={total} onSelect={onTotal}/>
    </>:null}
  </View>;
}

const styles=StyleSheet.create({
  wrap:{gap:6},label:{color:colors.ink,fontSize:13,fontWeight:'800'},hint:{color:colors.muted,fontSize:12.5,lineHeight:18},
  links:{flexDirection:'row',gap:18},link:{minHeight:36,justifyContent:'center'},linkText:{color:colors.brand,fontSize:14,fontWeight:'800'},
  option:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:10,borderBottomWidth:1,borderBottomColor:colors.line,minHeight:56},
  box:{width:24,height:24,borderRadius:6,borderWidth:2,borderColor:'#9AA3AB',alignItems:'center',justifyContent:'center',backgroundColor:colors.surface},
  boxOn:{backgroundColor:colors.brand,borderColor:colors.brand},tick:{color:'#FFFFFF',fontSize:15,fontWeight:'900'},copy:{flex:1,gap:2},
  name:{color:colors.ink,fontSize:15,fontWeight:'800'},meta:{color:colors.muted,fontSize:12.5},
});
