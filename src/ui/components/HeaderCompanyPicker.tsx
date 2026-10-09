import {useEffect,useState} from 'react';
import {ActivityIndicator,Image,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {CompanyHeaderRepository} from '../../data/repositories/CompanyHeaderRepository';
import {HEADER_COMPANY_LABELS,HEADER_PICKER_HELPER,projectCompanyState,type HeaderCompany,type HeaderCompanyKind,type ProjectCompanyProfile} from '../../domain/companyHeaders';
import {companyContactLine} from '../../domain/projectTotalsPdf';
import {colors} from '../theme';
import {AppButton} from './AppPrimitives';

/**
 * The ONE "Header company" picker, used the same way on every PDF export. It chooses only whose name,
 * logo, contact details and signature head the PDF; records, numbers and totals never change. The
 * Project Company can be chosen once it is set up; until then its option is shown but unavailable.
 */
export function HeaderCompanyPicker({headers,value,onChange,remember,onOpenSetups}:{
  headers:CompanyHeaderRepository;value:HeaderCompanyKind;onChange:(kind:HeaderCompanyKind)=>void;
  /** Only where a project is in scope: the "Use for every export in this project" checkbox. */
  remember?:{checked:boolean;onChange:(checked:boolean)=>void};
  /** Opens Company setups; offered when the Project Company is not set up yet. */
  onOpenSetups?:()=>void;
}){
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[plant,setPlant]=useState<HeaderCompany|null>(null);
  const[project,setProject]=useState<ProjectCompanyProfile|null>(null);
  const[preview,setPreview]=useState<HeaderCompany|null>(null);
  useEffect(()=>{
    let active=true;setStatus('loading');
    Promise.all([headers.resolveHeader('plant'),headers.getProjectCompany()])
      .then(([nextPlant,nextProject])=>{if(!active)return;setPlant(nextPlant);setProject(nextProject);setStatus('ready');})
      .catch(()=>{if(active)setStatus('error');});
    return()=>{active=false;};
  },[headers]);
  const state=projectCompanyState(project);
  const effective:HeaderCompanyKind=value==='project'&&state==='not_set_up'?'plant':value;
  useEffect(()=>{
    if(status!=='ready')return;
    let active=true;
    headers.resolveHeader(effective).then(next=>{if(active)setPreview(next);}).catch(()=>{if(active)setPreview(null);});
    return()=>{active=false;};
  },[headers,effective,status]);

  const option=(kind:HeaderCompanyKind,title:string,detail:string,disabled=false)=>{
    const on=effective===kind&&!disabled;
    return <TouchableOpacity key={kind} activeOpacity={.75} disabled={disabled} onPress={()=>onChange(kind)} accessibilityRole="radio" accessibilityState={{checked:on,disabled}}
      accessibilityLabel={`${title}. ${detail}`} style={[styles.option,on&&styles.optionOn,disabled&&styles.optionOff]}>
      <Text style={[styles.optionTitle,on&&styles.optionTitleOn]}>{title}</Text>
      <Text style={[styles.optionDetail,on&&styles.optionDetailOn]} numberOfLines={2}>{detail}</Text>
    </TouchableOpacity>;
  };

  return <View style={styles.card}>
    <Text style={styles.title}>Header company</Text>
    <Text style={styles.helper}>{HEADER_PICKER_HELPER}</Text>
    {status==='loading'?<View style={styles.center}><ActivityIndicator color={colors.brand}/><Text style={styles.helper}>Loading companies…</Text></View>:null}
    {status==='error'?<Text style={styles.error}>The companies could not be loaded. The Plant Company header will be used.</Text>:null}
    {status==='ready'?<>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Header company">
        {option('plant',HEADER_COMPANY_LABELS.plant,plant?.name||'Not named yet')}
        {option('project',HEADER_COMPANY_LABELS.project,state==='not_set_up'?'Not set up yet':project?.customerName??'',state==='not_set_up')}
      </View>
      {state==='not_set_up'?<View style={styles.empty}>
        <Text style={styles.emptyTitle}>Project Company is not set up</Text>
        <Text style={styles.helper}>Set it up in Settings › Company setups to use it as a header.</Text>
        {onOpenSetups?<AppButton label="Open Company setups" tone="secondary" onPress={onOpenSetups}/>:null}
      </View>:null}
      {state==='customer_archived'&&effective==='project'?<Text style={styles.warning}>The linked customer is archived. The header still prints from the saved details. Records are unaffected.</Text>:null}
      {remember?<TouchableOpacity style={styles.check} onPress={()=>remember.onChange(!remember.checked)} accessibilityRole="checkbox" accessibilityState={{checked:remember.checked}} accessibilityLabel="Use for every export in this project">
        <View style={[styles.box,remember.checked&&styles.boxOn]}>{remember.checked?<Text style={styles.tick}>✓</Text>:null}</View>
        <Text style={styles.checkText}>Use for every export in this project</Text>
      </TouchableOpacity>:null}
      {preview?<View style={[styles.preview,preview.kind==='project'&&styles.previewProject]} accessibilityLabel={`Header preview: ${preview.name}`}>
        <View style={styles.previewTop}>
          {preview.logoUri?<Image source={{uri:preview.logoUri}} style={styles.logo} resizeMode="contain"/>:null}
          <View style={styles.flex}><Text style={styles.previewName}>{preview.name||'No company name saved'}</Text>
            {companyContactLine({address:preview.address,phone:preview.phone,email:preview.email,taxVatNumber:preview.taxVatNumber})?<Text style={styles.previewLine}>{companyContactLine({address:preview.address,phone:preview.phone,email:preview.email,taxVatNumber:preview.taxVatNumber})}</Text>:null}
            {preview.registrationNumber?<Text style={styles.previewLine}>Registration: {preview.registrationNumber}</Text>:null}
            {preview.signer?<Text style={styles.previewLine}>Signed by {preview.signer.name}{preview.signer.display==='name_only'?' (name only)':''}</Text>:null}
          </View>
        </View>
        {preview.note?<Text style={styles.warning}>{preview.note}</Text>:null}
      </View>:null}
    </>:null}
  </View>;
}

const styles=StyleSheet.create({
  card:{backgroundColor:colors.surface,borderRadius:16,padding:17,gap:12},
  title:{color:colors.ink,fontSize:16,fontWeight:'900'},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  center:{flexDirection:'row',alignItems:'center',gap:10,minHeight:48},
  error:{color:colors.danger,backgroundColor:'#FCE8E6',padding:12,borderRadius:12,fontWeight:'700',fontSize:13,lineHeight:19},
  warning:{color:'#6B4A0E',backgroundColor:'#FFF3D8',borderWidth:1,borderColor:'#E3C681',padding:12,borderRadius:12,fontWeight:'700',fontSize:13,lineHeight:19,overflow:'hidden'},
  row:{flexDirection:'row',gap:8},
  option:{flex:1,minHeight:72,borderWidth:1,borderColor:colors.line,borderRadius:12,padding:12,justifyContent:'center',backgroundColor:colors.surface},
  optionOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  optionOff:{opacity:.55,borderStyle:'dashed'},
  optionTitle:{color:colors.ink,fontSize:14,fontWeight:'900'},optionTitleOn:{color:'#FFF'},
  optionDetail:{color:colors.muted,fontSize:11,lineHeight:15,marginTop:3},optionDetailOn:{color:'#D8E4ED'},
  empty:{borderWidth:1,borderStyle:'dashed',borderColor:colors.line,borderRadius:14,padding:14,gap:8,backgroundColor:colors.surface},
  emptyTitle:{color:colors.ink,fontSize:14,fontWeight:'900'},
  check:{flexDirection:'row',alignItems:'center',gap:10,minHeight:48},
  box:{width:26,height:26,borderRadius:7,borderWidth:2,borderColor:colors.navy,alignItems:'center',justifyContent:'center'},boxOn:{backgroundColor:colors.navy},
  tick:{color:'#FFF',fontWeight:'900',fontSize:15},checkText:{color:colors.ink,fontSize:14,fontWeight:'700',flexShrink:1},
  preview:{borderWidth:1,borderColor:colors.line,borderTopWidth:4,borderTopColor:colors.brand,borderRadius:8,padding:12,gap:8,backgroundColor:'#FFFEFC'},
  previewProject:{borderTopColor:colors.navy},
  previewTop:{flexDirection:'row',gap:10,alignItems:'flex-start'},logo:{width:48,height:48},flex:{flex:1,minWidth:0},
  previewName:{color:colors.navy,fontSize:15,fontWeight:'900'},previewLine:{color:'#4F5B66',fontSize:12,lineHeight:17,marginTop:2},
});
