import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { ProjectReportRepository } from '../../data/repositories/ProjectReportRepository';
import type { BusinessReportRepository } from '../../data/repositories/BusinessReportRepository';
import {activeBusinessFilterCount,businessReportLabels,emptyBusinessReportFilters,filterBusinessReportData,type BusinessReportFilters,type BusinessReportKind} from '../../domain/businessReports';
import type {WorkbookLocale,WorkbookProgress} from '../../services/businessWorkbook';
import {exportAndShareDailyReportWorkbook} from '../../services/dailyReportWorkbook';
import {
  addPresence, emptyDailyReport, netWorkMinutes, safetyEquipment, splitPresence,
  type DailyProjectReport, type DailyProjectReportDraft, type DailyReportMaterial,
  type LinkedFuelFill, type LinkedProjectLoad, type LinkedQuarryLoad, type LinkedWasteDump, type ProjectReportSetup, type ReportProject, type WorkerSafetyStatus,
} from '../../domain/projectReports';
import { SearchableSelect } from '../components/SearchableSelect';
import {CollapsibleFilterCard} from '../components/CollapsibleFilterCard';
import {DatePickerField,todayIso} from '../components/DatePickerField';
import { capturePersistentImage, pickPersistentImage } from '../../services/media';
import { exportAndShareProjectCompletion, exportAndShareProjectReport } from '../../services/documentExport';
import {exportBusinessWorkbook} from '../../services/businessWorkbookExport';
import Storage from 'expo-sqlite/kv-store';
import { colors } from '../theme';

export function ReportsScreen({ repository,businessReportRepository,onBack,initialBusinessFilters,initialProjectId,initialReportId,startNewReport=false }: { repository: ProjectReportRepository;businessReportRepository:BusinessReportRepository;onBack: () => void;initialBusinessFilters?:Partial<BusinessReportFilters>;initialProjectId?:string|null;initialReportId?:string|null;startNewReport?:boolean }) {
  const [setup, setSetup] = useState<ProjectReportSetup | null>(null);
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
  const refreshSetup = useCallback(async () => setSetup(await repository.getSetup()), [repository]);
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
    try { const [loads,quarry,waste,fuel] = await Promise.all([repository.listLinkedLoads(project.id, report.workDate),repository.listLinkedQuarryLoads(project.id,report.workDate),repository.listLinkedWasteDumps(project.id, report.workDate),repository.listLinkedFuelFills(project.id,report.workDate)]); await exportAndShareProjectReport(report, project, loads, quarry, waste, fuel, setup!.company,includePrices); setMessage(includePrices?'PDF with prices created.':'PDF without prices created.'); }
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

  if (!setup) return <View style={styles.loading}><Text style={styles.helper}>Loading reports…</Text></View>;
  if (draft && project) return <DailyReportEditor setup={setup} project={project} draft={draft} linkedLoads={linkedLoads} linkedQuarryLoads={linkedQuarryLoads} linkedFuelFills={linkedFuelFills} linkedWasteDumps={linkedWasteDumps} busy={busy} error={error} onChange={setDraft} onSave={() => void save()} onBack={() => setDraft(null)} />;
  if (project) return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header eyebrow="PROJECT REPORTS" title={project.name} onBack={() => { setProject(null); setReports([]); setMessage(null); }} />
      <View style={styles.projectContext}><Text style={styles.projectContextTitle}>{project.customerName}</Text><Text style={styles.helper}>{project.location}</Text></View>
      <WorkbookLanguagePicker locale={workbookLocale} onChange={setWorkbookLocale}/>
      {error ? <Text style={styles.error}>{error}</Text> : null}{message ? <Text style={styles.success}>{message}</Text> : null}
      {project.status === 'active' ? <TouchableOpacity style={styles.primary} onPress={() => void openNewReport(project)}><Text style={styles.primaryText}>Make Daily Report</Text><Text style={styles.primaryHint}>The project is selected automatically · draft autosaves locally</Text></TouchableOpacity> : <><Text style={styles.notice}>This project is completed. Its reports remain available, but a new report cannot be created until the project is reactivated.</Text><TouchableOpacity style={styles.completionExport} disabled={busy} onPress={()=>void shareCompletion()}><Text style={styles.completionExportTitle}>{busy?'Creating final PDF…':'Create Full Project PDF'}</Text><Text style={styles.completionExportHint}>Start-to-finish summary, daily timeline, loads, waste, working time, issues, people, equipment, and photos</Text></TouchableOpacity></>}
      <Text style={styles.sectionTitle}>Report history</Text>
      {reports.length ? reports.map((report) => {
        const exportingThis=dailyExportingId===report.id;
        return <View key={report.id} style={styles.reportCard}>
          <TouchableOpacity onPress={() => editReport(report)} disabled={busy}>
            <View style={styles.reportCardHeader}><Text style={styles.reportCardTitle}>{report.workDate}</Text><Text style={styles.openText}>Open</Text></View>
            <Text style={styles.reportDescription} numberOfLines={3}>{report.workDescription}</Text>
            <Text style={styles.helper}>Updated {new Date(report.updatedAt).toLocaleString()} · {report.photos.length} photos</Text>
          </TouchableOpacity>
          {exportingThis?<View style={styles.exportProgressTrack}><View style={[styles.exportProgressFill,{width:`${Math.max(2,exportProgress?.percent??2)}%`}]}/></View>:null}
          <View style={styles.reportExportRow}>
            <TouchableOpacity style={[styles.exportButton,styles.reportExportButton]} disabled={busy} onPress={()=>void shareReport(report,false)}><Text style={styles.exportButtonText}>PDF No Prices</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.exportButton,styles.reportExportButton]} disabled={busy} onPress={()=>void shareReport(report,true)}><Text style={styles.exportButtonText}>PDF With Prices</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.exportButton} disabled={busy&&!exportingThis} onPress={()=>void shareReportExcel(report)}><Text style={exportingThis?styles.cancelExport:styles.exportButtonText}>{exportingThis?`${exportProgress?.percent??1}% · Tap to cancel`:'Excel + Photos'}</Text></TouchableOpacity>
          {exportingThis?<Text style={styles.helper}>{exportProgress?.message}</Text>:null}
        </View>;
      }) : <View style={styles.empty}><Text style={styles.cardTitle}>No daily reports yet</Text><Text style={styles.helper}>Choose Make Daily Report to record the first workday.</Text></View>}
    </ScrollView>
  );

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
        <TouchableOpacity style={[styles.openProject, !selectedProject && styles.openProjectDisabled]} disabled={!selectedProject} onPress={() => selectedProject && setProject(selectedProject)}>
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

