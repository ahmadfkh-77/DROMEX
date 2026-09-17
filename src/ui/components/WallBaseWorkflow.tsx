import {useState} from 'react';
import {LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {baseStatusLabels,calculateBaseVolume,curingDays,validateWallBase,type BaseStatus,type BaseStatusChange,type WallBase,type WallBaseDraft} from '../../domain/wallBase';
import {formatCubicMetres,wallMaterialLabels,type SavedConcretePurpose,type Wall} from '../../domain/walls';
import {colors,radius} from '../theme';
import {AppButton,AppCard,AppField} from './AppPrimitives';
import {ConcretePurposeField,type PurposeSelection} from './ConcretePurposeField';
import {DatePickerField} from './DatePickerField';
import {useReducedMotion} from './ExpandableMenu';

export type BaseForm={reference:string;location:string;length:string;height:string;bottom:string;top:string;deduction:string;material:'ready_mix'|'site_mix'|'stone';purpose:PurposeSelection|null;quantity:string;quantityUnit:'m3'|'tonnes';manualOverride:boolean;consumptionDate:string;notes:string};
const today=()=>new Date().toISOString().slice(0,10);
const n=(value:string)=>{const parsed=Number(value.trim().replace(',','.'));return Number.isFinite(parsed)?parsed:Number.NaN;};
export const emptyBaseForm=(wall?:Pick<Wall,'lengthM'>|null):BaseForm=>({reference:'',location:'',length:wall?String(wall.lengthM):'',height:'',bottom:'',top:'',deduction:'0',material:'ready_mix',purpose:{kind:'builtin',id:'footing'},quantity:'',quantityUnit:'m3',manualOverride:false,consumptionDate:today(),notes:''});
export const baseFormFrom=(base:WallBase):BaseForm=>({reference:base.reference,location:base.location,length:String(base.lengthM),height:String(base.heightM),bottom:String(base.bottomThicknessM),top:String(base.topThicknessM),deduction:String(base.deductionM3),material:base.materialType,purpose:base.concretePurpose?{kind:'builtin',id:base.concretePurpose}:base.customPurposeId?{kind:'custom',id:base.customPurposeId}:null,quantity:base.quantity==null?'':String(base.quantity),quantityUnit:base.quantityUnit,manualOverride:base.manualOverride,consumptionDate:base.consumptionDate??today(),notes:base.notes});
export const baseDraftFrom=(form:BaseForm,wallId:string):WallBaseDraft=>({wallId,reference:form.reference,location:form.location,lengthM:n(form.length),heightM:n(form.height),bottomThicknessM:n(form.bottom),topThicknessM:n(form.top),deductionM3:form.deduction.trim()?n(form.deduction):0,materialType:form.material,concretePurpose:form.material!=='stone'&&form.purpose?.kind==='builtin'?form.purpose.id:null,customPurposeId:form.material!=='stone'&&form.purpose?.kind==='custom'?form.purpose.id:null,quantity:form.quantity.trim()?n(form.quantity):null,quantityUnit:form.quantityUnit,manualOverride:form.manualOverride,consumptionDate:form.consumptionDate,notes:form.notes});

const STAGES:{key:string;title:string}[]=[
  {key:'geometry',title:'Base geometry'},
  {key:'material',title:'Base material and volume'},
  {key:'curing',title:'Construction and curing'},
  {key:'wall',title:'Wall geometry and layers'},
];
const stageIndexFor=(base:WallBase|null)=>!base?0:base.status==='planned'?1:base.status==='cured'?3:2;

/**
 * DEC-459. Section A · Base and Wall Geometry. A wall section is built on a recorded base: its
 * geometry and material, then construction, curing, and an explicit cured confirmation, which is the
 * only thing that unlocks wall work. Nothing here cures a base because days have passed.
 */
export function WallBaseWorkflow({wall,base,legacy,savedPurposes,busy,onCreatePurpose,onSaveBase,onChangeStatus,onCorrectBase}:{
  wall:Wall;base:WallBase|null;legacy:boolean;savedPurposes:SavedConcretePurpose[];busy:boolean;
  onCreatePurpose:(label:string)=>Promise<SavedConcretePurpose>;onSaveBase:(draft:WallBaseDraft)=>Promise<void>;
  onChangeStatus:(change:BaseStatusChange)=>Promise<void>;onCorrectBase:(draft:WallBaseDraft,reason:string)=>Promise<void>;
}){
  const[form,setForm]=useState<BaseForm>(()=>base?baseFormFrom(base):emptyBaseForm(wall));
  const[editing,setEditing]=useState(!base);
  const[reason,setReason]=useState('');
  const[dates,setDates]=useState({constructedOn:today(),curingStartedOn:today(),curedOn:today()});
  const[inspected,setInspected]=useState(false);
  const[curingNote,setCuringNote]=useState('');
  const[error,setError]=useState<string|null>(null);
  const reducedMotion=useReducedMotion();
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};

  const draft=baseDraftFrom(form,wall.id);
  const geometryReady=[form.length,form.height,form.bottom,form.top].every(value=>Number.isFinite(n(value))&&n(value)>0);
  const volume=geometryReady?calculateBaseVolume(draft):null;
  const correcting=!!base&&editing;
  const issues=editing?validateWallBase({...draft,quantity:draft.quantity??(volume?volume.netVolumeM3:null)}):[];
  const stageIndex=stageIndexFor(base);
  const elapsed=base?curingDays(base,today()):null;

  const set=(patch:Partial<BaseForm>)=>{setForm(current=>({...current,...patch}));setError(null);};
  const useCalculated=()=>{if(volume)set({quantity:String(Number(volume.netVolumeM3.toFixed(3))),quantityUnit:'m3',manualOverride:false});};
  async function run(action:()=>Promise<void>){
    setError(null);
    try{await action();}catch(cause){setError(cause instanceof Error?cause.message:'The base could not be saved.');}
  }

  if(legacy&&!base)return <AppCard tone="cream" title="A · Base and Wall Geometry">
    <Text style={styles.legacy}>Base not recorded - legacy wall</Text>
    <Text style={styles.helper}>This wall was created before bases were recorded in DROMEX, so its wall records stay available as they are. You can record its base later if you want to.</Text>
    <AppButton label="Record This Wall's Base" tone="secondary" onPress={()=>{animate();setEditing(true);}}/>
    {editing?<BaseFields form={form} set={set} savedPurposes={savedPurposes} onCreatePurpose={onCreatePurpose} volume={volume} useCalculated={useCalculated} issues={issues} error={error} busy={busy} onSave={()=>void run(async()=>{await onSaveBase(draft);setEditing(false);})}/>:null}
  </AppCard>;

  return <AppCard tone="cream" title="A · Base and Wall Geometry" hint="The base is recorded and cured first; wall work follows on top of it.">
    <View style={styles.stepper} accessibilityRole="progressbar" accessibilityLabel={`Stage ${stageIndex+1} of ${STAGES.length}: ${STAGES[Math.min(stageIndex,STAGES.length-1)]!.title}`}>
      {STAGES.map((stage,index)=>{
        const state=index<stageIndex?'done':index===stageIndex?'current':'locked';
        return <View key={stage.key} style={[styles.step,state==='current'&&styles.stepCurrent,state==='done'&&styles.stepDone]}>
          <Text style={[styles.stepNumber,state!=='locked'&&styles.stepNumberOn]}>{state==='done'?'✓':index+1}</Text>
          <Text style={[styles.stepTitle,state==='locked'&&styles.stepLocked]} numberOfLines={2}>{stage.title}</Text>
        </View>;
      })}
    </View>

    {base&&base.status!=='cured'?<Text style={styles.lockBanner} accessibilityLiveRegion="polite">Wall construction locked until base is cured. The base is {baseStatusLabels[base.status].toLocaleLowerCase('en-US')}{elapsed!=null?`, ${elapsed} curing day${elapsed===1?'':'s'} so far`:''}.</Text>:null}
    {!base?<Text style={styles.lockBanner} accessibilityLiveRegion="polite">Wall construction locked until base is cured. Record the base geometry and material first.</Text>:null}

    {base&&!editing?<View style={styles.summary}>
      <Text style={styles.summaryTitle}>{base.reference}{base.location?` · ${base.location}`:''}</Text>
      <Text style={styles.summaryLine}>{base.lengthM} m × {base.heightM} m × {base.bottomThicknessM===base.topThicknessM?`${base.bottomThicknessM} m`:`${base.bottomThicknessM} to ${base.topThicknessM} m`}</Text>
      <Text style={styles.summaryLine}>Gross {formatCubicMetres(base.grossVolumeM3)} · deduction {formatCubicMetres(base.deductionM3)} · net {formatCubicMetres(base.netVolumeM3)}</Text>
      <Text style={styles.summaryLine}>Recorded {base.quantity==null?'not recorded':`${base.quantity} ${base.quantityUnit==='tonnes'?'t':'m³'}`}{base.manualOverride?' (manual override)':''} · {wallMaterialLabels[base.materialType]}</Text>
      <Text style={styles.summaryLine}>Status {baseStatusLabels[base.status]}{base.constructedOn?` · constructed ${base.constructedOn}`:''}{base.curingStartedOn?` · curing from ${base.curingStartedOn}`:''}{base.curedOn?` · cured ${base.curedOn}`:''}</Text>
      {base.correctionHistory.length?<Text style={styles.summaryLine}>{base.correctionHistory.length} correction{base.correctionHistory.length===1?'':'s'} recorded, latest: {base.correctionHistory.at(-1)!.reason}</Text>:null}
      <AppButton label="Correct Base Record" tone="secondary" onPress={()=>{animate();setEditing(true);}} hint="Opens the base prefilled; a reason is required"/>
    </View>:null}

    {editing?<>
      {correcting?<AppField label="Correction reason *" value={reason} onChangeText={setReason} multiline placeholder="Example: site survey re-measured"/>:null}
      <BaseFields form={form} set={set} savedPurposes={savedPurposes} onCreatePurpose={onCreatePurpose} volume={volume} useCalculated={useCalculated} issues={issues} error={error} busy={busy}
        onSave={()=>void run(async()=>{if(correcting)await onCorrectBase(draft,reason);else await onSaveBase(draft);setEditing(false);setReason('');})}/>
      {base?<AppButton label="Discard Changes" tone="secondary" onPress={()=>{animate();setForm(baseFormFrom(base));setEditing(false);setReason('');setError(null);}}/>:null}
    </>:null}

    {base&&!editing?<View style={styles.lifecycle}>
      {base.status==='planned'?<>
        <DatePickerField label="Construction / pour date *" value={dates.constructedOn} onChange={constructedOn=>setDates({...dates,constructedOn})}/>
        <AppButton label="Mark Base Constructed" tone="navy" busy={busy} onPress={()=>void run(()=>onChangeStatus({status:'constructed',constructedOn:dates.constructedOn}))}/>
      </>:null}
      {base.status==='constructed'?<>
        <DatePickerField label="Curing start date *" value={dates.curingStartedOn} onChange={curingStartedOn=>setDates({...dates,curingStartedOn})}/>
        <AppButton label="Start Curing" tone="navy" busy={busy} onPress={()=>void run(()=>onChangeStatus({status:'curing',curingStartedOn:dates.curingStartedOn}))}/>
      </>:null}
      {base.status==='curing'?<>
        <DatePickerField label="Cured confirmation date *" value={dates.curedOn} onChange={curedOn=>setDates({...dates,curedOn})}/>
        <AppField label="Curing note" value={curingNote} onChangeText={setCuringNote} placeholder="Optional"/>
        <TouchableOpacity style={styles.checkRow} onPress={()=>setInspected(!inspected)} accessibilityRole="checkbox" accessibilityState={{checked:inspected}}>
          <View style={[styles.check,inspected&&styles.checkOn]}>{inspected?<Text style={styles.checkMark}>✓</Text>:null}</View>
          <Text style={styles.checkLabel}>The base has been inspected and is ready for wall work</Text>
        </TouchableOpacity>
        <AppButton label="Confirm Base Is Cured" tone="navy" busy={busy} disabled={!inspected} onPress={()=>void run(()=>onChangeStatus({status:'cured',curedOn:dates.curedOn,inspected,curingNote}))} hint="Unlocks wall geometry, layers, and wall material"/>
      </>:null}
      {base.status==='cured'?<Text style={styles.ready}>Base confirmed cured on {base.curedOn}. Wall geometry, layers, and wall material are unlocked below.</Text>:null}
      {error?<Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>:null}
    </View>:null}
  </AppCard>;
}

