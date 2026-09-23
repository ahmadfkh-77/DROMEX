import {useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';

import type {SupervisorRepository} from '../../data/repositories/SupervisorRepository';
import type {Supervisor,SupervisorDraft} from '../../domain/supervisors';
import {AppButton,AppField,AppPage,EmptyState,Feedback,PageHeader} from '../components/AppPrimitives';
import {useReducedMotion} from '../components/ExpandableMenu';
import {FocusedSheet,SheetActions} from '../components/FocusedSheet';
import {SignaturePad} from '../components/SignaturePad';
import {colors} from '../theme';

type DetailsSheet={id:string|null;draft:Required<SupervisorDraft>};

/**
 * DEC-479. Saved supervisors, reached from PDF Settings. A supervisor can be saved by name only or with
 * a signature drawn here. The signature stays inside the app's database; replacing or removing it only
 * affects Daily Reports made afterwards, because every report keeps its own copy.
 */
export function SupervisorsScreen({repository,onBack}:{repository:SupervisorRepository;onBack:()=>void}){
  const reducedMotion=useReducedMotion();
  const[supervisors,setSupervisors]=useState<Supervisor[]|null>(null);
  const[details,setDetails]=useState<DetailsSheet|null>(null);
  const[signing,setSigning]=useState<{supervisor:Supervisor;strokes:string[]}|null>(null);
  const[drawing,setDrawing]=useState(false);
  const[sheetError,setSheetError]=useState<string|null>(null);
  const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);
  const[busy,setBusy]=useState(false);const[archivedOpen,setArchivedOpen]=useState(false);

  const refresh=useCallback(async()=>{try{setSupervisors(await repository.listSupervisors());}catch(cause){setError(cause instanceof Error?cause.message:'Supervisors could not be loaded.');setSupervisors(current=>current??[]);}},[repository]);
  useEffect(()=>{void refresh();},[refresh]);

  async function run(action:()=>Promise<unknown>,success:string){setBusy(true);setError(null);setMessage(null);try{await action();await refresh();setMessage(success);}catch(cause){setError(cause instanceof Error?cause.message:'The change could not be saved.');}finally{setBusy(false);}}
  async function saveSheet(action:()=>Promise<unknown>,success:string,close:()=>void){setBusy(true);setSheetError(null);try{await action();close();await refresh();setMessage(success);}catch(cause){setSheetError(cause instanceof Error?cause.message:'The change could not be saved.');}finally{setBusy(false);}}
  function removeSignature(supervisor:Supervisor){
    Alert.alert('Remove saved signature?',`${supervisor.name} will remain available by name. This affects future reports only: reports already signed keep their own copy.`,
      [{text:'Keep signature',style:'cancel'},{text:'Remove signature',style:'destructive',onPress:()=>void run(()=>repository.saveSupervisorSignature(supervisor.id,[]),'Saved signature removed. Existing reports are unchanged.')}]);
  }
  function archive(supervisor:Supervisor){
    Alert.alert('Archive this supervisor?',`${supervisor.name} will no longer be offered for new Daily Reports. Reports already signed off keep their sign-off.`,
      [{text:'Keep active',style:'cancel'},{text:'Archive',style:'destructive',onPress:()=>void run(()=>repository.setSupervisorActive(supervisor.id,false),'Supervisor archived.')}]);
  }

  if(!supervisors)return <AppPage><PageHeader eyebrow="PDF SETTINGS" title="Supervisors" onBack={onBack}/><View style={styles.loading}><ActivityIndicator size="large" color={colors.brand}/><Text style={styles.helper}>Loading supervisors…</Text></View></AppPage>;
  const active=supervisors.filter(value=>value.isActive),archived=supervisors.filter(value=>!value.isActive);

  return <AppPage keyboard>
    <PageHeader eyebrow="PDF SETTINGS" title="Supervisors" onBack={onBack}/>
    <Text style={styles.helper}>Supervisors sign off at the end of a Daily Report, by name or with a saved signature. Changing a supervisor here affects future reports only.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    <AppButton label="Add supervisor" disabled={busy} onPress={()=>{setSheetError(null);setDetails({id:null,draft:{name:'',jobTitle:''}});}}/>
    <Text style={styles.sectionTitle}>Supervisors · {active.length}</Text>
    {active.length?active.map(supervisor=><SupervisorRow key={supervisor.id} supervisor={supervisor} busy={busy}
      onEdit={()=>{setSheetError(null);setDetails({id:supervisor.id,draft:{name:supervisor.name,jobTitle:supervisor.jobTitle??''}});}}
      onSign={()=>{setSheetError(null);setSigning({supervisor,strokes:[]});}}
      onRemoveSignature={supervisor.signature.length?()=>removeSignature(supervisor):undefined}
      onToggle={()=>archive(supervisor)} toggleLabel="Archive"/>)
      :<EmptyState title="No supervisors yet" body="Add the supervisors who sign off your Daily Reports. A signature is optional."/>}
    <TouchableOpacity activeOpacity={.75} style={styles.band} onPress={()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setArchivedOpen(value=>!value);}} accessibilityRole="button" accessibilityState={{expanded:archivedOpen}} accessibilityLabel={`Archived supervisors, ${archived.length}`}>
      <View style={styles.flex}><Text style={styles.bandTitle}>Archived supervisors</Text><Text style={styles.helper}>{archivedOpen?'Tap to hide':'Tap to view'} · {archived.length} record{archived.length===1?'':'s'}</Text></View>
      <Text style={styles.bandMark}>{archivedOpen?'×':'+'}</Text>
    </TouchableOpacity>
    {archivedOpen?archived.map(supervisor=><SupervisorRow key={supervisor.id} supervisor={supervisor} busy={busy} onToggle={()=>void run(()=>repository.setSupervisorActive(supervisor.id,true),'Supervisor restored.')} toggleLabel="Restore"/>):null}

    <FocusedSheet visible={!!details} eyebrow={details?.id?'EDIT SUPERVISOR':'NEW SUPERVISOR'} title={details?.draft.name.trim()||'Supervisor'} onClose={()=>setDetails(null)}
      footer={<SheetActions primaryLabel="Save supervisor" busy={busy} onCancel={()=>setDetails(null)} onPrimary={()=>{if(!details)return;const {id,draft}=details;void saveSheet(()=>id?repository.updateSupervisor(id,draft):repository.createSupervisor(draft),id?'Supervisor updated for future reports.':'Supervisor saved. Add a signature now or sign off by name.',()=>setDetails(null));}}/>}>
      {details?<>
        {sheetError?<Feedback kind="error">{sheetError}</Feedback>:null}
        <AppField label="Name *" value={details.draft.name} onChangeText={name=>setDetails({...details,draft:{...details.draft,name}})} maxLength={80} autoCapitalize="words"/>
        <AppField label="Job title" value={details.draft.jobTitle} onChangeText={jobTitle=>setDetails({...details,draft:{...details.draft,jobTitle}})} maxLength={80} placeholder="Resident engineer, site supervisor…"/>
      </>:null}
    </FocusedSheet>

    <FocusedSheet visible={!!signing} scrollEnabled={!drawing} eyebrow="SAVED SIGNATURE" title={signing?.supervisor.name??'Signature'} onClose={()=>setSigning(null)}
      footer={<SheetActions primaryLabel="Save signature" busy={busy} disabled={!signing?.strokes.length} onCancel={()=>setSigning(null)} onPrimary={()=>{if(!signing)return;const {supervisor,strokes}=signing;void saveSheet(()=>repository.saveSupervisorSignature(supervisor.id,strokes),'Signature saved for future reports.',()=>setSigning(null));}}/>}>
      {signing?<>
        {sheetError?<Feedback kind="error">{sheetError}</Feedback>:null}
        <Text style={styles.helper}>{signing.supervisor.signature.length?'Signing again replaces the saved signature for future reports only. Reports already signed keep their copy.':'This signature will be offered when this supervisor signs off a Daily Report. It stays on this device and in your encrypted backups.'}</Text>
        <SignaturePad value={signing.strokes} onChange={strokes=>setSigning({...signing,strokes})} onSigningChange={setDrawing} hint={`${signing.supervisor.name} signs here`}/>
      </>:null}
    </FocusedSheet>
  </AppPage>;
}

