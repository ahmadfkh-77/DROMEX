import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { LoadRepository } from '../../data/repositories/LoadRepository';
import type { ConversionOption, LoadSetupOptions, MeasurementUnit } from '../../domain/loads';
import { SearchableSelect } from '../components/SearchableSelect';
import { colors } from '../theme';

export function ReceiptSetupScreen({ repository, onBack }: { repository: LoadRepository; onBack: () => void }) {
  const [options, setOptions] = useState<LoadSetupOptions | null>(null);
  const [units,setUnits]=useState<MeasurementUnit[]>([]);const[conversions,setConversions]=useState<ConversionOption[]>([]);
  const [unitName, setUnitName] = useState(''); const [unitSymbol, setUnitSymbol] = useState('');
  const [editingUnitId,setEditingUnitId]=useState<string|null>(null);
  const [conversionName, setConversionName] = useState(''); const [inputUnitId, setInputUnitId] = useState('unit_kg');
  const [outputUnitId, setOutputUnitId] = useState('unit_ton'); const [inputQuantity, setInputQuantity] = useState('1000');
  const [outputQuantity, setOutputQuantity] = useState('1'); const [decimals, setDecimals] = useState('3');
  const [editingConversionId,setEditingConversionId]=useState<string|null>(null);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {const[nextOptions,nextUnits,nextConversions]=await Promise.all([repository.getSetupOptions(),repository.listMeasurementUnits(),repository.listConversionOptions()]);setOptions(nextOptions);setUnits(nextUnits);setConversions(nextConversions);}, [repository]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(null); setMessage(null);
    try { await action(); await refresh(); setMessage(success); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save setup.'); }
    finally { setBusy(false); }
  }
  function editUnit(unit:MeasurementUnit){setEditingUnitId(unit.id);setUnitName(unit.name);setUnitSymbol(unit.symbol);}
  function clearUnit(){setEditingUnitId(null);setUnitName('');setUnitSymbol('');}
  function editConversion(value:ConversionOption){setEditingConversionId(value.id);setConversionName(value.name);setInputUnitId(value.inputUnitId);setOutputUnitId(value.outputUnitId);setInputQuantity(String(value.inputQuantity));setOutputQuantity(String(value.outputQuantity));setDecimals(String(value.decimalPlaces));}
  function clearConversion(){setEditingConversionId(null);setConversionName('');setInputQuantity('1000');setOutputQuantity('1');setDecimals('3');}
  function confirmRemoveUnit(unit:MeasurementUnit){Alert.alert('Remove measurement unit?',`${unit.name} (${unit.symbol}) will be deleted if unused. If a record depends on it, DROMEX will deactivate it and preserve history.`,[{text:'Keep',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void run(async()=>{const result=await repository.removeUnit(unit.id);if(editingUnitId===unit.id)clearUnit();setMessage(result==='deleted'?'Measurement unit deleted.':'Measurement unit is in use, so it was safely deactivated.');},'Measurement unit removed.')}]);}
  function confirmRemoveConversion(value:ConversionOption){Alert.alert('Remove conversion?',`${value.name} will be deleted if unused. If a receipt depends on it, DROMEX will deactivate it and preserve history.`,[{text:'Keep',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void run(async()=>{const result=await repository.removeConversion(value.id);if(editingConversionId===value.id)clearConversion();setMessage(result==='deleted'?'Conversion deleted.':'Conversion is in use, so it was safely deactivated.');},'Conversion removed.')}]);}

  if (!options) return <View style={styles.loading}><Text style={styles.helper}>Loading receipt setup…</Text></View>;
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Header title="Receipt setup" onBack={onBack} />
      <Text style={styles.helper}>Manage measurement units and conversion options here. Projects now have their own section on Home.</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}{message ? <Text style={styles.success}>{message}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Measurement units</Text><Text style={styles.helper}>Active choices are listed first. Remove deletes unused units; units already referenced by records are safely moved to Inactive.</Text>
        <Text style={styles.groupLabel}>ACTIVE UNITS · {units.filter(value=>value.isActive).length}</Text>{units.filter(value=>value.isActive).map(unit=><ManageRow key={unit.id} title={`${unit.name} (${unit.symbol})`} onEdit={()=>editUnit(unit)} onRemove={()=>confirmRemoveUnit(unit)}/>) }
        {units.some(value=>!value.isActive)?<><Text style={styles.groupLabel}>INACTIVE UNITS · {units.filter(value=>!value.isActive).length}</Text>{units.filter(value=>!value.isActive).map(unit=><ManageRow key={unit.id} title={`${unit.name} (${unit.symbol})`} inactive onEdit={()=>editUnit(unit)} onReactivate={()=>void run(()=>repository.setUnitActive(unit.id,true),'Measurement unit reactivated.')} onRemove={()=>confirmRemoveUnit(unit)}/>)}</>:null}
        <Text style={styles.formTitle}>{editingUnitId?'Edit measurement unit':'Add measurement unit'}</Text><Field label="Unit name" value={unitName} onChangeText={setUnitName} placeholder="Cubic metre" />
        <Field label="Symbol" value={unitSymbol} onChangeText={setUnitSymbol} placeholder="m³" />
        <View style={styles.actionRow}>{editingUnitId?<TouchableOpacity style={styles.cancelEdit} onPress={clearUnit}><Text style={styles.cancelEditText}>Cancel</Text></TouchableOpacity>:null}<View style={styles.grow}><SaveButton label={editingUnitId?'Save unit changes':'Add unit'} busy={busy} onPress={() => void run(async () => {if(editingUnitId)await repository.updateUnit(editingUnitId,{name:unitName,symbol:unitSymbol});else await repository.createUnit({ name: unitName, symbol: unitSymbol });clearUnit();}, editingUnitId?'Measurement unit updated.':'Measurement unit added.')} /></View></View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Conversion options</Text><Text style={styles.helper}>Conversions are organized by status. Editing changes future calculations only; confirmed receipts retain their saved conversion snapshots.</Text>
        <Text style={styles.groupLabel}>ACTIVE CONVERSIONS · {conversions.filter(value=>value.isActive).length}</Text>{conversions.filter(value=>value.isActive).map(value=><ManageRow key={value.id} title={value.name} detail={`${value.inputQuantity} ${value.inputUnitSymbol} = ${value.outputQuantity} ${value.outputUnitSymbol} · ${value.decimalPlaces} decimals`} onEdit={()=>editConversion(value)} onRemove={()=>confirmRemoveConversion(value)}/>) }
        {conversions.some(value=>!value.isActive)?<><Text style={styles.groupLabel}>INACTIVE CONVERSIONS · {conversions.filter(value=>!value.isActive).length}</Text>{conversions.filter(value=>!value.isActive).map(value=><ManageRow key={value.id} title={value.name} detail={`${value.inputQuantity} ${value.inputUnitSymbol} = ${value.outputQuantity} ${value.outputUnitSymbol}`} inactive onEdit={()=>editConversion(value)} onReactivate={()=>void run(()=>repository.setConversionActive(value.id,true),'Conversion reactivated.')} onRemove={()=>confirmRemoveConversion(value)}/>)}</>:null}
        <Text style={styles.formTitle}>{editingConversionId?'Edit conversion':'Add conversion'}</Text><Field label="Conversion name" value={conversionName} onChangeText={setConversionName} placeholder="Kilograms to cubic metres" />
        <SearchableSelect label="Input unit *" options={units.filter(unit=>unit.isActive).map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))} selectedId={inputUnitId} onSelect={setInputUnitId} />
        <SearchableSelect label="Output unit *" options={units.filter(unit=>unit.isActive).map((unit) => ({ id: unit.id, label: `${unit.name} (${unit.symbol})` }))} selectedId={outputUnitId} onSelect={setOutputUnitId} />
        <View style={styles.twoColumns}><View style={styles.column}><Field label="Input quantity" value={inputQuantity} onChangeText={setInputQuantity} keyboardType="decimal-pad" /></View><View style={styles.column}><Field label="Output quantity" value={outputQuantity} onChangeText={setOutputQuantity} keyboardType="decimal-pad" /></View></View>
        <Field label="Displayed decimal places (0–6)" value={decimals} onChangeText={setDecimals} keyboardType="number-pad" />
        <View style={styles.actionRow}>{editingConversionId?<TouchableOpacity style={styles.cancelEdit} onPress={clearConversion}><Text style={styles.cancelEditText}>Cancel</Text></TouchableOpacity>:null}<View style={styles.grow}><SaveButton label={editingConversionId?'Save conversion changes':'Add conversion'} busy={busy} onPress={() => void run(async () => {const next={ name: conversionName, inputUnitId, outputUnitId, inputQuantity: Number(inputQuantity), outputQuantity: Number(outputQuantity), decimalPlaces: Number(decimals) };if(editingConversionId)await repository.updateConversion(editingConversionId,next);else await repository.createConversion(next);clearConversion();}, editingConversionId?'Conversion option updated.':'Conversion option added.')} /></View></View>
      </View>

    </ScrollView>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) { return <View style={styles.header}><TouchableOpacity onPress={onBack} style={styles.back}><Text style={styles.backText}>Back</Text></TouchableOpacity><View><Text style={styles.eyebrow}>SETUP</Text><Text style={styles.title}>{title}</Text></View></View>; }
