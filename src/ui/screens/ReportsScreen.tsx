import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Image, LayoutAnimation, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { ProjectReportRepository } from '../../data/repositories/ProjectReportRepository';
import type { BusinessReportRepository } from '../../data/repositories/BusinessReportRepository';
import {activeBusinessFilterCount,businessReportLabels,emptyBusinessReportFilters,filterBusinessReportData,type BusinessReportFilters,type BusinessReportKind} from '../../domain/businessReports';
import type {WorkbookLocale,WorkbookProgress} from '../../services/businessWorkbook';
import {exportAndShareDailyReportWorkbook} from '../../services/dailyReportWorkbook';
import {
  addPresence, consultantSignoffState, emptyDailyReport, netWorkMinutes, safetyEquipment, splitPresence,
  type DailyProjectReport, type DailyProjectReportDraft, type DailyReportMaterial,
  type LinkedFuelFill, type LinkedProjectLoad, type LinkedQuarryLoad, type LinkedWasteDump, type ProjectReportSetup, type ReportProject, type SafetyParticipantType, type WorkerSafetyStatus,
} from '../../domain/projectReports';
import { SearchableSelect } from '../components/SearchableSelect';
import {CollapsibleFilterCard} from '../components/CollapsibleFilterCard';
import {DatePickerField,todayIso} from '../components/DatePickerField';
import {TimePickerField} from '../components/TimePickerField';
import {SignaturePad} from '../components/SignaturePad';
import {useReducedMotion} from '../components/ExpandableMenu';
import { capturePersistentImage, pickPersistentImage } from '../../services/media';
import { exportAndShareProjectCompletion, exportAndShareProjectReport } from '../../services/documentExport';
import {exportBusinessWorkbook} from '../../services/businessWorkbookExport';
import Storage from 'expo-sqlite/kv-store';
import { colors } from '../theme';

const HISTORY_PAGE=20;

