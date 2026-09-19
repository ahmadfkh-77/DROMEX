import {useCallback,useEffect,useMemo,useState} from 'react';
import {ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {ConstructionLiftRepository} from '../../data/repositories/ConstructionLiftRepository';
import type {WallRepository} from '../../data/repositories/WallRepository';
import type {ConstructionSection} from '../../domain/constructionSections';
import {buildConstructionLiftStackDiagram,stackInputFrom} from '../../domain/constructionLiftDiagram';
import type {Foundation} from '../../domain/foundations';
import type {ConstructionLift,LegacyCompositeStage,LiftReconciliation} from '../../domain/wallConstructionLift';
import {AppCard,Feedback,PageHeader} from '../components/AppPrimitives';
import {ConstructionLiftStackDiagramView} from '../components/ConstructionLiftStackDiagramView';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors,radius} from '../theme';

/**
 * DEC-466 Phase 4. The foundation's full technical drawing on its own screen: every lift in
 * construction order, with one lift selectable so a long stack stays readable on a phone instead of
 * turning into a wall of full-size cards.
 */
export function FoundationDiagramScreen({repository,liftRepository,foundationId,section,trail,onBack}:{
  repository:WallRepository;liftRepository:ConstructionLiftRepository;foundationId:string;section:ConstructionSection|null;trail:string[];onBack:()=>void;
}){
  const[foundation,setFoundation]=useState<Foundation|null>(null);
  const[lifts,setLifts]=useState<ConstructionLift[]>([]);
  const[reconciliation,setReconciliation]=useState<LiftReconciliation|null>(null);
  const[legacyStage,setLegacyStage]=useState<LegacyCompositeStage|null>(null);
  const[selectedLiftId,setSelectedLiftId]=useState<string|null>(null);
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

  const diagram=useMemo(()=>{
    if(!foundation||!reconciliation)return null;
    return buildConstructionLiftStackDiagram(stackInputFrom({
      title:foundation.reference,contextLabel:section?.name??null,parentLabel:'Foundation',
      parentNetVolumeM3:foundation.netVolumeM3,lifts,reconciliation,
      curingNote:foundation.curingStartedOn?`Curing recorded from ${foundation.curingStartedOn}. Curing is informational and never blocks this drawing.`:null,
      legacyStage,selectedLiftId,
    }));
  },[foundation,reconciliation,lifts,section,legacyStage,selectedLiftId]);

  if(!foundation||!diagram)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  return <View style={styles.screen}>
    <PageHeader eyebrow="FOUNDATION DIAGRAM" title={foundation.reference} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'Diagram']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}

    <ConstructionLiftStackDiagramView diagram={diagram} caption="Generated from the recorded geometry and phase data. Schematic, not a construction drawing."/>

    {lifts.length?<AppCard title="Show one lift in detail">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <TouchableOpacity style={[styles.chip,!selectedLiftId&&styles.chipOn]} onPress={()=>setSelectedLiftId(null)}
          accessibilityRole="button" accessibilityState={{selected:!selectedLiftId}} accessibilityLabel="Show all lifts without a detail panel">
          <Text style={[styles.chipText,!selectedLiftId&&styles.chipTextOn]}>All lifts</Text>
        </TouchableOpacity>
        {lifts.map(lift=><TouchableOpacity key={lift.id} style={[styles.chip,selectedLiftId===lift.id&&styles.chipOn]}
          onPress={()=>setSelectedLiftId(lift.id)} accessibilityRole="button" accessibilityState={{selected:selectedLiftId===lift.id}}
          accessibilityLabel={`Show lift ${lift.sequence}, ${lift.reference}, in detail`}>
          <Text style={[styles.chipText,selectedLiftId===lift.id&&styles.chipTextOn]}>{lift.sequence}</Text>
        </TouchableOpacity>)}
      </ScrollView>
    </AppCard>:<Text style={styles.detail}>No lifts recorded yet. Add a lift to start the drawing.</Text>}
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  chips:{gap:8,paddingVertical:2},
  chip:{minWidth:48,minHeight:44,alignItems:'center',justifyContent:'center',paddingHorizontal:12,borderWidth:1,borderColor:colors.line,borderRadius:radius.pill,backgroundColor:colors.surface},
  chipOn:{borderColor:colors.result,backgroundColor:colors.resultSoft},
  chipText:{color:colors.muted,fontSize:13,fontWeight:'900'},
  chipTextOn:{color:colors.resultDark},
});
