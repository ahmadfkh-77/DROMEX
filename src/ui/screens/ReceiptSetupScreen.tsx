import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { LoadRepository } from '../../data/repositories/LoadRepository';
import type { ConversionOption, MeasurementUnit } from '../../domain/loads';
import { PageHeader } from '../components/AppPrimitives';
import { useReducedMotion } from '../components/ExpandableMenu';
import { SegmentedChoice } from '../components/SegmentedChoice';
import { addAction, conversionEquation, conversionMatches, DECIMAL_CHOICES, decimalsText, inactiveLabel, isDecimalChoice, needsSearch, ruleLine, unitChoiceText, unitMatches, type UnitsTab } from '../../domain/unitsConversions';
import { colors } from '../theme';

/** Secondary text on the cream page, darker than `colors.muted` so it holds contrast in sunlight. */
const SECONDARY = '#4F5B66';

/**
 * The uniqueness rules live in the database (`measurement_units.name/symbol` and
 * `conversion_options.name` are UNIQUE COLLATE NOCASE). Detection is unchanged; only the
 * sentence the owner reads is rewritten, because a raw constraint string is not actionable.
 */
function readableError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : '';
  if (message.includes('measurement_units.name')) return 'Another unit already uses that name. Choose a different name.';
  if (message.includes('measurement_units.symbol')) return 'Another unit already uses that symbol. Choose a different symbol.';
  if (message.includes('conversion_options.name')) return 'Another conversion already uses that name. Choose a different name.';
  return message || fallback;
}

