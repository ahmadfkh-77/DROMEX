import {useCallback,useEffect,useMemo,useState} from 'react';
import {ActivityIndicator,Alert,LayoutAnimation,Pressable,ScrollView,StyleSheet,Text,TextInput,TouchableOpacity,View} from 'react-native';

import type {FinancialRepository} from '../../data/repositories/FinancialRepository';
import {
  accountActivity,accountList,accountTotals,applicationModeLabels,oldestFirst,summarizeAccount,
  type AccountLedger,type AccountPayment,type AccountRow,type AccountSummary,type CancelledOpeningBalance,
} from '../../domain/accountPayments';
import {emptyOpeningBalanceDraft,type FinancialOverview,type FinancialPartyType,type FinancialTarget,type OpeningBalanceDraft} from '../../domain/financials';
import {AppButton} from '../components/AppPrimitives';
import {DatePickerField,displayDate,todayIso} from '../components/DatePickerField';
import {useReducedMotion} from '../components/ExpandableMenu';
import {SearchableSelect} from '../components/SearchableSelect';
import {SegmentedChoice} from '../components/SegmentedChoice';
import {colors} from '../theme';
import {AddPaymentScreen} from './finance/AddPaymentScreen';
import {ApplyUnallocatedScreen} from './finance/ApplyUnallocatedScreen';
import {FinanceRecordScreen} from './finance/FinanceRecordScreen';
import {BODY_TEXT,CARD_BORDER,Field,FinanceHeader,MoneyBox,Notice,PaymentCard,RecordLine,Section,StatusBadge,financeStyles,targetTypeLabel} from './finance/financeParts';
import {formatMoney} from './projectFinancialReviewPresentation';

type Party={type:FinancialPartyType;id:string};
type Route={name:'list'}|{name:'account';party:Party}|{name:'pay';party:Party;recordKey?:string;full?:boolean}|{name:'record';party:Party;recordKey:string}|{name:'apply';party:Party;paymentId:string};
type Ledger=FinancialOverview&AccountLedger;
type Show='all'|'customer'|'supplier';
const PAGE=40;
const recordKey=(target:FinancialTarget)=>`${target.type}|${target.id}`;
/** Records that still owe money, oldest first: the order payments are applied in. */
const oldestOpen=(targets:FinancialTarget[])=>oldestFirst(targets.filter(target=>target.remainingUsd>0));

/**
 * Reports and Finance -> Payments & Balances, as an account statement (DEC-482 / DEC-483):
 * accounts list -> one account's statement -> Add Payment, or one record. Every figure comes from
 * domain/accountPayments.ts; this screen arranges and labels them and adds nothing up itself.
 */
