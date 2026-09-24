import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { LoadRepository } from '../../data/repositories/LoadRepository';
import type { WorkspaceRepository } from '../../data/repositories/WorkspaceRepository';
import type { LoadSetupOptions, Project } from '../../domain/loads';
import { summarizeProjectCard, type ProjectCardSummary } from '../../domain/projectList';
import { AppButton } from '../components/AppPrimitives';
import { SearchableSelect } from '../components/SearchableSelect';
import { DatePickerField, displayDate, todayIso } from '../components/DatePickerField';
import { useReducedMotion } from '../components/ExpandableMenu';
import { FocusedSheet } from '../components/FocusedSheet';
import { colors } from '../theme';
import { EditProjectInformationScreen } from './EditProjectInformationScreen';

type LoadStatus='loading'|'error'|'ready';

export function ProjectsScreen({repository,activityRepository,onBack,onOpenProject,onProjectStatusChange}:{repository:LoadRepository;activityRepository?:Pick<WorkspaceRepository,'getLastRecordedActivityDates'>;onBack:()=>void;onOpenProject:(project:Project)=>void;onProjectStatusChange?:(project:Project,status:Project['status'])=>void}){
  const [editingProject,setEditingProject]=useState<Project|null>(null);
  const reducedMotion=useReducedMotion();
  const [setup,setSetup]=useState<LoadSetupOptions|null>(null); const [projects,setProjects]=useState<Project[]>([]); const [showForm,setShowForm]=useState(false);
  const [lastActivity,setLastActivity]=useState<Record<string,string>>({});
  const [loadStatus,setLoadStatus]=useState<LoadStatus>('loading'); const [loadError,setLoadError]=useState<string|null>(null); const [reloadToken,setReloadToken]=useState(0);
  const [customerId,setCustomerId]=useState(''); const [name,setName]=useState(''); const [location,setLocation]=useState(''); const [notes,setNotes]=useState('');
  const [search,setSearch]=useState(''); const [completedOpen,setCompletedOpen]=useState(false);
  const [managing,setManaging]=useState<Project|null>(null); const [dateEditId,setDateEditId]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null); const [message,setMessage]=useState<string|null>(null); const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{
    // Last activity is supporting information: if it cannot be read, cards simply omit it.
    const [nextSetup,nextProjects,nextActivity]=await Promise.all([repository.getSetupOptions(),repository.listProjects(),activityRepository?activityRepository.getLastRecordedActivityDates().catch(()=>({})):Promise.resolve({})]);
    setSetup(nextSetup);setProjects(nextProjects);setLastActivity(nextActivity);
  },[repository,activityRepository]);
  useEffect(()=>{let active=true;setLoadStatus('loading');setLoadError(null);refresh().then(()=>{if(active)setLoadStatus('ready');}).catch(cause=>{if(active){setLoadError(cause instanceof Error?cause.message:null);setLoadStatus('error');}});return()=>{active=false;};},[refresh,reloadToken]);
  async function create(){setBusy(true);setError(null);setMessage(null);try{await repository.createProject({customerId,name,location,notes});await refresh();setCustomerId('');setName('');setLocation('');setNotes('');setShowForm(false);setMessage('Project created and available in Reports.');}catch(cause){setError(cause instanceof Error?cause.message:'Could not create project.');}finally{setBusy(false);}}
  async function applyStatusChange(project:Project,next:Project['status']){setBusy(true);setError(null);try{await repository.updateProjectStatus(project.id,next);onProjectStatusChange?.(project,next);await refresh();setMessage(next==='completed'?'Project marked completed.':'Project reactivated and available for new reports.');}catch(cause){setError(cause instanceof Error?cause.message:'Could not update project.');}finally{setBusy(false);}}
  function requestStatusChange(project:Project){
    if(project.status==='active'){
      Alert.alert(
        'Mark this project completed?',
        `"${project.name}" will stop accepting new loads and daily reports until it is reactivated. All existing records, exports, and history remain fully available.`,
        [
          {text:'Keep Project Active',style:'cancel'},
          {text:'Mark Completed',style:'destructive',onPress:()=>void applyStatusChange(project,'completed')},
        ],
      );
    }else{
      void applyStatusChange(project,'active');
    }
  }
  async function saveStartDate(project:Project,startDate:string){const updated=await repository.updateProjectStartDate(project.id,startDate);setProjects((current)=>current.map((p)=>p.id===updated.id?updated:p));setDateEditId(null);setMessage('Project start date updated. Records before the old start date may now be selectable.');}
  /** Sheet actions close the sheet first: the next step opens its own screen, alert, or date picker. */
  function manage(action:'information'|'startDate'|'status'){
    const project=managing;setManaging(null);if(!project)return;
    if(action==='information')setEditingProject(project);
    else if(action==='startDate'){if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setDateEditId(project.id);}
    else requestStatusChange(project);
  }
  function toggleCompleted(){if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setCompletedOpen((value)=>!value);}
  const query=search.trim().toLocaleLowerCase('en-US');
  const matches=useCallback((p:Project)=>!query||`${p.name} ${p.customerName} ${p.location}`.toLocaleLowerCase('en-US').includes(query),[query]);
  const byName=(a:Project,b:Project)=>a.name.localeCompare(b.name);
  const activeAll=useMemo(()=>projects.filter((v)=>v.status==='active').sort(byName),[projects]);
  const completedAll=useMemo(()=>projects.filter((v)=>v.status==='completed').sort(byName),[projects]);
  const active=useMemo(()=>activeAll.filter(matches),[activeAll,matches]);
  const completed=useMemo(()=>completedAll.filter(matches),[completedAll,matches]);
  const hasQuery=query.length>0;
  if(loadStatus==='error')return <View style={styles.stateScreen}>
    <Text style={styles.stateTitle}>Projects could not be loaded</Text>
    <Text style={styles.stateBody}>{loadError??'The project list could not be read from this device.'} Your records are unchanged.</Text>
    <View style={styles.stateActions}><AppButton label="Try again" onPress={()=>setReloadToken((value)=>value+1)}/><AppButton label="Back" tone="secondary" onPress={onBack}/></View>
  </View>;
  if(loadStatus==='loading'||!setup)return <View style={styles.stateScreen}><ActivityIndicator size="large" color={colors.brand}/><Text style={styles.stateBody}>Loading projects…</Text></View>;
  if(editingProject)return <EditProjectInformationScreen repository={repository} project={editingProject} onBack={()=>setEditingProject(null)} onSaved={updated=>{setEditingProject(null);setProjects(current=>current.map(value=>value.id===updated.id?updated:value));}}/>;
  const list=(items:Project[])=><View style={styles.list}>{items.map((p,index)=><View key={p.id}>
    {index?<View style={styles.divider}/>:null}
    <ProjectCard summary={summarizeProjectCard(p,lastActivity[p.id])} onOpen={()=>onOpenProject(p)} onManage={()=>setManaging(p)} disabled={busy}/>
    {dateEditId===p.id?<StartDateEditor project={p} onSave={(startDate)=>saveStartDate(p,startDate)} onCancel={()=>setDateEditId(null)}/>:null}
  </View>)}</View>;
  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.hero}>
      <View style={styles.heroTopRow}>
        <TouchableOpacity onPress={onBack} style={styles.heroBack} accessibilityRole="button" accessibilityLabel="Back"><Text style={styles.heroBackText}>Back</Text></TouchableOpacity>
        <View style={styles.flex}><Text style={styles.heroEyebrow}>DIRECTORY</Text><Text style={styles.heroTitle}>Projects</Text></View>
      </View>
      <Text style={styles.heroPurpose}>Manage active and completed projects used across receipts, reports, and schedules.</Text>
      <View style={styles.heroSummaryRow}>
        <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{activeAll.length}</Text><Text style={styles.heroSummaryLabel}>ACTIVE</Text></View>
        <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{completedAll.length}</Text><Text style={styles.heroSummaryLabel}>COMPLETED</Text></View>
        <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{projects.length}</Text><Text style={styles.heroSummaryLabel}>TOTAL</Text></View>
      </View>
    </View>
    {error?<Text style={styles.error} accessibilityRole="alert">{error}</Text>:null}{message?<Text style={styles.success} accessibilityRole="text">{message}</Text>:null}
    <TouchableOpacity style={styles.primary} onPress={()=>setShowForm(!showForm)} accessibilityRole="button" accessibilityLabel={showForm?'Close create project form':'Create Project'} accessibilityState={{expanded:showForm}}><Text style={styles.primaryText}>{showForm?'Close form':'Create Project'}</Text></TouchableOpacity>
    {showForm?<View style={styles.card}><Text style={styles.cardTitle}>New project</Text><SearchableSelect label="Customer / company *" options={setup.customers.map((c)=>({id:c.id,label:c.name,detail:c.isOwnCompany?'Own company':c.type}))} selectedId={customerId} onSelect={setCustomerId}/><Field label="Project name *" value={name} onChangeText={setName}/><Field label="Location / destination *" value={location} onChangeText={setLocation} multiline/><Field label="Notes" value={notes} onChangeText={setNotes} multiline/><TouchableOpacity style={styles.save} disabled={busy} onPress={()=>void create()} accessibilityRole="button" accessibilityLabel="Save Project" accessibilityState={{disabled:busy,busy}}><Text style={styles.saveText}>{busy?'Saving…':'Save Project'}</Text></TouchableOpacity></View>:null}
    {projects.length?<View style={styles.searchBar}>
      <Text style={styles.searchGlyph}>⌕</Text>
      <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search by name, customer, or location" placeholderTextColor="#6B7681" accessibilityLabel="Search projects by name, customer, or location"/>
      {search.length?<TouchableOpacity style={styles.searchClear} onPress={()=>setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={styles.searchClearText}>×</Text></TouchableOpacity>:null}
    </View>:null}
    <View style={styles.sectionHeadingRow}><Text style={styles.sectionTitle}>Active projects</Text><Text style={styles.sectionCount}>{hasQuery?`${active.length} of ${activeAll.length}`:activeAll.length}</Text></View>
    {active.length?list(active):<Empty title={hasQuery?'No matches':'No active projects yet'} body={hasQuery?`No active projects match "${search.trim()}".`:'Create one above to get started.'} onClearSearch={hasQuery?()=>setSearch(''):undefined}/>}
    <TouchableOpacity activeOpacity={.75} style={styles.completedBand} onPress={toggleCompleted} accessibilityRole="button" accessibilityState={{expanded:completedOpen}} accessibilityLabel={`Completed projects, ${completedAll.length} project${completedAll.length===1?'':'s'}`}>
      <View style={styles.flex}>
        <Text style={styles.completedBandTitle}>Completed projects</Text>
        <Text style={styles.completedBandHint}>{completedOpen?'Tap to hide':'Tap to view'} · {completedAll.length} project{completedAll.length===1?'':'s'}</Text>
      </View>
      <Text style={styles.expandMark}>{completedOpen?'×':'+'}</Text>
    </TouchableOpacity>
    {completedOpen?(completed.length?list(completed):<Empty title={hasQuery?'No matches':'No completed projects yet'} body={hasQuery?`No completed projects match "${search.trim()}".`:'Projects you mark completed will appear here.'} onClearSearch={hasQuery?()=>setSearch(''):undefined}/>):null}
    <ManageProjectSheet project={managing} busy={busy} onAction={manage} onClose={()=>setManaging(null)}/>
  </ScrollView>;
}