function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; multiline?: boolean; keyboardType?: 'default' | 'decimal-pad' | 'number-pad' }) { return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input, props.multiline && styles.multiline]} placeholderTextColor="#89939B" {...props} /></View>; }
function SaveButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) { return <TouchableOpacity style={styles.save} disabled={busy} onPress={onPress}><Text style={styles.saveText}>{busy ? 'Saving…' : label}</Text></TouchableOpacity>; }
function ManageRow({title,detail,inactive,onEdit,onRemove,onReactivate}:{title:string;detail?:string;inactive?:boolean;onEdit:()=>void;onRemove:()=>void;onReactivate?:()=>void}){return <View style={[styles.savedRow,inactive&&styles.inactiveRow]}><View style={styles.grow}><Text style={styles.savedTitle}>{title}</Text>{detail?<Text style={styles.helper}>{detail}</Text>:null}</View><View style={styles.rowActions}><TouchableOpacity onPress={onEdit}><Text style={styles.editText}>Edit</Text></TouchableOpacity>{onReactivate?<TouchableOpacity onPress={onReactivate}><Text style={styles.reactivateText}>Reactivate</Text></TouchableOpacity>:null}<TouchableOpacity onPress={onRemove}><Text style={styles.removeText}>Remove</Text></TouchableOpacity></View></View>}
const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' }, content: { padding: 20, paddingBottom: 40, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 }, back: { backgroundColor: colors.surface, padding: 10, borderRadius: 10 }, backText: { color: colors.ink, fontWeight: '800' }, eyebrow: { color: colors.brand, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 }, title: { color: colors.ink, fontSize: 28, fontWeight: '900' },
  helper: { color: colors.muted, fontSize: 13, lineHeight: 19 }, error: { color: colors.danger, backgroundColor: '#FCE8E6', padding: 12, borderRadius: 10, fontWeight: '700' }, success: { color: colors.success, backgroundColor: '#E5F3EC', padding: 12, borderRadius: 10, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 17, gap: 12 }, cardTitle: { color: colors.ink, fontSize: 19, fontWeight: '900' }, groupLabel:{color:colors.brandDark,fontSize:10,fontWeight:'900',letterSpacing:.8,marginTop:4},formTitle:{color:colors.navy,fontSize:16,fontWeight:'900',marginTop:8},savedRow: { borderLeftWidth: 3, borderLeftColor: colors.brand, padding:10,gap:8,backgroundColor:'#FCFBF8',borderRadius:10 },inactiveRow:{borderLeftColor:colors.muted,opacity:.78},savedTitle: { color: colors.ink, fontWeight: '800' },grow:{flex:1},rowActions:{flexDirection:'row',flexWrap:'wrap',gap:14},editText:{color:colors.navy,fontWeight:'900'},reactivateText:{color:colors.success,fontWeight:'900'},removeText:{color:colors.danger,fontWeight:'900'},actionRow:{flexDirection:'row',gap:9,alignItems:'stretch'},cancelEdit:{borderWidth:1,borderColor:colors.navy,borderRadius:11,paddingHorizontal:16,justifyContent:'center'},cancelEditText:{color:colors.navy,fontWeight:'900'},
  field: { gap: 6 }, label: { color: colors.ink, fontSize: 13, fontWeight: '800' }, input: { borderWidth: 1, borderColor: colors.line, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 11, color: colors.ink, backgroundColor: '#FCFBF8' }, multiline: { minHeight: 70, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 18 }, chipSelected: { borderColor: colors.brand, backgroundColor: '#FBE9E4' }, chipText: { color: colors.muted, fontWeight: '700' }, chipTextSelected: { color: colors.brandDark },
  twoColumns: { flexDirection: 'row', gap: 10 }, column: { flex: 1 }, save: { backgroundColor: colors.ink, padding: 13, borderRadius: 11, alignItems: 'center' }, saveText: { color: '#FFF', fontWeight: '900' },
});
