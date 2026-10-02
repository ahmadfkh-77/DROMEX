import {useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,LayoutAnimation,Pressable,StyleSheet,Text,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';

import type {DocumentSignerRepository} from '../../../data/repositories/DocumentSignerRepository';
import type {DocumentSigner,DocumentSignerDraft,SignerEvent} from '../../../domain/documentSigners';
import {AppButton,AppField,AppPage,EmptyState,Feedback,PageHeader} from '../../components/AppPrimitives';
import {useReducedMotion} from '../../components/ExpandableMenu';
import {FocusedSheet,SheetActions} from '../../components/FocusedSheet';
import {SignaturePad} from '../../components/SignaturePad';
import {SupplierSignatureChooser,type SupplierSignatureSelection} from '../../components/SupplierSignatureChooser';
import {colors} from '../../theme';
import {formatRecordedAt} from '../../totalsPresentation';

type Details={id:string|null;draft:DocumentSignerDraft};
const eventWords:Record<SignerEvent['event'],string>={created:'Created',updated:'Details changed',signature_changed:'Signature changed',disabled:'Disabled',enabled:'Enabled again',used:'Used on a document'};

/**
 * DEC-487 (5). Authorized signers for statements, invoices and bills. A signer is never deleted, only
 * disabled. Every change and every use is kept in the signer's history, and issued documents keep
 * their own copy of the name, title and signature, so nothing done here changes them.
 */
export function SignersScreen({repository,onBack}:{repository:DocumentSignerRepository;onBack:()=>void}){
  const reducedMotion=useReducedMotion();
  const[signers,setSigners]=useState<DocumentSigner[]|null>(null);
  const[details,setDetails]=useState<Details|null>(null);
  const[signing,setSigning]=useState<{signer:DocumentSigner;strokes:string[]}|null>(null);
  const[drawing,setDrawing]=useState(false);
  const[historyFor,setHistoryFor]=useState<{signer:DocumentSigner;events:SignerEvent[]|null}|null>(null);
  const[sheetError,setSheetError]=useState<string|null>(null);
  const[error,setError]=useState<string|null>(null);const[message,setMessage]=useState<string|null>(null);
  const[busy,setBusy]=useState(false);const[disabledOpen,setDisabledOpen]=useState(false);
  const[deliverySigner,setDeliverySigner]=useState<SupplierSignatureSelection|null>(null);

  const refresh=useCallback(async()=>{try{setSigners(await repository.listSigners());setDeliverySigner(await repository.getDeliverySigner());}catch(cause){setError(cause instanceof Error?cause.message:'Signers could not be loaded.');setSigners(current=>current??[]);}},[repository]);
  useEffect(()=>{void refresh();},[refresh]);
  const run=async(action:()=>Promise<unknown>,done:string)=>{setBusy(true);setError(null);setMessage(null);try{await action();await refresh();setMessage(done);}catch(cause){setError(cause instanceof Error?cause.message:'The change could not be saved.');}finally{setBusy(false);}};
  const saveSheet=async(action:()=>Promise<unknown>,done:string,close:()=>void)=>{setBusy(true);setSheetError(null);try{await action();close();await refresh();setMessage(done);}catch(cause){setSheetError(cause instanceof Error?cause.message:'The change could not be saved.');}finally{setBusy(false);}};
  const openHistory=(signer:DocumentSigner)=>{setHistoryFor({signer,events:null});repository.listEvents(signer.id).then(events=>setHistoryFor({signer,events})).catch(()=>setHistoryFor({signer,events:[]}));};
  const disable=(signer:DocumentSigner)=>Alert.alert(`Disable ${signer.name}?`,'They will not be offered on new documents. Documents already issued keep their signature.',
    [{text:'Keep active',style:'cancel'},{text:'Disable',style:'destructive',onPress:()=>void run(()=>repository.setSignerActive(signer.id,false),'Signer disabled. Issued documents are unchanged.')}]);

  if(!signers)return <AppPage><PageHeader eyebrow="DOCUMENT SETTINGS" title="Authorized signers" onBack={onBack}/><View style={styles.center}><ActivityIndicator color={colors.brand}/></View></AppPage>;
  const active=signers.filter(value=>value.isActive),disabled=signers.filter(value=>!value.isActive);

  return <AppPage keyboard>
    <PageHeader eyebrow="DOCUMENT SETTINGS" title="Authorized signers" onBack={onBack}/>
    <Text style={styles.helper}>Choose a signer when you issue a statement, invoice or bill. Each issued document keeps its own copy, so editing, re-signing or disabling a signer never changes it.</Text>
    {error?<Feedback kind="error">{error}</Feedback>:null}{message?<Feedback kind="success">{message}</Feedback>:null}
    <AppButton label="Add signer" disabled={busy} onPress={()=>{setSheetError(null);setDetails({id:null,draft:{name:'',jobTitle:'',department:''}});}}/>
    {active.length?<View style={styles.list}>{active.map(signer=><SignerRow key={signer.id} signer={signer} busy={busy}
      onEdit={()=>{setSheetError(null);setDetails({id:signer.id,draft:{name:signer.name,jobTitle:signer.jobTitle??'',department:signer.department??''}});}}
      onSign={()=>{setSheetError(null);setSigning({signer,strokes:[]});}} onHistory={()=>openHistory(signer)} onToggle={()=>disable(signer)} toggleLabel="Disable"/>)}</View>
      :<EmptyState title="No signers yet" body="Add the people who sign your documents. A drawn signature is optional: a signer can sign by name only."/>}
    {/* DEC-490. The supplier signature every new Delivery Authorization carries under the driver's. */}
    <SupplierSignatureChooser title="Delivery Authorization signature" helper="Printed as the Supplier signature under the driver's on every new Delivery Authorization. Each load keeps its own copy; the Receipt is not signed." signers={signers} value={deliverySigner} busy={busy} saveLabel="Use on new authorizations" removeLabel="Stop signing new authorizations"
      onSave={selection=>void run(()=>repository.setDeliverySigner(selection),selection?'New Delivery Authorizations will carry this signature.':'New Delivery Authorizations will not carry a supplier signature.')}/>
    {disabled.length?<>
      <Pressable style={styles.band} onPress={()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setDisabledOpen(value=>!value);}} accessibilityRole="button" accessibilityState={{expanded:disabledOpen}}>
        <View style={styles.flex}><Text style={styles.bandTitle}>Disabled signers</Text><Text style={styles.helper}>{disabledOpen?'Tap to hide':'Tap to view'} · {disabled.length}</Text></View><Text style={styles.bandMark}>{disabledOpen?'×':'+'}</Text>
      </Pressable>
      {disabledOpen?<View style={styles.list}>{disabled.map(signer=><SignerRow key={signer.id} signer={signer} busy={busy} onHistory={()=>openHistory(signer)} onToggle={()=>void run(()=>repository.setSignerActive(signer.id,true),'Signer enabled.')} toggleLabel="Enable"/>)}</View>:null}
    </>:null}

    <FocusedSheet visible={!!details} eyebrow={details?.id?'EDIT SIGNER':'NEW SIGNER'} title={details?.draft.name.trim()||'Signer'} onClose={()=>setDetails(null)}
      footer={<SheetActions primaryLabel="Save signer" busy={busy} onCancel={()=>setDetails(null)} onPrimary={()=>{if(!details)return;const {id,draft}=details;void saveSheet(()=>id?repository.updateSigner(id,draft):repository.createSigner(draft),id?'Signer updated for future documents.':'Signer saved. Add a signature now, or sign by name.',()=>setDetails(null));}}/>}>
      {details?<>
        {sheetError?<Feedback kind="error">{sheetError}</Feedback>:null}
        <AppField label="Printed name *" value={details.draft.name} onChangeText={name=>setDetails({...details,draft:{...details.draft,name}})} maxLength={80} autoCapitalize="words"/>
        <AppField label="Job title" value={details.draft.jobTitle} onChangeText={jobTitle=>setDetails({...details,draft:{...details.draft,jobTitle}})} maxLength={80} placeholder="Finance manager, owner…"/>
        <AppField label="Company or department" value={details.draft.department} onChangeText={department=>setDetails({...details,draft:{...details.draft,department}})} maxLength={80}/>
      </>:null}
    </FocusedSheet>

    <FocusedSheet visible={!!signing} scrollEnabled={!drawing} eyebrow="SAVED SIGNATURE" title={signing?.signer.name??'Signature'} onClose={()=>setSigning(null)}
      footer={<SheetActions primaryLabel="Save signature" busy={busy} disabled={!signing?.strokes.length} onCancel={()=>setSigning(null)} onPrimary={()=>{if(!signing)return;const {signer,strokes}=signing;void saveSheet(()=>repository.saveSignature(signer.id,strokes),'Signature saved for future documents.',()=>setSigning(null));}}/>}>
      {signing?<>
        {sheetError?<Feedback kind="error">{sheetError}</Feedback>:null}
        <Text style={styles.helper}>{signing.signer.signature.length?'Signing again replaces the saved signature for future documents only.':'The page will not scroll while your finger is on the pad.'} The signature stays on this device and in your encrypted backups.</Text>
        <SignaturePad value={signing.strokes} onChange={strokes=>setSigning({...signing,strokes})} onSigningChange={setDrawing} hint={`${signing.signer.name} signs here`}/>
      </>:null}
    </FocusedSheet>

    <FocusedSheet visible={!!historyFor} eyebrow="SIGNER HISTORY" title={historyFor?.signer.name??''} onClose={()=>setHistoryFor(null)} footer={<View style={styles.flex}><AppButton label="Close" tone="secondary" onPress={()=>setHistoryFor(null)}/></View>}>
      {!historyFor?.events?<ActivityIndicator color={colors.brand}/>:historyFor.events.length?historyFor.events.map(event=><View key={event.id} style={styles.event}>
        <Text style={styles.eventTitle}>{eventWords[event.event]}</Text><Text style={styles.helper}>{formatRecordedAt(event.createdAt)}{event.details?` · ${event.details}`:''}</Text>
      </View>):<Text style={styles.helper}>No history recorded.</Text>}
    </FocusedSheet>
  </AppPage>;
}

