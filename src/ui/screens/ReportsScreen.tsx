import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { ProjectReportRepository } from '../../data/repositories/ProjectReportRepository';
import {
  addPresence, emptyDailyReport, netWorkMinutes, splitPresence,
  type DailyProjectReport, type DailyProjectReportDraft, type DailyReportMaterial,
  type LinkedProjectLoad, type LinkedWasteDump, type ProjectReportSetup, type ReportProject,
} from '../../domain/projectReports';
import { SearchableSelect } from '../components/SearchableSelect';
import {DatePickerField,todayIso} from '../components/DatePickerField';
import { capturePersistentImage, pickPersistentImage } from '../../services/media';
import { exportAndShareProjectCompletion, exportAndShareProjectReport } from '../../services/documentExport';
import { colors } from '../theme';

export function ReportsScreen({ repository, onBack }: { repository: ProjectReportRepository; onBack: () => void }) {
  const [setup, setSetup] = useState<ProjectReportSetup | null>(null);
  const [project, setProject] = useState<ReportProject | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [reports, setReports] = useState<DailyProjectReport[]>([]);
  const [draft, setDraft] = useState<DailyProjectReportDraft | null>(null);
  const [linkedLoads, setLinkedLoads] = useState<LinkedProjectLoad[]>([]);
  const [linkedWasteDumps, setLinkedWasteDumps] = useState<LinkedWasteDump[]>([]);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [menuOpen,setMenuOpen]=useState<Set<string>>(()=>new Set());
  const toggleMenu=(key:string)=>{setMenuOpen(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});};
  const refreshSetup = useCallback(async () => setSetup(await repository.getSetup()), [repository]);
  useEffect(() => { void refreshSetup(); }, [refreshSetup]);
  useEffect(() => { if (project) void repository.listReports(project.id).then(setReports); }, [project, repository]);
  useEffect(() => {
    if (draft?.projectId && draft.workDate) void repository.listLinkedLoads(draft.projectId, draft.workDate).then(setLinkedLoads);
    else setLinkedLoads([]);
  }, [draft?.projectId, draft?.workDate, repository]);
  useEffect(() => {
    if (draft?.projectId && draft.workDate) void repository.listLinkedWasteDumps(draft.projectId, draft.workDate).then(setLinkedWasteDumps);
    else setLinkedWasteDumps([]);
  }, [draft?.projectId, draft?.workDate, repository]);

  function editReport(report: DailyProjectReport) {
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...editable } = report;
    setError(null); setMessage(null); setDraft(editable);
  }
  async function save() {
    if (!draft) return; setBusy(true); setError(null); setMessage(null);
    try {
      const saved = await repository.saveReport(draft); setDraft(null);
      const [nextReports, nextSetup] = await Promise.all([repository.listReports(saved.projectId), repository.getSetup()]);
      setReports(nextReports); setSetup(nextSetup); setMessage('Daily project report saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the report.'); }
    finally { setBusy(false); }
  }
  async function shareReport(report: DailyProjectReport) {
    if (!project) return; setBusy(true); setError(null); setMessage(null);
    try { const [loads,waste] = await Promise.all([repository.listLinkedLoads(project.id, report.workDate),repository.listLinkedWasteDumps(project.id, report.workDate)]); await exportAndShareProjectReport(report, project, loads, waste, setup!.company); setMessage('Project report PDF created.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export project report.'); }
    finally { setBusy(false); }
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

  if (!setup) return <View style={styles.loading}><Text style={styles.helper}>Loading reports…</Text></View>;
  if (draft && project) return <DailyReportEditor setup={setup} project={project} draft={draft} linkedLoads={linkedLoads} linkedWasteDumps={linkedWasteDumps} busy={busy} error={error} onChange={setDraft} onSave={() => void save()} onBack={() => setDraft(null)} />;
  if (project) return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header eyebrow="PROJECT REPORTS" title={project.name} onBack={() => { setProject(null); setReports([]); setMessage(null); }} />
      <View style={styles.projectContext}><Text style={styles.projectContextTitle}>{project.customerName}</Text><Text style={styles.helper}>{project.location}</Text></View>
      {error ? <Text style={styles.error}>{error}</Text> : null}{message ? <Text style={styles.success}>{message}</Text> : null}
      {project.status === 'active' ? <TouchableOpacity style={styles.primary} onPress={() => setDraft(emptyDailyReport(project.id))}><Text style={styles.primaryText}>Make Daily Report</Text><Text style={styles.primaryHint}>The project is selected automatically</Text></TouchableOpacity> : <><Text style={styles.notice}>This project is completed. Its reports remain available, but a new report cannot be created until the project is reactivated.</Text><TouchableOpacity style={styles.completionExport} disabled={busy} onPress={()=>void shareCompletion()}><Text style={styles.completionExportTitle}>{busy?'Creating final PDF…':'Create Full Project PDF'}</Text><Text style={styles.completionExportHint}>Start-to-finish summary, daily timeline, loads, waste, working time, issues, people, equipment, and photos</Text></TouchableOpacity></>}
      <Text style={styles.sectionTitle}>Report history</Text>
      {reports.length ? reports.map((report) => <View key={report.id} style={styles.reportCard}><TouchableOpacity onPress={() => editReport(report)}><View style={styles.reportCardHeader}><Text style={styles.reportCardTitle}>{report.workDate}</Text><Text style={styles.openText}>Open</Text></View><Text style={styles.reportDescription} numberOfLines={3}>{report.workDescription}</Text><Text style={styles.helper}>Updated {new Date(report.updatedAt).toLocaleString()} · {report.photos.length} photos</Text></TouchableOpacity><TouchableOpacity style={styles.exportButton} disabled={busy} onPress={()=>void shareReport(report)}><Text style={styles.exportButtonText}>Create & Share PDF</Text></TouchableOpacity></View>) : <View style={styles.empty}><Text style={styles.cardTitle}>No daily reports yet</Text><Text style={styles.helper}>Choose Make Daily Report to record the first workday.</Text></View>}
    </ScrollView>
  );

  const active = setup.projects.filter((value) => value.status === 'active'); const completed = setup.projects.filter((value) => value.status === 'completed');
  const selectedProject = setup.projects.find((value) => value.id === selectedProjectId) ?? null;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Header eyebrow="OPERATIONS" title="Reports" onBack={onBack} />
      <Text style={styles.helper}>Choose a project for daily reports and project history. Export options below clearly show what can be generated now.</Text>
      <View style={styles.sectionCard}>
        <Text style={styles.cardTitle}>Select Project</Text>
        <SearchableSelect
          label="Project *"
          options={setup.projects.map((value) => ({ id: value.id, label: value.name, detail: `${value.customerName} · ${value.status}` }))}
          selectedId={selectedProjectId}
          onSelect={setSelectedProjectId}
          placeholder="Search and select a project"
        />
        <TouchableOpacity style={[styles.openProject, !selectedProject && styles.openProjectDisabled]} disabled={!selectedProject} onPress={() => selectedProject && setProject(selectedProject)}>
          <Text style={styles.openProjectText}>Open Project Reports</Text>
        </TouchableOpacity>
      </View>
      <ReportMenu title="Active Projects" summary={`${active.length} active project${active.length===1?'':'s'}`} tone="cream" open={menuOpen.has('active')} onToggle={()=>toggleMenu('active')}>{active.length ? active.map((value) => <ProjectCard key={value.id} project={value} onPress={() => setProject(value)} />) : <View style={styles.empty}><Text style={styles.cardTitle}>No active projects</Text><Text style={styles.helper}>Add a project from Home → Projects first.</Text></View>}</ReportMenu>
      <ReportMenu title="Completed Projects" summary={`${completed.length} completed project${completed.length===1?'':'s'}`} tone="orange" open={menuOpen.has('completed')} onToggle={()=>toggleMenu('completed')}>{completed.length ? completed.map((value) => <ProjectCard key={value.id} project={value} onPress={() => setProject(value)} />) : <Text style={styles.helper}>No completed projects.</Text>}</ReportMenu>
      <ReportMenu title="Report Generation" summary="Daily, completed, financial, and operational reports" tone="navy" open={menuOpen.has('generation')} onToggle={()=>toggleMenu('generation')}><ExportOption title="Daily Project Report" description="Work, people, equipment, materials, delivered loads, waste dumps, notes, time, photos, and project context." format="PDF · Available now" ready /><ExportOption title="Completed Project Report" description="Start-to-finish totals, daily work timeline, materials, loads, waste dumps, time, issues, people, equipment, appendices, and photos." format="PDF · Available for completed projects" ready /><ExportOption title="Financial & Operational Reports" description="Loads and Sales, Customer Balances, Quarry Purchases, Supplier Balances, and payment details." format="Detailed generation coming in the reports slice" /></ReportMenu>
    </ScrollView>
  );
}

