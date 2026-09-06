import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import type { LoadRepository } from '../../data/repositories/LoadRepository';
import type { ConversionOption, MeasurementUnit } from '../../domain/loads';
import { useReducedMotion } from '../components/ExpandableMenu';
import { colors } from '../theme';

const SEARCH_THRESHOLD = 8;

/** Grouped, trailing-zero-free rendering of a stored quantity, which SQLite keeps as a REAL. */
function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const [whole = '0', fraction] = Number(value.toFixed(6)).toString().split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

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

  const unitQuery = unitSearch.trim().toLocaleLowerCase('en-US');
  const conversionQuery = conversionSearch.trim().toLocaleLowerCase('en-US');
  const matchesUnit = useCallback(
    (unit: MeasurementUnit) => !unitQuery || `${unit.name} ${unit.symbol}`.toLocaleLowerCase('en-US').includes(unitQuery),
    [unitQuery],
  );
  const matchesConversion = useCallback(
    (value: ConversionOption) =>
      !conversionQuery ||
      `${value.name} ${value.inputUnitName} ${value.inputUnitSymbol} ${value.outputUnitName} ${value.outputUnitSymbol}`
        .toLocaleLowerCase('en-US')
        .includes(conversionQuery),
    [conversionQuery],
  );

  const visibleActiveUnits = activeUnits.filter(matchesUnit);
  const visibleInactiveUnits = inactiveUnits.filter(matchesUnit);
  const visibleActiveConversions = activeConversions.filter(matchesConversion);
  const visibleInactiveConversions = inactiveConversions.filter(matchesConversion);

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

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <TouchableOpacity onPress={onBack} style={styles.heroBack} accessibilityRole="button" accessibilityLabel="Back">
              <Text style={styles.heroBackText}>Back</Text>
            </TouchableOpacity>
            <View style={styles.flex}>
              <Text style={styles.heroEyebrow}>SETUP</Text>
              <Text style={styles.heroTitle}>Units & Conversions</Text>
            </View>
          </View>
          <Text style={styles.heroPurpose}>Define how quantities are measured, and how one unit turns into another on receipts and supplier loads.</Text>
          <View style={styles.heroSummaryRow}>
            <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{activeUnits.length}</Text><Text style={styles.heroSummaryLabel}>ACTIVE UNITS</Text></View>
            <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{activeConversions.length}</Text><Text style={styles.heroSummaryLabel}>ACTIVE CONVERSIONS</Text></View>
            <View style={styles.heroSummaryItem}><Text style={styles.heroSummaryValue}>{inactiveUnits.length + inactiveConversions.length}</Text><Text style={styles.heroSummaryLabel}>INACTIVE</Text></View>
          </View>
        </View>

        {error && unitSheet === 'closed' && conversionSheet === 'closed' ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text>
        ) : null}
        {message ? <Text style={styles.success} accessibilityRole="alert" accessibilityLiveRegion="polite">{message}</Text> : null}

        <SectionHeading number="01" title="Units" count={activeUnits.length} countLabel={`${activeUnits.length} active unit${activeUnits.length === 1 ? '' : 's'}`} />
        <Text style={styles.sectionBody}>A unit is how a quantity is measured, such as tonnes, cubic metres, litres, or pieces.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={openAddUnit} accessibilityRole="button" accessibilityLabel="Add a measurement unit">
          <Text style={styles.primaryButtonLabel}>Add Unit</Text>
        </TouchableOpacity>

        {units.length > SEARCH_THRESHOLD ? (
          <SearchBar
            value={unitSearch}
            onChange={setUnitSearch}
            placeholder="Search unit name or symbol"
            label="Search units by name or symbol"
          />
        ) : null}

        {visibleActiveUnits.length ? (
          visibleActiveUnits.map((unit) => (
            <UnitRow key={unit.id} unit={unit} busy={busy} onEdit={() => openEditUnit(unit)} onRemove={() => confirmRemoveUnit(unit)} />
          ))
        ) : (
          <EmptyBlock
            title={unitQuery ? 'No matching units' : 'No active units yet'}
            body={unitQuery ? `No active unit matches "${unitSearch.trim()}".` : 'Add a unit such as Tonne (t) or Cubic metre (m³) so quantities can be recorded.'}
            onClearSearch={unitQuery ? () => setUnitSearch('') : undefined}
          />
        )}

        {inactiveUnits.length ? (
          <>
            <StatusBand
              title="Inactive Units"
              count={inactiveUnits.length}
              noun="unit"
              open={inactiveUnitsOpen}
              onToggle={() => toggleSection(setInactiveUnitsOpen)}
            />
            {inactiveUnitsOpen ? (
              visibleInactiveUnits.length ? (
                visibleInactiveUnits.map((unit) => (
                  <UnitRow
                    key={unit.id}
                    unit={unit}
                    busy={busy}
                    onEdit={() => openEditUnit(unit)}
                    onRemove={() => confirmRemoveUnit(unit)}
                    onReactivate={() => void run(() => repository.setUnitActive(unit.id, true), 'Unit reactivated.', 'Could not reactivate this unit.')}
                  />
                ))
              ) : (
                <EmptyBlock
                  title="No matching units"
                  body={`No inactive unit matches "${unitSearch.trim()}".`}
                  onClearSearch={() => setUnitSearch('')}
                />
              )
            ) : null}
          </>
        ) : null}

        <SectionHeading number="02" title="Conversions" count={activeConversions.length} countLabel={`${activeConversions.length} active conversion${activeConversions.length === 1 ? '' : 's'}`} />
        <Text style={styles.sectionBody}>A conversion changes one unit into another, such as 1,000 kg = 1 tonne. Confirmed receipts keep the conversion they were saved with, so an edit only affects future calculations.</Text>
        <TouchableOpacity
          style={[styles.primaryButton, !activeUnits.length && styles.buttonDisabled]}
          onPress={openAddConversion}
          disabled={!activeUnits.length}
          accessibilityRole="button"
          accessibilityLabel="Add a conversion"
          accessibilityHint={activeUnits.length ? undefined : 'Add at least one unit first'}
          accessibilityState={{ disabled: !activeUnits.length }}
        >
          <Text style={styles.primaryButtonLabel}>Add Conversion</Text>
        </TouchableOpacity>
        {!activeUnits.length ? <Text style={styles.helper}>Add at least one active unit before creating a conversion.</Text> : null}

        {conversions.length > SEARCH_THRESHOLD ? (
          <SearchBar
            value={conversionSearch}
            onChange={setConversionSearch}
            placeholder="Search conversion or unit name"
            label="Search conversions by name or unit"
          />
        ) : null}

        {visibleActiveConversions.length ? (
          visibleActiveConversions.map((value) => (
            <ConversionRow key={value.id} conversion={value} busy={busy} onEdit={() => openEditConversion(value)} onRemove={() => confirmRemoveConversion(value)} />
          ))
        ) : (
          <EmptyBlock
            title={conversionQuery ? 'No matching conversions' : 'No active conversions yet'}
            body={conversionQuery ? `No active conversion matches "${conversionSearch.trim()}".` : 'Add a rule such as 1,000 kg = 1 t so receipts can bill in the unit you sell in.'}
            onClearSearch={conversionQuery ? () => setConversionSearch('') : undefined}
          />
        )}

        {inactiveConversions.length ? (
          <>
            <StatusBand
              title="Inactive Conversions"
              count={inactiveConversions.length}
              noun="conversion"
              open={inactiveConversionsOpen}
              onToggle={() => toggleSection(setInactiveConversionsOpen)}
            />
            {inactiveConversionsOpen ? (
              visibleInactiveConversions.length ? (
                visibleInactiveConversions.map((value) => (
                  <ConversionRow
                    key={value.id}
                    conversion={value}
                    busy={busy}
                    onEdit={() => openEditConversion(value)}
                    onRemove={() => confirmRemoveConversion(value)}
                    onReactivate={() => void run(() => repository.setConversionActive(value.id, true), 'Conversion reactivated.', 'Could not reactivate this conversion.')}
                  />
                ))
              ) : (
                <EmptyBlock
                  title="No matching conversions"
                  body={`No inactive conversion matches "${conversionSearch.trim()}".`}
                  onClearSearch={() => setConversionSearch('')}
                />
              )
            ) : null}
          </>
        ) : null}
      </ScrollView>

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
        <Text style={styles.sheetIntro}>A conversion states how much of the input unit equals how much of the output unit.</Text>
        {error ? <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">{error}</Text> : null}

        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>THIS RULE READS AS</Text>
          <Equation
            inputQuantity={inputQuantity}
            inputSymbol={units.find((unit) => unit.id === inputUnitId)?.symbol ?? '?'}
            outputQuantity={outputQuantity}
            outputSymbol={units.find((unit) => unit.id === outputUnitId)?.symbol ?? '?'}
          />
        </View>

        <Field label="Conversion name *" value={conversionName} onChangeText={setConversionName} placeholder="Kilograms to tonnes" helper="How you will recognise this rule in a picker. Must be unique." />

        <UnitPicker label="Input unit *" units={activeUnits} selectedId={inputUnitId} onSelect={setInputUnitId} />
        <Field label="Input quantity *" value={inputQuantity} onChangeText={setInputQuantity} keyboardType="decimal-pad" helper="How much of the input unit the rule starts from." />

        <UnitPicker label="Output unit *" units={activeUnits} selectedId={outputUnitId} onSelect={setOutputUnitId} />
        <Field label="Output quantity *" value={outputQuantity} onChangeText={setOutputQuantity} keyboardType="decimal-pad" helper="What that input quantity is equal to." />

        <Field label="Decimal places *" value={decimals} onChangeText={setDecimals} keyboardType="number-pad" helper="How many decimals the converted quantity shows. A whole number from 0 to 6." />
      </Sheet>
    </>
  );
}

