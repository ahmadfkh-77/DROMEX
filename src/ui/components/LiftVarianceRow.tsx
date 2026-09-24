import {StyleSheet,Text,View} from 'react-native';

import type {ConcreteVariance} from '../../domain/wallConstructionLift';
import {formatCubicMetres} from '../../domain/walls';
import {colors} from '../theme';

/** Never a rejection, never hidden: shows how an actual quantity compares with what was estimated or calculated. */
export function LiftVarianceRow({estimatedLabel,estimatedM3,actualLabel,actualM3,variance}:{
  estimatedLabel:string;estimatedM3:number;actualLabel:string;actualM3:number|null;variance:ConcreteVariance|null;
}){
  return <View style={styles.row}>
    <View style={styles.cell}><Text style={styles.label}>{estimatedLabel}</Text><Text style={styles.value}>{formatCubicMetres(estimatedM3)}</Text></View>
    <View style={styles.cell}><Text style={styles.label}>{actualLabel}</Text><Text style={styles.value}>{actualM3==null?'Not recorded':formatCubicMetres(actualM3)}</Text></View>
    <View style={styles.cell}>
      <Text style={styles.label}>Variance</Text>
      {variance?<Text style={[styles.value,variance.direction==='over'&&styles.over,variance.direction==='under'&&styles.under]}>
        {variance.direction==='none'?'Matches':`${variance.direction==='over'?'+':''}${formatCubicMetres(variance.varianceM3)}`}
      </Text>:<Text style={styles.value}>Not recorded</Text>}
    </View>
  </View>;
}

const styles=StyleSheet.create({
  row:{flexDirection:'row',flexWrap:'wrap',gap:8},
  cell:{flexGrow:1,flexBasis:'30%',minWidth:100,gap:2},
  label:{color:colors.muted,fontSize:11,fontWeight:'800'},
  value:{color:colors.ink,fontSize:14,fontWeight:'900',fontVariant:['tabular-nums']},
  over:{color:colors.warning},
  under:{color:colors.brand},
});