function DailyReportEditor({ setup, project, draft, linkedLoads, linkedWasteDumps, busy, error, onChange, onSave, onBack }: { setup: ProjectReportSetup; project: ReportProject; draft: DailyProjectReportDraft; linkedLoads: LinkedProjectLoad[]; linkedWasteDumps: LinkedWasteDump[]; busy: boolean; error: string | null; onChange: (draft: DailyProjectReportDraft) => void; onSave: () => void; onBack: () => void }) {
  const [materialItemId, setMaterialItemId] = useState(''); const [materialUnitId, setMaterialUnitId] = useState('');
  const [materialQuantity, setMaterialQuantity] = useState(''); const [materialMovement, setMaterialMovement] = useState<'used' | 'transported'>('used');
  const [mediaError,setMediaError]=useState<string|null>(null);
  const minutes = useMemo(() => netWorkMinutes(draft), [draft]);
  const update = <K extends keyof DailyProjectReportDraft>(key: K, value: DailyProjectReportDraft[K]) => onChange({ ...draft, [key]: value });
  function addMaterial() {
    const item = setup.items.find((value) => value.id === materialItemId); const unit = setup.units.find((value) => value.id === materialUnitId); const quantity = Number(materialQuantity.replace(',', '.'));
    if (!item || !unit || !(quantity > 0)) return;
    const material: DailyReportMaterial = { id: `material_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, itemId: item.id, itemName: item.name, unitId: unit.id, unitName: unit.name, unitSymbol: unit.symbol, quantity, movement: materialMovement };
    update('materials', [...draft.materials, material]); setMaterialQuantity('');
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
      <Section title="Materials used or transported" hint="Add each item and unit separately; different units are never combined.">
        {draft.materials.map((material) => <View key={material.id} style={styles.materialRow}><View style={styles.flex}><Text style={styles.cardTitle}>{material.itemName}</Text><Text style={styles.helper}>{material.quantity} {material.unitSymbol} · {material.movement}</Text></View><TouchableOpacity onPress={() => update('materials', draft.materials.filter((value) => value.id !== material.id))}><Text style={styles.remove}>Remove</Text></TouchableOpacity></View>)}
        <SearchableSelect label="Item" options={setup.items.map((item) => ({ id: item.id, label: item.name, detail: item.categoryName }))} selectedId={materialItemId} onSelect={setMaterialItemId} placeholder="Select daily-report item" />
        <SearchableSelect label="Unit" options={setup.units.map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))} selectedId={materialUnitId} onSelect={setMaterialUnitId} />
        <View style={styles.twoColumns}><View style={styles.flex}><Field label="Quantity" value={materialQuantity} onChangeText={setMaterialQuantity} keyboardType="decimal-pad" /></View><View style={styles.flex}><Text style={styles.label}>Movement</Text><View style={styles.chips}><Choice label="Used" selected={materialMovement === 'used'} onPress={() => setMaterialMovement('used')} /><Choice label="Transported" selected={materialMovement === 'transported'} onPress={() => setMaterialMovement('transported')} /></View></View></View>
        <TouchableOpacity style={styles.secondary} onPress={addMaterial}><Text style={styles.secondaryText}>Add material</Text></TouchableOpacity>
      </Section>
      <Section title="Loads delivered that day" hint="Automatically linked, read-only loads confirmed with this project selected and the same work date.">
        {linkedLoads.length ? linkedLoads.map((load) => <View key={load.id} style={styles.linkedLoad}><Text style={styles.cardTitle}>{load.transactionNumber}</Text><Text style={styles.helper}>{load.itemName} · {load.quantity} {load.unitSymbol}</Text><Text style={styles.helper}>{load.driverName} · {load.truckPlate}</Text></View>) : <Text style={styles.helper}>No matching loads. In Make Receipt, select this project before confirming the load. The load confirmation date must match this report's work date.</Text>}
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
function ExportOption({title,description,format,ready=false}:{title:string;description:string;format:string;ready?:boolean}){return <View style={styles.exportOption}><View style={styles.exportHeader}><Text style={styles.exportTitle}>{title}</Text><Text style={[styles.statusBadge,ready?styles.ready:styles.planned]}>{ready?'READY':'PLANNED'}</Text></View><Text style={styles.helper}>{description}</Text><Text style={styles.exportFormat}>{format}</Text></View>;}
function ReportMenu({title,summary,tone,open,onToggle,children}:{title:string;summary:string;tone:'cream'|'orange'|'navy';open:boolean;onToggle:()=>void;children:React.ReactNode}){return <View style={styles.reportMenu}><TouchableOpacity activeOpacity={.72} style={[styles.reportMenuHeader,tone==='cream'?styles.reportMenuCream:tone==='orange'?styles.reportMenuOrange:styles.reportMenuNavy]} onPress={onToggle}><View style={styles.flex}><Text style={[styles.reportMenuTitle,tone!=='cream'&&styles.reportMenuTitleLight]}>{title}</Text><Text style={[styles.reportMenuSummary,tone!=='cream'&&styles.reportMenuSummaryLight]}>{summary}</Text></View><Text style={[styles.reportMenuMark,tone!=='cream'&&styles.reportMenuMarkLight]}>{open?'\u00D7':'+'}</Text></TouchableOpacity>{open?<View style={styles.reportMenuBody}>{children}</View>:null}</View>}
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
  twoColumns: { flexDirection: 'row', gap: 10 }, flex: { flex: 1 }, presenceField: { gap: 8, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 18 }, chipSelected: { backgroundColor: '#FBE9E4', borderColor: colors.brand }, chipText: { color: colors.muted, fontWeight: '800', fontSize: 12 }, chipTextSelected: { color: colors.brandDark },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line }, remove: { color: colors.danger, fontWeight: '800' }, secondary: { borderWidth: 1, borderColor: colors.ink, borderRadius: 11, padding: 12, alignItems: 'center' }, secondaryText: { color: colors.ink, fontWeight: '900' }, linkedLoad: { borderLeftWidth: 3, borderLeftColor: colors.brand, paddingLeft: 10, gap: 2 },
  save: { backgroundColor: colors.ink, borderRadius: 13, padding: 16, alignItems: 'center' }, saveText: { color: '#FFF', fontWeight: '900', fontSize: 16 }, error: { color: colors.danger, backgroundColor: '#FCE8E6', padding: 12, borderRadius: 10, fontWeight: '700' }, success: { color: colors.success, backgroundColor: '#E5F3EC', padding: 12, borderRadius: 10, fontWeight: '700' },
  openProject: { backgroundColor: colors.ink, borderRadius: 11, padding: 13, alignItems: 'center' }, openProjectDisabled: { opacity: 0.35 }, openProjectText: { color: '#FFF', fontWeight: '900' },
  exportButton:{borderWidth:1,borderColor:colors.brand,borderRadius:10,padding:10,alignItems:'center'},exportButtonText:{color:colors.brandDark,fontWeight:'900'},photoActions:{flexDirection:'row',gap:8},photoGrid:{flexDirection:'row',flexWrap:'wrap',gap:10},photoItem:{width:'47%',gap:5},photo:{width:'100%',height:110,borderRadius:9,backgroundColor:'#EEE'},
  completionExport:{backgroundColor:colors.brand,borderRadius:14,padding:16,gap:5},completionExportTitle:{color:'#FFF',fontWeight:'900',fontSize:17},completionExportHint:{color:'#F7D9D1',fontSize:12,lineHeight:18},
  reportMenu:{borderRadius:15,overflow:'hidden'},reportMenuHeader:{padding:16,flexDirection:'row',alignItems:'center',gap:12},reportMenuCream:{backgroundColor:'#FFF8ED',borderWidth:1,borderColor:'#E8DED0'},reportMenuOrange:{backgroundColor:colors.brand},reportMenuNavy:{backgroundColor:'#173F67'},reportMenuTitle:{color:'#173F67',fontSize:19,fontWeight:'900'},reportMenuTitleLight:{color:colors.background},reportMenuSummary:{color:colors.muted,fontSize:11,marginTop:3},reportMenuSummaryLight:{color:'#E8E2D7'},reportMenuMark:{color:'#173F67',fontSize:28,fontWeight:'700',width:28,textAlign:'center'},reportMenuMarkLight:{color:colors.background},reportMenuBody:{backgroundColor:'#FFF8ED',padding:12,gap:10,borderTopWidth:3,borderTopColor:'#173F67'},
});
