import {useCallback,useEffect,useMemo,useState} from 'react';
import {Alert,LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';

import type {DocumentSignerRepository} from '../../data/repositories/DocumentSignerRepository';
import type {LoadRepository} from '../../data/repositories/LoadRepository';
import type {DocumentSigner} from '../../domain/documentSigners';
import {correctionBaseline,correctionChanges,correctionLocks,correctionToLoadDraft,validateLoadCorrection,type LoadCorrectionContext} from '../../domain/loadCorrection';
import {calculateLoad,formatUsd,type ConfirmedLoad,type LoadCorrectionDraft} from '../../domain/loads';
import {loadNumberLabel} from '../../domain/loadNumberSeries';
import {truckCrewRoleLabel} from '../../domain/people';
import {AppButton,AppCard,AppField,Feedback,MetricCard} from './AppPrimitives';
import {DatePickerField,todayIso} from './DatePickerField';
import {useReducedMotion} from './ExpandableMenu';
import {GroupedSearchableSelect} from './GroupedSearchableSelect';
import {HeaderSignerField,type HeaderSignerValue} from './HeaderSignerField';
import {SearchableSelect} from './SearchableSelect';
import {SegmentedChoice} from './SegmentedChoice';
import {SignaturePad} from './SignaturePad';
import {colors} from '../theme';

const NOTICE='Confirmed records are never edited directly. Everything can be corrected: your change is saved with the original in the history, and a reason is required.';

/**
 * Phase 4. The Correct this load screen: the same sections as Make Receipt (01 Customer and destination, 02 Load
 * information, 03 Conversion and price, 04 Signatures), a CHANGED tag on every field that differs, the changed
 * fields listed above a required reason, and the load's correction history at the bottom. Saving keeps the
 * original load in the history; the load number and transaction number never change.
 */
export function LoadCorrectionForm({repository,signers,selected,onSaved,onChooseAnother,onSigningChange}:{repository:LoadRepository;signers?:DocumentSignerRepository;selected:ConfirmedLoad;onSaved:(updated:ConfirmedLoad)=>void;onChooseAnother:()=>void;onSigningChange?:(signing:boolean)=>void}){
  const reducedMotion=useReducedMotion();
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[context,setContext]=useState<LoadCorrectionContext|null>(null);
  const[signerList,setSignerList]=useState<DocumentSigner[]>([]);
  const[form,setForm]=useState<LoadCorrectionDraft>(()=>({...correctionBaseline(selected)}));
  const[driverMode,setDriverMode]=useState<'saved'|'typed'>(selected.driverId?'saved':'typed');
  const[truckMode,setTruckMode]=useState<'saved'|'typed'>(selected.truckId?'saved':'typed');
  const[typedDriver,setTypedDriver]=useState(selected.driverId?'':selected.driverName);
  const[typedPlate,setTypedPlate]=useState(selected.truckId?'':selected.truckPlate);
  const[supplierOpen,setSupplierOpen]=useState(false);
  const[driverPadOpen,setDriverPadOpen]=useState(false);
  const[crewFilter,setCrewFilter]=useState<'all'|'driver'|'operator'>('all');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);

  const load=useCallback(()=>{
    setStatus('loading');
    Promise.all([repository.getCorrectionContext(selected.id),signers?signers.listSigners():Promise.resolve([] as DocumentSigner[])])
      .then(([next,list])=>{setContext(next);setSignerList(list);setStatus('ready');})
      .catch(()=>setStatus('error'));
  },[repository,signers,selected.id]);
  useEffect(()=>{load();},[load]);

  const options=context?.options;
  const locks=correctionLocks(context?.activePaymentCents??0);
  const signerLabel=useCallback((selection:{signerId:string;display:string})=>{const signer=signerList.find(value=>value.id===selection.signerId);return `${signer?.name??selection.signerId}${selection.display==='name_only'?' (name only)':''}`;},[signerList]);
  const changes=useMemo(()=>options?correctionChanges(selected,form,options,signerLabel):[],[selected,form,options,signerLabel]);
  const changed=useMemo(()=>new Set(changes.map(value=>value.field)),[changes]);
  const issues=useMemo(()=>options?validateLoadCorrection(selected,form,options,context?.activePaymentCents??0):[],[selected,form,options,context?.activePaymentCents]);
  const effective=useMemo(()=>correctionToLoadDraft(selected,form),[selected,form]);
  const conversion=options?.conversions.find(value=>value.id===effective.conversionId);
  const calculation=useMemo(()=>calculateLoad(effective,conversion,selected.vatRatePercent??0),[effective,conversion,selected.vatRatePercent]);
  const isDirect=selected.quantityMethod==='direct';

  function animate(){if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);}
  function set<K extends keyof LoadCorrectionDraft>(key:K,value:LoadCorrectionDraft[K]){setForm(current=>({...current,[key]:value}));setError(null);}

  if(status==='loading')return <View style={styles.center}><Text style={styles.helper}>Loading this load's details…</Text></View>;
  if(status==='error'||!context||!options)return <View style={styles.gap}><Feedback kind="error">This load's details could not be loaded. Nothing was changed.</Feedback><AppButton label="Try again" tone="secondary" onPress={load}/><AppButton label="Choose Another Load" tone="secondary" onPress={onChooseAnother}/></View>;

  const project=options.projects.find(value=>value.id===effective.projectId);
  const customer=options.customers.find(value=>value.id===effective.customerId);
  const maxDate=project?.endDate&&project.endDate<todayIso()?project.endDate:todayIso();
  const directConversions=options.conversions.filter(value=>value.inputUnitId===effective.directUnitId);
  const crew=options.drivers;
  const crewOptions=crew.filter(value=>crewFilter==='all'||value.role===crewFilter||value.id===form.driverId).map(value=>({id:value.id,label:value.name,detail:truckCrewRoleLabel(value.role)}));
  const itemGroups=(()=>{const grouped=new Map<string,typeof options.items>();for(const value of options.items)grouped.set(value.categoryName,[...(grouped.get(value.categoryName)??[]),value]);return [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([categoryName,values])=>({id:categoryName,label:categoryName,options:[...values].sort((a,b)=>a.name.localeCompare(b.name)).map(value=>({id:value.id,label:value.name,detail:value.internalCode??undefined}))}));})();
  // Dates are saved as yyyy-mm-dd; people read them as "18 Aug 2026".
  const shown=(field:string,value:string|null)=>value==null?'—':field==='Record date'&&/^d{4}-d{2}-d{2}$/.test(value)?new Date(`${value}T12:00:00`).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'}):value;
  const was=(field:string)=>{const change=changes.find(value=>value.field===field);return change?<Text style={styles.was}>was {shown(field,change.originalValue)}</Text>:null;};
  const Tag=({field,unit=false}:{field:string;unit?:boolean})=>changed.has(field)?<Text style={[styles.tag,unit&&styles.tagUnit]}>{unit?'UNIT CHANGED':'CHANGED'}</Text>:null;
  const unitChanged=changed.has('Unit')||changed.has('Conversion');
  const lockedTag=<Text style={styles.tagLock}>LOCKED · PAYMENTS</Text>;
  const Locked=({label,value}:{label:string;value:string})=><View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>{label}</Text>{lockedTag}</View><View style={[styles.input,styles.inputLocked]}><Text style={styles.lockedText}>{value}</Text></View></View>;

  function selectProject(id:string){animate();const next=options!.projects.find(value=>value.id===id);setForm(current=>({...current,projectId:id,customerId:next?.customerId??current.customerId}));setError(null);}
  function selectCustomer(id:string){animate();setForm(current=>{const currentProject=options!.projects.find(value=>value.id===current.projectId);return {...current,customerId:id,projectId:currentProject?.customerId===id?current.projectId:''};});setError(null);}
  function selectItem(id:string){set('itemId',id);}
  function selectDriver(id:string){const next=crew.find(value=>value.id===id);setForm(current=>({...current,driverId:id,driverName:next?.name??''}));setError(null);}
  function selectTruck(id:string){const next=options!.trucks.find(value=>value.id===id);setForm(current=>({...current,truckId:id,truckPlate:next?.plate??''}));setError(null);}
  function switchDriver(mode:'saved'|'typed'){if(mode===driverMode)return;animate();setDriverMode(mode);setForm(current=>({...current,driverId:'',driverName:mode==='typed'?typedDriver:''}));}
  function switchTruck(mode:'saved'|'typed'){if(mode===truckMode)return;animate();setTruckMode(mode);setForm(current=>({...current,truckId:'',truckPlate:mode==='typed'?typedPlate:''}));}
  function selectUnit(id:string){setForm(current=>({...current,directUnitId:id,conversionId:options!.conversions.some(value=>value.id===current.conversionId&&value.inputUnitId===id)?current.conversionId:''}));setError(null);}
  function chooseSupplier(value:HeaderSignerValue){if(value.signerId)set('supplierSignature',{signerId:value.signerId,display:value.display??'name_only'});else set('supplierSignature',undefined);}

  const reasonMissing=!(form.correctionReason??'').trim();
  const canSave=!busy&&!reasonMissing&&!issues.length&&changes.length>0;
  function save(){
    Alert.alert('Save this correction?','The original record is kept in the history. The load number and transaction number do not change. Future PDFs and reprints use the corrected values.',[
      {text:'Review again',style:'cancel'},
      {text:'Save',onPress:()=>{
        setBusy(true);setError(null);
        void repository.correctLoad(selected.id,form).then(updated=>{onSaved(updated);}).catch(cause=>setError(cause instanceof Error?cause.message:'Could not save the correction. Nothing was changed.')).finally(()=>setBusy(false));
      }},
    ]);
  }

  const supplierShown=form.supplierSignature===undefined?selected.supplierSignature:null;
  const history=[...selected.correctionHistory].reverse();
  const versionFor=(correctedAt:string)=>context.versions.find(value=>value.correctedAt===correctedAt)?.version;

  return <View style={styles.gap}>
    <View style={styles.hero}>
      <Text style={styles.heroKicker}>LOAD NUMBER</Text>
      <Text style={styles.heroNumber}>{loadNumberLabel(selected.loadNumber)}</Text>
      <Text style={styles.heroHint}>Transaction {selected.transactionNumber} · Confirmed {new Date(selected.confirmedAt).toLocaleString()}</Text>
      <Text style={styles.heroHint}>A correction never changes the load number.</Text>
      <TouchableOpacity onPress={onChooseAnother} accessibilityRole="button" style={styles.heroLink}><Text style={styles.heroLinkText}>Choose another load</Text></TouchableOpacity>
    </View>
    <Text style={styles.notice}>{NOTICE}</Text>
    {context.activePaymentCount>0?<Feedback kind="warning">{`This load has ${context.activePaymentCount} active payment${context.activePaymentCount===1?'':'s'} (${formatUsd(context.activePaymentCents/100)}). Customer, project, unit and price are locked. Cancel those payments in Financials to change them. Quantity, date, item, driver, truck, notes and signatures can still be corrected.`}</Feedback>:null}
    {context.issuedDocumentCount>0?<Feedback kind="success">{`This load is on ${context.issuedDocumentCount} issued document${context.issuedDocumentCount===1?'':'s'}. They keep their own copy and are not rewritten by this correction.`}</Feedback>:null}
    {context.versions.length||selected.correctionHistory.length?<Text style={styles.earlier}>{selected.correctionHistory.length} earlier correction{selected.correctionHistory.length===1?'':'s'}</Text>:null}

    <Section number="01" title="Customer and destination" hint="The place and the customer this load belongs to.">
      <View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Record date *</Text><Tag field="Record date"/></View>
        <View style={changed.has('Record date')&&styles.changedBox}><DatePickerField label="" value={form.recordDate??''} onChange={value=>set('recordDate',value)} minDate={project?.startDate??undefined} maxDate={maxDate}/></View>{was('Record date')}</View>
      {locks.project?<Locked label="Project" value={project?.name??selected.projectName??'No project'}/>:<View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Project</Text><Tag field="Project"/></View><SearchableSelect label="" options={options.projects.map(value=>({id:value.id,label:value.name,detail:`${value.customerName} · ${value.location}`}))} selectedId={form.projectId??''} onSelect={selectProject} allowClear placeholder="No project"/>{was('Project')}</View>}
      {locks.customer?<Locked label="Customer *" value={customer?.name??selected.customerName}/>:<View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Customer *</Text><Tag field="Customer"/></View><SearchableSelect label="" options={options.customers.map(value=>({id:value.id,label:value.name,detail:value.isOwnCompany?'Own company':value.type}))} selectedId={form.customerId??''} onSelect={selectCustomer}/>{was('Customer')}</View>}
      {!form.projectId&&customer&&!customer.isOwnCompany?<View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Destination address *</Text><Tag field="Destination address"/></View><AppField label="" value={form.destinationAddress} onChangeText={value=>set('destinationAddress',value)} multiline/>{was('Destination address')}</View>:null}
    </Section>

    <Section number="02" title="Load information" hint={isDirect?'Direct quantity. The quantity method stays as confirmed.':'Weighed load. The quantity method stays as confirmed.'}>
      <View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Load-enabled item *</Text><Tag field="Item"/></View><GroupedSearchableSelect label="" groups={itemGroups} selectedId={form.itemId??''} onSelect={selectItem} placeholder="Choose category, then item"/>{was('Item')}
        {changed.has('Item')?<Text style={styles.info}>{`The load number stays ${loadNumberLabel(selected.loadNumber)} even though the item changed.`}</Text>:null}</View>
      <SegmentedChoice label="Driver / Operator *" options={[{id:'saved' as const,label:'Saved person'},{id:'typed' as const,label:'Type a name'}]} selectedId={driverMode} onSelect={switchDriver}/>
      {driverMode==='saved'?<>
        <SegmentedChoice mode="tabs" options={[{id:'all' as const,label:'All'},{id:'driver' as const,label:'Drivers'},{id:'operator' as const,label:'Operators'}]} selectedId={crewFilter} onSelect={setCrewFilter}/>
        <SearchableSelect label="Saved driver or operator" options={crewOptions} selectedId={form.driverId??''} onSelect={selectDriver} placeholder="Choose the person driving"/>
      </>:<View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Driver name *</Text></View><AppField label="" value={typedDriver} onChangeText={value=>{setTypedDriver(value);setForm(current=>({...current,driverId:'',driverName:value}));}} autoCapitalize="words"/><View style={styles.notSaved}><Text style={styles.notSavedChip}>NOT SAVED</Text><Text style={[styles.helper,styles.flex]}>Used on this load only. It is not added to People.</Text></View></View>}
      {changed.has('Driver / Operator')?<View><Tag field="Driver / Operator"/>{was('Driver / Operator')}</View>:null}
      {selected.signaturePaths.length&&changed.has('Driver / Operator')&&form.driverSignaturePaths===undefined?<Feedback kind="warning">{`The load was signed by ${selected.driverName}. Changing the driver removes that signature; draw a new one in 04, or leave it unsigned.`}</Feedback>:null}
      <SegmentedChoice label="Truck *" options={[{id:'saved' as const,label:'Saved truck'},{id:'typed' as const,label:'Type a plate'}]} selectedId={truckMode} onSelect={switchTruck}/>
      {truckMode==='saved'?<SearchableSelect label="Saved truck" options={options.trucks.map(value=>({id:value.id,label:value.plate,detail:[value.makeModel,value.ownerName].filter(Boolean).join(' · ')}))} selectedId={form.truckId??''} onSelect={selectTruck} placeholder="Choose the truck"/>
        :<View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Truck plate *</Text></View><AppField label="" value={typedPlate} onChangeText={value=>{setTypedPlate(value);setForm(current=>({...current,truckId:'',truckPlate:value}));}} autoCapitalize="characters"/><View style={styles.notSaved}><Text style={styles.notSavedChip}>NOT SAVED</Text><Text style={[styles.helper,styles.flex]}>Used on this load only. It is not added to Trucks.</Text></View></View>}
      {changed.has('Truck plate')?<View><Tag field="Truck plate"/>{was('Truck plate')}</View>:null}
      {isDirect?<>
        <View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Quantity *</Text><Tag field="Direct quantity"/></View><AppField label="" value={form.directQuantity} onChangeText={value=>set('directQuantity',value)} keyboardType="decimal-pad"/>{was('Direct quantity')}</View>
        {locks.unit?<Locked label="Unit" value={options.units.find(value=>value.id===effective.directUnitId)?.symbol??selected.directUnitSymbol??''}/>:<View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Unit *</Text>{unitChanged?<Tag field="Unit" unit/>:null}</View><SearchableSelect label="" options={options.units.map(value=>({id:value.id,label:value.name,detail:value.symbol}))} selectedId={form.directUnitId??''} onSelect={selectUnit} placeholder="Piece, metre, bundle, or another unit"/>{was('Unit')}</View>}
      </>:<>
        <View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Requested quantity (kg, optional)</Text><Tag field="Requested quantity kg"/></View><AppField label="" value={form.requestedQuantityKg} onChangeText={value=>set('requestedQuantityKg',value)} keyboardType="number-pad"/></View>
        <View style={styles.columns}>
          <View style={styles.flex}><View style={styles.labelRow}><Text style={styles.label}>Empty weight kg *</Text><Tag field="Empty weight kg"/></View><AppField label="" value={form.emptyWeightKg} onChangeText={value=>set('emptyWeightKg',value)} keyboardType="number-pad"/></View>
          <View style={styles.flex}><View style={styles.labelRow}><Text style={styles.label}>Full weight kg *</Text><Tag field="Full weight kg"/></View><AppField label="" value={form.fullWeightKg} onChangeText={value=>set('fullWeightKg',value)} keyboardType="number-pad"/></View>
        </View>
        <View style={styles.metricRow}><MetricCard label="Calculated net weight" value={calculation.netWeightKg==null?'—':`${calculation.netWeightKg} kg`} result/></View>
      </>}
    </Section>

    <Section number="03" title="Conversion and price" hint={isDirect?'Optionally convert the entered quantity, then the price.':'Convert the verified weight, then the price.'}>
      {locks.unit?<Locked label={isDirect?'Conversion (optional)':'Conversion *'} value={conversion?.name??'No conversion'}/>:<View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>{isDirect?'Conversion (optional)':'Conversion *'}</Text>{unitChanged?<Tag field="Conversion" unit/>:null}</View>
        <SearchableSelect label="" options={(isDirect?directConversions:options.conversions).map(value=>({id:value.id,label:value.name,detail:`${value.inputQuantity} ${value.inputUnitSymbol} = ${value.outputQuantity} ${value.outputUnitSymbol}`}))} selectedId={form.conversionId??''} onSelect={id=>set('conversionId',id)} allowClear={isDirect} placeholder={isDirect?'No conversion (use the quantity as entered)':'Choose the conversion'}/>
        {was('Conversion')}{changed.has('Unit')?<Text style={styles.was}>{`unit was ${changes.find(value=>value.field==='Unit')?.originalValue??'—'}, now ${changes.find(value=>value.field==='Unit')?.newValue??'—'}`}</Text>:null}</View>}
      <View style={styles.metricRow}><MetricCard label={`Converted quantity${conversion?` (${conversion.outputUnitSymbol})`:''}`} value={calculation.billedQuantity==null?'—':`${conversion?calculation.billedQuantity.toFixed(conversion.decimalPlaces):calculation.billedQuantity} ${conversion?.outputUnitSymbol??options.units.find(value=>value.id===effective.directUnitId)?.symbol??''}`} result/></View>
      {locks.price?<Locked label="Unit price USD" value={selected.unitPriceUsd==null?'Unpriced':selected.unitPriceUsd.toFixed(2)}/>:<View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Unit price USD (blank = Unpriced)</Text><Tag field="Unit price"/></View><AppField label="" value={form.unitPriceUsd} onChangeText={value=>set('unitPriceUsd',value)} keyboardType="decimal-pad"/>{was('Unit price')}</View>}
      <View style={styles.metricRow}><MetricCard label="Subtotal" value={formatUsd(calculation.subtotalUsd)}/><MetricCard label={`VAT ${selected.vatRatePercent??0}%`} value={formatUsd(calculation.vatAmountUsd)}/><MetricCard label="Final total" value={formatUsd(calculation.finalTotalUsd)} accent/></View>
      <View style={styles.field}><View style={styles.labelRow}><Text style={styles.label}>Notes</Text><Tag field="Notes"/></View><AppField label="" value={form.notes} onChangeText={value=>set('notes',value)} multiline/>{was('Notes')}</View>
    </Section>

    <Section number="04" title="Signatures" hint="Replace a signature only if it needs to change. The old one is kept in the saved original.">
      <Text style={styles.sub}>SUPPLIER</Text>
      {supplierShown?<View style={styles.sigCard}><Text style={styles.sigName}>{[supplierShown.name,supplierShown.jobTitle].filter(Boolean).join(' · ')}</Text><Text style={styles.keptChip}>KEPT AS CONFIRMED</Text></View>
        :form.supplierSignature?<View style={styles.sigCard}><Text style={styles.sigName}>{signerLabel(form.supplierSignature)}</Text><Text style={styles.tag}>SUPPLIER SIGNATURE CHANGED</Text></View>
        :<View style={styles.sigCard}><Text style={styles.sigName}>No supplier signature</Text><Text style={styles.tag}>SUPPLIER SIGNATURE REMOVED</Text></View>}
      <AppButton label="Re-sign Supplier" tone="secondary" onPress={()=>{animate();setSupplierOpen(value=>!value);}}/>
      {supplierOpen?<View style={styles.sigCard}><HeaderSignerField signers={signerList} value={{signerId:form.supplierSignature?.signerId??null,display:form.supplierSignature?.display??null}} onChange={chooseSupplier} helper="Choose another saved signer for the supplier signature."/></View>:null}
      {(selected.supplierSignature||form.supplierSignature)&&form.supplierSignature!==null?<AppButton label="Remove supplier signature" tone="secondary" onPress={()=>set('supplierSignature',null)}/>:null}
      <Text style={styles.sub}>DRIVER</Text>
      {selected.signaturePaths.length&&form.driverSignaturePaths===undefined&&!changed.has('Driver signature')?<View style={styles.sigCard}><View style={styles.sigPreview}><Svg width="100%" height="100%" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet">{selected.signaturePaths.map((path,index)=><Path key={`${index}-${path.length}`} d={path} fill="none" stroke="#111" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}</Svg></View><Text style={styles.keptChip}>KEPT AS CONFIRMED</Text></View>
        :<Text style={styles.helper}>{changed.has('Driver signature')?(effective.driverSignaturePaths.length?'The driver signature will be replaced.':'The driver signature will be removed.'):'This load has no driver signature.'}</Text>}
      {changed.has('Driver signature')&&form.driverSignaturePaths===undefined?<Feedback kind="warning">Signature removed because the driver changed.</Feedback>:null}
      <AppButton label="Re-sign Driver" tone="secondary" onPress={()=>{animate();setDriverPadOpen(value=>!value);}}/>
      {driverPadOpen?<><SignaturePad value={form.driverSignaturePaths??[]} onChange={paths=>set('driverSignaturePaths',paths)} onSigningChange={onSigningChange}/><Text style={styles.helper}>Page scrolling pauses while you sign.</Text></>:null}
      {(selected.signaturePaths.length||form.driverSignaturePaths?.length)&&effective.driverSignaturePaths.length?<AppButton label="Remove driver signature" tone="secondary" onPress={()=>set('driverSignaturePaths',[])}/>:null}
    </Section>

    <AppCard title={changes.length?`Changed fields (${changes.length})`:'No fields changed yet'} hint={changes.length?undefined:'Changed fields get a CHANGED tag and appear here.'}>
      {changes.map(row=><View key={row.field} style={styles.diffRow}><Text style={styles.diffField}>{row.field}</Text><View style={styles.diffValues}><Text style={styles.diffWas}>{shown(row.field,row.originalValue)}</Text><Text style={styles.diffArrow}>→</Text><Text style={styles.diffNow}>{shown(row.field,row.newValue)}</Text></View></View>)}
      <AppField label="Reason for correction *" value={form.correctionReason??''} onChangeText={value=>set('correctionReason',value)} multiline placeholder="Why is this correction needed?"/>
      {reasonMissing&&changes.length?<Feedback kind="warning">Enter a correction reason to continue.</Feedback>:null}
      {!changes.length&&!reasonMissing?<Feedback kind="warning">Change at least one field to continue.</Feedback>:null}
      {issues.length?<Feedback kind="error">{issues.map(issue=>`• ${issue}`).join('\n')}</Feedback>:null}
      {error?<Feedback kind="error">{error}</Feedback>:null}
      <AppButton label="Save Correction" busy={busy} disabled={!canSave} onPress={save}/>
      <AppButton label="Cancel" tone="secondary" onPress={onChooseAnother}/>
    </AppCard>

    <AppCard title={`Correction history (${history.length})`}>
      {history.length?history.map((entry,index)=>{const version=versionFor(entry.correctedAt);return <View key={`${entry.correctedAt}-${index}`} style={styles.historyEntry}>
        <Text style={styles.historyDate}>{new Date(entry.correctedAt).toLocaleString()}</Text>
        <Text style={styles.historyReason}>{entry.reason}</Text>
        {entry.changes.map(change=><View key={change.field} style={styles.diffRow}><Text style={styles.diffField}>{change.field}</Text><View style={styles.diffValues}><Text style={styles.diffWas}>{shown(change.field,change.originalValue)}</Text><Text style={styles.diffArrow}>→</Text><Text style={styles.diffNow}>{shown(change.field,change.newValue)}</Text></View></View>)}
        {version?<Text style={styles.keptChip}>{`ORIGINAL SAVED · VERSION ${version}`}</Text>:null}
      </View>;}):<View style={styles.empty}><Text style={styles.historyReason}>No corrections yet</Text><Text style={styles.helper}>This load has never been corrected. The first correction saves the original here.</Text></View>}
      {history.length?<Text style={styles.helper}>Version 1 is the load exactly as first confirmed.</Text>:null}
    </AppCard>
  </View>;
}

