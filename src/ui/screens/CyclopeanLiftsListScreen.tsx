import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {CyclopeanLiftRepository} from '../../data/repositories/CyclopeanLiftRepository';
import {deriveLiftStatus,type CyclopeanLift, type CyclopeanLiftParentType} from '../../domain/wallCyclopeanLift';
import {formatCubicMetres} from '../../domain/walls';
import {AppButton,AppCard,AppField,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {emptyLiftVolumeForm,LiftVolumeCalculator,liftVolumeDimensionsFrom,type LiftVolumeForm} from '../components/LiftVolumeCalculator';
import {LiftStatusPill} from '../components/LiftStatusPill';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors,radius} from '../theme';

/**
 * DEC-466. One list-and-editor entry point shared by a foundation's lifts and a wall's lifts -- the
 * only difference between the two is which parent id is passed in, never a second copy of the
 * calculation or validation logic (both live in domain/wallCyclopeanLift.ts).
 */
export function CyclopeanLiftsListScreen({repository,parentType,parentId,trail,onBack,onOpenStone,onOpenConcrete}:{
  repository:CyclopeanLiftRepository;parentType:CyclopeanLiftParentType;parentId:string;trail:string[];onBack:()=>void;
  onOpenStone:(liftId:string,reference:string)=>void;onOpenConcrete:(liftId:string,reference:string)=>void;
}){
  const[lifts,setLifts]=useState<CyclopeanLift[]|null>(null);
  const[adding,setAdding]=useState(false);
  const[reference,setReference]=useState('');
  const[startElevation,setStartElevation]=useState('0');
  const[geometry,setGeometry]=useState<LiftVolumeForm>(emptyLiftVolumeForm());
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const next=parentType==='foundation'?await repository.listLiftsForFoundation(parentId):await repository.listLiftsForWall(parentId);
    setLifts(next);
  },[repository,parentType,parentId]);

  useEffect(()=>{void refresh();},[refresh]);

  const nextSequence=(lifts?.length??0)+1;

  async function addLift(){
    setBusy(true);setError(null);
    try{
      const created=await repository.createLift({parentType,parentId,sequence:nextSequence,reference:reference.trim(),startElevationM:Number(startElevation)||0,geometry:liftVolumeDimensionsFrom(geometry),notes:''});
      setAdding(false);setReference('');setGeometry(emptyLiftVolumeForm());
      await refresh();
      onOpenStone(created.id,created.reference);
    }catch(cause){setError(cause instanceof Error?cause.message:'The lift could not be created.');}
    finally{setBusy(false);}
  }

  return <View style={styles.screen}>
    <PageHeader eyebrow="CYCLOPEAN LIFTS" title={parentType==='foundation'?'Foundation Lifts':'Wall Lifts'} onBack={onBack}/>
    <ParentContextHeader trail={trail}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {lifts===null?<Text style={styles.detail} accessibilityLiveRegion="polite">Loading…</Text>:lifts.length===0?
      <EmptyState title="No lifts recorded yet" body="A cyclopean lift is one Stone placement phase followed by its concrete matrix fill. Add the first lift to begin."/>:
      lifts.map(lift=><LiftRow key={lift.id} lift={lift} onOpenStone={()=>onOpenStone(lift.id,lift.reference)} onOpenConcrete={()=>onOpenConcrete(lift.id,lift.reference)}/>)}

    {adding?<AppCard title={`Add Lift ${nextSequence}`}>
      <AppField label="Lift reference/name *" value={reference} onChangeText={setReference} placeholder={`Example: Lift ${nextSequence}`}/>
      <AppField label="Start elevation (m)" value={startElevation} onChangeText={setStartElevation} keyboardType="decimal-pad"/>
      <LiftVolumeCalculator label="Lift structural geometry" helper="Length × height × average thickness, less deductions." value={geometry} onChange={setGeometry} resultLabel="Net lift volume"/>
      <View style={styles.row}>
        <AppButton label="Save Lift" tone="navy" busy={busy} disabled={!reference.trim()} onPress={()=>void addLift()}/>
        <AppButton label="Cancel" tone="secondary" onPress={()=>setAdding(false)}/>
      </View>
    </AppCard>:<AppButton label="+ Add Cyclopean Lift" tone="secondary" onPress={()=>setAdding(true)}/>}
  </View>;
}

function LiftRow({lift,onOpenStone,onOpenConcrete}:{lift:CyclopeanLift;onOpenStone:()=>void;onOpenConcrete:()=>void}){
  const status=deriveLiftStatus(lift);
  const primary=status==='planned'?{label:'Record Stone Phase',onPress:onOpenStone}:status==='stone_placed'?{label:'Continue to Concrete Matrix',onPress:onOpenConcrete}:{label:'Review Lift',onPress:onOpenStone};
  return <View style={styles.card}>
    <View style={styles.cardHead}>
      <Text style={styles.cardTitle}>{lift.reference}</Text>
      <LiftStatusPill status={status}/>
    </View>
    <Text style={styles.detail}>Elevation {lift.startElevationM} m · structural volume {formatCubicMetres(lift.netLiftVolumeM3)}</Text>
    <Text style={styles.detail}>Stone {formatCubicMetres(lift.stonePhase.calculatedStoneVolumeM3)}{lift.stonePhase.actualStoneQuantityM3!=null?` · actual ${formatCubicMetres(lift.stonePhase.actualStoneQuantityM3)}`:''}</Text>
    <Text style={styles.detail}>Concrete {lift.concretePhase?`estimate ${formatCubicMetres(lift.concretePhase.estimatedMatrixVolumeM3)}${lift.concretePhase.actualReadyMixQuantityM3!=null?` · actual ${formatCubicMetres(lift.concretePhase.actualReadyMixQuantityM3)}`:''}`:'Not started'}</Text>
    <TouchableOpacity style={styles.action} onPress={primary.onPress} accessibilityRole="button"><Text style={styles.actionText}>{primary.label}</Text></TouchableOpacity>
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  row:{flexDirection:'row',gap:10},
  card:{backgroundColor:colors.surface,borderRadius:radius.md,padding:13,gap:4,borderLeftWidth:4,borderLeftColor:colors.navy},
  cardHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:8},
  cardTitle:{color:colors.ink,fontSize:15,fontWeight:'900'},
  action:{minHeight:44,justifyContent:'center',alignSelf:'flex-start',marginTop:4},
  actionText:{color:colors.navy,fontSize:13,fontWeight:'900'},
});
