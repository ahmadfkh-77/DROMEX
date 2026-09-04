import {useCallback,useEffect,useState,type ReactNode} from 'react';
import {ActivityIndicator,Image,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import type {WorkspaceRepository} from '../../data/repositories/WorkspaceRepository';
import type {Project} from '../../domain/loads';
import {emptyWorkspaceIssue,groupWorkspaceActivities,type ProjectWorkspaceSnapshot,type WorkspaceActivity,type WorkspaceIssue,type WorkspaceIssueDraft} from '../../domain/workspace';
import {capturePersistentImage,pickPersistentImage} from '../../services/media';
import {AppButton,AppCard,AppField,AppPage,EmptyState,Feedback,MetricCard,PageHeader} from '../components/AppPrimitives';
import {DatePickerField,todayIso} from '../components/DatePickerField';
import {ExpandableMenuSection,MenuAction} from '../components/ExpandableMenu';
import {colors} from '../theme';

type Routes={onSchedule:()=>void;onPavement:()=>void;onWalls:()=>void;onDailyReport:()=>void;onReceipt:()=>void;onWaste:()=>void;onFuel:()=>void;onQuarry:()=>void;onQuickText:()=>void;onLoads:()=>void;onReports:()=>void;onManageProject:()=>void};
type ScreenStatus='loading'|'error'|'ready';
const PHOTO_PAGE=8;
const priorityColor:Record<WorkspaceIssue['priority'],string>={Urgent:colors.danger,High:colors.warning,Normal:colors.navy,Low:colors.muted};
const priorityTint:Record<WorkspaceIssue['priority'],string>={Urgent:'#FCE8E6',High:'#FFF3D8',Normal:'#E8F0F7',Low:'#F1EFEA'};

export function ProjectCommandCenterScreen({project,repository,routes,onBack,initialPanel}:{project:Project;repository:WorkspaceRepository;routes:Routes;onBack:()=>void;initialPanel?:'issues'|'photos'|null}){
  const[status,setStatus]=useState<ScreenStatus>('loading');
  const[loadError,setLoadError]=useState<string|null>(null);
  const[reloadToken,setReloadToken]=useState(0);
  const[snapshot,setSnapshot]=useState<ProjectWorkspaceSnapshot|null>(null);
  const[open,setOpen]=useState<Set<string>>(()=>new Set(initialPanel?[initialPanel]:[]));
  const[issueDraft,setIssueDraft]=useState<WorkspaceIssueDraft>(emptyWorkspaceIssue);
  const[showIssueForm,setShowIssueForm]=useState(initialPanel==='issues');
  const[photoCaption,setPhotoCaption]=useState('');
  const[photoLimit,setPhotoLimit]=useState(PHOTO_PAGE);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[message,setMessage]=useState<string|null>(null);
  const[timelineFrom,setTimelineFrom]=useState('');
  const[timelineTo,setTimelineTo]=useState('');
  const[timelineActivities,setTimelineActivities]=useState<WorkspaceActivity[]|null>(null);
  const[timelineBusy,setTimelineBusy]=useState(false);
  const refresh=useCallback(async()=>{const value=await repository.getProjectWorkspace(project.id);setSnapshot(value);},[project.id,repository]);
  useEffect(()=>{let active=true;setStatus('loading');setLoadError(null);void refresh().then(()=>{if(active)setStatus('ready');}).catch(cause=>{if(active){setLoadError(cause instanceof Error?cause.message:'Could not load the project command center.');setStatus('error');}});return()=>{active=false;};},[refresh,reloadToken]);
  const toggle=(key:string)=>setOpen(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});
  async function run(action:()=>Promise<void>,success:string){setBusy(true);setError(null);setMessage(null);try{await action();await refresh();setMessage(success);}catch(cause){setError(cause instanceof Error?cause.message:'The project action could not be completed.');}finally{setBusy(false);}}
  function addIssue(){void run(async()=>{await repository.createIssue(project.id,issueDraft);setIssueDraft(emptyWorkspaceIssue);setShowIssueForm(false);},'Project issue added.');}
  function resolveIssue(id:string,resolved:boolean){void run(()=>repository.setIssueResolved(id,resolved),resolved?'Issue resolved.':'Issue reopened.');}
  async function addPhoto(source:'camera'|'library'){setBusy(true);setError(null);try{const uri=source==='camera'?await capturePersistentImage('project-workspace'):await pickPersistentImage('project-workspace');if(!uri)return;await repository.addProjectPhoto(project.id,uri,photoCaption);setPhotoCaption('');await refresh();setMessage('Site photo added to the project.');}catch(cause){setError(cause instanceof Error?cause.message:'Could not add the project photo.');}finally{setBusy(false);}}
  async function filterTimeline(){setTimelineBusy(true);setError(null);try{setTimelineActivities(await repository.listProjectActivities(project.id,timelineFrom,timelineTo));}catch(cause){setError(cause instanceof Error?cause.message:'Could not filter project activity.');}finally{setTimelineBusy(false);}}
  function clearTimeline(){setTimelineFrom('');setTimelineTo('');setTimelineActivities(null);setError(null);}

  if(status==='loading')return <AppPage><PageHeader eyebrow="PROJECT COMMAND CENTER" title={project.name} onBack={onBack}/><View style={styles.centerState}><ActivityIndicator color={colors.brand}/><Text style={styles.centerStateText}>Loading {project.name}…</Text></View></AppPage>;
  if(status==='error')return <AppPage><PageHeader eyebrow="PROJECT COMMAND CENTER" title={project.name} onBack={onBack}/><View style={styles.centerState}><Text style={styles.centerStateTitle}>Could not open this project</Text><Text style={styles.centerStateText}>{loadError}</Text><AppButton label="Retry" onPress={()=>setReloadToken(value=>value+1)}/></View></AppPage>;
  if(!snapshot)return null;

  const m=snapshot.metrics,activityGroups=groupWorkspaceActivities(snapshot.activities),visibleTimeline=timelineActivities??snapshot.activities.slice(0,20),projectStart=snapshot.project.startDate??'',projectEnd=snapshot.project.status==='completed'?(snapshot.project.endDate??todayIso()):todayIso();
  const visiblePhotos=snapshot.photos.slice(0,photoLimit),morePhotos=snapshot.photos.length-visiblePhotos.length;

  return <AppPage keyboard>
    <PageHeader eyebrow="PROJECT COMMAND CENTER" title={project.name} onBack={onBack}/>
    <AppCard tone="navy" title={project.name} hint={`${project.customerName} · ${project.location}`}>
      <View style={styles.heroRow}>
        <View style={[styles.status,project.status==='completed'&&styles.completed]}><Text style={styles.statusText}>{project.status.toUpperCase()}</Text></View>
        <AppButton label="Manage Project" tone="secondary" onPress={routes.onManageProject}/>
      </View>
      <Text style={styles.projectDates}>Project period · {projectStart||'Start not recorded'} → {snapshot.project.status==='completed'?projectEnd:'Active / today'}</Text>
      {project.notes?<Text style={styles.heroNotes}>{project.notes}</Text>:null}
    </AppCard>
    {project.status==='completed'?<Feedback kind="warning">This project is read-only. Reactivate it from Projects before adding new work, issues, or photos.</Feedback>:null}
    {error?<Feedback kind="error">{error}</Feedback>:null}
    {message?<Feedback kind="success">{message}</Feedback>:null}

    <MetricGroup label="Site Activity">
      <MetricCard label="Loads" value={String(m.loads)}/>
      <MetricCard label="Delivered" value={`${m.netTonnes.toFixed(1)} t`}/>
      <MetricCard label="Supplier Loads" value={String(m.quarryPurchases)}/>
      <MetricCard label="Waste Dumps" value={String(m.wasteDumps)}/>
      <MetricCard label="Fuel Used" value={`${m.fuelLitres.toFixed(0)} L`}/>
    </MetricGroup>
    <MetricGroup label="Project Control">
      <MetricCard label="Daily Reports" value={String(m.dailyReports)}/>
      <MetricCard label="Open Issues" value={String(m.openIssues)} accent={m.openIssues>0}/>
    </MetricGroup>
    <MetricGroup label="Planning & Engineering">
      <MetricCard label="Open Schedule" value={String(m.scheduled)}/>
      <MetricCard label="Pavement Calculations" value={String(m.pavementCalculations)}/>
      <MetricCard label="Walls" value={String(m.walls)}/>
    </MetricGroup>

    <ExpandableMenuSection title="Planning and Today" hint="Open the project plan, calculate construction quantities, or record today's work." marker="01" refined polished open={open.has('planning')} onToggle={()=>toggle('planning')}>
      <Text style={styles.groupLabel}>PLAN &amp; CALCULATE</Text>
      <MenuAction refined polished number="01" title="Project Schedule" body="All tasks stay locked under this project." onPress={routes.onSchedule}/>
      <MenuAction refined polished number="02" title="Asphalt Pavement Calculator" body="Choose kg/m² and save this project's layer quantities." onPress={routes.onPavement}/>
      <MenuAction refined polished number="03" title="Wall Construction" body="Calculate walls and record actual concrete, steel, stone, and site-mix consumption." onPress={routes.onWalls}/>
      <Text style={styles.groupLabel}>RECORD TODAY</Text>
      <MenuAction refined polished number="04" title="Make Daily Report" body="Record work, people, materials, issues, time, and photos." onPress={routes.onDailyReport}/>
      <MenuAction refined polished number="05" title="Make Receipt" body="Start a load with this project already selected." onPress={routes.onReceipt}/>
    </ExpandableMenuSection>

    <ExpandableMenuSection title="Field Operations" hint="Fast project-linked entries for site and plant work." marker="02" refined polished open={open.has('operations')} onToggle={()=>toggle('operations')}>
      <MenuAction refined polished number="01" title="Waste Dumps" body="Open this project's driver/truck counters and history." onPress={routes.onWaste}/>
      <MenuAction refined polished number="02" title="Equipment Fuel" body="Record equipment fills under this project." onPress={routes.onFuel}/>
      <MenuAction refined polished number="03" title="Supplier Loads" body="Record incoming material for this project." onPress={routes.onQuarry}/>
      <MenuAction refined polished number="04" title="Quick Text" body="Create a project-linked company document." onPress={routes.onQuickText}/>
    </ExpandableMenuSection>

    <ExpandableMenuSection title="Issues" hint={`${m.openIssues} open · record blockers, delays, and follow-up work.`} marker="03" refined polished open={open.has('issues')} onToggle={()=>toggle('issues')}>
      {project.status==='active'?<AppButton label={showIssueForm?'Close Issue Form':'+ Add Project Issue'} onPress={()=>setShowIssueForm(value=>!value)}/>:null}
      {showIssueForm?<AppCard title="New project issue" hint="Use a short title and only the detail needed for follow-up.">
        <AppField label="Issue title *" value={issueDraft.title} onChangeText={value=>setIssueDraft({...issueDraft,title:value})}/>
        <AppField label="Description" value={issueDraft.description} onChangeText={value=>setIssueDraft({...issueDraft,description:value})} multiline/>
        <Text style={styles.label}>Priority</Text>
        <View style={styles.priorityRow}>{(['Low','Normal','High','Urgent'] as const).map(priority=><TouchableOpacity key={priority} style={[styles.priority,issueDraft.priority===priority&&styles.priorityOn]} onPress={()=>setIssueDraft({...issueDraft,priority})} accessibilityRole="button" accessibilityState={{selected:issueDraft.priority===priority}}><Text style={[styles.priorityText,issueDraft.priority===priority&&styles.priorityTextOn]}>{priority}</Text></TouchableOpacity>)}</View>
        <DatePickerField label="Due date" value={issueDraft.dueDate} onChange={value=>setIssueDraft({...issueDraft,dueDate:value})} allowClear/>
        <AppButton label="Save Issue" busy={busy} onPress={addIssue}/>
      </AppCard>:null}
      {snapshot.issues.length?snapshot.issues.map(item=><IssueRow key={item.id} issue={item} busy={busy} canAct={project.status==='active'} onToggleResolved={()=>resolveIssue(item.id,item.status==='Open')}/>):<EmptyState title="No project issues" body="Open issues and resolved follow-ups will be kept here."/>}
    </ExpandableMenuSection>

    <ExpandableMenuSection title="Photos" hint={`${snapshot.photos.length} site photo${snapshot.photos.length===1?'':'s'} saved directly under this project.`} marker="04" refined polished open={open.has('photos')} onToggle={()=>toggle('photos')}>
      {project.status==='active'?<><AppField label="Photo caption" value={photoCaption} onChangeText={setPhotoCaption} placeholder="Area, activity, or reason for the photo"/><View style={styles.photoActions}><AppButton label="Take Site Photo" tone="navy" busy={busy} onPress={()=>void addPhoto('camera')}/><AppButton label="Choose Photo" tone="secondary" disabled={busy} onPress={()=>void addPhoto('library')}/></View></>:null}
      {snapshot.photos.length?<>
        <View style={styles.photoGrid}>{visiblePhotos.map(value=><View key={value.id} style={styles.photoCard}><Image source={{uri:value.uri}} style={styles.photo}/><Text style={styles.photoCaption}>{value.caption??'Site photo'}</Text><Text style={styles.photoDate}>{new Date(value.createdAt).toLocaleString()}</Text></View>)}</View>
        {morePhotos>0?<AppButton label={`Show More Photos (${morePhotos} more)`} tone="secondary" onPress={()=>setPhotoLimit(value=>value+PHOTO_PAGE)}/>:null}
      </>:<EmptyState title="No project photos" body="Add site evidence here or keep detailed daily-report photos in Daily Reports."/>}
    </ExpandableMenuSection>

    <ExpandableMenuSection title="All Activity Timeline" hint={timelineActivities?`${visibleTimeline.length}${visibleTimeline.length===500?' latest':''} matching records · ${timelineFrom||projectStart} to ${timelineTo||projectEnd}. Date filtering applies to this combined timeline only.`:`Latest ${visibleTimeline.length} records across all activity types · project period ${projectStart} to ${projectEnd}. Date filtering applies to this combined timeline only.`} marker="05" refined polished open={open.has('timeline')} onToggle={()=>toggle('timeline')}>
      <AppCard title="Filter timeline by date" hint={`Available project period: ${projectStart} to ${projectEnd}${snapshot.project.status==='active'?' (today)':''}. Dates outside this period cannot be selected.`}>
        <View style={styles.timelineDates}><View style={styles.flex}><DatePickerField label="From date" value={timelineFrom} onChange={setTimelineFrom} minDate={projectStart||undefined} maxDate={timelineTo||projectEnd} allowClear/></View><View style={styles.flex}><DatePickerField label="To date" value={timelineTo} onChange={setTimelineTo} minDate={timelineFrom||projectStart||undefined} maxDate={projectEnd} allowClear/></View></View>
        <View style={styles.timelineActions}><View style={styles.flex}><AppButton label="Clear" tone="secondary" disabled={timelineBusy} onPress={clearTimeline}/></View><View style={styles.flex}><AppButton label="Apply Date Filter" tone="navy" busy={timelineBusy} onPress={()=>void filterTimeline()}/></View></View>
      </AppCard>
      {visibleTimeline.length?visibleTimeline.map((value,index)=><TimelineRow key={`timeline-${value.type}-${value.id}-${value.occurredAt}`} activity={value} isFirst={index===0} isLast={index===visibleTimeline.length-1}/>):<EmptyState title="No activity in this period" body="Change or clear the timeline dates to review another period."/>}
    </ExpandableMenuSection>

    <ExpandableMenuSection title="Activity by Record Type" hint={`${snapshot.activities.length} recent project records, grouped under their own labels. Each group shows its latest records independently of the timeline filter above.`} marker="06" refined polished open={open.has('activity')} onToggle={()=>toggle('activity')}>
      {activityGroups.length?activityGroups.map((group,index)=>{const key=`activity-${group.type}`;return <ExpandableMenuSection key={group.type} title={group.label} hint={`${group.activities.length===50?'Latest ':''}${group.activities.length} record${group.activities.length===1?'':'s'} · independent of the timeline date filter above`} tone="cream" marker={String(index+1).padStart(2,'0')} refined polished open={open.has(key)} onToggle={()=>toggle(key)}>{group.activities.map(value=><ActivityRow key={`${value.type}-${value.id}-${value.occurredAt}`} activity={value}/>)}</ExpandableMenuSection>;}):<EmptyState title="No project activity" body="New project-linked records will appear here automatically under their record-type label."/>}
    </ExpandableMenuSection>

    <ExpandableMenuSection title="Records and Documents" hint="Open project loads, reports, PDFs, and Excel output." marker="07" refined polished open={open.has('documents')} onToggle={()=>toggle('documents')}>
      <MenuAction refined polished number="01" title="Project Load Records" body="Open confirmed loads and documents." onPress={routes.onLoads}/>
      <MenuAction refined polished number="02" title="Project Reports" body="Daily history, completed-project PDF, and Excel exports." onPress={routes.onReports}/>
    </ExpandableMenuSection>
  </AppPage>;
}

