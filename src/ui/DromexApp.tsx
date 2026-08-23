import {useEffect,useMemo,useState,type ReactNode} from 'react';
import {Animated,AppState,SafeAreaView,StatusBar,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {useSQLiteContext} from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';

import {SqliteBusinessReportRepository} from '../data/repositories/SqliteBusinessReportRepository';
import {SqliteBackupRepository} from '../data/repositories/SqliteBackupRepository';
import {SqliteCatalogRepository} from '../data/repositories/SqliteCatalogRepository';
import {SqliteCloudRepository} from '../data/repositories/SqliteCloudRepository';
import {SqliteFinancialRepository} from '../data/repositories/SqliteFinancialRepository';
import {SqliteFuelRepository} from '../data/repositories/SqliteFuelRepository';
import {SqliteLoadRepository} from '../data/repositories/SqliteLoadRepository';
import {SqlitePavementRepository} from '../data/repositories/SqlitePavementRepository';
import {SqliteProfileRepository} from '../data/repositories/SqliteProfileRepository';
import {SqliteProjectReportRepository} from '../data/repositories/SqliteProjectReportRepository';
import {SqliteQuarryRepository} from '../data/repositories/SqliteQuarryRepository';
import {SqliteQuickTextRepository} from '../data/repositories/SqliteQuickTextRepository';
import {SqliteScheduleRepository} from '../data/repositories/SqliteScheduleRepository';
import {SqliteWasteRepository} from '../data/repositories/SqliteWasteRepository';
import {SqliteWallRepository} from '../data/repositories/SqliteWallRepository';
import {SqliteWorkspaceRepository} from '../data/repositories/SqliteWorkspaceRepository';
import type {DashboardRange} from '../domain/dashboard';
import type {CloudAccountSnapshot} from '../domain/cloud';
import type {Project} from '../domain/loads';
import type {GlobalSearchResult,GlobalSearchRoute} from '../domain/workspace';
import {CreateActionSheet,type CreateAction} from './components/CreateActionSheet';
import {AttentionScreen} from './screens/AttentionScreen';
import {AccountCloudScreen} from './screens/AccountCloudScreen';
import {BackupRestoreScreen} from './screens/BackupRestoreScreen';
import {CatalogScreen} from './screens/CatalogScreen';
import {CustomersScreen} from './screens/CustomersScreen';
import {DraftCenterScreen,type DraftRoute} from './screens/DraftCenterScreen';
import {FinancialsScreen} from './screens/FinancialsScreen';
import {FuelTrackingScreen} from './screens/FuelTrackingScreen';
import {GlobalSearchScreen} from './screens/GlobalSearchScreen';
import {HomeScreen} from './screens/HomeScreen';
import {LoadCorrectionsScreen} from './screens/LoadCorrectionsScreen';
import {LoadHistoryScreen} from './screens/LoadHistoryScreen';
import {MakeReceiptScreen} from './screens/MakeReceiptScreen';
import {PeopleEquipmentScreen} from './screens/PeopleEquipmentScreen';
import {PavementCalculatorScreen} from './screens/PavementCalculatorScreen';
import {ProjectCommandCenterScreen} from './screens/ProjectCommandCenterScreen';
import {ProjectsScreen} from './screens/ProjectsScreen';
import {QuarryPurchasesScreen} from './screens/QuarryPurchasesScreen';
import {QuickTextScreen} from './screens/QuickTextScreen';
import {ReceiptSetupScreen} from './screens/ReceiptSetupScreen';
import {ReportsScreen} from './screens/ReportsScreen';
import {ScheduleScreen} from './screens/ScheduleScreen';
import {SettingsScreen} from './screens/SettingsScreen';
import {WasteDumpScreen} from './screens/WasteDumpScreen';
import {WallConstructionScreen} from './screens/WallConstructionScreen';
import {WorkspaceHubScreen} from './screens/WorkspaceHubScreen';
import {colors} from './theme';

type Screen='home'|'projects'|'recordsHub'|'moreHub'|'projectCommand'|'search'|'drafts'|'attention'|'backup'|'cloud'|'makeReceipt'|'loads'|'loadCorrections'|'receiptSetup'|'directory'|'customers'|'catalog'|'schedule'|'pavement'|'walls'|'reports'|'quarry'|'waste'|'fuel'|'quickText'|'financials'|'settings';
type EntryIntent=CreateAction|null;
const activeProjectKey='dromex.active-project.v1';

export function DromexApp(){
  const db=useSQLiteContext();
  const backupRepository=useMemo(()=>new SqliteBackupRepository(db),[db]);
  const catalogRepository=useMemo(()=>new SqliteCatalogRepository(db),[db]);
  const cloudRepository=useMemo(()=>new SqliteCloudRepository(db),[db]);
  const businessReportRepository=useMemo(()=>new SqliteBusinessReportRepository(db),[db]);
  const profileRepository=useMemo(()=>new SqliteProfileRepository(db),[db]);
  const loadRepository=useMemo(()=>new SqliteLoadRepository(db),[db]);
  const pavementRepository=useMemo(()=>new SqlitePavementRepository(db),[db]);
  const projectReportRepository=useMemo(()=>new SqliteProjectReportRepository(db),[db]);
  const quarryRepository=useMemo(()=>new SqliteQuarryRepository(db),[db]);
  const financialRepository=useMemo(()=>new SqliteFinancialRepository(db),[db]);
  const fuelRepository=useMemo(()=>new SqliteFuelRepository(db),[db]);
  const wasteRepository=useMemo(()=>new SqliteWasteRepository(db),[db]);
  const quickTextRepository=useMemo(()=>new SqliteQuickTextRepository(db),[db]);
  const scheduleRepository=useMemo(()=>new SqliteScheduleRepository(db),[db]);
  const workspaceRepository=useMemo(()=>new SqliteWorkspaceRepository(db),[db]);
  const wallRepository=useMemo(()=>new SqliteWallRepository(db),[db]);
  const[screen,setScreen]=useState<Screen>('home');
  const[history,setHistory]=useState<Screen[]>([]);
  const[activeProject,setActiveProject]=useState<Project|null>(null);
  const[commandProject,setCommandProject]=useState<Project|null>(null);
  const[createOpen,setCreateOpen]=useState(false);
  const[entryIntent,setEntryIntent]=useState<EntryIntent>(null);
  const[projectPanel,setProjectPanel]=useState<'issues'|'photos'|null>(null);
  const[searchTarget,setSearchTarget]=useState<GlobalSearchResult|null>(null);
  const[scheduleProjectId,setScheduleProjectId]=useState<string|null>(null);
  const[pavementProjectId,setPavementProjectId]=useState<string|null>(null);
  const[wallProjectId,setWallProjectId]=useState<string|null>(null);
  const[dashboardRange,setDashboardRange]=useState<DashboardRange|null>(null);
  const[cloudSnapshot,setCloudSnapshot]=useState<CloudAccountSnapshot|null>(null);

  useEffect(()=>{let mounted=true;void Promise.all([Storage.getItem(activeProjectKey),loadRepository.listProjects()]).then(([saved,projects])=>{if(!mounted||!saved)return;const project=projects.find(value=>value.id===saved&&value.status==='active');if(project)setActiveProject(project);else void Storage.removeItem(activeProjectKey);}).catch(()=>{});return()=>{mounted=false;};},[loadRepository]);

  const navigate=(next:Screen)=>{setHistory(current=>[...current,screen]);setScreen(next);};
  const goRoot=(next:Screen)=>{setHistory([]);setDashboardRange(null);setSearchTarget(null);setEntryIntent(null);setScreen(next);};
  const goBack=(fallback:Screen='home')=>{const next=[...history];const destination=next.pop()??fallback;setHistory(next);setEntryIntent(null);setSearchTarget(null);setDashboardRange(null);setScreen(destination);};
  const openDashboardRoute=(next:Extract<Screen,'loads'|'reports'|'financials'>,range?:DashboardRange)=>{setDashboardRange(range??null);navigate(next);};
  const chooseActiveProject=(project:Project|null)=>{const active=project?.status==='active'?project:null;setActiveProject(active);if(active)void Storage.setItem(activeProjectKey,active.id);else void Storage.removeItem(activeProjectKey);};
  const openProject=(project:Project,panel:'issues'|'photos'|null=null)=>{setCommandProject(project);if(project.status==='active')chooseActiveProject(project);setProjectPanel(panel);navigate('projectCommand');};
  const projectForId=async(projectId:string|null)=>{if(!projectId)return null;const projects=await loadRepository.listProjects();return projects.find(value=>value.id===projectId)??null;};
  const openCreateAction=(action:CreateAction)=>{setCreateOpen(false);setEntryIntent(action);setSearchTarget(null);if(action==='receipt')navigate('makeReceipt');else if(action==='dailyReport')navigate('reports');else if(action==='waste')navigate('waste');else if(action==='quarry')navigate('quarry');else if(action==='fuelDelivery'||action==='equipmentFill')navigate('fuel');else if(action==='quickText')navigate('quickText');else if(action==='schedule'){setScheduleProjectId(activeProject?.id??null);navigate('schedule');}else if(activeProject){setCommandProject(activeProject);setProjectPanel(action==='issue'?'issues':'photos');navigate('projectCommand');}else navigate('projects');};
  const openSearchResult=(result:GlobalSearchResult)=>{setSearchTarget(result);void (async()=>{if(result.route==='projects'&&result.projectId){const project=await projectForId(result.projectId);if(project){openProject(project,result.kind==='Project Issue'?'issues':null);return;}}if(result.route==='schedule')setScheduleProjectId(result.projectId);if(result.route==='walls')setWallProjectId(result.projectId);navigate(result.route as Screen);})();};
  const openAttentionRoute=(route:GlobalSearchRoute|'drafts')=>{if(route==='drafts')navigate('drafts');else navigate(route as Screen);};
  const continueDraft=(route:DraftRoute,projectId:string|null)=>{void (async()=>{const project=await projectForId(projectId);if(project?.status==='active')chooseActiveProject(project);setEntryIntent(route==='dailyReport'?'dailyReport':route==='quarry'?'quarry':route==='fuel'?'equipmentFill':route==='quickText'?'quickText':'receipt');navigate(route==='receipt'?'makeReceipt':route==='dailyReport'?'reports':route==='quarry'?'quarry':route==='fuel'?'fuel':'quickText');})();};

  let content:ReactNode;
  if(screen==='home')content=<HomeScreen businessReportRepository={businessReportRepository} workspaceRepository={workspaceRepository} cloudSnapshot={cloudSnapshot} onMakeReceipt={()=>navigate('makeReceipt')} onSearch={()=>navigate('search')} onOpenAttention={()=>navigate('attention')} onOpenDrafts={()=>navigate('drafts')} onOpenBackup={()=>navigate('backup')} onOpenCloud={()=>navigate('cloud')} onOpenLoads={range=>openDashboardRoute('loads',range)} onOpenReceiptSetup={()=>navigate('receiptSetup')} onOpenDirectory={()=>navigate('directory')} onOpenCustomers={()=>navigate('customers')} onOpenCatalog={()=>navigate('catalog')} onOpenReports={range=>openDashboardRoute('reports',range)} onOpenQuarry={()=>navigate('quarry')} onOpenProjects={()=>navigate('projects')} onOpenSchedule={()=>{setScheduleProjectId(null);navigate('schedule');}} onOpenFinancials={range=>openDashboardRoute('financials',range)} onOpenWaste={()=>navigate('waste')} onOpenFuel={()=>navigate('fuel')} onOpenQuickText={()=>navigate('quickText')} onOpenLoadCorrections={()=>navigate('loadCorrections')} onOpenSettings={()=>navigate('settings')}/>;
  else if(screen==='recordsHub'||screen==='moreHub')content=<WorkspaceHubScreen kind={screen==='recordsHub'?'records':'more'} routes={{onSearch:()=>navigate('search'),onDrafts:()=>navigate('drafts'),onLoads:()=>navigate('loads'),onCustomers:()=>navigate('customers'),onProjects:()=>navigate('projects'),onDirectory:()=>navigate('directory'),onCatalog:()=>navigate('catalog'),onSchedule:()=>{setScheduleProjectId(null);navigate('schedule');},onPavement:()=>{setPavementProjectId(null);navigate('pavement');},onWalls:()=>{setWallProjectId(null);navigate('walls');},onWaste:()=>navigate('waste'),onQuarry:()=>navigate('quarry'),onFuel:()=>navigate('fuel'),onQuickText:()=>navigate('quickText'),onFinancials:()=>navigate('financials'),onCorrections:()=>navigate('loadCorrections'),onReports:()=>navigate('reports'),onReceiptSetup:()=>navigate('receiptSetup'),onSettings:()=>navigate('settings'),onBackup:()=>navigate('backup'),onCloud:()=>navigate('cloud'),onAttention:()=>navigate('attention')}}/>;
  else if(screen==='search')content=<GlobalSearchScreen repository={workspaceRepository} onBack={()=>goBack('home')} onOpen={openSearchResult}/>;
  else if(screen==='drafts')content=<DraftCenterScreen repository={loadRepository} onBack={()=>goBack('moreHub')} onContinue={continueDraft}/>;
  else if(screen==='attention')content=<AttentionScreen repository={workspaceRepository} onBack={()=>goBack('home')} onOpen={openAttentionRoute}/>;
  else if(screen==='backup')content=<BackupRestoreScreen repository={backupRepository} onBack={()=>goBack('moreHub')} onRestored={()=>{setActiveProject(null);setCommandProject(null);setHistory([]);setScreen('home');}}/>;
  else if(screen==='cloud')content=<AccountCloudScreen repository={cloudRepository} onBack={()=>goBack('moreHub')} onChanged={setCloudSnapshot}/>;
  else if(screen==='projectCommand'&&commandProject){const project=commandProject;content=<ProjectCommandCenterScreen project={project} repository={workspaceRepository} initialPanel={projectPanel} onBack={()=>goBack('projects')} routes={{onSchedule:()=>{setScheduleProjectId(project.id);navigate('schedule');},onPavement:()=>{setPavementProjectId(project.id);navigate('pavement');},onWalls:()=>{setWallProjectId(project.id);navigate('walls');},onDailyReport:()=>{setEntryIntent('dailyReport');navigate('reports');},onReceipt:()=>{setEntryIntent('receipt');navigate('makeReceipt');},onWaste:()=>navigate('waste'),onFuel:()=>{setEntryIntent('equipmentFill');navigate('fuel');},onQuarry:()=>{setEntryIntent('quarry');navigate('quarry');},onQuickText:()=>{setEntryIntent('quickText');navigate('quickText');},onLoads:()=>{setSearchTarget({id:'',kind:'Project',title:project.name,subtitle:'',date:null,route:'loads',projectId:project.id});navigate('loads');},onReports:()=>navigate('reports'),onManageProject:()=>navigate('projects')}}/>;}
  else if(screen==='makeReceipt')content=<ReceiptEntrance><MakeReceiptScreen repository={loadRepository} initialProjectId={activeProject?.id} onBack={()=>goBack('home')} onOpenSetup={()=>navigate('receiptSetup')} onOpenDirectory={()=>navigate('directory')} onOpenProjects={()=>navigate('projects')}/></ReceiptEntrance>;
  else if(screen==='loads'){const projectName=searchTarget?.projectId?(commandProject?.id===searchTarget.projectId?commandProject.name:activeProject?.id===searchTarget.projectId?activeProject.name:''):'';content=<LoadHistoryScreen repository={loadRepository} initialFromDate={dashboardRange?.fromDate} initialToDate={dashboardRange?.toDate} initialProjectName={projectName} initialLoadId={searchTarget?.route==='loads'?searchTarget.id:null} onBack={()=>goBack('recordsHub')}/>;}
  else if(screen==='loadCorrections')content=<LoadCorrectionsScreen repository={loadRepository} onBack={()=>goBack('recordsHub')}/>;
  else if(screen==='receiptSetup')content=<ReceiptSetupScreen repository={loadRepository} onBack={()=>goBack('moreHub')}/>;
  else if(screen==='directory')content=<PeopleEquipmentScreen repository={loadRepository} onBack={()=>goBack('recordsHub')}/>;
  else if(screen==='customers')content=<CustomersScreen repository={profileRepository} financialRepository={financialRepository} onBack={()=>goBack('recordsHub')}/>;
  else if(screen==='catalog')content=<CatalogScreen repository={catalogRepository} onBack={()=>goBack('moreHub')}/>;
  else if(screen==='reports')content=<ReportsScreen repository={projectReportRepository} businessReportRepository={businessReportRepository} initialBusinessFilters={dashboardRange?{fromDate:dashboardRange.fromDate,toDate:dashboardRange.toDate}:undefined} initialProjectId={searchTarget?.route==='reports'?searchTarget.projectId:activeProject?.id} initialReportId={searchTarget?.route==='reports'?searchTarget.id:null} startNewReport={entryIntent==='dailyReport'} onBack={()=>goBack('moreHub')}/>;
  else if(screen==='quarry')content=<QuarryPurchasesScreen repository={quarryRepository} initialProjectId={activeProject?.id} startEntry={entryIntent==='quarry'} initialPurchaseId={searchTarget?.kind==='Quarry Purchase'?searchTarget.id:null} onBack={()=>goBack('recordsHub')}/>;
  else if(screen==='projects')content=<ProjectsScreen repository={loadRepository} onBack={()=>goBack('home')} onOpenProject={project=>openProject(project,entryIntent==='issue'?'issues':entryIntent==='photo'?'photos':null)} onProjectStatusChange={(project,status)=>{if(activeProject?.id===project.id&&status==='completed')chooseActiveProject(null);if(commandProject?.id===project.id)setCommandProject({...commandProject,status});}}/>;
  else if(screen==='schedule')content=<ScheduleScreen repository={scheduleRepository} initialProjectId={scheduleProjectId??(searchTarget?.route==='schedule'?searchTarget.projectId:null)} onBack={()=>{setScheduleProjectId(null);goBack('recordsHub');}}/>;
  else if(screen==='pavement')content=<PavementCalculatorScreen repository={pavementRepository} initialProjectId={pavementProjectId} onBack={()=>{setPavementProjectId(null);goBack('recordsHub');}}/>;
  else if(screen==='walls')content=<WallConstructionScreen repository={wallRepository} initialProjectId={wallProjectId} onBack={()=>{setWallProjectId(null);goBack('recordsHub');}}/>;
  else if(screen==='financials')content=<FinancialsScreen repository={financialRepository} initialFromDate={dashboardRange?.fromDate} initialToDate={dashboardRange?.toDate} onBack={()=>goBack('recordsHub')}/>;
  else if(screen==='waste')content=<WasteDumpScreen repository={wasteRepository} initialProjectId={searchTarget?.route==='waste'?searchTarget.projectId:activeProject?.id} initialDumpId={searchTarget?.route==='waste'?searchTarget.id:null} onBack={()=>goBack('recordsHub')}/>;
  else if(screen==='fuel')content=<FuelTrackingScreen repository={fuelRepository} initialProjectId={activeProject?.id} initialTab={entryIntent==='fuelDelivery'?'delivery':entryIntent==='equipmentFill'?'fill':undefined} onBack={()=>goBack('recordsHub')}/>;
  else if(screen==='quickText')content=<QuickTextScreen repository={quickTextRepository} initialProjectId={activeProject?.id} initialDocumentId={searchTarget?.route==='quickText'?searchTarget.id:null} onBack={()=>goBack('recordsHub')}/>;
  else if(screen==='settings')content=<SettingsScreen repository={profileRepository} onBack={()=>goBack('moreHub')}/>;
  else content=<ProjectsScreen repository={loadRepository} onBack={()=>goRoot('home')} onOpenProject={openProject}/>;

  const recordsActive=(['recordsHub','loads','loadCorrections','customers','directory','schedule','pavement','walls','quarry','waste','fuel','quickText','financials'] as Screen[]).includes(screen);
  const moreActive=(['moreHub','reports','catalog','receiptSetup','settings','search','drafts','attention','backup','cloud'] as Screen[]).includes(screen);
  if(cloudSnapshot?.configured&&!cloudSnapshot.signedIn)return <SafeAreaView style={styles.safeArea}><StatusBar barStyle="dark-content" backgroundColor={colors.background}/><CloudAutoSync repository={cloudRepository} onSnapshot={setCloudSnapshot}/><AccountCloudScreen repository={cloudRepository} onChanged={setCloudSnapshot}/></SafeAreaView>;
  return <SafeAreaView style={styles.safeArea}><StatusBar barStyle="dark-content" backgroundColor={colors.background}/><CloudAutoSync repository={cloudRepository} onSnapshot={setCloudSnapshot}/>{activeProject?<ProjectContextBar project={activeProject} onOpen={()=>{setCommandProject(activeProject);setProjectPanel(null);navigate('projectCommand');}} onChange={()=>goRoot('projects')} onClear={()=>chooseActiveProject(null)}/>:null}<View style={styles.shell}>{content}</View><View style={styles.nav}><NavButton mark="⌂" label="Home" active={screen==='home'} onPress={()=>goRoot('home')}/><NavButton mark="P" label="Projects" active={screen==='projects'||screen==='projectCommand'} onPress={()=>goRoot('projects')}/><CreateNavButton onPress={()=>setCreateOpen(true)}/><NavButton mark="R" label="Records" active={recordsActive} onPress={()=>goRoot('recordsHub')}/><NavButton mark="•••" label="More" active={moreActive} onPress={()=>goRoot('moreHub')}/></View><CreateActionSheet visible={createOpen} activeProject={activeProject} onClose={()=>setCreateOpen(false)} onChooseProject={()=>{setCreateOpen(false);goRoot('projects');}} onSelect={openCreateAction}/></SafeAreaView>;
}

function CloudAutoSync({repository,onSnapshot}:{repository:SqliteCloudRepository;onSnapshot:(snapshot:CloudAccountSnapshot)=>void}){useEffect(()=>{let active=true;let running=false;const check=async(sync:boolean)=>{if(running)return;running=true;try{let snapshot=await repository.getSnapshot();if(sync&&snapshot.configured&&snapshot.signedIn&&snapshot.emailVerified)snapshot=await repository.synchronize();if(active)onSnapshot(snapshot);}catch{if(active)onSnapshot(await repository.getSnapshot());}finally{running=false;}};void check(true);const interval=setInterval(()=>void check(true),60_000);const subscription=AppState.addEventListener('change',state=>{if(state==='active')void check(true);});return()=>{active=false;clearInterval(interval);subscription.remove();};},[onSnapshot,repository]);return null;}

function ReceiptEntrance({children}:{children:ReactNode}){const progress=useState(()=>new Animated.Value(0))[0];useEffect(()=>{const animation=Animated.spring(progress,{toValue:1,useNativeDriver:true,speed:18,bounciness:3});animation.start();return()=>animation.stop();},[progress]);return <View style={styles.receiptStage}><Animated.View style={[styles.receiptPage,{opacity:progress.interpolate({inputRange:[0,.18,1],outputRange:[.35,.8,1]}),transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[90,0]})},{scale:progress.interpolate({inputRange:[0,1],outputRange:[.94,1]})}]}]}>{children}</Animated.View></View>;}
function ProjectContextBar({project,onOpen,onChange,onClear}:{project:Project;onOpen:()=>void;onChange:()=>void;onClear:()=>void}){return <View style={styles.contextBar}><TouchableOpacity style={styles.contextMain} onPress={onOpen}><Text style={styles.contextEyebrow}>ACTIVE PROJECT</Text><Text style={styles.contextName} numberOfLines={1}>{project.name}</Text></TouchableOpacity><TouchableOpacity style={styles.contextChange} onPress={onChange}><Text style={styles.contextChangeText}>Change</Text></TouchableOpacity><TouchableOpacity style={styles.contextClear} onPress={onClear}><Text style={styles.contextClearText}>×</Text></TouchableOpacity></View>;}
function NavButton({mark,label,active,onPress}:{mark:string;label:string;active:boolean;onPress:()=>void}){return <TouchableOpacity style={styles.navButton} onPress={onPress} accessibilityRole="button"><Text style={[styles.navMark,active&&styles.navMarkActive]}>{mark}</Text><Text style={[styles.navLabel,active&&styles.navLabelActive]}>{label}</Text>{active?<View style={styles.navIndicator}/>:null}</TouchableOpacity>;}
function CreateNavButton({onPress}:{onPress:()=>void}){return <TouchableOpacity style={styles.createNav} onPress={onPress} accessibilityRole="button" accessibilityLabel="Create a new record"><View style={styles.createCircle}><Text style={styles.createPlus}>+</Text></View><Text style={styles.createLabel}>Create</Text></TouchableOpacity>;}

