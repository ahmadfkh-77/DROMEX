import {useCallback,useEffect,useState} from 'react';
import {AppPage} from '../components/AppPrimitives';
import type {ConstructionLiftRepository} from '../../data/repositories/ConstructionLiftRepository';
import type {WallRepository} from '../../data/repositories/WallRepository';
import type {ConstructionSection} from '../../domain/constructionSections';
import type {Foundation} from '../../domain/foundations';
import {
  backView,currentView,initialFoundationViewStack,isRootView,popToView,pushView,
  type FoundationView,type FoundationViewKind,
} from '../navigation/foundationViewStack';
import {ConcreteMatrixEditorScreen} from './ConcreteMatrixEditorScreen';
import {ConstructionLiftsListScreen} from './ConstructionLiftsListScreen';
import {FoundationCuringScreen} from './FoundationCuringScreen';
import {FoundationDiagramScreen} from './FoundationDiagramScreen';
import {FoundationGeometryScreen} from './FoundationGeometryScreen';
import {FoundationOverviewScreen} from './FoundationOverviewScreen';
import {FoundationSummaryScreen} from './FoundationSummaryScreen';
import {HistoryAndCorrectionsScreen} from './HistoryAndCorrectionsScreen';
import {LiftCorrectionScreen} from './LiftCorrectionScreen';
import {StoneLiftEditorScreen} from './StoneLiftEditorScreen';
import {WallGeometryScreen} from './WallGeometryScreen';
import {WallLinkOrCreateScreen} from './WallLinkOrCreateScreen';
import {WallMaterialsScreen} from './WallMaterialsScreen';
import {WallOverviewScreen} from './WallOverviewScreen';

/**
 * DEC-466/469. Replaces the old single-page, stepper-with-inline-forms Foundation workspace: one
 * focused screen per purpose, reached through explicit navigation actions rather than a tab that mixes
 * geometry, materials, curing, wall, and history together. Uses the app's existing local-state
 * navigation convention -- no router package is added.
 *
 * DEC-469 replaced the previous hardcoded parents (every Back was `setView({kind:'overview'})` or
 * similar) with a real history stack, so Back retraces the path actually taken -- most visibly, the
 * Concrete Matrix editor now returns to the Stone phase it was opened from instead of jumping to the
 * lifts list. The stack rules live in navigation/foundationViewStack.ts and are unit-tested there.
 */
