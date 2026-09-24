import {useMemo,useState} from 'react';
import {Alert,KeyboardAvoidingView,Platform,Pressable,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {FinancialRepository} from '../../../data/repositories/FinancialRepository';
import {
  balanceAfterPayment,emptyAccountPaymentDraft,oldestFirst,paymentMethodLabels,planAllocation,validateAccountPaymentDraft,
  type AccountPaymentDraft,type AccountSummary,type ApplicationMode,type PaymentMethod,
} from '../../../domain/accountPayments';
import type {FinancialPartyType,FinancialTarget} from '../../../domain/financials';
import {AppButton} from '../../components/AppPrimitives';
import {DatePickerField,todayIso} from '../../components/DatePickerField';
import {colors} from '../../theme';
import {formatMoney} from '../projectFinancialReviewPresentation';
import {BODY_TEXT,CARD_BORDER,Field,FinanceHeader,Notice,SOFT_BORDER,StatusBadge,financeStyles} from './financeParts';

/** The three ways to apply a payment, each explained in one sentence before anything is saved. */
const MODES:{mode:ApplicationMode;title:string;body:string}[]=[
  {mode:'overall',title:'Overall balance',body:'Lowers what this account owes without marking any record as paid. The amount stays visible as unallocated.'},
  {mode:'oldest',title:'Oldest unpaid records',body:'Pays the oldest unpaid records first, each only up to what it still owes. The preview below lists every record it will pay.'},
  {mode:'selected',title:'Select records',body:'You choose the records and enter the amount for each, in full or in part.'},
];
const PAGE=30;

/**
 * DEC-482. Add Payment: one real payment for one account, entered once. With a `record`, it is a
 * payment on that record alone (paid in full or in part) and the mode choice is not offered.
 */
export function AddPaymentScreen({repository,partyType,partyId,name,open,summary,record,full=false,onSaved,onCancel}:{
  repository:FinancialRepository;partyType:FinancialPartyType;partyId:string;name:string;open:FinancialTarget[];summary:AccountSummary;
  record?:FinancialTarget;full?:boolean;onSaved:(message:string)=>void;onCancel:()=>void;
}){
  const[draft,setDraft]=useState<AccountPaymentDraft>(()=>({...emptyAccountPaymentDraft(partyType,partyId),mode:record?'record':'overall',amountUsd:record&&full?record.remainingUsd.toFixed(2):''}));
  const[selected,setSelected]=useState<Record<string,string>>({});
  const[limit,setLimit]=useState(PAGE);
  const[attempted,setAttempted]=useState(false);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const set=(patch:Partial<AccountPaymentDraft>)=>setDraft(current=>({...current,...patch}));
  const ordered=useMemo(()=>oldestFirst(open),[open]);
  const key=(target:FinancialTarget)=>`${target.type}|${target.id}`;

  // The draft as it will be saved: a record payment always goes to that record; Select records uses
  // the ticked records and their amounts.
  const effective:AccountPaymentDraft=record
    ?{...draft,mode:'record',selections:[{targetType:record.type,targetId:record.id,amountUsd:draft.amountUsd}]}
    :{...draft,selections:draft.mode==='selected'?ordered.filter(target=>key(target) in selected).map(target=>({targetType:target.type,targetId:target.id,amountUsd:selected[key(target)]??''})):[]};
  const plan=planAllocation(effective,record?[record]:open);
  const issues=[...validateAccountPaymentDraft(effective),...(plan.amountCents>0?plan.issues:[])];
  const after=balanceAfterPayment(summary,plan);
  const ready=plan.amountCents>0&&!issues.length;

  function toggle(target:FinancialTarget){
    setSelected(current=>{const next={...current};if(key(target) in next)delete next[key(target)];else next[key(target)]=target.remainingUsd.toFixed(2);return next;});
  }
  function save(){
    setAttempted(true);setError(null);
    if(!ready)return;
    const lines=[`Amount: ${formatMoney(plan.amountCents/100)}`,`Applied to records: ${formatMoney(plan.allocatedCents/100)}`,`Unallocated: ${formatMoney(plan.unallocatedCents/100)}`,`Balance after: ${formatMoney(after.balanceUsd)}${after.creditUsd>0?` · Credit ${formatMoney(after.creditUsd)}`:''}`];
    Alert.alert(`Save payment of ${formatMoney(plan.amountCents/100)}?`,lines.join('\n'),[
      {text:'Keep editing',style:'cancel'},
      {text:'Save payment',onPress:()=>void commit()},
    ]);
  }
  async function commit(){
    setBusy(true);setError(null);
    try{await repository.recordAccountPayment(effective);onSaved(`Payment of ${formatMoney(plan.amountCents/100)} recorded for ${name}.`);}
    catch(cause){setError(cause instanceof Error?cause.message:'The payment could not be saved.');}
    finally{setBusy(false);}
  }

  return <KeyboardAvoidingView style={financeStyles.flex} behavior={Platform.OS==='ios'?'padding':undefined}>
    <ScrollView contentContainerStyle={financeStyles.content} keyboardShouldPersistTaps="handled">
      <FinanceHeader eyebrow={record?'RECORD PAYMENT':'ADD PAYMENT'} title={record?record.reference:name} onBack={onCancel} backLabel="Cancel"/>
      <View style={styles.context} accessible accessibilityRole="text" accessibilityLabel={record?`${name}. Remaining on this record ${formatMoney(record.remainingUsd)} of ${formatMoney(record.totalUsd)}.`:`${name} owes ${formatMoney(summary.balanceUsd)} across ${summary.openRecordCount} open records.`}>
        <Text style={financeStyles.meta}>{record?name:partyType==='customer'?'Customer account':'Supplier account'}</Text>
        <Text style={styles.contextValue}>{formatMoney(record?record.remainingUsd:summary.balanceUsd)}</Text>
        <Text style={financeStyles.meta}>{record?`still owed on this record, of ${formatMoney(record.totalUsd)}`:`owed now across ${summary.openRecordCount} open record${summary.openRecordCount===1?'':'s'}`}</Text>
      </View>
      <Text style={financeStyles.helper}>This records money received or paid outside the app. It does not send or process a payment.</Text>
      {error?<Notice kind="error">{error}</Notice>:null}

      <View style={styles.block}>
        <Field label="Amount (USD) *" value={draft.amountUsd} onChangeText={amountUsd=>set({amountUsd})} keyboardType="decimal-pad" placeholder="0.00"/>
        {record?<View style={financeStyles.wrapRow}>
          <QuickChip label={`Full remaining ${formatMoney(record.remainingUsd)}`} onPress={()=>set({amountUsd:record.remainingUsd.toFixed(2)})}/>
        </View>:null}
        <DatePickerField label="Payment date *" value={draft.paymentDate} onChange={paymentDate=>set({paymentDate})} maxDate={todayIso()}/>
        <Text style={styles.label}>Method *</Text>
        <View style={financeStyles.wrapRow} accessibilityRole="radiogroup">
          {(Object.keys(paymentMethodLabels) as PaymentMethod[]).map(method=><Choice key={method} label={paymentMethodLabels[method]} selected={draft.method===method} onPress={()=>set({method})}/>)}
        </View>
        <Field label="Reference" value={draft.reference} onChangeText={reference=>set({reference})} placeholder="Cheque or transfer number"/>
        <Field label="Note" value={draft.note} onChangeText={note=>set({note})} multiline placeholder="Optional"/>
      </View>

      {record?null:<View style={styles.block}>
        <Text style={styles.blockTitle}>How should this payment be applied?</Text>
        <View style={styles.modes} accessibilityRole="radiogroup">
          {MODES.map(option=><Pressable key={option.mode} onPress={()=>set({mode:option.mode})} style={({pressed})=>[styles.mode,draft.mode===option.mode&&styles.modeSelected,pressed&&styles.pressed]}
            accessibilityRole="radio" accessibilityState={{checked:draft.mode===option.mode}} accessibilityLabel={option.title} accessibilityHint={option.body}>
            <View style={[styles.radio,draft.mode===option.mode&&styles.radioOn]}>{draft.mode===option.mode?<View style={styles.radioDot}/>:null}</View>
            <View style={financeStyles.flex}><Text style={styles.modeTitle}>{option.title}</Text><Text style={financeStyles.meta}>{option.body}</Text></View>
          </Pressable>)}
        </View>

        {draft.mode==='oldest'?<View style={styles.preview}>
          <Text style={financeStyles.subhead}>Records this payment will pay</Text>
          {plan.allocations.length?plan.allocations.map(line=><View key={`${line.targetType}|${line.targetId}`} style={styles.previewLine}>
            <View style={financeStyles.flex}><Text style={styles.previewRef}>{line.reference}</Text><Text style={financeStyles.meta}>{line.recordDate.slice(0,10)}</Text></View>
            <Text style={styles.previewAmount}>{formatMoney(line.amountCents/100)}</Text>
          </View>):<Text style={financeStyles.meta}>{open.length?'Enter an amount to see which records it pays.':'This account has no unpaid records; the whole amount stays unallocated.'}</Text>}
        </View>:null}

        {draft.mode==='selected'?<View style={styles.preview}>
          <Text style={financeStyles.subhead}>Choose records and amounts</Text>
          {ordered.length?ordered.slice(0,limit).map(target=>{const on=key(target) in selected;return <View key={key(target)} style={[styles.pick,on&&styles.pickOn]}>
            <Pressable onPress={()=>toggle(target)} style={styles.pickHead} accessibilityRole="checkbox" accessibilityState={{checked:on}} accessibilityLabel={`${target.reference}, still owes ${formatMoney(target.remainingUsd)}`}>
              <View style={[styles.check,on&&styles.checkOn]}>{on?<Text style={styles.checkMark}>✓</Text>:null}</View>
              <View style={financeStyles.flex}><Text style={styles.previewRef}>{target.reference}</Text><Text style={financeStyles.meta}>{target.recordDate.slice(0,10)} · still owes {formatMoney(target.remainingUsd)}</Text></View>
              <StatusBadge word={target.status}/>
            </Pressable>
            {on?<Field label={`Amount for ${target.reference}`} value={selected[key(target)]??''} onChangeText={value=>setSelected(current=>({...current,[key(target)]:value}))} keyboardType="decimal-pad"/>:null}
          </View>;}):<Text style={financeStyles.meta}>This account has no unpaid records to select.</Text>}
          {ordered.length>limit?<AppButton label={`Show ${Math.min(PAGE,ordered.length-limit)} more records`} tone="secondary" onPress={()=>setLimit(value=>value+PAGE)}/>:null}
        </View>:null}
      </View>}

      <View style={styles.summary} accessible accessibilityRole="summary" accessibilityLabel={`Payment ${formatMoney(plan.amountCents/100)}. Applied to records ${formatMoney(plan.allocatedCents/100)}. Unallocated ${formatMoney(plan.unallocatedCents/100)}. Balance after ${formatMoney(after.balanceUsd)}.${after.creditUsd>0?` Credit ${formatMoney(after.creditUsd)}.`:''}`}>
        <SummaryLine label="Payment" value={plan.amountCents/100} strong/>
        <SummaryLine label="Applied to records" value={plan.allocatedCents/100}/>
        <SummaryLine label="Unallocated" value={plan.unallocatedCents/100}/>
        <View style={styles.rule}/>
        <SummaryLine label={record?'Remaining on this record after':'Account balance after'} value={record?Math.max(0,record.remainingUsd-plan.allocatedCents/100):after.balanceUsd} strong/>
        {!record&&after.creditUsd>0?<Text style={styles.credit}>{formatMoney(after.creditUsd)} more than this account owes will be kept as credit.</Text>:null}
      </View>
      {attempted&&issues.length?<Notice kind="error">{issues.join('\n')}</Notice>:null}
      <AppButton label={plan.amountCents>0?`Save payment of ${formatMoney(plan.amountCents/100)}`:'Save payment'} busy={busy} disabled={attempted&&!ready} onPress={save}/>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function SummaryLine({label,value,strong=false}:{label:string;value:number;strong?:boolean}){
  return <View style={styles.summaryLine}><Text style={[styles.summaryLabel,strong&&styles.summaryStrong]}>{label}</Text><Text style={[styles.summaryValue,strong&&styles.summaryStrong]}>{formatMoney(value)}</Text></View>;
}
function Choice({label,selected,onPress}:{label:string;selected:boolean;onPress:()=>void}){
  return <TouchableOpacity style={[styles.choice,selected&&styles.choiceOn]} onPress={onPress} accessibilityRole="radio" accessibilityState={{checked:selected}} accessibilityLabel={label}><Text style={[styles.choiceText,selected&&styles.choiceTextOn]}>{label}</Text></TouchableOpacity>;
}
function QuickChip({label,onPress}:{label:string;onPress:()=>void}){
  return <TouchableOpacity style={styles.quick} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}><Text style={styles.quickText}>{label}</Text></TouchableOpacity>;
}

const styles=StyleSheet.create({
  pressed:{backgroundColor:'#F7F4EE'},
  context:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:CARD_BORDER,padding:16,gap:2},
  contextValue:{color:colors.navy,fontSize:26,fontWeight:'800',fontVariant:['tabular-nums']},
  block:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:CARD_BORDER,padding:14,gap:12},
  blockTitle:{color:colors.ink,fontSize:16,fontWeight:'700'},
  label:{color:colors.ink,fontSize:13,fontWeight:'700'},
  modes:{gap:8},
  mode:{flexDirection:'row',alignItems:'flex-start',gap:12,borderRadius:12,borderWidth:1,borderColor:SOFT_BORDER,padding:12,minHeight:64},
  modeSelected:{borderColor:colors.navy,borderWidth:1.5,backgroundColor:'#F4F7FA'},
  modeTitle:{color:colors.ink,fontSize:15,fontWeight:'700',marginBottom:2},
  radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:'#8C97A1',alignItems:'center',justifyContent:'center',marginTop:1},
  radioOn:{borderColor:colors.navy},radioDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.navy},
  preview:{gap:8,borderTopWidth:1,borderTopColor:SOFT_BORDER,paddingTop:12},
  previewLine:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:6,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line},
  previewRef:{color:colors.ink,fontSize:14,fontWeight:'700'},
  previewAmount:{color:colors.ink,fontSize:15,fontWeight:'800',fontVariant:['tabular-nums']},
  pick:{borderRadius:12,borderWidth:1,borderColor:SOFT_BORDER,padding:10,gap:8},
  pickOn:{borderColor:colors.navy,backgroundColor:'#F9FBFC'},
  pickHead:{flexDirection:'row',alignItems:'center',gap:10,minHeight:44},
  check:{width:24,height:24,borderRadius:6,borderWidth:2,borderColor:'#8C97A1',alignItems:'center',justifyContent:'center'},
  checkOn:{backgroundColor:colors.navy,borderColor:colors.navy},checkMark:{color:'#FFF8ED',fontSize:14,fontWeight:'900'},
  summary:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1.5,borderColor:colors.navy,padding:14,gap:6},
  summaryLine:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
  summaryLabel:{color:BODY_TEXT,fontSize:14},summaryValue:{color:colors.ink,fontSize:15,fontWeight:'600',fontVariant:['tabular-nums']},
  summaryStrong:{color:colors.ink,fontSize:16,fontWeight:'800'},
  rule:{height:1,backgroundColor:SOFT_BORDER,marginVertical:2},
  credit:{color:'#6E4B1F',fontSize:13,lineHeight:18,fontWeight:'600'},
  choice:{minHeight:44,paddingHorizontal:14,borderRadius:22,borderWidth:1,borderColor:CARD_BORDER,backgroundColor:colors.surface,justifyContent:'center'},
  choiceOn:{backgroundColor:colors.navy,borderColor:colors.navy},
  choiceText:{color:colors.ink,fontWeight:'600'},choiceTextOn:{color:'#FFF8ED'},
  quick:{minHeight:44,paddingHorizontal:14,borderRadius:22,backgroundColor:'#EEF3F8',justifyContent:'center'},
  quickText:{color:colors.navy,fontWeight:'700'},
});
