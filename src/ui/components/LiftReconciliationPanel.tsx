import {StyleSheet,Text,View} from 'react-native';

import type {LiftReconciliation} from '../../domain/wallCyclopeanLift';
import {formatCubicMetres} from '../../domain/walls';
import {colors,radius} from '../theme';
import {Feedback,MetricCard} from './AppPrimitives';

/**
 * DEC-466. The one place every foundation/wall total is shown together -- never hidden, never
 * silently clamped. Used by both the Foundation and Wall Overview/Summary screens.
 */
export function LiftReconciliationPanel({netVolumeM3,reconciliation}:{netVolumeM3:number;reconciliation:LiftReconciliation}){
  return <View style={styles.wrap}>
    <View style={styles.metrics}>
      <MetricCard label="Structural envelope" value={formatCubicMetres(netVolumeM3)} accent/>
      <MetricCard label="Allocated to lifts" value={formatCubicMetres(reconciliation.totalAllocatedLiftVolumeM3)}/>
      <MetricCard label="Remaining unallocated" value={formatCubicMetres(reconciliation.remainingUnallocatedVolumeM3)} result={!reconciliation.overAllocated}/>
    </View>
    {reconciliation.overAllocated?<Feedback kind="error">Lifts allocate {formatCubicMetres(reconciliation.overAllocationM3)} more than the structural envelope. Correct a lift's geometry.</Feedback>:null}
    <View style={styles.metrics}>
      <MetricCard label="Stone calculated" value={formatCubicMetres(reconciliation.totalCalculatedStoneM3)}/>
      <MetricCard label="Stone actual" value={formatCubicMetres(reconciliation.totalActualStoneM3)}/>
    </View>
    <View style={styles.metrics}>
      <MetricCard label="Concrete estimated" value={formatCubicMetres(reconciliation.totalEstimatedConcreteM3)}/>
      <MetricCard label="Ready Mix actual" value={formatCubicMetres(reconciliation.totalActualReadyMixM3)}/>
    </View>
    {reconciliation.totalActualReadyMixM3>0?<Text style={styles.variance}>Ready Mix variance vs. estimate: {reconciliation.totalVarianceM3>0?'+':''}{formatCubicMetres(reconciliation.totalVarianceM3)}</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  wrap:{gap:8},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:8},
  variance:{color:colors.ink,fontSize:12,fontWeight:'800',borderRadius:radius.sm,padding:8,backgroundColor:colors.surface},
});