function BaseFields({form,set,savedPurposes,onCreatePurpose,volume,useCalculated,issues,error,busy,onSave}:{form:BaseForm;set:(patch:Partial<BaseForm>)=>void;savedPurposes:SavedConcretePurpose[];onCreatePurpose:(label:string)=>Promise<SavedConcretePurpose>;volume:{grossVolumeM3:number;netVolumeM3:number}|null;useCalculated:()=>void;issues:string[];error:string|null;busy:boolean;onSave:()=>void}){
  return <View style={styles.fields}>
    <AppField label="Base reference or description *" value={form.reference} onChangeText={reference=>set({reference})} placeholder="Example: Base A"/>
    <AppField label="Location or segment" value={form.location} onChangeText={location=>set({location})} placeholder="Example: Km 2+150"/>
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Length (m) *" value={form.length} onChangeText={length=>set({length})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><AppField label="Height / depth (m) *" value={form.height} onChangeText={height=>set({height})} keyboardType="decimal-pad"/></View>
    </View>
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Bottom thickness (m) *" value={form.bottom} onChangeText={bottom=>set({bottom})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><AppField label="Top thickness (m) *" value={form.top} onChangeText={top=>set({top})} keyboardType="decimal-pad"/></View>
    </View>
    <AppField label="Volume deductions (m³)" value={form.deduction} onChangeText={deduction=>set({deduction})} keyboardType="decimal-pad" placeholder="0"/>
    <View style={styles.results}>
      <Result label="Gross volume" value={volume?formatCubicMetres(volume.grossVolumeM3):'Not calculated'}/>
      <Result label="Net volume" value={volume?formatCubicMetres(volume.netVolumeM3):'Not calculated'} strong/>
    </View>
    <View style={styles.materials}>
      {([{id:'ready_mix',label:'Ready-mix m³'},{id:'site_mix',label:'Site-mixed'},{id:'stone',label:'Stone'}] as const).map(option=>{
        const on=form.material===option.id;
        return <TouchableOpacity key={option.id} style={[styles.material,on&&styles.materialOn]} onPress={()=>set({material:option.id,purpose:option.id==='stone'?null:form.purpose??{kind:'builtin',id:'footing'}})} accessibilityRole="radio" accessibilityState={{checked:on}}><Text style={[styles.materialText,on&&styles.materialTextOn]}>{option.label}</Text></TouchableOpacity>;
      })}
    </View>
    {form.material!=='stone'?<ConcretePurposeField label="Concrete / mortar purpose *" value={form.purpose} saved={savedPurposes} onSelect={purpose=>set({purpose})} onCreate={onCreatePurpose}/>:null}
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Consumed quantity *" value={form.quantity} onChangeText={quantity=>set({quantity,manualOverride:true})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><DatePickerField label="Consumption date" value={form.consumptionDate} onChange={consumptionDate=>set({consumptionDate})}/></View>
    </View>
    <TouchableOpacity style={styles.checkRow} onPress={()=>set({manualOverride:!form.manualOverride})} accessibilityRole="checkbox" accessibilityState={{checked:form.manualOverride}}>
      <View style={[styles.check,form.manualOverride&&styles.checkOn]}>{form.manualOverride?<Text style={styles.checkMark}>✓</Text>:null}</View>
      <Text style={styles.checkLabel}>Manual quantity override (the calculated volume is kept as recorded)</Text>
    </TouchableOpacity>
    {volume?<AppButton label={`Use Calculated ${formatCubicMetres(volume.netVolumeM3)}`} tone="secondary" onPress={useCalculated}/>:null}
    <AppField label="Base notes" value={form.notes} onChangeText={notes=>set({notes})} multiline/>
    {issues.length?<View accessibilityLiveRegion="polite">{issues.map(issue=><Text key={issue} style={styles.error}>{issue}</Text>)}</View>:null}
    {error?<Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>:null}
    <AppButton label="Save Base" tone="navy" busy={busy} disabled={issues.length>0} onPress={onSave}/>
  </View>;
}