function MetricGroup({label,children}:{label:string;children:ReactNode}){
  return <View style={styles.metricGroup}><Text style={styles.metricGroupLabel}>{label}</Text><View style={styles.metrics}>{children}</View></View>;
}

function IssueRow({issue,busy,canAct,onToggleResolved}:{issue:WorkspaceIssue;busy:boolean;canAct:boolean;onToggleResolved:()=>void}){
  const resolved=issue.status==='Resolved';const accent=resolved?colors.success:priorityColor[issue.priority];const tint=resolved?'#E5F3EC':priorityTint[issue.priority];
  return <View style={[styles.recordCard,{borderLeftColor:accent}]}>
    <View style={styles.recordTop}>
      <View style={[styles.badgePill,{backgroundColor:tint}]}><Text style={[styles.badgePillText,{color:accent}]}>{issue.priority.toUpperCase()}</Text></View>
      <Text style={[styles.recordStatus,resolved&&styles.recordStatusResolved]}>{issue.status}</Text>
    </View>
    <Text style={styles.recordTitle}>{issue.title}</Text>
    {issue.description?<Text style={styles.recordBody}>{issue.description}</Text>:null}
    {issue.dueDate?<Text style={styles.recordMeta}>Due {issue.dueDate}</Text>:null}
    {canAct?<View style={styles.recordActionWrap}><AppButton label={resolved?'Reopen Issue':'Resolve Issue'} tone="secondary" disabled={busy} onPress={onToggleResolved}/></View>:null}
  </View>;
}

