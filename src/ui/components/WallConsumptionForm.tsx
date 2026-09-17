import {useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {calculateRebar,parseWallAreaInput,supportsCoveredArea,wallMaterialLabels,type MaterialUnit,type SavedConcretePurpose,type WallConsumption,type WallConsumptionDraft,type WallMaterialType} from '../../domain/walls';
import {colors,radius} from '../theme';
import {AppButton,AppField,MetricCard} from './AppPrimitives';
import {ConcretePurposeField,type PurposeSelection} from './ConcretePurposeField';
import {DatePickerField} from './DatePickerField';
import {emptyWallAreaForm,WallAreaCalculator,type WallAreaForm} from './WallAreaCalculator';

export type WallUseForm={type:WallMaterialType;usedOn:string;purpose:PurposeSelection|null;volume:string;bags:string;bagKg:string;sand:string;sandUnit:MaterialUnit;gravel:string;gravelUnit:MaterialUnit;water:string;admixture:string;admixtureUnit:'litres'|'kg';stone:string;stoneUnit:MaterialUnit;diameter:string;bars:string;lengthEach:string;grade:string;notes:string;area:WallAreaForm;reason:string};

const today=()=>new Date().toISOString().slice(0,10);
const n=(value:string)=>{const parsed=Number(value.replace(',','.'));return Number.isFinite(parsed)?parsed:0;};
const opt=(value:string)=>value.trim()?n(value):null;
const str=(value:number|null)=>value==null?'':String(value);
const materialOptions:{id:WallMaterialType;label:string}[]=[{id:'ready_mix',label:'Ready-mix m³'},{id:'site_mix',label:'Site-mixed'},{id:'rebar',label:'Steel rebar'},{id:'stone',label:'Stone'}];

export const emptyWallUseForm=(usedOn=today()):WallUseForm=>({type:'ready_mix',usedOn,purpose:{kind:'builtin',id:'structural'},volume:'',bags:'',bagKg:'50',sand:'',sandUnit:'m3',gravel:'',gravelUnit:'m3',water:'',admixture:'',admixtureUnit:'litres',stone:'',stoneUnit:'m3',diameter:'12',bars:'',lengthEach:'12',grade:'',notes:'',area:emptyWallAreaForm(),reason:''});

/** Prefills a correction with exactly what the record stores today. */
export function wallUseFormFromEntry(entry:WallConsumption):WallUseForm{
  return{...emptyWallUseForm(entry.usedOn),type:entry.type,
    purpose:entry.concretePurpose?{kind:'builtin',id:entry.concretePurpose}:entry.customPurposeId?{kind:'custom',id:entry.customPurposeId}:null,
    volume:str(entry.finishedVolumeM3),bags:str(entry.cementBags),bagKg:str(entry.cementBagKg),sand:str(entry.sandQuantity),sandUnit:entry.sandUnit??'m3',gravel:str(entry.gravelQuantity),gravelUnit:entry.gravelUnit??'m3',
    water:str(entry.waterLitres),admixture:str(entry.admixtureQuantity),admixtureUnit:entry.admixtureUnit??'litres',stone:str(entry.stoneQuantity),stoneUnit:entry.stoneUnit??'m3',
    diameter:str(entry.rebarDiameterMm),bars:str(entry.rebarCount),lengthEach:str(entry.rebarLengthEachM),grade:entry.rebarGrade,notes:entry.notes,
    area:entry.area?{enabled:true,length:String(entry.area.lengthM),height:String(entry.area.heightM),deduction:String(entry.area.deductionM2)}:emptyWallAreaForm()};
}

/** Converts the form into a repository draft. Throws the first covered-area problem so it is shown beside the action. */
export function wallDraftFromForm(form:WallUseForm,wallId:string):WallConsumptionDraft{
  const concrete=form.type==='ready_mix'||form.type==='site_mix',site=form.type==='site_mix';
  let area:WallConsumptionDraft['area']=null;
  if(supportsCoveredArea(form.type)&&form.area.enabled){const parsed=parseWallAreaInput(form.area);if(!parsed.snapshot)throw new Error(parsed.issues[0]??'Check the covered wall area.');area={lengthM:parsed.snapshot.lengthM,heightM:parsed.snapshot.heightM,deductionM2:parsed.snapshot.deductionM2};}
  return{wallId,usedOn:form.usedOn,type:form.type,
    concretePurpose:concrete&&form.purpose?.kind==='builtin'?form.purpose.id:null,customPurposeId:concrete&&form.purpose?.kind==='custom'?form.purpose.id:null,
    finishedVolumeM3:concrete?opt(form.volume):null,cementBags:site?opt(form.bags):null,cementBagKg:site?opt(form.bagKg):null,
    sandQuantity:site?opt(form.sand):null,sandUnit:site&&form.sand.trim()?form.sandUnit:null,gravelQuantity:site?opt(form.gravel):null,gravelUnit:site&&form.gravel.trim()?form.gravelUnit:null,
    waterLitres:site?opt(form.water):null,admixtureQuantity:site?opt(form.admixture):null,admixtureUnit:site&&form.admixture.trim()?form.admixtureUnit:null,
    stoneQuantity:form.type==='stone'?opt(form.stone):null,stoneUnit:form.type==='stone'?form.stoneUnit:null,
    rebarDiameterMm:form.type==='rebar'?opt(form.diameter):null,rebarCount:form.type==='rebar'?opt(form.bars):null,rebarLengthEachM:form.type==='rebar'?opt(form.lengthEach):null,rebarGrade:form.type==='rebar'?form.grade:'',
    notes:form.notes,area};
}

/**
 * Records a new consumption or corrects an existing one. Values stay in the form after a failed save;
 * the error appears directly above the action that failed.
 */
export function WallConsumptionForm({mode,initial,savedPurposes,onCreatePurpose,onSubmit,onDiscard}:{mode:'add'|'correct';initial:WallUseForm;savedPurposes:SavedConcretePurpose[];onCreatePurpose:(label:string)=>Promise<SavedConcretePurpose>;onSubmit:(form:WallUseForm)=>Promise<void>;onDiscard?:()=>void}){
  const[form,setForm]=useState<WallUseForm>(initial),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const correcting=mode==='correct';
  const set=(patch:Partial<WallUseForm>)=>{setForm(current=>({...current,...patch}));setError(null);};
  const changeType=(type:WallMaterialType)=>set({...emptyWallUseForm(form.usedOn),type,notes:form.notes,reason:form.reason,purpose:type==='ready_mix'||type==='site_mix'?form.purpose??{kind:'builtin',id:'structural'}:null,area:supportsCoveredArea(type)?form.area:emptyWallAreaForm()});
  const rebarPreview=form.type==='rebar'&&n(form.diameter)>0&&n(form.bars)>0&&n(form.lengthEach)>0?calculateRebar(n(form.diameter),n(form.bars),n(form.lengthEach)):null;

  async function submit(){
    if(correcting&&!form.reason.trim()){setError('A correction reason is required.');return;}
    setBusy(true);setError(null);
    try{await onSubmit(form);if(!correcting)setForm(current=>emptyWallUseForm(current.usedOn));}
    catch(cause){setError(cause instanceof Error?cause.message:'The wall consumption could not be saved.');}
    finally{setBusy(false);}
  }

  return <View style={styles.form}>
    <DatePickerField label="Used on *" value={form.usedOn} onChange={usedOn=>set({usedOn})}/>
    <View style={styles.group}>
      <Text style={styles.groupLabel}>Material *</Text>
      <View style={styles.types} accessibilityRole="radiogroup" accessibilityLabel="Material">
        {materialOptions.map(option=>{const on=form.type===option.id;return <TouchableOpacity key={option.id} style={[styles.type,on&&styles.typeOn]} onPress={()=>changeType(option.id)} accessibilityRole="radio" accessibilityState={{checked:on}}><Text style={[styles.typeText,on&&styles.typeTextOn]}>{option.label}</Text></TouchableOpacity>;})}
      </View>
    </View>

    {form.type==='ready_mix'||form.type==='site_mix'?<>
      <ConcretePurposeField label="Concrete / mortar purpose *" value={form.purpose} saved={savedPurposes} onSelect={purpose=>set({purpose})} onCreate={onCreatePurpose}/>
      <AppField label={form.type==='ready_mix'?'Used concrete (m³) *':'Finished volume (m³) · optional'} value={form.volume} onChangeText={volume=>set({volume})} keyboardType="decimal-pad"/>
    </>:null}

    {form.type==='site_mix'?<>
      <Pair><AppField label="Cement bags" value={form.bags} onChangeText={bags=>set({bags})} keyboardType="decimal-pad"/><AppField label="Kilograms per bag" value={form.bagKg} onChangeText={bagKg=>set({bagKg})} keyboardType="decimal-pad"/></Pair>
      <QuantityWithUnit label="Sand consumed" value={form.sand} unit={form.sandUnit} onValue={sand=>set({sand})} onUnit={sandUnit=>set({sandUnit})}/>
      <QuantityWithUnit label="Gravel / aggregate consumed" value={form.gravel} unit={form.gravelUnit} onValue={gravel=>set({gravel})} onUnit={gravelUnit=>set({gravelUnit})}/>
      <Pair><AppField label="Water (L)" value={form.water} onChangeText={water=>set({water})} keyboardType="decimal-pad"/><AppField label={`Admixture (${form.admixtureUnit})`} value={form.admixture} onChangeText={admixture=>set({admixture})} keyboardType="decimal-pad"/></Pair>
      <UnitButtons label="Admixture unit" value={form.admixtureUnit} options={['litres','kg']} onChange={admixtureUnit=>set({admixtureUnit:admixtureUnit as 'litres'|'kg'})}/>
    </>:null}

    {form.type==='rebar'?<>
      <Pair><AppField label="Bar diameter (mm) *" value={form.diameter} onChangeText={diameter=>set({diameter})} keyboardType="decimal-pad"/><AppField label="Number of bars *" value={form.bars} onChangeText={bars=>set({bars})} keyboardType="number-pad"/></Pair>
      <Pair><AppField label="Length per bar (m) *" value={form.lengthEach} onChangeText={lengthEach=>set({lengthEach})} keyboardType="decimal-pad"/><AppField label="Grade / mark" value={form.grade} onChangeText={grade=>set({grade})}/></Pair>
      <View style={styles.metrics}><MetricCard label="Total rebar length" value={rebarPreview?`${rebarPreview.totalLengthM.toFixed(2)} m`:'Not calculated'} result/><MetricCard label="Calculated steel weight" value={rebarPreview?`${rebarPreview.totalKg.toFixed(1)} kg`:'Not calculated'} result/></View>
    </>:null}

    {form.type==='stone'?<QuantityWithUnit label="Stone consumed *" value={form.stone} unit={form.stoneUnit} onValue={stone=>set({stone})} onUnit={stoneUnit=>set({stoneUnit})}/>:null}

    {supportsCoveredArea(form.type)?<WallAreaCalculator value={form.area} onChange={area=>set({area})} materialLabel={wallMaterialLabels[form.type]}/>:null}

    <AppField label="Entry notes" value={form.notes} onChangeText={notes=>set({notes})} multiline/>
    {correcting?<AppField label="Correction reason *" value={form.reason} onChangeText={reason=>set({reason})} multiline placeholder="Example: delivery ticket re-checked"/>:null}

    {error?<Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">{error}</Text>:null}
    {correcting
      ?<View style={styles.actions}><AppButton label="Save Correction" tone="navy" busy={busy} onPress={()=>void submit()} hint="Keeps the record and adds the change to its correction history"/><AppButton label="Discard Correction" tone="secondary" disabled={busy} onPress={()=>onDiscard?.()}/></View>
      :<AppButton label="Record Wall Consumption" busy={busy} onPress={()=>void submit()}/>}
  </View>;
}

function Pair({children}:{children:React.ReactNode}){return <View style={styles.pair}>{Array.isArray(children)?children.map((child,index)=><View key={index} style={styles.half}>{child}</View>):children}</View>;}
function QuantityWithUnit({label,value,unit,onValue,onUnit}:{label:string;value:string;unit:MaterialUnit;onValue:(v:string)=>void;onUnit:(v:MaterialUnit)=>void}){return <View style={styles.quantity}><AppField label={label} value={value} onChangeText={onValue} keyboardType="decimal-pad"/><UnitButtons label={`${label.replace(' *','')} unit`} value={unit} options={['m3','tonnes']} onChange={v=>onUnit(v as MaterialUnit)}/></View>;}
function UnitButtons({label,value,options,onChange}:{label:string;value:string;options:string[];onChange:(value:string)=>void}){return <View style={styles.units} accessibilityRole="radiogroup" accessibilityLabel={label}>{options.map(option=>{const on=value===option;return <TouchableOpacity key={option} style={[styles.unit,on&&styles.unitOn]} onPress={()=>onChange(option)} accessibilityRole="radio" accessibilityState={{checked:on}}><Text style={[styles.unitText,on&&styles.unitTextOn]}>{option==='m3'?'m³':option}</Text></TouchableOpacity>;})}</View>;}

const styles=StyleSheet.create({
  form:{gap:12},
  group:{gap:6},
  groupLabel:{color:colors.ink,fontSize:13,fontWeight:'800'},
  types:{flexDirection:'row',flexWrap:'wrap',gap:7},
  type:{minWidth:'47%',flex:1,minHeight:46,justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:10,padding:11,alignItems:'center',backgroundColor:colors.surface},
  typeOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  typeText:{color:colors.muted,fontSize:12,fontWeight:'900'},
  typeTextOn:{color:'#FFF'},
  pair:{flexDirection:'row',gap:10},
  half:{flex:1,minWidth:0},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:8},
  quantity:{gap:7},
  units:{flexDirection:'row',gap:6},
  unit:{minHeight:44,justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:9,paddingHorizontal:16},
  unitOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  unitText:{color:colors.muted,fontWeight:'900',fontSize:12},
  unitTextOn:{color:'#FFF'},
  error:{color:colors.danger,backgroundColor:'#FCE8E6',borderRadius:radius.sm,padding:11,fontSize:13,fontWeight:'800',lineHeight:18},
  actions:{gap:10},
});