/**
 * One project in the list: name, status in words, location, start date, and last recorded activity
 * when there is one. The whole row opens the project; Manage is the only other control.
 */
function ProjectCard({summary,onOpen,onManage,disabled}:{summary:ProjectCardSummary;onOpen:()=>void;onManage:()=>void;disabled:boolean}){
  const completed=summary.status==='Completed';
  return <View style={styles.row}>
    <Pressable onPress={onOpen} style={({pressed})=>[styles.rowOpen,pressed&&styles.pressed]} android_ripple={{color:'#EFE9DF'}} accessibilityRole="button" accessibilityLabel={`Open ${summary.name}`} accessibilityHint="Opens the Project Command Center">
      <View style={styles.rowTop}>
        <Text style={styles.rowName} numberOfLines={2}>{summary.name}</Text>
        <View style={[styles.status,completed?styles.statusCompleted:styles.statusActive]}>
          <View style={[styles.statusDot,{backgroundColor:completed?colors.muted:colors.success}]}/>
          <Text style={[styles.statusText,{color:completed?colors.muted:colors.success}]}>{summary.status}</Text>
        </View>
      </View>
      {summary.location?<Text style={styles.rowLocation} numberOfLines={2}>{summary.location}</Text>:<Text style={styles.rowAbsent}>Location not recorded</Text>}
      <View style={styles.rowMeta}>
        <Text style={styles.metaItem}>{summary.startDate?<>Started <Text style={styles.metaValue}>{displayDate(summary.startDate)}</Text></>:'Start date not recorded'}</Text>
        {summary.lastActivityDate?<Text style={styles.metaItem}>Last activity <Text style={styles.metaValue}>{displayDate(summary.lastActivityDate)}</Text></Text>:null}
      </View>
    </Pressable>
    <Pressable onPress={onManage} disabled={disabled} style={({pressed})=>[styles.manage,pressed&&styles.pressed,disabled&&styles.disabled]} accessibilityRole="button" accessibilityLabel={`Manage ${summary.name}`} accessibilityHint="Edit information, change the start date, or change the project status" accessibilityState={{disabled}}>
      <Text style={styles.manageText}>Manage</Text>
    </Pressable>
  </View>;
}