function SectionHeading({ number, title, count, countLabel }: { number: string; title: string; count: number; countLabel: string }) {
  return (
    <View style={styles.sectionHeading} accessibilityRole="header" accessibilityLabel={`Section ${number}. ${title}. ${countLabel}.`}>
      <View style={styles.sectionMarker}><Text style={styles.sectionMarkerText}>{number}</Text></View>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

function UnitRow({ unit, busy, onEdit, onRemove, onReactivate }: {
  unit: MeasurementUnit; busy: boolean; onEdit: () => void; onRemove: () => void; onReactivate?: () => void;
}) {
  return (
    <View style={[styles.record, !unit.isActive && styles.recordInactive]}>
      <View style={styles.recordTop}>
        <View style={[styles.symbolTile, !unit.isActive && styles.symbolTileInactive]}>
          <Text style={styles.symbolTileText} numberOfLines={1}>{unit.symbol}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.rowTitle} numberOfLines={2}>{unit.name}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>Symbol {unit.symbol}</Text>
        </View>
        {!unit.isActive ? <InactivePill /> : null}
      </View>
      <RowActions
        busy={busy}
        name={unit.name}
        kind="unit"
        onEdit={onEdit}
        onRemove={onRemove}
        onReactivate={onReactivate}
      />
    </View>
  );
}

function ConversionRow({ conversion, busy, onEdit, onRemove, onReactivate }: {
  conversion: ConversionOption; busy: boolean; onEdit: () => void; onRemove: () => void; onReactivate?: () => void;
}) {
  return (
    <View style={[styles.record, !conversion.isActive && styles.recordInactive]}>
      <View style={styles.recordTop}>
        <View style={styles.flex}>
          <Text style={styles.rowTitle} numberOfLines={2}>{conversion.name}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {conversion.inputUnitName} to {conversion.outputUnitName} · {conversion.decimalPlaces} decimal{conversion.decimalPlaces === 1 ? '' : 's'}
          </Text>
        </View>
        {!conversion.isActive ? <InactivePill /> : null}
      </View>
      <Equation
        inputQuantity={conversion.inputQuantity}
        inputSymbol={conversion.inputUnitSymbol}
        outputQuantity={conversion.outputQuantity}
        outputSymbol={conversion.outputUnitSymbol}
        muted={!conversion.isActive}
      />
      <RowActions
        busy={busy}
        name={conversion.name}
        kind="conversion"
        onEdit={onEdit}
        onRemove={onRemove}
        onReactivate={onReactivate}
      />
    </View>
  );
}

/** The rule itself, given the weight of a headline so a conversion can never be mistaken for a unit. */
function Equation({ inputQuantity, inputSymbol, outputQuantity, outputSymbol, muted = false }: {
  inputQuantity: number | string; inputSymbol: string; outputQuantity: number | string; outputSymbol: string; muted?: boolean;
}) {
  const left = typeof inputQuantity === 'number' ? formatQuantity(inputQuantity) : (inputQuantity.trim() || '?');
  const right = typeof outputQuantity === 'number' ? formatQuantity(outputQuantity) : (outputQuantity.trim() || '?');
  return (
    <View
      style={[styles.equation, muted && styles.equationMuted]}
      accessibilityRole="text"
      accessibilityLabel={`${left} ${inputSymbol} equals ${right} ${outputSymbol}`}
    >
      <View style={styles.equationSide}>
        <Text style={styles.equationValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{left}</Text>
        <Text style={styles.equationSymbol} numberOfLines={1}>{inputSymbol}</Text>
      </View>
      <Text style={styles.equationSign}>=</Text>
      <View style={styles.equationSide}>
        <Text style={styles.equationValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{right}</Text>
        <Text style={styles.equationSymbol} numberOfLines={1}>{outputSymbol}</Text>
      </View>
    </View>
  );
}

function RowActions({ busy, name, kind, onEdit, onRemove, onReactivate }: {
  busy: boolean; name: string; kind: 'unit' | 'conversion'; onEdit: () => void; onRemove: () => void; onReactivate?: () => void;
}) {
  return (
    <View style={styles.rowActions}>
      <TouchableOpacity
        style={styles.quietAction}
        onPress={onEdit}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${name}`}
        accessibilityHint={`Opens a form to change this ${kind}`}
        accessibilityState={{ disabled: busy }}
      >
        <Text style={styles.quietActionText}>Edit</Text>
      </TouchableOpacity>
      {onReactivate ? (
        <TouchableOpacity
          style={styles.quietAction}
          onPress={onReactivate}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Reactivate ${name}`}
          accessibilityHint={`Makes this ${kind} selectable again on new records`}
          accessibilityState={{ disabled: busy, busy }}
        >
          <Text style={styles.reactivateActionText}>Reactivate</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.flex} />
      <TouchableOpacity
        style={styles.quietAction}
        onPress={onRemove}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name}`}
        accessibilityHint={`Deletes this ${kind} if nothing uses it, otherwise moves it to Inactive`}
        accessibilityState={{ disabled: busy }}
      >
        <Text style={styles.removeActionText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

function InactivePill() {
  return (
    <View style={styles.inactivePill}>
      <View style={styles.inactiveDot} />
      <Text style={styles.inactivePillText}>Inactive</Text>
    </View>
  );
}

function StatusBand({ title, count, noun, open, onToggle }: { title: string; count: number; noun: string; open: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      style={styles.band}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${title}, ${count} ${noun}${count === 1 ? '' : 's'}`}
      accessibilityHint={open ? 'Hides this list' : 'Shows this list'}
    >
      <View style={styles.flex}>
        <Text style={styles.bandTitle}>{title}</Text>
        <Text style={styles.bandHint}>{open ? 'Tap to hide' : 'Tap to view'} · {count} {noun}{count === 1 ? '' : 's'}</Text>
      </View>
      <View style={styles.bandRight}>
        <View style={styles.countBadge}><Text style={styles.countBadgeText}>{count}</Text></View>
        <Text style={styles.expandMark}>{open ? '×' : '+'}</Text>
      </View>
    </TouchableOpacity>
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

/**
 * Units are a small, fixed set, which the design system routes to chips rather than the
 * searchable modal picker. Keeping it inline also avoids nesting a Modal inside the sheet.
 */
function UnitPicker({ label, units, selectedId, onSelect }: { label: string; units: MeasurementUnit[]; selectedId: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase('en-US');
  const visible = needle ? units.filter((unit) => `${unit.name} ${unit.symbol}`.toLocaleLowerCase('en-US').includes(needle)) : units;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {units.length > SEARCH_THRESHOLD ? (
        <SearchBar value={query} onChange={setQuery} placeholder="Search units" label={`Search units for ${label.replace(' *', '')}`} />
      ) : null}
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label.replace(' *', '')}>
        {visible.map((unit) => {
          const selected = unit.id === selectedId;
          return (
            <TouchableOpacity
              key={unit.id}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onSelect(unit.id)}
              accessibilityRole="radio"
              accessibilityLabel={`${unit.name}, symbol ${unit.symbol}`}
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipSymbol, selected && styles.chipSymbolSelected]}>{unit.symbol}</Text>
              <Text style={[styles.chipName, selected && styles.chipNameSelected]} numberOfLines={1}>{unit.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {!visible.length ? <Text style={styles.fieldHelper}>No unit matches that search.</Text> : null}
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
  content: { padding: 20, paddingBottom: 42, gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, backgroundColor: '#FCE8E6', borderRadius: 10, padding: 12, fontWeight: '700', lineHeight: 19 },
  success: { color: colors.success, backgroundColor: '#E5F3EC', borderRadius: 10, padding: 12, fontWeight: '700', lineHeight: 19 },

  screenState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 10 },
  screenStateTitle: { color: colors.ink, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  screenStateBody: { color: colors.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: { minHeight: 48, marginTop: 6, paddingHorizontal: 24, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  retryButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  hero: { backgroundColor: colors.navy, borderRadius: 18, padding: 18, gap: 12, shadowColor: colors.navyDeep, shadowOpacity: .22, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroBack: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroBackText: { color: '#FFF8ED', fontWeight: '800' },
  heroEyebrow: { color: '#F2A184', fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: '#FFF8ED', fontSize: 26, fontWeight: '900', marginTop: 2 },
  heroPurpose: { color: '#D5E4EF', fontSize: 12, lineHeight: 17 },
  heroSummaryRow: { flexDirection: 'row', gap: 12, marginTop: 2, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.22)' },
  heroSummaryItem: { flex: 1, gap: 2 },
  heroSummaryValue: { color: '#FFF8ED', fontSize: 20, fontWeight: '900' },
  heroSummaryLabel: { color: '#D5E4EF', fontSize: 9, fontWeight: '800', letterSpacing: .6 },

  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  sectionMarker: { minWidth: 30, height: 30, borderRadius: 9, backgroundColor: colors.navy, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  sectionMarkerText: { color: '#FFF8ED', fontSize: 12, fontWeight: '900', letterSpacing: .4 },
  sectionTitle: { color: colors.ink, fontSize: 20, fontWeight: '800', flex: 1 },
  sectionCount: { color: colors.brandDark, backgroundColor: '#FBE9E4', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 11, fontWeight: '900', fontSize: 12, overflow: 'hidden' },
  sectionBody: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: -4 },

  primaryButton: { minHeight: 48, borderRadius: 13, backgroundColor: colors.brand, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryButtonLabel: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  buttonDisabled: { opacity: .4 },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, shadowColor: '#17212B', shadowOpacity: .05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  searchGlyph: { color: colors.brand, fontSize: 19, fontWeight: '900' },
  searchInput: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '600', paddingVertical: 12 },
  searchClear: { minHeight: 32, minWidth: 32, borderRadius: 16, backgroundColor: '#EEEAE2', alignItems: 'center', justifyContent: 'center' },
  searchClearText: { color: colors.muted, fontSize: 16, fontWeight: '900', lineHeight: 18 },

  record: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, gap: 10 },
  recordInactive: { backgroundColor: colors.creamSoft, borderWidth: 1, borderColor: colors.line },
  recordTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  rowMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },

  symbolTile: { minWidth: 46, height: 46, borderRadius: 13, paddingHorizontal: 8, backgroundColor: '#E8F0F6', alignItems: 'center', justifyContent: 'center' },
  symbolTileInactive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  symbolTileText: { color: colors.navy, fontSize: 15, fontWeight: '900' },

  equation: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.cream, borderWidth: 1, borderColor: '#E8DED0', borderRadius: 13, paddingHorizontal: 14, paddingVertical: 12 },
  equationMuted: { backgroundColor: colors.surface },
  equationSide: { flex: 1, minWidth: 0, gap: 1 },
  equationValue: { color: colors.navy, fontSize: 20, fontWeight: '900' },
  equationSymbol: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  equationSign: { color: colors.brandDark, fontSize: 19, fontWeight: '900' },

  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 16, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 2 },
  quietAction: { minHeight: 48, justifyContent: 'center' },
  quietActionText: { color: colors.brandDark, fontWeight: '800', fontSize: 14 },
  reactivateActionText: { color: colors.success, fontWeight: '800', fontSize: 14 },
  removeActionText: { color: colors.danger, fontWeight: '800', fontSize: 14 },

  inactivePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: colors.line, flexShrink: 0 },
  inactiveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  inactivePillText: { color: colors.muted, fontWeight: '900', fontSize: 11 },

  band: { minHeight: 56, backgroundColor: colors.creamSoft, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  bandTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  bandHint: { color: colors.muted, fontSize: 11, marginTop: 2 },
  bandRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countBadge: { minWidth: 26, height: 26, borderRadius: 13, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  countBadgeText: { color: colors.brandDark, fontWeight: '900', fontSize: 12 },
  expandMark: { color: colors.brandDark, fontSize: 24, fontWeight: '700', width: 22, textAlign: 'center' },

  empty: { borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', borderRadius: 14, padding: 18, gap: 5 },
  emptyTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  emptyClear: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  emptyClearText: { color: colors.brandDark, fontWeight: '900', fontSize: 12 },

  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14 },
  sheetEyebrow: { color: colors.brand, fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  sheetTitle: { color: colors.ink, fontSize: 24, fontWeight: '900', marginTop: 2 },
  sheetClose: { minHeight: 48, minWidth: 48, paddingHorizontal: 14, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sheetCloseText: { color: colors.ink, fontWeight: '800' },
  sheetBody: { padding: 20, paddingTop: 4, paddingBottom: 28, gap: 16 },
  sheetIntro: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  sheetFooter: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, backgroundColor: colors.surface, shadowColor: '#17212B', shadowOpacity: .12, shadowRadius: 8, shadowOffset: { width: 0, height: -3 }, elevation: 8 },
  cancelButton: { minHeight: 48, paddingHorizontal: 20, borderRadius: 13, borderWidth: 1, borderColor: colors.navy, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  cancelButtonText: { color: colors.navy, fontWeight: '800', fontSize: 15 },
  saveButton: { flex: 1, minHeight: 48, borderRadius: 13, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  saveButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  previewCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14, gap: 10 },
  previewLabel: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: .7 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  field: { gap: 6 },
  label: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, fontSize: 15, backgroundColor: '#FCFBF8' },
  fieldHelper: { color: colors.muted, fontSize: 12, lineHeight: 17 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 7, backgroundColor: '#FCFBF8' },
  chipSelected: { borderColor: colors.brand, backgroundColor: '#FBE9E4' },
  chipSymbol: { color: colors.navy, fontWeight: '900', fontSize: 14 },
  chipSymbolSelected: { color: colors.brandDark },
  chipName: { color: colors.muted, fontSize: 11, marginTop: 1 },
  chipNameSelected: { color: colors.brandDark },
});