export function ReportsScreen({ repository,businessReportRepository,onBack,initialBusinessFilters,initialProjectId,initialReportId,startNewReport=false }: { repository: ProjectReportRepository;businessReportRepository:BusinessReportRepository;onBack: () => void;initialBusinessFilters?:Partial<BusinessReportFilters>;initialProjectId?:string|null;initialReportId?:string|null;startNewReport?:boolean }) {
  const [setup, setSetup] = useState<ProjectReportSetup | null>(null);
  const [setupStatus, setSetupStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [setupError, setSetupError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [project, setProject] = useState<ReportProject | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [reports, setReports] = useState<DailyProjectReport[]>([]);
  const [draft, setDraft] = useState<DailyProjectReportDraft | null>(null);
  const [linkedLoads, setLinkedLoads] = useState<LinkedProjectLoad[]>([]);
  const [linkedQuarryLoads,setLinkedQuarryLoads]=useState<LinkedQuarryLoad[]>([]);
  const [linkedFuelFills,setLinkedFuelFills]=useState<LinkedFuelFill[]>([]);
  const [linkedWasteDumps, setLinkedWasteDumps] = useState<LinkedWasteDump[]>([]);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting,setExporting]=useState<BusinessReportKind|null>(null);
  const [exportProgress,setExportProgress]=useState<WorkbookProgress|null>(null);
  const exportController=useRef<AbortController|null>(null);
  const initializedProject=useRef<string|null>(null);
  const initializedReport=useRef<string|null>(null);
  const [workbookLocale,setWorkbookLocale]=useState<WorkbookLocale>('en');
  const [dailyExportingId,setDailyExportingId]=useState<string|null>(null);
  const [businessFilters,setBusinessFilters]=useState<BusinessReportFilters>(()=>({...emptyBusinessReportFilters,...initialBusinessFilters}));
  const [businessFilterOptions,setBusinessFilterOptions]=useState<{customers:{id:string;label:string}[];suppliers:{id:string;label:string}[];items:{id:string;label:string}[]}>({customers:[],suppliers:[],items:[]});
  const [menuOpen,setMenuOpen]=useState<Set<string>>(()=>new Set());
  const toggleMenu=(key:string)=>{setMenuOpen(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});};
  const [historyVisible,setHistoryVisible]=useState(HISTORY_PAGE);
  const [pdfChoiceId,setPdfChoiceId]=useState<string|null>(null);
  const [pdfChoicePrices,setPdfChoicePrices]=useState(false);
  const reducedMotion=useReducedMotion();
  const refreshSetup = useCallback(async () => {
    setSetupStatus('loading'); setSetupError(null);
    try {
      const result = await repository.getSetup();
      if (!mountedRef.current) return;
      setSetup(result); setSetupStatus('ready');
    } catch (cause) {
      if (!mountedRef.current) return;
      setSetupError(cause instanceof Error ? cause.message : 'Could not load reports.'); setSetupStatus('error');
    }
  }, [repository]);
  useEffect(() => { void refreshSetup(); }, [refreshSetup]);
  useEffect(()=>{if(!setup||!initialProjectId||initializedProject.current===initialProjectId)return;const selected=setup.projects.find(value=>value.id===initialProjectId);if(!selected)return;initializedProject.current=initialProjectId;setSelectedProjectId(selected.id);setProject(selected);if(startNewReport&&selected.status==='active')void openNewReport(selected);},[initialProjectId,setup,startNewReport]);
  useEffect(() => {
    void businessReportRepository.getReportData().then(data => {
      const itemNames=new Set<string>();
      [...data.loads,...data.quarryPurchases,...data.materials].forEach(row=>{const value=String(row.Item??'').trim();if(value)itemNames.add(value);});
      setBusinessFilterOptions({
        customers:data.customers.map(row=>({id:String(row['Customer ID']??''),label:String(row.Customer??'Unnamed customer')})).filter(value=>value.id),
        suppliers:data.suppliers.map(row=>({id:String(row['Supplier ID']??''),label:String(row.Supplier??'Unnamed supplier')})).filter(value=>value.id),
        items:[...itemNames].sort((a,b)=>a.localeCompare(b)).map(value=>({id:value,label:value})),
      });
    }).catch(()=>setBusinessFilterOptions({customers:[],suppliers:[],items:[]}));
  },[businessReportRepository]);
  useEffect(() => { if (project) void repository.listReports(project.id).then(setReports); }, [project, repository]);
  useEffect(()=>{setHistoryVisible(HISTORY_PAGE);setPdfChoiceId(null);},[project?.id]);
  useEffect(()=>{if(!initialReportId||initializedReport.current===initialReportId)return;const report=reports.find(value=>value.id===initialReportId);if(report){initializedReport.current=initialReportId;editReport(report);}},[initialReportId,reports]);
  useEffect(() => {
    if (draft?.projectId && draft.workDate) void repository.listLinkedLoads(draft.projectId, draft.workDate).then(setLinkedLoads);
    else setLinkedLoads([]);
  }, [draft?.projectId, draft?.workDate, repository]);
  useEffect(()=>{if(draft?.projectId&&draft.workDate)void repository.listLinkedQuarryLoads(draft.projectId,draft.workDate).then(setLinkedQuarryLoads);else setLinkedQuarryLoads([]);},[draft?.projectId,draft?.workDate,repository]);
  useEffect(()=>{if(draft?.projectId&&draft.workDate)void repository.listLinkedFuelFills(draft.projectId,draft.workDate).then(setLinkedFuelFills);else setLinkedFuelFills([]);},[draft?.projectId,draft?.workDate,repository]);
  useEffect(() => {
    if (draft?.projectId && draft.workDate) void repository.listLinkedWasteDumps(draft.projectId, draft.workDate).then(setLinkedWasteDumps);
    else setLinkedWasteDumps([]);
  }, [draft?.projectId, draft?.workDate, repository]);
  useEffect(() => {
    if (!draft || draft.id) return;
    const timer = setTimeout(() => void Storage.setItem(`dromex.draft.daily-report.${draft.projectId}.v1`, JSON.stringify(draft)), 450);
    return () => clearTimeout(timer);
  }, [draft]);

  async function openNewReport(selectedProject: ReportProject) {
    setError(null); setMessage(null);
    const empty = emptyDailyReport(selectedProject.id);
    try {
      const stored = await Storage.getItem(`dromex.draft.daily-report.${selectedProject.id}.v1`);
      if (!stored) { setDraft(empty); return; }
      const restored = JSON.parse(stored) as Partial<DailyProjectReportDraft>;
      setDraft({ ...empty, ...restored, id: null, projectId: selectedProject.id });
      setMessage('Your unsaved daily report draft was restored.');
    } catch {
      setDraft(empty);
    }
  }

  function editReport(report: DailyProjectReport) {
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...editable } = report;
    setError(null); setMessage(null); setDraft(editable);
  }
  async function save() {
    if (!draft) return; setBusy(true); setError(null); setMessage(null);
    try {
      const wasNew = !draft.id;
      const saved = await repository.saveReport(draft);
      if (wasNew) await Storage.removeItem(`dromex.draft.daily-report.${saved.projectId}.v1`);
      setDraft(null);
      const [nextReports, nextSetup] = await Promise.all([repository.listReports(saved.projectId), repository.getSetup()]);
      setReports(nextReports); setSetup(nextSetup); setMessage('Daily project report saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the report.'); }
    finally { setBusy(false); }
  }
  async function shareReport(report: DailyProjectReport,includePrices=false) {
    if (!project) return; setBusy(true); setError(null); setMessage(null);
    try { const [loads,quarry,waste,fuel] = await Promise.all([repository.listLinkedLoads(project.id, report.workDate),repository.listLinkedQuarryLoads(project.id,report.workDate),repository.listLinkedWasteDumps(project.id, report.workDate),repository.listLinkedFuelFills(project.id,report.workDate)]); await exportAndShareProjectReport(report, project, loads, quarry, waste, fuel, setup!.company,includePrices); setMessage(includePrices?'PDF with prices created.':'PDF without prices created.'); setPdfChoiceId(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export project report.'); }
    finally { setBusy(false); }
  }
  async function shareReportExcel(report: DailyProjectReport) {
    if (!project || !setup) return;if(dailyExportingId){exportController.current?.abort();setExportProgress(current=>current?{...current,message:'Cancelling and removing incomplete output'}:current);return;}const controller=new AbortController();exportController.current=controller;setDailyExportingId(report.id);setExportProgress({stage:'preparing',completed:0,total:Math.max(1,report.photos.length),percent:1,message:'Preparing daily report'});setBusy(true); setError(null); setMessage(null);
    try { const [loads,quarry,waste,fuel] = await Promise.all([repository.listLinkedLoads(project.id, report.workDate),repository.listLinkedQuarryLoads(project.id,report.workDate),repository.listLinkedWasteDumps(project.id, report.workDate),repository.listLinkedFuelFills(project.id,report.workDate)]); await exportAndShareDailyReportWorkbook(report, project, loads, quarry, waste, fuel, setup.company,{locale:workbookLocale,signal:controller.signal,onProgress:setExportProgress}); setMessage(`Daily report Excel created in ${workbookLocale==='ar'?'Arabic RTL':'English LTR'}.`); }
    catch (cause) { if(cause instanceof Error&&cause.name==='AbortError')setMessage('Daily report Excel export cancelled. No incomplete workbook was kept.');else setError(cause instanceof Error ? cause.message : 'Could not export the daily report Excel workbook.'); }
    finally { if(exportController.current===controller)exportController.current=null;setDailyExportingId(null);setExportProgress(null);setBusy(false); }
  }
  async function shareCompletion() {
    if (!project || project.status !== 'completed') return; setBusy(true); setError(null); setMessage(null);
    try {
      const [allReports, loads, waste] = await Promise.all([repository.listReports(project.id), repository.listProjectLoads(project.id), repository.listProjectWasteDumps(project.id)]);
      await exportAndShareProjectCompletion(project, allReports, loads, waste, setup!.company);
      setMessage('Completed project PDF created and ready to share.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export the completed project report.'); }
    finally { setBusy(false); }
  }
  async function shareBusinessReport(kind:BusinessReportKind){if(exporting){exportController.current?.abort();setExportProgress(current=>current?{...current,message:'Cancelling and removing incomplete output'}:current);return;}const controller=new AbortController();exportController.current=controller;setExporting(kind);setExportProgress({stage:'preparing',completed:0,total:1,percent:1,message:'Loading report records'});setError(null);setMessage(null);try{const data=filterBusinessReportData(await businessReportRepository.getReportData(),businessFilters);if(controller.signal.aborted)throw Object.assign(new Error('Workbook export cancelled.'),{name:'AbortError'});await exportBusinessWorkbook(kind,data,{locale:workbookLocale,signal:controller.signal,onProgress:setExportProgress});setMessage(`${businessReportLabels[kind]} created in ${workbookLocale==='ar'?'Arabic RTL':'English LTR'} with ${activeBusinessFilterCount(businessFilters)} active filter${activeBusinessFilterCount(businessFilters)===1?'':'s'}.`);}catch(cause){if(cause instanceof Error&&cause.name==='AbortError')setMessage('Excel export cancelled. No incomplete workbook was kept.');else setError(cause instanceof Error?cause.message:'Could not create the workbook.');}finally{if(exportController.current===controller)exportController.current=null;setExporting(null);setExportProgress(null);}}

  if (setupStatus === 'error') return <ScrollView contentContainerStyle={styles.content}><Header eyebrow="OPERATIONS" title="Reports" onBack={onBack}/><View style={styles.errorState}><Text style={styles.errorStateTitle}>Could not load reports</Text><Text style={styles.errorStateText}>{setupError}</Text><TouchableOpacity style={styles.retryButton} onPress={()=>void refreshSetup()} accessibilityRole="button"><Text style={styles.retryButtonText}>Retry</Text></TouchableOpacity></View></ScrollView>;
  if (!setup) return <ScrollView contentContainerStyle={styles.content}><Header eyebrow="OPERATIONS" title="Reports" onBack={onBack}/><View style={styles.centerState}><ActivityIndicator size="large" color={colors.brand}/><Text style={styles.helper}>Loading reports…</Text></View></ScrollView>;
  if (draft && project) return <DailyReportEditor setup={setup} project={project} draft={draft} reports={reports} linkedLoads={linkedLoads} linkedQuarryLoads={linkedQuarryLoads} linkedFuelFills={linkedFuelFills} linkedWasteDumps={linkedWasteDumps} busy={busy} error={error} reducedMotion={reducedMotion} onChange={setDraft} onSave={() => void save()} onBack={() => setDraft(null)} onOpenReport={editReport}/>;
  if (project) {
    const visibleReports=reports.slice(0,historyVisible);
    const remaining=reports.length-visibleReports.length;
    return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header eyebrow="PROJECT REPORTS" title={project.name} onBack={() => { setProject(null); setReports([]); setMessage(null); }} />
      <IdentityCard project={project} subtitle={`${reports.length} report${reports.length===1?'':'s'} on file`}/>
      <WorkbookLanguagePicker locale={workbookLocale} onChange={setWorkbookLocale}/>
      {error ? <Text style={styles.error}>{error}</Text> : null}{message ? <Text style={styles.success}>{message}</Text> : null}
      {project.status === 'active' ? <TouchableOpacity style={styles.primary} onPress={() => void openNewReport(project)} accessibilityRole="button"><Text style={styles.primaryText}>Make Daily Report</Text><Text style={styles.primaryHint}>The project is selected automatically · draft autosaves locally</Text></TouchableOpacity> : <><Text style={styles.notice}>This project is completed. Its reports remain available, but a new report cannot be created until the project is reactivated.</Text><TouchableOpacity style={styles.completionExport} disabled={busy} onPress={()=>void shareCompletion()} accessibilityRole="button"><Text style={styles.completionExportTitle}>{busy?'Creating final PDF…':'Create Full Project PDF'}</Text><Text style={styles.completionExportHint}>Start-to-finish summary, daily timeline, loads, waste, working time, issues, people, equipment, and photos</Text></TouchableOpacity></>}
      <View style={styles.historyHeading}><Text style={styles.sectionTitle}>Report history</Text><Text style={styles.historyCount}>{reports.length}</Text></View>
      {visibleReports.length ? <>{visibleReports.map((report) => {
        const exportingThis=dailyExportingId===report.id;
        const choosingPdf=pdfChoiceId===report.id;
        return <View key={report.id} style={styles.reportCard}>
          <TouchableOpacity onPress={() => editReport(report)} disabled={busy} accessibilityRole="button">
            <View style={styles.reportCardHeader}><Text style={styles.reportCardTitle}>{report.workDate}</Text><Text style={styles.openText}>Open</Text></View>
            <Text style={styles.reportDescription} numberOfLines={3}>{report.workDescription||'No work description recorded'}</Text>
            <View style={styles.reportCounts}><Text style={styles.reportCountText}>{report.workers.length} workers</Text><Text style={styles.reportCountText}>{report.drivers.length} drivers</Text><Text style={styles.reportCountText}>{report.materials.length} materials</Text><Text style={styles.reportCountText}>{report.photos.length} photos</Text></View>
            <Text style={styles.helper}>Saved {new Date(report.updatedAt).toLocaleString()}</Text>
          </TouchableOpacity>
          {exportingThis?<View style={styles.exportProgressTrack}><View style={[styles.exportProgressFill,{width:`${Math.max(2,exportProgress?.percent??2)}%`}]}/></View>:null}
          <View style={styles.reportActionRow}>
            <TouchableOpacity style={styles.generatePdfButton} disabled={busy} onPress={()=>{setPdfChoiceId(choosingPdf?null:report.id);setPdfChoicePrices(false);}} accessibilityRole="button" accessibilityState={{expanded:choosingPdf}}><Text style={styles.generatePdfButtonText}>Generate PDF</Text></TouchableOpacity>
            <TouchableOpacity style={styles.excelButton} disabled={busy&&!exportingThis} onPress={()=>void shareReportExcel(report)} accessibilityRole="button"><Text style={exportingThis?styles.cancelExport:styles.excelButtonText}>{exportingThis?`${exportProgress?.percent??1}% · Cancel`:'Excel + Photos'}</Text></TouchableOpacity>
          </View>
          {exportingThis?<Text style={styles.helper}>{exportProgress?.message}</Text>:null}
          {choosingPdf?<View style={styles.pdfChoicePanel}>
            <PdfChoiceCard label="No Prices" recommended selected={!pdfChoicePrices} onPress={()=>setPdfChoicePrices(false)}/>
            <PdfChoiceCard label="With Prices" selected={pdfChoicePrices} onPress={()=>setPdfChoicePrices(true)}/>
            <Text style={styles.pdfChoiceExplain}>No Prices removes prices, VAT, and financial totals from the generated document only. Stored records are not changed.</Text>
            <TouchableOpacity style={styles.pdfChoiceConfirm} disabled={busy} onPress={()=>void shareReport(report,pdfChoicePrices)} accessibilityRole="button"><Text style={styles.pdfChoiceConfirmText}>{busy?'Creating…':`Generate ${pdfChoicePrices?'With':'No'} Prices PDF`}</Text></TouchableOpacity>
          </View>:null}
        </View>;
      })}{remaining>0?<TouchableOpacity style={styles.showMore} onPress={()=>setHistoryVisible(current=>current+HISTORY_PAGE)} accessibilityRole="button"><Text style={styles.showMoreText}>Show {Math.min(remaining,HISTORY_PAGE)} More ({remaining} remaining)</Text></TouchableOpacity>:null}</> : <View style={styles.empty}><Text style={styles.cardTitle}>No daily reports yet</Text><Text style={styles.helper}>Choose Make Daily Report to record the first workday.</Text></View>}
    </ScrollView>
  );}

  const active = setup.projects.filter((value) => value.status === 'active'); const completed = setup.projects.filter((value) => value.status === 'completed');
  const selectedProject = setup.projects.find((value) => value.id === selectedProjectId) ?? null;
  const filterCount=activeBusinessFilterCount(businessFilters);const updateBusinessFilter=<K extends keyof BusinessReportFilters>(key:K,value:BusinessReportFilters[K])=>setBusinessFilters(current=>({...current,[key]:value}));
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header eyebrow="OPERATIONS" title="Reports" onBack={onBack} />
      <Text style={styles.helper}>Choose a project for daily reports and project history. Export options below clearly show what can be generated now.</Text>
      {error?<Text style={styles.error}>{error}</Text>:null}{message?<Text style={styles.success}>{message}</Text>:null}
      <View style={styles.projectSelector}>
        <View style={styles.projectSelectorHeader}><View style={styles.projectSelectorCopy}><Text style={styles.projectSelectorEyebrow}>PROJECT ACCESS</Text><Text style={styles.projectSelectorTitle}>Select a project</Text><Text style={styles.projectSelectorHint}>Search once, then open its complete daily-report history.</Text></View><DoubleDiagonalMark contrast /></View>
        <View style={styles.projectSelectorBody}>
        <SearchableSelect
          label="Project *"
          options={setup.projects.map((value) => ({ id: value.id, label: value.name, detail: `${value.customerName} · ${value.status}` }))}
          selectedId={selectedProjectId}
          onSelect={setSelectedProjectId}
          placeholder="Search project name or customer"
        />
        {selectedProject?<View style={styles.selectedProjectPreview}><View style={styles.selectedProjectCopy}><Text style={styles.selectedProjectName}>{selectedProject.name}</Text><Text style={styles.selectedProjectMeta}>{selectedProject.customerName}</Text><Text style={styles.selectedProjectMeta}>{selectedProject.location}</Text></View><Text style={[styles.selectedProjectStatus,selectedProject.status==='active'?styles.selectedProjectActive:styles.selectedProjectCompleted]}>{selectedProject.status==='active'?'ACTIVE':'COMPLETED'}</Text></View>:<View style={styles.projectSelectorEmpty}><Text style={styles.projectSelectorEmptyTitle}>No project selected</Text><Text style={styles.helper}>Use the searchable field above to choose one.</Text></View>}
        <TouchableOpacity style={[styles.openProject, !selectedProject && styles.openProjectDisabled]} disabled={!selectedProject} onPress={() => selectedProject && setProject(selectedProject)} accessibilityRole="button">
          <Text style={styles.openProjectText}>{selectedProject?'Open Project Reports':'Select a Project First'}</Text><Text style={styles.openProjectArrow}>›</Text>
        </TouchableOpacity>
        </View>
      </View>
      <ReportMenu title="Active Projects" summary={`${active.length} active project${active.length===1?'':'s'}`} tone="cream" open={menuOpen.has('active')} onToggle={()=>toggleMenu('active')}>{active.length ? active.map((value) => <ProjectCard key={value.id} project={value} onPress={() => setProject(value)} />) : <View style={styles.empty}><Text style={styles.cardTitle}>No active projects</Text><Text style={styles.helper}>Add a project from Home → Projects first.</Text></View>}</ReportMenu>
      <ReportMenu title="Completed Projects" summary={`${completed.length} completed project${completed.length===1?'':'s'}`} tone="orange" open={menuOpen.has('completed')} onToggle={()=>toggleMenu('completed')}>{completed.length ? completed.map((value) => <ProjectCard key={value.id} project={value} onPress={() => setProject(value)} />) : <Text style={styles.helper}>No completed projects.</Text>}</ReportMenu>
      <ReportMenu title="Report Generation" summary={`${filterCount?`${filterCount} active Excel filter${filterCount===1?'':'s'} · `:''}PDF reports and six Excel workbooks`} tone="navy" open={menuOpen.has('generation')} onToggle={()=>toggleMenu('generation')}><ExportOption title="Daily Project Report" description="Work, people, equipment, materials, delivered loads, waste dumps, notes, time, photos, and project context." format="PDF · Available from a project" ready /><ExportOption title="Completed Project Report" description="Start-to-finish totals, daily timeline, loads, waste, time, issues, people, equipment, and photos." format="PDF · Available from a completed project" ready /><Text style={styles.businessExportHeading}>BUSINESS REPORT WORKBOOKS</Text><WorkbookLanguagePicker locale={workbookLocale} onChange={setWorkbookLocale}/><CollapsibleFilterCard title="Filter Excel generation" summary={filterCount?`${filterCount} filter${filterCount===1?'':'s'} applied to every Excel workbook`:'All records · no Excel filters applied'} defaultOpen><View style={styles.dateRow}><View style={styles.flex}><DatePickerField label="From date" value={businessFilters.fromDate} onChange={value=>updateBusinessFilter('fromDate',value)} maxDate={businessFilters.toDate||todayIso()} allowClear/></View><View style={styles.flex}><DatePickerField label="To date" value={businessFilters.toDate} onChange={value=>updateBusinessFilter('toDate',value)} minDate={businessFilters.fromDate||undefined} maxDate={todayIso()} allowClear/></View></View><SearchableSelect label="Project" options={setup.projects.map(value=>({id:value.id,label:value.name,detail:value.customerName}))} selectedId={businessFilters.projectId} onSelect={value=>updateBusinessFilter('projectId',value)} placeholder="All projects" allowClear/><SearchableSelect label="Customer" options={businessFilterOptions.customers} selectedId={businessFilters.customerId} onSelect={value=>updateBusinessFilter('customerId',value)} placeholder="All customers" allowClear/><SearchableSelect label="Supplier" options={businessFilterOptions.suppliers} selectedId={businessFilters.supplierId} onSelect={value=>updateBusinessFilter('supplierId',value)} placeholder="All suppliers" allowClear/><SearchableSelect label="Item" options={businessFilterOptions.items} selectedId={businessFilters.item} onSelect={value=>updateBusinessFilter('item',value)} placeholder="All items" allowClear/><Text style={styles.label}>Payment status</Text><View style={styles.chips}>{['','Unpaid','Partially Paid','Paid','Overpaid','Unpriced'].map(value=><TouchableOpacity key={value||'all'} style={[styles.chip,businessFilters.paymentStatus===value&&styles.chipSelected]} onPress={()=>updateBusinessFilter('paymentStatus',value)}><Text style={[styles.chipText,businessFilters.paymentStatus===value&&styles.chipTextSelected]}>{value||'All'}</Text></TouchableOpacity>)}</View><View style={styles.filterFooter}><Text style={styles.filterScope}>{filterCount?`${filterCount} active Excel filter${filterCount===1?'':'s'}`:'Every record will be exported to Excel'}</Text>{filterCount?<TouchableOpacity onPress={()=>setBusinessFilters(emptyBusinessReportFilters)}><Text style={styles.clearFilter}>Clear All</Text></TouchableOpacity>:null}</View></CollapsibleFilterCard>{(['loads','customers','quarry','fuel','projects','analysis'] as BusinessReportKind[]).map(kind=><BusinessWorkbookOption key={kind} kind={kind} busy={exporting===kind} disabled={exporting!==null} progress={exporting===kind?exportProgress:null} onPress={()=>void shareBusinessReport(kind)}/>)}</ReportMenu>
    </ScrollView>
  );
}

