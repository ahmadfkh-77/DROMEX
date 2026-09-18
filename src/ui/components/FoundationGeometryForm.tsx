import {useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {calculateFoundationVolume,validateFoundationDraft,type Foundation,type FoundationDraft} from '../../domain/foundations';
import {formatCubicMetres} from '../../domain/walls';
import type {SavedConcretePurpose} from '../../domain/walls';
import {colors} from '../theme';
import {AppButton,AppField} from './AppPrimitives';
import {ConcretePurposeField,type PurposeSelection} from './ConcretePurposeField';
import {DatePickerField} from './DatePickerField';

export type FoundationGeometryFormValues={reference:string;location:string;length:string;height:string;bottom:string;top:string;deduction:string;material:'ready_mix'|'site_mix'|'stone';purpose:PurposeSelection|null;quantity:string;quantityUnit:'m3'|'tonnes';manualOverride:boolean;consumptionDate:string;notes:string};
const today=()=>new Date().toISOString().slice(0,10);
const n=(value:string)=>{const parsed=Number(value.trim().replace(',','.'));return Number.isFinite(parsed)?parsed:Number.NaN;};
export const emptyFoundationForm=():FoundationGeometryFormValues=>({reference:'',location:'',length:'',height:'',bottom:'',top:'',deduction:'0',material:'ready_mix',purpose:{kind:'builtin',id:'footing'},quantity:'',quantityUnit:'m3',manualOverride:false,consumptionDate:today(),notes:''});
export const foundationFormFrom=(foundation:Foundation):FoundationGeometryFormValues=>({reference:foundation.reference,location:foundation.location,length:String(foundation.lengthM),height:String(foundation.heightM),bottom:String(foundation.bottomThicknessM),top:String(foundation.topThicknessM),deduction:String(foundation.deductionM3),material:foundation.materialType,purpose:foundation.concretePurpose?{kind:'builtin',id:foundation.concretePurpose}:foundation.customPurposeId?{kind:'custom',id:foundation.customPurposeId}:null,quantity:foundation.quantity==null?'':String(foundation.quantity),quantityUnit:foundation.quantityUnit,manualOverride:foundation.manualOverride,consumptionDate:foundation.consumptionDate??today(),notes:foundation.notes});
export const foundationDraftFrom=(form:FoundationGeometryFormValues,projectId:string,constructionSectionId:string):FoundationDraft=>({projectId,constructionSectionId,reference:form.reference,location:form.location,lengthM:n(form.length),heightM:n(form.height),bottomThicknessM:n(form.bottom),topThicknessM:n(form.top),deductionM3:form.deduction.trim()?n(form.deduction):0,materialType:form.material,concretePurpose:form.material!=='stone'&&form.purpose?.kind==='builtin'?form.purpose.id:null,customPurposeId:form.material!=='stone'&&form.purpose?.kind==='custom'?form.purpose.id:null,quantity:form.quantity.trim()?n(form.quantity):null,quantityUnit:form.quantityUnit,manualOverride:form.manualOverride,consumptionDate:form.consumptionDate,notes:form.notes});

/**
 * DEC-464. The Foundation's own geometry, material, and quantity fields -- Checkpoint 2/4's
 * "Foundation identity, geometry, composition, materials/volume" substeps, shared by creating an
 * independent foundation and correcting one later.
 */
export function FoundationGeometryForm({form,onChange,savedPurposes,onCreatePurpose,busy,error,onSave,saveLabel}:{
  form:FoundationGeometryFormValues;onChange:(patch:Partial<FoundationGeometryFormValues>)=>void;
  savedPurposes:SavedConcretePurpose[];onCreatePurpose:(label:string)=>Promise<SavedConcretePurpose>;
  busy:boolean;error:string|null;onSave:()=>void;saveLabel:string;
}){
  const draft=foundationDraftFrom(form,'x','x');
  const geometryReady=[form.length,form.height,form.bottom,form.top].every(value=>Number.isFinite(n(value))&&n(value)>0);
  const volume=geometryReady?calculateFoundationVolume(draft):null;
  const issues=validateFoundationDraft({...draft,quantity:draft.quantity??(volume?volume.netVolumeM3:null)}).filter(issue=>!issue.includes('project')&&!issue.includes('Construction Section'));
  const useCalculated=()=>{if(volume)onChange({quantity:String(Number(volume.netVolumeM3.toFixed(3))),quantityUnit:'m3',manualOverride:false});};

  return <View style={styles.fields}>
    <AppField label="Foundation reference or name *" value={form.reference} onChangeText={reference=>onChange({reference})} placeholder="Example: Foundation A1"/>
    <AppField label="Location or segment" value={form.location} onChangeText={location=>onChange({location})} placeholder="Example: Km 2+150"/>
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Length (m) *" value={form.length} onChangeText={length=>onChange({length})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><AppField label="Height / depth (m) *" value={form.height} onChangeText={height=>onChange({height})} keyboardType="decimal-pad"/></View>
    </View>
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Bottom thickness (m) *" value={form.bottom} onChangeText={bottom=>onChange({bottom})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><AppField label="Top thickness (m) *" value={form.top} onChangeText={top=>onChange({top})} keyboardType="decimal-pad"/></View>
    </View>
    <AppField label="Volume deductions (m³)" value={form.deduction} onChangeText={deduction=>onChange({deduction})} keyboardType="decimal-pad" placeholder="0"/>
    <View style={styles.results}>
      <Result label="Gross volume" value={volume?formatCubicMetres(volume.grossVolumeM3):'Not calculated'}/>
      <Result label="Net volume" value={volume?formatCubicMetres(volume.netVolumeM3):'Not calculated'} strong/>
    </View>
    <View style={styles.materials}>
      {([{id:'ready_mix',label:'Ready-mix m³'},{id:'site_mix',label:'Site-mixed'},{id:'stone',label:'Stone'}] as const).map(option=>{
        const on=form.material===option.id;
        return <TouchableOpacity key={option.id} style={[styles.material,on&&styles.materialOn]} onPress={()=>onChange({material:option.id,purpose:option.id==='stone'?null:form.purpose??{kind:'builtin',id:'footing'}})} accessibilityRole="radio" accessibilityState={{checked:on}}><Text style={[styles.materialText,on&&styles.materialTextOn]}>{option.label}</Text></TouchableOpacity>;
      })}
    </View>
    {form.material!=='stone'?<ConcretePurposeField label="Concrete / mortar purpose *" value={form.purpose} saved={savedPurposes} onSelect={purpose=>onChange({purpose})} onCreate={onCreatePurpose}/>:null}
    <View style={styles.pair}>
      <View style={styles.flex}><AppField label="Consumed quantity *" value={form.quantity} onChangeText={quantity=>onChange({quantity,manualOverride:true})} keyboardType="decimal-pad"/></View>
      <View style={styles.flex}><DatePickerField label="Consumption date" value={form.consumptionDate} onChange={consumptionDate=>onChange({consumptionDate})}/></View>
    </View>
    <TouchableOpacity style={styles.checkRow} onPress={()=>onChange({manualOverride:!form.manualOverride})} accessibilityRole="checkbox" accessibilityState={{checked:form.manualOverride}}>
      <View style={[styles.check,form.manualOverride&&styles.checkOn]}>{form.manualOverride?<Text style={styles.checkMark}>✓</Text>:null}</View>
      <Text style={styles.checkLabel}>Manual quantity override (the calculated volume is kept as recorded)</Text>
    </TouchableOpacity>
    {volume?<AppButton label={`Use Calculated ${formatCubicMetres(volume.netVolumeM3)}`} tone="secondary" onPress={useCalculated}/>:null}
    <AppField label="Foundation notes" value={form.notes} onChangeText={notes=>onChange({notes})} multiline/>
    {issues.length?<View accessibilityLiveRegion="polite">{issues.map(issue=><Text key={issue} style={styles.error}>{issue}</Text>)}</View>:null}
    {error?<Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>:null}
    <AppButton label={saveLabel} tone="navy" busy={busy} disabled={issues.length>0} onPress={onSave}/>
  </View>;
}

function Result({label,value,strong=false}:{label:string;value:string;strong?:boolean}){
  return <View style={[styles.result,strong&&styles.resultStrong]}><Text style={[styles.resultLabel,strong&&styles.resultLabelStrong]}>{label}</Text><Text style={[styles.resultValue,strong&&styles.resultValueStrong]}>{value}</Text></View>;
}

const styles=StyleSheet.create({
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
