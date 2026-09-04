import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, LayoutAnimation, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { LoadRepository } from '../../data/repositories/LoadRepository';
import { calculateLoad, createAnotherItemDraft, emptyLoadDraft, formatUsd, type ConfirmedLoad, type LoadDraft, type LoadSetupOptions, validateLoadDraft } from '../../domain/loads';
import { printLoadBluetooth } from '../../services/bluetoothPrinter';
import { AppButton, AppCard, AppField, Feedback, MetricCard, PageHeader } from '../components/AppPrimitives';
import { LoadDocuments, type DocumentViewData } from '../components/LoadDocuments';
import { SearchableSelect } from '../components/SearchableSelect';
import { GroupedSearchableSelect } from '../components/GroupedSearchableSelect';
import { DatePickerField, todayIso } from '../components/DatePickerField';
import { useReducedMotion } from '../components/ExpandableMenu';
import { colors } from '../theme';

export function MakeReceiptScreen({ repository, onBack, onOpenSetup, onOpenDirectory, onOpenProjects, initialProjectId }: { repository: LoadRepository; onBack: () => void; onOpenSetup: () => void; onOpenDirectory: () => void; onOpenProjects: () => void; initialProjectId?: string | null }) {
  const [options, setOptions] = useState<LoadSetupOptions | null>(null);
  const [draft, setDraft] = useState<LoadDraft>(emptyLoadDraft);
  const [lastConfirmedDraft, setLastConfirmedDraft] = useState<LoadDraft | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [setupStatus, setSetupStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedLoad | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const reducedMotion = useReducedMotion();
  const entrance = useState(() => Array.from({ length: 4 }, () => new Animated.Value(0)))[0];
  const calculationMotion = useState(() => new Animated.Value(1))[0];
  const mountedRef = useRef(true);
  const saveRevisionRef = useRef(0);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadSetup = useCallback(() => {
    setSetupStatus('loading'); setSetupError(null);
    void Promise.all([repository.getSetupOptions(), repository.getDraft()]).then(([nextOptions, saved]) => {
      if (!mountedRef.current) return;
      let next = saved ?? emptyLoadDraft;
      if (initialProjectId && !next.projectId) { const selected = nextOptions.projects.find((project) => project.id === initialProjectId); if (selected) next = { ...next, projectId: selected.id, customerId: selected.customerId, destinationAddress: '' }; }
      setOptions(nextOptions); setDraft(next); setLoaded(true); setSetupStatus('ready');
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
  useEffect(() => { if (!loaded) return; if (reducedMotion) { entrance.forEach((value) => value.setValue(1)); return; } const animation = Animated.stagger(70, entrance.map((value) => Animated.timing(value, { toValue: 1, duration: 280, useNativeDriver: true }))); animation.start(); return () => animation.stop(); }, [entrance, loaded, reducedMotion]);

  const conversion = options?.conversions.find((value) => value.id === draft.conversionId);
  const directUnit = options?.units.find((value) => value.id === draft.directUnitId);
  const itemGroups = useMemo(() => { const grouped = new Map<string, LoadSetupOptions['items']>(); for (const value of options?.items ?? []) grouped.set(value.categoryName, [...(grouped.get(value.categoryName) ?? []), value]); return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([categoryName, values]) => ({ id: categoryName, label: categoryName, options: values.sort((a, b) => a.name.localeCompare(b.name)).map((value) => ({ id: value.id, label: value.name, detail: value.internalCode ?? undefined })) })); }, [options?.items]);
  const calculation = useMemo(() => calculateLoad(draft, conversion, options?.companySettings.vatRatePercent ?? 0), [conversion, draft, options?.companySettings.vatRatePercent]);
  useEffect(() => { if (!loaded) return; if (reducedMotion) { calculationMotion.setValue(1); return; } calculationMotion.setValue(.96); const animation = Animated.spring(calculationMotion, { toValue: 1, speed: 24, bounciness: 2, useNativeDriver: true }); animation.start(); return () => animation.stop(); }, [calculation.billedQuantity, calculation.finalTotalUsd, calculation.netWeightKg, calculationMotion, loaded, reducedMotion]);

  const customer = options?.customers.find((value) => value.id === draft.customerId); const item = options?.items.find((value) => value.id === draft.itemId);
  const project = options?.projects.find((value) => value.id === draft.projectId);
  const destinationComplete = Boolean(customer && (project || (!customer.isOwnCompany && draft.destinationAddress.trim()))); const directComplete = /^\d+(?:[.,]\d{1,6})?$/.test(draft.directQuantity) && Number(draft.directQuantity.replace(',', '.')) > 0 && Boolean(draft.directUnitId); const weighedComplete = /^\d+$/.test(draft.emptyWeightKg) && /^\d+$/.test(draft.fullWeightKg) && Number(draft.fullWeightKg) > Number(draft.emptyWeightKg); const loadComplete = Boolean(item && draft.driverId && draft.truckId && (draft.quantityMethod === 'direct' ? directComplete : weighedComplete)); const valueComplete = draft.quantityMethod === 'direct' || Boolean(draft.conversionId); const currentStage = !destinationComplete ? 1 : !loadComplete ? 2 : !valueComplete ? 3 : 4;
  const destinationIssues = issues.filter((issue) => /customer|project|destination/i.test(issue)); const loadIssues = issues.filter((issue) => /item|driver|truck|weight|quantity/i.test(issue)); const valueIssues = issues.filter((issue) => /conversion|price/i.test(issue)); const otherIssues = issues.filter((issue) => ![...destinationIssues, ...loadIssues, ...valueIssues].includes(issue));

  function update<K extends keyof LoadDraft>(key: K, value: LoadDraft[K]) { setDraft((current) => ({ ...current, [key]: value })); setIssues([]); }
  function selectCustomer(id: string) { animateLayout(); setDraft((current) => { const currentProject = options?.projects.find((value) => value.id === current.projectId); return { ...current, customerId: id, projectId: currentProject?.customerId === id ? current.projectId : '' }; }); setIssues([]); }
  function selectProject(id: string) { animateLayout(); const selected = options?.projects.find((value) => value.id === id); setDraft((current) => ({ ...current, projectId: id, customerId: selected?.customerId ?? current.customerId, destinationAddress: selected ? '' : current.destinationAddress })); setIssues([]); }
  function selectItem(id: string) { const selected = options?.items.find((value) => value.id === id); setDraft((current) => ({ ...current, itemId: id, directUnitId: current.directUnitId || selected?.defaultUnitId || '', unitPriceUsd: selected?.defaultPriceUsd == null ? current.unitPriceUsd : String(selected.defaultPriceUsd) })); }
  function selectDriver(id: string) { const selected = options?.drivers.find((value) => value.id === id); setDraft((current) => ({ ...current, driverId: id, driverName: selected?.name ?? '' })); }
  function selectTruck(id: string) { const selected = options?.trucks.find((value) => value.id === id); setDraft((current) => ({ ...current, truckId: id, truckPlate: selected?.plate ?? '' })); }
  function selectQuantityMethod(quantityMethod: LoadDraft['quantityMethod']) { animateLayout(); setDraft((current) => ({ ...current, quantityMethod })); setIssues([]); }

  async function doConfirm() {
    if (!options) return; const nextIssues = validateLoadDraft(draft, options); setIssues(nextIssues); if (nextIssues.length) return;
    Alert.alert('Confirm this load?', 'Confirmation assigns the permanent transaction number. The record cannot return to Draft.', [
      { text: 'Review again', style: 'cancel' },
      { text: 'Confirm load', onPress: () => { setBusy(true); setError(null); const submittedDraft = draft; void repository.confirmLoad(draft).then((record) => { setConfirmed(record); setLastConfirmedDraft(submittedDraft); setPreview(false); setDraft(emptyLoadDraft); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not confirm load.')).finally(() => setBusy(false)); } },
    ]);
  }
  async function printConfirmedReceipt(record: ConfirmedLoad) { setBusy(true); setError(null); setMessage(null); try { const printer = await printLoadBluetooth(record, 'receipt'); setMessage(`Receipt sent to ${printer.name}.`); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not print. The confirmed record is still saved.'); } finally { setBusy(false); } }
  function createAnotherItemForSameDelivery() { if (!lastConfirmedDraft) return; setIssues([]); setError(null); setMessage(null); setDraft(createAnotherItemDraft(lastConfirmedDraft)); setConfirmed(null); }
  const motion = (index: number) => { const value = entrance[index]!; return { opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }; };

  if (setupStatus === 'error') return <ErrorView message={setupError} onBack={onBack} onRetry={loadSetup} />;
  if (!options) return <LoadingView onBack={onBack} />;
  if (confirmed) return <ConfirmedView record={confirmed} busy={busy} error={error} message={message} canRepeatDelivery={Boolean(lastConfirmedDraft)} onBack={onBack} onPrint={() => void printConfirmedReceipt(confirmed)} onCreateAnotherItem={createAnotherItemForSameDelivery} onStartAnotherLoad={() => { setConfirmed(null); setMessage(null); setError(null); }} />;
  if (preview) return <PreviewView options={options} draft={draft} calculation={calculation} issues={issues} busy={busy} onBack={() => setPreview(false)} onConfirm={() => void doConfirm()} />;

  return (
    <View style={styles.screen}>
      <Animated.ScrollView style={styles.screen} contentContainerStyle={[styles.content, styles.contentWithFooter]} keyboardShouldPersistTaps="handled">
        <Animated.View style={motion(0)}>
          <PageHeader eyebrow="NEW OUTGOING LOAD" title="Make Receipt" onBack={onBack} />
          <View style={styles.workflowHero}>
            <View style={styles.workflowTop}>
              <View style={styles.flex}><Text style={styles.workflowKicker}>ONE ENTRY · TWO DOCUMENTS</Text><Text style={styles.workflowTitle}>Build the load record</Text></View>
              <TouchableOpacity style={styles.autosaveBadge} disabled={saveStatus !== 'error'} onPress={retryAutosave} accessibilityRole="button" accessibilityState={{ disabled: saveStatus !== 'error' }} accessibilityLabel={saveStatus === 'saving' ? 'Saving draft' : saveStatus === 'saved' ? 'Draft saved' : saveStatus === 'error' ? 'Draft not saved. Double tap to retry.' : 'Autosave is on'} hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}>
                <View style={[styles.autosaveDot, saveStatus === 'saving' && styles.autosaveDotBusy, saveStatus === 'error' && styles.autosaveDotError]} />
                <Text style={styles.autosave}>{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : saveStatus === 'error' ? "Couldn't save · Retry" : 'Autosave on'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.progressTrack}>
              <ProgressMarker number={1} done={destinationComplete} current={currentStage === 1} />
              <View style={[styles.progressLine, destinationComplete && styles.progressLineDone]} />
              <ProgressMarker number={2} done={loadComplete} current={currentStage === 2} />
              <View style={[styles.progressLine, loadComplete && styles.progressLineDone]} />
              <ProgressMarker number={3} done={valueComplete} current={currentStage === 3} />
              <View style={[styles.progressLine, currentStage === 4 && styles.progressLineDone]} />
              <ProgressMarker number={4} done={false} current={currentStage === 4} />
            </View>
            <View style={styles.progressLabels}>
              <Text style={[styles.progressLabel, destinationComplete && styles.progressLabelDone]}>Destination</Text>
              <Text style={[styles.progressLabel, loadComplete && styles.progressLabelDone]}>Load</Text>
              <Text style={[styles.progressLabel, valueComplete && styles.progressLabelDone]}>Price</Text>
              <Text style={[styles.progressLabel, currentStage === 4 && styles.progressLabelCurrent]}>Review</Text>
            </View>
          </View>
        </Animated.View>

        {error ? <Feedback kind="error">{error}</Feedback> : null}
        {(!options.customers.length || !options.items.length || !options.units.length || (draft.quantityMethod === 'weighbridge' && !options.conversions.length) || !options.drivers.length || !options.trucks.length) ? (
          <View style={styles.warning}>
            <Text style={styles.warningEyebrow}>ACTION NEEDED</Text>
            <Text style={styles.warningTitle}>Setup required</Text>
            <Text style={styles.helper}>Create a customer, load-enabled item, saved driver, and saved truck. Units and the kg-to-ton conversion are already seeded.</Text>
            <TouchableOpacity onPress={onOpenDirectory} accessibilityRole="button" accessibilityLabel="Open Drivers and Trucks setup" hitSlop={{ top: 14, bottom: 14, left: 10, right: 10 }}><Text style={styles.link}>Open Drivers & Trucks</Text></TouchableOpacity>
          </View>
        ) : null}

        <Animated.View style={motion(1)}>
          <ReceiptSection number="01" title="Customer and destination" hint="Connect this load to the correct customer and place.">
            <DatePickerField label="Record date *" value={draft.recordDate} onChange={(value) => update('recordDate', value)} minDate={project?.startDate ?? undefined} maxDate={project?.endDate ?? todayIso()} />
            <SearchableSelect label="Project" options={options.projects.map((value) => ({ id: value.id, label: value.name, detail: `${value.customerName} · ${value.location}` }))} selectedId={draft.projectId} onSelect={selectProject} allowClear placeholder={options.projects.length ? 'Search and select a project' : 'Create a project first'} />
            <Text style={styles.helper}>Selecting a project automatically selects its customer and links the confirmed load to that project's daily report.</Text>
            <SearchableSelect label="Customer *" options={options.customers.map((value) => ({ id: value.id, label: value.name, detail: value.isOwnCompany ? 'Own company' : value.type }))} selectedId={draft.customerId} onSelect={selectCustomer} />
            {customer ? <Text style={styles.helper}>{customer.isOwnCompany ? 'Own company: a saved project is required.' : 'Outside customer: select a project or enter a destination.'}</Text> : null}
            {!project && customer && !customer.isOwnCompany ? <AppField label="Destination address *" value={draft.destinationAddress} onChangeText={(value) => update('destinationAddress', value)} multiline /> : null}
            <IssueList issues={destinationIssues} />
          </ReceiptSection>
        </Animated.View>

        <Animated.View style={motion(2)}>
          <ReceiptSection number="02" title="Load information" hint="Choose weighed or direct quantity, then record what moved and who carried it.">
            <Text style={styles.methodLabel}>QUANTITY METHOD</Text>
            <View style={styles.methodSelector}>
              <MethodChoice title="Weighbridge" hint="Empty and full kg" selected={draft.quantityMethod === 'weighbridge'} onPress={() => selectQuantityMethod('weighbridge')} />
              <MethodChoice title="Direct quantity" hint="Pieces, metres, bundles…" selected={draft.quantityMethod === 'direct'} onPress={() => selectQuantityMethod('direct')} />
            </View>
            <GroupedSearchableSelect label="Load-enabled item *" groups={itemGroups} selectedId={draft.itemId} onSelect={selectItem} placeholder="Choose category, then item" />
            <SearchableSelect label="Driver *" options={options.drivers.map((value) => ({ id: value.id, label: value.name, detail: [value.phone, value.licenseNumber ? `Licence ${value.licenseNumber}` : null].filter(Boolean).join(' · ') }))} selectedId={draft.driverId} onSelect={selectDriver} />
            <SearchableSelect label="Truck *" options={options.trucks.map((value) => ({ id: value.id, label: value.plate, detail: [value.makeModel, value.ownerName].filter(Boolean).join(' · ') }))} selectedId={draft.truckId} onSelect={selectTruck} />
            {draft.quantityMethod === 'weighbridge' ? (
              <>
                <AppField label="Requested quantity (kg, optional)" value={draft.requestedQuantityKg} onChangeText={(value) => update('requestedQuantityKg', value)} keyboardType="number-pad" />
                <View style={styles.columns}><View style={styles.column}><AppField label="Empty weight kg *" value={draft.emptyWeightKg} onChangeText={(value) => update('emptyWeightKg', value)} keyboardType="number-pad" /></View><View style={styles.column}><AppField label="Full weight kg *" value={draft.fullWeightKg} onChangeText={(value) => update('fullWeightKg', value)} keyboardType="number-pad" /></View></View>
                <Animated.View style={{ transform: [{ scale: calculationMotion }] }}><View style={styles.metricRow}><MetricCard label="Calculated net weight" value={calculation.netWeightKg == null ? '—' : `${calculation.netWeightKg} kg`} result /></View></Animated.View>
              </>
            ) : (
              <>
                <AppField label="Quantity *" value={draft.directQuantity} onChangeText={(value) => update('directQuantity', value)} keyboardType="decimal-pad" />
                <SearchableSelect label="Unit *" options={options.units.map((value) => ({ id: value.id, label: value.name, detail: value.symbol }))} selectedId={draft.directUnitId} onSelect={(id) => update('directUnitId', id)} placeholder="Piece, metre, bundle, or another unit" />
                <Animated.View style={{ transform: [{ scale: calculationMotion }] }}><View style={styles.metricRow}><MetricCard label="Receipt quantity" value={calculation.billedQuantity == null ? '—' : `${calculation.billedQuantity} ${directUnit?.symbol ?? ''}`} result /></View></Animated.View>
              </>
            )}
            <IssueList issues={loadIssues} />
          </ReceiptSection>
        </Animated.View>

        <Animated.View style={motion(3)}>
          <ReceiptSection number="03" title={draft.quantityMethod === 'direct' ? 'Unit price' : 'Conversion and price'} hint={draft.quantityMethod === 'direct' ? 'Calculate the optional price from the entered unit quantity.' : 'Convert the verified weight and calculate the optional sale value.'}>
            {draft.quantityMethod === 'weighbridge' ? (
              <>
                <SearchableSelect label="Conversion *" options={options.conversions.map((value) => ({ id: value.id, label: value.name, detail: `${value.inputQuantity} ${value.inputUnitSymbol} = ${value.outputQuantity} ${value.outputUnitSymbol}` }))} selectedId={draft.conversionId} onSelect={(id) => update('conversionId', id)} />
                {conversion ? <Text style={styles.helper}>{conversion.inputQuantity} {conversion.inputUnitSymbol} = {conversion.outputQuantity} {conversion.outputUnitSymbol} · result: {calculation.billedQuantity == null ? '—' : calculation.billedQuantity.toFixed(conversion.decimalPlaces)} {conversion.outputUnitSymbol}</Text> : null}
              </>
            ) : <Text style={styles.directSummary}>{calculation.billedQuantity ?? '—'} {directUnit?.symbol ?? ''} · entered directly, no scale conversion</Text>}
            <AppField label={`Price per ${draft.quantityMethod === 'direct' ? (directUnit?.symbol || 'unit') : 'converted unit'} USD (optional)`} value={draft.unitPriceUsd} onChangeText={(value) => update('unitPriceUsd', value)} keyboardType="decimal-pad" />
            <Animated.View style={{ transform: [{ scale: calculationMotion }] }}>
              <View style={styles.metricRow}>
                <MetricCard label="Subtotal" value={formatUsd(calculation.subtotalUsd)} />
                <MetricCard label={`VAT ${options.companySettings.vatRatePercent}%`} value={formatUsd(calculation.vatAmountUsd)} />
                <MetricCard label="Final total" value={formatUsd(calculation.finalTotalUsd)} accent />
              </View>
            </Animated.View>
            <AppField label="Notes" value={draft.notes} onChangeText={(value) => update('notes', value)} multiline />
            <IssueList issues={valueIssues} />
          </ReceiptSection>
        </Animated.View>

        <IssueList issues={otherIssues} />

        <AppCard title="Ready to check the documents?" hint="The main Preview action stays within thumb reach below. Preview both layouts before the permanent transaction number is assigned.">
          <View style={styles.manageActions}><View style={styles.manageAction}><AppButton label="Manage Projects" tone="secondary" onPress={onOpenProjects} /></View><View style={styles.manageAction}><AppButton label="Units & Conversions" tone="secondary" onPress={onOpenSetup} /></View></View>
        </AppCard>
      </Animated.ScrollView>
      <View style={styles.stickyAction}>
        <View style={styles.stickyCopy}><Text style={styles.stickyStep}>STEP {currentStage} OF 4</Text><Text style={styles.stickyHint}>{currentStage === 1 ? 'Complete customer and destination' : currentStage === 2 ? `Complete ${draft.quantityMethod === 'direct' ? 'direct quantity' : 'load and weighing'}` : currentStage === 3 ? 'Choose conversion and value' : 'Ready for document review'}</Text></View>
        <View style={styles.stickyButton}><AppButton label="Preview Documents" onPress={() => { const next = validateLoadDraft(draft, options); setIssues(next); setPreview(true); }} /></View>
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

function ConfirmedView({ record, busy, error, message, canRepeatDelivery, onBack, onPrint, onCreateAnotherItem, onStartAnotherLoad }: { record: ConfirmedLoad; busy: boolean; error: string | null; message: string | null; canRepeatDelivery: boolean; onBack: () => void; onPrint: () => void; onCreateAnotherItem: () => void; onStartAnotherLoad: () => void }) {
  return (
    <Animated.ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <PageHeader eyebrow="LOAD WORKFLOW" title="Load confirmed" onBack={onBack} />
      <View style={styles.confirmedHero}>
        <Text style={styles.confirmedKicker}>CONFIRMED OFFLINE</Text>
        <Text style={styles.confirmedNumber}>{record.transactionNumber}</Text>
        <Text style={styles.confirmedHint}>The permanent record is saved even if printing fails. Print the Receipt now; add the driver's signature in Load History before printing the Delivery Authorization.</Text>
      </View>
      {error ? <Feedback kind="error">{error}</Feedback> : null}
      {message ? <Feedback kind="success">{message}</Feedback> : null}
      <LoadDocuments data={confirmedDocument(record)} isDraft={false} />
      <AppButton label="Bluetooth Print Receipt" busy={busy} onPress={onPrint} />
      {canRepeatDelivery ? (
        <View style={styles.repeatCard}>
          <Text style={styles.repeatTitle}>Same truck, another item?</Text>
          <Text style={styles.helper}>Starts a fresh draft for the same customer, project, destination, driver, and truck. Item, quantity, weights, price, and notes all start empty — nothing from this load's weights or totals carries over.</Text>
          <AppButton label="Create Another Item for Same Delivery" tone="secondary" onPress={onCreateAnotherItem} />
        </View>
      ) : null}
      <AppButton label="Start Another Load" tone="secondary" onPress={onStartAnotherLoad} />
    </Animated.ScrollView>
  );
}

function PreviewView({ options, draft, calculation, issues, busy, onBack, onConfirm }: { options: LoadSetupOptions; draft: LoadDraft; calculation: ReturnType<typeof calculateLoad>; issues: string[]; busy: boolean; onBack: () => void; onConfirm: () => void }) {
  return (
    <Animated.ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <PageHeader eyebrow="FINAL REVIEW" title="Confirm this load" onBack={onBack} />
      <FinalReviewSummary options={options} draft={draft} calculation={calculation} />
      <LoadDocuments data={draftDocument(options, draft, calculation)} isDraft />
      <IssueList issues={issues} />
      <AppButton label="Confirm This Load" busy={busy} onPress={onConfirm} />
      <AppButton label="Return to Entry" tone="secondary" onPress={onBack} />
    </Animated.ScrollView>
  );
}

function FinalReviewSummary({ options, draft, calculation }: { options: LoadSetupOptions; draft: LoadDraft; calculation: ReturnType<typeof calculateLoad> }) {
  const customer = options.customers.find((value) => value.id === draft.customerId);
  const project = options.projects.find((value) => value.id === draft.projectId);
  const item = options.items.find((value) => value.id === draft.itemId);
  const unit = options.units.find((value) => value.id === draft.directUnitId);
  const conversion = options.conversions.find((value) => value.id === draft.conversionId);
  const quantitySymbol = draft.quantityMethod === 'direct' ? (unit?.symbol ?? '') : (conversion?.outputUnitSymbol ?? '');
  return (
    <AppCard title="Everything correct?" hint="Confirming assigns the permanent transaction number. The record cannot return to Draft.">
      <SummaryRow label="Customer" value={customer?.name ?? '—'} />
      <SummaryRow label="Project / destination" value={project?.name ?? (draft.destinationAddress.trim() || '—')} />
      <SummaryRow label="Item" value={item?.name ?? '—'} />
      <SummaryRow label="Driver / truck" value={`${draft.driverName || '—'} · ${draft.truckPlate || '—'}`} />
      <SummaryRow label="Quantity" value={calculation.billedQuantity == null ? '—' : `${calculation.billedQuantity} ${quantitySymbol}`} />
      <SummaryRow label="Price" value={draft.unitPriceUsd.trim() ? formatUsd(calculation.finalTotalUsd) : 'Unpriced'} strong />
    </AppCard>
  );
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <View style={styles.summaryRow}><Text style={styles.summaryLabel}>{label}</Text><Text style={[styles.summaryValue, strong && styles.summaryValueStrong]}>{value}</Text></View>; }
function ReceiptSection({ number, title, hint, children }: { number: string; title: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={styles.receiptSection}>
      <View style={styles.sectionHeader}><View style={styles.sectionNumber}><Text style={styles.sectionNumberText}>{number}</Text></View><View style={styles.flex}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionHint}>{hint}</Text></View></View>
      <AppCard>{children}</AppCard>
    </View>
  );
}
function ProgressMarker({ number, done, current }: { number: number; done: boolean; current: boolean }) { return <View style={[styles.progressStep, current && styles.progressStepActive, done && styles.progressStepDone]}><Text style={[styles.progressNumber, (current || done) && styles.progressNumberActive]}>{done ? '✓' : number}</Text></View>; }
function MethodChoice({ title, hint, selected, onPress }: { title: string; hint: string; selected: boolean; onPress: () => void }) { return <TouchableOpacity activeOpacity={.72} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${title}. ${hint}`} style={[styles.methodChoice, selected && styles.methodChoiceSelected]}><Text style={[styles.methodTitle, selected && styles.methodTitleSelected]}>{title}</Text><Text style={[styles.methodHint, selected && styles.methodHintSelected]}>{hint}</Text></TouchableOpacity>; }
function IssueList({ issues }: { issues: string[] }) { if (!issues.length) return null; return <Feedback kind="error">{issues.map((issue) => `• ${issue}`).join('\n')}</Feedback>; }

function draftDocument(options: LoadSetupOptions, draft: LoadDraft, calculation: ReturnType<typeof calculateLoad>): DocumentViewData { const customer = options.customers.find((v) => v.id === draft.customerId); const project = options.projects.find((v) => v.id === draft.projectId); const item = options.items.find((v) => v.id === draft.itemId); const conversion = options.conversions.find((v) => v.id === draft.conversionId); const unit = options.units.find(v => v.id === draft.directUnitId); const direct = draft.quantityMethod === 'direct'; return { quantityMethod: draft.quantityMethod, companyName: options.companySettings.companyName, companyAddress: options.companySettings.address, companyPhone: options.companySettings.phone, companyEmail: options.companySettings.email, companyTaxVatNumber: options.companySettings.taxVatNumber, companyReceiptFooter: options.companySettings.receiptFooter, transactionNumber: '', dateTime: new Date(`${draft.recordDate}T12:00:00`).toISOString(), customerName: customer?.name ?? '', projectName: project?.name ?? null, destinationAddress: project?.location ?? (draft.destinationAddress.trim() || null), itemName: item?.name ?? '', driverName: draft.driverName.trim(), truckPlate: draft.truckPlate.trim(), requestedQuantityKg: !direct && draft.requestedQuantityKg ? Number(draft.requestedQuantityKg) : null, emptyWeightKg: !direct && draft.emptyWeightKg ? Number(draft.emptyWeightKg) : null, fullWeightKg: !direct && draft.fullWeightKg ? Number(draft.fullWeightKg) : null, netWeightKg: calculation.netWeightKg, convertedQuantity: calculation.billedQuantity, outputUnitSymbol: direct ? (unit?.symbol ?? null) : (conversion?.outputUnitSymbol ?? null), unitPriceUsd: draft.unitPriceUsd.trim() ? Number(draft.unitPriceUsd.replace(',', '.')) : null, subtotalUsd: calculation.subtotalUsd, vatRatePercent: draft.unitPriceUsd.trim() ? options.companySettings.vatRatePercent : null, vatAmountUsd: calculation.vatAmountUsd, finalTotalUsd: calculation.finalTotalUsd, signaturePaths: [] }; }
export function confirmedDocument(record: ConfirmedLoad): DocumentViewData { return { quantityMethod: record.quantityMethod, companyName: record.companyName, companyAddress: record.companyAddress, companyPhone: record.companyPhone, companyEmail: record.companyEmail, companyTaxVatNumber: record.companyTaxVatNumber, companyReceiptFooter: record.companyReceiptFooter, transactionNumber: record.transactionNumber, dateTime: record.confirmedAt, customerName: record.customerName, projectName: record.projectName, destinationAddress: record.projectLocation ?? record.destinationAddress, itemName: record.itemName, driverName: record.driverName, truckPlate: record.truckPlate, requestedQuantityKg: record.requestedQuantityKg, emptyWeightKg: record.emptyWeightKg, fullWeightKg: record.fullWeightKg, netWeightKg: record.netWeightKg, convertedQuantity: record.billedQuantity, outputUnitSymbol: record.outputUnitSymbol, unitPriceUsd: record.unitPriceUsd, subtotalUsd: record.subtotalUsd, vatRatePercent: record.vatRatePercent, vatAmountUsd: record.vatAmountUsd, finalTotalUsd: record.finalTotalUsd, signaturePaths: record.signaturePaths }; }

const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: 20, paddingBottom: 42, gap: 16 }, contentWithFooter: { paddingBottom: 125 }, flex: { flex: 1, minWidth: 0 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 60 }, loadingMark: { width: 46, height: 46, borderRadius: 23, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', backgroundColor: colors.navy, color: '#FFF', fontSize: 24, fontWeight: '900' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  errorState: { backgroundColor: '#FCE8E6', borderRadius: 16, padding: 20, gap: 12, borderLeftWidth: 4, borderLeftColor: colors.danger, marginTop: 16 }, errorStateTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, errorStateText: { color: colors.danger, fontSize: 13, lineHeight: 19, fontWeight: '700' }, retryButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink, borderRadius: 11, paddingHorizontal: 16 }, retryButtonText: { color: '#FFF', fontWeight: '900', fontSize: 15 },
  workflowHero: { marginTop: 16, backgroundColor: colors.navy, borderRadius: 18, padding: 17, gap: 16, overflow: 'hidden' }, workflowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, workflowKicker: { color: '#F2A184', fontSize: 11, fontWeight: '900', letterSpacing: 1 }, workflowTitle: { color: colors.cream, fontSize: 20, fontWeight: '900', marginTop: 3 }, autosaveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#245274', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 7, maxWidth: 150 }, autosaveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#75C99A' }, autosaveDotBusy: { backgroundColor: '#F2A184' }, autosaveDotError: { backgroundColor: colors.warning }, autosave: { color: '#E7F5ED', fontSize: 11, fontWeight: '800', flexShrink: 1 },
  progressTrack: { flexDirection: 'row', alignItems: 'center' }, progressStep: { width: 27, height: 27, borderRadius: 14, borderWidth: 1, borderColor: '#7390A7', alignItems: 'center', justifyContent: 'center' }, progressStepActive: { backgroundColor: colors.brand, borderColor: colors.brand }, progressStepDone: { backgroundColor: colors.success, borderColor: colors.success }, progressNumber: { color: '#BCD0DF', fontSize: 11, fontWeight: '900' }, progressNumberActive: { color: '#FFF', fontSize: 11, fontWeight: '900' }, progressLine: { flex: 1, height: 2, backgroundColor: '#547792' }, progressLineDone: { backgroundColor: colors.success }, progressLabels: { flexDirection: 'row', justifyContent: 'space-between' }, progressLabel: { color: '#BCD0DF', fontSize: 11, fontWeight: '700', width: '24%', textAlign: 'center' }, progressLabelDone: { color: '#75C99A' }, progressLabelCurrent: { color: '#F2A184' },
  warning: { backgroundColor: '#FFF3D8', borderWidth: 1, borderColor: '#E3C681', padding: 15, borderRadius: 14, gap: 5 }, warningEyebrow: { color: colors.warning, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, warningTitle: { color: colors.ink, fontSize: 17, fontWeight: '900' }, link: { alignSelf: 'flex-start', color: colors.brandDark, fontWeight: '900', marginTop: 5, borderBottomWidth: 1, borderBottomColor: colors.brandDark, paddingBottom: 2 },
  receiptSection: { gap: 10 }, sectionHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, sectionNumber: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center' }, sectionNumberText: { color: '#FFF', fontSize: 12, fontWeight: '900' }, sectionTitle: { color: colors.ink, fontSize: 18, fontWeight: '900' }, sectionHint: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  methodLabel: { color: colors.navy, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, methodSelector: { flexDirection: 'row', gap: 8 }, methodChoice: { flex: 1, minHeight: 70, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 11, justifyContent: 'center', backgroundColor: colors.surface }, methodChoiceSelected: { backgroundColor: colors.navy, borderColor: colors.navy }, methodTitle: { color: colors.ink, fontWeight: '900', fontSize: 13 }, methodTitleSelected: { color: '#FFF' }, methodHint: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 3 }, methodHintSelected: { color: '#D8E4ED' }, directSummary: { backgroundColor: colors.resultSoft, borderWidth: 1, borderColor: colors.result, borderRadius: 11, padding: 12, color: colors.resultDark, fontWeight: '900' },
  columns: { flexDirection: 'row', gap: 10 }, column: { flex: 1 }, metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  repeatCard: { backgroundColor: colors.creamSoft, borderWidth: 1, borderColor: '#E8DED0', borderRadius: 16, padding: 16, gap: 10 }, repeatTitle: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  manageActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, manageAction: { flex: 1, minWidth: 145 },
  stickyAction: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 82, backgroundColor: '#FFFDF8', borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10, shadowColor: '#17212B', shadowOpacity: .12, shadowRadius: 8, shadowOffset: { width: 0, height: -3 }, elevation: 8 }, stickyCopy: { flex: 1, minWidth: 0 }, stickyStep: { color: colors.brand, fontSize: 11, fontWeight: '900', letterSpacing: .6 }, stickyHint: { color: colors.ink, fontSize: 12, fontWeight: '800', lineHeight: 16, marginTop: 3 }, stickyButton: { flex: 1.25 },
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 4, paddingVertical: 5 }, summaryLabel: { color: colors.muted, fontSize: 12, fontWeight: '700', flexShrink: 0 }, summaryValue: { color: colors.ink, fontSize: 13, fontWeight: '800', flexGrow: 1, flexShrink: 1, minWidth: 120, textAlign: 'right' }, summaryValueStrong: { color: colors.brandDark, fontSize: 15, fontWeight: '900' },
  confirmedHero: { backgroundColor: colors.navy, borderRadius: 18, padding: 18, gap: 4, borderBottomWidth: 4, borderBottomColor: colors.brand }, confirmedKicker: { color: '#75C99A', fontSize: 11, fontWeight: '900', letterSpacing: 1 }, confirmedNumber: { color: '#FFF', fontSize: 25, fontWeight: '900' }, confirmedHint: { color: '#D8E4ED', fontSize: 12, lineHeight: 18, marginTop: 3 },
});