function IdentityCard({project,workDate,subtitle}:{project:ReportProject;workDate?:string;subtitle?:string}){
  const period=project.startDate||project.endDate?`Operates ${project.startDate??'—'} to ${project.endDate??'ongoing'}`:'No operating-period restriction set';
  return <View style={styles.identityCard}>
    <View style={styles.identityTop}><View style={styles.flex}><Text style={styles.identityProject} numberOfLines={2}>{project.name}</Text><Text style={styles.identityMeta} numberOfLines={2}>{project.customerName} · {project.location}</Text></View><Text style={[styles.identityStatus,project.status==='active'?styles.identityStatusActive:styles.identityStatusCompleted]}>{project.status==='active'?'ACTIVE':'COMPLETED'}</Text></View>
    {workDate?<Text style={styles.identityDate}>Report date: {workDate}</Text>:null}
    <Text style={styles.identityPeriod}>{period}</Text>
    {subtitle?<Text style={styles.identitySubtitle}>{subtitle}</Text>:null}
  </View>;
}

function PdfChoiceCard({label,recommended,selected,onPress}:{label:string;recommended?:boolean;selected:boolean;onPress:()=>void}){
  return <TouchableOpacity style={[styles.pdfChoiceCard,selected&&styles.pdfChoiceCardSelected]} onPress={onPress} accessibilityRole="button" accessibilityState={{selected}}>
    <Text style={[styles.pdfChoiceLabel,selected&&styles.pdfChoiceLabelSelected]}>{label}</Text>
    {recommended?<Text style={styles.pdfChoiceRecommended}>RECOMMENDED · DEFAULT</Text>:null}
  </TouchableOpacity>;
}

function RotatingMark({open,color,reducedMotion,size=24}:{open:boolean;color:string;reducedMotion:boolean;size?:number}){
  const rotate=useState(()=>new Animated.Value(open?1:0))[0];
  useEffect(()=>{Animated.timing(rotate,{toValue:open?1:0,duration:reducedMotion?0:200,useNativeDriver:true}).start();},[open,reducedMotion,rotate]);
  return <Animated.Text style={[styles.rotatingMark,{color,fontSize:size,transform:[{rotate:rotate.interpolate({inputRange:[0,1],outputRange:['0deg','45deg']})}]}]}>+</Animated.Text>;
}

type BadgeTone='neutral'|'warning';
function LedgerSection({number,title,badge,badgeTone='neutral',open,onToggle,reducedMotion,children}:{number:string;title:string;badge?:string;badgeTone?:BadgeTone;open:boolean;onToggle:()=>void;reducedMotion:boolean;children:React.ReactNode}){
  return <View style={styles.ledgerWrap}>
    <View style={styles.ledgerTab}><Text style={styles.ledgerTabText}>{number}</Text></View>
    <TouchableOpacity activeOpacity={.75} style={[styles.ledgerHeader,open&&styles.ledgerHeaderOpen]} onPress={onToggle} accessibilityRole="button" accessibilityState={{expanded:open}}>
      <Text style={styles.ledgerTitle} numberOfLines={2}>{title}</Text>
      {badge?<View style={[styles.sectionBadge,badgeTone==='warning'&&styles.sectionBadgeWarning]}><Text style={[styles.sectionBadgeText,badgeTone==='warning'&&styles.sectionBadgeWarningText]} numberOfLines={1}>{badge}</Text></View>:null}
      <RotatingMark open={open} color="#FFF8ED" reducedMotion={reducedMotion}/>
    </TouchableOpacity>
    {open?<View style={styles.ledgerBody}>{children}</View>:null}
  </View>;
}

function summarizePpe(safetyPeople:{name:string;type:SafetyParticipantType;label:string}[],workerSafety:{workerName:string;participantType?:SafetyParticipantType;status:WorkerSafetyStatus}[]){
  let compliant=0,missing=0,notChecked=0;
  for(const person of safetyPeople){const safety=workerSafety.find(v=>v.workerName===person.name&&(v.participantType??'worker')===person.type);const status=safety?.status??'not_checked';if(status==='compliant')compliant++;else if(status==='missing')missing++;else notChecked++;}
  return {compliant,missing,notChecked,total:safetyPeople.length};
}

