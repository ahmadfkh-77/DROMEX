import {useCallback,useEffect,useState} from 'react';
import {AppPage} from '../components/AppPrimitives';
import type {CyclopeanLiftRepository} from '../../data/repositories/CyclopeanLiftRepository';
import type {WallRepository} from '../../data/repositories/WallRepository';
import type {ConstructionSection} from '../../domain/constructionSections';
import type {Foundation} from '../../domain/foundations';
import {ConcreteMatrixEditorScreen} from './ConcreteMatrixEditorScreen';
import {CyclopeanLiftsListScreen} from './CyclopeanLiftsListScreen';
import {FoundationCuringScreen} from './FoundationCuringScreen';
import {FoundationDiagramScreen} from './FoundationDiagramScreen';
import {FoundationGeometryScreen} from './FoundationGeometryScreen';
import {FoundationOverviewScreen} from './FoundationOverviewScreen';
import {FoundationSummaryScreen} from './FoundationSummaryScreen';
import {HistoryAndCorrectionsScreen} from './HistoryAndCorrectionsScreen';
import {StoneLiftEditorScreen} from './StoneLiftEditorScreen';
import {WallGeometryScreen} from './WallGeometryScreen';
import {WallLinkOrCreateScreen} from './WallLinkOrCreateScreen';
import {WallMaterialsScreen} from './WallMaterialsScreen';
import {WallOverviewScreen} from './WallOverviewScreen';

type LiftContext={liftId:string;reference:string;parentType:'foundation'|'wall'};
type View=
  |{kind:'overview'}|{kind:'geometry'}|{kind:'lifts'}|{kind:'summary'}|{kind:'curing'}|{kind:'history'}|{kind:'diagram'}
  |{kind:'wall'}|{kind:'wallGeometry'}|{kind:'wallLifts'}|{kind:'wallMaterials'}|{kind:'wallHistory'}
  |{kind:'stoneEditor';lift:LiftContext}|{kind:'concreteEditor';lift:LiftContext};

/**
 * DEC-466. Replaces the old single-page, stepper-with-inline-forms Foundation workspace: one focused
 * screen per purpose, reached through explicit navigation actions rather than a tab that mixes
 * geometry, materials, curing, wall, and history together. Uses the app's existing local-state
 * navigation convention -- no router package is added.
 */
