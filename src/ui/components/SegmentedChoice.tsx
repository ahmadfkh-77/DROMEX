import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {colors} from '../theme';

export type SegmentOption<T extends string>={id:T;label:string;count?:number};

/**
 * A small fixed single choice where every option stays visible: a person's role, a sign-off style,
 * or a list filter. `radio` mode is a form value; `tabs` mode filters what is shown below it. The
 * selected option is marked by a filled background, a heavier border AND a leading check mark, so it
 * never depends on colour alone. Options wrap onto a second line on narrow phones instead of shrinking.
 */
export function SegmentedChoice<T extends string>({label,options,selectedId,onSelect,mode='radio',hint}:{label?:string;options:SegmentOption<T>[];selectedId:T;onSelect:(id:T)=>void;mode?:'radio'|'tabs';hint?:string}){
  const name=(label??'').replace(/\s*\*$/,'');
  return <View style={styles.field}>
    {label?<Text style={styles.label}>{label}</Text>:null}
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={name||undefined}>
      {options.map(option=>{const on=option.id===selectedId;return <TouchableOpacity key={option.id} style={[styles.option,on&&styles.optionOn]} onPress={()=>onSelect(option.id)} activeOpacity={.75}
        accessibilityRole={mode==='tabs'?'tab':'radio'} accessibilityState={mode==='tabs'?{selected:on}:{checked:on}}
        accessibilityLabel={option.count==null?option.label:`${option.label}, ${option.count}`}>
        <Text style={[styles.optionText,on&&styles.optionTextOn]} numberOfLines={1}>{on?'✓ ':''}{option.label}</Text>
        {option.count!=null?<Text style={[styles.count,on&&styles.countOn]}>{option.count}</Text>:null}
      </TouchableOpacity>;})}
    </View>
    {hint?<Text style={styles.hint}>{hint}</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  field:{gap:6},
  label:{color:colors.ink,fontSize:13,fontWeight:'800'},
  row:{flexDirection:'row',flexWrap:'wrap',gap:8},
  option:{minHeight:48,flexGrow:1,flexBasis:0,minWidth:88,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,paddingHorizontal:10,borderRadius:10,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface},
  optionOn:{borderColor:colors.navy,borderWidth:2,backgroundColor:'#EAF1F6'},
  optionText:{color:colors.muted,fontSize:13,fontWeight:'800',flexShrink:1},
  optionTextOn:{color:colors.navy,fontWeight:'900'},
  count:{minWidth:22,paddingHorizontal:6,paddingVertical:1,borderRadius:9,backgroundColor:'#EEEAE2',color:colors.muted,fontSize:11,fontWeight:'900',textAlign:'center',overflow:'hidden'},
  countOn:{backgroundColor:colors.navy,color:'#FFF8ED'},
  hint:{color:colors.muted,fontSize:12,lineHeight:17},
});
