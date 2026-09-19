import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {ConstructionLiftRepository} from '../../data/repositories/ConstructionLiftRepository';
import type {WallRepository} from '../../data/repositories/WallRepository';
import {buildConstructionLiftStackDiagram,stackInputFrom} from '../../domain/constructionLiftDiagram';
import type {Foundation} from '../../domain/foundations';
import {deriveLiftStatus,type ConstructionLift, type LegacyCompositeStage, type LiftReconciliation} from '../../domain/wallConstructionLift';
import {formatCubicMetres} from '../../domain/walls';
import {AppCard,Feedback,PageHeader} from '../components/AppPrimitives';
import {ConstructionLiftStackDiagramView} from '../components/ConstructionLiftStackDiagramView';
import {LiftReconciliationPanel} from '../components/LiftReconciliationPanel';
import {LiftStatusPill} from '../components/LiftStatusPill';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors,radius} from '../theme';

/** DEC-466. The dedicated reconciliation screen: every lift in order, every total, every discrepancy -- never hidden. */
export function FoundationSummaryScreen({repository,liftRepository,foundationId,trail,onBack}:{
  repository:WallRepository;liftRepository:ConstructionLiftRepository;foundationId:string;trail:string[];onBack:()=>void;
}){
  const[foundation,setFoundation]=useState<Foundation|null>(null);
  const[lifts,setLifts]=useState<ConstructionLift[]>([]);
  const[reconciliation,setReconciliation]=useState<LiftReconciliation|null>(null);
  const[legacyStage,setLegacyStage]=useState<LegacyCompositeStage|null>(null);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const[found,nextLifts,nextReconciliation,legacy]=await Promise.all([
      repository.getFoundation(foundationId),liftRepository.listLiftsForFoundation(foundationId),
      liftRepository.reconcileFoundation(foundationId),liftRepository.getLegacyCompositeStage(foundationId),
    ]);
    if(!found)throw new Error('Foundation was not found.');
    setFoundation(found);setLifts(nextLifts);setReconciliation(nextReconciliation);setLegacyStage(legacy);
  },[repository,liftRepository,foundationId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this foundation.'));},[refresh]);

  if(!foundation||!reconciliation)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  const incomplete=lifts.filter(lift=>deriveLiftStatus(lift)!=='completed');
  const diagram=buildConstructionLiftStackDiagram(stackInputFrom({
    title:foundation.reference,contextLabel:null,parentLabel:'Foundation',
    parentNetVolumeM3:foundation.netVolumeM3,lifts,reconciliation,legacyStage,
  }));

  return <View style={styles.screen}>
    <PageHeader eyebrow="FOUNDATION SUMMARY" title={foundation.reference} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'Summary']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}

    <AppCard title="Reconciliation"><LiftReconciliationPanel netVolumeM3={foundation.netVolumeM3} reconciliation={reconciliation}/></AppCard>

    <AppCard title="Foundation diagram">
      <ConstructionLiftStackDiagramView diagram={diagram} caption="Every recorded lift in construction order, with the legend below the drawing. Schematic, not a construction drawing."/>
    </AppCard>

    <AppCard title="Lifts, in order">
      {lifts.length===0?<Text style={styles.detail}>No lifts recorded yet.</Text>:lifts.map(lift=>{
        const status=deriveLiftStatus(lift);
        return <View key={lift.id} style={styles.liftRow}>
          <View style={styles.liftHead}><Text style={styles.liftTitle}>{lift.reference}</Text><LiftStatusPill status={status}/></View>
          <Text style={styles.detail}>Structural {formatCubicMetres(lift.netLiftVolumeM3)} · Stone {formatCubicMetres(lift.stonePhase.calculatedStoneVolumeM3)} · Concrete {lift.concretePhase?formatCubicMetres(lift.concretePhase.estimatedMatrixVolumeM3):'not started'}</Text>
        </View>;
      })}
    </AppCard>

    {incomplete.length?<AppCard tone="cream" title="Incomplete lifts">
      {incomplete.map(lift=><Text key={lift.id} style={styles.detail}>{lift.reference}: {deriveLiftStatus(lift)==='planned'?'Stone not yet recorded.':'Concrete fill pending.'}</Text>)}
    </AppCard>:null}
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  liftRow:{backgroundColor:colors.surface,borderRadius:radius.md,padding:10,gap:4,marginBottom:6},
  liftHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  liftTitle:{color:colors.ink,fontSize:14,fontWeight:'900'},
});
