import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, LayoutAnimation, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { LoadRepository } from '../../data/repositories/LoadRepository';
import type { LoadSetupOptions, Project } from '../../domain/loads';
import { SearchableSelect } from '../components/SearchableSelect';
import { DatePickerField, displayDate, todayIso } from '../components/DatePickerField';
import { useReducedMotion } from '../components/ExpandableMenu';
import { colors } from '../theme';

export function ProjectsScreen({repository,onBack,onOpenProject,onProjectStatusChange}:{repository:LoadRepository;onBack:()=>void;onOpenProject:(project:Project)=>void;onProjectStatusChange?:(project:Project,status:Project['status'])=>void}){
  const reducedMotion=useReducedMotion();
  const [setup,setSetup]=useState<LoadSetupOptions|null>(null); const [projects,setProjects]=useState<Project[]>([]); const [showForm,setShowForm]=useState(false);
  const [customerId,setCustomerId]=useState(''); const [name,setName]=useState(''); const [location,setLocation]=useState(''); const [notes,setNotes]=useState('');
  const [search,setSearch]=useState(''); const [completedOpen,setCompletedOpen]=useState(false);
  const [error,setError]=useState<string|null>(null); const [message,setMessage]=useState<string|null>(null); const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{const [nextSetup,nextProjects]=await Promise.all([repository.getSetupOptions(),repository.listProjects()]);setSetup(nextSetup);setProjects(nextProjects);},[repository]);
  useEffect(()=>{void refresh();},[refresh]);
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
  async function saveStartDate(project:Project,startDate:string){const updated=await repository.updateProjectStartDate(project.id,startDate);setProjects((current)=>current.map((p)=>p.id===updated.id?updated:p));setMessage('Project start date updated. Records before the old start date may now be selectable.');}
  function toggleCompleted(){if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setCompletedOpen((value)=>!value);}
  const query=search.trim().toLocaleLowerCase('en-US');
  const matches=useCallback((p:Project)=>!query||`${p.name} ${p.customerName} ${p.location}`.toLocaleLowerCase('en-US').includes(query),[query]);
  const byName=(a:Project,b:Project)=>a.name.localeCompare(b.name);
  const activeAll=useMemo(()=>projects.filter((v)=>v.status==='active').sort(byName),[projects]);
  const completedAll=useMemo(()=>projects.filter((v)=>v.status==='completed').sort(byName),[projects]);
  const active=useMemo(()=>activeAll.filter(matches),[activeAll,matches]);
  const completed=useMemo(()=>completedAll.filter(matches),[completedAll,matches]);
  const hasQuery=query.length>0;
  if(!setup)return <View style={styles.loading}><ActivityIndicator size="large" color={colors.brand}/><Text style={styles.helper}>Loading projects…</Text></View>;
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
      <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search by name, customer, or location" placeholderTextColor="#89939B" accessibilityLabel="Search projects by name, customer, or location"/>
      {search.length?<TouchableOpacity style={styles.searchClear} onPress={()=>setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={styles.searchClearText}>×</Text></TouchableOpacity>:null}
    </View>:null}
    <View style={styles.sectionHeadingRow}><Text style={styles.sectionTitle}>Active Projects</Text><Text style={styles.sectionCount}>{activeAll.length}</Text></View>
    {active.length?active.map((p)=><ProjectCard key={p.id} project={p} busy={busy} onOpenProject={()=>onOpenProject(p)} onStatus={()=>requestStatusChange(p)} onSaveStartDate={(startDate)=>saveStartDate(p,startDate)}/>):<Empty title={hasQuery?'No matches':'No active projects yet'} body={hasQuery?`No active projects match "${search.trim()}".`:'Create one above to get started.'} onClearSearch={hasQuery?()=>setSearch(''):undefined}/>}
    <TouchableOpacity activeOpacity={.75} style={styles.completedBand} onPress={toggleCompleted} accessibilityRole="button" accessibilityState={{expanded:completedOpen}} accessibilityLabel={`Completed Projects, ${completedAll.length} project${completedAll.length===1?'':'s'}`}>
      <View style={styles.flex}>
        <Text style={styles.completedBandTitle}>Completed Projects</Text>
        <Text style={styles.completedBandHint}>{completedOpen?'Tap to hide':'Tap to view'} · {completedAll.length} project{completedAll.length===1?'':'s'}</Text>
      </View>
      <View style={styles.completedHeaderRight}><View style={styles.countBadge}><Text style={styles.countBadgeText}>{completedAll.length}</Text></View><Text style={styles.expandMark}>{completedOpen?'×':'+'}</Text></View>
    </TouchableOpacity>
    {completedOpen?(completed.length?completed.map((p)=><ProjectCard key={p.id} project={p} busy={busy} onOpenProject={()=>onOpenProject(p)} onStatus={()=>requestStatusChange(p)} onSaveStartDate={(startDate)=>saveStartDate(p,startDate)}/>):<Empty title={hasQuery?'No matches':'No completed projects yet'} body={hasQuery?`No completed projects match "${search.trim()}".`:'Projects you mark completed will appear here.'} onClearSearch={hasQuery?()=>setSearch(''):undefined}/>):null}
  </ScrollView>;
}
function ProjectCard({project,busy,onOpenProject,onStatus,onSaveStartDate}:{project:Project;busy:boolean;onOpenProject:()=>void;onStatus:()=>void;onSaveStartDate:(startDate:string)=>Promise<void>}){
  const[editingDate,setEditingDate]=useState(false);const[dateValue,setDateValue]=useState(project.startDate??todayIso());const[dateBusy,setDateBusy]=useState(false);const[dateError,setDateError]=useState<string|null>(null);
  useEffect(()=>{setDateValue(project.startDate??todayIso());},[project.startDate]);
  function openEdit(){setEditingDate(true);setDateError(null);}
  function cancelEdit(){setEditingDate(false);setDateValue(project.startDate??todayIso());setDateError(null);}
  async function save(){setDateBusy(true);setDateError(null);try{await onSaveStartDate(dateValue);setEditingDate(false);}catch(cause){setDateError(cause instanceof Error?cause.message:'Could not update the start date.');}finally{setDateBusy(false);}}
  const completed=project.status==='completed';
  return <View style={[styles.card2,completed?styles.card2Completed:styles.card2Active]}>
    <TouchableOpacity activeOpacity={.72} onPress={onOpenProject} accessibilityRole="button" accessibilityLabel={`Open Project Command Center for ${project.name}`}>
      <View style={styles.card2TopRow}>
        <Text style={styles.card2Title} numberOfLines={2}>{project.name}</Text>
        <View style={[styles.statusPill,completed?styles.statusPillCompleted:styles.statusPillActive]}>
          <View style={[styles.statusDot,completed?styles.statusDotCompleted:styles.statusDotActive]}/>
          <Text style={[styles.statusPillText,completed?styles.statusPillTextCompleted:styles.statusPillTextActive]}>{project.status}</Text>
        </View>
      </View>
      <Text style={styles.card2Meta} numberOfLines={2}>{project.customerName} · {project.location}</Text>
      {project.endDate?<Text style={styles.card2EndDate}>Ends {displayDate(project.endDate)}</Text>:null}
      {project.notes?<Text style={styles.notes} numberOfLines={3}>{project.notes}</Text>:null}
      <View style={styles.openBar}><Text style={styles.openBarText}>Open Project Command Center</Text><Text style={styles.openBarArrow}>→</Text></View>
    </TouchableOpacity>
    <View style={styles.card2Footer}>
      {!editingDate?<TouchableOpacity style={styles.dateChip} onPress={openEdit} accessibilityRole="button" accessibilityLabel={`Edit start date for ${project.name}. Currently ${project.startDate?displayDate(project.startDate):'not set'}.`}><Text style={styles.dateChipText}>Start {project.startDate?displayDate(project.startDate):'not set'} · Edit</Text></TouchableOpacity>:null}
      <TouchableOpacity style={styles.quietAction} disabled={busy} onPress={onStatus} accessibilityRole="button" accessibilityLabel={completed?`Reactivate ${project.name}`:`Mark ${project.name} as completed`} accessibilityState={{disabled:busy,busy}}><Text style={styles.quietActionText}>{completed?'Reactivate ›':'Mark Completed ›'}</Text></TouchableOpacity>
    </View>
    {editingDate?<View style={styles.dateEdit}>
        <DatePickerField label="Project start date" value={dateValue} onChange={setDateValue} maxDate={todayIso()}/>
        <Text style={styles.dateHint}>Moving the start date later is blocked if any confirmed load, supplier load, fuel movement, daily report, or waste dump for this project falls before the new date.</Text>
        {dateError?<Text style={styles.error} accessibilityRole="alert">{dateError}</Text>:null}
        <View style={styles.dateEditActions}><TouchableOpacity style={styles.dateSave} disabled={dateBusy} onPress={()=>void save()} accessibilityRole="button" accessibilityLabel={`Save start date for ${project.name}`} accessibilityState={{disabled:dateBusy,busy:dateBusy}}><Text style={styles.dateSaveText}>{dateBusy?'Saving…':'Save Start Date'}</Text></TouchableOpacity><TouchableOpacity style={styles.dateCancel} disabled={dateBusy} onPress={cancelEdit} accessibilityRole="button" accessibilityLabel={`Cancel editing start date for ${project.name}`} accessibilityState={{disabled:dateBusy}}><Text style={styles.dateCancelText}>Cancel</Text></TouchableOpacity></View>
      </View>:null}
  </View>;
}
function Empty({title,body,onClearSearch}:{title:string;body:string;onClearSearch?:()=>void}){return <View style={styles.empty}><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.helper}>{body}</Text>{onClearSearch?<TouchableOpacity style={styles.emptyClear} onPress={onClearSearch} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={styles.emptyClearText}>Clear search</Text></TouchableOpacity>:null}</View>}
function Field({label,...props}:{label:string;value:string;onChangeText:(v:string)=>void;multiline?:boolean}){return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input,props.multiline&&styles.multiline]} placeholderTextColor="#89939B" accessibilityLabel={label} {...props}/></View>}
const styles=StyleSheet.create({loading:{flex:1,alignItems:'center',justifyContent:'center',gap:10},content:{padding:20,paddingBottom:42,gap:16},helper:{color:colors.muted,fontSize:13,lineHeight:19},
  hero:{backgroundColor:colors.navy,borderRadius:18,padding:18,gap:12,shadowColor:colors.navyDeep,shadowOpacity:.22,shadowRadius:8,shadowOffset:{width:0,height:4},elevation:4},
  heroTopRow:{flexDirection:'row',alignItems:'center',gap:12},
  heroBack:{minHeight:48,minWidth:48,paddingHorizontal:14,borderRadius:10,backgroundColor:'rgba(255,255,255,0.14)',alignItems:'center',justifyContent:'center'},heroBackText:{color:'#FFF8ED',fontWeight:'800'},
  flex:{flex:1,minWidth:0},
  heroEyebrow:{color:'#F2A184',fontSize:11,fontWeight:'900',letterSpacing:1.4},heroTitle:{color:'#FFF8ED',fontSize:27,fontWeight:'900',marginTop:2},
  heroPurpose:{color:'#D5E4EF',fontSize:12,lineHeight:17},
  heroSummaryRow:{flexDirection:'row',gap:12,marginTop:2,paddingTop:12,borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.22)'},
  heroSummaryItem:{flex:1,gap:2},heroSummaryValue:{color:'#FFF8ED',fontSize:20,fontWeight:'900'},heroSummaryLabel:{color:'#D5E4EF',fontSize:9,fontWeight:'800',letterSpacing:.6},
  primary:{minHeight:48,backgroundColor:colors.brand,borderRadius:14,padding:15,alignItems:'center',justifyContent:'center'},primaryText:{color:'#FFF',fontSize:17,fontWeight:'900'},
  sectionHeadingRow:{flexDirection:'row',alignItems:'center',gap:8},
  sectionTitle:{color:colors.ink,fontSize:19,fontWeight:'900'},sectionCount:{color:colors.brandDark,backgroundColor:'#FBE9E4',paddingHorizontal:9,paddingVertical:3,borderRadius:11,fontWeight:'900',fontSize:11},
  card:{backgroundColor:colors.surface,borderRadius:16,padding:17,gap:12},cardTitle:{color:colors.ink,fontSize:17,fontWeight:'900'},
  field:{gap:6},label:{color:colors.ink,fontSize:13,fontWeight:'800'},input:{minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,paddingVertical:11,color:colors.ink,backgroundColor:'#FCFBF8'},multiline:{minHeight:72,textAlignVertical:'top'},
  save:{minHeight:48,backgroundColor:colors.ink,borderRadius:11,padding:13,alignItems:'center',justifyContent:'center'},saveText:{color:'#FFF',fontWeight:'900'},
  searchBar:{flexDirection:'row',alignItems:'center',gap:10,minHeight:52,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:14,shadowColor:'#17212B',shadowOpacity:.05,shadowRadius:4,shadowOffset:{width:0,height:2},elevation:1},
  searchGlyph:{color:colors.brand,fontSize:19,fontWeight:'900'},searchInput:{flex:1,color:colors.ink,fontSize:14,fontWeight:'600',paddingVertical:12},
  searchClear:{minHeight:32,minWidth:32,borderRadius:16,backgroundColor:'#EEEAE2',alignItems:'center',justifyContent:'center'},searchClearText:{color:colors.muted,fontSize:16,fontWeight:'900',lineHeight:18},
  notes:{color:colors.ink,fontSize:13,lineHeight:19,marginTop:6},
  error:{color:colors.danger,backgroundColor:'#FCE8E6',padding:12,borderRadius:10,fontWeight:'700'},success:{color:colors.success,backgroundColor:'#E5F3EC',padding:12,borderRadius:10,fontWeight:'700'},
  empty:{borderWidth:1,borderColor:colors.line,borderStyle:'dashed',borderRadius:14,padding:18,gap:5},emptyTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},emptyClear:{minHeight:40,justifyContent:'center',alignSelf:'flex-start',marginTop:2},emptyClearText:{color:colors.brandDark,fontWeight:'900',fontSize:12},
  completedBand:{minHeight:56,backgroundColor:colors.creamSoft,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},
  completedBandTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},completedBandHint:{color:colors.muted,fontSize:11,marginTop:2},
  completedHeaderRight:{flexDirection:'row',alignItems:'center',gap:10},
  countBadge:{minWidth:26,height:26,borderRadius:13,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,alignItems:'center',justifyContent:'center',paddingHorizontal:6},countBadgeText:{color:colors.brandDark,fontWeight:'900',fontSize:12},
  expandMark:{color:colors.brandDark,fontSize:24,fontWeight:'700',width:22,textAlign:'center'},
  card2:{borderRadius:16,borderLeftWidth:4,padding:16,gap:2},
  card2Active:{backgroundColor:colors.surface,borderLeftColor:colors.brand},
  card2Completed:{backgroundColor:'#F7F4EE',borderLeftColor:colors.navy},
  card2TopRow:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:10},
  card2Title:{flex:1,minWidth:0,color:colors.ink,fontSize:18,fontWeight:'900'},
  card2Meta:{color:colors.muted,fontSize:13,lineHeight:18,marginTop:4},
  card2EndDate:{color:colors.brandDark,fontSize:11,fontWeight:'800',marginTop:5},
  statusPill:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:10,paddingVertical:5,borderRadius:14,flexShrink:0},
  statusPillActive:{backgroundColor:'#E5F3EC'},statusPillCompleted:{backgroundColor:'transparent',borderWidth:1,borderColor:colors.line},
  statusDot:{width:6,height:6,borderRadius:3},statusDotActive:{backgroundColor:colors.success},statusDotCompleted:{backgroundColor:colors.muted},
  statusPillText:{fontWeight:'900',fontSize:11,textTransform:'capitalize'},statusPillTextActive:{color:colors.success},statusPillTextCompleted:{color:colors.muted},
  openBar:{marginTop:12,paddingTop:12,borderTopWidth:1,borderTopColor:colors.line,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  openBarText:{color:colors.brandDark,fontWeight:'900',fontSize:13},openBarArrow:{color:colors.brandDark,fontSize:18,fontWeight:'900'},
  card2Footer:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,marginTop:10},
  dateChip:{minHeight:48,justifyContent:'center',flexShrink:1,backgroundColor:colors.creamSoft,borderRadius:9,paddingHorizontal:10},dateChipText:{color:colors.navy,fontWeight:'800',fontSize:12},
  quietAction:{minHeight:48,justifyContent:'center',paddingHorizontal:4},quietActionText:{color:colors.brandDark,fontWeight:'800',fontSize:12},
  dateEdit:{gap:10,borderTopWidth:1,borderTopColor:colors.line,paddingTop:12,marginTop:6},dateHint:{color:colors.muted,fontSize:11,lineHeight:16},
  dateEditActions:{flexDirection:'row',gap:8},dateSave:{flex:1,minHeight:48,backgroundColor:colors.ink,borderRadius:10,alignItems:'center',justifyContent:'center'},dateSaveText:{color:'#FFF',fontWeight:'900'},dateCancel:{flex:1,minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:10,alignItems:'center',justifyContent:'center'},dateCancelText:{color:colors.muted,fontWeight:'800'},
});