export function FinancialsScreen({repository,onBack,customerId,initialFromDate='',initialToDate=''}:{repository:FinancialRepository;onBack:()=>void;customerId?:string;initialFromDate?:string;initialToDate?:string}){
  const entry:Route=customerId?{name:'account',party:{type:'customer',id:customerId}}:{name:'list'};
  const[route,setRoute]=useState<Route>(entry);
  const[ledger,setLedger]=useState<Ledger|null>(null);
  const[status,setStatus]=useState<'loading'|'error'|'ready'>('loading');
  const[loadError,setLoadError]=useState<string|null>(null);
  const[message,setMessage]=useState<string|null>(null);
  const[reload,setReload]=useState(0);
  const refresh=useCallback(async()=>{const next=await repository.getOverview();setLedger(next);},[repository]);
  useEffect(()=>{let active=true;setStatus('loading');setLoadError(null);refresh().then(()=>{if(active)setStatus('ready');}).catch(cause=>{if(active){setLoadError(cause instanceof Error?cause.message:null);setStatus('error');}});return()=>{active=false;};},[refresh,reload]);
  const go=(next:Route)=>{setMessage(null);setRoute(next);};
  const done=async(next:Route,text:string)=>{await refresh();setRoute(next);setMessage(text);};

  if(status==='error')return <View style={styles.state}><Text style={styles.stateTitle}>Payments could not be loaded</Text><Text style={styles.stateBody}>{loadError??'The records on this device could not be read.'} Nothing was changed.</Text><View style={styles.stateActions}><AppButton label="Try again" onPress={()=>setReload(value=>value+1)}/><AppButton label="Back" tone="secondary" onPress={onBack}/></View></View>;
  if(status==='loading'||!ledger)return <View style={styles.state}><ActivityIndicator size="large" color={colors.brand}/><Text style={styles.stateBody}>Loading payments and balances…</Text></View>;

  const account=(party:Party)=>{
    const mine=<T extends {partyType:FinancialPartyType;partyId:string}>(value:T)=>value.partyType===party.type&&value.partyId===party.id;
    const targets=ledger.targets.filter(mine),payments=ledger.accountPayments.filter(mine),cancelled=ledger.cancelledOpenings.filter(mine);
    const name=ledger.parties.find(value=>value.type===party.type&&value.id===party.id)?.name??(party.type==='customer'?'Customer':'Supplier');
    return {party,name,targets,payments,cancelled,summary:summarizeAccount(targets,payments,cancelled)};
  };
  const leaveAccount=()=>customerId?onBack():go({name:'list'});

  if(route.name==='pay'){
    const current=account(route.party);
    const record=route.recordKey?current.targets.find(target=>recordKey(target)===route.recordKey):undefined;
    const back:Route=record?{name:'record',party:route.party,recordKey:route.recordKey!}:{name:'account',party:route.party};
    return <AddPaymentScreen repository={repository} partyType={route.party.type} partyId={route.party.id} name={current.name} open={oldestOpen(current.targets)} summary={current.summary} record={record} full={route.full}
      onCancel={()=>go(back)} onSaved={text=>void done(back,text)}/>;
  }
  const detail=(party:Party)=><AccountDetail repository={repository} data={account(party)} message={message} onBack={leaveAccount} onPay={()=>go({name:'pay',party})}
    onApply={payment=>go({name:'apply',party,paymentId:payment.id})} onRecord={value=>go({name:'record',party,recordKey:recordKey(value)})} onChanged={text=>void done({name:'account',party},text)}/>;
  if(route.name==='apply'){
    const current=account(route.party);
    const payment=current.payments.find(value=>value.id===route.paymentId);
    if(!payment)return detail(route.party);
    return <ApplyUnallocatedScreen repository={repository} payment={payment} open={oldestOpen(current.targets)} onCancel={()=>go({name:'account',party:route.party})} onApplied={text=>void done({name:'account',party:route.party},text)}/>;
  }
  if(route.name==='record'){
    const current=account(route.party);
    const target=current.targets.find(value=>recordKey(value)===route.recordKey);
    if(!target)return detail(route.party);
    return <FinanceRecordScreen repository={repository} target={target} accountPayments={current.payments} onBack={()=>go({name:'account',party:route.party})}
      onPay={full=>go({name:'pay',party:route.party,recordKey:route.recordKey,full})} onChanged={text=>void done({name:'account',party:route.party},text)}/>;
  }
  if(route.name==='account')return detail(route.party);
  return <AccountList repository={repository} ledger={ledger} message={message} scope={{fromDate:initialFromDate,toDate:initialToDate}} onBack={onBack}
    onOpen={row=>go({name:'account',party:{type:row.partyType,id:row.partyId}})} onChanged={text=>void done({name:'list'},text)}/>;
}

