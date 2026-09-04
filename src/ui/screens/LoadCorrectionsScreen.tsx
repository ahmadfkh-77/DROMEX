import {useCallback,useEffect,useMemo,useState} from 'react';
import {Alert,LayoutAnimation,ScrollView,StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';
import type {LoadRepository} from '../../data/repositories/LoadRepository';
import type {ConfirmedLoad,LoadCorrectionDraft} from '../../domain/loads';
import {correctionValidationError,formatUsd} from '../../domain/loads';
import {AppButton,AppCard,AppField,Feedback,MetricCard,PageHeader} from '../components/AppPrimitives';
import {SearchableSelect} from '../components/SearchableSelect';
import {CollapsibleFilterCard} from '../components/CollapsibleFilterCard';
import {useReducedMotion} from '../components/ExpandableMenu';
import {colors} from '../theme';

type GroupMode='project'|'customer';
type Stage='browse'|'blocked'|'edit'|'review';
type DiffRow={field:string;was:string;now:string};

const draftFrom=(load:ConfirmedLoad):LoadCorrectionDraft=>({requestedQuantityKg:load.requestedQuantityKg==null?'':String(load.requestedQuantityKg),emptyWeightKg:load.emptyWeightKg==null?'':String(load.emptyWeightKg),fullWeightKg:load.fullWeightKg==null?'':String(load.fullWeightKg),directQuantity:load.directQuantity==null?'':String(load.directQuantity),unitPriceUsd:load.unitPriceUsd==null?'':load.unitPriceUsd.toFixed(2),destinationAddress:load.destinationAddress??'',notes:load.notes??'',correctionReason:''});
const localDate=(value:string)=>{const date=new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const unique=(values:string[])=>[...new Set(values)].sort((a,b)=>a.localeCompare(b));

/** Mirrors correctLoad's own field parsing so the review stage previews exactly what the repository will record. */
function computeCorrectionPreview(selected:ConfirmedLoad,draft:LoadCorrectionDraft):DiffRow[]{
  const isDirect=selected.quantityMethod==='direct';
  const whole=(value:string)=>{const t=value.trim();return /^\d+$/.test(t)?Number(t):null;};
  const price=(value:string)=>{const t=value.trim().replace(',','.');return t?Number(t):null;};
  const direct=(value:string)=>{const t=value.trim().replace(',','.');return /^\d+(\.\d{1,6})?$/.test(t)?Number(t):null;};
  const text=(value:string)=>{const t=value.trim().replace(/\s+/g,' ');return t||null;};
  const asString=(value:number|null)=>value==null?null:String(value);

  const oldValues:Record<string,string|null>=isDirect
    ?{'Direct quantity':asString(selected.directQuantity),'Unit price':asString(selected.unitPriceUsd),'Destination address':selected.destinationAddress,Notes:selected.notes}
    :{'Requested quantity kg':asString(selected.requestedQuantityKg),'Empty weight kg':asString(selected.emptyWeightKg),'Full weight kg':asString(selected.fullWeightKg),'Unit price':asString(selected.unitPriceUsd),'Destination address':selected.destinationAddress,Notes:selected.notes};
  const newValues:Record<string,string|null>=isDirect
    ?{'Direct quantity':asString(direct(draft.directQuantity)),'Unit price':asString(price(draft.unitPriceUsd)),'Destination address':text(draft.destinationAddress),Notes:text(draft.notes)}
    :{'Requested quantity kg':asString(draft.requestedQuantityKg.trim()?whole(draft.requestedQuantityKg):null),'Empty weight kg':asString(whole(draft.emptyWeightKg)),'Full weight kg':asString(whole(draft.fullWeightKg)),'Unit price':asString(price(draft.unitPriceUsd)),'Destination address':text(draft.destinationAddress),Notes:text(draft.notes)};

  return Object.keys(newValues).filter(field=>newValues[field]!==oldValues[field]).map(field=>{
    const was=oldValues[field],now=newValues[field];
    if(field==='Unit price')return {field,was:was==null?'Unpriced':formatUsd(Number(was)),now:now==null?'Unpriced':formatUsd(Number(now))};
    return {field,was:was??'—',now:now??'—'};
  });
}

export function LoadCorrectionsScreen({repository,onBack,initialLoadId}:{repository:LoadRepository;onBack:()=>void;initialLoadId?:string|null}){
  const reducedMotion=useReducedMotion();
  const[loads,setLoads]=useState<ConfirmedLoad[]>([]);const[selected,setSelected]=useState<ConfirmedLoad|null>(null);const[draft,setDraft]=useState<LoadCorrectionDraft|null>(null);const[stage,setStage]=useState<Stage>('browse');
  const[groupMode,setGroupMode]=useState<GroupMode>('project');const[projectFilter,setProjectFilter]=useState('');const[customerFilter,setCustomerFilter]=useState('');const[fromDate,setFromDate]=useState('');const[toDate,setToDate]=useState('');const[search,setSearch]=useState('');
  const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);const[historyOpen,setHistoryOpen]=useState(false);
  const refresh=useCallback(async()=>setLoads(await repository.listLoads()),[repository]);
  useEffect(()=>{void refresh();},[refresh]);
  useEffect(()=>{if(initialLoadId&&loads.length&&!selected){const match=loads.find(load=>load.id===initialLoadId);if(match)choose(match);}},[initialLoadId,loads]); // eslint-disable-line react-hooks/exhaustive-deps
  const projectOptions=useMemo(()=>unique(loads.map(load=>load.projectName??'No project')).map(value=>({id:value,label:value})),[loads]);
  const customerOptions=useMemo(()=>unique(loads.map(load=>load.customerName)).map(value=>({id:value,label:value})),[loads]);
  const filtered=useMemo(()=>{const query=search.trim().toLocaleLowerCase('en-US');return loads.filter(load=>{const date=localDate(load.confirmedAt);if(projectFilter&&(load.projectName??'No project')!==projectFilter)return false;if(customerFilter&&load.customerName!==customerFilter)return false;if(fromDate&&date<fromDate)return false;if(toDate&&date>toDate)return false;if(query&&!`${load.transactionNumber} ${load.customerName} ${load.projectName??''} ${load.itemName} ${load.driverName} ${load.truckPlate}`.toLocaleLowerCase('en-US').includes(query))return false;return true;});},[customerFilter,fromDate,loads,projectFilter,search,toDate]);
  const groups=useMemo(()=>{const map=new Map<string,ConfirmedLoad[]>();for(const load of filtered){const key=groupMode==='project'?(load.projectName??'No project'):load.customerName;map.set(key,[...(map.get(key)??[]),load]);}return [...map].sort(([a],[b])=>a.localeCompare(b));},[filtered,groupMode]);
  const preview=useMemo(()=>selected&&draft?computeCorrectionPreview(selected,draft):[],[selected,draft]);
  const validationError=useMemo(()=>selected&&draft?correctionValidationError(selected,draft):null,[selected,draft]);

  function animateLayout(){if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);}
  function choose(load:ConfirmedLoad){animateLayout();setSelected(load);setHistoryOpen(false);setError(null);setMessage(null);if(load.status==='Cancelled'){setDraft(null);setStage('blocked');}else{setDraft(draftFrom(load));setStage('edit');}}
  function chooseAnother(){animateLayout();setSelected(null);setDraft(null);setStage('browse');setError(null);setMessage(null);}
  function update<K extends keyof LoadCorrectionDraft>(key:K,value:string){if(draft)setDraft({...draft,[key]:value});}
  function goToReview(){if(!draft?.correctionReason?.trim())return;if(!preview.length)return;if(validationError)return;animateLayout();setError(null);setStage('review');}
  function backToEdit(){animateLayout();setStage('edit');}

  function confirmCorrection(){
    if(!selected||!draft)return;
    Alert.alert('Confirm this correction?','This updates the confirmed record. The transaction number and original confirmation time never change. This cannot be undone.',[
      {text:'Review again',style:'cancel'},
      {text:'Confirm Correction',onPress:()=>{
        setBusy(true);setError(null);
        void repository.correctLoad(selected.id,draft)
          .then(updated=>{setSelected(updated);setDraft(draftFrom(updated));setStage('edit');setMessage('Confirmed load corrected. Its transaction number and original confirmation time did not change. Future PDFs and reprints use the corrected values.');void refresh();})
          .catch(cause=>setError(cause instanceof Error?cause.message:'Could not correct the load.'))
          .finally(()=>setBusy(false));
      }},
    ]);
  }
  function clearFilters(){setProjectFilter('');setCustomerFilter('');setFromDate('');setToDate('');setSearch('');}

  const showReasonHint=Boolean(draft&&!draft.correctionReason?.trim());
  const showNoChangeHint=Boolean(draft&&draft.correctionReason?.trim()&&!preview.length);

  return <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <PageHeader eyebrow="AUDITED CORRECTION" title="Correct Confirmed Load" onBack={onBack}/>
    <Text style={styles.helper}>Confirmed loads are never edited directly. Every correction records a reason and keeps a before/after history alongside the load.</Text>
    {message?<Feedback kind="success">{message}</Feedback>:null}

    {stage==='browse'?<>
      <CollapsibleFilterCard title="Find a load" summary={`${filtered.length} matching load${filtered.length===1?'':'s'}`}>
        <View style={styles.row}><Text style={styles.helper}>Group and narrow confirmed loads</Text><TouchableOpacity onPress={clearFilters} accessibilityRole="button"><Text style={styles.clear}>Clear filters</Text></TouchableOpacity></View>
        <View style={styles.segment}><Choice label="Under project" selected={groupMode==='project'} onPress={()=>setGroupMode('project')}/><Choice label="Under customer" selected={groupMode==='customer'} onPress={()=>setGroupMode('customer')}/></View>
        <SearchableSelect label="Project" options={projectOptions} selectedId={projectFilter} onSelect={setProjectFilter} placeholder="All projects" allowClear/>
        <SearchableSelect label="Customer" options={customerOptions} selectedId={customerFilter} onSelect={setCustomerFilter} placeholder="All customers" allowClear/>
        <Field label="Search load" value={search} onChangeText={setSearch} placeholder="Receipt number, item, driver, or plate"/>
        <Text style={styles.resultCount}>{filtered.length} matching load{filtered.length===1?'':'s'}</Text>
      </CollapsibleFilterCard>
      {groups.length?<View style={styles.groups}>{groups.map(([group,records])=><View key={group} style={styles.group}>
        <View style={styles.groupHeader}><Text style={styles.groupTitle}>{group}</Text><Text style={styles.groupCount}>{records.length}</Text></View>
        {records.map(load=><TouchableOpacity key={load.id} style={styles.loadRow} onPress={()=>choose(load)} accessibilityRole="button" accessibilityLabel={`${load.transactionNumber}${load.status==='Cancelled'?', cancelled':''}`}>
          <View style={styles.row}><Text style={styles.loadNumber}>{load.transactionNumber}</Text><View style={styles.rowRight}>{load.status==='Cancelled'?<View style={styles.cancelledChip}><Text style={styles.cancelledChipText}>CANCELLED</Text></View>:null}<Text style={styles.date}>{localDate(load.confirmedAt)}</Text></View></View>
          <Text style={styles.loadMain}>{load.itemName} · {load.billedQuantity.toFixed(3)} {load.outputUnitSymbol}</Text>
          <Text style={styles.helper}>{groupMode==='project'?load.customerName:(load.projectName??'No project')} · {load.driverName} · {load.truckPlate}</Text>
        </TouchableOpacity>)}
      </View>)}</View>:<View style={styles.empty}><Text style={styles.cardTitle}>No matching loads</Text><Text style={styles.helper}>Change or clear one of the filters.</Text></View>}
    </>:null}

    {stage==='blocked'&&selected?<AppCard title={selected.transactionNumber} hint="A cancelled load cannot be corrected.">
      <Feedback kind="warning">This load was cancelled{selected.cancelledAt?` on ${new Date(selected.cancelledAt).toLocaleString()}`:''}. Reason: {selected.cancellationReason??'—'}.</Feedback>
      <AppButton label="Choose Another Load" tone="secondary" onPress={chooseAnother}/>
    </AppCard>:null}

    {(stage==='edit'||stage==='review')&&selected&&draft?<>
      <AppCard>
        <View style={styles.identityRow}><View style={styles.flex}><Text style={styles.cardTitle}>{selected.transactionNumber}</Text><Text style={styles.helper}>Confirmed {new Date(selected.confirmedAt).toLocaleString()}</Text></View><TouchableOpacity onPress={chooseAnother} accessibilityRole="button"><Text style={styles.clear}>Choose another load</Text></TouchableOpacity></View>
        <Text style={styles.helper}>{selected.customerName} · {selected.projectName??selected.destinationAddress??'No project'} · {selected.itemName}</Text>
        <Text style={styles.notice}>Transaction number, original confirmation time, customer, project, item, quantity method/unit, and existing payments always stay unchanged.</Text>
        {selected.correctionHistory.length?<TouchableOpacity onPress={()=>{animateLayout();setHistoryOpen(v=>!v);}} accessibilityRole="button" accessibilityState={{expanded:historyOpen}}><Text style={styles.historyToggle}>{historyOpen?'Hide':'Show'} correction history ({selected.correctionHistory.length})</Text></TouchableOpacity>:null}
        {historyOpen?<View style={styles.historyList}>{[...selected.correctionHistory].reverse().map((entry,index)=><View key={index} style={styles.historyEntry}><Text style={styles.historyDate}>{new Date(entry.correctedAt).toLocaleString()}</Text><Text style={styles.historyReason}>{entry.reason}</Text><Text style={styles.helper}>Changed: {entry.changes.map(change=>change.field).join(', ')}</Text></View>)}</View>:null}
      </AppCard>

      {stage==='edit'?<AppCard title="What changed?" hint="Only the fields already supported for correction are editable here.">
        <AppField label="Correction reason *" value={draft.correctionReason??''} onChangeText={(v)=>update('correctionReason',v)} multiline placeholder="Why is this correction needed?"/>
        {selected.quantityMethod==='direct'?<AppField label={`Direct quantity (${selected.outputUnitSymbol}) *`} value={draft.directQuantity} onChangeText={(v)=>update('directQuantity',v)} keyboardType="decimal-pad"/>:<>
          <AppField label="Requested quantity kg" value={draft.requestedQuantityKg} onChangeText={(v)=>update('requestedQuantityKg',v)} keyboardType="number-pad"/>
          <View style={styles.columns}><View style={styles.flex}><AppField label="Empty weight kg *" value={draft.emptyWeightKg} onChangeText={(v)=>update('emptyWeightKg',v)} keyboardType="number-pad"/></View><View style={styles.flex}><AppField label="Full weight kg *" value={draft.fullWeightKg} onChangeText={(v)=>update('fullWeightKg',v)} keyboardType="number-pad"/></View></View>
        </>}
        <AppField label="Unit price USD (blank = Unpriced)" value={draft.unitPriceUsd} onChangeText={(v)=>update('unitPriceUsd',v)} keyboardType="decimal-pad"/>
        <AppField label="Destination address" value={draft.destinationAddress} onChangeText={(v)=>update('destinationAddress',v)} multiline/>
        <AppField label="Notes" value={draft.notes} onChangeText={(v)=>update('notes',v)} multiline/>
        <View style={styles.metricRow}><MetricCard label="Current quantity" value={`${selected.billedQuantity.toFixed(3)} ${selected.outputUnitSymbol}`} result/><MetricCard label="Current payment status" value={selected.paymentStatus} accent/></View>
        {showReasonHint?<Feedback kind="warning">Enter a correction reason to continue.</Feedback>:null}
        {!showReasonHint&&validationError?<Feedback kind="warning">{validationError}</Feedback>:null}
        {!showReasonHint&&!validationError&&showNoChangeHint?<Feedback kind="warning">Change at least one field to continue.</Feedback>:null}
        {error?<Feedback kind="error">{error}</Feedback>:null}
        <AppButton label="Review Correction" onPress={goToReview} disabled={showReasonHint||Boolean(validationError)||showNoChangeHint}/>
      </AppCard>:null}

      {stage==='review'?<AppCard title="Review before confirming" hint="Only the fields below will change. Confirming updates the permanent record.">
        <Text style={styles.reasonLabel}>Correction reason</Text>
        <Text style={styles.reasonValue}>{draft.correctionReason}</Text>
        {preview.map(row=><View key={row.field} style={styles.diffRow}><Text style={styles.diffField}>{row.field}</Text><View style={styles.diffValues}><Text style={styles.diffWas}>{row.was}</Text><Text style={styles.diffArrow}>→</Text><Text style={styles.diffNow}>{row.now}</Text></View></View>)}
        {error?<Feedback kind="error">{error}</Feedback>:null}
        <AppButton label="Confirm Correction" busy={busy} onPress={confirmCorrection}/>
        <AppButton label="Back to Edit" tone="secondary" onPress={backToEdit}/>
      </AppCard>:null}
    </>:null}
  </ScrollView>;
}

