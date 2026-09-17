import {LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {formatWallArea,parseWallAreaInput,type WallAreaInput} from '../../domain/walls';
import {colors,radius} from '../theme';
import {AppField} from './AppPrimitives';
import {useReducedMotion} from './ExpandableMenu';

export type WallAreaForm=WallAreaInput&{enabled:boolean};
export const emptyWallAreaForm=():WallAreaForm=>({enabled:false,length:'',height:'',deduction:''});

/**
 * DEC-450. Optional covered-area calculator for Stone and Ready Mix. It uses the domain's single wall
 * face-area formula and keeps its result beside the inputs. It never touches the consumed quantity.
 */
export function WallAreaCalculator({value,onChange,materialLabel}:{value:WallAreaForm;onChange:(value:WallAreaForm)=>void;materialLabel:string}){
  const reducedMotion=useReducedMotion();
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};
  const touched=!!(value.length.trim()||value.height.trim());
  const result=parseWallAreaInput(value);
  const issues=touched?result.issues:[];

  if(!value.enabled)return <TouchableOpacity style={styles.add} onPress={()=>{animate();onChange({...value,enabled:true});}} accessibilityRole="button" accessibilityHint={`Opens length, height, and openings fields for the wall area this ${materialLabel.toLowerCase()} covered`}>
    <View style={styles.flex}>
      <Text style={styles.addTitle}>Add covered wall area</Text>
      <Text style={styles.helper}>Optional. Record the wall face this {materialLabel.toLowerCase()} covered.</Text>
    </View>
    <Text style={styles.addAction}>Add</Text>
  </TouchableOpacity>;

  return <View style={styles.panel}>
    <View style={styles.head}>
      <Text style={styles.title}>Covered wall area</Text>
      <TouchableOpacity style={styles.remove} onPress={()=>{animate();onChange({enabled:false,length:'',height:'',deduction:''});}} accessibilityRole="button" accessibilityLabel="Remove covered wall area" accessibilityHint="Clears the area fields. The consumed quantity stays as entered">
        <Text style={styles.removeText}>Remove</Text>
      </TouchableOpacity>
    </View>
    <Text style={styles.helper}>Covered area never changes the consumed quantity. Openings are deducted in m².</Text>
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Wall length (m) *" value={value.length} onChangeText={length=>onChange({...value,length})} keyboardType="decimal-pad" accessibilityLabel="Covered wall length in metres"/></View>
      <View style={styles.flex}><AppField label="Wall height (m) *" value={value.height} onChangeText={height=>onChange({...value,height})} keyboardType="decimal-pad" accessibilityLabel="Covered wall height in metres"/></View>
    </View>
    <AppField label="Openings and deductions (m²)" value={value.deduction} onChangeText={deduction=>onChange({...value,deduction})} keyboardType="decimal-pad" placeholder="0" accessibilityLabel="Openings and deductions in square metres"/>
    <View style={styles.results} accessibilityRole="summary" accessibilityLabel={result.snapshot?`Gross area ${formatWallArea(result.snapshot.grossAreaM2)}, openings ${formatWallArea(result.snapshot.deductionM2)}, net covered area ${formatWallArea(result.snapshot.netAreaM2)}`:'Covered area not calculated yet'}>
      <Result label="Gross area" value={result.snapshot?formatWallArea(result.snapshot.grossAreaM2):'Not calculated'}/>
      <Result label="Openings" value={result.snapshot?`− ${formatWallArea(result.snapshot.deductionM2)}`:'Not calculated'}/>
      <Result label="Net covered area" value={result.snapshot?formatWallArea(result.snapshot.netAreaM2):'Not calculated'} strong/>
    </View>
    {issues.length?<View accessibilityLiveRegion="polite">{issues.map(issue=><Text key={issue} style={styles.issue}>{issue}</Text>)}</View>:null}
  </View>;
}

function Result({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <View style={[styles.result,strong&&styles.resultStrong]}>
    <Text style={[styles.resultLabel,strong&&styles.resultLabelStrong]}>{label}</Text>
    <Text style={[styles.resultValue,strong&&styles.resultValueStrong]}>{value}</Text>
  </View>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  add:{minHeight:56,flexDirection:'row',alignItems:'center',gap:12,borderWidth:1,borderStyle:'dashed',borderColor:colors.result,borderRadius:radius.md,paddingHorizontal:14,paddingVertical:11,backgroundColor:'#F4FBFA'},
  addTitle:{color:colors.resultDark,fontSize:14,fontWeight:'900'},
  addAction:{color:colors.resultDark,fontSize:13,fontWeight:'900'},
  panel:{gap:10,borderWidth:1,borderColor:'#B9E3E0',borderRadius:radius.md,padding:13,backgroundColor:'#F4FBFA'},
  head:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},
  title:{color:colors.resultDark,fontSize:15,fontWeight:'900'},
  remove:{minHeight:44,justifyContent:'center',paddingHorizontal:10},
  removeText:{color:colors.navy,fontSize:13,fontWeight:'900'},
  helper:{color:colors.muted,fontSize:12,lineHeight:17},
  pair:{flexDirection:'row',gap:10},
  results:{flexDirection:'row',flexWrap:'wrap',gap:6},
  result:{flexGrow:1,flexBasis:'30%',minWidth:92,borderRadius:10,paddingHorizontal:10,paddingVertical:8,backgroundColor:colors.surface},
  resultStrong:{backgroundColor:colors.result},
  resultLabel:{color:colors.muted,fontSize:11,fontWeight:'800'},
  resultLabelStrong:{color:'#E3F6F4'},
  resultValue:{color:colors.ink,fontSize:14,fontWeight:'900',fontVariant:['tabular-nums']},
  resultValueStrong:{color:'#FFFFFF'},
  issue:{color:colors.danger,fontSize:12,fontWeight:'800',lineHeight:17},
});
