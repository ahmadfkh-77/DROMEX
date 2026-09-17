import {LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {formatCubicMetres,parseWallVolumeInput,type Wall,type WallVolumeInput} from '../../domain/walls';
import {colors,radius} from '../theme';
import {AppField} from './AppPrimitives';
import {useReducedMotion} from './ExpandableMenu';

export type WallVolumeForm=WallVolumeInput&{enabled:boolean};
export const emptyWallVolumeForm=():WallVolumeForm=>({enabled:false,length:'',height:'',bottom:'',top:'',deduction:''});
type WallGeometry=Pick<Wall,'lengthM'|'heightM'|'bottomThicknessM'|'topThicknessM'>;

/**
 * DEC-455. Optional volume calculator for Stone and Ready Mix, using the same inputs and formula as
 * section 1 "Wall and geometry" (length × height × average thickness, less deductions; no allowance).
 * Every valid result is passed to onCalculated so the form can fill the consumed quantity, which the
 * user can still edit before saving.
 */
export function WallVolumeCalculator({value,onChange,onCalculated,wall}:{value:WallVolumeForm;onChange:(value:WallVolumeForm)=>void;onCalculated:(netVolumeM3:number)=>void;wall?:WallGeometry|null}){
  const reducedMotion=useReducedMotion();
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};
  const result=parseWallVolumeInput(value);
  const touched=!!(value.length.trim()||value.height.trim()||value.bottom.trim()||value.top.trim());
  const issues=touched?result.issues:[];

  const update=(next:WallVolumeForm)=>{onChange(next);const parsed=parseWallVolumeInput(next);if(parsed.snapshot)onCalculated(Number(parsed.snapshot.netVolumeM3.toFixed(3)));};
  const fromWall=()=>{if(!wall)return;update({...value,enabled:true,length:String(wall.lengthM),height:String(wall.heightM),bottom:String(wall.bottomThicknessM),top:String(wall.topThicknessM)});};

  if(!value.enabled)return <TouchableOpacity style={styles.add} onPress={()=>{animate();onChange({...value,enabled:true});}} accessibilityRole="button" accessibilityHint="Opens length, height, thickness, and deduction fields that calculate the volume used">
    <View style={styles.flex}>
      <Text style={styles.addTitle}>Calculate volume from wall dimensions</Text>
      <Text style={styles.helper}>Optional. Same inputs as section 1; the result fills the consumed quantity.</Text>
    </View>
    <Text style={styles.addAction}>Open</Text>
  </TouchableOpacity>;

  return <View style={styles.panel}>
    <View style={styles.head}>
      <Text style={styles.title}>Volume from wall dimensions</Text>
      <TouchableOpacity style={styles.link} onPress={()=>{animate();onChange(emptyWallVolumeForm());}} accessibilityRole="button" accessibilityLabel="Remove the volume calculation" accessibilityHint="Clears the dimension fields. The consumed quantity stays as it is">
        <Text style={styles.linkText}>Remove</Text>
      </TouchableOpacity>
    </View>
    <Text style={styles.helper}>Length × height × average of bottom and top thickness, less deductions. The net volume fills the consumed quantity, which you can still edit.</Text>
    {wall?<TouchableOpacity style={styles.fill} onPress={fromWall} accessibilityRole="button" accessibilityHint="Copies length, height, and both thicknesses from this wall's section 1 geometry">
      <Text style={styles.linkText}>Use this wall's section 1 dimensions</Text>
    </TouchableOpacity>:null}
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Length (m) *" value={value.length} onChangeText={length=>update({...value,length})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><AppField label="Height (m) *" value={value.height} onChangeText={height=>update({...value,height})} keyboardType="decimal-pad"/></View>
    </View>
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Bottom thickness (m) *" value={value.bottom} onChangeText={bottom=>update({...value,bottom})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><AppField label="Top thickness (m) *" value={value.top} onChangeText={top=>update({...value,top})} keyboardType="decimal-pad"/></View>
    </View>
    <AppField label="Volume deductions (m³)" value={value.deduction} onChangeText={deduction=>update({...value,deduction})} keyboardType="decimal-pad" placeholder="0"/>
    <View style={styles.results} accessibilityLabel={result.snapshot?`Gross volume ${formatCubicMetres(result.snapshot.grossVolumeM3)}, deductions ${formatCubicMetres(result.snapshot.deductionM3)}, net volume ${formatCubicMetres(result.snapshot.netVolumeM3)}`:'Volume not calculated yet'}>
      <Result label="Gross volume" value={result.snapshot?formatCubicMetres(result.snapshot.grossVolumeM3):'Not calculated'}/>
      <Result label="Deductions" value={result.snapshot?`− ${formatCubicMetres(result.snapshot.deductionM3)}`:'Not calculated'}/>
      <Result label="Net volume" value={result.snapshot?formatCubicMetres(result.snapshot.netVolumeM3):'Not calculated'} strong/>
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
  title:{flex:1,color:colors.resultDark,fontSize:15,fontWeight:'900'},
  link:{minHeight:44,justifyContent:'center',paddingHorizontal:10},
  fill:{minHeight:44,justifyContent:'center',alignSelf:'flex-start'},
  linkText:{color:colors.navy,fontSize:13,fontWeight:'900'},
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
