import {useState} from 'react';
import {ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {localDateKey,type FuelSetup} from '../../../domain/fuel';
import {minimumBatchLitres,type BatchDetail,type BatchEditDraft} from '../../../domain/fuelBatches';
import {formatLitres} from '../../../domain/fuelFillForm';
import {colors} from '../../theme';
import {AppButton,AppCard,AppField,Feedback} from '../AppPrimitives';
import {DatePickerField,todayIso} from '../DatePickerField';
import {SearchableSelect} from '../SearchableSelect';

/**
 * DEC-506. Edit a saved diesel batch. Step 1 (supplier, invoice number, price) is free: it never changes the tank.
 * Step 2 (litres, arrival date) needs a reason, keeps the original in the batch's history, and the litres can never
 * go below what has already been used. An Opening stock batch only has step 1: its quantity comes from the dip.
 */
export function DieselBatchEditForm({batch,setup,onBack,onSave}:{batch:BatchDetail;setup:FuelSetup;onBack:()=>void;onSave:(draft:BatchEditDraft)=>Promise<void>}){
  const[draft,setDraft]=useState<BatchEditDraft>({
    supplierId:batch.supplierId??'',invoiceNumber:batch.invoiceNumber??'',pricePerLitreUsd:batch.pricePerLitreUsd==null?'':String(batch.pricePerLitreUsd),
    litres:String(batch.deliveredLitres),recordDate:localDateKey(batch.arrivedAt),reason:'',
  });
  const[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const set=<K extends keyof BatchEditDraft>(key:K,value:BatchEditDraft[K])=>setDraft(current=>({...current,[key]:value}));
  const opening=batch.kind==='opening';
  const minimum=minimumBatchLitres(batch);
  const litresChanged=!opening&&Number(draft.litres.replace(',','.'))!==batch.deliveredLitres,dateChanged=!opening&&draft.recordDate!==localDateKey(batch.arrivedAt);
  const needsReason=litresChanged||dateChanged;
  // The supplier's current name stays selectable even when the supplier was deactivated since.
  const supplierOptions=[...setup.suppliers.map(supplier=>({id:supplier.id,label:supplier.name,detail:supplier.detail})),...(batch.supplierId&&!setup.suppliers.some(supplier=>supplier.id===batch.supplierId)?[{id:batch.supplierId,label:batch.supplierName??'Supplier',detail:'Inactive'}]:[])];
  const save=async()=>{setBusy(true);setError(null);try{await onSave(draft);}catch(cause){setError(cause instanceof Error?cause.message:'The batch could not be saved.');}finally{setBusy(false);}};
  return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View style={styles.head}>
      <TouchableOpacity style={styles.back} onPress={onBack} accessibilityRole="button"><Text style={styles.backText}>Back</Text></TouchableOpacity>
      <Text style={styles.eyebrow}>EDIT DIESEL BATCH</Text>
      <Text style={styles.title}>{batch.batchNumber}</Text>
    </View>
    {error?<Feedback kind="error">{error}</Feedback>:null}
    <AppCard title="1 · Supplier, invoice and price" hint="These can be changed freely at any time. They never change the diesel in the tank.">
      <SearchableSelect label="Supplier" options={supplierOptions} selectedId={draft.supplierId} onSelect={value=>set('supplierId',value)} placeholder="No supplier" allowClear/>
      <AppField label="Invoice / ticket number" value={draft.invoiceNumber} onChangeText={value=>set('invoiceNumber',value)}/>
      <AppField label="Price per litre (USD)" value={draft.pricePerLitreUsd} onChangeText={value=>set('pricePerLitreUsd',value)} keyboardType="decimal-pad"/>
      <Text style={styles.helper}>{opening?'Leave the price empty to keep Opening stock Unpriced. Opening stock is not a purchase, so it never adds an amount to a supplier.':'Clear the price to make the batch Unpriced. A priced batch needs a supplier. If payments are already recorded against this purchase it cannot be made Unpriced.'}</Text>
    </AppCard>
    {opening?<AppCard title="Quantity and date" hint="The quantity and date of Opening stock come from the dip reading. Record a new dip reading to change them."><Text style={styles.helper}>{formatLitres(batch.deliveredLitres)} · {localDateKey(batch.arrivedAt)}</Text></AppCard>
    :<AppCard title="2 · Quantity and date" hint="Changing either needs a reason. The original and the new value are kept in the Edit history.">
      <AppField label="Litres delivered *" value={draft.litres} onChangeText={value=>set('litres',value)} keyboardType="decimal-pad"/>
      <Text style={styles.helper}>At least {formatLitres(minimum)}{minimum>0?' — that much has already been used from this batch.':'.'}</Text>
      <DatePickerField label="Arrival date *" value={draft.recordDate} onChange={value=>set('recordDate',value)} maxDate={todayIso()}/>
      <AppField label={`Reason for changing quantity or date${needsReason?' *':''}`} value={draft.reason} onChangeText={value=>set('reason',value)} multiline placeholder="Why is this being changed?"/>
    </AppCard>}
    <AppButton label="Save Changes" tone="primary" busy={busy} disabled={needsReason&&!draft.reason.trim()} onPress={()=>void save()}/>
  </ScrollView>;
}

const styles=StyleSheet.create({
  page:{padding:20,paddingBottom:42,gap:16},
  head:{gap:6,alignItems:'flex-start'},
  back:{backgroundColor:colors.surface,padding:10,borderRadius:12,minHeight:42,justifyContent:'center'},
  backText:{color:colors.ink,fontWeight:'800'},
  eyebrow:{color:colors.brand,fontSize:11,fontWeight:'900',letterSpacing:1.4,marginTop:8},
  title:{color:colors.ink,fontSize:26,fontWeight:'900'},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
});
