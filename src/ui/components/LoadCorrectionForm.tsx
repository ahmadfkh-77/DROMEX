import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';

import type {ContractQuantitiesRepository} from '../../data/repositories/ContractQuantitiesRepository';
import type {DocumentSignerRepository} from '../../data/repositories/DocumentSignerRepository';
import type {LoadRepository} from '../../data/repositories/LoadRepository';
import type {ContractItem} from '../../domain/contractQuantities';
import type {DocumentSigner} from '../../domain/documentSigners';
import {correctionBaseline,correctionChanges,correctionLocks,correctionToLoadDraft,correctionVatRate,loadLocalDate,validateLoadCorrection,type LoadCorrectionContext} from '../../domain/loadCorrection';
import {changedLoadCorrectionLines,correctedTargetKept,loadCorrectionLines,loadCorrectionTotals} from '../../domain/loadCorrectionPage';
import {choiceForRate} from '../../domain/accountVat';
import {calculateLoad,formatUsd,type ConfirmedLoad,type LoadCorrectionDraft} from '../../domain/loads';
import {truckCrewRoleLabel} from '../../domain/people';
import {fitSignatureToBox} from '../../domain/signatureFit';
import {VatChoiceControl} from './AccountVatControl';
import {AppButton,AppField} from './AppPrimitives';
import {DatePickerField,todayIso} from './DatePickerField';
import {GroupedSearchableSelect} from './GroupedSearchableSelect';
import {HeaderSignerField,type HeaderSignerValue} from './HeaderSignerField';
import {LoadCorrectionPage,type CorrectionSheetKey} from './LoadCorrectionPage';
import {LoadDocuments,type DocumentViewData} from './LoadDocuments';
import {OpenSwitch} from './OpenSwitch';
import {SearchableSelect} from './SearchableSelect';
import {SegmentedChoice} from './SegmentedChoice';
import {SignaturePad} from './SignaturePad';
import {draftDocument} from '../screens/MakeReceiptScreen';
import {colors} from '../theme';

const amount=(value:number)=>String(Number(value.toFixed(3)));

/**
 * DEC-536. The Correct this load container: it loads everything the correction needs, keeps the correction form, and hands the
 * Supplier-style page (LoadCorrectionPage) its lines, sheets and totals. Saving keeps the original load in the history; the load number and
 * transaction number never change. The sheets reuse the Make Receipt controls: the Project / Other address switch, the driver chips with
 * counts, Counts toward target, the fitted signature pad and Preview documents.
 */
