import {useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';

import {calculateFoundationVolume,validateFoundationDraft,type Foundation,type FoundationDraft} from '../../domain/foundations';
import {formatCubicMetres} from '../../domain/walls';
import {colors} from '../theme';
import {AppButton,AppField} from './AppPrimitives';
import type {PurposeSelection} from './ConcretePurposeField';

/**
 * DEC-468. `legacy` is the foundation's pre-DEC-468 top-level material record. It is never edited or
 * cleared here -- it is simply carried through a correction unchanged, so an old record keeps exactly
 * what it always said, and a new foundation carries none at all.
 */
export type FoundationLegacyMaterial={material:'ready_mix'|'site_mix'|'stone'|null;purpose:PurposeSelection|null;quantity:number|null;quantityUnit:'m3'|'tonnes'|null;manualOverride:boolean;consumptionDate:string|null};
export type FoundationGeometryFormValues={reference:string;location:string;length:string;height:string;bottom:string;top:string;deduction:string;notes:string;legacy:FoundationLegacyMaterial};
const n=(value:string)=>{const parsed=Number(value.trim().replace(',','.'));return Number.isFinite(parsed)?parsed:Number.NaN;};
const noLegacyMaterial=():FoundationLegacyMaterial=>({material:null,purpose:null,quantity:null,quantityUnit:null,manualOverride:false,consumptionDate:null});
export const emptyFoundationForm=():FoundationGeometryFormValues=>({reference:'',location:'',length:'',height:'',bottom:'',top:'',deduction:'0',notes:'',legacy:noLegacyMaterial()});
export const foundationFormFrom=(foundation:Foundation):FoundationGeometryFormValues=>({reference:foundation.reference,location:foundation.location,length:String(foundation.lengthM),height:String(foundation.heightM),bottom:String(foundation.bottomThicknessM),top:String(foundation.topThicknessM),deduction:String(foundation.deductionM3),notes:foundation.notes,
  legacy:{material:foundation.materialType,purpose:foundation.concretePurpose?{kind:'builtin',id:foundation.concretePurpose}:foundation.customPurposeId?{kind:'custom',id:foundation.customPurposeId}:null,quantity:foundation.quantity,quantityUnit:foundation.quantityUnit,manualOverride:foundation.manualOverride,consumptionDate:foundation.consumptionDate}});
export const foundationDraftFrom=(form:FoundationGeometryFormValues,projectId:string,constructionSectionId:string):FoundationDraft=>({projectId,constructionSectionId,reference:form.reference,location:form.location,lengthM:n(form.length),heightM:n(form.height),bottomThicknessM:n(form.bottom),topThicknessM:n(form.top),deductionM3:form.deduction.trim()?n(form.deduction):0,notes:form.notes,
  materialType:form.legacy.material,concretePurpose:form.legacy.material&&form.legacy.material!=='stone'&&form.legacy.purpose?.kind==='builtin'?form.legacy.purpose.id:null,customPurposeId:form.legacy.material&&form.legacy.material!=='stone'&&form.legacy.purpose?.kind==='custom'?form.legacy.purpose.id:null,quantity:form.legacy.quantity,quantityUnit:form.legacy.quantityUnit,manualOverride:form.legacy.manualOverride,consumptionDate:form.legacy.consumptionDate});

/**
 * DEC-464. The Foundation's own geometry, material, and quantity fields -- Checkpoint 2/4's
 * "Foundation identity, geometry, composition, materials/volume" substeps, shared by creating an
 * independent foundation and correcting one later.
 */
export function FoundationGeometryForm({form,onChange,busy,error,onSave,saveLabel}:{
  form:FoundationGeometryFormValues;onChange:(patch:Partial<FoundationGeometryFormValues>)=>void;
  busy:boolean;error:string|null;onSave:()=>void;saveLabel:string;
}){
  const draft=foundationDraftFrom(form,'x','x');
  const geometryReady=[form.length,form.height,form.bottom,form.top].every(value=>Number.isFinite(n(value))&&n(value)>0);
  const volume=geometryReady?calculateFoundationVolume(draft):null;
  // The real draft is validated, with nothing substituted for a value the user has not entered, so
  // this form and the repository can never disagree about whether it is saveable (DEC-468).
  const issues=validateFoundationDraft(draft).filter(issue=>!issue.includes('project')&&!issue.includes('Construction Section'));

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
      <Result label="Structural envelope volume" value={volume?formatCubicMetres(volume.netVolumeM3):'Not calculated'} strong/>
    </View>
    <Text style={styles.guidance}>Structural volume describes the foundation envelope. Record actual Stone and concrete separately through Lifts.</Text>
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
  guidance:{color:colors.muted,fontSize:12,lineHeight:17},
  result:{flex:1,borderRadius:10,paddingHorizontal:10,paddingVertical:8,backgroundColor:colors.surface},
  resultStrong:{backgroundColor:colors.result},
  resultLabel:{color:colors.muted,fontSize:11,fontWeight:'800'},
  resultLabelStrong:{color:'#E3F6F4'},
  resultValue:{color:colors.ink,fontSize:14,fontWeight:'900'},
  resultValueStrong:{color:'#FFFFFF'},
  error:{color:colors.danger,fontSize:12,fontWeight:'800',lineHeight:17},
});