function ManageProjectSheet({project,busy,onAction,onClose}:{project:Project|null;busy:boolean;onAction:(action:'information'|'startDate'|'status')=>void;onClose:()=>void}){
  const completed=project?.status==='completed';
  return <FocusedSheet visible={!!project} eyebrow="MANAGE PROJECT" title={project?.name??''} onClose={onClose} footer={<View style={styles.flex}><AppButton label="Done" tone="secondary" onPress={onClose}/></View>}>
    {project?<>
      <Text style={styles.sheetContext}>{project.customerName} · {project.location}</Text>
      <View style={styles.list}>
        <SheetAction title="Edit information" hint="Name, location, and notes. Records and payments are not affected." onPress={()=>onAction('information')} disabled={busy}/>
        <View style={styles.divider}/>
        <SheetAction title="Change start date" hint={`Currently ${project.startDate?displayDate(project.startDate):'not recorded'}.`} onPress={()=>onAction('startDate')} disabled={busy}/>
        <View style={styles.divider}/>
        <SheetAction title={completed?'Reactivate project':'Mark completed'} hint={completed?'Allows new loads, reports, issues, and photos again.':'Stops new loads and daily reports. History and exports stay available.'} onPress={()=>onAction('status')} disabled={busy}/>
      </View>
    </>:null}
  </FocusedSheet>;
}

