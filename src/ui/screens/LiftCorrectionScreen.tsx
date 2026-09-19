import {useCallback,useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import type {ConstructionLiftRepository} from '../../data/repositories/ConstructionLiftRepository';
import {calculateVolumeSnapshot,validateConstructionLiftDraft,type ConstructionLift} from '../../domain/wallConstructionLift';
import {formatCubicMetres} from '../../domain/walls';
import {AppButton,AppCard,AppField,Feedback,PageHeader} from '../components/AppPrimitives';
import {emptyLiftVolumeForm,LiftVolumeCalculator,liftVolumeDimensionsFrom,liftVolumeFormFrom,type LiftVolumeForm} from '../components/LiftVolumeCalculator';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {colors} from '../theme';

/**
 * DEC-469. The reasoned correction of a lift's own identity, elevation, geometry and notes.
 *
 * `correctLift` existed in the repository from Phase 2 and was covered by repository tests, but no
 * screen ever called it, so on the device a lift could not be corrected at all and History was
 * permanently empty. A reason is mandatory, exactly as it is for every other corrected record in the
 * app, and the repository writes the field-level before/after diff into the lift's correction history.
 * Recorded Stone and concrete quantities are not edited here: those belong to their own phase editors.
 */
export function LiftCorrectionScreen({repository,liftId,trail,onBack,onCorrected}:{
  repository:ConstructionLiftRepository;liftId:string;trail:string[];onBack:()=>void;onCorrected:()=>void;
}){
  const[lift,setLift]=useState<ConstructionLift|null>(null);
  const[reference,setReference]=useState('');
  const[startElevation,setStartElevation]=useState('');
  const[geometry,setGeometry]=useState<LiftVolumeForm>(emptyLiftVolumeForm());
  const[notes,setNotes]=useState('');
  const[correctionReason,setCorrectionReason]=useState('');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);

  const refresh=useCallback(async()=>{
    const found=await repository.getLift(liftId);
    if(!found)throw new Error('Lift was not found.');
    setLift(found);
    setReference(found.reference);
    setStartElevation(String(found.startElevationM));
    setGeometry(liftVolumeFormFrom(calculateVolumeSnapshot(found.geometry)));
    setNotes(found.notes);
  },[repository,liftId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this lift.'));},[refresh]);

  if(!lift)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  const dimensions=liftVolumeDimensionsFrom(geometry);
  const elevation=Number(startElevation.trim().replace(',','.'));
  const volume=calculateVolumeSnapshot(dimensions);
  const issues=[
    ...validateConstructionLiftDraft({reference,geometry:dimensions,sequence:lift.sequence}),
    ...(Number.isFinite(elevation)?[]:['Start elevation must be a number.']),
  ];

  async function save(){
    setBusy(true);setError(null);
    try{
      await repository.correctLift(liftId,{reference,startElevationM:elevation,geometry:dimensions,notes,correctionReason});
      onCorrected();
    }catch(cause){setError(cause instanceof Error?cause.message:'The correction could not be saved.');}
    finally{setBusy(false);}
  }

  return <View style={styles.screen}>
    <PageHeader eyebrow="CORRECT LIFT" title={lift.reference} onBack={onBack}/>
    <ParentContextHeader trail={[...trail,'Correction']}/>
    {error?<Feedback kind="error">{error}</Feedback>:null}

    <AppCard title="Why is this being corrected?" hint="The reason and the before/after values are kept in this lift's history.">
      <AppField label="Correction reason *" value={correctionReason} onChangeText={setCorrectionReason} multiline placeholder="Example: re-measured on site"/>
    </AppCard>

    <AppCard title="Lift identity">
      <AppField label="Lift reference or name *" value={reference} onChangeText={setReference}/>
      <AppField label="Start elevation (m)" value={startElevation} onChangeText={setStartElevation} keyboardType="decimal-pad"/>
    </AppCard>

    <AppCard title="Lift structural geometry" hint="The lift's own envelope. Recorded Stone and concrete quantities are corrected in their own phase screens.">
      <LiftVolumeCalculator label="Lift geometry" helper="Length × height × average thickness, less deductions." value={geometry} onChange={setGeometry} resultLabel="Net lift volume"/>
      <Text style={styles.detail}>Currently recorded: {formatCubicMetres(lift.netLiftVolumeM3)} · corrected to {formatCubicMetres(volume.netVolumeM3)}</Text>
    </AppCard>

    <AppField label="Lift notes" value={notes} onChangeText={setNotes} multiline/>

    {issues.length?<View accessibilityLiveRegion="polite">{issues.map(issue=><Text key={issue} style={styles.error}>{issue}</Text>)}</View>:null}
    <AppButton label="Save Correction" tone="navy" busy={busy} disabled={!correctionReason.trim()||issues.length>0} onPress={()=>void save()}/>
    <AppButton label="Cancel" tone="secondary" onPress={onBack}/>
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  error:{color:colors.danger,fontSize:12,fontWeight:'800',lineHeight:17},
});
