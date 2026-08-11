import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { LoadRepository } from '../../data/repositories/LoadRepository';
import type { LoadSetupOptions } from '../../domain/loads';
import { SearchableSelect } from '../components/SearchableSelect';
import { colors } from '../theme';

export function ReceiptSetupScreen({ repository, onBack }: { repository: LoadRepository; onBack: () => void }) {
  const [options, setOptions] = useState<LoadSetupOptions | null>(null);
  const [unitName, setUnitName] = useState(''); const [unitSymbol, setUnitSymbol] = useState('');
  const [conversionName, setConversionName] = useState(''); const [inputUnitId, setInputUnitId] = useState('unit_kg');
  const [outputUnitId, setOutputUnitId] = useState('unit_ton'); const [inputQuantity, setInputQuantity] = useState('1000');
  const [outputQuantity, setOutputQuantity] = useState('1'); const [decimals, setDecimals] = useState('3');
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => setOptions(await repository.getSetupOptions()), [repository]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); await refresh(); setMessage(success); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save setup.'); }
    finally { setBusy(false); }
  }

  if (!options) return <View style={styles.loading}><Text style={styles.helper}>Loading receipt setup…</Text></View>;
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Header title="Receipt setup" onBack={onBack} />
      <Text style={styles.helper}>Manage measurement units and conversion options here. Projects now have their own section on Home.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}{message ? <Text style={styles.success}>{message}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Measurement units</Text>
        <Text style={styles.helper}>{options.units.map((unit) => `${unit.name} (${unit.symbol})`).join('  ·  ')}</Text>
        <Field label="New unit name" value={unitName} onChangeText={setUnitName} placeholder="Cubic metre" />
        <Field label="Symbol" value={unitSymbol} onChangeText={setUnitSymbol} placeholder="m³" />
        <SaveButton label="Add unit" busy={busy} onPress={() => void run(async () => {
          await repository.createUnit({ name: unitName, symbol: unitSymbol }); setUnitName(''); setUnitSymbol('');
        }, 'Measurement unit added.')} />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Conversion options</Text>
        {options.conversions.map((conversion) => <View key={conversion.id} style={styles.savedRow}><Text style={styles.savedTitle}>{conversion.name}</Text><Text style={styles.helper}>{conversion.inputQuantity} {conversion.inputUnitSymbol} = {conversion.outputQuantity} {conversion.outputUnitSymbol} · {conversion.decimalPlaces} decimals</Text></View>)}
        <Field label="Conversion name" value={conversionName} onChangeText={setConversionName} placeholder="Kilograms to cubic metres" />
        <SearchableSelect label="Input unit *" options={options.units.map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))} selectedId={inputUnitId} onSelect={setInputUnitId} />
        <SearchableSelect label="Output unit *" options={options.units.map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))} selectedId={outputUnitId} onSelect={setOutputUnitId} />
        <View style={styles.twoColumns}><View style={styles.column}><Field label="Input quantity" value={inputQuantity} onChangeText={setInputQuantity} keyboardType="decimal-pad" /></View><View style={styles.column}><Field label="Output quantity" value={outputQuantity} onChangeText={setOutputQuantity} keyboardType="decimal-pad" /></View></View>
        <Field label="Displayed decimal places (0–6)" value={decimals} onChangeText={setDecimals} keyboardType="number-pad" />
        <SaveButton label="Add conversion" busy={busy} onPress={() => void run(async () => {
          await repository.createConversion({ name: conversionName, inputUnitId, outputUnitId, inputQuantity: Number(inputQuantity), outputQuantity: Number(outputQuantity), decimalPlaces: Number(decimals) }); setConversionName('');
        }, 'Conversion option added.')} />
      </View>

    </ScrollView>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) { return <View style={styles.header}><TouchableOpacity onPress={onBack} style={styles.back}><Text style={styles.backText}>Back</Text></TouchableOpacity><View><Text style={styles.eyebrow}>SETUP</Text><Text style={styles.title}>{title}</Text></View></View>; }
function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'decimal-pad' | 'number-pad' }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input, props.multiline && styles.multiline]} placeholderTextColor="#89939B" {...props} /></View>; }
function SaveButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) { return <TouchableOpacity style={styles.save} disabled={busy} onPress={onPress}><Text style={styles.saveText}>{busy ? 'Saving…' : label}</Text></TouchableOpacity>; }
const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, content: { padding: 20, paddingBottom: 40, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 }, back: { backgroundColor: colors.surface, padding: 10, borderRadius: 10 }, backText: { color: colors.ink, fontWeight: '800' }, eyebrow: { color: colors.brand, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 }, title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 }, error: { color: colors.danger, backgroundColor: '#FCE8E6', padding: 12, borderRadius: 10, fontWeight: '700' }, success: { color: colors.success, backgroundColor: '#E5F3EC', padding: 12, borderRadius: 10, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 17, gap: 12 }, cardTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, savedRow: { borderLeftWidth: 3, borderLeftColor: colors.brand, paddingLeft: 10, gap: 2 }, savedTitle: { color: colors.ink, fontWeight: '800' },
  field: { gap: 6 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, input: { borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, backgroundColor: '#FCFBF8' }, multiline: { minHeight: 70, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18 }, chipSelected: { borderColor: colors.brand, backgroundColor: '#FBE9E4' }, chipText: { color: colors.muted, fontWeight: '700' }, chipTextSelected: { color: colors.brandDark },
  twoColumns: { flexDirection: 'row', gap: 10 }, column: { flex: 1 }, save: { backgroundColor: colors.ink, padding: 13, borderRadius: 11, alignItems: 'center' }, saveText: { color: '#FFF', fontWeight: '900' },
});