function SupervisorRow({supervisor,busy,onEdit,onSign,onRemoveSignature,onToggle,toggleLabel}:{supervisor:Supervisor;busy:boolean;onEdit?:()=>void;onSign?:()=>void;onRemoveSignature?:()=>void;onToggle:()=>void;toggleLabel:string}){
  const state=supervisor.signatureDamaged?'Signature unreadable · sign again':supervisor.signature.length?'Signature saved':'Name only';
  return <View style={[styles.row,!supervisor.isActive&&styles.rowArchived]}>
    <View style={styles.rowTop}>
      <View style={styles.flex}>
        <Text style={styles.rowTitle} numberOfLines={2}>{supervisor.name}</Text>
        {supervisor.jobTitle?<Text style={styles.helper} numberOfLines={2}>{supervisor.jobTitle}</Text>:null}
      </View>
      <View style={[styles.pill,supervisor.signatureDamaged&&styles.pillWarning]}><Text style={[styles.pillText,supervisor.signatureDamaged&&styles.pillTextWarning]}>{state}</Text></View>
    </View>
    {supervisor.signature.length?<View style={styles.preview} accessibilityLabel={`Saved signature of ${supervisor.name}`}>
      <Svg width="100%" height="100%" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet">{supervisor.signature.map((path,index)=><Path key={`${index}-${path.length}`} d={path} fill="none" stroke={colors.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}</Svg>
    </View>:null}
    <View style={styles.actions}>
      {onEdit?<Quiet label="Edit details" onPress={onEdit} busy={busy} accessibilityLabel={`Edit ${supervisor.name}`}/>:null}
      {onSign?<Quiet label={supervisor.signature.length?'Replace signature':'Add signature'} onPress={onSign} busy={busy} accessibilityLabel={`${supervisor.signature.length?'Replace':'Add'} signature for ${supervisor.name}`}/>:null}
      {onRemoveSignature?<Quiet label="Remove saved signature" onPress={onRemoveSignature} busy={busy} accessibilityLabel={`Remove saved signature of ${supervisor.name}`}/>:null}
      <Quiet label={toggleLabel} onPress={onToggle} busy={busy} accessibilityLabel={`${toggleLabel} ${supervisor.name}`}/>
    </View>
  </View>;
}
function Quiet({label,onPress,busy,accessibilityLabel}:{label:string;onPress:()=>void;busy:boolean;accessibilityLabel:string}){
  return <TouchableOpacity style={styles.quiet} onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityLabel={accessibilityLabel}><Text style={styles.quietText}>{label}</Text></TouchableOpacity>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  loading:{alignItems:'center',gap:10,paddingVertical:30},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  sectionTitle:{color:colors.ink,fontSize:18,fontWeight:'900'},
  row:{backgroundColor:colors.surface,borderRadius:13,padding:14,gap:8,borderLeftWidth:3,borderLeftColor:colors.navy},
  rowArchived:{borderLeftColor:colors.line,borderWidth:1,borderColor:colors.line},
  rowTop:{flexDirection:'row',alignItems:'flex-start',gap:10},
  rowTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},
  pill:{flexShrink:0,maxWidth:'46%',paddingHorizontal:9,paddingVertical:5,borderRadius:12,borderWidth:1,borderColor:colors.navy},
  pillText:{color:colors.navy,fontSize:11,fontWeight:'900'},
  pillWarning:{borderColor:colors.warning,backgroundColor:'#FFF3D8'},pillTextWarning:{color:colors.warning},
  preview:{height:64,borderRadius:10,borderWidth:1,borderColor:colors.line,backgroundColor:'#FFFFFF',paddingHorizontal:8},
  actions:{flexDirection:'row',flexWrap:'wrap',columnGap:14},
  quiet:{minHeight:44,justifyContent:'center'},quietText:{color:colors.brandDark,fontSize:13,fontWeight:'900'},
  band:{minHeight:56,backgroundColor:colors.creamSoft,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:16,flexDirection:'row',alignItems:'center',gap:10},
  bandTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},bandMark:{color:colors.brandDark,fontSize:24,fontWeight:'700',width:22,textAlign:'center'},
});