const styles=StyleSheet.create({safeArea:{flex:1,backgroundColor:colors.background},shell:{flex:1},contextBar:{minHeight:49,backgroundColor:colors.navy,flexDirection:'row',alignItems:'center',paddingLeft:14,borderBottomWidth:3,borderBottomColor:colors.brand},contextMain:{flex:1,minWidth:0,paddingVertical:7},contextEyebrow:{color:'#F2A184',fontSize:7,fontWeight:'900',letterSpacing:.8},contextName:{color:'#FFF8ED',fontSize:13,fontWeight:'900',marginTop:1},contextChange:{paddingHorizontal:10,paddingVertical:9},contextChangeText:{color:'#FFF8ED',fontSize:10,fontWeight:'900'},contextClear:{width:38,height:38,alignItems:'center',justifyContent:'center'},contextClearText:{color:'#F2A184',fontSize:23,fontWeight:'700'},receiptStage:{flex:1,backgroundColor:colors.brand,overflow:'hidden'},receiptPage:{flex:1,backgroundColor:colors.background,borderTopLeftRadius:24,borderTopRightRadius:24,overflow:'hidden'},nav:{minHeight:72,flexDirection:'row',backgroundColor:colors.surface,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line},navButton:{flex:1,alignItems:'center',justifyContent:'center',gap:2},navMark:{color:colors.muted,fontSize:13,fontWeight:'900',minHeight:17},navMarkActive:{color:colors.brand},navLabel:{color:colors.muted,fontSize:9,fontWeight:'800'},navLabelActive:{color:colors.brandDark},navIndicator:{width:27,height:3,borderRadius:2,backgroundColor:colors.brand,marginTop:2},createNav:{flex:1,alignItems:'center',justifyContent:'flex-end',paddingBottom:8},createCircle:{width:54,height:54,borderRadius:27,backgroundColor:colors.brand,borderWidth:4,borderColor:colors.surface,alignItems:'center',justifyContent:'center',marginTop:-18,shadowColor:'#8E2E1B',shadowOpacity:.3,shadowRadius:7,shadowOffset:{width:0,height:4},elevation:7},createPlus:{color:'#FFF',fontSize:31,fontWeight:'600',lineHeight:34},createLabel:{color:colors.brandDark,fontSize:9,fontWeight:'900',marginTop:2}});