function Choice({label,selected,onPress}:{label:string;selected:boolean;onPress:()=>void}){return <TouchableOpacity style={[styles.choice,selected&&styles.choiceSelected]} onPress={onPress} accessibilityRole="button" accessibilityState={{selected}}><Text style={[styles.choiceText,selected&&styles.choiceTextSelected]}>{label}</Text></TouchableOpacity>;}
function Field({label,...props}:{label:string;value:string;onChangeText:(v:string)=>void;placeholder?:string}){return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={styles.input} placeholderTextColor="#89939B" {...props}/></View>;}
const styles=StyleSheet.create({
  content:{padding:20,paddingBottom:42,gap:15}, helper:{color:colors.muted,fontSize:13,lineHeight:19}, flex:{flex:1,minWidth:0},
  row:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:10}, rowRight:{flexDirection:'row',alignItems:'center',gap:8},
  segment:{flexDirection:'row',backgroundColor:'#EEEAE2',borderRadius:11,padding:4,gap:4}, choice:{flex:1,minHeight:44,justifyContent:'center',padding:10,borderRadius:8,alignItems:'center'}, choiceSelected:{backgroundColor:colors.navy}, choiceText:{color:colors.muted,fontWeight:'800'}, choiceTextSelected:{color:'#FFF'},
  clear:{color:colors.brandDark,fontWeight:'900',fontSize:13,minHeight:48,textAlignVertical:'center',paddingVertical:14}, field:{gap:6}, label:{color:colors.ink,fontSize:13,fontWeight:'800'}, input:{minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:10,padding:12,color:colors.ink,backgroundColor:'#FCFBF8'},
  resultCount:{color:colors.brandDark,fontWeight:'900'}, groups:{gap:14}, group:{gap:8}, groupHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}, groupTitle:{color:colors.ink,fontSize:18,fontWeight:'900'}, groupCount:{backgroundColor:'#EEEAE2',color:colors.brandDark,fontWeight:'900',paddingHorizontal:9,paddingVertical:4,borderRadius:12},
  loadRow:{backgroundColor:colors.surface,borderRadius:13,padding:14,gap:4,minHeight:48}, loadNumber:{color:colors.ink,fontWeight:'900',flexShrink:1}, loadMain:{color:colors.ink,fontSize:14,fontWeight:'800'}, date:{color:colors.brandDark,fontWeight:'800',fontSize:12},
  cancelledChip:{backgroundColor:'#FCE8E6',borderRadius:8,paddingHorizontal:7,paddingVertical:3}, cancelledChipText:{color:colors.danger,fontWeight:'900',fontSize:10,letterSpacing:.5},
  empty:{borderWidth:1,borderColor:colors.line,borderStyle:'dashed',borderRadius:15,padding:16,gap:5}, cardTitle:{color:colors.ink,fontSize:18,fontWeight:'900'},
  identityRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:10},
  notice:{backgroundColor:'#FFF3D8',color:colors.warning,padding:11,borderRadius:9,lineHeight:17,fontSize:12,fontWeight:'700'},
  historyToggle:{color:colors.navy,fontWeight:'900',fontSize:12,minHeight:44,textAlignVertical:'center',paddingVertical:12}, historyList:{gap:10,borderTopWidth:1,borderTopColor:colors.line,paddingTop:10}, historyEntry:{gap:2}, historyDate:{color:colors.ink,fontWeight:'800',fontSize:12}, historyReason:{color:colors.ink,fontSize:13,fontWeight:'700'},
  columns:{flexDirection:'row',gap:10}, metricRow:{flexDirection:'row',flexWrap:'wrap',gap:8},
  reasonLabel:{color:colors.muted,fontSize:11,fontWeight:'800',letterSpacing:.5}, reasonValue:{color:colors.ink,fontSize:14,fontWeight:'700',marginBottom:4},
  diffRow:{borderTopWidth:1,borderTopColor:colors.line,paddingVertical:10,gap:4}, diffField:{color:colors.muted,fontSize:12,fontWeight:'800'}, diffValues:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8}, diffWas:{color:colors.danger,fontSize:14,fontWeight:'700',flexShrink:1}, diffArrow:{color:colors.muted,fontSize:14,fontWeight:'900'}, diffNow:{color:colors.success,fontSize:15,fontWeight:'900',flexShrink:1},
});
