import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {CyclopeanLiftRepository} from '../../data/repositories/CyclopeanLiftRepository';
import type {WallRepository} from '../../data/repositories/WallRepository';
import {baseStatusLabels} from '../../domain/wallBase';
import type {LiftReconciliation} from '../../domain/wallCyclopeanLift';
import {wallPurposeLabels,wallSystemLabels,type WallDetail} from '../../domain/walls';
import {AppButton,AppCard,Feedback,PageHeader} from '../components/AppPrimitives';
import {LiftReconciliationPanel} from '../components/LiftReconciliationPanel';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors} from '../theme';

/** DEC-466. The wall workspace home, organized the same way as the Foundation Overview: summaries and navigation only. */
export function WallOverviewScreen({repository,liftRepository,wallId,trail,onBack,onOpenGeometry,onOpenLifts,onOpenMaterials,onOpenHistory}:{
  repository:WallRepository;liftRepository:CyclopeanLiftRepository;wallId:string;trail:string[];onBack:()=>void;
  onOpenGeometry:()=>void;onOpenLifts:()=>void;onOpenMaterials:()=>void;onOpenHistory:()=>void;
}){
  const[detail,setDetail]=useState<WallDetail|null>(null);
  const[reconciliation,setReconciliation]=useState<LiftReconciliation|null>(null);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const[nextDetail,nextReconciliation]=await Promise.all([repository.getWall(wallId),liftRepository.reconcileWall(wallId)]);
    setDetail(nextDetail);setReconciliation(nextReconciliation);
  },[repository,liftRepository,wallId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this wall.'));},[refresh]);

  if(!detail||!reconciliation)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;
  const{wall,foundation,stage}=detail;

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

    <View style={styles.actions}>
      <AppButton label="Wall Geometry" tone="secondary" onPress={onOpenGeometry}/>
      <AppButton label="Wall Cyclopean Lifts" tone="navy" onPress={onOpenLifts}/>
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