function Section({number,title,hint,children}:{number:string;title:string;hint:string;children:React.ReactNode}){
  return <View style={styles.gap}>
    <View style={styles.sectionHead}><View style={styles.sectionNumber}><Text style={styles.sectionNumberText}>{number}</Text></View><View style={styles.flex}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionHint}>{hint}</Text></View></View>
    <AppCard>{children}</AppCard>
  </View>;
}

const styles=StyleSheet.create({
  gap:{gap:14},flex:{flex:1,minWidth:0},center:{minHeight:120,alignItems:'center',justifyContent:'center'},
  helper:{color:colors.muted,fontSize:13,lineHeight:19},
  hero:{backgroundColor:colors.navy,borderRadius:18,padding:18,gap:4,borderBottomWidth:4,borderBottomColor:colors.brand},heroKicker:{color:'#F2A184',fontSize:11,fontWeight:'900',letterSpacing:1},heroNumber:{color:'#FFF',fontSize:25,fontWeight:'900'},heroHint:{color:'#D8E4ED',fontSize:12,lineHeight:18},
  heroLink:{minHeight:44,justifyContent:'center'},heroLinkText:{color:'#F2A184',fontWeight:'900',fontSize:13},
  notice:{backgroundColor:'#FFF3D8',color:colors.warning,padding:11,borderRadius:9,lineHeight:17,fontSize:12,fontWeight:'700',overflow:'hidden'},
  earlier:{alignSelf:'flex-start',color:colors.success,backgroundColor:'#E5F3EC',borderRadius:9,paddingHorizontal:9,paddingVertical:5,overflow:'hidden',fontSize:11,fontWeight:'900'},
  sectionHead:{flexDirection:'row',alignItems:'flex-start',gap:12},sectionNumber:{width:34,height:34,borderRadius:17,backgroundColor:colors.navy,alignItems:'center',justifyContent:'center'},sectionNumberText:{color:'#FFF',fontSize:12,fontWeight:'900'},sectionTitle:{color:colors.ink,fontSize:18,fontWeight:'900'},sectionHint:{color:colors.muted,fontSize:12,lineHeight:17,marginTop:2},
  field:{gap:6},labelRow:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},label:{color:colors.ink,fontSize:13,fontWeight:'800'},
  tag:{color:colors.brandDark,backgroundColor:'#FBE9E4',borderRadius:9,paddingHorizontal:7,paddingVertical:3,overflow:'hidden',fontSize:9,fontWeight:'900',letterSpacing:.7},tagUnit:{color:colors.resultDark,backgroundColor:colors.resultSoft},
  tagLock:{color:colors.muted,backgroundColor:'#EEEAE3',borderRadius:9,paddingHorizontal:7,paddingVertical:3,overflow:'hidden',fontSize:9,fontWeight:'900',letterSpacing:.7},
  input:{minHeight:46,borderWidth:1,borderColor:colors.line,borderRadius:11,backgroundColor:'#FFF',paddingHorizontal:12,justifyContent:'center'},inputLocked:{backgroundColor:'#F3F0EA',borderStyle:'dashed'},lockedText:{color:'#7A838C',fontSize:14},
  changedBox:{borderWidth:2,borderColor:colors.brand,borderRadius:12},was:{color:colors.muted,fontSize:11.5},info:{color:colors.navy,backgroundColor:'#EAF1F6',padding:10,borderRadius:10,fontSize:12,fontWeight:'700',overflow:'hidden'},
  columns:{flexDirection:'row',gap:10},metricRow:{flexDirection:'row',flexWrap:'wrap',gap:8},
  notSaved:{flexDirection:'row',alignItems:'center',gap:8},notSavedChip:{color:colors.warning,backgroundColor:'#FFF3D8',borderRadius:9,paddingHorizontal:8,paddingVertical:4,overflow:'hidden',fontSize:10,fontWeight:'900',letterSpacing:.6},
  sub:{color:colors.navy,fontSize:11,fontWeight:'900',letterSpacing:1},sigCard:{borderWidth:1,borderColor:colors.line,borderRadius:12,padding:12,gap:6,backgroundColor:'#FCFBF8'},sigName:{color:colors.ink,fontSize:14,fontWeight:'900'},sigPreview:{height:60,borderWidth:1,borderColor:colors.line,borderRadius:10,backgroundColor:'#FFF'},
  keptChip:{alignSelf:'flex-start',color:colors.success,backgroundColor:'#E5F3EC',borderRadius:9,paddingHorizontal:8,paddingVertical:4,overflow:'hidden',fontSize:10,fontWeight:'900',letterSpacing:.6},
  diffRow:{borderTopWidth:1,borderTopColor:colors.line,paddingVertical:9,gap:3},diffField:{color:colors.muted,fontSize:12,fontWeight:'800'},diffValues:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8},diffWas:{color:colors.danger,fontSize:14,fontWeight:'700',flexShrink:1},diffArrow:{color:colors.muted,fontSize:14,fontWeight:'900'},diffNow:{color:colors.success,fontSize:15,fontWeight:'900',flexShrink:1},
  historyEntry:{borderTopWidth:1,borderTopColor:colors.line,paddingTop:10,gap:3},historyDate:{color:colors.ink,fontWeight:'800',fontSize:12},historyReason:{color:colors.ink,fontSize:13,fontWeight:'700'},
  empty:{borderWidth:1,borderStyle:'dashed',borderColor:colors.line,borderRadius:14,padding:14,gap:6},
});