function DailyReportEditor({ setup, project, draft, linkedLoads, linkedQuarryLoads, linkedFuelFills, linkedWasteDumps, busy, error, onChange, onSave, onBack }: { setup: ProjectReportSetup; project: ReportProject; draft: DailyProjectReportDraft; linkedLoads: LinkedProjectLoad[]; linkedQuarryLoads:LinkedQuarryLoad[]; linkedFuelFills:LinkedFuelFill[]; linkedWasteDumps: LinkedWasteDump[]; busy: boolean; error: string | null; onChange: (draft: DailyProjectReportDraft) => void; onSave: () => void; onBack: () => void }) {
  const [materialItemId, setMaterialItemId] = useState(''); const [materialUnitId, setMaterialUnitId] = useState('');
  const [materialQuantity, setMaterialQuantity] = useState(''); const [materialMovement, setMaterialMovement] = useState<'used' | 'transported'>('used');
  const [mediaError,setMediaError]=useState<string|null>(null);
  const minutes = useMemo(() => netWorkMinutes(draft), [draft]);
  const update = <K extends keyof DailyProjectReportDraft>(key: K, value: DailyProjectReportDraft[K]) => onChange({ ...draft, [key]: value });
  function updateSafety(workerName:string,changes:{status?:WorkerSafetyStatus;missingItems?:string[];notes?:string}){const current=(draft.workerSafety??[]).find(value=>value.workerName===workerName)??{workerName,status:'not_checked' as const,missingItems:[],notes:''};const next={...current,...changes};update('workerSafety',[...(draft.workerSafety??[]).filter(value=>value.workerName!==workerName),next]);}
  function addMaterial() {
    const item = setup.items.find((value) => value.id === materialItemId); const unit = setup.units.find((value) => value.id === materialUnitId); const quantity = Number(materialQuantity.replace(',', '.'));
    if (!item || !unit || !/^\d+([.,]\d+)?$/.test(materialQuantity.trim())||!Number.isFinite(quantity)||!(quantity > 0)){setMediaError('Select an item and unit, then enter a quantity greater than zero.');return;}
    const material: DailyReportMaterial = { id: `material_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, itemId: item.id, itemName: item.name, unitId: unit.id, unitName: unit.name, unitSymbol: unit.symbol, quantity, movement: materialMovement };
    setMediaError(null);update('materials', [...draft.materials, material]); setMaterialQuantity('');
  }
  async function addPhoto(source:'camera'|'library') { if(draft.photos.length>=20){setMediaError('A report can contain up to 20 photos.');return;} try{setMediaError(null);const uri=source==='camera'?await capturePersistentImage('project-reports'):await pickPersistentImage('project-reports');if(uri)update('photos',[...draft.photos,uri]);}catch(cause){setMediaError(cause instanceof Error?cause.message:'Could not add photo.');} }
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Header eyebrow="DAILY REPORT" title={project.name} onBack={onBack} />
      <Text style={styles.helper}>{project.customerName} · {project.location}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Section title="Work information">
        <DatePickerField label="Work date *" value={draft.workDate} onChange={(value) => update('workDate', value)} maxDate={todayIso()} />
        <Field label="Description of work performed *" value={draft.workDescription} onChangeText={(value) => update('workDescription', value)} multiline placeholder="What happened on the project today?" />
      </Section>
      <Section title="People and equipment" hint="Choose saved records from a dropdown or type names and plates manually. Both methods can be combined; all fields are optional.">
        <PresenceField label="Workers" options={setup.presenceOptions.workers} values={draft.workers} onChange={(value) => update('workers', value)} />
        <PresenceField label="Drivers" options={setup.presenceOptions.drivers} values={draft.drivers} onChange={(value) => update('drivers', value)} />
        <PresenceField label="Truck plates" options={setup.presenceOptions.truckPlates} values={draft.truckPlates} onChange={(value) => update('truckPlates', value)} />
        <PresenceField label="Machines" options={setup.presenceOptions.machines} values={draft.machines} onChange={(value) => update('machines', value)} />
      </Section>
      <Section title="Worker safety / PPE" hint="Each present worker starts as Not checked. Record compliance or missing safety equipment without blocking the report.">
        {draft.workers.length?draft.workers.map(worker=>{const safety=(draft.workerSafety??[]).find(value=>value.workerName===worker)??{workerName:worker,status:'not_checked' as const,missingItems:[],notes:''};return <View key={worker} style={styles.safetyWorker}><Text style={styles.cardTitle}>{worker}</Text><View style={styles.chips}><Choice label="Compliant" selected={safety.status==='compliant'} onPress={()=>updateSafety(worker,{status:'compliant',missingItems:[]})}/><Choice label="Missing PPE" selected={safety.status==='missing'} onPress={()=>updateSafety(worker,{status:'missing'})}/><Choice label="Not checked" selected={safety.status==='not_checked'} onPress={()=>updateSafety(worker,{status:'not_checked',missingItems:[]})}/></View>{safety.status==='missing'?<><Text style={styles.label}>Missing equipment</Text><View style={styles.chips}>{safetyEquipment.map(item=><Choice key={item} label={item} selected={safety.missingItems.includes(item)} onPress={()=>updateSafety(worker,{missingItems:safety.missingItems.includes(item)?safety.missingItems.filter(value=>value!==item):[...safety.missingItems,item]})}/>)}</View></>:null}<Field label="Safety notes" value={safety.notes} onChangeText={notes=>updateSafety(worker,{notes})} placeholder="Optional observation"/></View>}):<Text style={styles.helper}>Add the present workers above first.</Text>}
      </Section>
      <Section title="Materials used or transported" hint="Add each item and unit separately; different units are never combined.">
        {draft.materials.map((material) => <View key={material.id} style={styles.materialRow}><View style={styles.flex}><Text style={styles.cardTitle}>{material.itemName}</Text><Text style={styles.helper}>{material.quantity} {material.unitSymbol} · {material.movement}</Text></View><TouchableOpacity onPress={() => update('materials', draft.materials.filter((value) => value.id !== material.id))}><Text style={styles.remove}>Remove</Text></TouchableOpacity></View>)}
        <SearchableSelect label="Item" options={setup.items.map((item) => ({ id: item.id, label: item.name, detail: item.categoryName }))} selectedId={materialItemId} onSelect={setMaterialItemId} placeholder="Select daily-report item" />
        <SearchableSelect label="Unit" options={setup.units.map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))} selectedId={materialUnitId} onSelect={setMaterialUnitId} />
        <View style={styles.twoColumns}><View style={styles.flex}><Field label="Quantity" value={materialQuantity} onChangeText={setMaterialQuantity} keyboardType="decimal-pad" /></View><View style={styles.flex}><Text style={styles.label}>Movement</Text><View style={styles.chips}><Choice label="Used" selected={materialMovement === 'used'} onPress={() => setMaterialMovement('used')} /><Choice label="Transported" selected={materialMovement === 'transported'} onPress={() => setMaterialMovement('transported')} /></View></View></View>
        <TouchableOpacity style={styles.secondary} onPress={addMaterial}><Text style={styles.secondaryText}>Add material</Text></TouchableOpacity>
      </Section>
      <Section title="Loads delivered that day" hint="Automatically linked, read-only deliveries for this project and work date.">
        <View style={styles.deliveryGroup}><Text style={styles.deliveryGroupTitle}>DROMEX / PLANT LOADS · {linkedLoads.length}</Text>{linkedLoads.length ? linkedLoads.map((load) => <View key={load.id} style={styles.linkedLoad}><Text style={styles.cardTitle}>{load.transactionNumber}</Text><Text style={styles.helper}>{load.itemName} · {load.quantity} {load.unitSymbol}</Text><Text style={styles.helper}>{load.driverName} · {load.truckPlate}</Text></View>) : <Text style={styles.helper}>No matching receipt loads for this date.</Text>}</View>
        <View style={[styles.deliveryGroup,styles.quarryDeliveryGroup]}><Text style={styles.deliveryGroupTitle}>SUPPLIER LOADS · {linkedQuarryLoads.length}</Text>{linkedQuarryLoads.length?linkedQuarryLoads.map(load=><View key={load.id} style={styles.linkedLoad}><Text style={styles.cardTitle}>{load.purchaseNumber} · {load.supplierName}</Text><Text style={styles.helper}>{load.itemName} · {load.quantity} {load.unitSymbol} · {new Date(load.confirmedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</Text><Text style={styles.helper}>{load.deliveryLabel}{load.truckPlate?` · ${load.truckPlate}`:''}{load.supplierTicketNumber?` · Ticket ${load.supplierTicketNumber}`:''}</Text>{load.notes?<Text style={styles.helper}>{load.notes}</Text>:null}</View>):<Text style={styles.helper}>No active supplier loads linked to this project and date.</Text>}</View>
      </Section>
      <Section title="Fuel used that day" hint="Automatically linked from active equipment fills for this project and work date. Costs use the immutable price saved on each fill.">
        <Text style={styles.cardTitle}>Total: {linkedFuelFills.reduce((sum,fill)=>sum+fill.litres,0).toFixed(2)} L · ${linkedFuelFills.reduce((sum,fill)=>sum+(fill.consumptionCostUsd??0),0).toFixed(2)}</Text>
        {linkedFuelFills.some(fill=>fill.consumptionCostUsd==null)?<Text style={styles.notice}>{linkedFuelFills.filter(fill=>fill.consumptionCostUsd==null).reduce((sum,fill)=>sum+fill.litres,0).toFixed(2)} L is unpriced and excluded from the cost total.</Text>:null}
        {linkedFuelFills.length?linkedFuelFills.map(fill=><View key={fill.id} style={styles.linkedLoad}><Text style={styles.cardTitle}>{fill.equipmentName} · {fill.litres.toFixed(2)} L</Text><Text style={styles.helper}>{new Date(fill.confirmedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · {fill.pricePerLitreUsd==null?'Unpriced':`$${fill.pricePerLitreUsd.toFixed(2)}/L · $${fill.consumptionCostUsd?.toFixed(2)}`}</Text>{fill.odometerReading?<Text style={styles.helper}>Odometer {fill.odometerReading}</Text>:null}{fill.notes?<Text style={styles.helper}>{fill.notes}</Text>:null}</View>):<Text style={styles.helper}>No active fuel fills linked to this project and date.</Text>}
      </Section>
      <Section title="Waste dumps completed that day" hint="Automatically linked from active Waste Dump records for this project and work date. Cancelled dumps are excluded.">
        <Text style={styles.cardTitle}>Total dumps: {linkedWasteDumps.length}</Text>
        {linkedWasteDumps.length ? linkedWasteDumps.map((dump) => <View key={dump.id} style={styles.linkedLoad}><Text style={styles.cardTitle}>{dump.materialType}</Text><Text style={styles.helper}>{dump.dumpLocation} · {new Date(dump.dumpedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</Text><Text style={styles.helper}>{[dump.driverName,dump.truckPlate].filter(Boolean).join(' · ') || 'No driver or truck selected'}</Text></View>) : <Text style={styles.helper}>No completed waste dumps linked to this project and date.</Text>}
      </Section>
      <Section title="Site notes">
        <Field label="General notes" value={draft.notes} onChangeText={(value) => update('notes', value)} multiline />
        <Field label="Problems, delays, or incidents" value={draft.problemsDelaysIncidents} onChangeText={(value) => update('problemsDelaysIncidents', value)} multiline />
        <Field label="Weather and site conditions" value={draft.weatherSiteConditions} onChangeText={(value) => update('weatherSiteConditions', value)} multiline />
        <Field label="Next work planned" value={draft.nextWorkPlanned} onChangeText={(value) => update('nextWorkPlanned', value)} multiline />
      </Section>
      <Section title="Photos" hint="Optional camera or library photos. Maximum 20.">
        {mediaError?<Text style={styles.error}>{mediaError}</Text>:null}<View style={styles.photoActions}><TouchableOpacity style={styles.secondary} onPress={()=>void addPhoto('camera')}><Text style={styles.secondaryText}>Take photo</Text></TouchableOpacity><TouchableOpacity style={styles.secondary} onPress={()=>void addPhoto('library')}><Text style={styles.secondaryText}>Choose photo</Text></TouchableOpacity></View><View style={styles.photoGrid}>{draft.photos.map((uri,index)=><View key={uri} style={styles.photoItem}><Image source={{uri}} style={styles.photo}/><TouchableOpacity onPress={()=>update('photos',draft.photos.filter((_,photoIndex)=>photoIndex!==index))}><Text style={styles.remove}>Remove</Text></TouchableOpacity></View>)}</View>
      </Section>
      <Section title="Working time for this day" hint={`Optional times for ${draft.workDate}. Every daily report keeps its own start, end, and break. Use 24-hour time, for example 07:00 and 17:00.`}>
        <View style={styles.twoColumns}><View style={styles.flex}><Field label="Start time" value={draft.workStartTime} onChangeText={(value) => update('workStartTime', value)} placeholder="For example 07:00" /></View><View style={styles.flex}><Field label="End time" value={draft.workEndTime} onChangeText={(value) => update('workEndTime', value)} placeholder="For example 17:00" /></View></View>
        <Field label="Break for this day (minutes)" value={draft.breakMinutes} onChangeText={(value) => update('breakMinutes', value)} keyboardType="number-pad" placeholder="For example 60" />
        {minutes != null ? <Text style={styles.success}>Net working time: {Math.floor(minutes / 60)}h {minutes % 60}m</Text> : null}
      </Section>
      <TouchableOpacity style={styles.save} disabled={busy} onPress={onSave}><Text style={styles.saveText}>{busy ? 'Saving…' : draft.id ? 'Save Changes' : 'Save Daily Report'}</Text></TouchableOpacity>
    </ScrollView>
  );
}

function Header({ eyebrow, title, onBack }: { eyebrow: string; title: string; onBack: () => void }) { return <View style={styles.header}><TouchableOpacity onPress={onBack} style={styles.back}><Text style={styles.backText}>Back</Text></TouchableOpacity><View style={styles.flex}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text></View></View>; }
function ProjectCard({ project, onPress }: { project: ReportProject; onPress: () => void }) { return <TouchableOpacity style={styles.reportCard} onPress={onPress}><View style={styles.reportCardHeader}><Text style={styles.reportCardTitle}>{project.name}</Text><Text style={styles.openText}>Open</Text></View><Text style={styles.helper}>{project.customerName}</Text><Text style={styles.helper}>{project.location}</Text></TouchableOpacity>; }
function DoubleDiagonalMark({contrast=false}:{contrast?:boolean}){return <View style={styles.doubleMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={[styles.diagonalMark,styles.diagonalOrange]}/><View style={[styles.diagonalMark,styles.diagonalNavy,contrast&&styles.diagonalContrast]}/></View>}
function ExportOption({title,description,format,ready=false}:{title:string;description:string;format:string;ready?:boolean}){return <View style={styles.exportOption}><View style={styles.exportHeader}><Text style={styles.exportTitle}>{title}</Text><Text style={[styles.statusBadge,ready?styles.ready:styles.planned]}>{ready?'READY':'PLANNED'}</Text></View><Text style={styles.helper}>{description}</Text><Text style={styles.exportFormat}>{format}</Text></View>;}
function WorkbookLanguagePicker({locale,onChange}:{locale:WorkbookLocale;onChange:(locale:WorkbookLocale)=>void}){return <View style={styles.languageCard}><View style={styles.flex}><Text style={styles.languageTitle}>Excel language</Text><Text style={styles.helper}>Labels and direction change; saved names and notes remain exactly as entered.</Text></View><View style={styles.languageChoices}><TouchableOpacity style={[styles.languageChoice,locale==='en'&&styles.languageChoiceSelected]} onPress={()=>onChange('en')}><Text style={[styles.languageChoiceText,locale==='en'&&styles.languageChoiceTextSelected]}>English LTR</Text></TouchableOpacity><TouchableOpacity style={[styles.languageChoice,locale==='ar'&&styles.languageChoiceSelected]} onPress={()=>onChange('ar')}><Text style={[styles.languageChoiceText,locale==='ar'&&styles.languageChoiceTextSelected]}>العربية RTL</Text></TouchableOpacity></View></View>}
function BusinessWorkbookOption({kind,busy,disabled,progress,onPress}:{kind:BusinessReportKind;busy:boolean;disabled:boolean;progress:WorkbookProgress|null;onPress:()=>void}){const descriptions:Record<BusinessReportKind,string>={loads:'Confirmed load quantities, sales, VAT, payments, balances, and signatures.',customers:'Customer rollups, payment events, and carried-forward opening balances.',quarry:'Supplier rollups, purchase details, quantities, VAT, balances, and payments.',fuel:'Current balance, chronological movements, financial details, and equipment totals.',projects:'Project summaries, daily-report index, people/equipment context, and materials.',analysis:'All analysis-ready raw sheets, executive summary, and data dictionary in one file.'};return <TouchableOpacity activeOpacity={.7} disabled={disabled&&!busy} style={[styles.workbookOption,disabled&&!busy&&styles.workbookDisabled]} onPress={onPress}><View style={styles.workbookIcon}><Text style={styles.workbookIconText}>X</Text></View><View style={styles.flex}><Text style={styles.workbookTitle}>{businessReportLabels[kind]}</Text><Text style={styles.workbookDescription}>{descriptions[kind]}</Text>{busy?<><View style={styles.exportProgressTrack}><View style={[styles.exportProgressFill,{width:`${Math.max(2,progress?.percent??2)}%`}]}/></View><Text style={styles.workbookFormat}>{progress?.percent??1}% · {progress?.message??'Preparing workbook'}</Text><Text style={styles.cancelExport}>Tap to cancel safely</Text></>:<Text style={styles.workbookFormat}>XLSX · Offline · Shareable</Text>}</View><Text style={styles.workbookArrow}>{busy?'×':'›'}</Text></TouchableOpacity>}
function ReportMenu({title,summary,tone,open,onToggle,children}:{title:string;summary:string;tone:'cream'|'orange'|'navy';open:boolean;onToggle:()=>void;children:React.ReactNode}){return <View style={styles.reportMenu}><TouchableOpacity activeOpacity={.72} style={[styles.reportMenuHeader,tone==='cream'?styles.reportMenuCream:tone==='orange'?styles.reportMenuOrange:styles.reportMenuNavy]} onPress={onToggle}>{title==='Active Projects'?<DoubleDiagonalMark/>:null}<View style={styles.flex}><Text style={[styles.reportMenuTitle,tone!=='cream'&&styles.reportMenuTitleLight]}>{title}</Text><Text style={[styles.reportMenuSummary,tone!=='cream'&&styles.reportMenuSummaryLight]}>{summary}</Text></View><Text style={[styles.reportMenuMark,tone!=='cream'&&styles.reportMenuMarkLight]}>{open?'\u00D7':'+'}</Text></TouchableOpacity>{open?<View style={styles.reportMenuBody}>{children}</View>:null}</View>}
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) { return <View style={styles.sectionCard}><Text style={styles.cardTitle}>{title}</Text>{hint ? <Text style={styles.helper}>{hint}</Text> : null}{children}</View>; }
function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'decimal-pad' | 'number-pad' }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input, props.multiline && styles.multiline]} placeholderTextColor="#89939B" {...props} /></View>; }
function PresenceField({ label, options, values, onChange }: { label: string; options: { id: string; label: string; detail?: string }[]; values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join(', ')); const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(values.join(', ')); }, [focused, values]);
  const lowerLabel = label.toLocaleLowerCase('en-US');
  return <View style={styles.presenceField}><SearchableSelect label={`Add saved ${lowerLabel}`} options={options} selectedId="" onSelect={(id) => { const selected = options.find((option) => option.id === id); if (selected) onChange(addPresence(values, selected.label)); }} placeholder={options.length ? `Choose ${lowerLabel}` : `No saved ${lowerLabel} yet`} /><View style={styles.field}><Text style={styles.label}>{`Or type ${lowerLabel}`}</Text><TextInput style={[styles.input, styles.multiline]} value={text} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); onChange(splitPresence(text)); }} onChangeText={(value) => { setText(value); onChange(splitPresence(value)); }} multiline placeholder="Separate entries with commas or new lines" placeholderTextColor="#89939B" /></View></View>;
}
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { return <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></TouchableOpacity>; }

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, content: { padding: 20, paddingBottom: 42, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 }, back: { backgroundColor: colors.surface, padding: 10, borderRadius: 10 }, backText: { color: colors.ink, fontWeight: '800' }, eyebrow: { color: colors.brand, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 }, title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 }, sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', marginTop: 4 }, cardTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  projectContext: { backgroundColor: '#202D37', borderRadius: 16, padding: 17, gap: 4 }, projectContextTitle: { color: '#FFF', fontWeight: '900', fontSize: 17 },
  primary: { backgroundColor: colors.brand, borderRadius: 16, padding: 18, gap: 4 }, primaryText: { color: '#FFF', fontWeight: '900', fontSize: 20 }, primaryHint: { color: '#F7D9D1', fontSize: 13 },
  reportCard: { backgroundColor: colors.surface, borderRadius: 15, padding: 16, gap: 5 }, reportCardHeader:{flexDirection:'row',alignItems:'flex-start',gap:10},reportCardTitle:{flex:1,minWidth:0,color:colors.ink,fontSize:16,fontWeight:'900'},businessCard: { backgroundColor: '#EEEAE2', borderRadius: 15, padding: 16, gap: 5 }, exportOption:{backgroundColor:colors.surface,borderRadius:15,padding:16,gap:7,overflow:'hidden'},exportHeader:{flexDirection:'row',alignItems:'flex-start',gap:8},exportTitle:{flex:1,minWidth:0,color:colors.ink,fontSize:16,fontWeight:'900'},statusBadge:{flexShrink:0,alignSelf:'flex-start',fontSize:9,fontWeight:'900',letterSpacing:.7,paddingHorizontal:8,paddingVertical:5,borderRadius:10,overflow:'hidden'},ready:{color:colors.success,backgroundColor:'#E5F3EC'},planned:{color:'#8A5B12',backgroundColor:'#FFF3D8'},exportFormat:{color:colors.brandDark,fontSize:12,fontWeight:'900',flexShrink:1}, empty: { borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', borderRadius: 15, padding: 16, gap: 5 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, openText: { flexShrink:0,color:colors.brandDark,fontWeight:'900',backgroundColor:'#E8F3FB',paddingHorizontal:9,paddingVertical:5,borderRadius:10,overflow:'hidden',fontSize:11 }, reportDescription: { color: colors.ink, fontSize: 14, lineHeight: 20 }, notice: { color: colors.warning, backgroundColor: '#FFF3D8', padding: 13, borderRadius: 11, lineHeight: 19 },
  sectionCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 17, gap: 12 }, field: { gap: 6 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, input: { borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, backgroundColor: '#FCFBF8' }, multiline: { minHeight: 72, textAlignVertical: 'top' },
  twoColumns: { flexDirection: 'row', gap: 10 }, flex: { flex: 1 }, presenceField: { gap: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, safetyWorker:{gap:9,padding:12,borderRadius:12,backgroundColor:'#F5F2EC',borderLeftWidth:4,borderLeftColor:colors.brand}, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 18 }, chipSelected: { backgroundColor: '#FBE9E4', borderColor: colors.brand }, chipText: { color: colors.muted, fontWeight: '800', fontSize: 12 }, chipTextSelected: { color: colors.brandDark },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, remove: { color: colors.danger, fontWeight: '800' }, secondary: { borderWidth: 1, borderColor: colors.ink, borderRadius: 11, padding: 12, alignItems: 'center' }, secondaryText: { color: colors.ink, fontWeight: '900' }, deliveryGroup:{backgroundColor:'#EAF2F6',borderRadius:12,padding:12,gap:10},quarryDeliveryGroup:{backgroundColor:'#FFF8ED'},deliveryGroupTitle:{color:colors.navy,fontSize:11,fontWeight:'900',letterSpacing:.7},linkedLoad: { borderLeftWidth: 3, borderLeftColor: colors.brand, paddingLeft: 10, gap: 2 },
  save: { backgroundColor: colors.ink, borderRadius: 13, padding: 16, alignItems: 'center' }, saveText: { color: '#FFF', fontWeight: '900', fontSize: 16 }, error: { color: colors.danger, backgroundColor: '#FCE8E6', padding: 12, borderRadius: 10, fontWeight: '700' }, success: { color: colors.success, backgroundColor: '#E5F3EC', padding: 12, borderRadius: 10, fontWeight: '700' },
  projectSelector:{borderRadius:17,overflow:'hidden',borderWidth:1,borderColor:'#D9D0C3',backgroundColor:'#FFF8ED'},projectSelectorHeader:{backgroundColor:'#173F67',padding:17,flexDirection:'row',alignItems:'center',gap:14},projectSelectorCopy:{flex:1,minWidth:0,gap:3},projectSelectorEyebrow:{color:'#F2A184',fontSize:10,fontWeight:'900',letterSpacing:1.3},projectSelectorTitle:{color:'#FFF8ED',fontSize:21,fontWeight:'900'},projectSelectorHint:{color:'#D5E4EF',fontSize:11,lineHeight:16},projectSelectorBody:{padding:16,gap:12,backgroundColor:'#FFF8ED'},selectedProjectPreview:{backgroundColor:colors.surface,borderRadius:13,padding:14,borderLeftWidth:4,borderLeftColor:colors.brand,flexDirection:'row',alignItems:'flex-start',gap:10},selectedProjectCopy:{flex:1,minWidth:0,gap:2},selectedProjectName:{color:colors.ink,fontSize:16,fontWeight:'900'},selectedProjectMeta:{color:colors.muted,fontSize:12,lineHeight:17},selectedProjectStatus:{fontSize:9,fontWeight:'900',letterSpacing:.7,paddingHorizontal:8,paddingVertical:5,borderRadius:10,overflow:'hidden'},selectedProjectActive:{color:colors.success,backgroundColor:'#E5F3EC'},selectedProjectCompleted:{color:colors.warning,backgroundColor:'#FFF3D8'},projectSelectorEmpty:{borderWidth:1,borderStyle:'dashed',borderColor:colors.line,borderRadius:12,padding:13,gap:3},projectSelectorEmptyTitle:{color:colors.ink,fontWeight:'900'},openProject:{backgroundColor:'#173F67',borderRadius:12,paddingHorizontal:15,paddingVertical:14,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:9},openProjectDisabled:{opacity:.35},openProjectText:{color:'#FFF',fontWeight:'900',fontSize:15},openProjectArrow:{color:colors.brand,fontSize:25,fontWeight:'900',lineHeight:19},doubleMark:{width:43,height:31,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:4},diagonalMark:{width:11,height:28,borderRadius:2,transform:[{skewX:'-18deg'}]},diagonalOrange:{backgroundColor:colors.brand},diagonalNavy:{backgroundColor:'#173F67'},diagonalContrast:{borderWidth:1,borderColor:'#FFF8ED'},
  exportButton:{borderWidth:1,borderColor:colors.brand,borderRadius:10,padding:10,alignItems:'center'},exportButtonText:{color:colors.brandDark,fontWeight:'900'},reportExportRow:{flexDirection:'row',gap:8},reportExportButton:{flex:1},photoActions:{flexDirection:'row',gap:8},photoGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},photoItem:{width:'47%',gap:5},photo:{width:'100%',height:110,borderRadius:9,backgroundColor:'#EEE'},
  businessExportHeading:{color:colors.brand,fontSize:10,fontWeight:'900',letterSpacing:1.1,marginTop:5},workbookOption:{backgroundColor:colors.surface,borderWidth:1,borderColor:'#D9D0C3',borderRadius:13,padding:13,flexDirection:'row',alignItems:'center',gap:11},workbookDisabled:{opacity:.42},workbookIcon:{width:36,height:36,borderRadius:10,backgroundColor:'#E5F3EC',alignItems:'center',justifyContent:'center',borderLeftWidth:3,borderLeftColor:colors.success},workbookIconText:{color:colors.success,fontSize:17,fontWeight:'900'},workbookTitle:{color:colors.ink,fontSize:14,fontWeight:'900'},workbookDescription:{color:colors.muted,fontSize:10,lineHeight:15,marginTop:2},workbookFormat:{color:colors.success,fontSize:9,fontWeight:'900',letterSpacing:.45,marginTop:5},workbookArrow:{color:colors.brand,fontSize:25,fontWeight:'900'},
  completionExport:{backgroundColor:colors.brand,borderRadius:14,padding:16,gap:5},completionExportTitle:{color:'#FFF',fontWeight:'900',fontSize:17},completionExportHint:{color:'#F7D9D1',fontSize:12,lineHeight:18},
  reportMenu:{borderRadius:15,overflow:'hidden'},reportMenuHeader:{padding:16,flexDirection:'row',alignItems:'center',gap:12},reportMenuCream:{backgroundColor:'#FFF8ED',borderWidth:1,borderColor:'#E8DED0'},reportMenuOrange:{backgroundColor:colors.brand},reportMenuNavy:{backgroundColor:'#173F67'},reportMenuTitle:{color:'#173F67',fontSize:19,fontWeight:'900'},reportMenuTitleLight:{color:colors.background},reportMenuSummary:{color:colors.muted,fontSize:11,marginTop:3},reportMenuSummaryLight:{color:'#E8E2D7'},reportMenuMark:{color:'#173F67',fontSize:28,fontWeight:'700',width:28,textAlign:'center'},reportMenuMarkLight:{color:colors.background},reportMenuBody:{backgroundColor:'#FFF8ED',padding:12,gap:10,borderTopWidth:3,borderTopColor:'#173F67'},
  dateRow:{flexDirection:'row',gap:10},filterFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10,paddingTop:4},filterScope:{color:colors.muted,fontSize:11,fontWeight:'700'},clearFilter:{color:colors.brandDark,fontSize:12,fontWeight:'900'},exportProgressTrack:{height:7,borderRadius:4,backgroundColor:'#DCE6E0',overflow:'hidden',marginTop:8},exportProgressFill:{height:'100%',borderRadius:4,backgroundColor:colors.success},cancelExport:{color:colors.danger,fontSize:10,fontWeight:'900',marginTop:3},languageCard:{backgroundColor:'#F2EEE6',borderRadius:13,padding:13,gap:10,borderLeftWidth:3,borderLeftColor:colors.brand},languageTitle:{color:colors.ink,fontWeight:'900',fontSize:14},languageChoices:{flexDirection:'row',gap:8},languageChoice:{flex:1,borderWidth:1,borderColor:colors.line,borderRadius:10,paddingVertical:10,paddingHorizontal:8,alignItems:'center',backgroundColor:colors.surface},languageChoiceSelected:{backgroundColor:'#173F67',borderColor:'#173F67'},languageChoiceText:{color:colors.muted,fontSize:12,fontWeight:'900'},languageChoiceTextSelected:{color:'#FFF'},
});
