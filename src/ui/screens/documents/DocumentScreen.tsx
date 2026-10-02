import {useCallback,useEffect,useState} from 'react';
import {ActivityIndicator,Alert,Pressable,StyleSheet,Text,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';

import type {BusinessDocumentRepository} from '../../../data/repositories/BusinessDocumentRepository';
import type {DocumentSignerRepository} from '../../../data/repositories/DocumentSignerRepository';
import {deriveInclusion,documentKindInfo,missingOfficialFields,type BusinessDocument,type DocumentLink,type DocumentSettings,type PartyBlock,type RecordSnapshot,type SignerSelection} from '../../../domain/businessDocuments';
import type {DocumentSigner,SignerSnapshot} from '../../../domain/documentSigners';
import {formatTotalQuantity} from '../../../domain/projectTotals';
import {exportAndShareBusinessDocument} from '../../../services/documentExport';
import {AppButton,AppField,AppPage,Feedback,PageHeader} from '../../components/AppPrimitives';
import {DatePickerField} from '../../components/DatePickerField';
import {FocusedSheet,SheetActions} from '../../components/FocusedSheet';
import {SegmentedChoice} from '../../components/SegmentedChoice';
import {Ledger,RecordRow,styles as parts} from '../../components/totals/TotalsParts';
import {colors} from '../../theme';
import {formatCents,formatDay,formatRecordedAt} from '../../totalsPresentation';

const localToday=()=>{const value=new Date();return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;};
const partyFields:[keyof PartyBlock,string][]=[['name','Name'],['contactPerson','Contact person'],['address','Address'],['phone','Phone'],['email','Email'],['taxRegistrationNumber','Tax / VAT number'],['companyRegistrationNumber','Company registration number']];
const statusWords={Draft:'Draft — not issued',Issued:'Issued',Cancelled:'Cancelled'} as const;

/**
 * DEC-487 (2), (4), (5). One statement, invoice or bill. A draft is a working view of live records that
 * can be adjusted and then issued; an Issued document shows its frozen snapshot and can only be
 * exported or cancelled with a reason. Payment status is read live from Payments & Balances.
 */
export function DocumentScreen({documents,signers,documentId,onBack,onOpenRecord,onOpenSettings,onOpenSigners,onChanged}:{
  documents:BusinessDocumentRepository;signers:DocumentSignerRepository;documentId:string;onBack:()=>void;onOpenRecord:(record:RecordSnapshot)=>void;
  onOpenSettings:()=>void;onOpenSigners:()=>void;onChanged?:()=>void;
}){
  const[doc,setDoc]=useState<BusinessDocument|null>(null);
  const[links,setLinks]=useState<Record<string,DocumentLink[]>>({});
  const[settings,setSettings]=useState<DocumentSettings|null>(null);
  const[signerList,setSignerList]=useState<DocumentSigner[]>([]);
  const[error,setError]=useState<string|null>(null);
  const[message,setMessage]=useState<string|null>(null);
  const[busy,setBusy]=useState(false);
  const[details,setDetails]=useState({reference:'',dueDate:'',notes:''});
  const[editParties,setEditParties]=useState(false);
  const[issuer,setIssuer]=useState<Partial<PartyBlock>>({});
  const[recipient,setRecipient]=useState<Partial<PartyBlock>>({});
  const[terms,setTerms]=useState({paymentTerms:'',bankDetails:'',footerNote:''});
  const[issueDate,setIssueDate]=useState(localToday());
  const[numberOverride,setNumberOverride]=useState('');
  const[cancelOpen,setCancelOpen]=useState(false);
  const[reason,setReason]=useState('');

  const load=useCallback(async()=>{
    const next=await documents.getDocument(documentId);
    setLinks(await documents.inclusionFor(next.records.map(record=>record.key)));
    setDoc(next);
    setDetails({reference:next.reference??'',dueDate:next.dueDate??'',notes:next.notes??''});
    setIssuer({...next.issuer});setRecipient({...next.recipient});
    setTerms({paymentTerms:next.terms?.paymentTerms??'',bankDetails:next.terms?.bankDetails??'',footerNote:next.terms?.footerNote??''});
    if(next.status==='Draft'){const [values,list]=await Promise.all([documents.getSettings(Number(localToday().slice(0,4))),signers.listSigners()]);setSettings(values);setSignerList(list.filter(value=>value.isActive));}
  },[documents,signers,documentId]);
  useEffect(()=>{load().catch(cause=>setError(cause instanceof Error?cause.message:'The document could not be opened.'));},[load]);

  const run=async(action:()=>Promise<unknown>,done:string)=>{
    setBusy(true);setError(null);setMessage(null);
    try{await action();await load();setMessage(done);onChanged?.();}catch(cause){setError(cause instanceof Error?cause.message:'That did not work.');}finally{setBusy(false);}
  };

  if(!doc)return <AppPage><PageHeader eyebrow="DOCUMENT" title="Opening…" onBack={onBack}/>{error?<Feedback kind="error">{error}</Feedback>:<View style={styles.center}><ActivityIndicator color={colors.brand}/></View>}</AppPage>;

  const info=documentKindInfo[doc.kind];
  const draft=doc.status==='Draft';
  const official=info.mode==='official';
  const number=doc.documentNumber??doc.draftNumber;
  const nextNumber=settings?`${settings.prefixes[doc.kind]}-${issueDate.slice(0,4)}-${String(issueDate.slice(0,4)===String(settings.year)?settings.nextNumbers[doc.kind]:1).padStart(3,'0')}`:null;
  const issuerMissing=official?missingOfficialFields(doc.issuer):[];
  const recipientMissing=official?missingOfficialFields(doc.recipient).filter(field=>field!=='Business name'):[];
  const money=doc.groups.money;

  const saveDetails=()=>run(()=>documents.updateDraft(doc.id,{reference:details.reference,dueDate:details.dueDate||null,notes:details.notes,
    ...(editParties?{issuerOverride:issuer,recipientOverride:recipient,termsOverride:terms}:{})}),'Draft details saved.');
  const chooseSigner=(selection:SignerSelection|null)=>run(()=>documents.updateDraft(doc.id,{signer:selection}),selection?'Signer saved on the draft.':'Signer removed from the draft.');
  const issue=()=>Alert.alert(`Issue ${official&&numberOverride.trim()?numberOverride.trim():nextNumber??'this document'}?`,
    `Issued documents are permanent snapshots. Later corrections to these ${doc.records.length} records, your settings or the signer will not change it. To change it later you cancel it with a reason and issue a new one.`,
    [{text:'Review again',style:'cancel'},{text:'Issue document',onPress:()=>void run(()=>documents.issueDocument(doc.id,{issueDate,documentNumber:official?numberOverride:null}),'Issued. Its records now show as included everywhere.')}]);
  const remove=(key:string,title:string)=>Alert.alert(`Remove ${title} from this draft?`,'The record itself is not changed.',[{text:'Keep',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>void run(()=>documents.removeRecordsFromDraft(doc.id,[key]),'Record removed from the draft.')}]);
  const exportPdf=()=>run(()=>exportAndShareBusinessDocument(doc),'PDF ready to share.');

  return <AppPage keyboard>
    <PageHeader eyebrow={info.mode==='internal'?'INTERNAL STATEMENT':'OFFICIAL DOCUMENT'} title={number} onBack={onBack}/>
    <View style={parts.band}>
      <Text style={parts.trail}>{info.mode==='internal'?`Internal ${info.label.toLocaleLowerCase('en-US')}`:`Official ${info.label}`} · {doc.partyType==='customer'?'Customer':'Supplier'}</Text>
      <Text style={parts.bandTitle}>{doc.partyName}</Text>
      <View style={[styles.status,styles[`status${doc.status}`]]}><View style={[styles.statusDot,styles[`dot${doc.status}`]]}/><Text style={styles.statusText}>{statusWords[doc.status]}</Text></View>
      <Text style={parts.bandMeta}>{[doc.issueDate?`Issued ${formatDay(doc.issueDate)}`:null,doc.dueDate?`Due ${formatDay(doc.dueDate)}`:null,doc.periodFrom||doc.periodTo?`Period ${formatDay(doc.periodFrom)} – ${formatDay(doc.periodTo)}`:null].filter(Boolean).join(' · ')||`Created ${formatRecordedAt(doc.createdAt)}`}</Text>
      {doc.payment?<Text style={parts.bandMeta}>Current payment status: {doc.payment.status}{doc.payment.owedCents!=null?` — ${formatCents(doc.payment.paidCents)} paid of ${formatCents(doc.payment.owedCents)}`:''}{doc.payment.overdue?' · Overdue':''}</Text>:null}
      {doc.payment?<Text style={styles.bandFine}>Read live from Payments & Balances; never printed on the issued document.</Text>:null}
      {doc.status==='Cancelled'?<Text style={parts.bandMeta}>Cancelled {doc.cancelledAt?formatRecordedAt(doc.cancelledAt):''}{doc.cancellationReason?` — ${doc.cancellationReason}`:''}</Text>:null}
    </View>

    {error?<Feedback kind="error">{error}</Feedback>:null}
    {message?<Feedback kind="success">{message}</Feedback>:null}
    {draft&&doc.problems.length?<View style={styles.problems}><Text style={styles.problemsTitle}>Fix before issuing</Text>{doc.problems.map(problem=><Text key={problem.key} style={styles.problem}>• {problem.message}</Text>)}</View>:null}

    {doc.groups.projects.map(project=><Ledger key={project.projectId??'none'} title={project.projectName}>
      {project.lines.map((line,index)=><View key={line.key} style={[styles.line,index>0&&parts.rowRule]} accessible accessibilityLabel={`${line.itemName}, ${formatTotalQuantity(line.quantity,line.unitSymbol)}, ${line.totalCents==null?'no price recorded':formatCents(line.totalCents)}`}>
        <View style={parts.flex}><Text style={styles.lineItem}>{line.itemName}</Text>
          <Text style={styles.lineMeta}>{line.recordCount} record{line.recordCount===1?'':'s'} · {line.unitPriceCents==null?'No price recorded':line.priceBasis==='whole'?`${formatCents(line.unitPriceCents)} for the whole delivery`:`${formatCents(line.unitPriceCents)} per ${line.unitSymbol}`}{line.vatRateBasisPoints?` · VAT ${line.vatRateBasisPoints/100}%`:''}</Text></View>
        <View style={styles.lineFigures}><Text style={styles.lineQty}>{formatTotalQuantity(line.quantity,line.unitSymbol)}</Text><Text style={[styles.lineMoney,line.totalCents==null&&parts.missing]}>{line.totalCents==null?'No price':formatCents(line.totalCents)}</Text></View>
      </View>)}
    </Ledger>)}

    <View style={styles.totals}>
      {doc.groups.quantityByUnit.map(unit=><View key={unit.unitKey} style={styles.totalLine}><Text style={styles.totalLabel}>Total in {unit.unitSymbol}</Text><Text style={styles.totalValue}>{formatTotalQuantity(unit.quantity,unit.unitSymbol)}</Text></View>)}
      {money.totalCents!=null?<>
        <View style={[styles.totalLine,styles.totalRule]}><Text style={styles.totalLabel}>Subtotal</Text><Text style={styles.totalValue}>{formatCents(money.subtotalCents)}</Text></View>
        {money.vatCents?<View style={styles.totalLine}><Text style={styles.totalLabel}>VAT, as recorded</Text><Text style={styles.totalValue}>{formatCents(money.vatCents)}</Text></View>:null}
        <View style={styles.totalLine}><Text style={[styles.totalLabel,styles.grand]}>Total (USD)</Text><Text style={[styles.totalValue,styles.grand]}>{formatCents(money.totalCents)}</Text></View>
      </>:null}
      {money.unpricedCount?<Text style={styles.missingMoney}>{money.pricedCount?`${money.unpricedCount} of ${doc.records.length} records have no recorded price and add nothing to the amounts.`:'No record has a recorded price; the document shows quantities only.'}</Text>:null}
    </View>

    <Ledger title="Records" note={draft?'Shown as they are now. Issuing freezes them.':'As frozen when issued. Later corrections to the records do not change this document.'}>
      {doc.records.map((record,index)=><View key={record.key}>
        <RecordRow record={{key:record.key,snapshot:record.snapshot,seriesId:null,status:'Active',cancellationReason:null,correctionCount:0,links:links[record.key]??[],inclusion:deriveInclusion(links[record.key]??[])}} first={index===0} onOpen={()=>onOpenRecord(record.snapshot)}/>
        {draft?<Pressable onPress={()=>remove(record.key,record.snapshot.loadNumber??record.snapshot.reference)} style={styles.removeTarget} accessibilityRole="button" accessibilityLabel="Remove this record from the draft"><Text style={styles.removeText}>Remove from draft</Text></Pressable>:null}
      </View>)}
    </Ledger>

    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Details</Text>
      {draft?<>
        <AppField label="Reference / PO number" value={details.reference} onChangeText={reference=>setDetails(current=>({...current,reference}))} maxLength={80}/>
        <DatePickerField label="Due date" value={details.dueDate} onChange={dueDate=>setDetails(current=>({...current,dueDate}))} allowClear placeholder="No due date"/>
        <AppField label="Notes" value={details.notes} onChangeText={notes=>setDetails(current=>({...current,notes}))} multiline maxLength={1000}/>
      </>:<>
        <Fact label="Reference / PO number" value={doc.reference}/><Fact label="Due date" value={doc.dueDate?formatDay(doc.dueDate):null}/><Fact label="Notes" value={doc.notes}/>
      </>}
    </View>

    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{doc.partyType==='customer'?'From and Bill to':'Supplier and Billed to'}</Text>
      {draft&&official?<Text style={styles.helper}>Filled from Business Document Settings and saved billing contacts. Empty fields are left off the PDF.</Text>:null}
      {draft&&editParties?<>
        <Text style={styles.subTitle}>{doc.partyType==='customer'?'From (your business)':'Supplier'}</Text>
        {partyFields.map(([key,label])=><AppField key={`i-${key}`} label={label} value={issuer[key]??''} onChangeText={value=>setIssuer(current=>({...current,[key]:value}))}/>)}
        <Text style={styles.subTitle}>{doc.partyType==='customer'?'Bill to':'Billed to (your business)'}</Text>
        {partyFields.map(([key,label])=><AppField key={`r-${key}`} label={label} value={recipient[key]??''} onChangeText={value=>setRecipient(current=>({...current,[key]:value}))}/>)}
        <Text style={styles.subTitle}>Terms</Text>
        <AppField label="Payment terms" value={terms.paymentTerms} onChangeText={paymentTerms=>setTerms(current=>({...current,paymentTerms}))}/>
        <AppField label="Payment instructions (bank details)" value={terms.bankDetails} onChangeText={bankDetails=>setTerms(current=>({...current,bankDetails}))} multiline/>
        <AppField label="Footer note" value={terms.footerNote} onChangeText={footerNote=>setTerms(current=>({...current,footerNote}))} multiline/>
      </>:<>
        <PartyFacts title={doc.partyType==='customer'?'From':'Supplier'} block={doc.issuer} official={official}/>
        <PartyFacts title={doc.partyType==='customer'?'Bill to':'Billed to'} block={doc.recipient} official={official}/>
        <Fact label="Payment terms" value={doc.terms?.paymentTerms??null} showMissing={official}/>
        {doc.partyType==='customer'?<Fact label="Payment instructions" value={doc.terms?.bankDetails??null} showMissing={official}/>:null}
        <Fact label="Currency" value="USD — DROMEX records every amount in US dollars"/>
      </>}
      {draft?<View style={styles.rowButtons}>
        <AppButton label={editParties?'Use saved details':'Edit for this document'} tone="secondary" onPress={()=>setEditParties(value=>!value)}/>
        <AppButton label="Save details" tone="navy" onPress={()=>void saveDetails()} busy={busy}/>
      </View>:null}
      {draft&&official&&(issuerMissing.length||recipientMissing.length)?<Text style={styles.notConfigured}>Not configured: {[...issuerMissing,...recipientMissing.map(field=>`${field} (recipient)`)].join(', ')}. You can still issue; these lines are left off. <Text style={styles.link} onPress={onOpenSettings}>Open Business Document Settings</Text></Text>:null}
    </View>

    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Authorized signer</Text>
      {draft?<SignerPicker signers={signerList} selection={doc.signerSelection} preview={doc.signer} onChoose={selection=>void chooseSigner(selection)} onManage={onOpenSigners} disabled={busy}/>
        :doc.signer?<SignerPreview signer={doc.signer}/>:<Text style={styles.helper}>No signer on this document.</Text>}
    </View>

    {draft?<View style={styles.panel}>
      <Text style={styles.panelTitle}>Issue</Text>
      <DatePickerField label="Issue date" value={issueDate} onChange={value=>setIssueDate(value||localToday())}/>
      {official?<AppField label="Document number (leave empty for the next number)" value={numberOverride} onChangeText={setNumberOverride} autoCapitalize="characters" maxLength={40} placeholder={nextNumber??''}/>:null}
      <Text style={styles.helper}>{official&&numberOverride.trim()?`Will be numbered ${numberOverride.trim()}.`:`Will be numbered ${nextNumber??'automatically'}.`} Only an issued document counts as including its records.</Text>
      <AppButton label="Issue document" onPress={issue} busy={busy} disabled={!!doc.problems.length||!doc.records.length}/>
      <AppButton label="Preview PDF" tone="secondary" onPress={()=>void exportPdf()} hint="Marked DRAFT — NOT ISSUED"/>
    </View>:<AppButton label="Export PDF" onPress={()=>void exportPdf()} busy={busy} hint={doc.status==='Cancelled'?'Marked CANCELLED':'Exactly as issued'}/>}

    {doc.history.length?<View style={styles.panel}>
      <Text style={styles.panelTitle}>History</Text>
      {doc.history.map((entry,index)=><Text key={`${entry.status}-${index}`} style={styles.history}>{formatRecordedAt(entry.at)} · {entry.status}{entry.documentNumber?` as ${entry.documentNumber}`:''}{entry.reason?` — ${entry.reason}`:''}</Text>)}
    </View>:null}

    {doc.status!=='Cancelled'?<View style={styles.danger}>
      <AppButton label={draft?'Discard draft':'Cancel document'} tone="danger" onPress={()=>{setReason('');setCancelOpen(true);}}
        hint={draft?'Its records become available again. Kept in history.':'Kept in history; its records can be included again.'}/>
    </View>:null}

    <FocusedSheet visible={cancelOpen} eyebrow={draft?'DISCARD DRAFT':'CANCEL DOCUMENT'} title={number} onClose={()=>setCancelOpen(false)}
      footer={<SheetActions primaryLabel={draft?'Discard draft':'Cancel document'} onPrimary={()=>{setCancelOpen(false);void run(()=>documents.cancelDocument(doc.id,reason),draft?'Draft discarded.':'Document cancelled. Its records are available again.');}} onCancel={()=>setCancelOpen(false)} disabled={!reason.trim()}/>}>
      <Text style={styles.helper}>{draft?'The draft stays in history as cancelled. No document number is used.':'The document stays in history and its PDF is marked CANCELLED. Its number is never reused.'}</Text>
      <AppField label="Reason *" value={reason} onChangeText={setReason} multiline maxLength={500}/>
    </FocusedSheet>
  </AppPage>;
}

function Fact({label,value,showMissing=false}:{label:string;value:string|null;showMissing?:boolean}){
  if(!value&&!showMissing)return null;
  return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={[styles.factValue,!value&&styles.factMissing]}>{value||'Not configured'}</Text></View>;
}
function PartyFacts({title,block,official}:{title:string;block:PartyBlock|null;official:boolean}){
  return <View style={styles.partyBox}>
    <Text style={styles.subTitle}>{title}</Text>
    {partyFields.map(([key,label])=><Fact key={key} label={label} value={block?.[key]??null} showMissing={official&&(key==='name'||key==='address'||key==='taxRegistrationNumber')}/>)}
  </View>;
}

export function SignerPreview({signer}:{signer:SignerSnapshot}){
  return <View style={styles.signerPreview} accessible accessibilityLabel={`${signer.display==='name_with_signature'?'Signature and name':'Name only'}: ${signer.name}${signer.jobTitle?`, ${signer.jobTitle}`:''}`}>
    {signer.display==='name_with_signature'&&signer.signature.length?<View style={styles.signatureBox}><Svg width="100%" height="100%" viewBox="0 0 320 140" preserveAspectRatio="xMidYMid meet">{signer.signature.map((path,index)=><Path key={index} d={path} fill="none" stroke="#17212B" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}</Svg></View>
      :<Text style={styles.byName}>Name only — no drawn signature</Text>}
    <Text style={styles.signerName}>{signer.name}</Text>
    {signer.jobTitle?<Text style={styles.helper}>{signer.jobTitle}</Text>:null}
    {signer.department?<Text style={styles.helper}>{signer.department}</Text>:null}
  </View>;
}

function SignerPicker({signers,selection,preview,onChoose,onManage,disabled}:{signers:DocumentSigner[];selection:SignerSelection|null;preview:SignerSnapshot|null;onChoose:(selection:SignerSelection|null)=>void;onManage:()=>void;disabled:boolean}){
  const chosen=signers.find(value=>value.id===selection?.signerId)??null;
  return <View style={styles.signerPicker}>
    {signers.length?<View style={styles.choices}>
      <Pressable onPress={()=>onChoose(null)} disabled={disabled} style={[styles.choice,!selection&&styles.choiceOn]} accessibilityRole="radio" accessibilityState={{checked:!selection}}><Text style={styles.choiceText}>No signer</Text></Pressable>
      {signers.map(signer=>{const on=selection?.signerId===signer.id;return <Pressable key={signer.id} disabled={disabled} onPress={()=>onChoose({signerId:signer.id,display:signer.signature.length?'name_with_signature':'name_only'})} style={[styles.choice,on&&styles.choiceOn]} accessibilityRole="radio" accessibilityState={{checked:on}}>
        <Text style={styles.choiceText}>{signer.name}</Text>{signer.jobTitle?<Text style={styles.choiceMeta}>{signer.jobTitle}</Text>:null}
      </Pressable>;})}
    </View>:<Text style={styles.helper}>No saved signers yet.</Text>}
    {chosen?<SegmentedChoice label="Show on the document" options={[{id:'name_with_signature',label:'Name and signature'},{id:'name_only',label:'Name only'}]} selectedId={selection!.display}
      onSelect={display=>{if(display==='name_with_signature'&&!chosen.signature.length)return;onChoose({signerId:chosen.id,display});}}/>:null}
    {chosen&&!chosen.signature.length?<Text style={styles.helper}>{chosen.name} has no saved signature, so only the name can be shown.</Text>:null}
    {preview?<SignerPreview signer={preview}/>:null}
    <AppButton label="Manage signers" tone="secondary" onPress={onManage}/>
  </View>;
}

const styles=StyleSheet.create({
  center:{alignItems:'center',paddingVertical:24},
  helper:{color:'#4F5B66',fontSize:13,lineHeight:19},
  status:{flexDirection:'row',alignItems:'center',gap:7,alignSelf:'flex-start',borderRadius:999,paddingHorizontal:11,paddingVertical:5,borderWidth:1},
  statusDraft:{backgroundColor:'rgba(255,255,255,0.1)',borderColor:'rgba(255,255,255,0.5)',borderStyle:'dashed'},
  statusIssued:{backgroundColor:'rgba(255,255,255,0.16)',borderColor:'rgba(255,255,255,0.5)'},
  statusCancelled:{backgroundColor:'rgba(255,255,255,0.08)',borderColor:'#F2A184'},
  statusDot:{width:7,height:7,borderRadius:4},
  dotDraft:{backgroundColor:'#F2D58F'},dotIssued:{backgroundColor:'#8FD6B4'},dotCancelled:{backgroundColor:'#F2A184'},
  statusText:{color:'#FFF8ED',fontSize:13,fontWeight:'700'},
  bandFine:{color:'#C9D7E6',fontSize:12,lineHeight:16},
  problems:{backgroundColor:'#FFF3D8',borderRadius:12,padding:12,gap:4},
  problemsTitle:{color:'#6E4B1F',fontSize:14,fontWeight:'800'},
  problem:{color:'#6E4B1F',fontSize:13,lineHeight:19},
  line:{flexDirection:'row',alignItems:'flex-start',gap:12,paddingHorizontal:16,paddingVertical:11},
  lineItem:{color:colors.ink,fontSize:15,fontWeight:'700'},
  lineMeta:{color:'#4F5B66',fontSize:12,lineHeight:17,marginTop:2},
  lineFigures:{alignItems:'flex-end',flexShrink:0,maxWidth:'45%'},
  lineQty:{color:colors.ink,fontSize:16,fontWeight:'800',fontVariant:['tabular-nums']},
  lineMoney:{color:colors.ink,fontSize:13,fontWeight:'600',fontVariant:['tabular-nums'],marginTop:2},
  totals:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:'#E3DBCD',padding:16,gap:8},
  totalLine:{flexDirection:'row',alignItems:'baseline',gap:10},
  totalRule:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,paddingTop:8,marginTop:2},
  totalLabel:{flex:1,minWidth:0,color:'#4F5B66',fontSize:14},
  totalValue:{color:colors.ink,fontSize:16,fontWeight:'700',fontVariant:['tabular-nums']},
  grand:{color:colors.ink,fontSize:18,fontWeight:'800'},
  missingMoney:{color:'#6E4B1F',backgroundColor:'#FFF3D8',borderRadius:10,padding:10,fontSize:13,lineHeight:19},
  removeTarget:{minHeight:44,justifyContent:'center',paddingHorizontal:16,paddingBottom:6,alignSelf:'flex-start'},
  removeText:{color:colors.danger,fontSize:13,fontWeight:'700'},
  panel:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:'#E3DBCD',padding:16,gap:12},
  panelTitle:{color:colors.ink,fontSize:17,fontWeight:'800'},
  subTitle:{color:colors.navy,fontSize:14,fontWeight:'700',marginTop:4},
  partyBox:{gap:6},
  fact:{gap:1},
  factLabel:{color:colors.muted,fontSize:12,fontWeight:'600'},
  factValue:{color:colors.ink,fontSize:14,lineHeight:20},
  factMissing:{color:'#5A6570',fontStyle:'italic'},
  rowButtons:{gap:8},
  notConfigured:{color:'#6E4B1F',backgroundColor:'#FFF3D8',borderRadius:10,padding:10,fontSize:13,lineHeight:19},
  link:{color:colors.navy,fontWeight:'700',textDecorationLine:'underline'},
  signerPicker:{gap:10},
  choices:{gap:8},
  choice:{minHeight:52,justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:12,paddingHorizontal:14,paddingVertical:8,backgroundColor:colors.surface},
  choiceOn:{borderColor:colors.navy,borderWidth:2,backgroundColor:'#F4F7FB'},
  choiceText:{color:colors.ink,fontSize:15,fontWeight:'700'},
  choiceMeta:{color:'#4F5B66',fontSize:12,marginTop:1},
  signerPreview:{alignItems:'center',gap:3,paddingVertical:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line},
  signatureBox:{width:240,height:105,maxWidth:'100%'},
  byName:{color:'#5A6570',fontStyle:'italic',fontSize:13,marginVertical:8},
  signerName:{color:colors.ink,fontSize:15,fontWeight:'700'},
  history:{color:'#4F5B66',fontSize:13,lineHeight:19},
  danger:{marginTop:18,paddingTop:16,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line},
});
