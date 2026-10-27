import { useState, type ReactNode } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { loadCorrectionBarLabel, loadCorrectionIssueSheet, type ChangedLoadCorrectionLine, type LoadCorrectionLine, type LoadCorrectionSheet } from '../../domain/loadCorrectionPage';
import type { LoadCorrectionContext } from '../../domain/loadCorrection';
import { formatCorrectionDate, localDateOf } from '../../domain/supplierCorrection';
import { formatUsd, type ConfirmedLoad, type LoadCorrectionChange } from '../../domain/loads';
import { loadNumberLabel } from '../../domain/loadNumberSeries';
import { AppField, PageHeader } from './AppPrimitives';
import { colors } from '../theme';

/** A sheet a line opens, or one of the three extra sheets (signatures, document preview, the review before saving). */
export type CorrectionSheetKey = LoadCorrectionSheet | 'signatures' | 'preview';
type Section = 'documents' | 'history' | null;

const sheetTitles: Record<CorrectionSheetKey, string> = {
  date: 'Date', customer: 'Customer', place: 'Delivered to', item: 'Item', target: 'Counts toward target', quantity: 'Quantity', conversion: 'Conversion',
  driver: 'Driver / Operator', truck: 'Truck', price: 'Price', notes: 'Notes', signatures: 'Signatures', preview: 'Preview documents',
};
/** Sheets that have no "Was" line: free text, or nothing to compare with. */
const noWas: CorrectionSheetKey[] = ['notes', 'signatures', 'preview'];

/**
 * DEC-536. The Company Load correction page: the same page, workflow and sheets as the Supplier Load correction (DEC-525). A list of the
 * load where each line is corrected in its own small sheet, changed lines show the old value crossed out beside the new one, and one short
 * review asks for the reason. It shows what the container gives it and saves through the same repository correction as before, so every
 * rule, payment lock and history entry is unchanged. Cancelling a load keeps the existing company-load cancellation (no reactivation).
 */
