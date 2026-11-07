import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadNumberSeriesRepository } from '../../data/repositories/LoadNumberSeriesRepository';
import type { LoadNumberPreview } from '../../domain/loadNumberSeries';
import {loadNumberLabel} from '../../domain/loadNumberSeries';
import { Alert, LayoutAnimation, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { ContractQuantitiesRepository } from '../../data/repositories/ContractQuantitiesRepository';
import type { LoadRepository } from '../../data/repositories/LoadRepository';
import { ContractItemChoice } from '../components/ContractItemChoice';
import { truckCrewRoleLabel, type TruckCrewRole } from '../../domain/people';
import { calculateLoad, createAnotherItemDraft, directConversionLines, emptyLoadDraft, formatUsd, receiptEntrySteps, receiptIssueStep, receiptStepIssues, type ConfirmedLoad, type LoadDraft, type LoadSetupOptions, validateLoadDraft } from '../../domain/loads';
import { fitSignatureToBox } from '../../domain/signatureFit';
import { printLoadBluetooth } from '../../services/bluetoothPrinter';
import { receiptQrPayloadFor } from '../../services/receiptQrKey';
import { exportAndShareLoadDocument, type LoadDocumentKind, type PaperWidth } from '../../services/documentExport';
import type { CompanyHeaderRepository } from '../../data/repositories/CompanyHeaderRepository';
import { applyHeaderCompany, type HeaderCompany, type HeaderCompanyKind } from '../../domain/companyHeaders';
import { HeaderCompanyPicker } from '../components/HeaderCompanyPicker';
import { AppButton, AppField, Feedback, PageHeader } from '../components/AppPrimitives';
import { OpenSwitch } from '../components/OpenSwitch';
import { LoadDocuments, type DocumentViewData } from '../components/LoadDocuments';
import { SearchableSelect } from '../components/SearchableSelect';
import { SignaturePad } from '../components/SignaturePad';
import Svg, { Path } from 'react-native-svg';
import { SegmentedChoice } from '../components/SegmentedChoice';
import { GroupedSearchableSelect } from '../components/GroupedSearchableSelect';
import { DatePickerField, todayIso } from '../components/DatePickerField';
import { useReducedMotion } from '../components/ExpandableMenu';
import { accountVatLabel, resolveVatRate, startingVatChoice } from '../../domain/accountVat';
import { VatChoiceControl } from '../components/AccountVatControl';
import { colors } from '../theme';

export function MakeReceiptScreen({ repository, onBack, onOpenSetup, onOpenDirectory, onOpenProjects, initialProjectId, seriesRepository, onOpenCompanySetups, headers, contracts }: { repository: LoadRepository;
  /** DEC-522. Offers the contract item this load counts toward; absent, the screen is exactly as before. */
  contracts?: ContractQuantitiesRepository; onBack: () => void; onOpenSetup: () => void; onOpenDirectory: () => void; onOpenProjects: () => void; initialProjectId?: string | null;
  /** DEC-500. Previews the Company Load number this load will receive. */
  seriesRepository?: LoadNumberSeriesRepository;
  /** Phase 2. Opens Company setups when no supplier signer is saved. */
  onOpenCompanySetups?: () => void;
  /** Phase 3. Offers the Header company picker on the Load confirmed screen. */
  headers?: CompanyHeaderRepository }) {
  const [options, setOptions] = useState<LoadSetupOptions | null>(null);
  const [draft, setDraft] = useState<LoadDraft>(emptyLoadDraft);
  // DEC-477. Narrows the Driver / Operator list; the selected person always stays listed so a filter change never hides the current choice.
  const [crewFilter, setCrewFilter] = useState<'all' | TruckCrewRole>('all');
  const crew = options?.drivers ?? [];
  const selectedCrew = crew.find((value) => value.id === draft.driverId);
  const crewFilterOptions = [
    { id: 'all' as const, label: 'All', count: crew.length },
    { id: 'driver' as const, label: 'Drivers', count: crew.filter((value) => value.role === 'driver').length },
    { id: 'operator' as const, label: 'Operators', count: crew.filter((value) => value.role === 'operator').length },
  ];
  const crewOptions = crew
    .filter((value) => crewFilter === 'all' || value.role === crewFilter || value.id === draft.driverId)
    .map((value) => ({ id: value.id, label: value.name, detail: [truckCrewRoleLabel(value.role), value.phone, value.licenseNumber ? `Licence ${value.licenseNumber}` : null].filter(Boolean).join(' · ') }));
  // Phase 2. A driver or truck can be picked from the saved lists or typed for this load only (never saved to the lists).
  const [driverMode, setDriverMode] = useState<'saved' | 'typed'>('saved');
  const [truckMode, setTruckMode] = useState<'saved' | 'typed'>('saved');
  const [typedDriver, setTypedDriver] = useState('');
  const [typedPlate, setTypedPlate] = useState('');
  const [signatureMode, setSignatureMode] = useState<'draw' | 'name'>('draw');
  const [signing, setSigning] = useState(false);
  function setEntryModes(next: LoadDraft) {
    setDriverMode(!next.driverId && next.driverName.trim() ? 'typed' : 'saved'); setTypedDriver(next.driverId ? '' : next.driverName);
    setTruckMode(!next.truckId && next.truckPlate.trim() ? 'typed' : 'saved'); setTypedPlate(next.truckId ? '' : next.truckPlate);
    setSignatureMode('draw');
  }
  const [lastConfirmedDraft, setLastConfirmedDraft] = useState<LoadDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [setupStatus, setSetupStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [setupError, setSetupError] = useState<string | null>(null);
  // DEC-524. One step at a time, like New Supplier Load; a reopened draft starts on step 1 with everything kept.
  const [step, setStep] = useState(1);
  const [destinationMode, setDestinationMode] = useState<'project' | 'address'>('project');
  const [showDocuments, setShowDocuments] = useState(false);
  const [nextNumber, setNextNumber] = useState<LoadNumberPreview | null>(null);
  const [contractLabel, setContractLabel] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedLoad | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const reducedMotion = useReducedMotion();
  const mountedRef = useRef(true);
  const saveRevisionRef = useRef(0);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadSetup = useCallback(() => {
    setSetupStatus('loading'); setSetupError(null);
    void Promise.all([repository.getSetupOptions(), repository.getDraft()]).then(([nextOptions, saved]) => {
      if (!mountedRef.current) return;
      let next = saved ? { ...emptyLoadDraft, ...saved } : emptyLoadDraft;
      if (saved && !saved.vat) next = { ...next, vat: startingVatChoice(nextOptions.customers.find((value) => value.id === next.customerId)?.vat) };
      if (initialProjectId && !next.projectId) { const selected = nextOptions.projects.find((project) => project.id === initialProjectId); if (selected) next = { ...next, projectId: selected.id, customerId: selected.customerId, destinationAddress: '' }; }
      setOptions(nextOptions); setDraft(next); setEntryModes(next); setDestinationMode(!next.projectId && next.destinationAddress.trim() ? 'address' : 'project'); setLoaded(true); setSetupStatus('ready');
    }).catch((cause) => {
      if (!mountedRef.current) return;
      setSetupError(cause instanceof Error ? cause.message : 'Could not load the receipt workflow.'); setSetupStatus('error');
    });
  }, [initialProjectId, repository]);
  useEffect(() => { loadSetup(); }, [loadSetup]);

  function animateLayout() { if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); }

  useEffect(() => {
    if (!loaded || confirmed) return;
    saveRevisionRef.current += 1; const revision = saveRevisionRef.current;
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      void repository.saveDraft(draft)
        .then(() => { if (mountedRef.current && saveRevisionRef.current === revision) setSaveStatus('saved'); })
        .catch(() => { if (mountedRef.current && saveRevisionRef.current === revision) setSaveStatus('error'); });
    }, 450);
    return () => clearTimeout(timer);
  }, [confirmed, draft, loaded, repository]);
  function retryAutosave() {
    saveRevisionRef.current += 1; const revision = saveRevisionRef.current;
    setSaveStatus('saving');
    void repository.saveDraft(draft)
      .then(() => { if (mountedRef.current && saveRevisionRef.current === revision) setSaveStatus('saved'); })
      .catch(() => { if (mountedRef.current && saveRevisionRef.current === revision) setSaveStatus('error'); });
  }
  // DEC-500. Step 4 shows the Company Load number this load will receive.
  useEffect(() => {
    if (!seriesRepository || !draft.itemId || !draft.recordDate || step !== 4) { setNextNumber(null); return; }
    let active = true;
    seriesRepository.previewNextLoadNumber(draft.itemId, draft.recordDate).then((value) => { if (active) setNextNumber(value); }).catch(() => { if (active) setNextNumber(null); });
    return () => { active = false; };
  }, [seriesRepository, draft.itemId, draft.recordDate, step]);

  const conversion = options?.conversions.find((value) => value.id === draft.conversionId);
  const directUnit = options?.units.find((value) => value.id === draft.directUnitId);
  // Phase 2. Only conversions that start from the entered unit can apply to a direct quantity.
  const directConversions = (options?.conversions ?? []).filter((value) => value.inputUnitId === draft.directUnitId);
  const itemGroups = useMemo(() => { const grouped = new Map<string, LoadSetupOptions['items']>(); for (const value of options?.items ?? []) grouped.set(value.categoryName, [...(grouped.get(value.categoryName) ?? []), value]); return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([categoryName, values]) => ({ id: categoryName, label: categoryName, options: values.sort((a, b) => a.name.localeCompare(b.name)).map((value) => ({ id: value.id, label: value.name, detail: value.internalCode ?? undefined })) })); }, [options?.items]);
  const universalVat = options?.companySettings.vatRatePercent ?? 0;
  const vatRate = resolveVatRate(draft.vat, universalVat);
  const calculation = useMemo(() => calculateLoad(draft, conversion, vatRate), [conversion, draft, vatRate]);
  // DEC-522. The load's billed unit (the direct unit, or the conversion's output unit) is the unit a contract item counts it in.
  const billedUnitId = draft.quantityMethod === 'direct' && !conversion ? (draft.directUnitId || null) : (conversion?.outputUnitId ?? null);
  const billedUnitSymbol = draft.quantityMethod === 'direct' && !conversion ? (directUnit?.symbol ?? '') : (conversion?.outputUnitSymbol ?? '');
  const [contractIssue, setContractIssue] = useState<string | null>(null);
  const [contractRefresh, setContractRefresh] = useState(0);
  const setContractItem = useCallback((value: string | undefined) => setDraft((current) => current.contractItemId === value ? current : { ...current, contractItemId: value }), []);
  // DEC-524. The taller pad's strokes, fitted into the printed signature box, are what the preview shows and what is saved.
  const fittedDraft = useMemo(() => ({ ...draft, driverSignaturePaths: fitSignatureToBox(draft.driverSignaturePaths) }), [draft]);

  const customer = options?.customers.find((value) => value.id === draft.customerId); const item = options?.items.find((value) => value.id === draft.itemId);
  const project = options?.projects.find((value) => value.id === draft.projectId);

  function update<K extends keyof LoadDraft>(key: K, value: LoadDraft[K]) { setDraft((current) => ({ ...current, [key]: value })); setIssues([]); }
  function selectCustomer(id: string) { animateLayout(); setDraft((current) => { const currentProject = options?.projects.find((value) => value.id === current.projectId); return { ...current, customerId: id, projectId: currentProject?.customerId === id ? current.projectId : '', vat: current.customerId === id ? current.vat : startingVatChoice(options?.customers.find((value) => value.id === id)?.vat) }; }); setIssues([]); }
  function selectProject(id: string) { animateLayout(); const selected = options?.projects.find((value) => value.id === id); setDraft((current) => ({ ...current, projectId: id, customerId: selected?.customerId ?? current.customerId, destinationAddress: selected ? '' : current.destinationAddress, vat: selected && selected.customerId !== current.customerId ? startingVatChoice(options?.customers.find((value) => value.id === selected.customerId)?.vat) : current.vat })); setIssues([]); }
  function selectItem(id: string) { const selected = options?.items.find((value) => value.id === id); setDraft((current) => ({ ...current, itemId: id, directUnitId: current.directUnitId || selected?.defaultUnitId || '', unitPriceUsd: selected?.defaultPriceUsd == null ? current.unitPriceUsd : String(selected.defaultPriceUsd) })); }
  function selectDriver(id: string) { const selected = options?.drivers.find((value) => value.id === id); setDraft((current) => ({ ...current, driverId: id, driverName: selected?.name ?? '' })); }
  function selectTruck(id: string) { const selected = options?.trucks.find((value) => value.id === id); setDraft((current) => ({ ...current, truckId: id, truckPlate: selected?.plate ?? '' })); }
  // Phase 2. A conversion only applies to a direct quantity when it starts from the entered unit, so a stale choice is dropped.
  function selectQuantityMethod(quantityMethod: LoadDraft['quantityMethod']) { animateLayout(); setDraft((current) => { const keeps = quantityMethod === 'weighbridge' || options?.conversions.some((value) => value.id === current.conversionId && value.inputUnitId === current.directUnitId); return { ...current, quantityMethod, conversionId: keeps ? current.conversionId : '' }; }); setIssues([]); }
  function selectDirectUnit(id: string) { setDraft((current) => ({ ...current, directUnitId: id, conversionId: options?.conversions.some((value) => value.id === current.conversionId && value.inputUnitId === id) ? current.conversionId : '' })); setIssues([]); }
  function switchDriverMode(mode: 'saved' | 'typed') { if (mode === driverMode) return; animateLayout(); setDriverMode(mode); setDraft((current) => ({ ...current, driverId: '', driverName: mode === 'typed' ? typedDriver : '' })); setIssues([]); }
  function switchTruckMode(mode: 'saved' | 'typed') { if (mode === truckMode) return; animateLayout(); setTruckMode(mode); setDraft((current) => ({ ...current, truckId: '', truckPlate: mode === 'typed' ? typedPlate : '' })); setIssues([]); }
  function typeDriver(value: string) { setTypedDriver(value); setDraft((current) => ({ ...current, driverId: '', driverName: value })); setIssues([]); }
  function typePlate(value: string) { setTypedPlate(value); setDraft((current) => ({ ...current, truckId: '', truckPlate: value })); setIssues([]); }
  function chooseSignatureMode(mode: 'draw' | 'name') { if (mode === signatureMode) return; animateLayout(); setSignatureMode(mode); if (mode === 'name') setDraft((current) => ({ ...current, driverSignaturePaths: [] })); }

  // DEC-524. Delivered to: a project, or an address for an outside customer. Switching drops what the other side held.
  function chooseDestinationMode(mode: 'project' | 'address') {
    if (mode === destinationMode) return; animateLayout(); setDestinationMode(mode);
    setDraft((current) => mode === 'address' ? { ...current, projectId: '' } : { ...current, destinationAddress: '' }); setIssues([]);
  }
  function scrollToTop() { scrollRef.current?.scrollTo({ y: 0, animated: false }); }
  function goToStep(next: number) { setError(null); setIssues([]); setStep(next); scrollToTop(); }
  function stepProblems(forStep: number) {
    if (!options) return [];
    return receiptStepIssues(forStep, [...validateLoadDraft(draft, options), ...(contractIssue && forStep >= 3 ? [contractIssue] : [])]);
  }
  function goNextStep() { const found = stepProblems(step); if (found.length) { setIssues(found); scrollToTop(); return; } goToStep(step + 1); }
  function goBackStep() {
    if (step > 1) { goToStep(step - 1); return; }
    Alert.alert('Leave this receipt?', 'Your draft is kept, so you can come back to it.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Leave', onPress: onBack }]);
  }

  async function doConfirm() {
    if (!options) return; const nextIssues = [...validateLoadDraft(draft, options), ...(contractIssue ? [contractIssue] : [])];
    if (nextIssues.length) { setIssues(nextIssues); const first = Math.min(...nextIssues.map(receiptIssueStep)); if (first < 4) goToStep(first); setIssues(nextIssues); return; }
    Alert.alert('Confirm this load?', 'Confirmation assigns the permanent load number and transaction number. The record cannot return to Draft.', [
      { text: 'Review again', style: 'cancel' },
      { text: 'Confirm load', onPress: () => { setBusy(true); setError(null); const submittedDraft = fittedDraft; void repository.confirmLoad(fittedDraft).then((record) => { setConfirmed(record); setLastConfirmedDraft(submittedDraft); setContractRefresh((value) => value + 1); setDraft(emptyLoadDraft); setStep(1); setShowDocuments(false); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not confirm load.')).finally(() => setBusy(false)); } },
    ]);
  }
  function createAnotherItemForSameDelivery() { if (!lastConfirmedDraft) return; setIssues([]); setError(null); setMessage(null); setDraft(createAnotherItemDraft(lastConfirmedDraft)); setConfirmed(null); }
  if (setupStatus === 'error') return <ErrorView message={setupError} onBack={onBack} onRetry={loadSetup} />;
  if (!options) return <LoadingView onBack={onBack} />;
  if (confirmed) return <ConfirmedView record={confirmed} headers={headers} projectId={lastConfirmedDraft?.projectId || null} canRepeatDelivery={Boolean(lastConfirmedDraft)} onBack={onBack} onOpenCompanySetups={onOpenCompanySetups} onCreateAnotherItem={createAnotherItemForSameDelivery} onStartAnotherLoad={() => { setConfirmed(null); setMessage(null); setError(null); }} />;

  // DEC-524. Every detail of the load on step 4, each line opening the step that holds it, like Review and save on New Supplier Load.
  const driverRole = options.drivers.find((value) => value.id === draft.driverId)?.role;
  const priced = Boolean(draft.unitPriceUsd.trim());
  const reviewRows: [string, string, number | null][] = [
    ['Date', draft.recordDate, 1],
    ['Customer', customer?.name ?? 'Not chosen', 1],
    ['Location', project?.name ?? (draft.destinationAddress.trim() || 'Not chosen'), 1],
    ['Item', item?.name ?? 'Not chosen', 2],
    ...(draft.quantityMethod === 'weighbridge'
      ? [['Weighing', `Empty ${draft.emptyWeightKg || '—'} · Full ${draft.fullWeightKg || '—'} · Net ${calculation.netWeightKg ?? '—'} kg`, 2] as [string, string, number], ...(draft.requestedQuantityKg.trim() ? [['Requested', `${draft.requestedQuantityKg.trim()} kg`, 2] as [string, string, number]] : [])]
      : [['Entered', `${draft.directQuantity.trim().replace(',', '.') || '—'} ${directUnit?.symbol ?? ''}`.trim(), 2] as [string, string, number]]),
    ['Quantity', calculation.billedQuantity == null ? '—' : `${calculation.billedQuantity} ${billedUnitSymbol}${conversion ? ` (${conversion.name})` : ''}`.trim(), conversion ? 3 : 2],
    [truckCrewRoleLabel(driverRole), `${draft.driverName.trim() || 'Not chosen'}${!draft.driverId && draft.driverName.trim() ? ' (not saved)' : ''}`, 2],
    ['Truck', `${draft.truckPlate.trim() || 'Not chosen'}${!draft.truckId && draft.truckPlate.trim() ? ' (not saved)' : ''}`, 2],
    ...(contractLabel ? [['Target', contractLabel, 3] as [string, string, number]] : []),
    ['Price', priced ? `$${Number(draft.unitPriceUsd.trim().replace(',', '.')).toFixed(2)} per ${billedUnitSymbol || 'unit'}` : 'Unpriced', 3],
    ...(priced ? [['Subtotal', formatUsd(calculation.subtotalUsd), 3] as [string, string, number], ['VAT', vatRate > 0 ? `${vatRate}% · ${formatUsd(calculation.vatAmountUsd)}` : 'No VAT', 3] as [string, string, number]] : []),
    ['Load No.', nextNumber ? `${nextNumber.loadNumber} (given on confirm)` : 'Given on confirm', null],
  ];
  const saveText = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Draft saved' : saveStatus === 'error' ? "Couldn't save · Retry" : 'Autosave on';

  return (
    <View style={styles.screen}>
      <ScrollView ref={scrollRef} style={styles.screen} scrollEnabled={!signing} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PageHeader eyebrow="NEW OUTGOING LOAD" title="Make Receipt" onBack={goBackStep} />
        <View style={styles.stepTrack} accessibilityRole="progressbar" accessibilityLabel={`Step ${step} of 4`}>{[1, 2, 3, 4].map((number) => <View key={number} style={[styles.stepDot, number < step && styles.stepDotDone, number === step && styles.stepDotOn]} />)}</View>
        <View style={styles.openHead}>
          <Text style={styles.openTitle}>{receiptEntrySteps[step - 1]}</Text>
          <TouchableOpacity disabled={saveStatus !== 'error'} onPress={retryAutosave} accessibilityRole="button" accessibilityState={{ disabled: saveStatus !== 'error' }} accessibilityLabel={saveStatus === 'error' ? 'Draft not saved. Double tap to retry.' : `Step ${step} of 4. ${saveText}`} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={[styles.openSub, saveStatus === 'error' && styles.saveError]}>Step {step} of 4 · {saveText}</Text>
          </TouchableOpacity>
        </View>
        {error ? <Feedback kind="error">{error}</Feedback> : null}
        <IssueList issues={issues} />

        {step === 1 ? <View>
          {(!options.customers.length || !options.items.length || !options.units.length || (draft.quantityMethod === 'weighbridge' && !options.conversions.length)) ? (
            <View style={styles.warning}>
              <Text style={styles.warningEyebrow}>ACTION NEEDED</Text>
              <Text style={styles.warningTitle}>Setup required</Text>
              <Text style={styles.helper}>Create a customer and a load-enabled item. Drivers and trucks can be saved in People & Equipment or simply typed on each load. Units and the kg-to-ton conversion are already seeded.</Text>
              <TouchableOpacity onPress={onOpenDirectory} accessibilityRole="button" accessibilityLabel="Open People and Equipment" hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}><Text style={styles.link}>Open People & Equipment</Text></TouchableOpacity>
            </View>
          ) : null}
          <View style={[styles.openGroup, styles.openGroupFirst]}><Text style={styles.openGroupLabel}>WHEN</Text>
            <DatePickerField variant="open" label="Record date *" value={draft.recordDate} onChange={(value) => update('recordDate', value)} minDate={project?.startDate ?? undefined} maxDate={project?.endDate ?? todayIso()} />
          </View>
          <View style={styles.openGroup}><Text style={styles.openGroupLabel}>WHERE</Text>
            <OpenSwitch label="Delivered to *" options={[{ id: 'project' as const, label: 'Project' }, { id: 'address' as const, label: 'Other address' }]} selectedId={destinationMode} onSelect={chooseDestinationMode} />
            <Text style={styles.openHelp}>{destinationMode === 'project' ? "The load goes to a saved project and appears in that project's daily report." : 'For an outside customer without a saved project.'}</Text>
            {destinationMode === 'project' ? <SearchableSelect variant="open" label="Select project *" options={options.projects.map((value) => ({ id: value.id, label: value.name, detail: `${value.customerName} · ${value.location}` }))} selectedId={draft.projectId} onSelect={selectProject} placeholder={options.projects.length ? 'Search and select a project' : 'Create a project first'} /> : null}
          </View>
          <View style={styles.openGroup}><Text style={styles.openGroupLabel}>WHO</Text>
            <SearchableSelect variant="open" label="Customer *" options={options.customers.map((value) => ({ id: value.id, label: value.name, detail: value.isOwnCompany ? 'Own company' : value.type }))} selectedId={draft.customerId} onSelect={selectCustomer} />
            {project && customer ? <Text style={styles.openHelp}>Filled from the project.</Text> : null}
            {destinationMode === 'address' ? <>
              {customer?.isOwnCompany ? <Text style={styles.openHelp}>Own company: a saved project is required. Choose Project above.</Text> : null}
              <AppField variant="open" label="Destination address *" value={draft.destinationAddress} onChangeText={(value) => update('destinationAddress', value)} multiline />
            </> : null}
          </View>
        </View> : null}

        {step === 2 ? <View>
          <View style={[styles.openGroup, styles.openGroupFirst]}><Text style={styles.openGroupLabel}>WHAT</Text>
            <OpenSwitch label="Quantity method" options={[{ id: 'weighbridge' as const, label: 'Weighbridge' }, { id: 'direct' as const, label: 'Direct quantity' }]} selectedId={draft.quantityMethod} onSelect={selectQuantityMethod} />
            <Text style={styles.openHelp}>{draft.quantityMethod === 'weighbridge' ? 'Empty and full kg from the weighbridge.' : 'Pieces, metres, bundles or another unit.'}</Text>
            <GroupedSearchableSelect variant="open" label="Load-enabled item *" groups={itemGroups} selectedId={draft.itemId} onSelect={selectItem} placeholder="Choose category, then item" />
            {draft.quantityMethod === 'weighbridge' ? <>
              <View style={styles.columns}><View style={styles.column}><AppField variant="open" label="Empty weight kg *" value={draft.emptyWeightKg} onChangeText={(value) => update('emptyWeightKg', value)} keyboardType="number-pad" /></View><View style={styles.column}><AppField variant="open" label="Full weight kg *" value={draft.fullWeightKg} onChangeText={(value) => update('fullWeightKg', value)} keyboardType="number-pad" /></View></View>
              <OpenResult label="Net weight" value={calculation.netWeightKg == null ? '—' : `${calculation.netWeightKg} kg`} />
              <AppField variant="open" label="Requested quantity (kg, optional)" value={draft.requestedQuantityKg} onChangeText={(value) => update('requestedQuantityKg', value)} keyboardType="number-pad" />
            </> : <>
              <AppField variant="open" label="Quantity *" value={draft.directQuantity} onChangeText={(value) => update('directQuantity', value)} keyboardType="decimal-pad" />
              <SearchableSelect variant="open" label="Unit *" options={options.units.map((value) => ({ id: value.id, label: value.name, detail: value.symbol }))} selectedId={draft.directUnitId} onSelect={selectDirectUnit} placeholder="Piece, metre, bundle, or another unit" />
              <OpenResult label="Receipt quantity" value={draft.directQuantity.trim() && directUnit ? `${draft.directQuantity.trim().replace(',', '.')} ${directUnit.symbol}` : '—'} />
            </>}
          </View>
          <View style={styles.openGroup}><Text style={styles.openGroupLabel}>WHO CARRIED IT</Text>
            {/* DEC-477. Drivers and Operators can both drive a truck. The filter only narrows the list; choosing an Operator never changes their directory role. */}
            <OpenSwitch label="Driver / Operator *" options={[{ id: 'saved' as const, label: 'Saved person' }, { id: 'typed' as const, label: 'Type a name' }]} selectedId={driverMode} onSelect={switchDriverMode} />
            {driverMode === 'saved' ? (
              <>
                <SegmentedChoice mode="tabs" options={crewFilterOptions} selectedId={crewFilter} onSelect={setCrewFilter} />
                <SearchableSelect variant="open" label="Saved driver or operator" options={crewOptions} selectedId={draft.driverId} onSelect={selectDriver} placeholder={crew.length ? 'Choose the person driving' : 'No saved drivers yet. Type a name instead.'} />
              </>
            ) : (
              <>
                <AppField variant="open" label="Driver name *" value={typedDriver} onChangeText={typeDriver} autoCapitalize="words" />
                <View style={styles.notSavedRow}><Text style={styles.notSavedChip}>NOT SAVED</Text><Text style={[styles.openHelp, styles.flex]}>Used on this load only. It is not added to People.</Text></View>
              </>
            )}
            <OpenSwitch label="Truck *" options={[{ id: 'saved' as const, label: 'Saved truck' }, { id: 'typed' as const, label: 'Type a plate' }]} selectedId={truckMode} onSelect={switchTruckMode} />
            {truckMode === 'saved' ? (
              <SearchableSelect variant="open" label="Saved truck" options={options.trucks.map((value) => ({ id: value.id, label: value.plate, detail: [value.makeModel, value.ownerName].filter(Boolean).join(' · ') }))} selectedId={draft.truckId} onSelect={selectTruck} placeholder={options.trucks.length ? 'Choose the truck' : 'No saved trucks yet. Type a plate instead.'} />
            ) : (
              <>
                <AppField variant="open" label="Truck plate *" value={typedPlate} onChangeText={typePlate} autoCapitalize="characters" />
                <View style={styles.notSavedRow}><Text style={styles.notSavedChip}>NOT SAVED</Text><Text style={[styles.openHelp, styles.flex]}>Used on this load only. It is not added to Trucks.</Text></View>
              </>
            )}
          </View>
        </View> : null}

        {step === 3 ? <View>
          <Text style={styles.openHelp}>Optional. Left empty, this load is saved as Unpriced, never as zero.</Text>
          <View style={styles.openGroup}><Text style={styles.openGroupLabel}>CONVERSION</Text>
            {draft.quantityMethod === 'weighbridge' ? (
              <>
                <SearchableSelect variant="open" label="Conversion *" options={options.conversions.map((value) => ({ id: value.id, label: value.name, detail: `${value.inputQuantity} ${value.inputUnitSymbol} = ${value.outputQuantity} ${value.outputUnitSymbol}` }))} selectedId={draft.conversionId} onSelect={(id) => update('conversionId', id)} />
                {conversion ? <OpenResult label="Converted quantity, used for the price" value={calculation.billedQuantity == null ? '—' : `${calculation.billedQuantity.toFixed(conversion.decimalPlaces)} ${conversion.outputUnitSymbol}`} /> : null}
              </>
            ) : (
              <>
                <SearchableSelect variant="open" label="Conversion (optional)" options={directConversions.map((value) => ({ id: value.id, label: value.name, detail: `${value.inputQuantity} ${value.inputUnitSymbol} = ${value.outputQuantity} ${value.outputUnitSymbol}` }))} selectedId={draft.conversionId} onSelect={(id) => update('conversionId', id)} allowClear placeholder="No conversion (use the quantity as entered)" />
                {draft.directUnitId && !directConversions.length ? <Text style={styles.openHelp}>No conversion starts from {directUnit?.symbol ?? 'this unit'}. The quantity is used as entered. Add one in Units &amp; Conversions.</Text> : null}
                {conversion ? <OpenResult label="Converted quantity, used for the price" value={calculation.billedQuantity == null ? '—' : `${calculation.billedQuantity.toFixed(conversion.decimalPlaces)} ${conversion.outputUnitSymbol}`} /> : <OpenResult label="Entered directly, no conversion" value={`${calculation.billedQuantity ?? '—'} ${directUnit?.symbol ?? ''}`.trim()} />}
              </>
            )}
          </View>
          <View style={styles.openGroup}><Text style={styles.openGroupLabel}>PRICE</Text>
            <AppField variant="open" label={`Price per ${draft.quantityMethod === 'direct' ? (conversion ? `converted unit (${conversion.outputUnitSymbol})` : (directUnit?.symbol || 'unit')) : 'converted unit'} USD (optional)`} value={draft.unitPriceUsd} onChangeText={(value) => update('unitPriceUsd', value)} keyboardType="decimal-pad" placeholder="Unpriced when empty" />
            <VatChoiceControl value={draft.vat} onChange={(vat) => update('vat', vat)} universalRatePercent={universalVat} hint={customer ? `${customer.name} is set to ${accountVatLabel(customer.vat, universalVat)}. No VAT is added unless you choose it.` : 'No VAT is added unless you choose it.'} />
          </View>
          {contracts ? <ContractItemChoice variant="open" contracts={contracts} projectId={draft.projectId || null} materialId={draft.itemId} materialName={item?.name} loadUnitId={billedUnitId} loadUnitSymbol={billedUnitSymbol} loadQuantity={calculation.billedQuantity ?? null} value={draft.contractItemId} onChange={setContractItem} onIssue={setContractIssue} onSelection={setContractLabel} refreshKey={contractRefresh} /> : null}
          <View style={styles.openGroup}><Text style={styles.openGroupLabel}>WHAT IT COMES TO</Text>
            {calculation.subtotalUsd != null ? <View style={styles.ruled}>
              <OpenResult label="Subtotal" value={formatUsd(calculation.subtotalUsd)} plain />
              {vatRate > 0 ? <OpenResult label={`VAT (${vatRate}%)`} value={formatUsd(calculation.vatAmountUsd)} plain /> : null}
              <OpenResult label="Final total" value={formatUsd(calculation.finalTotalUsd)} />
            </View> : <Text style={styles.openHelp}>No price entered: this load is saved as Unpriced.</Text>}
          </View>
        </View> : null}

        {step === 4 ? <View>
          <Text style={styles.openHelp}>Tap a line to change it.</Text>
          <View style={[styles.ruled, styles.reviewList]}>
            {reviewRows.map(([label, value, target]) => target == null
              ? <View key={label} style={styles.ruledRow}><Text style={styles.ruledLabel}>{label}</Text><Text style={styles.ruledValue}>{value}</Text></View>
              : <TouchableOpacity key={label} style={styles.ruledRow} onPress={() => goToStep(target)} accessibilityRole="button" accessibilityLabel={`${label}: ${value}. Change`}><Text style={styles.ruledLabel}>{label}</Text><Text style={styles.ruledValue}>{value}<Text style={styles.openLink}>  Change</Text></Text></TouchableOpacity>)}
            <TouchableOpacity style={[styles.ruledRow, styles.ruledTotal]} onPress={() => goToStep(3)} accessibilityRole="button" accessibilityLabel={`Total: ${formatUsd(calculation.finalTotalUsd)}. Change`}><Text style={styles.ruledTotalLabel}>Total</Text><Text style={styles.ruledTotalValue}>{formatUsd(calculation.finalTotalUsd)}</Text></TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.openLinkBox} onPress={() => setShowDocuments(!showDocuments)} accessibilityRole="button" accessibilityState={{ expanded: showDocuments }}><Text style={styles.openLink}>{showDocuments ? 'Hide documents' : 'Preview documents · Receipt and Authorization'}</Text></TouchableOpacity>
          {showDocuments ? <LoadDocuments data={draftDocument(options, fittedDraft, calculation, nextNumber?.loadNumber ?? null)} isDraft /> : null}
          <View style={styles.openGroup}><Text style={styles.openGroupLabel}>SUPPLIER SIGNATURE</Text>
            {options.deliverySignature ? (
              <View style={styles.sigOpen}>
                {options.deliverySignature.display === 'name_with_signature' && options.deliverySignature.signature.length ? <View style={styles.sigPreview} accessibilityLabel={`Saved signature of ${options.deliverySignature.name}`}><Svg width="100%" height="100%" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet">{options.deliverySignature.signature.map((path, index) => <Path key={`${index}-${path.length}`} d={path} fill="none" stroke="#111" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />)}</Svg></View> : null}
                <Text style={styles.sigName}>{[options.deliverySignature.name, options.deliverySignature.jobTitle].filter(Boolean).join(' · ')}</Text>
                <View style={styles.notSavedRow}><Text style={styles.autoChip}>AUTO-SIGNED</Text><Text style={[styles.openHelp, styles.flex]}>From the saved company signature{options.deliverySignature.display === 'name_only' ? ' (name only)' : ''}. Change it in Company setups.</Text></View>
              </View>
            ) : (
              <View style={styles.sigOpen}>
                <Text style={styles.sigName}>No supplier signature</Text>
                <Text style={styles.openHelp}>{options.supplierSignatureNote ?? 'No default signer is set, so the supplier line is left off the Delivery Authorization.'}</Text>
                {onOpenCompanySetups ? <TouchableOpacity style={styles.openLinkBox} onPress={onOpenCompanySetups} accessibilityRole="button"><Text style={styles.openLink}>Open Company setups</Text></TouchableOpacity> : null}
              </View>
            )}
          </View>
          <View style={styles.openGroup}><Text style={styles.openGroupLabel}>{truckCrewRoleLabel(driverRole).toUpperCase()} SIGNATURE</Text>
            <OpenSwitch options={[{ id: 'draw' as const, label: 'Draw signature' }, { id: 'name' as const, label: 'Name only' }]} selectedId={signatureMode} onSelect={chooseSignatureMode} />
            {signatureMode === 'draw' ? (
              <>
                <SignaturePad large value={draft.driverSignaturePaths} onChange={(paths) => update('driverSignaturePaths', paths)} onSigningChange={setSigning} />
                <Text style={styles.openHelp}>Page scrolling pauses while you sign. The signature prints on the Delivery Authorization. Leaving the pad empty is allowed.</Text>
              </>
            ) : <Text style={styles.openHelp}>No drawn signature. The load is saved Unsigned and the driver can sign later in Load History.</Text>}
          </View>
          <View style={styles.openGroup}><Text style={styles.openGroupLabel}>NOTES · OPTIONAL</Text>
            <AppField variant="open" label="Notes" value={draft.notes} onChangeText={(value) => update('notes', value)} multiline />
          </View>
        </View> : null}
      </ScrollView>
      <View style={styles.stepBar}>
        <View style={styles.flex}><Text style={styles.stepBarLabel}>TOTAL</Text><Text style={styles.stepBarValue}>{calculation.finalTotalUsd == null ? 'not priced yet' : formatUsd(calculation.finalTotalUsd)}</Text></View>
        <View style={styles.stepActions}>
          <TouchableOpacity style={styles.stepBack} onPress={goBackStep} accessibilityRole="button"><Text style={styles.stepBackText}>{step === 1 ? 'Cancel' : 'Back'}</Text></TouchableOpacity>
          <TouchableOpacity style={styles.stepNext} disabled={busy} onPress={step === 4 ? () => void doConfirm() : goNextStep} accessibilityRole="button"><Text style={styles.stepNextText}>{step === 4 ? (busy ? 'Saving…' : 'Confirm load') : 'Next'}</Text></TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function LoadingView({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.screen}>
      <View style={styles.content}><PageHeader eyebrow="NEW OUTGOING LOAD" title="Make Receipt" onBack={onBack} /></View>
      <View style={styles.loading}><Text style={styles.loadingMark}>D</Text><Text style={styles.helper}>Preparing receipt workflow…</Text></View>
    </View>
  );
}

function ErrorView({ message, onBack, onRetry }: { message: string | null; onBack: () => void; onRetry: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <PageHeader eyebrow="NEW OUTGOING LOAD" title="Make Receipt" onBack={onBack} />
      <View style={styles.errorState}>
        <Text style={styles.errorStateTitle}>Could not load the receipt workflow</Text>
        <Text style={styles.errorStateText}>{message ?? 'An unknown error occurred while loading customers, items, drivers, and trucks.'}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry loading the receipt workflow"><Text style={styles.retryButtonText}>Retry</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

/**
 * Phase 3. What happens after confirming: choose the document, choose the Header company, see a live preview,
 * print or share it, and only then start something new. Nothing here starts a new load by itself.
 */
function ConfirmedView({ record, headers, projectId, canRepeatDelivery, onBack, onOpenCompanySetups, onCreateAnotherItem, onStartAnotherLoad }: { record: ConfirmedLoad; headers?: CompanyHeaderRepository; projectId: string | null; canRepeatDelivery: boolean; onBack: () => void; onOpenCompanySetups?: () => void; onCreateAnotherItem: () => void; onStartAnotherLoad: () => void }) {
  const [kind, setKind] = useState<LoadDocumentKind>('receipt');
  const [paper, setPaper] = useState<PaperWidth>('58');
  // DEC-541. Off every time: the verification QR is chosen per document, never remembered.
  const [withQr, setWithQr] = useState(false);
  const [headerKind, setHeaderKind] = useState<HeaderCompanyKind>('plant');
  const [remember, setRemember] = useState(false);
  const [header, setHeader] = useState<HeaderCompany | null>(null);
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printFailed, setPrintFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  // The project's remembered header is the starting choice; a project with none starts on the Plant Company.
  useEffect(() => {
    if (!headers || !projectId) return;
    let active = true;
    headers.getProjectHeaderDefault(projectId).then((stored) => { if (active) setHeaderKind(stored); }).catch(() => undefined);
    return () => { active = false; };
  }, [headers, projectId]);
  useEffect(() => {
    if (!headers) { setHeader(null); return; }
    let active = true;
    headers.resolveHeader(headerKind).then((value) => { if (active) setHeader(value); }).catch(() => { if (active) setHeader(null); });
    return () => { active = false; };
  }, [headers, headerKind]);
  const shown = header ? applyHeaderCompany(record, header) : record;
  const label = kind === 'receipt' ? 'Receipt' : 'Delivery Authorization';
  async function rememberChoice() { if (headers && remember && projectId && header) await headers.setProjectHeaderDefault(projectId, header.kind); }
  async function print() {
    setBusy('print'); setError(null); setMessage(null); setPrintFailed(false);
    try { await rememberChoice(); const printer = await printLoadBluetooth(shown, kind, paper, withQr ? await receiptQrPayloadFor(shown) : null); if (mounted.current) setMessage(`${label} sent to ${printer.name}.`); }
    catch (cause) { if (mounted.current) { setPrintFailed(true); setError(`${cause instanceof Error ? cause.message : 'Could not print.'} The confirmed record is still saved.`); } }
    finally { if (mounted.current) setBusy(null); }
  }
  async function share() {
    setBusy('pdf'); setError(null); setMessage(null); setPrintFailed(false);
    try { await rememberChoice(); await exportAndShareLoadDocument(shown, kind, paper, withQr ? await receiptQrPayloadFor(shown) : null); if (mounted.current) setMessage(`${label} PDF created.`); }
    catch (cause) { if (mounted.current) setError(`${cause instanceof Error ? cause.message : 'Could not create the PDF.'} The confirmed record is still saved.`); }
    finally { if (mounted.current) setBusy(null); }
  }
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <PageHeader eyebrow="LOAD WORKFLOW" title="Load confirmed" onBack={onBack} />
      <View style={styles.confirmedHero}>
        <Text style={styles.confirmedKicker}>CONFIRMED OFFLINE</Text>
        <Text style={styles.confirmedNumber}>{loadNumberLabel(record.loadNumber)}</Text>
        <Text style={styles.confirmedHint}>Load number{record.loadNumberSeriesName?` · ${record.loadNumberSeriesName} series`:''} · Transaction {record.transactionNumber} (Receipt and Delivery Authorization)</Text>
        <Text style={styles.confirmedHint}>The permanent record is saved even if printing fails. {record.signaturePaths.length ? 'The driver signed while the receipt was made.' : "Add the driver's signature in Load History before printing the Delivery Authorization."}</Text>
      </View>
      {error ? <Feedback kind="error">{error}</Feedback> : null}
      {message ? <Feedback kind="success">{message}</Feedback> : null}
      <View style={[styles.openGroup, styles.openGroupFirst]}>
        <Text style={styles.openGroupLabel}>What do you want to print?</Text>
        <View style={styles.methodSelector}>
          <MethodChoice title="Receipt" hint="Quantity, price and total for the customer" selected={kind === 'receipt'} onPress={() => setKind('receipt')} />
          <MethodChoice title="Delivery Authorization" hint="Driver, truck and both signatures" selected={kind === 'authorization'} onPress={() => setKind('authorization')} />
        </View>
        <OpenSwitch label="Paper" options={[{ id: '58' as const, label: '58 mm' }, { id: '80' as const, label: '80 mm' }]} selectedId={paper} onSelect={setPaper} />
        <OpenSwitch label="Verification QR code" options={[{ id: 'off' as const, label: 'No QR' }, { id: 'on' as const, label: 'Print QR' }]} selectedId={withQr ? 'on' : 'off'} onSelect={(value) => setWithQr(value === 'on')} />
        {withQr ? <Text style={styles.openHelp}>Adds a QR with the load number, date, material and quantity. Any phone camera reads it; DROMEX can check it is genuine.</Text> : null}
      </View>
      {headers ? <HeaderCompanyPicker headers={headers} value={headerKind} onChange={setHeaderKind} remember={projectId ? { checked: remember, onChange: setRemember } : undefined} onOpenSetups={onOpenCompanySetups} /> : null}
      <LoadDocuments data={confirmedDocument(shown)} isDraft={false} kind={kind} paper={paper} />
      <AppButton label={printFailed ? 'Retry Print' : `Bluetooth Print ${label}`} busy={busy === 'print'} disabled={busy !== null} onPress={() => void print()} />
      <AppButton label={`Share ${label} PDF`} tone="navy" busy={busy === 'pdf'} disabled={busy !== null} onPress={() => void share()} />
      <View style={styles.nextRule}><View style={styles.nextLine} /><Text style={styles.nextText}>Done printing? Choose what is next.</Text><View style={styles.nextLine} /></View>
      <Text style={styles.nextHint}>Nothing starts until you tap.</Text>
      {canRepeatDelivery ? (
        <View style={styles.repeatCard}>
          <Text style={styles.repeatTitle}>Same truck, another item?</Text>
          <Text style={styles.helper}>Starts a fresh draft for the same customer, project, destination, driver, and truck. Item, quantity, weights, price, and notes all start empty — nothing from this load's weights or totals carries over.</Text>
          <AppButton label="Create Another Item for Same Delivery" tone="secondary" onPress={onCreateAnotherItem} />
        </View>
      ) : null}
      <AppButton label="Start Another Load" tone="secondary" onPress={onStartAnotherLoad} />
    </ScrollView>
  );
}

function MethodChoice({ title, hint, selected, onPress }: { title: string; hint: string; selected: boolean; onPress: () => void }) { return <TouchableOpacity activeOpacity={.72} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${title}. ${hint}`} style={[styles.methodChoice, selected && styles.methodChoiceSelected]}><Text style={[styles.methodTitle, selected && styles.methodTitleSelected]}>{title}</Text><Text style={[styles.methodHint, selected && styles.methodHintSelected]}>{hint}</Text></TouchableOpacity>; }
function IssueList({ issues }: { issues: string[] }) { if (!issues.length) return null; return <Feedback kind="error">{issues.map((issue) => `• ${issue}`).join('\n')}</Feedback>; }

export function draftDocument(options: LoadSetupOptions, draft: LoadDraft, calculation: ReturnType<typeof calculateLoad>, loadNumber: string | null = null): DocumentViewData { const customer = options.customers.find((v) => v.id === draft.customerId); const project = options.projects.find((v) => v.id === draft.projectId); const item = options.items.find((v) => v.id === draft.itemId); const conversion = options.conversions.find((v) => v.id === draft.conversionId); const unit = options.units.find(v => v.id === draft.directUnitId); const direct = draft.quantityMethod === 'direct'; return { quantityMethod: draft.quantityMethod, companyName: options.companySettings.companyName, companyAddress: options.companySettings.address, companyPhone: options.companySettings.phone, companyEmail: options.companySettings.email, companyTaxVatNumber: options.companySettings.taxVatNumber, companyReceiptFooter: options.companySettings.receiptFooter, loadNumber, transactionNumber: '', dateTime: new Date(`${draft.recordDate}T12:00:00`).toISOString(), customerName: customer?.name ?? '', projectName: project?.name ?? null, destinationAddress: project?.location ?? (draft.destinationAddress.trim() || null), itemName: item?.name ?? '', driverName: draft.driverName.trim(), driverRole: options.drivers.find((v) => v.id === draft.driverId)?.role ?? null, truckPlate: draft.truckPlate.trim(), requestedQuantityKg: !direct && draft.requestedQuantityKg ? Number(draft.requestedQuantityKg) : null, emptyWeightKg: !direct && draft.emptyWeightKg ? Number(draft.emptyWeightKg) : null, fullWeightKg: !direct && draft.fullWeightKg ? Number(draft.fullWeightKg) : null, netWeightKg: calculation.netWeightKg, convertedQuantity: calculation.billedQuantity, outputUnitSymbol: direct && !conversion ? (unit?.symbol ?? null) : (conversion?.outputUnitSymbol ?? null), unitPriceUsd: draft.unitPriceUsd.trim() ? Number(draft.unitPriceUsd.replace(',', '.')) : null, subtotalUsd: calculation.subtotalUsd, vatRatePercent: draft.unitPriceUsd.trim() ? options.companySettings.vatRatePercent : null, vatAmountUsd: calculation.vatAmountUsd, finalTotalUsd: calculation.finalTotalUsd, signaturePaths: draft.driverSignaturePaths, supplierSignature: options.deliverySignature ?? null, enteredQuantity: direct && conversion ? `${draft.directQuantity.trim().replace(',', '.')} ${unit?.symbol ?? ''}`.trim() : null, conversionRule: direct && conversion ? `${conversion.inputQuantity} ${conversion.inputUnitSymbol} = ${conversion.outputQuantity} ${conversion.outputUnitSymbol}` : null }; }
export function confirmedDocument(record: ConfirmedLoad): DocumentViewData { return { quantityMethod: record.quantityMethod, companyName: record.companyName, companyAddress: record.companyAddress, companyPhone: record.companyPhone, companyEmail: record.companyEmail, companyTaxVatNumber: record.companyTaxVatNumber, companyReceiptFooter: record.companyReceiptFooter, loadNumber: record.loadNumber ?? null, transactionNumber: record.transactionNumber, dateTime: record.confirmedAt, customerName: record.customerName, projectName: record.projectName, destinationAddress: record.projectLocation ?? record.destinationAddress, itemName: record.itemName, driverName: record.driverName, driverRole: record.driverRole ?? null, truckPlate: record.truckPlate, requestedQuantityKg: record.requestedQuantityKg, emptyWeightKg: record.emptyWeightKg, fullWeightKg: record.fullWeightKg, netWeightKg: record.netWeightKg, convertedQuantity: record.billedQuantity, outputUnitSymbol: record.outputUnitSymbol, unitPriceUsd: record.unitPriceUsd, subtotalUsd: record.subtotalUsd, vatRatePercent: record.vatRatePercent, vatAmountUsd: record.vatAmountUsd, finalTotalUsd: record.finalTotalUsd, signaturePaths: record.signaturePaths, supplierSignature: record.supplierSignature ?? null, enteredQuantity: directConversionLines(record)?.entered ?? null, conversionRule: directConversionLines(record)?.rule ?? null }; }

/** A calculated line in the Open form: a grey label and the result, large unless `plain`. */
function OpenResult({ label, value, plain = false }: { label: string; value: string; plain?: boolean }) { return <View style={styles.resultRow}><Text style={plain ? styles.resultLabel : styles.resultStrongLabel}>{label}</Text><Text style={plain ? styles.resultValue : styles.resultStrongValue}>{value}</Text></View>; }

const styles = StyleSheet.create({ nextRule: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 }, nextLine: { flex: 1, borderTopWidth: 1, borderTopColor: colors.line }, nextText: { color: colors.muted, fontSize: 12, fontWeight: '800' }, nextHint: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  notSavedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, notSavedChip: { color: colors.warning, backgroundColor: '#FFF3D8', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden', fontSize: 10, fontWeight: '900', letterSpacing: .6 },
  sigOpen: { gap: 6 }, sigPreview: { height: 64, borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: '#FFF' }, sigName: { color: colors.ink, fontSize: 14, fontWeight: '900' }, autoChip: { alignSelf: 'flex-start', color: colors.success, backgroundColor: '#E5F3EC', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden', fontSize: 10, fontWeight: '900', letterSpacing: .6 },
  screen: { flex: 1 }, content: { padding: 20, paddingBottom: 42, gap: 16 }, flex: { flex: 1, minWidth: 0 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 60 }, loadingMark: { width: 46, height: 46, borderRadius: 23, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', backgroundColor: colors.navy, color: '#FFF', fontSize: 24, fontWeight: '900' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  errorState: { backgroundColor: '#FCE8E6', borderRadius: 16, padding: 20, gap: 12, borderLeftWidth: 4, borderLeftColor: colors.danger, marginTop: 16 }, errorStateTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, errorStateText: { color: colors.danger, fontSize: 13, lineHeight: 19, fontWeight: '700' }, retryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink, borderRadius: 11, paddingHorizontal: 16 }, retryButtonText: { color: '#FFF', fontWeight: '900', fontSize: 15 },
  warning: { backgroundColor: '#FFF3D8', borderWidth: 1, borderColor: '#E3C681', padding: 15, borderRadius: 14, gap: 5, marginBottom: 12 }, warningEyebrow: { color: colors.warning, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, warningTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, link: { alignSelf: 'flex-start', color: colors.brandDark, fontWeight: '900', marginTop: 5, borderBottomWidth: 1, borderBottomColor: colors.brandDark, paddingBottom: 2 },
  methodSelector: { flexDirection: 'row', gap: 8 }, methodChoice: { flex: 1, minHeight: 70, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 11, justifyContent: 'center', backgroundColor: colors.surface }, methodChoiceSelected: { backgroundColor: colors.navy, borderColor: colors.navy }, methodTitle: { color: colors.ink, fontWeight: '900', fontSize: 13 }, methodTitleSelected: { color: '#FFF' }, methodHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 }, methodHintSelected: { color: '#D8E4ED' },
  columns: { flexDirection: 'row', gap: 12 }, column: { flex: 1 },
  repeatCard: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, gap: 10 }, repeatTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  // DEC-524. The Open form look of New Supplier Load: step bars, grouped headings, ruled review and the TOTAL bar.
  stepTrack: { flexDirection: 'row', gap: 6 }, stepDot: { flex: 1, height: 6, borderRadius: 99, backgroundColor: '#E4E8EE' }, stepDotDone: { backgroundColor: colors.navy }, stepDotOn: { backgroundColor: colors.brand },
  openHead: { gap: 2 }, openTitle: { color: colors.ink, fontSize: 22, fontWeight: '900' }, openSub: { color: colors.muted, fontSize: 12, fontWeight: '700' }, saveError: { color: colors.warning },
  openGroup: { gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, marginTop: 16 }, openGroupFirst: { borderTopWidth: 0, paddingTop: 0, marginTop: 4 }, openGroupLabel: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  openLink: { color: colors.brand, fontSize: 13, fontWeight: '800' }, openLinkBox: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, openHelp: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, paddingVertical: 11, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: colors.line }, resultLabel: { color: colors.muted, fontSize: 12 }, resultValue: { color: colors.ink, fontSize: 13, fontWeight: '700' }, resultStrongLabel: { color: colors.ink, fontSize: 13, fontWeight: '800', flexShrink: 1 }, resultStrongValue: { color: colors.navy, fontSize: 20, fontWeight: '900' },
  ruled: { borderTopWidth: 1, borderTopColor: colors.line }, reviewList: { marginTop: 8 }, ruledRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 2, minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.line }, ruledLabel: { color: colors.muted, fontSize: 12, width: '30%' }, ruledValue: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: '700', textAlign: 'right' }, ruledTotal: { borderBottomWidth: 0, paddingTop: 14, alignItems: 'baseline' }, ruledTotalLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' }, ruledTotalValue: { color: colors.navy, fontSize: 22, fontWeight: '900' },
  stepBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.navy, paddingHorizontal: 16, paddingVertical: 10 }, stepBarLabel: { color: '#D5E4EF', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, stepBarValue: { color: colors.cream, fontSize: 18, fontWeight: '900' }, stepActions: { flexDirection: 'row', gap: 8 }, stepBack: { minHeight: 48, minWidth: 78, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#D5E4EF', borderRadius: 12, paddingHorizontal: 14 }, stepBackText: { color: colors.cream, fontWeight: '800' }, stepNext: { minHeight: 48, minWidth: 96, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.brand, borderRadius: 12, paddingHorizontal: 16 }, stepNextText: { color: '#FFF', fontWeight: '900' },
  confirmedHero: { backgroundColor: '#E7F3EC', borderRadius: 14, padding: 16, gap: 4 }, confirmedKicker: { color: colors.success, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, confirmedNumber: { color: colors.ink, fontSize: 25, fontWeight: '900' }, confirmedHint: { color: '#3C4854', fontSize: 12, lineHeight: 18, marginTop: 3 },
});