export function FoundationConstructionNavigator({repository,liftRepository,foundationId,section,onBack,onChanged}:{
  repository:WallRepository;liftRepository:CyclopeanLiftRepository;foundationId:string;section:ConstructionSection|null;onBack:()=>void;onChanged?:()=>void;
}){
  const[view,setView]=useState<View>({kind:'overview'});
  const[foundation,setFoundation]=useState<Foundation|null>(null);
  const[wallId,setWallId]=useState<string|null>(null);

  const refreshWallLink=useCallback(async()=>{
    const found=await repository.getFoundation(foundationId);
    if(!found)return;
    setFoundation(found);
    const allWalls=await repository.listWalls(found.projectId);
    setWallId(allWalls.find(value=>value.foundationId===foundationId)?.id??null);
  },[repository,foundationId]);

  useEffect(()=>{void refreshWallLink();},[refreshWallLink]);

  const baseTrail=[section?.name,foundation?.reference].filter((value):value is string=>!!value);
  const notify=()=>{onChanged?.();void refreshWallLink();};

  if(view.kind==='overview')return <AppPage keyboard><FoundationOverviewScreen repository={repository} liftRepository={liftRepository} foundationId={foundationId} section={section} trail={baseTrail} onBack={onBack}
    onOpenGeometry={()=>setView({kind:'geometry'})} onOpenLifts={()=>setView({kind:'lifts'})} onOpenCuring={()=>setView({kind:'curing'})}
    onOpenHistory={()=>setView({kind:'history'})} onOpenWall={()=>setView({kind:'wall'})} onOpenSummary={()=>setView({kind:'summary'})}
    onOpenDiagram={()=>setView({kind:'diagram'})}/></AppPage>;

  if(view.kind==='diagram')return <AppPage keyboard><FoundationDiagramScreen repository={repository} liftRepository={liftRepository} foundationId={foundationId} section={section} trail={baseTrail} onBack={()=>setView({kind:'overview'})}/></AppPage>;

  if(view.kind==='geometry')return <AppPage keyboard><FoundationGeometryScreen repository={repository} foundationId={foundationId} trail={baseTrail} onBack={()=>setView({kind:'overview'})} onChanged={notify}/></AppPage>;

  if(view.kind==='lifts')return <AppPage keyboard><CyclopeanLiftsListScreen repository={liftRepository} parentType="foundation" parentId={foundationId} trail={[...baseTrail,'Cyclopean Lifts']} onBack={()=>setView({kind:'overview'})}
    onOpenStone={(liftId,reference)=>setView({kind:'stoneEditor',lift:{liftId,reference,parentType:'foundation'}})}
    onOpenConcrete={(liftId,reference)=>setView({kind:'concreteEditor',lift:{liftId,reference,parentType:'foundation'}})}/></AppPage>;

  if(view.kind==='summary')return <AppPage keyboard><FoundationSummaryScreen repository={repository} liftRepository={liftRepository} foundationId={foundationId} trail={baseTrail} onBack={()=>setView({kind:'overview'})}/></AppPage>;

  if(view.kind==='curing')return <AppPage keyboard><FoundationCuringScreen repository={repository} foundationId={foundationId} trail={baseTrail} onBack={()=>setView({kind:'overview'})} onChanged={notify}/></AppPage>;

  if(view.kind==='history')return <AppPage keyboard><HistoryAndCorrectionsScreen liftRepository={liftRepository} wallRepository={repository} parentType="foundation" parentId={foundationId} trail={baseTrail} onBack={()=>setView({kind:'overview'})}/></AppPage>;

  if(view.kind==='wall'){
    if(!wallId&&foundation)return <AppPage keyboard><WallLinkOrCreateScreen repository={repository} foundation={foundation} trail={baseTrail} onBack={()=>setView({kind:'overview'})} onLinked={id=>{setWallId(id);notify();setView({kind:'wallGeometry'});}}/></AppPage>;
    if(wallId)return <AppPage keyboard><WallOverviewScreen repository={repository} liftRepository={liftRepository} wallId={wallId} trail={[...baseTrail,'Wall']} onBack={()=>setView({kind:'overview'})}
      onOpenGeometry={()=>setView({kind:'wallGeometry'})} onOpenLifts={()=>setView({kind:'wallLifts'})} onOpenMaterials={()=>setView({kind:'wallMaterials'})} onOpenHistory={()=>setView({kind:'wallHistory'})}/></AppPage>;
    return null;
  }

  if(view.kind==='wallGeometry'&&wallId)return <AppPage keyboard><WallGeometryScreen repository={repository} wallId={wallId} trail={[...baseTrail,'Wall']} onBack={()=>setView({kind:'wall'})}/></AppPage>;

  if(view.kind==='wallLifts'&&wallId)return <AppPage keyboard><CyclopeanLiftsListScreen repository={liftRepository} parentType="wall" parentId={wallId} trail={[...baseTrail,'Wall','Cyclopean Lifts']} onBack={()=>setView({kind:'wall'})}
    onOpenStone={(liftId,reference)=>setView({kind:'stoneEditor',lift:{liftId,reference,parentType:'wall'}})}
    onOpenConcrete={(liftId,reference)=>setView({kind:'concreteEditor',lift:{liftId,reference,parentType:'wall'}})}/></AppPage>;

  if(view.kind==='wallMaterials'&&wallId)return <AppPage keyboard><WallMaterialsScreen repository={repository} wallId={wallId} trail={[...baseTrail,'Wall']} onBack={()=>setView({kind:'wall'})}/></AppPage>;

  if(view.kind==='wallHistory'&&wallId)return <AppPage keyboard><HistoryAndCorrectionsScreen liftRepository={liftRepository} wallRepository={repository} parentType="wall" parentId={wallId} trail={[...baseTrail,'Wall']} onBack={()=>setView({kind:'wall'})}/></AppPage>;

  if(view.kind==='stoneEditor')return <AppPage keyboard><StoneLiftEditorScreen repository={liftRepository} liftId={view.lift.liftId}
    trail={[...baseTrail,...(view.lift.parentType==='wall'?['Wall']:[]),'Cyclopean Lifts',view.lift.reference]}
    onBack={()=>setView(view.lift.parentType==='wall'?{kind:'wallLifts'}:{kind:'lifts'})}
    onContinueToConcrete={liftId=>setView({kind:'concreteEditor',lift:{...view.lift,liftId}})}/></AppPage>;

  if(view.kind==='concreteEditor')return <AppPage keyboard><ConcreteMatrixEditorScreen repository={liftRepository} liftId={view.lift.liftId}
    trail={[...baseTrail,...(view.lift.parentType==='wall'?['Wall']:[]),'Cyclopean Lifts',view.lift.reference]}
    onBack={()=>setView(view.lift.parentType==='wall'?{kind:'wallLifts'}:{kind:'lifts'})}
    onSaved={()=>setView(view.lift.parentType==='wall'?{kind:'wallLifts'}:{kind:'lifts'})}/></AppPage>;

  return null;
}