function SignerRow({signer,busy,onEdit,onSign,onHistory,onToggle,toggleLabel}:{signer:DocumentSigner;busy:boolean;onEdit?:()=>void;onSign?:()=>void;onHistory:()=>void;onToggle:()=>void;toggleLabel:string}){
  const state=signer.signatureDamaged?'Signature unreadable · sign again':signer.signature.length?'Signature saved':'Name only';
  return <View style={[styles.row,!signer.isActive&&styles.rowOff]}>
    <View style={styles.rowTop}>
      <View style={styles.flex}><Text style={styles.rowTitle}>{signer.name}</Text>{[signer.jobTitle,signer.department].filter(Boolean).length?<Text style={styles.helper}>{[signer.jobTitle,signer.department].filter(Boolean).join(' · ')}</Text>:null}</View>
      <View style={[styles.pill,signer.signatureDamaged&&styles.pillWarning]}><Text style={[styles.pillText,signer.signatureDamaged&&styles.pillWarningText]}>{state}</Text></View>
    </View>
    {signer.signature.length?<View style={styles.preview} accessibilityLabel={`Saved signature of ${signer.name}`}><Svg width="100%" height="100%" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet">{signer.signature.map((path,index)=><Path key={index} d={path} fill="none" stroke={colors.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}</Svg></View>:null}
    <View style={styles.actions}>
      {onEdit?<Quiet label="Edit details" onPress={onEdit} busy={busy}/>:null}
      {onSign?<Quiet label={signer.signature.length?'Replace signature':'Add signature'} onPress={onSign} busy={busy}/>:null}
      <Quiet label="History" onPress={onHistory} busy={busy}/>
      <Quiet label={toggleLabel} onPress={onToggle} busy={busy}/>
    </View>
  </View>;
}
function Quiet({label,onPress,busy}:{label:string;onPress:()=>void;busy:boolean}){
  return <Pressable style={styles.quiet} onPress={onPress} disabled={busy} accessibilityRole="button"><Text style={styles.quietText}>{label}</Text></Pressable>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  center:{alignItems:'center',paddingVertical:30},
  helper:{color:'#4F5B66',fontSize:13,lineHeight:19},
  list:{gap:10},
  row:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:'#D9CFBE',padding:14,gap:8},
  rowOff:{backgroundColor:'#F7F4EE'},
  rowTop:{flexDirection:'row',alignItems:'flex-start',gap:10},
  rowTitle:{color:colors.ink,fontSize:16,fontWeight:'700'},
  pill:{flexShrink:0,maxWidth:'46%',paddingHorizontal:9,paddingVertical:5,borderRadius:12,borderWidth:1,borderColor:colors.navy},
  pillText:{color:colors.navy,fontSize:11,fontWeight:'700'},
  pillWarning:{borderColor:colors.warning,backgroundColor:'#FFF3D8'},pillWarningText:{color:colors.warning},
  preview:{height:84,borderRadius:10,borderWidth:1,borderColor:colors.line,backgroundColor:'#FFF'},
  actions:{flexDirection:'row',flexWrap:'wrap',gap:4},
  quiet:{minHeight:48,justifyContent:'center',paddingHorizontal:10},
  quietText:{color:colors.brandDark,fontSize:14,fontWeight:'700'},
  band:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,backgroundColor:colors.creamSoft,borderRadius:14,borderWidth:1,borderColor:colors.line,paddingHorizontal:14},
  bandTitle:{color:colors.ink,fontSize:15,fontWeight:'700'},
  bandMark:{color:colors.navy,fontSize:22},
  event:{gap:2,paddingVertical:8,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line},
  eventTitle:{color:colors.ink,fontSize:14,fontWeight:'700'},
});