export function LoadCorrectionPage(props: {
  selected: ConfirmedLoad; context: LoadCorrectionContext; lines: LoadCorrectionLine[]; baseLines: LoadCorrectionLine[]; changed: ChangedLoadCorrectionLine[];
  changes: LoadCorrectionChange[]; issues: string[]; totals: { total: number | null; vatAmount: number | null; vatRatePercent: number }; baseTotal: number | null;
  reason: string; setReason: (value: string) => void; busy: boolean; error: string | null; message: string | null; signing: boolean;
  renderSheet: (sheet: CorrectionSheetKey) => ReactNode; onSnapshot: () => void; onRestore: () => void;
  onBack: () => void; onSave: () => Promise<boolean>; onCancelLoad: (reason: string) => Promise<boolean>;
}) {
  const { selected, context, lines, baseLines, changed, changes, issues, totals, baseTotal, reason, setReason, busy, error, message, signing, renderSheet, onSnapshot, onRestore, onBack, onSave, onCancelLoad } = props;
  const [sheet, setSheet] = useState<CorrectionSheetKey | 'review' | null>(null);
  const [section, setSection] = useState<Section>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  /** Preview documents opened from the Review returns to the Review when it is closed. */
  const [previewFromReview, setPreviewFromReview] = useState(false);

  const changeCount = changes.length;
  const barLabel = loadCorrectionBarLabel(changeCount);
  const totalText = totals.total == null ? 'Unpriced' : formatUsd(totals.total);
  const sheetIssues = sheet && sheet !== 'review' ? issues.filter((issue) => loadCorrectionIssueSheet(issue) === sheet) : [];
  const when = new Date(selected.confirmedAt);
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  const history = selected.correctionHistory;
  const number = loadNumberLabel(selected.loadNumber);

  function openSheet(next: CorrectionSheetKey) { onSnapshot(); setSheetError(null); setProblems([]); setPreviewFromReview(false); setSheet(next); }
  function closePreview() { setSheet(previewFromReview ? 'review' : null); setPreviewFromReview(false); }
  function discardSheet() { onRestore(); setSheet(null); }
  function review() {
    if (issues.length) { setProblems(issues); return; }
    setProblems([]); setSheetError(null); setSheet('review');
  }
  function leave() {
    if (!changeCount) { onBack(); return; }
    Alert.alert('Leave without saving?', 'Your changes on this page will be lost.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: onBack }]);
  }
  async function save() {
    if (!reason.trim()) { setSheetError('Enter the reason for this correction.'); return; }
    setSheetError(null);
    if (await onSave()) { setSheet(null); setSection(null); }
  }
  function askCancel() {
    if (!cancelReason.trim()) { setProblems(['Cancellation reason is required.']); return; }
    setProblems([]);
    Alert.alert('Cancel this confirmed load?', `Transaction ${selected.transactionNumber} will be permanently marked Cancelled. It is never deleted and stays visible in Load History, but stops counting as an active delivery. This cannot be undone and there is no reactivation.`, [
      { text: 'Keep load active', style: 'cancel' },
      { text: 'Cancel Load', style: 'destructive', onPress: () => void onCancelLoad(cancelReason) },
    ]);
  }
  const toggle = (next: Exclude<Section, null>) => setSection(section === next ? null : next);

  if (showCancel) {
    return (
      <View style={styles.root}>
        <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <PageHeader eyebrow={`COMPANY LOAD ${number}`} title="Cancel this load" onBack={() => { setShowCancel(false); setProblems([]); }} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {problems.length ? <Text style={styles.error}>{problems.map((problem) => `• ${problem}`).join('\n')}</Text> : null}
          <Text style={styles.warn}>This permanently marks transaction {selected.transactionNumber} as Cancelled. The record, its receipt, and its full history are never deleted and remain visible in Load History, but it stops counting as an active delivery. It cannot be undone, and there is no reactivation. A load with an active payment cannot be cancelled until the payment is cancelled.</Text>
          <View style={styles.ruled}>
            <View style={styles.ruledRow}><Text style={styles.ruledLabel}>Item</Text><Text style={styles.ruledValue}>{selected.itemName}</Text></View>
            <View style={styles.ruledRow}><Text style={styles.ruledLabel}>Quantity</Text><Text style={styles.ruledValue}>{selected.billedQuantity.toFixed(3)} {selected.outputUnitSymbol}</Text></View>
            <View style={styles.ruledRow}><Text style={styles.ruledLabel}>Customer</Text><Text style={styles.ruledValue}>{selected.customerName}</Text></View>
            <View style={styles.ruledRow}><Text style={styles.ruledLabel}>Project</Text><Text style={styles.ruledValue}>{selected.projectName ?? selected.destinationAddress ?? '—'}</Text></View>
            <View style={[styles.ruledRow, styles.ruledTotal]}><Text style={styles.ruledTotalLabel}>Total</Text><Text style={styles.ruledTotalValue}>{baseTotal == null ? 'Unpriced' : formatUsd(baseTotal)}</Text></View>
          </View>
          <View style={styles.group}><Text style={styles.groupLabel}>WHY?</Text><AppField variant="open" label="Cancellation reason *" value={cancelReason} onChangeText={setCancelReason} multiline /></View>
        </ScrollView>
        <View style={styles.bar}>
          <View style={styles.flex}><Text style={styles.barLabel}>TOTAL</Text><Text style={styles.barValue}>{baseTotal == null ? 'Unpriced' : formatUsd(baseTotal)}</Text></View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.barBack} onPress={() => { setShowCancel(false); setProblems([]); }} accessibilityRole="button"><Text style={styles.barBackText}>Keep load</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.barNext, styles.barDanger]} disabled={busy} onPress={askCancel} accessibilityRole="button"><Text style={styles.barNextText}>Cancel load</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView style={styles.root} scrollEnabled={!signing} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PageHeader eyebrow="COMPANY LOAD" title={number} onBack={leave} />
        <View style={styles.statusRow}>
          <Text style={styles.chip}>CONFIRMED</Text>
          <Text style={styles.statusText}>{formatCorrectionDate(localDateOf(selected.confirmedAt))} · {time}</Text>
        </View>
        <Text style={styles.help}>Transaction {selected.transactionNumber}</Text>
        {error && sheet !== 'review' ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
        {problems.length ? <Text style={styles.error}>{problems.map((problem) => `• ${problem}`).join('\n')}</Text> : null}
        <Text style={styles.help}>Tap Edit on a line to correct it. The load number and the time of day never change.</Text>
        {context.activePaymentCount > 0 ? <Text style={styles.warn}>{`This load has ${context.activePaymentCount} active payment${context.activePaymentCount === 1 ? '' : 's'} (${formatUsd(context.activePaymentCents / 100)}). Customer, project, unit and price are locked. Cancel those payments in Financials to change them. Quantity, date, item, driver, truck, notes and signatures can still be corrected.`}</Text> : null}

        <View style={styles.ruled}>
          {lines.map((line) => {
            const was = changed.find((value) => value.key === line.key);
            const original = baseLines.find((value) => value.key === line.key);
            return (
              <TouchableOpacity key={line.key} style={styles.ruledRow} disabled={line.locked} onPress={() => openSheet(line.sheet)} accessibilityRole="button" accessibilityLabel={`${line.label}: ${line.value}. ${line.locked ? 'Locked' : 'Edit'}`}>
                <Text style={styles.ruledLabel}>{line.label}</Text>
                <Text style={[styles.ruledValue, was && styles.ruledChanged]}>
                  {was ? <Text style={styles.was}>{original?.value ?? was.was}  </Text> : null}{line.value}
                  <Text style={line.locked ? styles.locked : styles.edit}>{line.locked ? '  Locked' : '  Edit'}</Text>
                </Text>
              </TouchableOpacity>
            );
          })}
          {totals.vatAmount != null && totals.vatRatePercent > 0 ? <View style={styles.ruledRow}><Text style={styles.ruledLabel}>VAT ({totals.vatRatePercent}%)</Text><Text style={styles.ruledValue}>{formatUsd(totals.vatAmount)}</Text></View> : null}
          <View style={[styles.ruledRow, styles.ruledTotal]}>
            <Text style={styles.ruledTotalLabel}>Total</Text>
            <Text style={styles.ruledTotalValue}>{baseTotal !== totals.total ? <Text style={styles.totalWas}>{baseTotal == null ? 'Unpriced' : formatUsd(baseTotal)}  </Text> : null}{totalText}</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.section} onPress={() => toggle('documents')} accessibilityRole="button" accessibilityState={{ expanded: section === 'documents' }}><View style={styles.flex}><Text style={styles.sectionTitle}>Documents</Text><Text style={styles.sectionSub}>Receipt and Delivery Authorization</Text></View><Text style={styles.chevron}>{section === 'documents' ? '⌃' : '⌄'}</Text></TouchableOpacity>
        {section === 'documents' ? <View style={styles.sectionBody}>
          {context.issuedDocumentCount > 0 ? <Text style={styles.info}>{`This load is on ${context.issuedDocumentCount} issued document${context.issuedDocumentCount === 1 ? '' : 's'}. They keep their own copy and are not rewritten by this correction.`}</Text> : null}
          <TouchableOpacity style={styles.linkBox} onPress={() => openSheet('preview')} accessibilityRole="button"><Text style={styles.link}>Preview documents · Receipt and Authorization</Text></TouchableOpacity>
          <Text style={styles.sectionSub}>Shows both documents with the corrected values. Nothing is saved.</Text>
        </View> : null}

        <TouchableOpacity style={styles.section} onPress={() => openSheet('signatures')} accessibilityRole="button"><View style={styles.flex}><Text style={styles.sectionTitle}>Signatures</Text><Text style={styles.sectionSub}>Supplier and driver signatures</Text></View><Text style={styles.edit}>Edit</Text></TouchableOpacity>

        <TouchableOpacity style={styles.section} onPress={() => toggle('history')} accessibilityRole="button" accessibilityState={{ expanded: section === 'history' }}><View style={styles.flex}><Text style={styles.sectionTitle}>Correction history</Text><Text style={styles.sectionSub}>{history.length ? `${history.length} correction${history.length === 1 ? '' : 's'}` : 'None yet'}</Text></View><Text style={styles.chevron}>{section === 'history' ? '⌃' : '⌄'}</Text></TouchableOpacity>
        {section === 'history' ? <View style={styles.sectionBody}>
          {history.length ? [...history].reverse().map((entry, index) => {
            const version = context.versions.find((value) => value.correctedAt === entry.correctedAt)?.version;
            return (
              <View key={`${entry.correctedAt}-${index}`} style={styles.hist}>
                <Text style={styles.histDate}>{new Date(entry.correctedAt).toLocaleString()} · {entry.correctedBy}</Text>
                <Text style={styles.histReason}>Reason: {entry.reason}</Text>
                {entry.changes.map((change) => <Text key={change.field} style={styles.histChange}>{change.field}: <Text style={styles.was}>{change.originalValue ?? 'empty'}</Text> → <Text style={styles.strong}>{change.newValue ?? 'empty'}</Text></Text>)}
                {version ? <Text style={styles.histDate}>{`ORIGINAL SAVED · VERSION ${version}`}</Text> : null}
              </View>
            );
          }) : <Text style={styles.sectionSub}>No corrections have been made to this load.</Text>}
          <Text style={styles.sectionSub}>Confirmed {new Date(selected.confirmedAt).toLocaleString()} · the original record is never changed.</Text>
        </View> : null}

        <View style={styles.danger}>
          <Text style={styles.sectionSub}>Entered by mistake or a duplicate?</Text>
          <TouchableOpacity style={styles.dangerLink} onPress={() => { setProblems([]); setShowCancel(true); }} accessibilityRole="button"><Text style={styles.dangerText}>Cancel this load</Text></TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.bar}>
        <View style={styles.flex}><Text style={styles.barLabel}>{barLabel}</Text><Text style={styles.barValue}>{totalText}</Text></View>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.barBack} onPress={leave} accessibilityRole="button"><Text style={styles.barBackText}>Back</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.barNext, !changeCount && styles.barOff]} disabled={busy || !changeCount} onPress={review} accessibilityRole="button" accessibilityState={{ disabled: busy || !changeCount }}><Text style={styles.barNextText}>Review</Text></TouchableOpacity>
        </View>
      </View>

      {sheet ? (
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined} pointerEvents="box-none">
          <Pressable style={styles.dim} onPress={sheet === 'preview' ? closePreview : sheet === 'review' ? () => setSheet(null) : discardSheet} accessibilityLabel="Close" />
          <View style={styles.sheet}>
            <View style={styles.grab} />
            <ScrollView scrollEnabled={!signing} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              {sheet === 'review' ? <>
                <Text style={styles.sheetTitle}>Review changes</Text>
                <Text style={styles.help}>The original and the new values are saved permanently in the correction history. The load number and transaction number do not change.</Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {sheetError ? <Text style={styles.error}>{sheetError}</Text> : null}
                <View style={styles.ruled}>
                  {changes.map((change) => <View key={change.field} style={styles.ruledRow}><Text style={styles.ruledLabel}>{change.field}</Text><Text style={[styles.ruledValue, styles.ruledChanged]}>{change.originalValue !== change.newValue ? <Text style={styles.was}>{change.originalValue ?? 'empty'}{'\n'}</Text> : null}{change.newValue ?? 'empty'}</Text></View>)}
                  <View style={[styles.ruledRow, styles.ruledTotal]}><Text style={styles.ruledTotalLabel}>Total</Text><Text style={styles.ruledTotalValue}>{baseTotal !== totals.total ? <Text style={styles.totalWas}>{baseTotal == null ? 'Unpriced' : formatUsd(baseTotal)}  </Text> : null}{totalText}</Text></View>
                </View>
                <TouchableOpacity style={styles.linkBox} onPress={() => { setPreviewFromReview(true); setSheet('preview'); }} accessibilityRole="button"><Text style={styles.link}>Preview documents · Receipt and Authorization</Text></TouchableOpacity>
                <View style={styles.group}><Text style={styles.groupLabel}>WHY IS IT BEING CORRECTED?</Text>
                  <AppField variant="open" label="Correction reason *" value={reason} onChangeText={setReason} multiline placeholder="Required" />
                  <Text style={styles.help}>It is saved with the original and new values.</Text>
                </View>
                <View style={styles.btnRow}>
                  <TouchableOpacity style={styles.sheetGhost} onPress={() => setSheet(null)} accessibilityRole="button"><Text style={styles.sheetGhostText}>Back</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.sheetPrimary} disabled={busy} onPress={() => void save()} accessibilityRole="button"><Text style={styles.sheetPrimaryText}>{busy ? 'Saving...' : 'Save correction'}</Text></TouchableOpacity>
                </View>
              </> : <>
                <Text style={styles.sheetTitle}>{sheetTitles[sheet]}</Text>
                {!noWas.includes(sheet) ? <Text style={styles.was2}>Was <Text style={styles.strong}>{baseLines.find((line) => line.sheet === sheet)?.value ?? 'Not linked'}</Text></Text> : null}
                {renderSheet(sheet)}
                {sheetIssues.length ? <Text style={styles.error}>{sheetIssues.join('\n')}</Text> : null}
                <View style={styles.btnRow}>
                  {sheet === 'preview' ? null : <TouchableOpacity style={styles.sheetGhost} onPress={discardSheet} accessibilityRole="button"><Text style={styles.sheetGhostText}>Cancel</Text></TouchableOpacity>}
                  <TouchableOpacity style={[styles.sheetPrimary, sheetIssues.length > 0 && styles.barOff]} disabled={sheetIssues.length > 0} onPress={sheet === 'preview' ? closePreview : () => setSheet(null)} accessibilityRole="button"><Text style={styles.sheetPrimaryText}>{sheet === 'preview' ? 'Close' : 'Done'}</Text></TouchableOpacity>
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
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, chip: { color: colors.success, backgroundColor: '#E5F3EC', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden', fontSize: 10, fontWeight: '900', letterSpacing: .7 }, statusText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  help: { color: colors.muted, fontSize: 12, lineHeight: 17 }, error: { color: colors.danger, backgroundColor: '#FCE8E6', padding: 12, borderRadius: 10, fontWeight: '700' }, success: { color: colors.success, backgroundColor: '#E5F3EC', padding: 12, borderRadius: 10, fontWeight: '800' },
  info: { color: colors.navy, backgroundColor: '#EAF1F6', padding: 10, borderRadius: 10, fontSize: 12, fontWeight: '700', overflow: 'hidden' },
  warn: { color: '#5A4210', backgroundColor: '#FFF3D8', padding: 12, borderRadius: 10, fontSize: 12, lineHeight: 17, borderLeftWidth: 4, borderLeftColor: '#E3A23A' },
  ruled: { borderTopWidth: 1, borderTopColor: colors.line }, ruledRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 2, minHeight: 48, borderBottomWidth: 1, borderBottomColor: colors.line }, ruledLabel: { color: colors.muted, fontSize: 12, width: '30%' }, ruledValue: { flex: 1, color: colors.ink, fontSize: 13, fontWeight: '700', textAlign: 'right' }, ruledChanged: { color: colors.navy },
  was: { color: '#8A949E', fontWeight: '500', textDecorationLine: 'line-through' }, edit: { color: colors.brand, fontSize: 12, fontWeight: '800' }, locked: { color: '#8A949E', fontSize: 12, fontWeight: '800' }, strong: { color: colors.ink, fontWeight: '800' },
  ruledTotal: { borderBottomWidth: 0, paddingTop: 14, alignItems: 'baseline' }, ruledTotalLabel: { color: colors.ink, fontSize: 13, fontWeight: '800' }, ruledTotalValue: { color: colors.navy, fontSize: 22, fontWeight: '900' }, totalWas: { color: '#8A949E', fontSize: 13, fontWeight: '500', textDecorationLine: 'line-through' },
  section: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.line }, sectionTitle: { color: colors.navy, fontSize: 13, fontWeight: '900' }, sectionSub: { color: colors.muted, fontSize: 12, lineHeight: 17 }, chevron: { color: colors.muted, fontSize: 18 }, sectionBody: { gap: 8, paddingBottom: 6 },
  linkBox: { minHeight: 44, justifyContent: 'center' }, link: { color: colors.brand, fontWeight: '800', fontSize: 13 },
  hist: { borderLeftWidth: 3, borderLeftColor: '#C9D7E6', paddingLeft: 10, gap: 2, marginVertical: 4 }, histDate: { color: colors.muted, fontSize: 11 }, histReason: { color: colors.ink, fontSize: 12, fontWeight: '700' }, histChange: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  danger: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12, marginTop: 6 }, dangerLink: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, dangerText: { color: colors.danger, fontSize: 14, fontWeight: '900' },
  group: { gap: 8, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, marginTop: 8 }, groupLabel: { color: colors.muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.navy, paddingHorizontal: 16, paddingVertical: 10 }, barLabel: { color: '#D5E4EF', fontSize: 10, fontWeight: '800', letterSpacing: 1 }, barValue: { color: colors.cream, fontSize: 18, fontWeight: '900' }, actions: { flexDirection: 'row', gap: 8 },
  barBack: { minHeight: 48, minWidth: 78, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#D5E4EF', borderRadius: 12, paddingHorizontal: 14 }, barBackText: { color: colors.cream, fontWeight: '800' }, barNext: { minHeight: 48, minWidth: 96, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.brand, borderRadius: 12, paddingHorizontal: 16 }, barNextText: { color: '#FFF', fontWeight: '900' }, barOff: { opacity: .45 }, barDanger: { backgroundColor: colors.danger },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' }, dim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(23,33,43,.5)' },
  sheet: { backgroundColor: '#F5F2EC', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%', paddingTop: 10 }, grab: { width: 44, height: 5, borderRadius: 3, backgroundColor: '#C9C3B6', alignSelf: 'center', marginBottom: 6 }, sheetBody: { padding: 18, paddingTop: 8, gap: 12 }, sheetTitle: { color: colors.ink, fontSize: 20, fontWeight: '900' }, was2: { color: colors.muted, fontSize: 12 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 6 }, sheetGhost: { flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderWidth: 1.5, borderColor: colors.ink, borderRadius: 12 }, sheetGhostText: { color: colors.ink, fontWeight: '800' }, sheetPrimary: { flex: 1.4, minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.brand, borderRadius: 12 }, sheetPrimaryText: { color: '#FFF', fontWeight: '900' },
});
