import {StyleSheet,Text,View} from 'react-native';

import {calculateVolumeSnapshot, validateVolumeDimensions, type VolumeDimensions} from '../../domain/wallConstructionLift';
import {formatCubicMetres} from '../../domain/walls';
import {colors,radius} from '../theme';
import {AppField} from './AppPrimitives';

export type LiftVolumeForm={length:string;height:string;bottom:string;top:string;deduction:string};
export const emptyLiftVolumeForm=():LiftVolumeForm=>({length:'',height:'',bottom:'',top:'',deduction:'0'});
export const liftVolumeFormFrom=(dimensions:VolumeDimensions):LiftVolumeForm=>({length:String(dimensions.lengthM),height:String(dimensions.heightM),bottom:String(dimensions.bottomThicknessM),top:String(dimensions.topThicknessM),deduction:String(dimensions.deductionM3)});
const n=(value:string):number=>{const parsed=Number(value.trim().replace(',','.'));return Number.isFinite(parsed)?parsed:Number.NaN;};
export function liftVolumeDimensionsFrom(form:LiftVolumeForm):VolumeDimensions{return{lengthM:n(form.length),heightM:n(form.height),bottomThicknessM:n(form.bottom),topThicknessM:n(form.top),deductionM3:form.deduction.trim()?n(form.deduction):0};}

/**
 * DEC-466. The one structural-volume calculator every Lift screen uses -- lift geometry,
 * the Stone simple calculator, and the independent Ready Mix calculator -- so the trapezoid formula
 * itself lives only in domain/wallConstructionLift.ts's calculateVolumeSnapshot, never duplicated here.
 */
export function LiftVolumeCalculator({label,helper,value,onChange,resultLabel='Net volume'}:{
  label:string;helper?:string;value:LiftVolumeForm;onChange:(value:LiftVolumeForm)=>void;resultLabel?:string;
}){
  const dimensions=liftVolumeDimensionsFrom(value);
  const touched=!!(value.length.trim()||value.height.trim()||value.bottom.trim()||value.top.trim());
  const issues=touched?validateVolumeDimensions(dimensions):[];
  const ready=touched&&issues.length===0;
  const snapshot=ready?calculateVolumeSnapshot(dimensions):null;

  return <View style={styles.panel}>
    <Text style={styles.title}>{label}</Text>
    {helper?<Text style={styles.helper}>{helper}</Text>:null}
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Length (m) *" value={value.length} onChangeText={length=>onChange({...value,length})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><AppField label="Height (m) *" value={value.height} onChangeText={height=>onChange({...value,height})} keyboardType="decimal-pad"/></View>
    </View>
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Bottom thickness (m) *" value={value.bottom} onChangeText={bottom=>onChange({...value,bottom})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><AppField label="Top thickness (m) *" value={value.top} onChangeText={top=>onChange({...value,top})} keyboardType="decimal-pad"/></View>
    </View>
    <AppField label="Deductions (m³)" value={value.deduction} onChangeText={deduction=>onChange({...value,deduction})} keyboardType="decimal-pad" placeholder="0"/>
    <View style={styles.results} accessibilityLabel={snapshot?`Gross volume ${formatCubicMetres(snapshot.grossVolumeM3)}, deductions ${formatCubicMetres(snapshot.deductionM3)}, ${resultLabel.toLowerCase()} ${formatCubicMetres(snapshot.netVolumeM3)}`:'Volume not calculated yet'}>
      <Result label="Gross volume" value={snapshot?formatCubicMetres(snapshot.grossVolumeM3):'Not calculated'}/>
      <Result label="Deductions" value={snapshot?`− ${formatCubicMetres(snapshot.deductionM3)}`:'Not calculated'}/>
      <Result label={resultLabel} value={snapshot?formatCubicMetres(snapshot.netVolumeM3):'Not calculated'} strong/>
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
  panel:{gap:10,borderWidth:1,borderColor:'#B9E3E0',borderRadius:radius.md,padding:13,backgroundColor:'#F4FBFA'},
  title:{color:colors.resultDark,fontSize:15,fontWeight:'900'},
  helper:{color:colors.muted,fontSize:12,lineHeight:17},
  pair:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
  results:{flexDirection:'row',flexWrap:'wrap',gap:6},
  result:{flexGrow:1,flexBasis:'30%',minWidth:92,borderRadius:10,paddingHorizontal:10,paddingVertical:8,backgroundColor:colors.surface},
  resultStrong:{backgroundColor:colors.result},
  resultLabel:{color:colors.muted,fontSize:11,fontWeight:'800'},
  resultLabelStrong:{color:'#E3F6F4'},
  resultValue:{color:colors.ink,fontSize:14,fontWeight:'900',fontVariant:['tabular-nums']},
  resultValueStrong:{color:'#FFFFFF'},
  issue:{color:colors.danger,fontSize:12,fontWeight:'800',lineHeight:17},
});