function SheetAction({title,hint,onPress,disabled}:{title:string;hint:string;onPress:()=>void;disabled:boolean}){
  return <Pressable onPress={onPress} disabled={disabled} style={({pressed})=>[styles.sheetAction,pressed&&styles.pressed,disabled&&styles.disabled]} android_ripple={{color:'#EFE9DF'}} accessibilityRole="button" accessibilityLabel={title} accessibilityHint={hint} accessibilityState={{disabled}}>
    <View style={styles.flex}><Text style={styles.sheetActionTitle}>{title}</Text><Text style={styles.sheetActionHint}>{hint}</Text></View>
    <Text style={styles.chevron}>›</Text>
  </Pressable>;
}

function StartDateEditor({project,onSave,onCancel}:{project:Project;onSave:(startDate:string)=>Promise<void>;onCancel:()=>void}){
  const[value,setValue]=useState(project.startDate??todayIso());const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);
  async function save(){setBusy(true);setError(null);try{await onSave(value);}catch(cause){setError(cause instanceof Error?cause.message:'Could not update the start date.');}finally{setBusy(false);}}
  return <View style={styles.dateEdit}>
    <DatePickerField label={`Start date for ${project.name}`} value={value} onChange={setValue} maxDate={todayIso()}/>
    <Text style={styles.dateHint}>Moving the start date later is blocked if any confirmed load, supplier load, fuel movement, daily report, or waste dump for this project falls before the new date.</Text>
    {error?<Text style={styles.error} accessibilityRole="alert">{error}</Text>:null}
    <View style={styles.dateEditActions}><TouchableOpacity style={styles.dateSave} disabled={busy} onPress={()=>void save()} accessibilityRole="button" accessibilityLabel={`Save start date for ${project.name}`} accessibilityState={{disabled:busy,busy}}><Text style={styles.dateSaveText}>{busy?'Saving…':'Save Start Date'}</Text></TouchableOpacity><TouchableOpacity style={styles.dateCancel} disabled={busy} onPress={onCancel} accessibilityRole="button" accessibilityLabel={`Cancel editing start date for ${project.name}`} accessibilityState={{disabled:busy}}><Text style={styles.dateCancelText}>Cancel</Text></TouchableOpacity></View>
  </View>;
}
function Empty({title,body,onClearSearch}:{title:string;body:string;onClearSearch?:()=>void}){return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.helper}>{body}</Text>{onClearSearch?<TouchableOpacity style={styles.emptyClear} onPress={onClearSearch} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={styles.emptyClearText}>Clear search</Text></TouchableOpacity>:null}</View>}
function Field({label,...props}:{label:string;value:string;onChangeText:(v:string)=>void;multiline?:boolean}){return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input,props.multiline&&styles.multiline]} placeholderTextColor="#6B7681" accessibilityLabel={label} {...props}/></View>}
const styles=StyleSheet.create({content:{padding:20,paddingBottom:42,gap:16},helper:{color:colors.muted,fontSize:13,lineHeight:19},flex:{flex:1,minWidth:0},
  stateScreen:{flex:1,alignItems:'center',justifyContent:'center',gap:12,padding:24},stateTitle:{color:colors.ink,fontSize:19,fontWeight:'800',textAlign:'center'},stateBody:{color:colors.muted,fontSize:14,lineHeight:20,textAlign:'center',maxWidth:320},stateActions:{alignSelf:'stretch',gap:10,marginTop:4},
  hero:{backgroundColor:colors.navy,borderRadius:18,padding:18,gap:12,shadowColor:colors.navyDeep,shadowOpacity:.22,shadowRadius:8,shadowOffset:{width:0,height:4},elevation:4},
  heroTopRow:{flexDirection:'row',alignItems:'center',gap:12},
  heroBack:{minHeight:48,minWidth:48,paddingHorizontal:14,borderRadius:10,backgroundColor:'rgba(255,255,255,0.14)',alignItems:'center',justifyContent:'center'},heroBackText:{color:'#FFF8ED',fontWeight:'800'},
  heroEyebrow:{color:'#F2A184',fontSize:11,fontWeight:'900',letterSpacing:1.4},heroTitle:{color:'#FFF8ED',fontSize:27,fontWeight:'900',marginTop:2},
  heroPurpose:{color:'#D5E4EF',fontSize:12,lineHeight:17},
  heroSummaryRow:{flexDirection:'row',gap:12,marginTop:2,paddingTop:12,borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.22)'},
  heroSummaryItem:{flex:1,gap:2},heroSummaryValue:{color:'#FFF8ED',fontSize:20,fontWeight:'900',fontVariant:['tabular-nums']},heroSummaryLabel:{color:'#D5E4EF',fontSize:9,fontWeight:'800',letterSpacing:.6},
  primary:{minHeight:48,backgroundColor:colors.brand,borderRadius:14,padding:15,alignItems:'center',justifyContent:'center'},primaryText:{color:'#FFF',fontSize:17,fontWeight:'900'},
  sectionHeadingRow:{flexDirection:'row',alignItems:'baseline',gap:8,marginTop:4},
  sectionTitle:{color:colors.ink,fontSize:18,fontWeight:'800'},sectionCount:{color:colors.muted,fontWeight:'700',fontSize:13,fontVariant:['tabular-nums']},
  card:{backgroundColor:colors.surface,borderRadius:16,padding:17,gap:12},cardTitle:{color:colors.ink,fontSize:17,fontWeight:'900'},
  field:{gap:6},label:{color:colors.ink,fontSize:13,fontWeight:'800'},input:{minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,paddingVertical:11,color:colors.ink,backgroundColor:'#FCFBF8'},multiline:{minHeight:72,textAlignVertical:'top'},
  save:{minHeight:48,backgroundColor:colors.ink,borderRadius:11,padding:13,alignItems:'center',justifyContent:'center'},saveText:{color:'#FFF',fontWeight:'900'},
  searchBar:{flexDirection:'row',alignItems:'center',gap:10,minHeight:52,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:14},
  searchGlyph:{color:colors.brand,fontSize:19,fontWeight:'900'},searchInput:{flex:1,color:colors.ink,fontSize:14,fontWeight:'600',paddingVertical:12},
  searchClear:{minHeight:48,minWidth:48,alignItems:'center',justifyContent:'center'},searchClearText:{color:colors.muted,fontSize:20,fontWeight:'800'},
  error:{color:colors.danger,backgroundColor:'#FCE8E6',padding:12,borderRadius:10,fontWeight:'700'},success:{color:colors.success,backgroundColor:'#E5F3EC',padding:12,borderRadius:10,fontWeight:'700'},
  empty:{borderWidth:1,borderColor:colors.line,borderStyle:'dashed',borderRadius:14,padding:18,gap:5},emptyTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},emptyClear:{minHeight:44,justifyContent:'center',alignSelf:'flex-start',marginTop:2},emptyClearText:{color:colors.brandDark,fontWeight:'800',fontSize:13},
  completedBand:{minHeight:56,backgroundColor:colors.creamSoft,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},
  completedBandTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},completedBandHint:{color:'#5A6570',fontSize:12,marginTop:2},
  expandMark:{color:colors.brandDark,fontSize:24,fontWeight:'700',width:28,textAlign:'center'},
  // One grouped surface with hairline dividers instead of a separately bordered card per project.
  list:{backgroundColor:colors.surface,borderRadius:16,overflow:'hidden'},
  divider:{height:StyleSheet.hairlineWidth,backgroundColor:colors.line,marginHorizontal:16},
  row:{flexDirection:'row',alignItems:'stretch'},
  rowOpen:{flex:1,minWidth:0,paddingVertical:15,paddingLeft:16,paddingRight:8,gap:4},
  pressed:{backgroundColor:'#F7F4EE'},disabled:{opacity:.4},
  rowTop:{flexDirection:'row',alignItems:'flex-start',gap:10},
  rowName:{flex:1,minWidth:0,color:colors.ink,fontSize:17,lineHeight:22,fontWeight:'700'},
  rowLocation:{color:'#4F5B66',fontSize:14,lineHeight:19},
  rowAbsent:{color:colors.muted,fontSize:13,fontStyle:'italic'},
  rowMeta:{flexDirection:'row',flexWrap:'wrap',columnGap:14,rowGap:2,marginTop:4},
  metaItem:{color:colors.muted,fontSize:12,lineHeight:17},metaValue:{color:colors.ink,fontWeight:'600',fontVariant:['tabular-nums']},
  status:{flexDirection:'row',alignItems:'center',gap:5,paddingHorizontal:8,paddingVertical:3,borderRadius:10,flexShrink:0,marginTop:1},
  statusActive:{backgroundColor:'#E5F3EC'},statusCompleted:{borderWidth:1,borderColor:colors.line},
  statusDot:{width:6,height:6,borderRadius:3},statusText:{fontSize:12,fontWeight:'700'},
  manage:{minWidth:76,minHeight:48,alignItems:'center',justifyContent:'center',paddingHorizontal:10,borderLeftWidth:StyleSheet.hairlineWidth,borderLeftColor:colors.line,marginVertical:12},
  manageText:{color:colors.brandDark,fontSize:13,fontWeight:'700'},
  sheetContext:{color:'#4F5B66',fontSize:14,lineHeight:20},
  sheetAction:{minHeight:64,flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14,paddingHorizontal:16},
  sheetActionTitle:{color:colors.ink,fontSize:16,fontWeight:'700'},sheetActionHint:{color:colors.muted,fontSize:13,lineHeight:18,marginTop:2},
  chevron:{color:colors.navy,fontSize:22,fontWeight:'700'},
  dateEdit:{gap:10,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,backgroundColor:'#FCFBF8',padding:16},dateHint:{color:colors.muted,fontSize:12,lineHeight:17},
  dateEditActions:{flexDirection:'row',gap:8},dateSave:{flex:1,minHeight:48,backgroundColor:colors.ink,borderRadius:10,alignItems:'center',justifyContent:'center'},dateSaveText:{color:'#FFF',fontWeight:'900'},dateCancel:{flex:1,minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:10,alignItems:'center',justifyContent:'center'},dateCancelText:{color:colors.muted,fontWeight:'800'},
});
