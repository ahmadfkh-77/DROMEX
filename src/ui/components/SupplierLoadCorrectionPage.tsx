import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { formatCorrectionDate, localDateOf, changedCorrectionLines, correctionLines, correctionTotals, quarryCorrectionDraft, supplierLocked, type CorrectionSheet } from '../../domain/supplierCorrection';
import { validateQuarryPurchase, type QuarryCorrectionDraft, type QuarryPurchase, type QuarrySetup } from '../../domain/quarry';
import { formatKg, formatMeters, sourceAfterTyping } from '../../domain/rebar';
import { piecesText } from '../../domain/supplierSteel';
import { AppField, PageHeader } from './AppPrimitives';
import { DatePickerField, todayIso } from './DatePickerField';
import { GroupedSearchableSelect } from './GroupedSearchableSelect';
import { OpenSwitch } from './OpenSwitch';
import { SearchableSelect } from './SearchableSelect';
import { SteelItemFields } from './SteelItemFields';
import { colors } from '../theme';

type Group = { id: string; label: string; options: { id: string; label: string; detail?: string }[] };
type Section = 'documents' | 'steel' | 'note' | 'history' | null;

/** The sheet a validation message belongs to, so a sheet shows only its own problems. The date check comes first: it mentions the project. */
const sheetRules: [CorrectionSheet, RegExp][] = [
  ['date', /record date/i], ['supplier', /select a supplier/i], ['item', /select an item/i],
  ['quantity', /measurement unit|quantity|pieces|greater than zero, or left blank|weight source/i], ['delivery', /driver|truck/i], ['price', /price|vat/i], ['place', /project|company site|destination/i],
];
export const issueSheet = (issue: string): CorrectionSheet | null => sheetRules.find(([, rule]) => rule.test(issue))?.[0] ?? null;

const money = (value: number) => `$${value.toFixed(2)}`;
const sheetTitles: Record<CorrectionSheet, string> = { date: 'Date', supplier: 'Supplier', place: 'Delivered to', item: 'Item', quantity: 'Quantity', delivery: 'Delivery', ticket: 'Ticket / invoice', price: 'Price', notes: 'Notes' };

/**
 * DEC-525. The Supplier Load correction page: a list of the load where each line is corrected in its own small sheet, changed lines
 * show the old value crossed out beside the new one, and one short review asks for the reason. It edits the same correction form
 * the screen always used and saves through the same repository call, so every rule, audit entry and payment lock is unchanged.
 */