function DailyReportEditor({ setup, project, draft, reports, linkedLoads, linkedQuarryLoads, linkedFuelFills, linkedWasteDumps, busy, error, reducedMotion, onChange, onSave, onBack, onOpenReport }: { setup: ProjectReportSetup; project: ReportProject; draft: DailyProjectReportDraft; reports:DailyProjectReport[]; linkedLoads: LinkedProjectLoad[]; linkedQuarryLoads:LinkedQuarryLoad[]; linkedFuelFills:LinkedFuelFill[]; linkedWasteDumps: LinkedWasteDump[]; busy: boolean; error: string | null; reducedMotion:boolean; onChange: (draft: DailyProjectReportDraft) => void; onSave: () => void; onBack: () => void; onOpenReport:(report:DailyProjectReport)=>void }) {
  const [materialItemId, setMaterialItemId] = useState(''); const [materialUnitId, setMaterialUnitId] = useState('');
  const [materialQuantity, setMaterialQuantity] = useState(''); const [materialMovement, setMaterialMovement] = useState<'used' | 'transported'>('used');
  const [mediaError,setMediaError]=useState<string|null>(null);
  const [openSections,setOpenSections]=useState<Set<string>>(()=>new Set());
  const toggleSection=(key:string)=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setOpenSections(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});};
  const minutes = useMemo(() => netWorkMinutes(draft), [draft]);
  const safetyPeople=[...draft.workers.map(name=>({name,type:'worker' as const,label:'Worker'})),...draft.drivers.map(name=>({name,type:'driver' as const,label:'Truck Driver'}))];
  const ppeSummary=useMemo(()=>summarizePpe(safetyPeople,draft.workerSafety??[]),[safetyPeople,draft.workerSafety]);
  const duplicateReport=useMemo(()=>reports.find(r=>r.workDate===draft.workDate&&r.id!==draft.id)??null,[reports,draft.workDate,draft.id]);
  const update = <K extends keyof DailyProjectReportDraft>(key: K, value: DailyProjectReportDraft[K]) => onChange({ ...draft, [key]: value });
  function updateSafety(participantType:SafetyParticipantType,workerName:string,changes:{status?:WorkerSafetyStatus;missingItems?:string[];notes?:string}){const current=(draft.workerSafety??[]).find(value=>value.workerName===workerName&&(value.participantType??'worker')===participantType)??{workerName,participantType,status:'not_checked' as const,missingItems:[],notes:''};const next={...current,...changes};update('workerSafety',[...(draft.workerSafety??[]).filter(value=>!(value.workerName===workerName&&(value.participantType??'worker')===participantType)),next]);}
  function addMaterial() {
    const item = setup.items.find((value) => value.id === materialItemId); const unit = setup.units.find((value) => value.id === materialUnitId); const quantity = Number(materialQuantity.replace(',', '.'));
    if (!item || !unit || !/^\d+([.,]\d+)?$/.test(materialQuantity.trim())||!Number.isFinite(quantity)||!(quantity > 0)){setMediaError('Select an item and unit, then enter a quantity greater than zero.');return;}
    const material: DailyReportMaterial = { id: `material_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, itemId: item.id, itemName: item.name, unitId: unit.id, unitName: unit.name, unitSymbol: unit.symbol, quantity, movement: materialMovement };
    setMediaError(null);update('materials', [...draft.materials, material]); setMaterialQuantity('');
  }
  async function addPhoto(source:'camera'|'library') { if(draft.photos.length>=20){setMediaError('A report can contain up to 20 photos.');return;} try{setMediaError(null);const uri=source==='camera'?await capturePersistentImage('project-reports'):await pickPersistentImage('project-reports');if(uri)update('photos',[...draft.photos,uri]);}catch(cause){setMediaError(cause instanceof Error?cause.message:'Could not add photo.');} }

  const peopleCount=draft.workers.length+draft.drivers.length+draft.truckPlates.length+draft.machines.length;
  const notesFilledCount=[draft.notes,draft.problemsDelaysIncidents,draft.weatherSiteConditions,draft.nextWorkPlanned].filter(value=>value.trim()).length;
  const loadsCount=linkedLoads.length+linkedQuarryLoads.length;
  const sectionsWithEntries=[Boolean(draft.workDescription.trim()),peopleCount>0,ppeSummary.compliant+ppeSummary.missing>0,draft.materials.length>0,loadsCount>0,linkedFuelFills.length>0,linkedWasteDumps.length>0,notesFilledCount>0,draft.photos.length>0,minutes!=null].filter(Boolean).length;
  const ppeBadge=ppeSummary.total===0?'No entries':ppeSummary.missing>0?`${ppeSummary.missing} missing PPE`:ppeSummary.notChecked===ppeSummary.total?'Not checked':ppeSummary.compliant===ppeSummary.total?`${ppeSummary.compliant} compliant`:`${ppeSummary.compliant} compliant · ${ppeSummary.notChecked} not checked`;
  const signoffState=useMemo(()=>consultantSignoffState(draft),[draft]);
  const hasConsultantData=Boolean(draft.consultantName.trim())||draft.consultantSignaturePaths.length>0;
  const signoffBadge=signoffState==='disabled'?(hasConsultantData?'Off · data saved':'Off'):signoffState==='complete'?'Complete':'Incomplete';
  function removeConsultantData(){Alert.alert('Remove Sign-off Data Permanently','This deletes the saved consultant name and signature from this report. This cannot be undone.',[{text:'Cancel',style:'cancel'},{text:'Remove Permanently',style:'destructive',onPress:()=>onChange({...draft,consultantName:'',consultantSignaturePaths:[]})}]);}

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Header eyebrow="DAILY REPORT" title={project.name} onBack={onBack} />
      <IdentityCard project={project} workDate={draft.workDate}/>
      <View style={styles.progressStrip}><Text style={styles.progressStripText}>Sections with entries: <Text style={styles.progressStripNumber}>{sectionsWithEntries}</Text> of 10</Text></View>
      {duplicateReport?<View style={styles.duplicateWarning}><Text style={styles.duplicateWarningTitle}>A report already exists for {draft.workDate}</Text><Text style={styles.duplicateWarningText}>Saving will not create a second report for this project and date — the repository keeps one report per day. Open the existing report instead to continue editing it.</Text><TouchableOpacity style={styles.duplicateWarningButton} onPress={()=>onOpenReport(duplicateReport)} accessibilityRole="button"><Text style={styles.duplicateWarningButtonText}>Open Existing Report</Text></TouchableOpacity></View>:null}
      {error ? <View style={styles.errorBox}>{error.split('\n').map((line,index)=><Text key={index} style={styles.errorLine}>{line}</Text>)}</View> : null}

      <LedgerSection number="01" title="Work Information" badge={draft.workDescription.trim()?'Added':'Required — no entry'} badgeTone={draft.workDescription.trim()?'neutral':'warning'} open={openSections.has('work')} onToggle={()=>toggleSection('work')} reducedMotion={reducedMotion}>
        <DatePickerField label="Work date *" value={draft.workDate} onChange={(value) => update('workDate', value)} minDate={project.startDate??undefined} maxDate={project.endDate??todayIso()} />
        <Field label="Description of work performed *" value={draft.workDescription} onChangeText={(value) => update('workDescription', value)} multiline placeholder="What happened on the project today?" required/>
      </LedgerSection>

      <LedgerSection number="02" title="People and Equipment" badge={peopleCount>0?`${peopleCount} present`:'No entries'} open={openSections.has('people')} onToggle={()=>toggleSection('people')} reducedMotion={reducedMotion}>
        <Text style={styles.sectionHint}>Choose saved records from a dropdown or type names and plates manually. Both methods can be combined; all fields are optional.</Text>
        <PresenceField label="Workers" options={setup.presenceOptions.workers} values={draft.workers} onChange={(value) => update('workers', value)} />
        <PresenceField label="Drivers" options={setup.presenceOptions.drivers} values={draft.drivers} onChange={(value) => update('drivers', value)} />
        <PresenceField label="Truck plates" options={setup.presenceOptions.truckPlates} values={draft.truckPlates} onChange={(value) => update('truckPlates', value)} />
        <PresenceField label="Machines" options={setup.presenceOptions.machines} values={draft.machines} onChange={(value) => update('machines', value)} />
      </LedgerSection>

      <LedgerSection number="03" title="Worker Safety / PPE" badge={ppeBadge} badgeTone={ppeSummary.missing>0?'warning':'neutral'} open={openSections.has('ppe')} onToggle={()=>toggleSection('ppe')} reducedMotion={reducedMotion}>
        <Text style={styles.sectionHint}>Workers and truck drivers start as Not Checked. Record compliance or missing safety equipment without blocking the report.</Text>
        {safetyPeople.length?safetyPeople.map(person=>{const safety=(draft.workerSafety??[]).find(value=>value.workerName===person.name&&(value.participantType??'worker')===person.type)??{workerName:person.name,participantType:person.type,status:'not_checked' as const,missingItems:[],notes:''};return <View key={`${person.type}:${person.name}`} style={styles.safetyWorker}><View style={styles.safetyWorkerHeader}><Text style={styles.recordName}>{person.name}</Text><View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{person.label}</Text></View></View><View style={styles.ppeChips}><PpeChoice label="Compliant" tone="success" selected={safety.status==='compliant'} onPress={()=>updateSafety(person.type,person.name,{status:'compliant',missingItems:[]})}/><PpeChoice label="Missing PPE" tone="warning" selected={safety.status==='missing'} onPress={()=>updateSafety(person.type,person.name,{status:'missing'})}/><PpeChoice label="Not Checked" tone="neutral" selected={safety.status==='not_checked'} onPress={()=>updateSafety(person.type,person.name,{status:'not_checked',missingItems:[]})}/></View>{safety.status==='missing'?<><Text style={styles.fieldLabel}>Missing equipment</Text><View style={styles.chipWrap}>{safetyEquipment.map(item=><Choice key={item} label={item} selected={safety.missingItems.includes(item)} onPress={()=>updateSafety(person.type,person.name,{missingItems:safety.missingItems.includes(item)?safety.missingItems.filter(value=>value!==item):[...safety.missingItems,item]})}/>)}</View></>:null}<Field label="Safety notes" value={safety.notes} onChangeText={notes=>updateSafety(person.type,person.name,{notes})} placeholder="Optional observation"/></View>}):<Text style={styles.helper}>Add the present workers or drivers above first.</Text>}
      </LedgerSection>

      <LedgerSection number="04" title="Materials" badge={draft.materials.length?`${draft.materials.length} material${draft.materials.length===1?'':'s'}`:'No entries'} open={openSections.has('materials')} onToggle={()=>toggleSection('materials')} reducedMotion={reducedMotion}>
        <Text style={styles.sectionHint}>Add each item and unit separately; different units are never combined.</Text>
        {draft.materials.map((material) => <View key={material.id} style={styles.materialRow}><View style={styles.flex}><Text style={styles.recordName}>{material.itemName}</Text><Text style={styles.materialQuantity}>{material.quantity}{' '}<Text style={styles.materialUnit}>{material.unitSymbol}</Text></Text><View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{material.movement==='used'?'Used':'Transported'}</Text></View></View><TouchableOpacity style={styles.removeWrap} onPress={() => update('materials', draft.materials.filter((value) => value.id !== material.id))} accessibilityRole="button"><Text style={styles.remove}>Remove</Text></TouchableOpacity></View>)}
        <SearchableSelect label="Item" options={setup.items.map((item) => ({ id: item.id, label: item.name, detail: item.categoryName }))} selectedId={materialItemId} onSelect={setMaterialItemId} placeholder="Select daily-report item" />
        <SearchableSelect label="Unit" options={setup.units.map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))} selectedId={materialUnitId} onSelect={setMaterialUnitId} />
        <View style={styles.twoColumns}><View style={styles.flex}><Field label="Quantity" value={materialQuantity} onChangeText={setMaterialQuantity} keyboardType="decimal-pad" /></View><View style={styles.flex}><Text style={styles.fieldLabel}>Movement</Text><View style={styles.chipWrap}><Choice label="Used" selected={materialMovement === 'used'} onPress={() => setMaterialMovement('used')} /><Choice label="Transported" selected={materialMovement === 'transported'} onPress={() => setMaterialMovement('transported')} /></View></View></View>
        {mediaError?<Text style={styles.error}>{mediaError}</Text>:null}
        <TouchableOpacity style={styles.secondary} onPress={addMaterial} accessibilityRole="button"><Text style={styles.secondaryText}>Add material</Text></TouchableOpacity>
      </LedgerSection>

      <LedgerSection number="05" title="Loads Delivered" badge={loadsCount?`${loadsCount} load${loadsCount===1?'':'s'}`:'No loads'} open={openSections.has('loads')} onToggle={()=>toggleSection('loads')} reducedMotion={reducedMotion}>
        <Text style={styles.sectionHint}>Automatically linked, read-only deliveries for this project and work date.</Text>
        <View style={styles.sourceGroupHeading}><View style={[styles.sourceDot,styles.sourceDotCompany]}/><Text style={styles.sourceGroupTitle}>DROMEX / Company Loads · {linkedLoads.length}</Text></View>
        {linkedLoads.length ? linkedLoads.map((load) => <LoadRow key={load.id} source="company" name={load.itemName} quantity={load.quantity} unit={load.unitSymbol} reference={load.transactionNumber} driver={load.driverName} truck={load.truckPlate} total={load.finalTotalUsd}/>) : <Text style={styles.helper}>No matching receipt loads for this date.</Text>}
        <View style={styles.sourceGroupHeading}><View style={[styles.sourceDot,styles.sourceDotSupplier]}/><Text style={styles.sourceGroupTitle}>Supplier Loads · {linkedQuarryLoads.length}</Text></View>
        {linkedQuarryLoads.length?linkedQuarryLoads.map(load=><LoadRow key={load.id} source="supplier" name={load.itemName} quantity={load.quantity} unit={load.unitSymbol} reference={`${load.purchaseNumber} · ${load.supplierName}`} deliveryLabel={load.deliveryLabel} truck={load.truckPlate??undefined} time={new Date(load.confirmedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} ticket={load.supplierTicketNumber??undefined} notes={load.notes??undefined} total={load.finalTotalUsd}/>):<Text style={styles.helper}>No active supplier loads linked to this project and date.</Text>}
      </LedgerSection>

      <LedgerSection number="06" title="Fuel Used" badge={linkedFuelFills.length?`${linkedFuelFills.length} fill${linkedFuelFills.length===1?'':'s'}`:'No fills'} open={openSections.has('fuel')} onToggle={()=>toggleSection('fuel')} reducedMotion={reducedMotion}>
        <Text style={styles.sectionHint}>Automatically linked from active equipment fills for this project and work date. Costs use the immutable price saved on each fill.</Text>
        <View style={styles.totalsCard}><Text style={styles.totalsValue}>{linkedFuelFills.reduce((sum,fill)=>sum+fill.litres,0).toFixed(2)} L</Text><Text style={styles.totalsLabel}>TOTAL FUEL · ${linkedFuelFills.reduce((sum,fill)=>sum+(fill.consumptionCostUsd??0),0).toFixed(2)}</Text></View>
        {linkedFuelFills.some(fill=>fill.consumptionCostUsd==null)?<Text style={styles.notice}>{linkedFuelFills.filter(fill=>fill.consumptionCostUsd==null).reduce((sum,fill)=>sum+fill.litres,0).toFixed(2)} L is unpriced and excluded from the cost total.</Text>:null}
        {linkedFuelFills.length?linkedFuelFills.map(fill=><View key={fill.id} style={styles.recordRow}><View style={styles.recordTop}><Text style={styles.recordName}>{fill.equipmentName}</Text><Text style={styles.recordStrongValue}>{fill.litres.toFixed(2)}{' '}<Text style={styles.materialUnit}>L</Text></Text></View><Text style={styles.recordMeta}>{new Date(fill.confirmedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {fill.pricePerLitreUsd==null?'Unpriced':`$${fill.pricePerLitreUsd.toFixed(2)}/L · $${fill.consumptionCostUsd?.toFixed(2)}`}</Text>{fill.odometerReading?<Text style={styles.recordMeta}>Odometer {fill.odometerReading}</Text>:null}{fill.notes?<Text style={styles.recordMeta}>{fill.notes}</Text>:null}</View>):<Text style={styles.helper}>No active fuel fills linked to this project and date.</Text>}
      </LedgerSection>

      <LedgerSection number="07" title="Waste Dumps" badge={linkedWasteDumps.length?`${linkedWasteDumps.length} dump${linkedWasteDumps.length===1?'':'s'}`:'No dumps'} open={openSections.has('waste')} onToggle={()=>toggleSection('waste')} reducedMotion={reducedMotion}>
        <Text style={styles.sectionHint}>Automatically linked from active Waste Dump records for this project and work date. Cancelled dumps are excluded.</Text>
        <View style={styles.totalsCard}><Text style={styles.totalsValue}>{linkedWasteDumps.length}</Text><Text style={styles.totalsLabel}>TOTAL DUMPS</Text></View>
        {linkedWasteDumps.length ? linkedWasteDumps.map((dump) => <View key={dump.id} style={styles.recordRow}><Text style={styles.recordName}>{dump.materialType}</Text><Text style={styles.recordMeta}>{dump.dumpLocation} · {new Date(dump.dumpedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</Text><Text style={styles.recordMeta}>{[dump.driverName,dump.truckPlate].filter(Boolean).join(' · ') || 'No driver or truck selected'}</Text></View>) : <Text style={styles.helper}>No completed waste dumps linked to this project and date.</Text>}
      </LedgerSection>

      <LedgerSection number="08" title="Site Notes" badge={notesFilledCount?`${notesFilledCount} of 4 added`:'No entries'} open={openSections.has('notes')} onToggle={()=>toggleSection('notes')} reducedMotion={reducedMotion}>
        <NoteCard label="General notes" value={draft.notes} onChangeText={(value) => update('notes', value)} />
        <NoteCard label="Problems, delays, or incidents" value={draft.problemsDelaysIncidents} onChangeText={(value) => update('problemsDelaysIncidents', value)} attention/>
        <NoteCard label="Weather and site conditions" value={draft.weatherSiteConditions} onChangeText={(value) => update('weatherSiteConditions', value)} />
        <NoteCard label="Next work planned" value={draft.nextWorkPlanned} onChangeText={(value) => update('nextWorkPlanned', value)} />
      </LedgerSection>

      <LedgerSection number="09" title="Photos" badge={draft.photos.length?`${draft.photos.length} photo${draft.photos.length===1?'':'s'}`:'No photos'} open={openSections.has('photos')} onToggle={()=>toggleSection('photos')} reducedMotion={reducedMotion}>
        <Text style={styles.sectionHint}>Optional camera or library photos. Maximum 20.</Text>
        {mediaError?<Text style={styles.error}>{mediaError}</Text>:null}<View style={styles.photoActions}><TouchableOpacity style={styles.secondary} onPress={()=>void addPhoto('camera')} accessibilityRole="button"><Text style={styles.secondaryText}>Take photo</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>void addPhoto('library')} accessibilityRole="button"><Text style={styles.secondaryText}>Choose photo</Text></TouchableOpacity></View><View style={styles.photoGrid}>{draft.photos.map((uri,index)=><View key={uri} style={styles.photoItem}><Image source={{uri}} style={styles.photo}/><TouchableOpacity style={styles.removePhotoWrap} onPress={()=>update('photos',draft.photos.filter((_,photoIndex)=>photoIndex!==index))} accessibilityRole="button"><Text style={styles.remove}>Remove</Text></TouchableOpacity></View>)}</View>
      </LedgerSection>

      <LedgerSection number="10" title="Working Time" badge={minutes!=null?`Net ${Math.floor(minutes/60)}h ${minutes%60}m`:'No entries'} open={openSections.has('time')} onToggle={()=>toggleSection('time')} reducedMotion={reducedMotion}>
        <Text style={styles.sectionHint}>Optional times for {draft.workDate}. Every daily report keeps its own start, end, and break. Tap a time to scroll to it.</Text>
        <View style={styles.twoColumns}><View style={styles.flex}><TimePickerField label="Start time" value={draft.workStartTime} onChange={(value) => update('workStartTime', value)} placeholder="For example 07:00" /></View><View style={styles.flex}><TimePickerField label="End time" value={draft.workEndTime} onChange={(value) => update('workEndTime', value)} placeholder="For example 17:00" /></View></View>
        <Field label="Break for this day (minutes)" value={draft.breakMinutes} onChangeText={(value) => update('breakMinutes', value)} keyboardType="number-pad" placeholder="For example 60" />
        <View style={styles.totalsCard}><Text style={styles.totalsValue}>{minutes != null ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : '—'}</Text><Text style={styles.totalsLabel}>NET WORKING TIME</Text></View>
      </LedgerSection>

      <LedgerSection number="11" title="Consultant Sign-off" badge={signoffBadge} badgeTone={signoffState==='incomplete'?'warning':'neutral'} open={openSections.has('consultant')} onToggle={()=>toggleSection('consultant')} reducedMotion={reducedMotion}>
        <Text style={styles.sectionHint}>Optional. When on, the consultant can add their name and digital signature here, before or after generating the PDF. Turning this off never deletes name or signature data already saved — it only hides the block from the next PDF.</Text>
        <View style={styles.chipWrap}><Choice label="Off" selected={!draft.consultantSignoffEnabled} onPress={()=>update('consultantSignoffEnabled',false)}/><Choice label="On" selected={draft.consultantSignoffEnabled} onPress={()=>update('consultantSignoffEnabled',true)}/></View>
        {draft.consultantSignoffEnabled?<>
          <Field label="Consultant name" value={draft.consultantName} onChangeText={(value)=>update('consultantName',value)} placeholder="Consultant's full name"/>
          <Text style={styles.fieldLabel}>Consultant signature</Text>
          <SignaturePad value={draft.consultantSignaturePaths} onChange={(paths)=>update('consultantSignaturePaths',paths)} hint="Consultant signs here"/>
          {signoffState==='incomplete'?<Text style={styles.notice}>Sign-off is on but not complete yet. The PDF will show "Consultant sign-off incomplete" until both a name and a signature are saved.</Text>:null}
        </>:hasConsultantData?<View style={styles.duplicateWarning}><Text style={styles.duplicateWarningTitle}>Sign-off is off, but saved data remains</Text><Text style={styles.duplicateWarningText}>The consultant name and/or signature already saved for this report are kept and will not appear on the PDF while sign-off is off. Remove them permanently only if you are sure.</Text><TouchableOpacity style={styles.duplicateWarningButton} onPress={removeConsultantData} accessibilityRole="button"><Text style={styles.duplicateWarningButtonText}>Remove Sign-off Data Permanently</Text></TouchableOpacity></View>:null}
      </LedgerSection>

      <View style={styles.reviewCard}>
        <Text style={styles.reviewTitle}>Final Review</Text>
        <Text style={styles.reviewLine}>Work description: {draft.workDescription.trim()?'Added':'Missing — required'}</Text>
        <Text style={styles.reviewLine}>{peopleCount} people/equipment entries · PPE: {ppeBadge}</Text>
        <Text style={styles.reviewLine}>{draft.materials.length} material{draft.materials.length===1?'':'s'} · {loadsCount} load{loadsCount===1?'':'s'} linked</Text>
        <Text style={styles.reviewLine}>{linkedFuelFills.length} fuel fill{linkedFuelFills.length===1?'':'s'} · {linkedWasteDumps.length} waste dump{linkedWasteDumps.length===1?'':'s'}</Text>
        <Text style={styles.reviewLine}>{notesFilledCount} of 4 note areas · {draft.photos.length} photo{draft.photos.length===1?'':'s'}</Text>
        <TouchableOpacity style={styles.save} disabled={busy} onPress={onSave} accessibilityRole="button"><Text style={styles.saveText}>{busy ? 'Saving…' : draft.id ? 'Save Changes' : 'Save Daily Report'}</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function LoadRow({source,name,quantity,unit,reference,driver,truck,deliveryLabel,time,ticket,notes,total}:{source:'company'|'supplier';name:string;quantity:number;unit:string;reference:string;driver?:string;truck?:string;deliveryLabel?:string;time?:string;ticket?:string;notes?:string;total?:number|null}){
  const accent=source==='company'?colors.brand:colors.navy;
  const showDriverTruck=source==='company'&&Boolean(driver&&truck);
  return <View style={[styles.loadRow,{borderLeftColor:accent}]}>
    <View style={styles.recordTop}><Text style={styles.recordName}>{name}</Text><Text style={styles.recordStrongValue}>{quantity}{' '}<Text style={styles.materialUnit}>{unit}</Text></Text></View>
    <Text style={styles.recordMeta}>{reference}{time?` · ${time}`:''}</Text>
    {source==='supplier'&&deliveryLabel?<Text style={styles.recordMeta}>{deliveryLabel==='Supplier Delivering'?`Supplier Delivering${truck?` · ${truck}`:''}`:`${deliveryLabel}${truck?` · ${truck}`:''}`}</Text>:null}
    {showDriverTruck?<Text style={styles.recordMeta}>{driver} · {truck}</Text>:null}
    {ticket?<Text style={styles.recordMeta}>Ticket {ticket}</Text>:null}
    {notes?<Text style={styles.recordMeta}>{notes}</Text>:null}
    {total!=null?<Text style={styles.recordStrongValue}>${total.toFixed(2)}</Text>:null}
  </View>;
}

function NoteCard({label,value,onChangeText,attention}:{label:string;value:string;onChangeText:(value:string)=>void;attention?:boolean}){
  return <View style={[styles.noteCard,attention&&styles.noteCardAttention]}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput style={styles.noteInput} value={value} onChangeText={onChangeText} multiline placeholderTextColor="#89939B"/>
  </View>;
}

function PpeChoice({label,tone,selected,onPress}:{label:string;tone:'success'|'warning'|'neutral';selected:boolean;onPress:()=>void}){
  const toneStyle=tone==='success'?styles.ppeChipSuccess:tone==='warning'?styles.ppeChipWarning:styles.ppeChipNeutral;
  return <TouchableOpacity style={[styles.ppeChip,selected&&toneStyle]} onPress={onPress} accessibilityRole="button" accessibilityState={{selected}}><Text style={[styles.ppeChipText,selected&&styles.ppeChipTextSelected]}>{label}</Text></TouchableOpacity>;
}

function Header({ eyebrow, title, onBack }: { eyebrow: string; title: string; onBack: () => void }) { return <View style={styles.header}><TouchableOpacity onPress={onBack} style={styles.back} accessibilityRole="button"><Text style={styles.backText}>Back</Text></TouchableOpacity><View style={styles.flex}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text></View></View>; }
function ProjectCard({ project, onPress }: { project: ReportProject; onPress: () => void }) { return <TouchableOpacity style={styles.reportCard} onPress={onPress} accessibilityRole="button"><View style={styles.reportCardHeader}><Text style={styles.reportCardTitle}>{project.name}</Text><Text style={styles.openText}>Open</Text></View><Text style={styles.helper}>{project.customerName}</Text><Text style={styles.helper}>{project.location}</Text></TouchableOpacity>; }
function DoubleDiagonalMark({contrast=false}:{contrast?:boolean}){return <View style={styles.doubleMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.diagonalMark,styles.diagonalOrange]}/><View style={[styles.diagonalMark,styles.diagonalNavy,contrast&&styles.diagonalContrast]}/></View>}
function ExportOption({title,description,format,ready=false}:{title:string;description:string;format:string;ready?:boolean}){return <View style={styles.exportOption}><View style={styles.exportHeader}><Text style={styles.exportTitle}>{title}</Text><Text style={[styles.statusBadge,ready?styles.ready:styles.planned]}>{ready?'READY':'PLANNED'}</Text></View><Text style={styles.helper}>{description}</Text><Text style={styles.exportFormat}>{format}</Text></View>;}
function WorkbookLanguagePicker({locale,onChange}:{locale:WorkbookLocale;onChange:(locale:WorkbookLocale)=>void}){return <View style={styles.languageCard}><View style={styles.flex}><Text style={styles.languageTitle}>Excel language</Text><Text style={styles.helper}>Labels and direction change; saved names and notes remain exactly as entered.</Text></View><View style={styles.languageChoices}><TouchableOpacity style={[styles.languageChoice,locale==='en'&&styles.languageChoiceSelected]} onPress={()=>onChange('en')}><Text style={[styles.languageChoiceText,locale==='en'&&styles.languageChoiceTextSelected]}>English LTR</Text></TouchableOpacity><TouchableOpacity style={[styles.languageChoice,locale==='ar'&&styles.languageChoiceSelected]} onPress={()=>onChange('ar')}><Text style={[styles.languageChoiceText,locale==='ar'&&styles.languageChoiceTextSelected]}>العربية RTL</Text></TouchableOpacity></View></View>}
function BusinessWorkbookOption({kind,busy,disabled,progress,onPress}:{kind:BusinessReportKind;busy:boolean;disabled:boolean;progress:WorkbookProgress|null;onPress:()=>void}){const descriptions:Record<BusinessReportKind,string>={loads:'Confirmed load quantities, sales, VAT, payments, balances, and signatures.',customers:'Customer rollups, payment events, and carried-forward opening balances.',quarry:'Supplier rollups, purchase details, quantities, VAT, balances, and payments.',fuel:'Current balance, chronological movements, financial details, and equipment totals.',projects:'Project summaries, daily-report index, people/equipment context, and materials.',analysis:'All analysis-ready raw sheets, executive summary, and data dictionary in one file.'};return <TouchableOpacity activeOpacity={.7} disabled={disabled&&!busy} style={[styles.workbookOption,disabled&&!busy&&styles.workbookDisabled]} onPress={onPress}><View style={styles.workbookIcon}><Text style={styles.workbookIconText}>X</Text></View><View style={styles.flex}><Text style={styles.workbookTitle}>{businessReportLabels[kind]}</Text><Text style={styles.workbookDescription}>{descriptions[kind]}</Text>{busy?<><View style={styles.exportProgressTrack}><View style={[styles.exportProgressFill,{width:`${Math.max(2,progress?.percent??2)}%`}]}/></View><Text style={styles.workbookFormat}>{progress?.percent??1}% · {progress?.message??'Preparing workbook'}</Text><Text style={styles.cancelExport}>Tap to cancel safely</Text></>:<Text style={styles.workbookFormat}>XLSX · Offline · Shareable</Text>}</View><Text style={styles.workbookArrow}>{busy?'×':'›'}</Text></TouchableOpacity>}
function ReportMenu({title,summary,tone,open,onToggle,children}:{title:string;summary:string;tone:'cream'|'orange'|'navy';open:boolean;onToggle:()=>void;children:React.ReactNode}){return <View style={styles.reportMenu}><TouchableOpacity activeOpacity={.72} style={[styles.reportMenuHeader,tone==='cream'?styles.reportMenuCream:tone==='orange'?styles.reportMenuOrange:styles.reportMenuNavy]} onPress={onToggle} accessibilityRole="button" accessibilityState={{expanded:open}}>{title==='Active Projects'?<DoubleDiagonalMark/>:null}<View style={styles.flex}><Text style={[styles.reportMenuTitle,tone!=='cream'&&styles.reportMenuTitleLight]}>{title}</Text><Text style={[styles.reportMenuSummary,tone!=='cream'&&styles.reportMenuSummaryLight]}>{summary}</Text></View><Text style={[styles.reportMenuMark,tone!=='cream'&&styles.reportMenuMarkLight]}>{open?'×':'+'}</Text></TouchableOpacity>{open?<View style={styles.reportMenuBody}>{children}</View>:null}</View>}
function Field({ label, required, ...props }: { label: string; required?:boolean; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'decimal-pad' | 'number-pad' }) { return <View style={styles.field}><Text style={[styles.fieldLabel,required&&!props.value.trim()&&styles.fieldLabelRequired]}>{label}</Text><TextInput style={[styles.input, props.multiline && styles.multiline]} placeholderTextColor="#89939B" {...props} /></View>; }
function PresenceField({ label, options, values, onChange }: { label: string; options: { id: string; label: string; detail?: string }[]; values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join(', ')); const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(values.join(', ')); }, [focused, values]);
  const lowerLabel = label.toLocaleLowerCase('en-US');
  return <View style={styles.presenceField}><View style={styles.presenceFieldHeading}><Text style={styles.presenceFieldLabel}>{label}</Text><View style={styles.roleBadge}><Text style={styles.roleBadgeText}>{values.length}</Text></View></View><SearchableSelect label={`Add saved ${lowerLabel}`} options={options} selectedId="" onSelect={(id) => { const selected = options.find((option) => option.id === id); if (selected) onChange(addPresence(values, selected.label)); }} placeholder={options.length ? `Choose ${lowerLabel}` : `No saved ${lowerLabel} yet`} /><View style={styles.field}><Text style={styles.fieldLabel}>{`Or type ${lowerLabel}`}</Text><TextInput style={[styles.input, styles.multiline]} value={text} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); onChange(splitPresence(text)); }} onChangeText={(value) => { setText(value); onChange(splitPresence(value)); }} multiline placeholder="Separate entries with commas or new lines" placeholderTextColor="#89939B" /></View></View>;
}
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <TouchableOpacity style={[styles.drChip, selected && styles.drChipSelected]} onPress={onPress} accessibilityRole="button" accessibilityState={{selected}}><Text style={[styles.drChipText, selected && styles.drChipTextSelected]}>{label}</Text></TouchableOpacity>; }

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, centerState:{alignItems:'center',justifyContent:'center',paddingVertical:60,gap:10}, content: { padding: 20, paddingBottom: 42, gap: 16 },
  errorState:{backgroundColor:'#FCE8E6',borderRadius:16,padding:20,gap:12,borderLeftWidth:4,borderLeftColor:colors.danger},errorStateTitle:{color:colors.ink,fontSize:17,fontWeight:'700'},errorStateText:{color:colors.danger,fontSize:13,lineHeight:19,fontWeight:'600'},retryButton:{minHeight:48,alignItems:'center',justifyContent:'center',backgroundColor:colors.ink,borderRadius:11,paddingHorizontal:16},retryButtonText:{color:'#FFF',fontWeight:'700'},
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 }, back: { minHeight:48,minWidth:48,justifyContent:'center',backgroundColor: colors.surface, paddingHorizontal:14, borderRadius: 10 }, backText: { color: colors.ink, fontWeight: '700' }, eyebrow: { color: colors.brand, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 }, title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 }, sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '700', marginTop: 4 }, sectionHint:{color:colors.muted,fontSize:12,lineHeight:18}, cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  identityCard:{backgroundColor:colors.navy,borderRadius:16,padding:17,gap:6},identityTop:{flexDirection:'row',alignItems:'flex-start',gap:10},identityProject:{color:'#FFF8ED',fontWeight:'900',fontSize:19,flexShrink:1},identityMeta:{color:'#D5E4EF',fontSize:12,lineHeight:17},identityStatus:{flexShrink:0,fontSize:10,fontWeight:'700',letterSpacing:.6,paddingHorizontal:8,paddingVertical:5,borderRadius:9,overflow:'hidden'},identityStatusActive:{color:colors.success,backgroundColor:'#E5F3EC'},identityStatusCompleted:{color:colors.warning,backgroundColor:'#FFF3D8'},identityDate:{color:'#F2A184',fontSize:13,fontWeight:'700'},identityPeriod:{color:'#D5E4EF',fontSize:11,lineHeight:16},identitySubtitle:{color:'#D5E4EF',fontSize:11,lineHeight:16},
  progressStrip:{backgroundColor:'#F5F2EC',borderRadius:11,paddingVertical:10,paddingHorizontal:14},progressStripText:{color:colors.ink,fontSize:13,fontWeight:'600'},progressStripNumber:{fontWeight:'900',color:colors.brandDark},
  duplicateWarning:{backgroundColor:'#FFF3D8',borderRadius:13,padding:14,gap:8,borderLeftWidth:4,borderLeftColor:colors.warning},duplicateWarningTitle:{color:colors.ink,fontWeight:'700',fontSize:14},duplicateWarningText:{color:colors.ink,fontSize:12,lineHeight:18},duplicateWarningButton:{minHeight:48,justifyContent:'center',alignItems:'center',backgroundColor:colors.ink,borderRadius:11},duplicateWarningButtonText:{color:'#FFF',fontWeight:'700'},
  errorBox:{backgroundColor:'#FCE8E6',borderRadius:10,padding:12,gap:4},errorLine:{color:colors.danger,fontWeight:'600',fontSize:13,lineHeight:18},
  projectContext: { backgroundColor: '#202D37', borderRadius: 16, padding: 17, gap: 4 }, projectContextTitle: { color: '#FFF', fontWeight: '900', fontSize: 17 },
  primary: { minHeight:48,backgroundColor: colors.brand, borderRadius: 16, padding: 18, gap: 4 }, primaryText: { color: '#FFF', fontWeight: '900', fontSize: 20 }, primaryHint: { color: '#F7D9D1', fontSize: 13 },
  reportCard: { backgroundColor: colors.surface, borderRadius: 15, padding: 16, gap: 8 }, reportCardHeader:{flexDirection:'row',alignItems:'flex-start',gap:10},reportCardTitle:{flex:1,minWidth:0,color:colors.ink,fontSize:16,fontWeight:'700'}, exportOption:{backgroundColor:colors.surface,borderRadius:15,padding:16,gap:7,overflow:'hidden'},exportHeader:{flexDirection:'row',alignItems:'flex-start',gap:8},exportTitle:{flex:1,minWidth:0,color:colors.ink,fontSize:16,fontWeight:'900'},statusBadge:{flexShrink:0,alignSelf:'flex-start',fontSize:9,fontWeight:'900',letterSpacing:.7,paddingHorizontal:8,paddingVertical:5,borderRadius:10,overflow:'hidden'},ready:{color:colors.success,backgroundColor:'#E5F3EC'},planned:{color:'#8A5B12',backgroundColor:'#FFF3D8'},exportFormat:{color:colors.brandDark,fontSize:12,fontWeight:'900',flexShrink:1}, empty: { borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', borderRadius: 15, padding: 16, gap: 5 },
  historyHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},historyCount:{color:colors.brandDark,backgroundColor:'#FBE9E4',paddingHorizontal:10,paddingVertical:6,borderRadius:13,fontWeight:'700',fontSize:11},
  reportCounts:{flexDirection:'row',flexWrap:'wrap',gap:8},reportCountText:{color:colors.muted,fontSize:11,fontWeight:'600',backgroundColor:'#F5F2EC',paddingHorizontal:8,paddingVertical:4,borderRadius:8},
  openText: { flexShrink:0,color:colors.brandDark,fontWeight:'700',backgroundColor:'#E8F3FB',paddingHorizontal:9,paddingVertical:5,borderRadius:10,overflow:'hidden',fontSize:11 }, reportDescription: { color: colors.ink, fontSize: 14, lineHeight: 20 }, notice: { color: colors.warning, backgroundColor: '#FFF3D8', padding: 13, borderRadius: 11, lineHeight: 19 },
  sectionCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 17, gap: 12 }, field: { gap: 6 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, fieldLabel: { color: colors.ink, fontSize: 13, fontWeight: '600' }, fieldLabelRequired:{color:colors.warning}, input: { minHeight:48,borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, backgroundColor: '#FCFBF8' }, multiline: { minHeight: 72, textAlignVertical: 'top' },
  twoColumns: { flexDirection: 'row', gap: 10 }, flex: { flex: 1 },
  presenceField:{gap:8,paddingBottom:12,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line},presenceFieldHeading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},presenceFieldLabel:{color:colors.ink,fontSize:14,fontWeight:'700'},
  recordName:{color:colors.ink,fontSize:16,fontWeight:'700'},roleBadge:{backgroundColor:'#F5F2EC',borderRadius:9,paddingHorizontal:9,paddingVertical:4},roleBadgeText:{color:colors.navy,fontSize:11,fontWeight:'600'},
  safetyWorker:{gap:10,padding:13,borderRadius:13,backgroundColor:'#F5F2EC',borderLeftWidth:3,borderLeftColor:colors.brand},safetyWorkerHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
  ppeChips:{flexDirection:'row',flexWrap:'wrap',gap:8},ppeChip:{minHeight:48,minWidth:96,flexGrow:1,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:12,paddingHorizontal:10,backgroundColor:colors.surface},ppeChipText:{color:colors.muted,fontWeight:'600',fontSize:13},ppeChipTextSelected:{color:'#FFF'},ppeChipSuccess:{backgroundColor:colors.success,borderColor:colors.success},ppeChipWarning:{backgroundColor:colors.warning,borderColor:colors.warning},ppeChipNeutral:{backgroundColor:colors.muted,borderColor:colors.muted},
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 18 }, chipSelected: { backgroundColor: '#FBE9E4', borderColor: colors.brand }, chipText: { color: colors.muted, fontWeight: '800', fontSize: 12 }, chipTextSelected: { color: colors.brandDark },
  chipWrap:{flexDirection:'row',flexWrap:'wrap',gap:8}, drChip: { minHeight:48,justifyContent:'center',borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, borderRadius: 18 }, drChipSelected: { backgroundColor: '#FBE9E4', borderColor: colors.brand }, drChipText: { color: colors.muted, fontWeight: '600', fontSize: 12 }, drChipTextSelected: { color: colors.brandDark },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, materialQuantity:{color:colors.ink,fontSize:18,fontWeight:'900',marginTop:3},materialUnit:{fontSize:13,fontWeight:'600',color:colors.muted},
  removeWrap:{minHeight:48,minWidth:48,alignItems:'center',justifyContent:'center'},remove: { color: colors.danger, fontWeight: '600' }, secondary: { minHeight:48,justifyContent:'center',borderWidth: 1, borderColor: colors.ink, borderRadius: 11, padding: 12, alignItems: 'center' }, secondaryText: { color: colors.ink, fontWeight: '700' },
  sourceGroupHeading:{flexDirection:'row',alignItems:'center',gap:8,marginTop:4},sourceDot:{width:10,height:10,borderRadius:5},sourceDotCompany:{backgroundColor:colors.brand},sourceDotSupplier:{backgroundColor:colors.navy},sourceGroupTitle:{color:colors.navy,fontSize:12,fontWeight:'700',letterSpacing:.4},
  loadRow:{backgroundColor:colors.surface,borderRadius:12,padding:13,gap:4,borderWidth:1,borderColor:'#D7E2E8',borderLeftWidth:3},recordTop:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:8},recordStrongValue:{color:colors.ink,fontSize:16,fontWeight:'700'},recordMeta:{color:colors.muted,fontSize:12,lineHeight:17},
  recordRow:{backgroundColor:colors.surface,borderRadius:12,padding:13,gap:4,borderLeftWidth:3,borderLeftColor:colors.brand},
  totalsCard:{backgroundColor:'#F5F2EC',borderRadius:13,padding:14,alignItems:'flex-start',gap:2},totalsValue:{color:colors.ink,fontSize:22,fontWeight:'900'},totalsLabel:{color:colors.navy,fontSize:11,fontWeight:'700',letterSpacing:.4},
  noteCard:{backgroundColor:colors.surface,borderRadius:12,padding:13,gap:8,borderLeftWidth:3,borderLeftColor:colors.navy},noteCardAttention:{borderLeftColor:colors.danger,backgroundColor:'#FCE8E6'},noteInput:{minHeight:64,color:colors.ink,fontSize:14,lineHeight:20,textAlignVertical:'top'},
  save: { minHeight:48,backgroundColor: colors.ink, borderRadius: 13, padding: 16, alignItems: 'center' }, saveText: { color: '#FFF', fontWeight: '900', fontSize: 16 }, error: { color: colors.danger, backgroundColor: '#FCE8E6', padding: 12, borderRadius: 10, fontWeight: '700' }, success: { color: colors.success, backgroundColor: '#E5F3EC', padding: 12, borderRadius: 10, fontWeight: '700' },
  reviewCard:{backgroundColor:'#F5F2EC',borderRadius:16,padding:17,gap:9,borderWidth:1,borderColor:'#E3D6C2'},reviewTitle:{color:colors.ink,fontSize:17,fontWeight:'700'},reviewLine:{color:colors.ink,fontSize:13,lineHeight:19,fontWeight:'500'},
  projectSelector:{borderRadius:17,overflow:'hidden',borderWidth:1,borderColor:'#D9D0C3',backgroundColor:'#FFF8ED'},projectSelectorHeader:{backgroundColor:'#173F67',padding:17,flexDirection:'row',alignItems:'center',gap:14},projectSelectorCopy:{flex:1,minWidth:0,gap:3},projectSelectorEyebrow:{color:'#F2A184',fontSize:11,fontWeight:'700',letterSpacing:1.3},projectSelectorTitle:{color:'#FFF8ED',fontSize:21,fontWeight:'900'},projectSelectorHint:{color:'#D5E4EF',fontSize:11,lineHeight:16},projectSelectorBody:{padding:16,gap:12,backgroundColor:'#FFF8ED'},selectedProjectPreview:{backgroundColor:colors.surface,borderRadius:13,padding:14,borderLeftWidth:4,borderLeftColor:colors.brand,flexDirection:'row',alignItems:'flex-start',gap:10},selectedProjectCopy:{flex:1,minWidth:0,gap:2},selectedProjectName:{color:colors.ink,fontSize:16,fontWeight:'700'},selectedProjectMeta:{color:colors.muted,fontSize:12,lineHeight:17},selectedProjectStatus:{fontSize:11,fontWeight:'700',letterSpacing:.7,paddingHorizontal:8,paddingVertical:5,borderRadius:10,overflow:'hidden'},selectedProjectActive:{color:colors.success,backgroundColor:'#E5F3EC'},selectedProjectCompleted:{color:colors.warning,backgroundColor:'#FFF3D8'},projectSelectorEmpty:{borderWidth:1,borderStyle:'dashed',borderColor:colors.line,borderRadius:12,padding:13,gap:3},projectSelectorEmptyTitle:{color:colors.ink,fontWeight:'700'},openProject:{minHeight:48,backgroundColor:'#173F67',borderRadius:12,paddingHorizontal:15,paddingVertical:14,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:9},openProjectDisabled:{opacity:.35},openProjectText:{color:'#FFF',fontWeight:'700',fontSize:15},openProjectArrow:{color:colors.brand,fontSize:25,fontWeight:'900',lineHeight:19},doubleMark:{width:43,height:31,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4},diagonalMark:{width:11,height:28,borderRadius:2,transform:[{skewX:'-18deg'}]},diagonalOrange:{backgroundColor:colors.brand},diagonalNavy:{backgroundColor:'#173F67'},diagonalContrast:{borderWidth:1,borderColor:'#FFF8ED'},
  generatePdfButton:{minHeight:48,flex:1,alignItems:'center',justifyContent:'center',backgroundColor:colors.ink,borderRadius:11},generatePdfButtonText:{color:'#FFF',fontWeight:'700'},excelButton:{minHeight:48,flex:1,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.success,borderRadius:11},excelButtonText:{color:colors.success,fontWeight:'700'},reportActionRow:{flexDirection:'row',gap:8},
  pdfChoicePanel:{gap:9,backgroundColor:'#F5F2EC',borderRadius:12,padding:12},pdfChoiceCard:{minHeight:48,justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:11,padding:12,backgroundColor:colors.surface},pdfChoiceCardSelected:{borderColor:colors.ink,backgroundColor:'#FFF'},pdfChoiceLabel:{color:colors.muted,fontWeight:'700',fontSize:14},pdfChoiceLabelSelected:{color:colors.ink},pdfChoiceRecommended:{color:colors.success,fontSize:10,fontWeight:'700',marginTop:3,letterSpacing:.4},pdfChoiceExplain:{color:colors.muted,fontSize:11,lineHeight:16},pdfChoiceConfirm:{minHeight:48,alignItems:'center',justifyContent:'center',backgroundColor:colors.brand,borderRadius:11},pdfChoiceConfirmText:{color:'#FFF',fontWeight:'700'},
  showMore:{minHeight:48,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.ink,borderRadius:11},showMoreText:{color:colors.ink,fontWeight:'700'},
  photoActions:{flexDirection:'row',gap:8},photoGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},photoItem:{width:'47%',gap:5},photo:{width:'100%',height:110,borderRadius:9,backgroundColor:'#EEE'},removePhotoWrap:{minHeight:48,justifyContent:'center',alignItems:'center'},
  businessExportHeading:{color:colors.brand,fontSize:10,fontWeight:'900',letterSpacing:1.1,marginTop:5},workbookOption:{backgroundColor:colors.surface,borderWidth:1,borderColor:'#D9D0C3',borderRadius:13,padding:13,flexDirection:'row',alignItems:'center',gap:11},workbookDisabled:{opacity:.42},workbookIcon:{width:36,height:36,borderRadius:10,backgroundColor:'#E5F3EC',alignItems:'center',justifyContent:'center',borderLeftWidth:3,borderLeftColor:colors.success},workbookIconText:{color:colors.success,fontSize:17,fontWeight:'900'},workbookTitle:{color:colors.ink,fontSize:14,fontWeight:'900'},workbookDescription:{color:colors.muted,fontSize:10,lineHeight:15,marginTop:2},workbookFormat:{color:colors.success,fontSize:9,fontWeight:'900',letterSpacing:.45,marginTop:5},workbookArrow:{color:colors.brand,fontSize:25,fontWeight:'900'},
  completionExport:{minHeight:48,backgroundColor:colors.brand,borderRadius:14,padding:16,gap:5},completionExportTitle:{color:'#FFF',fontWeight:'900',fontSize:17},completionExportHint:{color:'#F7D9D1',fontSize:12,lineHeight:18},
  reportMenu:{borderRadius:15,overflow:'hidden'},reportMenuHeader:{padding:16,flexDirection:'row',alignItems:'center',gap:12},reportMenuCream:{backgroundColor:'#FFF8ED',borderWidth:1,borderColor:'#E8DED0'},reportMenuOrange:{backgroundColor:colors.brand},reportMenuNavy:{backgroundColor:'#173F67'},reportMenuTitle:{color:'#173F67',fontSize:19,fontWeight:'900'},reportMenuTitleLight:{color:colors.background},reportMenuSummary:{color:colors.muted,fontSize:11,marginTop:3},reportMenuSummaryLight:{color:'#E8E2D7'},reportMenuMark:{color:'#173F67',fontSize:28,fontWeight:'700',width:28,textAlign:'center'},reportMenuMarkLight:{color:colors.background},reportMenuBody:{backgroundColor:'#FFF8ED',padding:12,gap:10,borderTopWidth:3,borderTopColor:'#173F67'},
  dateRow:{flexDirection:'row',gap:10},filterFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,paddingTop:4},filterScope:{color:colors.muted,fontSize:11,fontWeight:'700'},clearFilter:{color:colors.brandDark,fontSize:12,fontWeight:'900'},exportProgressTrack:{height:7,borderRadius:4,backgroundColor:'#DCE6E0',overflow:'hidden',marginTop:8},exportProgressFill:{height:'100%',borderRadius:4,backgroundColor:colors.success},cancelExport:{color:colors.danger,fontSize:10,fontWeight:'900',marginTop:3},languageCard:{backgroundColor:'#F2EEE6',borderRadius:13,padding:13,gap:10,borderLeftWidth:3,borderLeftColor:colors.brand},languageTitle:{color:colors.ink,fontWeight:'900',fontSize:14},languageChoices:{flexDirection:'row',gap:8},languageChoice:{flex:1,borderWidth:1,borderColor:colors.line,borderRadius:10,paddingVertical:10,paddingHorizontal:8,alignItems:'center',backgroundColor:colors.surface},languageChoiceSelected:{backgroundColor:'#173F67',borderColor:'#173F67'},languageChoiceText:{color:colors.muted,fontSize:12,fontWeight:'900'},languageChoiceTextSelected:{color:'#FFF'},
  ledgerWrap:{marginTop:16,position:'relative'},ledgerTab:{position:'absolute',top:-10,left:14,zIndex:2,minWidth:34,height:26,borderRadius:7,backgroundColor:'#FFF8ED',alignItems:'center',justifyContent:'center',paddingHorizontal:6,borderWidth:1,borderColor:'#E3D6C2'},ledgerTabText:{color:colors.navy,fontSize:12,fontWeight:'700'},
  ledgerHeader:{minHeight:64,backgroundColor:colors.navy,borderRadius:15,paddingHorizontal:16,paddingTop:16,paddingBottom:14,flexDirection:'row',alignItems:'center',gap:10},ledgerHeaderOpen:{borderBottomLeftRadius:0,borderBottomRightRadius:0},ledgerTitle:{flex:1,color:'#FFF8ED',fontSize:16,fontWeight:'700'},
  sectionBadge:{backgroundColor:'rgba(255,248,237,0.18)',borderRadius:9,paddingHorizontal:9,paddingVertical:5,maxWidth:130},sectionBadgeText:{color:'#FFF8ED',fontSize:11,fontWeight:'600'},sectionBadgeWarning:{backgroundColor:'#FFF3D8'},sectionBadgeWarningText:{color:'#8A5B12'},
  rotatingMark:{fontWeight:'700',width:22,textAlign:'center'},
  ledgerBody:{backgroundColor:'#FFF8ED',borderRadius:15,borderTopLeftRadius:0,borderTopRightRadius:0,borderTopWidth:3,borderTopColor:colors.brand,padding:14,gap:12},
});
