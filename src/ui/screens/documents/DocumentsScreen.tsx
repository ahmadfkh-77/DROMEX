import {useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,LayoutAnimation,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';

import type {BusinessDocumentRepository} from '../../../data/repositories/BusinessDocumentRepository';
import type {CompanyTotalsRepository} from '../../../data/repositories/CompanyTotalsRepository';
import {documentKindInfo,kindsForSide,type DocumentKind,type DocumentListFilter,type DocumentPaymentStatus,type DocumentSide,type DocumentStatus,type DocumentSummary} from '../../../domain/businessDocuments';
import {emptyCompanyTotalsFilters} from '../../../domain/companyTotals';
import {AppButton,AppPage,EmptyState,Feedback,PageHeader} from '../../components/AppPrimitives';
import {DatePickerField} from '../../components/DatePickerField';
import {useReducedMotion} from '../../components/ExpandableMenu';
import {SearchableSelect} from '../../components/SearchableSelect';
import {SegmentedChoice} from '../../components/SegmentedChoice';
import {styles as parts} from '../../components/totals/TotalsParts';
import type {DocumentStart} from '../../documentFlow';
import {reviewSplit} from '../../documentFlow';
import {colors} from '../../theme';
import {formatCents,formatDay} from '../../totalsPresentation';

export type DocumentParty={side:DocumentSide;partyId:string;partyName:string};
type KindTab='all'|DocumentKind;
type StatusTab='all'|DocumentStatus;
type PaymentTab='all'|DocumentPaymentStatus|'Overdue';
const tabLabel:Record<DocumentKind,string>={customer_invoice:'Invoices issued',customer_statement:'Customer statements',supplier_bill:'Bills received',supplier_statement:'Supplier statements'};
const paymentOptions:{id:PaymentTab;label:string}[]=[{id:'all',label:'Any'},{id:'Unpaid',label:'Unpaid'},{id:'Partially paid',label:'Partly paid'},{id:'Paid',label:'Paid'},{id:'Overdue',label:'Overdue'}];

/**
 * DEC-500 (2). Invoices & Bills: every statement, invoice and bill, or one customer's or supplier's,
 * searchable by status, dates, project, item, number and current payment status.
 */
export function DocumentsScreen({documents,totals,party,onBack,onOpenDocument,onCreate,onOpenSettings}:{
  documents:BusinessDocumentRepository;totals:CompanyTotalsRepository;party:DocumentParty|null;onBack:()=>void;onOpenDocument:(id:string)=>void;onCreate:(start:DocumentStart)=>void;onOpenSettings:()=>void;
}){
  const reducedMotion=useReducedMotion();
  const[kind,setKind]=useState<KindTab>('all');
  const[status,setStatus]=useState<StatusTab>('all');
  const[payment,setPayment]=useState<PaymentTab>('all');
  const[fromDate,setFromDate]=useState('');const[toDate,setToDate]=useState('');
  const[projectId,setProjectId]=useState('');const[itemKey,setItemKey]=useState('');
  const[search,setSearch]=useState('');
  const[filtersOpen,setFiltersOpen]=useState(false);
  const[rows,setRows]=useState<DocumentSummary[]|null>(null);
  const[error,setError]=useState<string|null>(null);
  const[choices,setChoices]=useState<{projects:{id:string;label:string}[];items:{id:string;label:string}[]}>({projects:[],items:[]});
  const[creating,setCreating]=useState(false);

  const filter:DocumentListFilter=useMemo(()=>({partyType:party?.side,partyId:party?.partyId,kind:kind==='all'?undefined:kind,status:status==='all'?undefined:status,paymentStatus:payment==='all'?undefined:payment,
    fromDate:fromDate||undefined,toDate:toDate||undefined,projectId:projectId||undefined,itemKey:itemKey||undefined,search:search.trim()||undefined}),[party,kind,status,payment,fromDate,toDate,projectId,itemKey,search]);
  useEffect(()=>{
    let active=true;setRows(null);setError(null);
    documents.listDocuments(filter).then(found=>{if(active)setRows(found);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Documents could not be loaded.');});
    return()=>{active=false;};
  },[documents,filter]);
  useEffect(()=>{
    totals.getCompanyTotals(emptyCompanyTotalsFilters()).then(data=>{
      const unique=(values:{id:string;label:string}[])=>[...new Map(values.map(value=>[value.id,value])).values()].sort((a,b)=>a.label.localeCompare(b.label));
      setChoices({projects:unique(data.deliveries.filter(row=>row.projectKey!=='__none__').map(row=>({id:row.projectKey,label:row.projectName}))),items:unique(data.deliveries.map(row=>({id:row.itemKey,label:row.itemName})))});
    }).catch(()=>{});
  },[totals]);

  const kindOptions=[{id:'all' as KindTab,label:'All'},...(party?kindsForSide(party.side):(['customer_invoice','customer_statement','supplier_bill','supplier_statement'] as DocumentKind[])).map(value=>({id:value as KindTab,label:tabLabel[value]}))];
  const active=[fromDate||toDate,projectId,itemKey,status!=='all',payment!=='all'].filter(Boolean).length;
  const toggle=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.create(180,'easeInEaseOut','opacity'));setFiltersOpen(value=>!value);};

  return <AppPage keyboard>
    <PageHeader eyebrow="INVOICES & BILLS" title={party?party.partyName:'Invoices & Bills'} onBack={onBack}/>
    <Text style={styles.lead}>{party?party.side==='customer'?'Invoices you issued to this customer, and internal customer statements.':'Bills received from this supplier, and internal supplier statements.'
      :'Every statement, invoice and bill. Only an issued document counts as including its records; drafts never do.'}</Text>

    {party?<NewDocumentPanel open={creating} onToggle={()=>setCreating(value=>!value)} documents={documents} party={party} onCreate={onCreate} onOpenSettings={onOpenSettings}/>
      :<Text style={styles.hint}>To start a document, open a customer or a supplier, or use Totals to choose records.</Text>}

    <View style={styles.searchBar}><Text style={styles.searchGlyph} importantForAccessibility="no">⌕</Text>
      <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search number, reference or name" placeholderTextColor="#6B7681" accessibilityLabel="Search documents" autoCapitalize="characters"/></View>
    <SegmentedChoice mode="tabs" options={kindOptions} selectedId={kind} onSelect={setKind}/>

    <View style={styles.filterBlock}>
      <Pressable onPress={toggle} style={({pressed})=>[styles.filterBar,pressed&&parts.pressed]} accessibilityRole="button" accessibilityState={{expanded:filtersOpen}} accessibilityLabel={`Filters, ${active?`${active} active`:'none active'}`}>
        <Text style={styles.filterTitle}>Filters</Text><Text style={styles.filterCount}>{active?`${active} on`:'None'}</Text><Text style={styles.toggleGlyph}>{filtersOpen?'×':'+'}</Text>
      </Pressable>
      {filtersOpen?<View style={styles.filterPanel}>
        <SegmentedChoice mode="tabs" label="Status" options={[{id:'all',label:'All'},{id:'Draft',label:'Draft'},{id:'Issued',label:'Issued'},{id:'Cancelled',label:'Cancelled'}]} selectedId={status} onSelect={value=>setStatus(value as StatusTab)}/>
        <SegmentedChoice mode="tabs" label="Current payment" options={paymentOptions} selectedId={payment} onSelect={setPayment}/>
        <View style={styles.dates}>
          <View style={styles.dateField}><DatePickerField label="From" value={fromDate} onChange={setFromDate} allowClear placeholder="Any date"/></View>
          <View style={styles.dateField}><DatePickerField label="To" value={toDate} onChange={setToDate} allowClear placeholder="Any date"/></View>
        </View>
        <SearchableSelect label="Project" options={choices.projects} selectedId={projectId} onSelect={setProjectId} placeholder="Any project" allowClear/>
        <SearchableSelect label="Item" options={choices.items} selectedId={itemKey} onSelect={setItemKey} placeholder="Any item" allowClear/>
        {active?<AppButton label="Clear filters" tone="secondary" onPress={()=>{setStatus('all');setPayment('all');setFromDate('');setToDate('');setProjectId('');setItemKey('');}}/>:null}
      </View>:null}
    </View>

    {error?<Feedback kind="error">{error}</Feedback>:!rows?<View style={styles.center}><ActivityIndicator color={colors.brand}/></View>
      :rows.length?<View style={parts.ledger}>{rows.map((row,index)=><DocumentRow key={row.id} row={row} showParty={!party} first={index===0} onPress={()=>onOpenDocument(row.id)}/>)}</View>
      :<EmptyState title="No documents match" body={party?'Use New document above to create a draft from this party’s records.':'Clear a filter, or create a document from Totals.'}/>}
  </AppPage>;
}

function DocumentRow({row,showParty,first,onPress}:{row:DocumentSummary;showParty:boolean;first:boolean;onPress:()=>void}){
  const info=documentKindInfo[row.kind];
  const number=row.documentNumber??row.draftNumber;
  return <Pressable onPress={onPress} style={({pressed})=>[styles.row,!first&&parts.rowRule,pressed&&parts.pressed]} accessibilityRole="button"
    accessibilityLabel={`${number}, ${info.label}, ${row.status}${showParty?`, ${row.partyName}`:''}, ${row.recordCount} records${row.payment?`, ${row.payment.status}${row.payment.overdue?', overdue':''}`:''}`}>
    <View style={styles.rowTop}><Text style={styles.number}>{number}</Text><StatusPill status={row.status}/></View>
    <Text style={styles.rowMeta}>{info.mode==='internal'?`Internal ${info.label.toLocaleLowerCase('en-US')}`:info.label}{showParty?` · ${row.partyName}`:''} · {row.recordCount} record{row.recordCount===1?'':'s'}</Text>
    <Text style={styles.rowMeta}>{row.issueDate?`Issued ${formatDay(row.issueDate)}`:`Draft started ${formatDay(row.createdAt.slice(0,10))}`}{row.dueDate?` · Due ${formatDay(row.dueDate)}`:''}{row.reference?` · ${row.reference}`:''}</Text>
    {row.payment?<Text style={[styles.payment,row.payment.overdue&&styles.overdue]}>{row.payment.status}{row.payment.owedCents!=null?` · ${formatCents(row.payment.paidCents)} of ${formatCents(row.payment.owedCents)}`:''}{row.payment.overdue?' · Overdue':''}</Text>:null}
  </Pressable>;
}

function StatusPill({status}:{status:DocumentStatus}){
  return <View style={[styles.pill,status==='Issued'?styles.pillIssued:status==='Draft'?styles.pillDraft:styles.pillCancelled]}>
    <View style={[styles.pillDot,{backgroundColor:status==='Issued'?colors.success:status==='Draft'?colors.navy:colors.danger}]}/>
    <Text style={[styles.pillText,{color:status==='Issued'?'#1F6145':status==='Draft'?colors.navy:colors.danger}]}>{status}</Text>
  </View>;
}

/** Starts a document for this one party: kind, then a date range or records chosen one by one. */
function NewDocumentPanel({open,onToggle,documents,party,onCreate,onOpenSettings}:{open:boolean;onToggle:()=>void;documents:BusinessDocumentRepository;party:DocumentParty;onCreate:(start:DocumentStart)=>void;onOpenSettings:()=>void}){
  const kinds=kindsForSide(party.side);
  const[kind,setKind]=useState<DocumentKind>(kinds[0]!);
  const[method,setMethod]=useState<'date_range'|'manual'>('date_range');
  const[fromDate,setFromDate]=useState('');const[toDate,setToDate]=useState('');
  const[busy,setBusy]=useState(false);const[error,setError]=useState<string|null>(null);
  const go=async()=>{
    setBusy(true);setError(null);
    try{
      const found=await documents.listEligibleRecords({side:party.side,partyId:party.partyId,fromDate:method==='date_range'?fromDate:undefined,toDate:method==='date_range'?toDate:undefined});
      const available=reviewSplit(found,kind).available;
      if(!found.length){setError(method==='date_range'?'No Active records for this party in those dates.':'This party has no Active records yet.');return;}
      onCreate({side:party.side,partyId:party.partyId,partyName:party.partyName,kind,recordKeys:found.map(record=>record.key),preselect:method==='manual'?'none':'all',selectionMethod:method,
        periodFrom:method==='date_range'?fromDate:null,periodTo:method==='date_range'?toDate:null,context:`${available.length} of ${found.length} records available`});
    }catch(cause){setError(cause instanceof Error?cause.message:'Records could not be loaded.');}finally{setBusy(false);}
  };
  if(!open)return <AppButton label="New document" onPress={onToggle} hint={party.side==='customer'?'Customer statement or Invoice':'Supplier statement or Bill'}/>;
  return <View style={styles.newPanel}>
    <Text style={styles.newTitle}>New document for {party.partyName}</Text>
    <SegmentedChoice label="Type" options={kinds.map(value=>({id:value,label:documentKindInfo[value].mode==='internal'?`Internal ${documentKindInfo[value].label.toLocaleLowerCase('en-US')}`:`Official ${documentKindInfo[value].label}`}))} selectedId={kind} onSelect={setKind}/>
    {documentKindInfo[kind].mode==='official'?<Text style={styles.helper}>Uses Business Document Settings; empty fields read Not configured and are left off. <Text style={styles.link} onPress={onOpenSettings}>Open settings</Text></Text>:null}
    <SegmentedChoice label="Records" options={[{id:'date_range',label:'A date range'},{id:'manual',label:'Choose one by one'}]} selectedId={method} onSelect={setMethod}/>
    {method==='date_range'?<View style={styles.dates}>
      <View style={styles.dateField}><DatePickerField label="From *" value={fromDate} onChange={setFromDate}/></View>
      <View style={styles.dateField}><DatePickerField label="To *" value={toDate} onChange={setToDate} minDate={fromDate||undefined}/></View>
    </View>:null}
    {error?<Feedback kind="warning">{error}</Feedback>:null}
    <AppButton label="Review records" onPress={()=>void go()} busy={busy} disabled={method==='date_range'&&(!fromDate||!toDate||fromDate>toDate)}/>
    <AppButton label="Close" tone="secondary" onPress={onToggle}/>
  </View>;
}

const styles=StyleSheet.create({
  center:{alignItems:'center',paddingVertical:24},
  lead:{color:'#4F5B66',fontSize:14,lineHeight:20},
  hint:{color:'#4F5B66',fontSize:13,lineHeight:19,backgroundColor:colors.surface,borderRadius:12,padding:12},
  helper:{color:'#4F5B66',fontSize:13,lineHeight:19},
  link:{color:colors.navy,fontWeight:'700',textDecorationLine:'underline'},
  searchBar:{minHeight:52,flexDirection:'row',alignItems:'center',gap:8,backgroundColor:colors.surface,borderRadius:14,paddingHorizontal:14,borderWidth:1,borderColor:'#E3DBCD'},
  searchGlyph:{color:colors.brand,fontSize:18,fontWeight:'900'},
  searchInput:{flex:1,minHeight:48,color:colors.ink,fontSize:15},
  filterBlock:{backgroundColor:colors.surface,borderRadius:16,overflow:'hidden',borderWidth:1,borderColor:'#E3DBCD'},
  filterBar:{minHeight:52,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:16},
  filterTitle:{flex:1,color:colors.navy,fontSize:15,fontWeight:'700'},
  filterCount:{color:colors.brandDark,fontSize:13,fontWeight:'700'},
  toggleGlyph:{color:colors.navy,fontSize:22,fontWeight:'500'},
  filterPanel:{gap:12,padding:16,borderTopWidth:3,borderTopColor:colors.navy,backgroundColor:'#FCFBF8'},
  dates:{flexDirection:'row',flexWrap:'wrap',gap:10},dateField:{flexGrow:1,flexBasis:140,minWidth:0},
  row:{paddingHorizontal:16,paddingVertical:12,gap:3},
  rowTop:{flexDirection:'row',alignItems:'center',gap:10},
  number:{flex:1,minWidth:0,color:colors.ink,fontSize:16,fontWeight:'800',fontVariant:['tabular-nums']},
  rowMeta:{color:'#4F5B66',fontSize:13,lineHeight:18},
  payment:{color:colors.ink,fontSize:13,fontWeight:'600',marginTop:2},
  overdue:{color:colors.warning},
  pill:{flexDirection:'row',alignItems:'center',gap:6,borderRadius:999,paddingHorizontal:10,paddingVertical:4,borderWidth:1},
  pillIssued:{backgroundColor:'#E5F3EC',borderColor:'#B9DCCA'},pillDraft:{backgroundColor:'#EEF3F8',borderColor:'#C9D7E6',borderStyle:'dashed'},pillCancelled:{backgroundColor:colors.surface,borderColor:'#E9B8B3'},
  pillDot:{width:6,height:6,borderRadius:3},
  pillText:{fontSize:12,fontWeight:'700'},
  newPanel:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:'#D9CFBE',padding:16,gap:12},
  newTitle:{color:colors.ink,fontSize:17,fontWeight:'800'},
});
