import {useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {CompanyHeaderRepository} from '../../data/repositories/CompanyHeaderRepository';
import type {ProfileRepository} from '../../data/repositories/ProfileRepository';
import {projectCompanyState,type ProjectCompanyProfile} from '../../domain/companyHeaders';
import {AppButton,AppCard,AppPage,Feedback,PageHeader} from '../components/AppPrimitives';
import {colors} from '../theme';

/**
 * Settings › Company setups. Two companies can head a PDF. The Plant Company is the existing Company
 * profile (nothing moved or copied); the Project Company is a customer that owns the project.
 */
export function CompanySetupsScreen({profiles,headers,onBack,onOpenPlant,onOpenProject}:{profiles:ProfileRepository;headers:CompanyHeaderRepository;onBack:()=>void;onOpenPlant:()=>void;onOpenProject:()=>void}){
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[plantName,setPlantName]=useState('');
  const[project,setProject]=useState<ProjectCompanyProfile|null>(null);
  const load=useCallback(()=>{
    setStatus('loading');
    Promise.all([profiles.getCompanySettings(),headers.getProjectCompany()])
      .then(([settings,profile])=>{setPlantName(settings.companyName.trim());setProject(profile);setStatus('ready');})
      .catch(()=>setStatus('error'));
  },[profiles,headers]);
  useEffect(()=>{load();},[load]);
  const state=projectCompanyState(project);
  return <AppPage>
    <PageHeader eyebrow="SETTINGS" title="Company setups" onBack={onBack}/>
    <Text style={styles.helper}>Two companies can head your documents. Choose which one prints on each PDF when you export.</Text>
    {status==='loading'?<View style={styles.center}><ActivityIndicator color={colors.brand}/><Text style={styles.helper}>Loading company setups…</Text></View>:null}
    {status==='error'?<><Feedback kind="error">The company setups could not be loaded.</Feedback><AppButton label="Try again" tone="secondary" onPress={load}/></>:null}
    {status==='ready'?<>
      <HubCard tone="plant" marker="01" badge={plantName?'COMPLETE':'NOT SET UP'} eyebrow="PLANT COMPANY" title={plantName||'Your company'}
        hint="Your main company. Everything in and out is recorded under it, and it makes the receipts." open={plantName?'Open Plant Company':'Set up Plant Company'} onPress={onOpenPlant}/>
      <HubCard tone="project" marker="02" badge={state==='not_set_up'?'NOT SET UP':state==='customer_archived'?'CUSTOMER ARCHIVED':'LINKED'} eyebrow="PROJECT COMPANY" title={project?.customerName??'Project owner'}
        hint="The project owner, linked to one of your existing customers. It does not make receipts." open={state==='not_set_up'?'Set up Project Company':'Open Project Company'} onPress={onOpenProject}/>
      <AppCard tone="cream" title="Tax and VAT" hint="The VAT percentage and the DEMO record switch stay in the Plant Company screen, exactly where they are today."><View/></AppCard>
    </>:null}
  </AppPage>;
}

function HubCard({tone,marker,badge,eyebrow,title,hint,open,onPress}:{tone:'plant'|'project';marker:string;badge:string;eyebrow:string;title:string;hint:string;open:string;onPress:()=>void}){
  return <TouchableOpacity activeOpacity={.85} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${eyebrow}. ${title}. ${badge}. ${open}.`} style={[styles.card,tone==='plant'?styles.plant:styles.project]}>
    <View style={styles.top}><View style={styles.marker}><Text style={styles.markerText}>{marker}</Text></View><View style={styles.badge}><Text style={styles.badgeText}>{badge}</Text></View></View>
    <Text style={styles.eyebrow}>{eyebrow}</Text>
    <Text style={styles.title} numberOfLines={2}>{title}</Text>
    <Text style={styles.hint}>{hint}</Text>
    <View style={styles.footer}><Text style={styles.open}>{open}</Text><Text style={styles.arrow}>›</Text></View>
  </TouchableOpacity>;
}

const styles=StyleSheet.create({
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  center:{flexDirection:'row',alignItems:'center',gap:10,minHeight:48},
  card:{borderRadius:19,padding:20,gap:2,minHeight:48,overflow:'hidden'},
  plant:{backgroundColor:colors.brand,shadowColor:'#8E2E1B',shadowOpacity:.22,shadowRadius:9,shadowOffset:{width:0,height:5},elevation:5},
  project:{backgroundColor:colors.navy,shadowColor:'#082D61',shadowOpacity:.22,shadowRadius:9,shadowOffset:{width:0,height:5},elevation:5},
  top:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},
  marker:{width:38,height:32,borderRadius:9,backgroundColor:'rgba(255,255,255,0.18)',alignItems:'center',justifyContent:'center'},markerText:{color:colors.cream,fontSize:14,fontWeight:'900'},
  badge:{backgroundColor:'rgba(255,255,255,0.2)',borderRadius:10,paddingHorizontal:8,paddingVertical:5},badgeText:{color:'#FFF',fontSize:9,fontWeight:'900',letterSpacing:.7},
  eyebrow:{color:'#F7E3DC',fontSize:11,fontWeight:'900',letterSpacing:1.3,marginTop:10},
  title:{color:colors.cream,fontSize:21,fontWeight:'900',marginTop:3},
  hint:{color:'#F3E4DC',fontSize:12,lineHeight:17,marginTop:4},
  footer:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.22)'},
  open:{color:colors.cream,fontWeight:'900',fontSize:13},arrow:{color:colors.cream,fontSize:22,fontWeight:'900'},
});
