import {useState} from 'react';
import {LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {colors,radius} from '../theme';
import {useReducedMotion} from './ExpandableMenu';

export type ChoiceOption<T extends string>={id:T;label:string;hint?:string};

/**
 * A small fixed choice shown as one field: tapping it reveals every option as a radio row, and choosing
 * one closes it again. Expansion animates only when the system Reduce Motion setting is off.
 */
export function ChoiceField<T extends string>({label,options,selectedId,onSelect,hint}:{label:string;options:ChoiceOption<T>[];selectedId:T|'';onSelect:(id:T)=>void;hint?:string}){
  const[open,setOpen]=useState(false);
  const reducedMotion=useReducedMotion();
  const selected=options.find(option=>option.id===selectedId);
  const name=label.replace(/\s*\*$/,'');
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};
  const toggle=()=>{animate();setOpen(value=>!value);};
  const choose=(id:T)=>{animate();onSelect(id);setOpen(false);};
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TouchableOpacity style={[styles.control,open&&styles.controlOpen]} onPress={toggle} activeOpacity={.75} accessibilityRole="button" accessibilityLabel={`${name}: ${selected?.label??'not chosen'}`} accessibilityHint={open?'Hides the choices':'Shows the choices'} accessibilityState={{expanded:open}}>
      <View style={styles.copy}>
        <Text style={[styles.value,!selected&&styles.placeholder]}>{selected?.label??'Choose one'}</Text>
        {selected?.hint&&!open?<Text style={styles.hint} numberOfLines={1}>{selected.hint}</Text>:null}
      </View>
      <Text style={styles.action}>{open?'Close':'Change'}</Text>
    </TouchableOpacity>
    {open?<View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={name}>
      {options.map(option=>{const checked=option.id===selectedId;return <TouchableOpacity key={option.id} style={[styles.option,checked&&styles.optionOn]} onPress={()=>choose(option.id)} activeOpacity={.75} accessibilityRole="radio" accessibilityState={{checked}} accessibilityLabel={option.label} accessibilityHint={option.hint}>
        <View style={[styles.radio,checked&&styles.radioOn]}>{checked?<View style={styles.radioDot}/>:null}</View>
        <View style={styles.copy}>
          <Text style={[styles.optionLabel,checked&&styles.optionLabelOn]}>{option.label}</Text>
          {option.hint?<Text style={styles.hint}>{option.hint}</Text>:null}
        </View>
      </TouchableOpacity>;})}
    </View>:null}
    {hint?<Text style={styles.hint}>{hint}</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  field:{gap:6},
  label:{color:colors.ink,fontSize:13,fontWeight:'800'},
  control:{minHeight:49,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,paddingVertical:9,backgroundColor:'#FCFBF8',flexDirection:'row',alignItems:'center',gap:10},
  controlOpen:{borderColor:colors.navy},
  copy:{flex:1,minWidth:0},
  value:{color:colors.ink,fontSize:15,fontWeight:'800'},
  placeholder:{color:colors.muted,fontWeight:'600'},
  action:{color:colors.brandDark,fontSize:13,fontWeight:'900'},
  options:{gap:8},
  option:{minHeight:48,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:13,paddingVertical:11,borderRadius:radius.md,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface},
  optionOn:{borderColor:colors.navy,backgroundColor:'#EAF1F6'},
  radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:colors.muted,alignItems:'center',justifyContent:'center'},
  radioOn:{borderColor:colors.navy},
  radioDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.navy},
  optionLabel:{color:colors.ink,fontSize:15,fontWeight:'800'},
  optionLabelOn:{color:colors.navy},
  hint:{color:colors.muted,fontSize:12,lineHeight:17,marginTop:2},
});
