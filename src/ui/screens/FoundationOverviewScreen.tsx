import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {CyclopeanLiftRepository} from '../../data/repositories/CyclopeanLiftRepository';
import type {WallRepository} from '../../data/repositories/WallRepository';
import type {ConstructionSection} from '../../domain/constructionSections';
import type {Foundation} from '../../domain/foundations';
import {baseStatusLabels,CURING_WARNING_BODY,CURING_WARNING_TITLE} from '../../domain/wallBase';
import type {LiftReconciliation, LegacyCompositeStage} from '../../domain/wallCyclopeanLift';
import {formatCubicMetres,type Wall} from '../../domain/walls';
import {AppButton,AppCard,Feedback,PageHeader} from '../components/AppPrimitives';
import {LiftReconciliationPanel} from '../components/LiftReconciliationPanel';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors} from '../theme';

/**
 * DEC-466. The foundation workspace home: summaries only, one action per navigation destination.
 * No calculator, no material-entry form, and no full history ever appear directly on this screen.
 */
export function FoundationOverviewScreen({repository,liftRepository,foundationId,section,trail,onBack,onOpenGeometry,onOpenLifts,onOpenCuring,onOpenHistory,onOpenWall,onOpenSummary}:{
  repository:WallRepository;liftRepository:CyclopeanLiftRepository;foundationId:string;section:ConstructionSection|null;trail:string[];onBack:()=>void;
  onOpenGeometry:()=>void;onOpenLifts:()=>void;onOpenCuring:()=>void;onOpenHistory:()=>void;onOpenWall:()=>void;onOpenSummary:()=>void;
}){
  const[foundation,setFoundation]=useState<Foundation|null>(null);
  const[wall,setWall]=useState<Wall|null>(null);
  const[reconciliation,setReconciliation]=useState<LiftReconciliation|null>(null);
  const[legacy,setLegacy]=useState<LegacyCompositeStage|null>(null);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const found=await repository.getFoundation(foundationId);
    if(!found)throw new Error('Foundation was not found.');
    const[nextReconciliation,nextLegacy,allWalls]=await Promise.all([
      liftRepository.reconcileFoundation(foundationId),liftRepository.getLegacyCompositeStage(foundationId),repository.listWalls(found.projectId),
    ]);
    setFoundation(found);setReconciliation(nextReconciliation);setLegacy(nextLegacy);
    setWall(allWalls.find(value=>value.foundationId===foundationId)??null);
  },[repository,liftRepository,foundationId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this foundation.'));},[refresh]);

  if(!foundation||!reconciliation)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  const curingConfirmed=foundation.status==='cured';
  const nextAction=reconciliation.overAllocated?'Resolve lift over-allocation'
    :reconciliation.remainingUnallocatedVolumeM3>0?'Add the next Cyclopean Lift'
    :!wall?'Create or link the wall above this foundation'
    :'Review the Foundation Summary';

  return <View style={styles.screen}>
    <PageHeader eyebrow={section?section.name.toUpperCase():'FOUNDATION'} title={foundation.reference} onBack={onBack}/>
    <ParentContextHeader trail={trail}/>
    {!curingConfirmed?<View style={styles.curingNotice} accessibilityLiveRegion="polite">
      <Text style={styles.curingNoticeTitle}>{CURING_WARNING_TITLE}</Text>
      <Text style={styles.curingNoticeBody}>{CURING_WARNING_BODY}</Text>
    </View>:null}
    {error?<Feedback kind="error">{error}</Feedback>:null}

    <AppCard title="Structural capacity">
      <LiftReconciliationPanel netVolumeM3={foundation.netVolumeM3} reconciliation={reconciliation}/>
    </AppCard>

    {legacy?<AppCard tone="cream" title="Imported legacy composite stage" hint="Recorded before ordered Cyclopean Lifts existed. Shown for history only -- new work below uses lifts.">
      <Text style={styles.detail}>Stone {formatCubicMetres(legacy.activeStoneM3)} · estimated concrete {formatCubicMetres(legacy.estimatedConcreteM3)}{legacy.activeReadyMixM3>0?` · actual Ready Mix ${formatCubicMetres(legacy.activeReadyMixM3)}`:''}</Text>
    </AppCard>:null}

    <AppCard title="Curing"><Text style={styles.detail}>{baseStatusLabels[foundation.status]}{curingConfirmed?` since ${foundation.curedOn}`:''}</Text></AppCard>

    <Text style={styles.nextAction}>Next: {nextAction}</Text>

    <View style={styles.actions}>
      <AppButton label="Edit Geometry" tone="secondary" onPress={onOpenGeometry}/>
      <AppButton label="Cyclopean Lifts" tone="navy" onPress={onOpenLifts}/>
      <AppButton label="Foundation Summary" tone="secondary" onPress={onOpenSummary}/>
      <AppButton label="Curing" tone="secondary" onPress={onOpenCuring}/>
      <AppButton label={wall?'Linked Wall':'Create or Link Wall'} tone="secondary" onPress={onOpenWall}/>
      <AppButton label="History" tone="secondary" onPress={onOpenHistory}/>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  nextAction:{color:colors.ink,fontSize:13,fontWeight:'900'},
  actions:{gap:8},
  curingNotice:{backgroundColor:'#FFF3D8',borderRadius:10,padding:10,gap:3},
  curingNoticeTitle:{color:colors.warning,fontSize:12,fontWeight:'900'},
  curingNoticeBody:{color:colors.warning,fontSize:12,fontWeight:'700',lineHeight:17},
});
