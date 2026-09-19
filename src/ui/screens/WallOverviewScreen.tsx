import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {ConstructionLiftRepository} from '../../data/repositories/ConstructionLiftRepository';
import type {WallRepository} from '../../data/repositories/WallRepository';
import {buildCombinedConstructionLiftDiagram,stackInputFrom} from '../../domain/constructionLiftDiagram';
import {baseStatusLabels} from '../../domain/wallBase';
import {reconcileLifts,type ConstructionLift,type LiftReconciliation} from '../../domain/wallConstructionLift';
import {wallPurposeLabels,wallSystemLabels,type WallDetail} from '../../domain/walls';
import {AppButton,AppCard,Feedback,PageHeader} from '../components/AppPrimitives';
import {ConstructionLiftStackDiagramView} from '../components/ConstructionLiftStackDiagramView';
import {LiftReconciliationPanel} from '../components/LiftReconciliationPanel';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors} from '../theme';

/** DEC-466. The wall workspace home, organized the same way as the Foundation Overview: summaries and navigation only. */
export function WallOverviewScreen({repository,liftRepository,wallId,trail,onBack,onOpenGeometry,onOpenLifts,onOpenMaterials,onOpenHistory}:{
  repository:WallRepository;liftRepository:ConstructionLiftRepository;wallId:string;trail:string[];onBack:()=>void;
  onOpenGeometry:()=>void;onOpenLifts:()=>void;onOpenMaterials:()=>void;onOpenHistory:()=>void;
}){
  const[detail,setDetail]=useState<WallDetail|null>(null);
  const[reconciliation,setReconciliation]=useState<LiftReconciliation|null>(null);
  const[wallLifts,setWallLifts]=useState<ConstructionLift[]>([]);
  const[foundationLifts,setFoundationLifts]=useState<ConstructionLift[]>([]);
  const[foundationReconciliation,setFoundationReconciliation]=useState<LiftReconciliation|null>(null);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const[nextDetail,nextReconciliation,nextWallLifts]=await Promise.all([
      repository.getWall(wallId),liftRepository.reconcileWall(wallId),liftRepository.listLiftsForWall(wallId),
    ]);
    setDetail(nextDetail);setReconciliation(nextReconciliation);setWallLifts(nextWallLifts);
    const foundationId=nextDetail?.foundation?.id;
    if(foundationId){
      const[lifts,reconciled]=await Promise.all([
        liftRepository.listLiftsForFoundation(foundationId),liftRepository.reconcileFoundation(foundationId),
      ]);
      setFoundationLifts(lifts);setFoundationReconciliation(reconciled);
    }else{setFoundationLifts([]);setFoundationReconciliation(null);}
  },[repository,liftRepository,wallId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this wall.'));},[refresh]);

  if(!detail||!reconciliation)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;
  const{wall,foundation,stage}=detail;
  // Curing is shown on the drawing as a note and never removes wall content from it (DEC-463).
  const combinedDiagram=buildCombinedConstructionLiftDiagram({
    foundation:stackInputFrom({
      title:foundation?.reference??'No linked foundation',contextLabel:null,parentLabel:'Foundation',
      parentNetVolumeM3:foundation?.netVolumeM3??0,lifts:foundationLifts,
      reconciliation:foundationReconciliation??reconcileLifts(foundation?.netVolumeM3??0,[]),
    }),
    wall:stackInputFrom({
      title:wall.name,contextLabel:null,parentLabel:'Wall',parentNetVolumeM3:wall.netVolumeM3,
      lifts:wallLifts,reconciliation,
      curingNote:!stage.curingConfirmed&&stage.warningBody?stage.warningBody:null,
    }),
  });

  return <View style={styles.screen}>
    <PageHeader eyebrow="WALL" title={wall.name} onBack={onBack}/>
    <ParentContextHeader trail={trail}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}

    <AppCard title="Wall identity">
      <Text style={styles.detail}>{wallSystemLabels[wall.system]} · {wallPurposeLabels[wall.purpose]}</Text>
      {foundation?<Text style={styles.detail}>Foundation {foundation.reference}: {baseStatusLabels[foundation.status]}</Text>:null}
      {!stage.curingConfirmed&&stage.warningBody?<Text style={styles.warning}>{stage.warningBody}</Text>:null}
    </AppCard>

    <AppCard title="Structural capacity"><LiftReconciliationPanel netVolumeM3={wall.netVolumeM3} reconciliation={reconciliation}/></AppCard>

    <AppCard title="Wall on its foundation" hint="A combined schematic: wall lifts above the construction joint, foundation lifts below it.">
      <ConstructionLiftStackDiagramView diagram={combinedDiagram} compact/>
    </AppCard>

    <View style={styles.actions}>
      <AppButton label="Wall Geometry" tone="secondary" onPress={onOpenGeometry}/>
      <AppButton label="Wall Lifts" tone="navy" onPress={onOpenLifts}/>
      <AppButton label="Layers and Materials" tone="secondary" onPress={onOpenMaterials}/>
      <AppButton label="History and Corrections" tone="secondary" onPress={onOpenHistory}/>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  warning:{color:colors.warning,fontSize:12,fontWeight:'800',lineHeight:17},
  actions:{gap:8},
});