function ActivityRow({activity}:{activity:WorkspaceActivity}){
  return <View style={styles.recordCard}>
    <Text style={styles.recordType}>{activity.type.toUpperCase()}</Text>
    <Text style={styles.recordTitle}>{activity.title}</Text>
    {activity.detail?<Text style={styles.recordBody}>{activity.detail}</Text>:null}
    <Text style={styles.recordMeta}>{new Date(activity.occurredAt).toLocaleString()}</Text>
  </View>;
}

function TimelineRow({activity,isFirst,isLast}:{activity:WorkspaceActivity;isFirst:boolean;isLast:boolean}){
  return <View style={styles.timelineRow}>
    <View style={styles.timelineRail}>
      <View style={isFirst?styles.timelineRailSpacer:styles.timelineRailSegment}/>
      <View style={styles.timelineDot}/>
      <View style={isLast?styles.timelineRailSpacer:styles.timelineRailSegment}/>
    </View>
    <View style={styles.timelineCard}>
      <Text style={styles.recordType}>{activity.type.toUpperCase()}</Text>
      <Text style={styles.recordTitle}>{activity.title}</Text>
      {activity.detail?<Text style={styles.recordBody}>{activity.detail}</Text>:null}
      <Text style={styles.recordMeta}>{new Date(activity.occurredAt).toLocaleString()}</Text>
    </View>
  </View>;
}