export function SupplierLoadCorrectionPage(props: {
  selected: QuarryPurchase; correction: QuarryCorrectionDraft; setCorrection: (next: QuarryCorrectionDraft) => void; setup: QuarrySetup; itemGroups: Group[];
  groupMates: QuarryPurchase[]; isSteel: boolean; steelDensity: number; busy: boolean; error: string | null; message: string | null;
  documentsPanel: ReactNode; priceControls: ReactNode; destinationFields: ReactNode;
  onBack: () => void; onSave: () => Promise<boolean>; onReactivate: () => Promise<boolean>; onCancel: (reason: string) => void;
}) {
  const { selected, correction, setCorrection, setup, itemGroups, groupMates, isSteel, steelDensity, busy, error, message, documentsPanel, priceControls, destinationFields, onBack, onSave, onReactivate, onCancel } = props;
  const [sheet, setSheet] = useState<CorrectionSheet | 'review' | null>(null);
  const [snapshot, setSnapshot] = useState<QuarryCorrectionDraft | null>(null);
  const [section, setSection] = useState<Section>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelled = selected.status === 'Cancelled';
  useEffect(() => { if (cancelled) { setShowCancel(false); setCancelReason(''); } }, [cancelled]);

  const base = useMemo(() => quarryCorrectionDraft(selected), [selected]);
  const lines = correctionLines(correction, setup);
  const changes = changedCorrectionLines(base, correction, setup);
  const totals = correctionTotals(correction, setup), baseTotals = correctionTotals(base, setup);
  const locked = supplierLocked(selected);
  const issues = validateQuarryPurchase({ ...correction, photos: [] }, setup);
  const project = setup.projects.find((value) => value.id === correction.projectId);
  const changeCount = changes.length;
  const barLabel = changeCount ? `${changeCount} CHANGE${changeCount === 1 ? '' : 'S'}` : 'TOTAL';
  const totalText = totals.total == null ? 'Unpriced' : money(totals.total);

  function openSheet(next: CorrectionSheet) { setSnapshot(correction); setSheetError(null); setProblems([]); setSheet(next); }
  function discardSheet() { if (snapshot) setCorrection(snapshot); setSheet(null); }
  function review() {
    if (issues.length) { setProblems(issues); return; }
    setProblems([]); setSheetError(null); setSheet('review');
  }
  function leave() {
    if (!changeCount) { onBack(); return; }
    Alert.alert('Leave without saving?', 'Your changes on this page will be lost.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: onBack }]);
  }
  async function save() {
    if (!correction.correctionReason.trim()) { setSheetError(cancelled ? 'Enter the reason for reactivating this load.' : 'Enter the reason for this correction.'); return; }
    setSheetError(null);
    const saved = cancelled ? await onReactivate() : await onSave();
    if (saved) { setSheet(null); setSection(null); }
  }
  function askCancel() {
    if (!cancelReason.trim()) { setProblems(['Enter a cancellation reason first.']); return; }
    setProblems([]); onCancel(cancelReason);
  }
  const toggle = (next: Exclude<Section, null>) => setSection(section === next ? null : next);
  const set = (patch: Partial<QuarryCorrectionDraft>) => setCorrection({ ...correction, ...patch });
  const sheetIssues = sheet && sheet !== 'review' ? issues.filter((issue) => issueSheet(issue) === sheet) : [];

  if (showCancel && !cancelled) {
    return (
      <View style={styles.root}>
        <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <PageHeader eyebrow={`SUPPLIER LOAD ${selected.purchaseNumber}`} title="Cancel this load" onBack={() => { setShowCancel(false); setProblems([]); }} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {problems.length ? <Text style={styles.error}>{problems.map((problem) => `• ${problem}`).join('\n')}</Text> : null}
          <Text style={styles.warn}>Cancelling is audited. It is blocked until every active payment linked to this load is cancelled. The record stays in history and is left out of quantities, VAT, balances and reports. A cancelled load can later be corrected and reactivated.</Text>
          <View style={styles.ruled}>
            <View style={styles.ruledRow}><Text style={styles.ruledLabel}>Supplier</Text><Text style={styles.ruledValue}>{selected.supplierName}</Text></View>
            <View style={styles.ruledRow}><Text style={styles.ruledLabel}>Item</Text><Text style={styles.ruledValue}>{lines.find((line) => line.key === 'quantity')?.value} · {selected.itemName}</Text></View>
            <View style={[styles.ruledRow, styles.ruledTotal]}><Text style={styles.ruledTotalLabel}>Total</Text><Text style={styles.ruledTotalValue}>{baseTotals.total == null ? 'Unpriced' : money(baseTotals.total)}</Text></View>
          </View>
          <View style={styles.group}><Text style={styles.groupLabel}>WHY?</Text><AppField variant="open" label="Cancellation reason *" value={cancelReason} onChangeText={setCancelReason} multiline /></View>
        </ScrollView>
        <View style={styles.bar}>
          <View style={styles.flex}><Text style={styles.barLabel}>TOTAL</Text><Text style={styles.barValue}>{baseTotals.total == null ? 'Unpriced' : money(baseTotals.total)}</Text></View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.barBack} onPress={() => { setShowCancel(false); setProblems([]); }} accessibilityRole="button"><Text style={styles.barBackText}>Keep load</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.barNext, styles.barDanger]} disabled={busy} onPress={askCancel} accessibilityRole="button"><Text style={styles.barNextText}>Cancel load</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  const when = new Date(selected.confirmedAt);
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const history = selected.correctionHistory;

  return (
    <View style={styles.root}>
      <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PageHeader eyebrow="SUPPLIER LOAD" title={selected.purchaseNumber} onBack={leave} />
        <View style={styles.statusRow}>
          <Text style={[styles.chip, cancelled && styles.chipCancelled]}>{cancelled ? 'CANCELLED' : 'ACTIVE'}</Text>
          <Text style={styles.statusText}>{formatCorrectionDate(localDateOf(selected.confirmedAt))} · {time}</Text>
        </View>
        {error && sheet !== 'review' ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
        {problems.length ? <Text style={styles.error}>{problems.map((problem) => `• ${problem}`).join('\n')}</Text> : null}
        {cancelled ? <Text style={styles.cancelledBox}>Cancelled {selected.cancelledAt ? new Date(selected.cancelledAt).toLocaleString() : ''}{'\n'}Reason: {selected.cancellationReason}</Text> : null}
        <Text style={styles.help}>{cancelled ? 'Correct what is wrong, then reactivate. A reason is saved with the original and new values.' : 'Tap Edit on a line to correct it. The load number and the time of day never change.'}</Text>
        {locked ? <Text style={styles.warn}>The supplier cannot be changed while this load has an active payment. Cancel the payment in Payments first, then come back. Everything else can still be corrected.</Text> : null}

        <View style={styles.ruled}>
          {lines.map((line) => {
            const changed = changes.find((value) => value.key === line.key);
            const shows = changed && changed.was !== changed.now;
            const lockedLine = line.key === 'supplier' && locked;
            return (
              <TouchableOpacity key={line.key} style={styles.ruledRow} disabled={lockedLine} onPress={() => openSheet(line.sheet)} accessibilityRole="button" accessibilityLabel={`${line.label}: ${line.value}. ${lockedLine ? 'Locked' : 'Edit'}`}>
                <Text style={styles.ruledLabel}>{line.label}</Text>
                <Text style={[styles.ruledValue, changed && styles.ruledChanged]}>
                  {shows ? <Text style={styles.was}>{changed.was}  </Text> : null}{line.value}
                  <Text style={lockedLine ? styles.locked : styles.edit}>{lockedLine ? '  Locked' : '  Edit'}</Text>
                </Text>
              </TouchableOpacity>
            );
          })}
          {totals.vatAmount != null && (totals.vatRatePercent ?? 0) > 0 ? (
            <View style={styles.ruledRow}><Text style={styles.ruledLabel}>VAT ({totals.vatRatePercent}%)</Text><Text style={styles.ruledValue}>{money(totals.vatAmount)}</Text></View>
          ) : null}
          <View style={[styles.ruledRow, styles.ruledTotal]}>
            <Text style={styles.ruledTotalLabel}>Total</Text>
            <Text style={styles.ruledTotalValue}>
              {baseTotals.total !== totals.total ? <Text style={styles.totalWas}>{baseTotals.total == null ? 'Unpriced' : money(baseTotals.total)}  </Text> : null}{totalText}
            </Text>
          </View>
        </View>

        {documentsPanel ? <TouchableOpacity style={styles.section} onPress={() => toggle('documents')} accessibilityRole="button" accessibilityState={{ expanded: section === 'documents' }}><View style={styles.flex}><Text style={styles.sectionTitle}>Documents</Text><Text style={styles.sectionSub}>Ticket photos and files</Text></View><Text style={styles.chevron}>{section === 'documents' ? '⌃' : '⌄'}</Text></TouchableOpacity> : null}
        {section === 'documents' ? documentsPanel : null}

        {selected.pieces || selected.lengthPerBarM || selected.calculatedWeightKg != null ? <>
          <TouchableOpacity style={styles.section} onPress={() => toggle('steel')} accessibilityRole="button" accessibilityState={{ expanded: section === 'steel' }}><View style={styles.flex}><Text style={styles.sectionTitle}>Steel details</Text><Text style={styles.sectionSub}>Pieces, bar length and where the weight came from</Text></View><Text style={styles.chevron}>{section === 'steel' ? '⌃' : '⌄'}</Text></TouchableOpacity>
          {section === 'steel' ? <View style={styles.sectionBody}>
            <View style={styles.plainRow}><Text style={styles.sectionSub}>Pieces</Text><Text style={styles.sectionSub}>{selected.pieces ? piecesText(selected.pieces) : 'Not recorded'}</Text></View>
            <View style={styles.plainRow}><Text style={styles.sectionSub}>Diameter · length per bar</Text><Text style={styles.sectionSub}>{selected.diameterMm ? `${formatMeters(selected.diameterMm)} mm` : 'Not recorded'} · {selected.lengthPerBarM ? `${formatMeters(selected.lengthPerBarM)} m` : 'Not recorded'}</Text></View>
            <View style={styles.plainRow}><Text style={styles.sectionSub}>Total meters</Text><Text style={styles.sectionSub}>{selected.pieces && selected.lengthPerBarM ? `${formatMeters(selected.pieces * selected.lengthPerBarM)} m` : 'Not recorded'}</Text></View>
            <View style={styles.plainRow}><Text style={styles.sectionSub}>Calculated weight</Text><Text style={styles.sectionSub}>{selected.calculatedWeightKg != null ? `${formatKg(selected.calculatedWeightKg)} kg` : 'Typed only'}</Text></View>
            <View style={styles.plainRow}><Text style={styles.sectionSub}>Weight used ({selected.weightSource === 'calculated' ? 'calculated' : 'typed'})</Text><Text style={[styles.sectionSub, styles.strong]}>{formatKg(selected.quantityCubicMetres)} {selected.unitSymbol}</Text></View>
          </View> : null}
        </> : null}

        {groupMates.length > 1 ? <>
          <TouchableOpacity style={styles.section} onPress={() => toggle('note')} accessibilityRole="button" accessibilityState={{ expanded: section === 'note' }}><View style={styles.flex}><Text style={styles.sectionTitle}>Same delivery note</Text><Text style={styles.sectionSub}>{groupMates.length} items recorded together</Text></View><Text style={styles.chevron}>{section === 'note' ? '⌃' : '⌄'}</Text></TouchableOpacity>
          {section === 'note' ? <View style={styles.sectionBody}>{groupMates.map((value) => <View key={value.id} style={styles.plainRow}><Text style={[styles.sectionSub, value.id === selected.id && styles.strong]}>{value.itemName} · {value.purchaseNumber}</Text><Text style={[styles.sectionSub, value.id === selected.id && styles.strong]}>{value.quantityCubicMetres} {value.unitSymbol}{value.pieces ? ` · ${piecesText(value.pieces)}` : ''}</Text></View>)}</View> : null}
        </> : null}

        <TouchableOpacity style={styles.section} onPress={() => toggle('history')} accessibilityRole="button" accessibilityState={{ expanded: section === 'history' }}><View style={styles.flex}><Text style={styles.sectionTitle}>Correction history</Text><Text style={styles.sectionSub}>{history.length ? `${history.length} correction${history.length === 1 ? '' : 's'}` : 'None yet'}</Text></View><Text style={styles.chevron}>{section === 'history' ? '⌃' : '⌄'}</Text></TouchableOpacity>
        {section === 'history' ? <View style={styles.sectionBody}>
          {history.length ? [...history].reverse().map((entry, index) => (
            <View key={`${entry.correctedAt}-${index}`} style={styles.hist}>
              <Text style={styles.histDate}>{new Date(entry.correctedAt).toLocaleString()} · {entry.correctedBy}</Text>
              <Text style={styles.histReason}>Reason: {entry.reason}</Text>
              {entry.changes.map((change) => <Text key={change.field} style={styles.histChange}>{change.field}: <Text style={styles.was}>{change.originalValue ?? 'empty'}</Text> → <Text style={styles.strong}>{change.newValue ?? 'empty'}</Text></Text>)}
            </View>
          )) : <Text style={styles.sectionSub}>No corrections have been made to this load.</Text>}
          <Text style={styles.sectionSub}>Confirmed {new Date(selected.confirmedAt).toLocaleString()} · the original record is never changed.</Text>
        </View> : null}

        {!cancelled ? (
          <View style={styles.danger}>
            <Text style={styles.sectionSub}>Entered by mistake or duplicate?</Text>
            <TouchableOpacity style={styles.dangerLink} onPress={() => { setProblems([]); setShowCancel(true); }} accessibilityRole="button"><Text style={styles.dangerText}>Cancel this load</Text></TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.bar}>
        <View style={styles.flex}><Text style={styles.barLabel}>{barLabel}</Text><Text style={styles.barValue}>{totalText}</Text></View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.barBack} onPress={leave} accessibilityRole="button"><Text style={styles.barBackText}>Back</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.barNext, !cancelled && !changeCount && styles.barOff]} disabled={busy || (!cancelled && !changeCount)} onPress={review} accessibilityRole="button" accessibilityState={{ disabled: busy || (!cancelled && !changeCount) }}><Text style={styles.barNextText}>{cancelled ? 'Reactivate' : 'Review'}</Text></TouchableOpacity>
        </View>
      </View>

      {sheet ? (
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
          <Pressable style={styles.dim} onPress={sheet === 'review' ? () => setSheet(null) : discardSheet} accessibilityLabel="Close" />
          <View style={styles.sheet}>
            <View style={styles.grab} />
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              {sheet === 'review' ? <>
                <Text style={styles.sheetTitle}>{cancelled ? 'Reactivate this load' : 'Review changes'}</Text>
                <Text style={styles.help}>The original and the new values are saved permanently in the audit history.</Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {sheetError ? <Text style={styles.error}>{sheetError}</Text> : null}
                {changes.length ? <View style={styles.ruled}>
                  {changes.map((change) => <View key={change.key} style={styles.ruledRow}><Text style={styles.ruledLabel}>{change.label}</Text><Text style={[styles.ruledValue, styles.ruledChanged]}>{change.was !== change.now ? <Text style={styles.was}>{change.was}{'\n'}</Text> : null}{change.now}</Text></View>)}
                  <View style={[styles.ruledRow, styles.ruledTotal]}><Text style={styles.ruledTotalLabel}>Total</Text><Text style={styles.ruledTotalValue}>{baseTotals.total !== totals.total ? <Text style={styles.totalWas}>{baseTotals.total == null ? 'Unpriced' : money(baseTotals.total)}  </Text> : null}{totalText}</Text></View>
                </View> : <Text style={styles.help}>No fields changed. The load is made active again as it is.</Text>}
                <View style={styles.group}><Text style={styles.groupLabel}>{cancelled ? 'WHY IS IT BEING REACTIVATED?' : 'WHY IS IT BEING CORRECTED?'}</Text>
                  <AppField variant="open" label={cancelled ? 'Reactivation reason *' : 'Correction reason *'} value={correction.correctionReason} onChangeText={(value) => set({ correctionReason: value })} multiline placeholder="Required" />
                  <Text style={styles.help}>It is saved with the original and new values.</Text>
                </View>
                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.sheetGhost} onPress={() => setSheet(null)} accessibilityRole="button"><Text style={styles.sheetGhostText}>Back</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.sheetPrimary} disabled={busy} onPress={() => void save()} accessibilityRole="button"><Text style={styles.sheetPrimaryText}>{busy ? 'Saving...' : cancelled ? 'Save and Reactivate' : 'Save correction'}</Text></TouchableOpacity>
                </View>
              </> : <>
                <Text style={styles.sheetTitle}>{sheetTitles[sheet]}</Text>
                {sheet !== 'ticket' && sheet !== 'notes' ? <Text style={styles.was2}>Was <Text style={styles.strong}>{correctionLines(base, setup).find((line) => line.sheet === sheet)?.value}</Text></Text> : null}
                {sheet === 'date' ? <>
                  <DatePickerField variant="open" label="Record date *" value={correction.recordDate} onChange={(value) => set({ recordDate: value })} minDate={project?.startDate ?? undefined} maxDate={project?.endDate ?? todayIso()} />
                  <Text style={styles.help}>The day the material arrived. Not later than today, and inside the project's dates{project?.startDate ? ` (${formatCorrectionDate(project.startDate)} to ${project.endDate ? formatCorrectionDate(project.endDate) : 'today'})` : ''}. The load number does not change, and the load moves to the new day in reports and totals.</Text>
                </> : null}
                {sheet === 'supplier' ? <SearchableSelect variant="open" label="Supplier *" options={setup.suppliers.map((v) => ({ id: v.id, label: v.name, detail: v.phone ?? undefined }))} selectedId={correction.supplierId} onSelect={(value) => set({ supplierId: value })} /> : null}
                {sheet === 'place' ? destinationFields : null}
                {sheet === 'item' ? <GroupedSearchableSelect variant="open" label="Item *" groups={itemGroups} selectedId={correction.itemId} onSelect={(value) => set({ itemId: value })} /> : null}
                {sheet === 'quantity' ? <>
                  <SearchableSelect variant="open" label="Measurement unit *" options={setup.units.map((v) => ({ id: v.id, label: v.name, detail: v.symbol }))} selectedId={correction.unitId} onSelect={(value) => set({ unitId: value })} />
                  <AppField variant="open" label="Quantity *" value={correction.quantityCubicMetres} onChangeText={(value) => set({ quantityCubicMetres: value, weightSource: sourceAfterTyping(correction.calculatedWeightKg, correction.weightSource) })} keyboardType="decimal-pad" />
                  <AppField variant="open" label="Pieces (optional)" value={correction.pieces ?? ''} onChangeText={(value) => set({ pieces: value.replace(/[^0-9]/g, '') })} keyboardType="number-pad" />
                  <SteelItemFields isSteel={isSteel} quantity={correction.quantityCubicMetres} pieces={correction.pieces ?? ''} length={correction.lengthPerBarM ?? ''} diameter={correction.diameterMm ?? ''} calc={correction.calculatedWeightKg ?? ''} source={correction.weightSource} density={steelDensity} onLength={(value) => set({ lengthPerBarM: value })} onResolve={(patch) => set({ quantityCubicMetres: patch.quantity, calculatedWeightKg: patch.calc, weightSource: patch.source })} />
                  <Text style={styles.help}>The total is recalculated from the price.</Text>
                </> : null}
                {sheet === 'delivery' ? <>
                  <OpenSwitch label="Delivery handled by" options={[{ id: 'company' as const, label: 'Our Driver' }, { id: 'supplier' as const, label: 'Supplier Delivering' }]} selectedId={correction.deliveryMethod} onSelect={(id) => set(id === 'company' ? { deliveryMethod: 'company', supplierTruckPlate: '' } : { deliveryMethod: 'supplier', driverId: '', truckId: '' })} />
                  {correction.deliveryMethod === 'company' ? <>
                    <SearchableSelect variant="open" label="Driver *" options={setup.drivers.map((v) => ({ id: v.id, label: v.name, detail: v.phone ?? undefined }))} selectedId={correction.driverId} onSelect={(value) => set({ driverId: value })} />
                    <SearchableSelect variant="open" label="Truck plate *" options={setup.trucks.map((v) => ({ id: v.id, label: v.plate, detail: v.makeModel ?? undefined }))} selectedId={correction.truckId} onSelect={(value) => set({ truckId: value })} />
                  </> : <>
                    <AppField variant="open" label="Supplier truck / plate (optional)" value={correction.supplierTruckPlate} onChangeText={(value) => set({ supplierTruckPlate: value })} placeholder="Leave blank if not known" />
                    <Text style={styles.help}>No company driver is required. If the plate is blank, reports show Supplier Delivering.</Text>
                  </>}
                </> : null}
                {sheet === 'ticket' ? <AppField variant="open" label="Supplier ticket / invoice number" value={correction.supplierTicketNumber} onChangeText={(value) => set({ supplierTicketNumber: value })} /> : null}
                {sheet === 'price' ? <>
                  {priceControls}
                  <View style={styles.ruled}>
                    <View style={styles.ruledRow}><Text style={styles.ruledLabel}>Subtotal</Text><Text style={styles.ruledValue}>{totals.subtotal == null ? 'Unpriced' : money(totals.subtotal)}</Text></View>
                    <View style={[styles.ruledRow, styles.ruledTotal]}><Text style={styles.ruledTotalLabel}>Corrected total</Text><Text style={styles.ruledTotalValue}>{totalText}</Text></View>
                  </View>
                </> : null}
                {sheet === 'notes' ? <AppField variant="open" label="Notes" value={correction.notes} onChangeText={(value) => set({ notes: value })} multiline /> : null}
                {sheetIssues.length ? <Text style={styles.error}>{sheetIssues.join('\n')}</Text> : null}
                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.sheetGhost} onPress={discardSheet} accessibilityRole="button"><Text style={styles.sheetGhostText}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity style={[styles.sheetPrimary, sheetIssues.length > 0 && styles.barOff]} disabled={sheetIssues.length > 0} onPress={() => setSheet(null)} accessibilityRole="button"><Text style={styles.sheetPrimaryText}>Done</Text></TouchableOpacity>
                </View>
              </>}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 }, flex: { flex: 1, minWidth: 0 }, content: { padding: 20, paddingBottom: 42, gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, chip: { color: colors.success, backgroundColor: '#E5F3EC', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden', fontSize: 10, fontWeight: '900', letterSpacing: .7 }, chipCancelled: { color: colors.danger, backgroundColor: '#FCE8E6' }, statusText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 17 }, error: { color: colors.danger, backgroundColor: '#FCE8E6', padding: 12, borderRadius: 10, fontWeight: '700' }, success: { color: colors.success, backgroundColor: '#E5F3EC', padding: 12, borderRadius: 10, fontWeight: '800' },
  warn: { color: '#5A4210', backgroundColor: '#FFF3D8', padding: 12, borderRadius: 10, fontSize: 12, lineHeight: 17, borderLeftWidth: 4, borderLeftColor: '#E3A23A' }, cancelledBox: { color: '#7A1D17', backgroundColor: '#FCE8E6', padding: 12, borderRadius: 10, fontSize: 12, lineHeight: 17, borderLeftWidth: 4, borderLeftColor: colors.danger, fontWeight: '700' },
  ruled: { borderTopWidth: 1, borderTopColor: colors.line }, ruledRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 2, minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.line }, ruledLabel: { color: colors.muted, fontSize: 12, width: '30%' }, ruledValue: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: '700', textAlign: 'right' }, ruledChanged: { color: colors.navy },
  was: { color: '#8A949E', fontWeight: '500', textDecorationLine: 'line-through' }, edit: { color: colors.brand, fontSize: 12, fontWeight: '800' }, locked: { color: '#8A949E', fontSize: 12, fontWeight: '800' }, strong: { color: colors.ink, fontWeight: '800' },
  ruledTotal: { borderBottomWidth: 0, paddingTop: 14, alignItems: 'baseline' }, ruledTotalLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' }, ruledTotalValue: { color: colors.navy, fontSize: 22, fontWeight: '900' }, totalWas: { color: '#8A949E', fontSize: 13, fontWeight: '500', textDecorationLine: 'line-through' },
  section: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line }, sectionTitle: { color: colors.navy, fontSize: 13, fontWeight: '900' }, sectionSub: { color: colors.muted, fontSize: 12, lineHeight: 17 }, chevron: { color: colors.muted, fontSize: 18 }, sectionBody: { gap: 6, paddingBottom: 6 }, plainRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  hist: { borderLeftWidth: 3, borderLeftColor: '#C9D7E6', paddingLeft: 10, gap: 2, marginVertical: 4 }, histDate: { color: colors.muted, fontSize: 11 }, histReason: { color: colors.ink, fontSize: 12, fontWeight: '700' }, histChange: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  danger: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12, marginTop: 6 }, dangerLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, dangerText: { color: colors.danger, fontSize: 14, fontWeight: '900' },
  group: { gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, marginTop: 8 }, groupLabel: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.navy, paddingHorizontal: 16, paddingVertical: 10 }, barLabel: { color: '#D5E4EF', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, barValue: { color: colors.cream, fontSize: 18, fontWeight: '900' }, actions: { flexDirection: 'row', gap: 8 },
  barBack: { minHeight: 48, minWidth: 78, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#D5E4EF', borderRadius: 12, paddingHorizontal: 14 }, barBackText: { color: colors.cream, fontWeight: '800' }, barNext: { minHeight: 48, minWidth: 96, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.brand, borderRadius: 12, paddingHorizontal: 16 }, barNextText: { color: '#FFF', fontWeight: '900' }, barOff: { opacity: .45 }, barDanger: { backgroundColor: colors.danger },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' }, dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(23,33,43,.5)' },
  sheet: { backgroundColor: '#F5F2EC', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%', paddingTop: 10 }, grab: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#C9C3B6', alignSelf: 'center', marginBottom: 6 }, sheetBody: { padding: 18, paddingTop: 8, gap: 12 }, sheetTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' }, was2: { color: colors.muted, fontSize: 12 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 6 }, sheetGhost: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: colors.ink, borderRadius: 12 }, sheetGhostText: { color: colors.ink, fontWeight: '800' }, sheetPrimary: { flex: 1.4, minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.brand, borderRadius: 12 }, sheetPrimaryText: { color: '#FFF', fontWeight: '900' },
});