function AccountList({repository,ledger,message,scope,onBack,onOpen,onChanged}:{repository:FinancialRepository;ledger:Ledger;message:string|null;scope:{fromDate:string;toDate:string};onBack:()=>void;onOpen:(row:AccountRow)=>void;onChanged:(text:string)=>void}){
  const reducedMotion=useReducedMotion();
  const[search,setSearch]=useState('');
  const[show,setShow]=useState<Show>('all');
  const[owingOnly,setOwingOnly]=useState(false);
  const[limit,setLimit]=useState(PAGE);
  const[openingOpen,setOpeningOpen]=useState(false);
  const rows=useMemo(()=>accountList(ledger,ledger.accountPayments,ledger.cancelledOpenings),[ledger]);
  const totals=useMemo(()=>accountTotals(rows),[rows]);
  const query=search.trim().toLocaleLowerCase();
  const visible=rows.filter(row=>(show==='all'||row.partyType===show)&&(!owingOnly||row.summary.balanceUsd>0)&&(!query||row.name.toLocaleLowerCase().includes(query)));
  const toggleOpening=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.create(200,'easeInEaseOut','opacity'));setOpeningOpen(value=>!value);};
  return <ScrollView contentContainerStyle={financeStyles.content} keyboardShouldPersistTaps="handled">
    <FinanceHeader eyebrow="REPORTS AND FINANCE" title="Payments & Balances" onBack={onBack}/>
    {message?<Notice kind="success">{message}</Notice>:null}
    {scope.fromDate||scope.toDate?<Notice kind="info">{`Opened from the dashboard for ${scope.fromDate?displayDate(scope.fromDate):'the start'} to ${scope.toDate?displayDate(scope.toDate):'today'}. Balances here are current and cover all dates.`}</Notice>:null}
    <View style={financeStyles.wrapRow}>
      <MoneyBox role="balance" label="Customers owe you" value={totals.receivableUsd} note={`${totals.customerAccounts} customer account${totals.customerAccounts===1?'':'s'}`}/>
      <MoneyBox role="billed" label="You owe suppliers" value={totals.payableUsd} note={`${totals.supplierAccounts} supplier account${totals.supplierAccounts===1?'':'s'}`}/>
    </View>
    {totals.customerCreditUsd>0||totals.supplierCreditUsd>0?<Text style={financeStyles.meta}>{[totals.customerCreditUsd>0?`Customers have ${formatMoney(totals.customerCreditUsd)} in credit`:null,totals.supplierCreditUsd>0?`you have ${formatMoney(totals.supplierCreditUsd)} in credit with suppliers`:null].filter(Boolean).join('; ')}. Credit is never subtracted from the other side.</Text>:null}

    <View style={styles.searchBar}>
      <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search customers and suppliers" placeholderTextColor="#6B7681" accessibilityLabel="Search accounts"/>
      {search?<TouchableOpacity style={styles.clear} onPress={()=>setSearch('')} accessibilityRole="button" accessibilityLabel="Clear search"><Text style={styles.clearText}>×</Text></TouchableOpacity>:null}
    </View>
    <SegmentedChoice mode="tabs" label="Show" options={[{id:'all' as Show,label:'All'},{id:'customer' as Show,label:'Customers'},{id:'supplier' as Show,label:'Suppliers'}]} selectedId={show} onSelect={setShow}/>
    <TouchableOpacity style={[styles.filterChip,owingOnly&&styles.filterChipOn]} onPress={()=>setOwingOnly(value=>!value)} accessibilityRole="checkbox" accessibilityState={{checked:owingOnly}} accessibilityLabel="Only accounts with a balance owed">
      <Text style={[styles.filterChipText,owingOnly&&styles.filterChipTextOn]}>{owingOnly?'✓ ':''}Only accounts with a balance owed</Text>
    </TouchableOpacity>

    <View style={styles.listHead}><Text style={styles.listTitle}>Accounts</Text><Text style={financeStyles.meta}>{visible.length} of {rows.length}</Text></View>
    {visible.length?<View style={styles.stack}>{visible.slice(0,limit).map(row=><AccountRowCard key={`${row.partyType}|${row.partyId}`} row={row} onPress={()=>onOpen(row)}/>)}</View>
      :<Text style={financeStyles.empty}>{rows.length?'No account matches this search or filter.':'No customer or supplier has a priced record, payment or Open Balance yet. Accounts appear here once one exists.'}</Text>}
    {visible.length>limit?<AppButton label={`Show ${Math.min(PAGE,visible.length-limit)} more accounts`} tone="secondary" onPress={()=>setLimit(value=>value+PAGE)}/>:null}

    <Section title="Add Open Balance" summary="Carry forward an old paper-book balance for a customer or supplier" open={openingOpen} onToggle={toggleOpening}>
      <OpeningBalanceForm repository={repository} parties={ledger.parties} onSaved={text=>{setOpeningOpen(false);onChanged(text);}}/>
    </Section>
  </ScrollView>;
}

