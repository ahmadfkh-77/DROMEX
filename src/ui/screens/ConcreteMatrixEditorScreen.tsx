import {useCallback,useEffect,useState} from 'react';
import {Alert,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {CyclopeanLiftRepository} from '../../data/repositories/CyclopeanLiftRepository';
import {
  calculateVolumeSnapshot, concreteMatrixVariance, estimatedConcreteMatrixVolume,
  type ConcreteCalculationMethod, type CyclopeanLift,
} from '../../domain/wallCyclopeanLift';
import {formatCubicMetres} from '../../domain/walls';
import {AppButton,AppField,Feedback} from '../components/AppPrimitives';
import {DatePickerField} from '../components/DatePickerField';
import {emptyLiftVolumeForm,LiftVolumeCalculator,liftVolumeDimensionsFrom,liftVolumeFormFrom,type LiftVolumeForm} from '../components/LiftVolumeCalculator';
import {LiftVarianceRow} from '../components/LiftVarianceRow';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {SaveContinueFooter} from '../components/SaveContinueFooter';
import {colors,radius} from '../theme';

const today=()=>new Date().toISOString().slice(0,10);

/**
 * DEC-466. Linked to the exact Stone lift it belongs to (by liftId, never by list position). Shows
 * the estimated matrix requirement alongside whichever calculation method is chosen, so the two
 * figures are always visible together rather than one silently replacing the other.
 */
export function ConcreteMatrixEditorScreen({repository,liftId,trail,onBack,onSaved}:{
  repository:CyclopeanLiftRepository;liftId:string;trail:string[];onBack:()=>void;onSaved:(liftId:string)=>void;
}){
  const[lift,setLift]=useState<CyclopeanLift|null>(null);
  const[method,setMethod]=useState<ConcreteCalculationMethod>('estimated_matrix');
  const[independent,setIndependent]=useState<LiftVolumeForm>(emptyLiftVolumeForm());
  const[quantity,setQuantity]=useState('');
  const[manualOverride,setManualOverride]=useState(false);
  const[purpose,setPurpose]=useState('structural');
  const[workDate,setWorkDate]=useState(today());
  const[notes,setNotes]=useState('');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[saved,setSaved]=useState(false);
  const[dirty,setDirty]=useState(false);

  const refresh=useCallback(async()=>{
    const found=await repository.getLift(liftId);
    if(!found)throw new Error('Cyclopean Lift was not found.');
    if(found.stonePhase.actualStoneQuantityM3==null&&found.stonePhase.workDate==null)throw new Error('Record this lift\'s Stone phase before its concrete matrix fill.');
    setLift(found);
    const phase=found.concretePhase;
    setMethod(phase?.calculationMethod??'estimated_matrix');
    if(phase?.independentCalculation)setIndependent(liftVolumeFormFrom(phase.independentCalculation));
    setQuantity(phase?.actualReadyMixQuantityM3==null?'':String(phase.actualReadyMixQuantityM3));
    setManualOverride(phase?.manualOverride??false);
    setPurpose(phase?.purpose||'structural');
    setWorkDate(phase?.workDate??today());
    setNotes(phase?.notes??'');
    setDirty(false);
  },[repository,liftId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this lift.'));},[refresh]);

  if(!lift)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  const estimatedMatrixVolumeM3=estimatedConcreteMatrixVolume(lift.netLiftVolumeM3,lift.stonePhase.calculatedStoneVolumeM3);
  const independentSnapshot=method==='independent'?calculateVolumeSnapshot(liftVolumeDimensionsFrom(independent)):null;
  const useEstimated=()=>{setMethod('estimated_matrix');setQuantity(String(estimatedMatrixVolumeM3));setManualOverride(false);setDirty(true);};
  const useIndependent=()=>{if(independentSnapshot){setQuantity(String(independentSnapshot.netVolumeM3));setManualOverride(false);setDirty(true);}};
  const variance=quantity.trim()?concreteMatrixVariance(method==='independent'&&independentSnapshot?independentSnapshot.netVolumeM3:estimatedMatrixVolumeM3,Number(quantity)):null;

  async function save(){
    setBusy(true);setError(null);
    try{
      await repository.saveConcreteMatrixPhase(liftId,{
        calculationMethod:method,independentDimensions:method==='independent'?liftVolumeDimensionsFrom(independent):null,
        actualReadyMixQuantityM3:quantity.trim()?Number(quantity):null,manualOverride,purpose,workDate:workDate||null,notes,
      });
      setSaved(true);setDirty(false);onSaved(liftId);
    }catch(cause){setError(cause instanceof Error?cause.message:'The concrete matrix phase could not be saved.');}
    finally{setBusy(false);}
  }

  /** Warn before abandoning unsaved changes, using RN's built-in Alert rather than adding a dialog dependency. */
  function goBack(){
    if(!dirty){onBack();return;}
    Alert.alert('Discard unsaved changes?','This concrete matrix fill has changes that have not been saved.',[
      {text:'Keep Editing',style:'cancel'},
      {text:'Discard Changes',style:'destructive',onPress:onBack},
    ]);
  }

  return <View style={styles.screen}>
    <ParentContextHeader trail={[...trail,'Concrete Fill']}/>
    <Text style={styles.title}>{lift.reference} · Concrete Matrix</Text>
    <Text style={styles.detail}>Lift structural volume {formatCubicMetres(lift.netLiftVolumeM3)} − Stone {formatCubicMetres(lift.stonePhase.calculatedStoneVolumeM3)} = estimated matrix {formatCubicMetres(estimatedMatrixVolumeM3)}</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {saved?<Feedback kind="success">Concrete fill saved. This lift is now complete.</Feedback>:null}

    <View style={styles.methods}>
      <MethodButton label="Use estimated matrix requirement" active={method==='estimated_matrix'} onPress={()=>{setMethod('estimated_matrix');setDirty(true);}}/>
      <MethodButton label="Calculate independently" active={method==='independent'} onPress={()=>{setMethod('independent');setDirty(true);}}/>
    </View>
    {method==='independent'?<LiftVolumeCalculator label="Independent Ready Mix calculator" helper="Length × fill height × average thickness, less deductions." value={independent} onChange={value=>{setIndependent(value);setDirty(true);}} resultLabel="Ready Mix volume"/>:null}

    <View style={styles.row}>
      {method==='estimated_matrix'?<AppButton label={`Use Estimated ${formatCubicMetres(estimatedMatrixVolumeM3)}`} tone="secondary" onPress={useEstimated}/>:
        <AppButton label={independentSnapshot?`Use Calculated ${formatCubicMetres(independentSnapshot.netVolumeM3)}`:'Enter dimensions above'} tone="secondary" disabled={!independentSnapshot} onPress={useIndependent}/>}
    </View>

    <AppField label="Final Ready Mix quantity (m³) *" value={quantity} onChangeText={value=>{setQuantity(value);setManualOverride(true);setDirty(true);}} keyboardType="decimal-pad"/>
    {manualOverride?<Text style={styles.override}>Manual override -- differs from, or was entered without, the selected method.</Text>:null}
    <LiftVarianceRow estimatedLabel="Estimated matrix requirement" estimatedM3={estimatedMatrixVolumeM3} actualLabel="Final Ready Mix" actualM3={quantity.trim()?Number(quantity):null} variance={variance}/>

    <AppField label="Purpose" value={purpose} onChangeText={value=>{setPurpose(value);setDirty(true);}} placeholder="Example: structural"/>
    <DatePickerField label="Concrete work date" value={workDate} onChange={value=>{setWorkDate(value);setDirty(true);}}/>
    <AppField label="Notes" value={notes} onChangeText={value=>{setNotes(value);setDirty(true);}} multiline/>

    <SaveContinueFooter saveLabel="Save Concrete Fill" busy={busy} disabled={!quantity.trim()} onSave={()=>void save()}/>
    {!saved?<AppButton label="Back" tone="secondary" onPress={goBack}/>:null}
  </View>;
}

function MethodButton({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}){
  return <TouchableOpacity style={[styles.method,active&&styles.methodOn]} onPress={onPress} accessibilityRole="radio" accessibilityState={{checked:active}}>
    <Text style={[styles.methodText,active&&styles.methodTextOn]}>{label}</Text>
  </TouchableOpacity>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  title:{color:colors.ink,fontSize:17,fontWeight:'900'},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  override:{color:colors.warning,fontSize:12,fontWeight:'800'},
  row:{flexDirection:'row',gap:10},
  methods:{gap:8},
  method:{minHeight:46,justifyContent:'center',borderRadius:radius.sm,borderWidth:1,borderColor:colors.line,paddingHorizontal:12,backgroundColor:colors.surface},
  methodOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  methodText:{color:colors.ink,fontSize:13,fontWeight:'800'},
  methodTextOn:{color:'#FFFFFF'},
});
