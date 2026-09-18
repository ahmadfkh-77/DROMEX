import {useCallback,useEffect,useState} from 'react';
import {Alert,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {CyclopeanLiftRepository} from '../../data/repositories/CyclopeanLiftRepository';
import {calculateVolumeSnapshot,type CyclopeanLift} from '../../domain/wallCyclopeanLift';
import {formatCubicMetres} from '../../domain/walls';
import {AppButton,AppField,Feedback} from '../components/AppPrimitives';
import {DatePickerField} from '../components/DatePickerField';
import {emptyLiftVolumeForm,LiftVolumeCalculator,liftVolumeDimensionsFrom,liftVolumeFormFrom,type LiftVolumeForm} from '../components/LiftVolumeCalculator';
import {ParentContextHeader} from '../components/ParentContextHeader';
import {SaveContinueFooter} from '../components/SaveContinueFooter';
import {colors} from '../theme';

const today=()=>new Date().toISOString().slice(0,10);

/**
 * DEC-466. Stone only. No Ready Mix field appears here -- the concrete matrix phase is a separate,
 * dedicated screen reached only after this one is saved, so the two phases are never confused.
 */
export function StoneLiftEditorScreen({repository,liftId,trail,onBack,onContinueToConcrete}:{
  repository:CyclopeanLiftRepository;liftId:string;trail:string[];onBack:()=>void;onContinueToConcrete:(liftId:string)=>void;
}){
  const[lift,setLift]=useState<CyclopeanLift|null>(null);
  const[calculatorOn,setCalculatorOn]=useState(false);
  const[geometry,setGeometry]=useState<LiftVolumeForm>(emptyLiftVolumeForm());
  const[quantity,setQuantity]=useState('');
  const[manualOverride,setManualOverride]=useState(false);
  const[workDate,setWorkDate]=useState(today());
  const[notes,setNotes]=useState('');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[saved,setSaved]=useState(false);
  const[dirty,setDirty]=useState(false);

  const refresh=useCallback(async()=>{
    const found=await repository.getLift(liftId);
    if(!found)throw new Error('Cyclopean Lift was not found.');
    setLift(found);
    if(found.stonePhase.calculationSnapshot)setGeometry(liftVolumeFormFrom(found.stonePhase.calculationSnapshot));
    setCalculatorOn(!!found.stonePhase.calculationSnapshot);
    setQuantity(found.stonePhase.actualStoneQuantityM3==null?'':String(found.stonePhase.actualStoneQuantityM3));
    setManualOverride(found.stonePhase.manualOverride);
    setWorkDate(found.stonePhase.workDate??today());
    setNotes(found.stonePhase.notes);
    setDirty(false);
  },[repository,liftId]);

  useEffect(()=>{void refresh().catch(cause=>setError(cause instanceof Error?cause.message:'Could not load this lift.'));},[refresh]);

  if(!lift)return <View style={styles.screen}><Text style={styles.detail} accessibilityLiveRegion="polite">{error??'Loading…'}</Text></View>;

  const calculationDimensions=calculatorOn?liftVolumeDimensionsFrom(geometry):null;
  const calculatedVolume=calculationDimensions?calculateVolumeSnapshot(calculationDimensions).netVolumeM3:0;
  const useCalculated=()=>{setQuantity(String(calculatedVolume));setManualOverride(false);setDirty(true);};

  async function save(continueNext:boolean){
    setBusy(true);setError(null);
    try{
      await repository.saveStonePhase(liftId,{
        calculationDimensions,actualStoneQuantityM3:quantity.trim()?Number(quantity):null,manualOverride,workDate:workDate||null,
        position:lift!.stonePhase.position,offsets:lift!.stonePhase.offsets,notes,
      });
      setSaved(true);setDirty(false);
      if(continueNext)onContinueToConcrete(liftId);
    }catch(cause){setError(cause instanceof Error?cause.message:'The Stone phase could not be saved.');}
    finally{setBusy(false);}
  }

  /** Warn before abandoning unsaved changes, using RN's built-in Alert rather than adding a dialog dependency. */
  function goBack(){
    if(!dirty){onBack();return;}
    Alert.alert('Discard unsaved changes?','This Stone phase has changes that have not been saved.',[
      {text:'Keep Editing',style:'cancel'},
      {text:'Discard Changes',style:'destructive',onPress:onBack},
    ]);
  }

  return <View style={styles.screen}>
    <ParentContextHeader trail={[...trail,'Stone Phase']}/>
    <Text style={styles.title}>{lift.reference} · Stone Phase</Text>
    <Text style={styles.detail}>Lift structural volume {formatCubicMetres(lift.netLiftVolumeM3)}</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {saved?<Feedback kind="success">Stone phase saved.</Feedback>:null}

    {!calculatorOn?<TouchableOpacity style={styles.add} onPress={()=>{setCalculatorOn(true);setDirty(true);}} accessibilityRole="button">
      <Text style={styles.addText}>Calculate Stone volume from dimensions</Text>
    </TouchableOpacity>:<LiftVolumeCalculator label="Stone calculator" helper="Length × lift height × average thickness, less deductions." value={geometry} onChange={value=>{setGeometry(value);setDirty(true);}} resultLabel="Net Stone volume"/>}
    {calculatorOn?<AppButton label={`Use Calculated ${formatCubicMetres(calculatedVolume)}`} tone="secondary" onPress={useCalculated}/>:null}

    <AppField label="Final Stone quantity (m³) *" value={quantity} onChangeText={value=>{setQuantity(value);setManualOverride(true);setDirty(true);}} keyboardType="decimal-pad"/>
    {manualOverride?<Text style={styles.override}>Manual override -- differs from, or was entered without, the calculator.</Text>:null}
    <DatePickerField label="Stone work date" value={workDate} onChange={value=>{setWorkDate(value);setDirty(true);}}/>
    <AppField label="Notes" value={notes} onChangeText={value=>{setNotes(value);setDirty(true);}} multiline/>

    <SaveContinueFooter saveLabel="Save Stone Phase" busy={busy} disabled={!quantity.trim()} onSave={()=>void save(false)}
      continueLabel={saved?'Continue to Concrete Matrix':undefined} onContinue={saved?()=>onContinueToConcrete(liftId):undefined}/>
    {!saved?<AppButton label="Back" tone="secondary" onPress={goBack}/>:null}
  </View>;
}

const styles=StyleSheet.create({
  screen:{gap:10,padding:14},
  title:{color:colors.ink,fontSize:17,fontWeight:'900'},
  detail:{color:colors.muted,fontSize:12,lineHeight:17},
  override:{color:colors.warning,fontSize:12,fontWeight:'800'},
  add:{minHeight:48,justifyContent:'center',borderWidth:1,borderStyle:'dashed',borderColor:colors.result,borderRadius:12,paddingHorizontal:14,backgroundColor:'#F4FBFA'},
  addText:{color:colors.resultDark,fontSize:14,fontWeight:'900'},
});