/** One account in the list: its balance, what was paid, and how many records are still open. */
function AccountRowCard({row,onPress}:{row:AccountRow;onPress:()=>void}){
  const {summary}=row;
  const state=summary.balanceUsd>0?'Owes':summary.creditUsd>0?'In credit':'Settled';
  const figure=summary.balanceUsd>0?summary.balanceUsd:summary.creditUsd;
  return <Pressable onPress={onPress} style={({pressed})=>[styles.accountCard,pressed&&styles.pressed]} android_ripple={{color:'#EFE9DF'}} accessibilityRole="button"
    accessibilityLabel={`${row.name}, ${row.partyType}. ${state}${state==='Settled'?'':` ${formatMoney(figure)}`}. Paid ${formatMoney(summary.paidUsd)}. ${summary.openRecordCount} open record${summary.openRecordCount===1?'':'s'}.`} accessibilityHint="Opens the account statement">
    <View style={styles.accountTop}>
      <View style={financeStyles.flex}>
        <Text style={styles.accountName} numberOfLines={2}>{row.name}</Text>
        <Text style={financeStyles.meta}>{row.partyType==='customer'?'Customer':'Supplier'}</Text>
      </View>
      <View style={styles.accountRight}>
        <Text style={financeStyles.meta}>{state}</Text>
        <Text style={[styles.accountBalance,summary.balanceUsd<=0&&styles.accountSettled]}>{state==='Settled'?formatMoney(0):formatMoney(figure)}</Text>
      </View>
    </View>
    <View style={styles.accountBottom}>
      <Text style={financeStyles.meta}>Paid <Text style={styles.strong}>{formatMoney(summary.paidUsd)}</Text></Text>
      <Text style={financeStyles.meta}><Text style={styles.strong}>{summary.openRecordCount}</Text> open record{summary.openRecordCount===1?'':'s'}</Text>
      {summary.cancelledCount?<Text style={financeStyles.meta}>{summary.cancelledCount} cancelled</Text>:null}
    </View>
  </Pressable>;
}

type AccountData={party:Party;name:string;targets:FinancialTarget[];payments:AccountPayment[];cancelled:CancelledOpeningBalance[];summary:AccountSummary};