function Result({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <View style={[styles.result,strong&&styles.resultStrong]}><Text style={[styles.resultLabel,strong&&styles.resultLabelStrong]}>{label}</Text><Text style={[styles.resultValue,strong&&styles.resultValueStrong]}>{value}</Text></View>;
}

const styles=StyleSheet.create({
  helper:{color:colors.muted,fontSize:12,lineHeight:17},
  legacy:{color:colors.ink,fontSize:14,fontWeight:'900'},
  stepper:{flexDirection:'row',gap:6,flexWrap:'wrap'},
  step:{flexGrow:1,flexBasis:'22%',minWidth:80,minHeight:56,gap:3,padding:8,borderRadius:radius.sm,borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface},
  stepCurrent:{borderColor:colors.navy,backgroundColor:'#EAF1F6'},
  stepDone:{borderColor:colors.success,backgroundColor:'#E5F3EC'},
  stepNumber:{color:colors.muted,fontSize:11,fontWeight:'900'},
  stepNumberOn:{color:colors.navy},
  stepTitle:{color:colors.ink,fontSize:11,fontWeight:'800',lineHeight:15},
  stepLocked:{color:colors.muted},
  lockBanner:{color:colors.warning,backgroundColor:'#FFF3D8',borderRadius:radius.sm,padding:10,fontSize:12,fontWeight:'800',lineHeight:17},
  summary:{gap:3,backgroundColor:colors.surface,borderRadius:radius.md,padding:12},
  summaryTitle:{color:colors.ink,fontSize:14,fontWeight:'900'},
  summaryLine:{color:colors.muted,fontSize:12,lineHeight:17},
  lifecycle:{gap:10,marginTop:4},
  ready:{color:colors.success,fontSize:12,fontWeight:'800',lineHeight:17},
  fields:{gap:10},
  pair:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
  results:{flexDirection:'row',gap:6},
  result:{flex:1,borderRadius:10,paddingHorizontal:10,paddingVertical:8,backgroundColor:colors.surface},
  resultStrong:{backgroundColor:colors.result},
  resultLabel:{color:colors.muted,fontSize:11,fontWeight:'800'},
  resultLabelStrong:{color:'#E3F6F4'},
  resultValue:{color:colors.ink,fontSize:14,fontWeight:'900'},
  resultValueStrong:{color:'#FFFFFF'},
  materials:{flexDirection:'row',gap:6},
  material:{flex:1,minHeight:46,justifyContent:'center',alignItems:'center',borderRadius:10,borderWidth:1,borderColor:colors.line,padding:9,backgroundColor:colors.surface},
  materialOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  materialText:{color:colors.muted,fontSize:12,fontWeight:'900'},
  materialTextOn:{color:'#FFFFFF'},
  checkRow:{minHeight:44,flexDirection:'row',alignItems:'center',gap:9},
  check:{width:22,height:22,borderRadius:6,borderWidth:2,borderColor:colors.muted,alignItems:'center',justifyContent:'center'},
  checkOn:{borderColor:colors.navy,backgroundColor:colors.navy},
  checkMark:{color:'#FFFFFF',fontSize:13,fontWeight:'900'},
  checkLabel:{flex:1,color:colors.ink,fontSize:12,fontWeight:'700',lineHeight:17},
  error:{color:colors.danger,fontSize:12,fontWeight:'800',lineHeight:17},
});