const styles=StyleSheet.create({
  centerState:{alignItems:'center',justifyContent:'center',gap:12,paddingVertical:70,paddingHorizontal:24},
  centerStateTitle:{color:colors.ink,fontSize:18,fontWeight:'700',textAlign:'center'},
  centerStateText:{color:colors.muted,fontSize:13,lineHeight:19,textAlign:'center',fontWeight:'500'},
  heroRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'#6F8FA9',paddingTop:11},
  status:{backgroundColor:colors.success,borderRadius:12,paddingHorizontal:10,paddingVertical:6,minHeight:26,justifyContent:'center'},
  completed:{backgroundColor:'#6E7680'},
  statusText:{color:'#FFF',fontSize:11,fontWeight:'900'},
  projectDates:{color:'#D5E4EF',fontSize:11,fontWeight:'600'},
  heroNotes:{color:'#E8E2D7',fontSize:12,fontStyle:'italic',fontWeight:'500'},
  metricGroup:{gap:8},
  metricGroupLabel:{color:colors.navy,fontSize:11,fontWeight:'600',letterSpacing:.6,textTransform:'uppercase'},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:8},
  label:{color:colors.ink,fontSize:13,fontWeight:'700'},
  groupLabel:{color:colors.navy,fontSize:11,fontWeight:'600',letterSpacing:.6,textTransform:'uppercase',marginTop:4,marginBottom:-2,marginLeft:2},
  priorityRow:{flexDirection:'row',flexWrap:'wrap',gap:7},
  priority:{flex:1,minWidth:68,minHeight:48,justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:10,padding:10,alignItems:'center'},
  priorityOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  priorityText:{color:colors.muted,fontSize:11,fontWeight:'600'},
  priorityTextOn:{color:'#FFF'},
  photoActions:{gap:8},
  photoGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},
  photoCard:{width:'47%',backgroundColor:colors.surface,borderRadius:13,overflow:'hidden',paddingBottom:9,shadowColor:'#17212B',shadowOpacity:.06,shadowRadius:4,shadowOffset:{width:0,height:2},elevation:1},
  photo:{width:'100%',height:125,backgroundColor:'#EEE'},
  photoCaption:{color:colors.ink,fontSize:11,fontWeight:'700',paddingHorizontal:9,marginTop:7},
  photoDate:{color:colors.muted,fontSize:11,paddingHorizontal:9,marginTop:3,fontWeight:'500'},
  timelineDates:{flexDirection:'row',gap:10},
  timelineActions:{flexDirection:'row',gap:9},
  flex:{flex:1,minWidth:0},
  recordCard:{backgroundColor:colors.surface,borderRadius:13,borderLeftWidth:3,borderLeftColor:colors.navy,padding:13,gap:3,shadowColor:'#17212B',shadowOpacity:.05,shadowRadius:4,shadowOffset:{width:0,height:2},elevation:1},
  recordTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10},
  badgePill:{alignSelf:'flex-start',paddingHorizontal:8,paddingVertical:3,borderRadius:6},
  badgePillText:{fontSize:11,fontWeight:'600',letterSpacing:.4},
  recordStatus:{color:colors.navy,fontSize:11,fontWeight:'600'},
  recordStatusResolved:{color:colors.success},
  recordType:{color:colors.navy,fontSize:11,fontWeight:'600',letterSpacing:.5},
  recordTitle:{color:colors.ink,fontSize:16,fontWeight:'700',marginTop:3},
  recordBody:{color:colors.muted,fontSize:12,lineHeight:17,marginTop:2,fontWeight:'500'},
  recordMeta:{color:colors.muted,fontSize:11,marginTop:3,fontWeight:'500'},
  recordActionWrap:{marginTop:8,alignSelf:'flex-start'},
  timelineRow:{flexDirection:'row',gap:10,marginBottom:10},
  timelineRail:{width:18,alignItems:'center'},
  timelineRailSegment:{width:2,flex:1,backgroundColor:'#DCC9AE',minHeight:6},
  timelineRailSpacer:{width:2,flex:1,minHeight:6},
  timelineDot:{width:12,height:12,borderRadius:6,backgroundColor:colors.brand,borderWidth:2,borderColor:colors.cream},
  timelineCard:{flex:1,backgroundColor:colors.surface,borderRadius:13,padding:13,gap:3,shadowColor:'#17212B',shadowOpacity:.05,shadowRadius:4,shadowOffset:{width:0,height:2},elevation:1},
});