export function LoadCorrectionForm({repository,signers,contracts,selected,message,onSaved,onChooseAnother,onCancelled}:{repository:LoadRepository;signers?:DocumentSignerRepository;contracts?:ContractQuantitiesRepository;selected:ConfirmedLoad;message?:string|null;onSaved:(updated:ConfirmedLoad)=>void;onChooseAnother:()=>void;onCancelled:(updated:ConfirmedLoad)=>void}){
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[context,setContext]=useState<LoadCorrectionContext|null>(null);
  const[signerList,setSignerList]=useState<DocumentSigner[]>([]);
  const[form,setForm]=useState<LoadCorrectionDraft>(()=>({...correctionBaseline(selected)}));
  const[driverMode,setDriverMode]=useState<'saved'|'typed'>(selected.driverId?'saved':'typed');
  const[truckMode,setTruckMode]=useState<'saved'|'typed'>(selected.truckId?'saved':'typed');
  const[destMode,setDestMode]=useState<'project'|'address'>(selected.projectId?'project':'address');
  const[typedDriver,setTypedDriver]=useState(selected.driverId?'':selected.driverName);
  const[typedPlate,setTypedPlate]=useState(selected.truckId?'':selected.truckPlate);
  const[crewFilter,setCrewFilter]=useState<'all'|'driver'|'operator'>('all');
  const[candidates,setCandidates]=useState<ContractItem[]>([]);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const[signing,setSigning]=useState(false);
  const snapshot=useRef<{form:LoadCorrectionDraft;driverMode:'saved'|'typed';truckMode:'saved'|'typed';destMode:'project'|'address';typedDriver:string;typedPlate:string}|null>(null);

  const load=useCallback(()=>{
    setStatus('loading');
    Promise.all([repository.getCorrectionContext(selected.id),signers?signers.listSigners():Promise.resolve([] as DocumentSigner[])])
      .then(([next,list])=>{setContext(next);setSignerList(list);setStatus('ready');})
      .catch(()=>setStatus('error'));
  },[repository,signers,selected.id]);
  useEffect(()=>{load();},[load]);

  const options=context?.options;
  const payments=context?.activePaymentCents??0;
  const locks=correctionLocks(payments);
  const signerLabel=useCallback((selection:{signerId:string;display:string})=>{const signer=signerList.find(value=>value.id===selection.signerId);return `${signer?.name??selection.signerId}${selection.display==='name_only'?' (name only)':''}`;},[signerList]);
  const effective=useMemo(()=>correctionToLoadDraft(selected,form),[selected,form]);
  const isDirect=selected.quantityMethod==='direct';

  // DEC-536. Counts toward target: the targets this corrected load may count toward, read again when the project or the item changes.
  useEffect(()=>{
    let active=true;
    if(!contracts||!effective.itemId){setCandidates([]);return;}
    contracts.candidatesFor(effective.projectId||null,effective.itemId).then(value=>{if(active)setCandidates(value.candidates);}).catch(()=>{if(active)setCandidates([]);});
    return()=>{active=false;};
  },[contracts,effective.projectId,effective.itemId]);
  const targetId=form.contractItemId!==undefined?(form.contractItemId||null):(selected.contractItemId&&correctedTargetKept(selected,form)?selected.contractItemId:null);
  const targetRow=targetId?candidates.find(value=>value.id===targetId):undefined;
  const targetName=targetId?(targetRow?.name??(targetId===selected.contractItemId?context?.contractTargetName:null)??'Chosen target'):null;
  const targetLabel=targetId?`${targetName}${targetRow?` · ${amount(targetRow.quantity)} ${targetRow.unitSymbol}`:''}`:'Not linked';
  const showTarget=candidates.length>0||!!selected.contractItemId;
  const target=showTarget?{label:targetLabel,signature:targetId??''}:null;
  const baseTarget=showTarget?{label:selected.contractItemId?(context?.contractTargetName??'Linked target'):'Not linked',signature:selected.contractItemId??''}:null;
  const targetChange=(targetId??null)!==(selected.contractItemId??null)?{was:selected.contractItemId?context?.contractTargetName??null:null,now:targetName}:undefined;

  const changes=useMemo(()=>options?correctionChanges(selected,form,options,signerLabel,targetChange):[],[selected,form,options,signerLabel,targetChange?.was,targetChange?.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues=useMemo(()=>options?validateLoadCorrection(selected,form,options,payments):[],[selected,form,options,payments]);
  const lines=useMemo(()=>options?loadCorrectionLines(selected,form,options,target,payments):[],[selected,form,options,target?.label,target?.signature,payments]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseLines=useMemo(()=>options?loadCorrectionLines(selected,correctionBaseline(selected),options,baseTarget,payments):[],[selected,options,baseTarget?.label,baseTarget?.signature,payments]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed=useMemo(()=>changedLoadCorrectionLines(baseLines,lines),[baseLines,lines]);
  const totals=useMemo(()=>options?loadCorrectionTotals(selected,form,options):{subtotal:null,vatRatePercent:0,vatAmount:null,total:null},[selected,form,options]);
  const baseTotal=useMemo(()=>options?loadCorrectionTotals(selected,correctionBaseline(selected),options).total:null,[selected,options]);

  function set<K extends keyof LoadCorrectionDraft>(key:K,value:LoadCorrectionDraft[K]){setForm(current=>({...current,[key]:value}));setError(null);}

  if(status==='loading')return <View style={styles.center}><Text style={styles.helper}>Loading this load's details…</Text></View>;
  if(status==='error'||!context||!options)return <View style={styles.errorBox}><Text style={styles.errorText}>This load's details could not be loaded. Nothing was changed.</Text><AppButton label="Try again" tone="secondary" onPress={load}/><AppButton label="Choose Another Load" tone="secondary" onPress={onChooseAnother}/></View>;

  const project=options.projects.find(value=>value.id===effective.projectId);
  const customer=options.customers.find(value=>value.id===effective.customerId);
  const maxDate=project?.endDate&&project.endDate<todayIso()?project.endDate:todayIso();
  const conversion=options.conversions.find(value=>value.id===effective.conversionId);
  const directConversions=options.conversions.filter(value=>value.inputUnitId===effective.directUnitId);
  const universalVat=options.companySettings.vatRatePercent??0;
  const vatRate=(()=>{try{return correctionVatRate(selected,form,universalVat);}catch{return selected.vatRatePercent??0;}})();
  const calculation=calculateLoad(effective,conversion,vatRate);
  const crew=options.drivers;
  const crewFilterOptions=[{id:'all' as const,label:'All',count:crew.length},{id:'driver' as const,label:'Drivers',count:crew.filter(value=>value.role==='driver').length},{id:'operator' as const,label:'Operators',count:crew.filter(value=>value.role==='operator').length}];
  const crewOptions=crew.filter(value=>crewFilter==='all'||value.role===crewFilter||value.id===form.driverId).map(value=>({id:value.id,label:value.name,detail:truckCrewRoleLabel(value.role)}));
  const itemGroups=(()=>{const grouped=new Map<string,typeof options.items>();for(const value of options.items)grouped.set(value.categoryName,[...(grouped.get(value.categoryName)??[]),value]);return [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([categoryName,values])=>({id:categoryName,label:categoryName,options:[...values].sort((a,b)=>a.name.localeCompare(b.name)).map(value=>({id:value.id,label:value.name,detail:value.internalCode??undefined}))}));})();
  const billedUnit=conversion?.outputUnitSymbol??options.units.find(value=>value.id===effective.directUnitId)?.symbol??'unit';

  // A project or item change drops a target chosen earlier: the target must belong to the project and list the material (DEC-522, Option 1).
  const resetTarget={contractItemId:undefined};
  function selectProject(id:string){const next=options!.projects.find(value=>value.id===id);setForm(current=>({...current,...resetTarget,projectId:id,customerId:next?.customerId??current.customerId}));setError(null);}
  function selectCustomer(id:string){setForm(current=>{const currentProject=options!.projects.find(value=>value.id===current.projectId);const keep=currentProject?.customerId===id;return {...current,...(keep?{}:resetTarget),customerId:id,projectId:keep?current.projectId:''};});setError(null);}
  function chooseDestMode(mode:'project'|'address'){if(mode===destMode)return;setDestMode(mode);if(mode==='address')setForm(current=>({...current,...resetTarget,projectId:''}));setError(null);}
  function selectItem(id:string){setForm(current=>({...current,...resetTarget,itemId:id}));setError(null);}
  function selectDriver(id:string){const next=crew.find(value=>value.id===id);setForm(current=>({...current,driverId:id,driverName:next?.name??''}));setError(null);}
  function selectTruck(id:string){const next=options!.trucks.find(value=>value.id===id);setForm(current=>({...current,truckId:id,truckPlate:next?.plate??''}));setError(null);}
  function switchDriver(mode:'saved'|'typed'){if(mode===driverMode)return;setDriverMode(mode);setForm(current=>({...current,driverId:'',driverName:mode==='typed'?typedDriver:''}));}
  function switchTruck(mode:'saved'|'typed'){if(mode===truckMode)return;setTruckMode(mode);setForm(current=>({...current,truckId:'',truckPlate:mode==='typed'?typedPlate:''}));}
  function selectUnit(id:string){setForm(current=>({...current,directUnitId:id,conversionId:options!.conversions.some(value=>value.id===current.conversionId&&value.inputUnitId===id)?current.conversionId:''}));setError(null);}
  function chooseSupplier(value:HeaderSignerValue){if(value.signerId)set('supplierSignature',{signerId:value.signerId,display:value.display??'name_only'});else set('supplierSignature',undefined);}

  // The pad's strokes are fitted into the fixed printed signature box before anything is saved or previewed (DEC-524), as in Make Receipt.
  const fitted=(value:LoadCorrectionDraft):LoadCorrectionDraft=>value.driverSignaturePaths===undefined?value:{...value,driverSignaturePaths:fitSignatureToBox(value.driverSignaturePaths)};
  async function save():Promise<boolean>{
    setBusy(true);setError(null);
    try{const updated=await repository.correctLoad(selected.id,fitted(form));onSaved(updated);return true;}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not save the correction. Nothing was changed.');return false;}
    finally{setBusy(false);}
  }
  async function cancelLoad(reason:string):Promise<boolean>{
    setBusy(true);setError(null);
    try{const updated=await repository.cancelLoad(selected.id,reason);onCancelled(updated);return true;}
    catch(cause){setError(cause instanceof Error?cause.message:'Could not cancel the load.');return false;}
    finally{setBusy(false);}
  }

  const Locked=({value}:{value:string})=><View style={styles.lockedBox}><Text style={styles.lockedText}>{value}</Text><Text style={styles.lockedTag}>LOCKED · PAYMENTS</Text></View>;
  const help=(text:string)=><Text style={styles.helper}>{text}</Text>;

  function previewData():DocumentViewData{
    const eff=correctionToLoadDraft(selected,fitted(form));
    const calc=calculateLoad(eff,conversion,vatRate);
    const base=draftDocument(options!,eff,calc,selected.loadNumber??null);
    const pick=form.supplierSignature;
    const signer=pick===undefined?selected.supplierSignature??null:pick===null?null:(()=>{const found=signerList.find(value=>value.id===pick.signerId);return found?{signerId:found.id,name:found.name,jobTitle:found.jobTitle,department:found.department,display:pick.display,signature:pick.display==='name_only'?[]:found.signature}:null;})();
    return{...base,transactionNumber:selected.transactionNumber,dateTime:eff.recordDate===loadLocalDate(selected.confirmedAt)?selected.confirmedAt:base.dateTime,vatRatePercent:eff.unitPriceUsd.trim()?vatRate:null,supplierSignature:signer};
  }

  function renderSheet(sheet:CorrectionSheetKey):ReactNode{
    switch(sheet){
      case 'date':return <>
        <DatePickerField variant="open" label="Record date *" value={form.recordDate??''} onChange={value=>set('recordDate',value)} minDate={project?.startDate??undefined} maxDate={maxDate}/>
        {help("The day the load left the plant. Not later than today, and inside the project's dates. The load number does not change, and the load moves to the new day in reports and totals.")}
      </>;
      case 'customer':return <>
        <SearchableSelect variant="open" label="Customer *" options={options!.customers.map(value=>({id:value.id,label:value.name,detail:value.isOwnCompany?'Own company':value.type}))} selectedId={form.customerId??''} onSelect={selectCustomer}/>
        {help('Changing the customer also clears the project, unless the project belongs to the new customer.')}
      </>;
      case 'place':return <>
        <OpenSwitch label="Delivered to *" options={[{id:'project' as const,label:'Project'},{id:'address' as const,label:'Other address'}]} selectedId={destMode} onSelect={chooseDestMode}/>
        {destMode==='project'?<>
          {help("The load goes to a saved project and appears in that project's daily report.")}
          <SearchableSelect variant="open" label="Select project *" options={options!.projects.map(value=>({id:value.id,label:value.name,detail:`${value.customerName} · ${value.location}`}))} selectedId={form.projectId??''} onSelect={selectProject} placeholder="Choose the project"/>
        </>:<>
          {help('For an outside customer without a saved project. Own company always needs a saved project.')}
          <AppField variant="open" label="Destination address *" value={form.destinationAddress} onChangeText={value=>set('destinationAddress',value)} multiline/>
        </>}
        {help('Choosing a project also fills its customer.')}
      </>;
      case 'item':return <>
        <GroupedSearchableSelect variant="open" label="Load-enabled item *" groups={itemGroups} selectedId={form.itemId??''} onSelect={selectItem} placeholder="Choose category, then item"/>
        {help(`The load number stays ${selected.loadNumber??selected.transactionNumber} even if the item changes.`)}
        {selected.contractItemId?<Text style={styles.info}>Changing the item removes the target link. Choose it again under Counts toward target if the load still counts.</Text>:null}
      </>;
      case 'target':return <>
        <SearchableSelect variant="open" label="Counts toward target" options={candidates.map(value=>({id:value.id,label:value.name,detail:`${amount(value.quantity)} ${value.unitSymbol} target`}))} selectedId={targetId??''} onSelect={id=>set('contractItemId',id)} allowClear placeholder="Not linked to a target"/>
        {help("Optional. The project's target this load counts toward. Only targets of this project that use this item are listed.")}
        <Text style={styles.info}>Changing the project or the item removes this link automatically, and a line is added to the correction history.</Text>
      </>;
      case 'quantity':return isDirect?<>
        {locks.unit?<View><Text style={styles.label}>Measurement unit *</Text><Locked value={options!.units.find(value=>value.id===effective.directUnitId)?.symbol??selected.directUnitSymbol??''}/></View>
          :<SearchableSelect variant="open" label="Unit *" options={options!.units.map(value=>({id:value.id,label:value.name,detail:value.symbol}))} selectedId={form.directUnitId??''} onSelect={selectUnit} placeholder="Piece, metre, bundle, or another unit"/>}
        <AppField variant="open" label="Quantity *" value={form.directQuantity} onChangeText={value=>set('directQuantity',value)} keyboardType="decimal-pad"/>
        {help('Pieces, metres, bundles or another unit. The converted quantity and the total are recalculated.')}
      </>:<>
        <AppField variant="open" label="Empty weight kg *" value={form.emptyWeightKg} onChangeText={value=>set('emptyWeightKg',value)} keyboardType="number-pad"/>
        <AppField variant="open" label="Full weight kg *" value={form.fullWeightKg} onChangeText={value=>set('fullWeightKg',value)} keyboardType="number-pad"/>
        <View style={styles.result}><Text style={styles.resultLabel}>Net weight</Text><Text style={styles.resultValue}>{calculation.netWeightKg==null?'—':`${calculation.netWeightKg} kg`}</Text></View>
        <AppField variant="open" label="Requested quantity (kg, optional)" value={form.requestedQuantityKg} onChangeText={value=>set('requestedQuantityKg',value)} keyboardType="number-pad"/>
        {help('Empty and full kg from the weighbridge.')}
      </>;
      case 'conversion':return <>
        <SearchableSelect variant="open" label={isDirect?'Conversion (optional)':'Conversion *'} options={(isDirect?directConversions:options!.conversions).map(value=>({id:value.id,label:value.name,detail:`${value.inputQuantity} ${value.inputUnitSymbol} = ${value.outputQuantity} ${value.outputUnitSymbol}`}))} selectedId={form.conversionId??''} onSelect={id=>set('conversionId',id)} allowClear={isDirect} placeholder={isDirect?'No conversion (use the quantity as entered)':'Choose the conversion'}/>
        <View style={styles.result}><Text style={styles.resultLabel}>Converted quantity{conversion?` (${conversion.outputUnitSymbol})`:''}, used for the price</Text><Text style={styles.resultValue}>{calculation.billedQuantity==null?'—':`${conversion?calculation.billedQuantity.toFixed(conversion.decimalPlaces):calculation.billedQuantity} ${billedUnit}`}</Text></View>
      </>;
      case 'driver':return <>
        <OpenSwitch label="Driver / Operator *" options={[{id:'saved' as const,label:'Saved person'},{id:'typed' as const,label:'Type a name'}]} selectedId={driverMode} onSelect={switchDriver}/>
        {driverMode==='saved'?<>
          <SegmentedChoice mode="tabs" options={crewFilterOptions} selectedId={crewFilter} onSelect={setCrewFilter}/>
          <SearchableSelect variant="open" label="Saved driver or operator" options={crewOptions} selectedId={form.driverId??''} onSelect={selectDriver} placeholder="Choose the person driving"/>
        </>:<>
          <AppField variant="open" label="Driver name *" value={typedDriver} onChangeText={value=>{setTypedDriver(value);setForm(current=>({...current,driverId:'',driverName:value}));}} autoCapitalize="words"/>
          <View style={styles.notSaved}><Text style={styles.notSavedChip}>NOT SAVED</Text><Text style={[styles.helper,styles.flex]}>Used on this load only. It is not added to People.</Text></View>
        </>}
        {selected.signaturePaths.length&&effective.driverId!==(selected.driverId??'')&&form.driverSignaturePaths===undefined?<Text style={styles.warn}>{`The load was signed by ${selected.driverName}. Changing the driver removes that signature; draw a new one in Signatures, or leave it unsigned.`}</Text>:null}
      </>;
      case 'truck':return <>
        <OpenSwitch label="Truck *" options={[{id:'saved' as const,label:'Saved truck'},{id:'typed' as const,label:'Type a plate'}]} selectedId={truckMode} onSelect={switchTruck}/>
        {truckMode==='saved'?<SearchableSelect variant="open" label="Saved truck" options={options!.trucks.map(value=>({id:value.id,label:value.plate,detail:[value.makeModel,value.ownerName].filter(Boolean).join(' · ')}))} selectedId={form.truckId??''} onSelect={selectTruck} placeholder="Choose the truck"/>
          :<><AppField variant="open" label="Truck plate *" value={typedPlate} onChangeText={value=>{setTypedPlate(value);setForm(current=>({...current,truckId:'',truckPlate:value}));}} autoCapitalize="characters"/>
          <View style={styles.notSaved}><Text style={styles.notSavedChip}>NOT SAVED</Text><Text style={[styles.helper,styles.flex]}>Used on this load only. It is not added to Trucks.</Text></View></>}
      </>;
      case 'price':return <>
        <View style={styles.group}><Text style={styles.groupLabel}>PRICE</Text>
          {locks.price?<View><Text style={styles.label}>Price per {billedUnit} (USD)</Text><Locked value={selected.unitPriceUsd==null?'Unpriced':selected.unitPriceUsd.toFixed(2)}/></View>
            :<AppField variant="open" label={`Price per ${billedUnit} (USD, optional)`} value={form.unitPriceUsd} onChangeText={value=>set('unitPriceUsd',value)} keyboardType="decimal-pad" placeholder="Leave blank for Unpriced"/>}
        </View>
        <View style={styles.group}><Text style={styles.groupLabel}>VAT</Text>
          {locks.vat?<Locked value={vatRate>0?`${vatRate}%`:'No VAT'}/>:<VatChoiceControl label="VAT" value={form.vat??choiceForRate(selected.vatRatePercent,universalVat)} onChange={vat=>set('vat',vat)} universalRatePercent={universalVat} hint="Changing VAT needs the correction reason. The old figures stay in the history."/>}
        </View>
        <View style={styles.result}><Text style={styles.resultLabel}>Corrected total</Text><Text style={styles.resultValue}>{totals.total==null?'Unpriced':formatUsd(totals.total)}</Text></View>
      </>;
      case 'notes':return <AppField variant="open" label="Notes" value={form.notes} onChangeText={value=>set('notes',value)} multiline/>;
      case 'signatures':{
        const supplierShown=form.supplierSignature===undefined?selected.supplierSignature:null;
        return <>
          <Text style={styles.sub}>SUPPLIER</Text>
          {supplierShown?<View style={styles.sigCard}><Text style={styles.sigName}>{[supplierShown.name,supplierShown.jobTitle].filter(Boolean).join(' · ')}</Text><Text style={styles.keptChip}>KEPT AS CONFIRMED</Text></View>
            :form.supplierSignature?<View style={styles.sigCard}><Text style={styles.sigName}>{signerLabel(form.supplierSignature)}</Text><Text style={styles.changedChip}>SUPPLIER SIGNATURE CHANGED</Text></View>
            :<View style={styles.sigCard}><Text style={styles.sigName}>No supplier signature</Text><Text style={styles.changedChip}>SUPPLIER SIGNATURE REMOVED</Text></View>}
          <HeaderSignerField signers={signerList} value={{signerId:form.supplierSignature?.signerId??null,display:form.supplierSignature?.display??null}} onChange={chooseSupplier} helper="Choose another saved signer for the supplier signature."/>
          {(selected.supplierSignature||form.supplierSignature)&&form.supplierSignature!==null?<AppButton label="Remove supplier signature" tone="secondary" onPress={()=>set('supplierSignature',null)}/>:null}
          <Text style={styles.sub}>DRIVER</Text>
          {selected.signaturePaths.length&&form.driverSignaturePaths===undefined&&effective.driverSignaturePaths.length?<View style={styles.sigCard}><View style={styles.sigPreview}><Svg width="100%" height="100%" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet">{selected.signaturePaths.map((path,index)=><Path key={`${index}-${path.length}`} d={path} fill="none" stroke="#111" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}</Svg></View><Text style={styles.keptChip}>KEPT AS CONFIRMED</Text></View>
            :<Text style={styles.helper}>{selected.signaturePaths.length&&!effective.driverSignaturePaths.length?'The driver signature will be removed.':form.driverSignaturePaths?.length?'The driver signature will be replaced.':'This load has no driver signature.'}</Text>}
          <SignaturePad large value={form.driverSignaturePaths??[]} onChange={paths=>set('driverSignaturePaths',paths)} onSigningChange={setSigning}/>
          {help("Your strokes are fitted into the printed signature box, so it prints the same as on a new load. Page scrolling pauses while you sign.")}
          {(selected.signaturePaths.length||form.driverSignaturePaths?.length)&&effective.driverSignaturePaths.length?<AppButton label="Remove driver signature" tone="secondary" onPress={()=>set('driverSignaturePaths',[])}/>:null}
        </>;
      }
      case 'preview':return <>
        <LoadDocuments data={previewData()} isDraft/>
        {help('Uses the corrected values. Nothing is saved. Issued documents keep their own copy.')}
      </>;
    }
  }

  return <LoadCorrectionPage selected={selected} context={context} lines={lines} baseLines={baseLines} changed={changed} changes={changes} issues={issues} totals={totals} baseTotal={baseTotal}
    reason={form.correctionReason??''} setReason={value=>set('correctionReason',value)} busy={busy} error={error} message={message??null} signing={signing} renderSheet={renderSheet}
    onSnapshot={()=>{snapshot.current={form,driverMode,truckMode,destMode,typedDriver,typedPlate};}}
    onRestore={()=>{const kept=snapshot.current;if(!kept)return;setForm(kept.form);setDriverMode(kept.driverMode);setTruckMode(kept.truckMode);setDestMode(kept.destMode);setTypedDriver(kept.typedDriver);setTypedPlate(kept.typedPlate);}}
    onBack={onChooseAnother} onSave={save} onCancelLoad={cancelLoad}/>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},center:{flex:1,minHeight:120,alignItems:'center',justifyContent:'center'},
  helper:{color:colors.muted,fontSize:12,lineHeight:17},label:{color:colors.ink,fontSize:13,fontWeight:'800',marginBottom:4},
  errorBox:{padding:20,gap:12},errorText:{color:colors.danger,backgroundColor:'#FCE8E6',padding:12,borderRadius:10,fontWeight:'700'},
  info:{color:colors.navy,backgroundColor:'#EAF1F6',padding:10,borderRadius:10,fontSize:12,fontWeight:'700',overflow:'hidden'},
  warn:{color:'#5A4210',backgroundColor:'#FFF3D8',padding:12,borderRadius:10,fontSize:12,lineHeight:17,borderLeftWidth:4,borderLeftColor:'#E3A23A'},
  group:{gap:8,borderTopWidth:1,borderTopColor:colors.line,paddingTop:12},groupLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1.2},
  lockedBox:{minHeight:48,borderBottomWidth:2,borderBottomColor:'#B7BDC3',borderStyle:'dashed',flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},lockedText:{color:'#7A838C',fontSize:16},lockedTag:{color:colors.muted,backgroundColor:'#EEEAE3',borderRadius:9,paddingHorizontal:7,paddingVertical:3,overflow:'hidden',fontSize:9,fontWeight:'900',letterSpacing:.7},
  result:{backgroundColor:colors.result,borderRadius:14,padding:12,gap:2},resultLabel:{color:'#E4F6F7',fontSize:12},resultValue:{color:'#FFF',fontSize:24,fontWeight:'900'},
  notSaved:{flexDirection:'row',alignItems:'center',gap:8},notSavedChip:{color:colors.warning,backgroundColor:'#FFF3D8',borderRadius:9,paddingHorizontal:8,paddingVertical:4,overflow:'hidden',fontSize:10,fontWeight:'900',letterSpacing:.6},
  sub:{color:colors.navy,fontSize:11,fontWeight:'900',letterSpacing:1},sigCard:{borderWidth:1,borderColor:colors.line,borderRadius:12,padding:12,gap:6,backgroundColor:'#FCFBF8'},sigName:{color:colors.ink,fontSize:14,fontWeight:'900'},sigPreview:{height:60,borderWidth:1,borderColor:colors.line,borderRadius:10,backgroundColor:'#FFF'},
  keptChip:{alignSelf:'flex-start',color:colors.success,backgroundColor:'#E5F3EC',borderRadius:9,paddingHorizontal:8,paddingVertical:4,overflow:'hidden',fontSize:10,fontWeight:'900',letterSpacing:.6},
  changedChip:{alignSelf:'flex-start',color:colors.brandDark,backgroundColor:'#FBE9E4',borderRadius:9,paddingHorizontal:8,paddingVertical:4,overflow:'hidden',fontSize:10,fontWeight:'900',letterSpacing:.6},
});