export function ReceiptSetupScreen({ repository, onBack }: { repository: LoadRepository; onBack: () => void }) {
  const reducedMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [units, setUnits] = useState<MeasurementUnit[]>([]);
  const [conversions, setConversions] = useState<ConversionOption[]>([]);

  // DEC-526. One list at a time: Units or Conversions.
  const [tab, setTab] = useState<UnitsTab>('units');
  const [unitSearch, setUnitSearch] = useState('');
  const [conversionSearch, setConversionSearch] = useState('');
  const [inactiveUnitsOpen, setInactiveUnitsOpen] = useState(false);
  const [inactiveConversionsOpen, setInactiveConversionsOpen] = useState(false);

  const [unitSheet, setUnitSheet] = useState<'closed' | 'add' | 'edit'>('closed');
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [unitName, setUnitName] = useState('');
  const [unitSymbol, setUnitSymbol] = useState('');

  const [conversionSheet, setConversionSheet] = useState<'closed' | 'add' | 'edit'>('closed');
  const [editingConversionId, setEditingConversionId] = useState<string | null>(null);
  const [conversionName, setConversionName] = useState('');
  const [inputUnitId, setInputUnitId] = useState('');
  const [outputUnitId, setOutputUnitId] = useState('');
  const [inputQuantity, setInputQuantity] = useState('1000');
  const [outputQuantity, setOutputQuantity] = useState('1');
  const [decimals, setDecimals] = useState('3');
  // DEC-526 Phase 2. Which unit list is open inside the conversion form (never a second pop-up).
  const [pickerOpen, setPickerOpen] = useState<'input' | 'output' | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only the two lists this screen renders are read. The full setup fetch this screen used to
  // make (customers, projects, catalog, drivers, trucks, workers, machines) was never consumed.
  const refresh = useCallback(async () => {
    const [nextUnits, nextConversions] = await Promise.all([
      repository.listMeasurementUnits(),
      repository.listConversionOptions(),
    ]);
    setUnits(nextUnits);
    setConversions(nextConversions);
  }, [repository]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      await refresh();
      setLoaded(true);
    } catch (cause) {
      setLoadError(readableError(cause, 'Could not load units and conversions.'));
    }
  }, [refresh]);

  useEffect(() => {
    void load();
  }, [load]);

  // An action may return its own outcome sentence, which matters when a remove silently became a
  // deactivation; without this the generic success line would overwrite that fact.
  async function run(action: () => Promise<string | void>, success: string, fallback: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const outcome = await action();
      await refresh();
      setMessage(outcome ?? success);
    } catch (cause) {
      setError(readableError(cause, fallback));
    } finally {
      setBusy(false);
    }
  }

  const activeUnits = useMemo(() => units.filter((unit) => unit.isActive), [units]);
  const inactiveUnits = useMemo(() => units.filter((unit) => !unit.isActive), [units]);
  const activeConversions = useMemo(() => conversions.filter((value) => value.isActive), [conversions]);
  const inactiveConversions = useMemo(() => conversions.filter((value) => !value.isActive), [conversions]);

  const unitQuery = unitSearch.trim();
  const conversionQuery = conversionSearch.trim();
  const matchesUnit = useCallback((unit: MeasurementUnit) => unitMatches(unit, unitSearch), [unitSearch]);
  const matchesConversion = useCallback((value: ConversionOption) => conversionMatches(value, conversionSearch), [conversionSearch]);

  const visibleActiveUnits = activeUnits.filter(matchesUnit);
  const visibleInactiveUnits = inactiveUnits.filter(matchesUnit);
  const visibleActiveConversions = activeConversions.filter(matchesConversion);
  const visibleInactiveConversions = inactiveConversions.filter(matchesConversion);

  function switchTab(next: UnitsTab) {
    setTab(next);
    setError(null);
    setMessage(null);
  }

  function toggleSection(setOpen: (update: (value: boolean) => boolean) => void) {
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((value) => !value);
  }

  function openAddUnit() {
    setError(null);
    setMessage(null);
    setEditingUnitId(null);
    setUnitName('');
    setUnitSymbol('');
    setUnitSheet('add');
  }

  function openEditUnit(unit: MeasurementUnit) {
    setError(null);
    setMessage(null);
    setEditingUnitId(unit.id);
    setUnitName(unit.name);
    setUnitSymbol(unit.symbol);
    setUnitSheet('edit');
  }

  function openAddConversion() {
    setError(null);
    setMessage(null);
    setEditingConversionId(null);
    setConversionName('');
    // Default to real units rather than the seeded ids, which the owner may have removed.
    setInputUnitId(activeUnits[0]?.id ?? '');
    setOutputUnitId(activeUnits[1]?.id ?? activeUnits[0]?.id ?? '');
    setInputQuantity('1000');
    setOutputQuantity('1');
    setDecimals('3');
    setPickerOpen(null);
    setConversionSheet('add');
  }

  function openEditConversion(value: ConversionOption) {
    setError(null);
    setMessage(null);
    setEditingConversionId(value.id);
    setConversionName(value.name);
    setInputUnitId(value.inputUnitId);
    setOutputUnitId(value.outputUnitId);
    setInputQuantity(String(value.inputQuantity));
    setOutputQuantity(String(value.outputQuantity));
    setDecimals(String(value.decimalPlaces));
    setPickerOpen(null);
    setConversionSheet('edit');
  }

  async function saveUnit() {
    const editing = editingUnitId;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (editing) await repository.updateUnit(editing, { name: unitName, symbol: unitSymbol });
      else await repository.createUnit({ name: unitName, symbol: unitSymbol });
      await refresh();
      setUnitSheet('closed');
      setEditingUnitId(null);
      setMessage(editing ? 'Unit updated.' : 'Unit added.');
    } catch (cause) {
      setError(readableError(cause, 'Could not save this unit.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveConversion() {
    const editing = editingConversionId;
    const draft = {
      name: conversionName,
      inputUnitId,
      outputUnitId,
      inputQuantity: Number(inputQuantity),
      outputQuantity: Number(outputQuantity),
      decimalPlaces: Number(decimals),
    };
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (editing) await repository.updateConversion(editing, draft);
      else await repository.createConversion(draft);
      await refresh();
      setConversionSheet('closed');
      setEditingConversionId(null);
      setMessage(editing ? 'Conversion updated.' : 'Conversion added.');
    } catch (cause) {
      setError(readableError(cause, 'Could not save this conversion.'));
    } finally {
      setBusy(false);
    }
  }

  function confirmRemoveUnit(unit: MeasurementUnit) {
    Alert.alert(
      `Remove or deactivate "${unit.name}"?`,
      `If nothing uses this unit it is deleted. If a record, conversion, or catalog item depends on it, DROMEX keeps that history and moves the unit to Inactive instead.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            void run(
              async () => {
                const result = await repository.removeUnit(unit.id);
                if (editingUnitId === unit.id) {
                  setUnitSheet('closed');
                  setEditingUnitId(null);
                }
                return result === 'deleted' ? 'Unit deleted.' : 'Unit is in use, so it was moved to Inactive and its history was kept.';
              },
              'Unit removed.',
              'Could not remove this unit.',
            ),
        },
      ],
    );
  }

  function confirmRemoveConversion(value: ConversionOption) {
    Alert.alert(
      `Remove or deactivate "${value.name}"?`,
      `If no receipt uses this conversion it is deleted. If a confirmed receipt depends on it, DROMEX keeps that receipt's saved snapshot and moves the conversion to Inactive instead.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            void run(
              async () => {
                const result = await repository.removeConversion(value.id);
                if (editingConversionId === value.id) {
                  setConversionSheet('closed');
                  setEditingConversionId(null);
                }
                return result === 'deleted' ? 'Conversion deleted.' : 'Conversion is in use, so it was moved to Inactive and its history was kept.';
              },
              'Conversion removed.',
              'Could not remove this conversion.',
            ),
        },
      ],
    );
  }

  if (!loaded) {
    return (
      <View style={styles.screenState}>
        {loadError ? (
          <>
            <Text style={styles.screenStateTitle}>Could not open Units & Conversions</Text>
            <Text style={styles.screenStateBody}>{loadError}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => void load()} accessibilityRole="button" accessibilityLabel="Try loading units and conversions again">
              <Text style={styles.retryButtonText}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quietAction} onPress={onBack} accessibilityRole="button" accessibilityLabel="Go back">
              <Text style={styles.quietActionText}>Go back</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.brand} />
            <Text style={styles.screenStateBody}>Loading units and conversions…</Text>
          </>
        )}
      </View>
    );
  }

  const add = addAction(tab, activeUnits.length);
  const editingUnit = units.find((unit) => unit.id === editingUnitId) ?? null;
  const editingConversion = conversions.find((value) => value.id === editingConversionId) ?? null;
  const inputUnit = units.find((unit) => unit.id === inputUnitId);
  const outputUnit = units.find((unit) => unit.id === outputUnitId);

  return (
    <View style={styles.root}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PageHeader eyebrow="SETUP" title="Units & Conversions" onBack={onBack} />

        {error && unitSheet === 'closed' && conversionSheet === 'closed' ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>
        ) : null}
        {message ? <Text style={styles.success} accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</Text> : null}

        <SegmentedChoice
          mode="tabs"
          options={[
            { id: 'units' as const, label: 'Units', count: activeUnits.length },
            { id: 'conversions' as const, label: 'Conversions', count: activeConversions.length },
          ]}
          selectedId={tab}
          onSelect={switchTab}
        />

        {tab === 'units' ? (
          <>
            {needsSearch(units.length) ? (
              <SearchBar value={unitSearch} onChange={setUnitSearch} placeholder="Search unit name or symbol" label="Search units by name or symbol" />
            ) : null}
            {visibleActiveUnits.length ? (
              <View style={styles.list}>
                {visibleActiveUnits.map((unit, index) => (
                  <UnitListRow key={unit.id} unit={unit} first={index === 0} busy={busy} onEdit={() => openEditUnit(unit)} />
                ))}
              </View>
            ) : (
              <EmptyBlock
                title={unitQuery ? 'No matching units' : 'No active units yet'}
                body={unitQuery ? `No active unit matches "${unitSearch.trim()}".` : 'A unit is how a quantity is measured. Add a unit such as Tonne (t) or Cubic metre (m³) so quantities can be recorded.'}
                onClearSearch={unitQuery ? () => setUnitSearch('') : undefined}
              />
            )}
            {inactiveUnits.length ? (
              <>
                <InactiveRow label={inactiveLabel('units', inactiveUnits.length)} open={inactiveUnitsOpen} onToggle={() => toggleSection(setInactiveUnitsOpen)} />
                {inactiveUnitsOpen ? (
                  visibleInactiveUnits.length ? (
                    <View style={styles.list}>
                      {visibleInactiveUnits.map((unit, index) => (
                        <UnitListRow
                          key={unit.id}
                          unit={unit}
                          first={index === 0}
                          busy={busy}
                          onEdit={() => openEditUnit(unit)}
                          onReactivate={() => void run(() => repository.setUnitActive(unit.id, true), 'Unit reactivated.', 'Could not reactivate this unit.')}
                        />
                      ))}
                    </View>
                  ) : (
                    <EmptyBlock title="No matching units" body={`No inactive unit matches "${unitSearch.trim()}".`} onClearSearch={() => setUnitSearch('')} />
                  )
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <>
            {needsSearch(conversions.length) ? (
              <SearchBar value={conversionSearch} onChange={setConversionSearch} placeholder="Search conversion or unit name" label="Search conversions by name or unit" />
            ) : null}
            {visibleActiveConversions.length ? (
              <View style={styles.list}>
                {visibleActiveConversions.map((value, index) => (
                  <ConversionListRow key={value.id} conversion={value} first={index === 0} busy={busy} onEdit={() => openEditConversion(value)} />
                ))}
              </View>
            ) : (
              <EmptyBlock
                title={conversionQuery ? 'No matching conversions' : 'No active conversions yet'}
                body={conversionQuery ? `No active conversion matches "${conversionSearch.trim()}".` : 'A conversion changes one unit into another. Add a rule such as 1,000 kg = 1 t so receipts can bill in the unit you sell in.'}
                onClearSearch={conversionQuery ? () => setConversionSearch('') : undefined}
              />
            )}
            {inactiveConversions.length ? (
              <>
                <InactiveRow label={inactiveLabel('conversions', inactiveConversions.length)} open={inactiveConversionsOpen} onToggle={() => toggleSection(setInactiveConversionsOpen)} />
                {inactiveConversionsOpen ? (
                  visibleInactiveConversions.length ? (
                    <View style={styles.list}>
                      {visibleInactiveConversions.map((value, index) => (
                        <ConversionListRow
                          key={value.id}
                          conversion={value}
                          first={index === 0}
                          busy={busy}
                          onEdit={() => openEditConversion(value)}
                          onReactivate={() => void run(() => repository.setConversionActive(value.id, true), 'Conversion reactivated.', 'Could not reactivate this conversion.')}
                        />
                      ))}
                    </View>
                  ) : (
                    <EmptyBlock title="No matching conversions" body={`No inactive conversion matches "${conversionSearch.trim()}".`} onClearSearch={() => setConversionSearch('')} />
                  )
                ) : null}
              </>
            ) : null}
            <Text style={styles.note}>Confirmed receipts keep the conversion they were saved with, so editing a rule only changes future calculations.</Text>
          </>
        )}
      </ScrollView>

      <View style={styles.addBar}>
        {add.hint ? <Text style={styles.addHint}>{add.hint}</Text> : null}
        <TouchableOpacity
          style={[styles.addButton, !add.enabled && styles.buttonDisabled]}
          onPress={tab === 'units' ? openAddUnit : openAddConversion}
          disabled={!add.enabled}
          accessibilityRole="button"
          accessibilityLabel={tab === 'units' ? 'Add a measurement unit' : 'Add a conversion'}
          accessibilityHint={add.enabled ? undefined : 'Add at least one unit first'}
          accessibilityState={{ disabled: !add.enabled }}
        >
          <PlusIcon />
          <Text style={styles.addButtonLabel}>{add.label}</Text>
        </TouchableOpacity>
      </View>

      <Sheet
        visible={unitSheet !== 'closed'}
        reducedMotion={reducedMotion}
        eyebrow="UNITS"
        title={unitSheet === 'edit' ? 'Edit unit' : 'Add unit'}
        onClose={() => setUnitSheet('closed')}
        footer={
          <SheetFooter
            busy={busy}
            saveLabel={unitSheet === 'edit' ? 'Save Unit' : 'Add Unit'}
            saveAccessibilityLabel={unitSheet === 'edit' ? `Save changes to ${unitName || 'this unit'}` : 'Add this unit'}
            onCancel={() => setUnitSheet('closed')}
            onSave={() => void saveUnit()}
          />
        }
      >
        <Text style={styles.sheetIntro}>A unit is how a quantity is measured. The symbol is what appears on receipts and record rows.</Text>
        {error ? <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}
        <Field label="Unit name *" value={unitName} onChangeText={setUnitName} placeholder="Cubic metre" helper="The full name shown in pickers and lists." />
        <Field label="Symbol *" value={unitSymbol} onChangeText={setUnitSymbol} placeholder="m³" helper="The short form printed on receipts. Must be unique." />
        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>HOW THIS UNIT WILL LOOK</Text>
          <View style={styles.previewRow}>
            <View style={styles.symbolTile}><Text style={styles.symbolTileText} numberOfLines={1}>{unitSymbol.trim() || '?'}</Text></View>
            <Text style={styles.rowTitle} numberOfLines={2}>{unitName.trim() || 'Unit name'}</Text>
          </View>
        </View>
        {unitSheet === 'edit' && editingUnit ? <RemoveBlock kind="unit" busy={busy} onRemove={() => confirmRemoveUnit(editingUnit)} /> : null}
      </Sheet>

      <Sheet
        visible={conversionSheet !== 'closed'}
        reducedMotion={reducedMotion}
        eyebrow="CONVERSIONS"
        title={conversionSheet === 'edit' ? 'Edit conversion' : 'Add conversion'}
        onClose={() => setConversionSheet('closed')}
        footer={
          <SheetFooter
            busy={busy}
            saveLabel={conversionSheet === 'edit' ? 'Save Conversion' : 'Add Conversion'}
            saveAccessibilityLabel={conversionSheet === 'edit' ? `Save changes to ${conversionName || 'this conversion'}` : 'Add this conversion'}
            onCancel={() => setConversionSheet('closed')}
            onSave={() => void saveConversion()}
          />
        }
      >
        {error ? <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}

        <View style={styles.ruleBlock}>
          <Text style={styles.ruleLabel}>This rule reads as</Text>
          <RuleLine rule={ruleLine(inputQuantity, inputUnit?.symbol, outputQuantity, outputUnit?.symbol)} />
        </View>

        <View style={styles.pairGroup}>
          <Text style={styles.groupTitle}>From</Text>
          <View style={styles.pairRow}>
            <View style={styles.amountCol}><Field label="Amount *" value={inputQuantity} onChangeText={setInputQuantity} keyboardType="decimal-pad" /></View>
            <View style={styles.unitCol}>
              <UnitSelect label="Unit *" unit={inputUnit} open={pickerOpen === 'input'} onToggle={() => setPickerOpen(pickerOpen === 'input' ? null : 'input')} />
            </View>
          </View>
          {pickerOpen === 'input' ? <UnitList label="From unit" units={activeUnits} selectedId={inputUnitId} onSelect={(id) => { setInputUnitId(id); setPickerOpen(null); }} /> : null}
        </View>

        <View style={styles.equalsRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.equalsLine} /><Text style={styles.equalsText}>equals</Text><View style={styles.equalsLine} />
        </View>

        <View style={styles.pairGroup}>
          <Text style={styles.groupTitle}>To</Text>
          <View style={styles.pairRow}>
            <View style={styles.amountCol}><Field label="Amount *" value={outputQuantity} onChangeText={setOutputQuantity} keyboardType="decimal-pad" /></View>
            <View style={styles.unitCol}>
              <UnitSelect label="Unit *" unit={outputUnit} open={pickerOpen === 'output'} onToggle={() => setPickerOpen(pickerOpen === 'output' ? null : 'output')} />
            </View>
          </View>
          {pickerOpen === 'output' ? <UnitList label="To unit" units={activeUnits} selectedId={outputUnitId} onSelect={(id) => { setOutputUnitId(id); setPickerOpen(null); }} /> : null}
        </View>

        <Field label="Conversion name *" value={conversionName} onChangeText={setConversionName} placeholder="Kilograms to tonnes" helper="How you will recognise this rule in a picker. Must be unique." />

        <View style={styles.field}>
          <Text style={styles.label}>Decimal places *</Text>
          <View style={styles.decimalRow} accessibilityRole="radiogroup" accessibilityLabel="Decimal places">
            {DECIMAL_CHOICES.map((choice) => {
              const selected = isDecimalChoice(decimals, choice);
              return (
                <TouchableOpacity
                  key={choice}
                  style={[styles.decimalButton, selected && styles.decimalButtonSelected]}
                  onPress={() => setDecimals(String(choice))}
                  accessibilityRole="radio"
                  accessibilityLabel={decimalsText(choice)}
                  accessibilityState={{ checked: selected }}
                >
                  <Text style={[styles.decimalText, selected && styles.decimalTextSelected]}>{choice}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.fieldHelper}>How many decimals the converted quantity shows.</Text>
        </View>
        {conversionSheet === 'edit' && editingConversion ? <RemoveBlock kind="conversion" busy={busy} onRemove={() => confirmRemoveConversion(editingConversion)} /> : null}
      </Sheet>
    </View>
  );
}








function ChevronIcon({ direction = 'right' }: { direction?: 'right' | 'down' | 'up' }) {
  const d = direction === 'right' ? 'M9 5l7 7-7 7' : direction === 'down' ? 'M5 9l7 7 7-7' : 'M5 15l7-7 7 7';
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={SECONDARY} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no">
      <Path d={d} />
    </Svg>
  );
}

function PlusIcon() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** One line per unit: the symbol, then the name. Tapping opens the edit form, where Remove lives. */
function UnitListRow({ unit, first, busy, onEdit, onReactivate }: { unit: MeasurementUnit; first: boolean; busy: boolean; onEdit: () => void; onReactivate?: () => void }) {
  return (
    <View style={[styles.listRow, !first && styles.listRowRule]}>
      <Pressable
        style={styles.rowMain}
        onPress={onEdit}
        disabled={busy}
        android_ripple={{ color: '#EFE9DF' }}
        accessibilityRole="button"
        accessibilityLabel={`${unit.name}, symbol ${unit.symbol}${unit.isActive ? '' : ', inactive'}`}
        accessibilityHint="Opens the form to edit or remove this unit"
        accessibilityState={{ disabled: busy }}
      >
        <Text style={[styles.rowSymbol, !unit.isActive && styles.rowInactive]} numberOfLines={1}>{unit.symbol}</Text>
        <Text style={[styles.rowName, !unit.isActive && styles.rowInactive]} numberOfLines={2}>{unit.name}</Text>
        {onReactivate ? null : <ChevronIcon />}
      </Pressable>
      {onReactivate ? <ReactivateButton name={unit.name} kind="unit" busy={busy} onPress={onReactivate} /> : null}
    </View>
  );
}

/** One row per conversion with the rule itself as the headline, so it reads as "1,000 kg = 1 t" and not as a card in a card. */
function ConversionListRow({ conversion, first, busy, onEdit, onReactivate }: { conversion: ConversionOption; first: boolean; busy: boolean; onEdit: () => void; onReactivate?: () => void }) {
  const equation = conversionEquation(conversion);
  const muted = !conversion.isActive;
  return (
    <View style={[styles.listRow, styles.listRowTall, !first && styles.listRowRule]}>
      <Pressable
        style={styles.rowMain}
        onPress={onEdit}
        disabled={busy}
        android_ripple={{ color: '#EFE9DF' }}
        accessibilityRole="button"
        accessibilityLabel={`${conversion.name}. ${equation.left} ${equation.leftSymbol} equals ${equation.right} ${equation.rightSymbol}. ${decimalsText(conversion.decimalPlaces)}${muted ? '. Inactive' : ''}`}
        accessibilityHint="Opens the form to edit or remove this conversion"
        accessibilityState={{ disabled: busy }}
      >
        <View style={styles.flex}>
          <Text style={[styles.rowEq, muted && styles.rowInactive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
            {equation.left}<Text style={styles.rowEqSymbol}> {equation.leftSymbol} </Text><Text style={styles.rowEqSign}>= </Text>{equation.right}<Text style={styles.rowEqSymbol}> {equation.rightSymbol}</Text>
          </Text>
          <Text style={styles.rowSub} numberOfLines={2}>{conversion.name} · {decimalsText(conversion.decimalPlaces)}</Text>
        </View>
        {onReactivate ? null : <ChevronIcon />}
      </Pressable>
      {onReactivate ? <ReactivateButton name={conversion.name} kind="conversion" busy={busy} onPress={onReactivate} /> : null}
    </View>
  );
}

function ReactivateButton({ name, kind, busy, onPress }: { name: string; kind: 'unit' | 'conversion'; busy: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.reactivate}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Reactivate ${name}`}
      accessibilityHint={`Makes this ${kind} selectable again on new records`}
      accessibilityState={{ disabled: busy, busy }}
    >
      <Text style={styles.reactivateText}>Reactivate</Text>
    </TouchableOpacity>
  );
}

/** The collapsed "Inactive units · 1" row that opens the inactive list for the tab. */
function InactiveRow({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity style={styles.inactiveRow} onPress={onToggle} activeOpacity={0.75} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={label} accessibilityHint={open ? 'Hides this list' : 'Shows this list'}>
      <Text style={styles.inactiveRowText}>{label}</Text>
      <ChevronIcon direction={open ? 'up' : 'down'} />
    </TouchableOpacity>
  );
}

/** Remove, at the bottom of an edit form, with the same promise as the confirmation that follows it. */
function RemoveBlock({ kind, busy, onRemove }: { kind: 'unit' | 'conversion'; busy: boolean; onRemove: () => void }) {
  return (
    <View style={styles.removeBlock}>
      <Text style={styles.removeHelp}>
        {kind === 'unit'
          ? 'Removing deletes this unit if nothing uses it. If a record, conversion, or catalog item depends on it, DROMEX keeps that history and moves the unit to Inactive instead.'
          : "Removing deletes this conversion if no receipt uses it. If a confirmed receipt depends on it, DROMEX keeps that receipt's saved snapshot and moves the conversion to Inactive instead."}
      </Text>
      <TouchableOpacity style={styles.removeButton} onPress={onRemove} disabled={busy} accessibilityRole="button" accessibilityLabel={`Remove this ${kind}`} accessibilityState={{ disabled: busy }}>
        <Text style={styles.removeButtonText}>Remove {kind}</Text>
      </TouchableOpacity>
    </View>
  );
}

/** The rule typed so far, large, so it can be read as a sentence while it is being filled in. */
function RuleLine({ rule }: { rule: ReturnType<typeof ruleLine> }) {
  return (
    <Text style={styles.ruleText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} accessibilityRole="text" accessibilityLabel={`${rule.left} ${rule.leftSymbol} equals ${rule.right} ${rule.rightSymbol}`}>
      {rule.left}<Text style={styles.ruleSymbol}> {rule.leftSymbol} </Text><Text style={styles.ruleSign}>= </Text>{rule.right}<Text style={styles.ruleSymbol}> {rule.rightSymbol}</Text>
    </Text>
  );
}

/** The closed unit control: the chosen unit, or an invitation to choose one. It opens a list inside the form. */
function UnitSelect({ label, unit, open, onToggle }: { label: string; unit: MeasurementUnit | undefined; open: boolean; onToggle: () => void }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={[styles.unitSelect, open && styles.unitSelectOpen]} onPress={onToggle} accessibilityRole="button" accessibilityLabel={`${label.replace(' *', '')}: ${unitChoiceText(unit)}`} accessibilityHint={open ? 'Closes the list of units' : 'Opens the list of units'} accessibilityState={{ expanded: open }}>
        <Text style={[styles.unitSelectText, !unit && styles.unitSelectPlaceholder]} numberOfLines={1}>
          {unit ? <Text style={styles.unitSelectSymbol}>{unit.symbol} </Text> : null}{unit ? unit.name : 'Choose a unit'}
        </Text>
        <ChevronIcon direction={open ? 'up' : 'down'} />
      </TouchableOpacity>
    </View>
  );
}

/**
 * The units to choose from, opened inside the form (not as a second pop-up on top of the form). It has its own search
 * once there are more than 8 units, and choosing one closes it.
 */
function UnitList({ label, units, selectedId, onSelect }: { label: string; units: MeasurementUnit[]; selectedId: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const visible = units.filter((unit) => unitMatches(unit, query));
  return (
    <View style={styles.unitList} accessibilityLabel={label}>
      {needsSearch(units.length) ? <SearchBar value={query} onChange={setQuery} placeholder="Search units" label={`Search units for ${label}`} /> : null}
      {visible.map((unit, index) => {
        const selected = unit.id === selectedId;
        return (
          <TouchableOpacity
            key={unit.id}
            style={[styles.unitListRow, index > 0 && styles.listRowRule, selected && styles.unitListRowSelected]}
            onPress={() => onSelect(unit.id)}
            accessibilityRole="radio"
            accessibilityLabel={`${unit.name}, symbol ${unit.symbol}`}
            accessibilityState={{ checked: selected }}
          >
            <Text style={styles.unitListSymbol} numberOfLines={1}>{unit.symbol}</Text>
            <Text style={styles.unitListName} numberOfLines={1}>{unit.name}</Text>
            {selected ? <Text style={styles.unitListCheck}>Chosen</Text> : null}
          </TouchableOpacity>
        );
      })}
      {!visible.length ? <Text style={styles.fieldHelper}>No unit matches that search.</Text> : null}
    </View>
  );
}

function EmptyBlock({ title, body, onClearSearch }: { title: string; body: string; onClearSearch?: () => void }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.helper}>{body}</Text>
      {onClearSearch ? (
        <TouchableOpacity style={styles.emptyClear} onPress={onClearSearch} accessibilityRole="button" accessibilityLabel="Clear search">
          <Text style={styles.emptyClearText}>Clear search</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function SearchBar({ value, onChange, placeholder, label }: { value: string; onChange: (next: string) => void; placeholder: string; label: string }) {
  return (
    <View style={styles.searchBar}>
      <Text style={styles.searchGlyph}>⌕</Text>
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#6B7681"
        accessibilityLabel={label}
        autoCorrect={false}
      />
      {value.length ? (
        <TouchableOpacity style={styles.searchClear} onPress={() => onChange('')} accessibilityRole="button" accessibilityLabel="Clear search">
          <Text style={styles.searchClearText}>×</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function Field({ label, helper, ...props }: {
  label: string; helper?: string; value: string; onChangeText: (value: string) => void;
  placeholder?: string; keyboardType?: 'default' | 'decimal-pad' | 'number-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor="#6B7681" accessibilityLabel={label} autoCorrect={false} {...props} />
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
    </View>
  );
}


function Sheet({ visible, reducedMotion, eyebrow, title, onClose, footer, children }: {
  visible: boolean; reducedMotion: boolean; eyebrow: string; title: string; onClose: () => void;
  footer: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      animationType={reducedMotion ? 'none' : 'slide'}
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View style={styles.flex}>
            <Text style={styles.sheetEyebrow}>{eyebrow}</Text>
            <Text style={styles.sheetTitle}>{title}</Text>
          </View>
          <TouchableOpacity style={styles.sheetClose} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close without saving">
            <Text style={styles.sheetCloseText}>Close</Text>
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          <View style={styles.sheetFooter}>{footer}</View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function SheetFooter({ busy, saveLabel, saveAccessibilityLabel, onCancel, onSave }: {
  busy: boolean; saveLabel: string; saveAccessibilityLabel: string; onCancel: () => void; onSave: () => void;
}) {
  return (
    <>
      <TouchableOpacity
        style={styles.cancelButton}
        onPress={onCancel}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Cancel without saving"
        accessibilityState={{ disabled: busy }}
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.saveButton, busy && styles.buttonDisabled]}
        onPress={onSave}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={saveAccessibilityLabel}
        accessibilityState={{ disabled: busy, busy }}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveButtonText}>{saveLabel}</Text>}
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, paddingBottom: 24, gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  error: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '700', lineHeight: 19 },
  success: { color: colors.success, backgroundColor: '#E5F3EC', borderRadius: 10, padding: 12, fontWeight: '700', lineHeight: 19 },

  screenState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  screenStateTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  screenStateBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: { minHeight: 48, marginTop: 6, paddingHorizontal: 24, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },





  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, shadowColor: '#17212B', shadowOpacity: .05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  searchGlyph: { color: colors.brand, fontSize: 19, fontWeight: '900' },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '600', paddingVertical: 12 },
  searchClear: { minHeight: 32, minWidth: 32, borderRadius: 16, backgroundColor: '#EEEAE2', alignItems: 'center', justifyContent: 'center' },
  searchClearText: { color: colors.muted, fontSize: 16, fontWeight: '900', lineHeight: 18 },

  rowTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },

  symbolTile: { minWidth: 46, height: 46, borderRadius: 13, paddingHorizontal: 8, backgroundColor: '#E8F0F6', alignItems: 'center', justifyContent: 'center' },
  symbolTileText: { color: colors.navy, fontSize: 15, fontWeight: '900' },


  quietAction: { minHeight: 48, justifyContent: 'center' },
  quietActionText: { color: colors.brandDark, fontWeight: '800', fontSize: 14 },



  empty: { borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', borderRadius: 14, padding: 18, gap: 5 },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  emptyClear: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  emptyClearText: { color: colors.brandDark, fontWeight: '900', fontSize: 12 },

  buttonDisabled: { opacity: .4 },
  note: { color: SECONDARY, fontSize: 13, lineHeight: 19 },

  list: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', shadowColor: '#17212B', shadowOpacity: .06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  listRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  listRowTall: { minHeight: 68 },
  listRowRule: { borderTopWidth: 1, borderTopColor: '#ECE6DA' },
  rowMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 8, minHeight: 56 },
  rowSymbol: { width: 52, color: colors.navy, fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'] },
  rowName: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 16, fontWeight: '600' },
  rowInactive: { color: SECONDARY },
  rowEq: { color: colors.navy, fontSize: 18, fontWeight: '900', fontVariant: ['tabular-nums'] },
  rowEqSymbol: { color: SECONDARY, fontSize: 13, fontWeight: '700' },
  rowEqSign: { color: colors.brandDark, fontWeight: '900' },
  rowSub: { color: SECONDARY, fontSize: 13, lineHeight: 18, marginTop: 3 },
  reactivate: { minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: 14 },
  reactivateText: { color: colors.success, fontWeight: '800', fontSize: 14 },

  inactiveRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  inactiveRowText: { color: SECONDARY, fontSize: 14, fontWeight: '700' },

  addBar: { backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 6, shadowColor: '#17212B', shadowOpacity: .1, shadowRadius: 8, shadowOffset: { width: 0, height: -3 }, elevation: 8 },
  addHint: { color: SECONDARY, fontSize: 12, textAlign: 'center' },
  addButton: { minHeight: 50, borderRadius: 13, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  addButtonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },

  removeBlock: { gap: 10, marginTop: 8, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.line },
  removeHelp: { color: SECONDARY, fontSize: 12, lineHeight: 17 },
  removeButton: { minHeight: 48, borderRadius: 13, borderWidth: 1.5, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  removeButtonText: { color: colors.danger, fontWeight: '800', fontSize: 15 },

  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14 },
  sheetEyebrow: { color: colors.brand, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  sheetTitle: { color: colors.ink, fontSize: 24, fontWeight: '900', marginTop: 2 },
  sheetClose: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sheetCloseText: { color: colors.ink, fontWeight: '800' },
  sheetIntro: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  sheetBody: { padding: 20, paddingTop: 4, paddingBottom: 28, gap: 16 },
  sheetFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, backgroundColor: colors.surface, shadowColor: '#17212B', shadowOpacity: .12, shadowRadius: 8, shadowOffset: { width: 0, height: -3 }, elevation: 8 },
  cancelButton: { minHeight: 48, paddingHorizontal: 20, borderRadius: 13, borderWidth: 1, borderColor: colors.navy, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { color: colors.navy, fontWeight: '800', fontSize: 15 },
  saveButton: { flex: 1, minHeight: 48, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  previewCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  previewLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: .7 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  ruleBlock: { gap: 2 },
  ruleLabel: { color: SECONDARY, fontSize: 12 },
  ruleText: { color: colors.navy, fontSize: 30, fontWeight: '900', fontVariant: ['tabular-nums'] },
  ruleSymbol: { color: SECONDARY, fontSize: 17, fontWeight: '700' },
  ruleSign: { color: colors.brandDark, fontWeight: '900' },
  pairGroup: { gap: 8 },
  groupTitle: { color: SECONDARY, fontSize: 12, fontWeight: '800' },
  pairRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  amountCol: { flex: 0.8, minWidth: 0 },
  unitCol: { flex: 1.2, minWidth: 0 },
  equalsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: -4 },
  equalsLine: { flex: 1, height: 1, backgroundColor: colors.line },
  equalsText: { color: colors.brandDark, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  unitSelect: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, backgroundColor: '#FCFBF8' },
  unitSelectOpen: { borderColor: colors.navy, borderWidth: 2 },
  unitSelectText: { flex: 1, color: colors.ink, fontSize: 15 },
  unitSelectSymbol: { color: colors.navy, fontWeight: '900' },
  unitSelectPlaceholder: { color: '#6B7681' },
  unitList: { borderWidth: 1, borderColor: colors.line, borderRadius: 12, backgroundColor: colors.surface, overflow: 'hidden', gap: 8, padding: 8 },
  unitListRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 10, borderRadius: 8 },
  unitListRowSelected: { backgroundColor: '#EAF1F6' },
  unitListSymbol: { width: 48, color: colors.navy, fontSize: 16, fontWeight: '900' },
  unitListName: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: '600' },
  unitListCheck: { color: colors.navy, fontSize: 12, fontWeight: '900' },
  decimalRow: { flexDirection: 'row', gap: 6 },
  decimalButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 10, backgroundColor: colors.surface },
  decimalButtonSelected: { borderColor: colors.navy, borderWidth: 2, backgroundColor: '#EAF1F6' },
  decimalText: { color: SECONDARY, fontSize: 15, fontWeight: '800' },
  decimalTextSelected: { color: colors.navy, fontWeight: '900' },
  field: { gap: 6 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, backgroundColor: '#FCFBF8' },
  fieldHelper: { color: colors.muted, fontSize: 12, lineHeight: 17 },

});