/** One account's statement: balance, the single Add Payment action, then its records and history. */
function AccountDetail({repository,data,message,onBack,onPay,onApply,onRecord,onChanged}:{repository:FinancialRepository;data:AccountData;message:string|null;onBack:()=>void;onPay:()=>void;onApply:(payment:AccountPayment)=>void;onRecord:(target:FinancialTarget)=>void;onChanged:(text:string)=>void}){
  const reducedMotion=useReducedMotion();
  const[open,setOpen]=useState<Set<string>>(()=>new Set(['open']));
  const[activityLimit,setActivityLimit]=useState(PAGE);
  const[cancelling,setCancelling]=useState<string|null>(null);
  const[reason,setReason]=useState('');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const toggle=(key:string)=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.create(200,'easeInEaseOut','opacity'));setOpen(current=>{const next=new Set(current);if(next.has(key))next.delete(key);else next.add(key);return next;});};
  const {summary}=data;
  const openRecords=oldestOpen(data.targets);
  const settled=data.targets.filter(target=>target.remainingUsd<=0);
  const recordPayments=data.targets.flatMap(target=>target.payments.filter(payment=>!payment.accountPaymentId).map(payment=>({target,payment})));
  const activity=useMemo(()=>accountActivity(data.targets,data.payments,data.cancelled),[data]);
  const state=summary.balanceUsd>0?'Balance owed':summary.creditUsd>0?'In credit':'Settled';

  function cancelPayment(payment:AccountPayment){
    if(!reason.trim()){setError('Enter the reason for cancelling this payment first.');return;}
    Alert.alert(`Cancel the ${formatMoney(payment.amountUsd)} payment?`,'The payment and every amount it applied are cancelled together. They stay visible in history and no longer count.',[
      {text:'Keep payment',style:'cancel'},
      {text:'Cancel payment',style:'destructive',onPress:()=>void (async()=>{setBusy(true);setError(null);try{await repository.cancelAccountPayment(payment.id,reason);setReason('');setCancelling(null);onChanged('Payment cancelled. It remains in history.');}catch(cause){setError(cause instanceof Error?cause.message:'The payment could not be cancelled.');}finally{setBusy(false);}})()},
    ]);
  }

  return <ScrollView contentContainerStyle={financeStyles.content} keyboardShouldPersistTaps="handled">
    <FinanceHeader eyebrow={data.party.type==='customer'?'CUSTOMER ACCOUNT':'SUPPLIER ACCOUNT'} title={data.name} onBack={onBack}/>
    {message?<Notice kind="success">{message}</Notice>:null}
    {error?<Notice kind="error">{error}</Notice>:null}

    <View style={styles.balanceCard} accessible accessibilityRole="summary" accessibilityLabel={`${state} ${formatMoney(summary.balanceUsd>0?summary.balanceUsd:summary.creditUsd)}. Billed ${formatMoney(summary.billedUsd)}. Paid ${formatMoney(summary.paidUsd)}. Unallocated ${formatMoney(summary.unallocatedUsd)}. ${summary.openRecordCount} open records.`}>
      <Text style={styles.balanceLabel}>{state}</Text>
      <Text style={[styles.balanceValue,summary.balanceUsd<=0&&styles.accountSettled]}>{formatMoney(summary.balanceUsd>0?summary.balanceUsd:summary.creditUsd)}</Text>
      <Text style={financeStyles.meta}>{summary.openRecordCount} open record{summary.openRecordCount===1?'':'s'} · {formatMoney(summary.outstandingRecordsUsd)} still owed on records</Text>
      <View style={financeStyles.wrapRow}>
        <MoneyBox role="billed" label="Billed" value={summary.billedUsd}/>
        <MoneyBox role="paid" label="Paid" value={summary.paidUsd}/>
        <MoneyBox role="unallocated" label="Unallocated" value={summary.unallocatedUsd} note="paid, not on any record"/>
      </View>
    </View>
    <AppButton label="Add Payment" hint="Record one payment and choose how it is applied" onPress={onPay}/>

    <Section title="Open records" summary={openRecords.length?`${openRecords.length} unpaid or partly paid, oldest first`:'Nothing is owed on any record'} open={open.has('open')} onToggle={()=>toggle('open')}>
      {openRecords.length?openRecords.map(target=><RecordLine key={recordKey(target)} target={target} onPress={()=>onRecord(target)}/>):<Text style={financeStyles.empty}>No open records on this account.</Text>}
    </Section>

    <Section title="Payment history" summary={`${data.payments.length+recordPayments.length} payment${data.payments.length+recordPayments.length===1?'':'s'}`} open={open.has('payments')} onToggle={()=>toggle('payments')}>
      {data.payments.map(payment=><PaymentCard key={payment.id} payment={payment}>
        {payment.status==='Active'&&payment.unallocatedUsd>0&&cancelling!==payment.id?<AppButton label="Apply unallocated payment" tone="navy" hint={`Put ${formatMoney(payment.unallocatedUsd)} onto records without re-entering the payment`} onPress={()=>onApply(payment)}/>:null}
        {payment.status==='Active'?(cancelling===payment.id?<View style={styles.cancelBox}>
          <Field label="Reason for cancelling this payment *" value={reason} onChangeText={setReason} multiline/>
          <View style={financeStyles.row}>
            <View style={financeStyles.flex}><AppButton label="Keep" tone="secondary" onPress={()=>{setCancelling(null);setReason('');}}/></View>
            <View style={financeStyles.flex}><AppButton label="Cancel payment" tone="danger" busy={busy} onPress={()=>cancelPayment(payment)}/></View>
          </View>
        </View>:<TouchableOpacity style={styles.link} onPress={()=>{setCancelling(payment.id);setReason('');setError(null);}} accessibilityRole="button" accessibilityLabel={`Cancel the ${formatMoney(payment.amountUsd)} payment`}><Text style={styles.linkText}>Cancel this payment</Text></TouchableOpacity>):null}
      </PaymentCard>)}
      {recordPayments.map(({target,payment})=><Pressable key={payment.id} onPress={()=>onRecord(target)} style={({pressed})=>[styles.legacy,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={`${formatMoney(payment.amountUsd)} on ${payment.paymentDate}, recorded on ${target.reference}. ${payment.status}.`} accessibilityHint="Opens the record this payment was made on">
        <View style={financeStyles.flex}><Text style={[styles.strongLine,payment.status==='Cancelled'&&styles.struck]}>{formatMoney(payment.amountUsd)}</Text><Text style={financeStyles.meta}>{payment.paymentDate} · recorded on {target.reference}</Text></View>
        <StatusBadge word={payment.status==='Cancelled'?'Cancelled':'Active'} label={payment.status==='Cancelled'?'Cancelled':'Recorded'}/>
      </Pressable>)}
      {!data.payments.length&&!recordPayments.length?<Text style={financeStyles.empty}>No payments recorded for this account yet.</Text>:null}
    </Section>

    {settled.length?<Section title="Paid records" summary={`${settled.length} fully paid or with nothing due`} open={open.has('settled')} onToggle={()=>toggle('settled')}>
      {settled.map(target=><RecordLine key={recordKey(target)} target={target} onPress={()=>onRecord(target)}/>)}
    </Section>:null}

    <Section title="Cancelled balances" summary={data.cancelled.length?`${data.cancelled.length} Open Balance${data.cancelled.length===1?'':'s'} cancelled, not owed`:'None cancelled'} open={open.has('cancelled')} onToggle={()=>toggle('cancelled')}>
      {data.cancelled.length?data.cancelled.map(opening=><View key={opening.id} style={styles.cancelledCard} accessible accessibilityLabel={`Open Balance ${opening.reference}, ${formatMoney(opening.amountUsd)}, as of ${opening.asOfDate}. Cancelled ${opening.cancelledAt.slice(0,10)}. Reason: ${opening.cancellationReason}.`}>
        <View style={styles.accountTop}>
          <View style={financeStyles.flex}><Text style={[styles.strongLine,styles.struck]}>{formatMoney(opening.amountUsd)}</Text><Text style={financeStyles.meta}>{opening.reference} · as of {opening.asOfDate}</Text></View>
          <StatusBadge word="Cancelled"/>
        </View>
        <Text style={financeStyles.meta}>Cancelled {opening.cancelledAt.slice(0,10)}{opening.statusBeforeCancellation?`, was ${opening.statusBeforeCancellation}`:''}. Reason: {opening.cancellationReason}</Text>
      </View>):<Text style={financeStyles.empty}>No Open Balance on this account has been cancelled.</Text>}
    </Section>

    <Section title="Account activity" summary={`${activity.length} dated event${activity.length===1?'':'s'}, newest first`} open={open.has('activity')} onToggle={()=>toggle('activity')}>
      {activity.length?activity.slice(0,activityLimit).map((event,index)=><View key={`${event.kind}-${index}`} style={styles.event}>
        <Text style={styles.eventDate}>{event.date}</Text>
        <View style={financeStyles.flex}>{event.kind==='record'?<Text style={styles.eventText}>{targetTypeLabel(event.target.type)} {event.target.reference} · {formatMoney(event.target.totalUsd)}</Text>
          :event.kind==='payment'?<Text style={styles.eventText}>Payment {formatMoney(event.payment.amountUsd)} · {applicationModeLabels[event.payment.mode]}</Text>
          :event.kind==='paymentCancelled'?<Text style={styles.eventText}>Payment {formatMoney(event.payment.amountUsd)} cancelled: {event.payment.cancellationReason}</Text>
          :event.kind==='applied'?<Text style={styles.eventText}>{formatMoney(event.amountUsd)} of the {event.payment.paymentDate} payment applied to {event.references.join(', ')}</Text>
          :<Text style={styles.eventText}>Open Balance {event.opening.reference} cancelled: {event.opening.cancellationReason}</Text>}</View>
      </View>):<Text style={financeStyles.empty}>No activity yet.</Text>}
      {activity.length>activityLimit?<AppButton label="Show older activity" tone="secondary" onPress={()=>setActivityLimit(value=>value+PAGE)}/>:null}
    </Section>
  </ScrollView>;
}

function OpeningBalanceForm({repository,parties,onSaved}:{repository:FinancialRepository;parties:FinancialOverview['parties'];onSaved:(text:string)=>void}){
  const[draft,setDraft]=useState<OpeningBalanceDraft>(emptyOpeningBalanceDraft);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const set=<K extends keyof OpeningBalanceDraft>(key:K,value:OpeningBalanceDraft[K])=>setDraft(current=>({...current,[key]:value}));
  const available=parties.filter(party=>party.type===draft.partyType);
  async function save(){setBusy(true);setError(null);try{await repository.createOpeningBalance(draft);setDraft(emptyOpeningBalanceDraft);onSaved('Open Balance saved.');}catch(cause){setError(cause instanceof Error?cause.message:'The Open Balance could not be saved.');}finally{setBusy(false);}}
  return <View style={styles.form}>
    <SegmentedChoice label="Balance type" options={[{id:'customer' as FinancialPartyType,label:'Customer owes you'},{id:'supplier' as FinancialPartyType,label:'You owe supplier'}]} selectedId={draft.partyType} onSelect={partyType=>setDraft({...emptyOpeningBalanceDraft,partyType})}/>
    <SearchableSelect label={`${draft.partyType==='customer'?'Customer':'Supplier'} *`} options={available.map(party=>({id:party.id,label:party.name}))} selectedId={draft.partyId} onSelect={id=>set('partyId',id)} placeholder={`Select ${draft.partyType}`}/>
    <Field label="Original amount (USD) *" value={draft.amountUsd} onChangeText={value=>set('amountUsd',value)} keyboardType="decimal-pad"/>
    <DatePickerField label="As-of date *" value={draft.asOfDate} onChange={value=>set('asOfDate',value)} maxDate={todayIso()}/>
    <Field label="Paper reference" value={draft.reference} onChangeText={value=>set('reference',value)}/>
    <Field label="Notes" value={draft.notes} onChangeText={value=>set('notes',value)} multiline/>
    {error?<Notice kind="error">{error}</Notice>:null}
    <AppButton label="Save Open Balance" tone="navy" busy={busy} onPress={()=>void save()}/>
  </View>;
}

// The project-scoped, read-only review lives in its own screen file with its own stylesheet so it
// cannot restyle the account views above. It is re-exported here so the Project Command Center's
// existing import path and navigation contract stay unchanged.
export {ProjectFinancialReview} from './ProjectFinancialReviewScreen';

const styles=StyleSheet.create({
  pressed:{backgroundColor:'#F7F4EE'},
  state:{flex:1,alignItems:'center',justifyContent:'center',gap:12,padding:24},
  stateTitle:{color:colors.ink,fontSize:19,fontWeight:'800',textAlign:'center'},
  stateBody:{color:BODY_TEXT,fontSize:14,lineHeight:20,textAlign:'center',maxWidth:320},
  stateActions:{alignSelf:'stretch',gap:10},
  searchBar:{flexDirection:'row',alignItems:'center',minHeight:52,backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:CARD_BORDER,paddingLeft:14},
  searchInput:{flex:1,color:colors.ink,fontSize:15,paddingVertical:12},
  clear:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},clearText:{color:BODY_TEXT,fontSize:22,fontWeight:'700'},
  filterChip:{alignSelf:'flex-start',minHeight:44,paddingHorizontal:14,borderRadius:22,borderWidth:1,borderColor:CARD_BORDER,backgroundColor:colors.surface,justifyContent:'center'},
  filterChipOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  filterChipText:{color:colors.ink,fontWeight:'600',fontSize:13},filterChipTextOn:{color:'#FFF8ED'},
  listHead:{flexDirection:'row',alignItems:'baseline',justifyContent:'space-between',marginTop:4},
  listTitle:{color:colors.ink,fontSize:18,fontWeight:'800'},
  stack:{gap:10},
  accountCard:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:CARD_BORDER,padding:14,gap:10,shadowColor:'#17212B',shadowOpacity:.06,shadowRadius:5,shadowOffset:{width:0,height:2},elevation:1},
  accountTop:{flexDirection:'row',alignItems:'flex-start',gap:12},
  accountName:{color:colors.ink,fontSize:16,lineHeight:21,fontWeight:'700'},
  accountRight:{alignItems:'flex-end',flexShrink:0,maxWidth:'48%'},
  accountBalance:{color:colors.navy,fontSize:18,fontWeight:'800',fontVariant:['tabular-nums']},
  accountSettled:{color:'#1F6446'},
  accountBottom:{flexDirection:'row',flexWrap:'wrap',columnGap:14,rowGap:2,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,paddingTop:8},
  strong:{color:colors.ink,fontWeight:'700',fontVariant:['tabular-nums']},
  balanceCard:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:CARD_BORDER,padding:16,gap:8},
  balanceLabel:{color:BODY_TEXT,fontSize:13,fontWeight:'700'},
  balanceValue:{color:colors.navy,fontSize:30,fontWeight:'800',fontVariant:['tabular-nums']},
  cancelBox:{gap:10,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,paddingTop:10},
  link:{minHeight:44,justifyContent:'center',alignSelf:'flex-start'},
  linkText:{color:colors.danger,fontWeight:'700',fontSize:13},
  legacy:{flexDirection:'row',alignItems:'center',gap:12,backgroundColor:colors.surface,borderRadius:12,borderWidth:1,borderColor:'#E3DBCD',padding:12,minHeight:56},
  strongLine:{color:colors.ink,fontSize:15,fontWeight:'700',fontVariant:['tabular-nums']},
  struck:{textDecorationLine:'line-through',color:colors.muted},
  cancelledCard:{backgroundColor:colors.surface,borderRadius:12,borderWidth:1,borderColor:'#EFD3CF',padding:12,gap:6},
  event:{flexDirection:'row',gap:12,paddingVertical:8,paddingHorizontal:4,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line},
  eventDate:{color:colors.navy,fontSize:12,fontWeight:'700',width:84,fontVariant:['tabular-nums']},
  eventText:{color:colors.ink,fontSize:13,lineHeight:18},
  form:{gap:12,padding:4},
});