export function FoundationConstructionNavigator({repository,liftRepository,foundationId,section,onBack,onChanged}:{
  repository:WallRepository;liftRepository:ConstructionLiftRepository;foundationId:string;section:ConstructionSection|null;onBack:()=>void;onChanged?:()=>void;
}){
  const[stack,setStack]=useState<FoundationView[]>(initialFoundationViewStack);
  const[foundation,setFoundation]=useState<Foundation|null>(null);
  const[wallId,setWallId]=useState<string|null>(null);
  const view=currentView(stack);

  const open=(next:FoundationView)=>setStack(current=>pushView(current,next));
  const goBack=()=>{if(isRootView(stack))onBack();else setStack(current=>backView(current));};
  const returnTo=(kind:FoundationViewKind)=>setStack(current=>popToView(current,kind));

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

  if(view.kind==='overview')return <AppPage keyboard><FoundationOverviewScreen repository={repository} liftRepository={liftRepository} foundationId={foundationId} section={section} trail={baseTrail} onBack={goBack}
    onOpenGeometry={()=>open({kind:'geometry'})} onOpenLifts={()=>open({kind:'lifts'})} onOpenCuring={()=>open({kind:'curing'})}
    onOpenHistory={()=>open({kind:'history'})} onOpenWall={()=>open({kind:'wall'})} onOpenSummary={()=>open({kind:'summary'})}
    onOpenDiagram={()=>open({kind:'diagram'})}/></AppPage>;

  if(view.kind==='diagram')return <AppPage keyboard><FoundationDiagramScreen repository={repository} liftRepository={liftRepository} foundationId={foundationId} section={section} trail={baseTrail} onBack={goBack}/></AppPage>;

  if(view.kind==='geometry')return <AppPage keyboard><FoundationGeometryScreen repository={repository} foundationId={foundationId} trail={baseTrail} onBack={goBack} onChanged={notify}/></AppPage>;

  if(view.kind==='lifts')return <AppPage keyboard><ConstructionLiftsListScreen repository={liftRepository} parentType="foundation" parentId={foundationId} trail={[...baseTrail,'Lifts']} onBack={goBack}
    onOpenStone={(liftId,reference)=>open({kind:'stoneEditor',lift:{liftId,reference,parentType:'foundation'}})}
    onOpenConcrete={(liftId,reference)=>open({kind:'concreteEditor',lift:{liftId,reference,parentType:'foundation'}})}
    onCorrectLift={(liftId,reference)=>open({kind:'liftCorrection',lift:{liftId,reference,parentType:'foundation'}})}/></AppPage>;

  if(view.kind==='summary')return <AppPage keyboard><FoundationSummaryScreen repository={repository} liftRepository={liftRepository} foundationId={foundationId} trail={baseTrail} onBack={goBack}/></AppPage>;

  if(view.kind==='curing')return <AppPage keyboard><FoundationCuringScreen repository={repository} foundationId={foundationId} trail={baseTrail} onBack={goBack} onChanged={notify}/></AppPage>;

  if(view.kind==='history')return <AppPage keyboard><HistoryAndCorrectionsScreen liftRepository={liftRepository} wallRepository={repository} parentType="foundation" parentId={foundationId} trail={baseTrail} onBack={goBack}/></AppPage>;

  if(view.kind==='wall'){
    if(!wallId&&foundation)return <AppPage keyboard><WallLinkOrCreateScreen repository={repository} foundation={foundation} trail={baseTrail} onBack={goBack} onLinked={id=>{setWallId(id);notify();setStack(current=>pushView(current,{kind:'wallGeometry'}));}}/></AppPage>;
    if(wallId)return <AppPage keyboard><WallOverviewScreen repository={repository} liftRepository={liftRepository} wallId={wallId} trail={[...baseTrail,'Wall']} onBack={goBack}
      onOpenGeometry={()=>open({kind:'wallGeometry'})} onOpenLifts={()=>open({kind:'wallLifts'})} onOpenMaterials={()=>open({kind:'wallMaterials'})} onOpenHistory={()=>open({kind:'wallHistory'})}/></AppPage>;
    return null;
  }

  if(view.kind==='wallGeometry'&&wallId)return <AppPage keyboard><WallGeometryScreen repository={repository} wallId={wallId} trail={[...baseTrail,'Wall']} onBack={goBack}/></AppPage>;

  if(view.kind==='wallLifts'&&wallId)return <AppPage keyboard><ConstructionLiftsListScreen repository={liftRepository} parentType="wall" parentId={wallId} trail={[...baseTrail,'Wall','Lifts']} onBack={goBack}
    onOpenStone={(liftId,reference)=>open({kind:'stoneEditor',lift:{liftId,reference,parentType:'wall'}})}
    onOpenConcrete={(liftId,reference)=>open({kind:'concreteEditor',lift:{liftId,reference,parentType:'wall'}})}
    onCorrectLift={(liftId,reference)=>open({kind:'liftCorrection',lift:{liftId,reference,parentType:'wall'}})}/></AppPage>;

  if(view.kind==='wallMaterials'&&wallId)return <AppPage keyboard><WallMaterialsScreen repository={repository} wallId={wallId} trail={[...baseTrail,'Wall']} onBack={goBack}/></AppPage>;

  if(view.kind==='wallHistory'&&wallId)return <AppPage keyboard><HistoryAndCorrectionsScreen liftRepository={liftRepository} wallRepository={repository} parentType="wall" parentId={wallId} trail={[...baseTrail,'Wall']} onBack={goBack}/></AppPage>;

  const liftTrail=(lift:{parentType:'foundation'|'wall';reference:string})=>[...baseTrail,...(lift.parentType==='wall'?['Wall']:[]),'Lifts',lift.reference];
  const liftListKind=(lift:{parentType:'foundation'|'wall'}):FoundationViewKind=>lift.parentType==='wall'?'wallLifts':'lifts';

  if(view.kind==='stoneEditor')return <AppPage keyboard><StoneLiftEditorScreen repository={liftRepository} liftId={view.lift.liftId}
    trail={liftTrail(view.lift)} onBack={goBack}
    onContinueToConcrete={liftId=>open({kind:'concreteEditor',lift:{...view.lift,liftId}})}/></AppPage>;

  if(view.kind==='concreteEditor')return <AppPage keyboard><ConcreteMatrixEditorScreen repository={liftRepository} liftId={view.lift.liftId}
    trail={liftTrail(view.lift)} onBack={goBack}
    onSaved={()=>returnTo(liftListKind(view.lift))}/></AppPage>;

  if(view.kind==='liftCorrection')return <AppPage keyboard><LiftCorrectionScreen repository={liftRepository} liftId={view.lift.liftId}
    trail={liftTrail(view.lift)} onBack={goBack}
    onCorrected={()=>{notify();returnTo(liftListKind(view.lift));}}/></AppPage>;

  return null;
}
