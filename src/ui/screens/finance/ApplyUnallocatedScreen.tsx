import {useMemo,useState} from 'react';
import {Alert,KeyboardAvoidingView,Platform,Pressable,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {FinancialRepository} from '../../../data/repositories/FinancialRepository';
import {applicationModeLabels,oldestFirst,paymentMethodLabels,planApplyUnallocated,type AccountPayment,type ApplyUnallocatedDraft} from '../../../domain/accountPayments';
import type {FinancialTarget} from '../../../domain/financials';
import {AppButton} from '../../components/AppPrimitives';
import {colors} from '../../theme';
import {formatMoney} from '../projectFinancialReviewPresentation';
import {BODY_TEXT,CARD_BORDER,Field,FinanceHeader,Notice,SOFT_BORDER,StatusBadge,financeStyles} from './financeParts';

const MODES:{mode:ApplyUnallocatedDraft['mode'];title:string;body:string}[]=[
  {mode:'oldest',title:'Oldest unpaid records',body:'Applies it to the oldest unpaid records first, each only up to what it still owes.'},
  {mode:'selected',title:'Select records',body:'You choose the records and enter the amount for each, in full or in part.'},
];
const PAGE=30;

/**
 * DEC-485. Apply money that an earlier payment left unallocated to this account's records. The payment
 * itself (amount, date, method, reference) never changes; only new applied amounts are added, and
 * whatever is not applied stays unallocated.
 */
export function ApplyUnallocatedScreen({repository,payment,open,onApplied,onCancel}:{repository:FinancialRepository;payment:AccountPayment;open:FinancialTarget[];onApplied:(message:string)=>void;onCancel:()=>void}){
  const[draft,setDraft]=useState<ApplyUnallocatedDraft>({mode:'oldest',amountUsd:payment.unallocatedUsd.toFixed(2),selections:[]});
  const[selected,setSelected]=useState<Record<string,string>>({});
  const[limit,setLimit]=useState(PAGE);
  const[attempted,setAttempted]=useState(false);
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const ordered=useMemo(()=>oldestFirst(open),[open]);
  const key=(target:FinancialTarget)=>`${target.type}|${target.id}`;
  const effective:ApplyUnallocatedDraft={...draft,selections:draft.mode==='selected'?ordered.filter(target=>key(target) in selected).map(target=>({targetType:target.type,targetId:target.id,amountUsd:selected[key(target)]??''})):[]};
  const plan=planApplyUnallocated(payment,effective,open);
  const ready=plan.allocatedCents>0&&!plan.issues.length;

  function toggle(target:FinancialTarget){setSelected(current=>{const next={...current};if(key(target) in next)delete next[key(target)];else next[key(target)]=target.remainingUsd.toFixed(2);return next;});}
  function apply(){
    setAttempted(true);setError(null);
    if(!ready)return;
    Alert.alert(`Apply ${formatMoney(plan.allocatedCents/100)} to records?`,`${plan.allocations.map(line=>`${line.reference}: ${formatMoney(line.amountCents/100)}`).join('\n')}\n\nStill unallocated afterwards: ${formatMoney(payment.unallocatedUsd-plan.allocatedCents/100)}`,[
      {text:'Keep editing',style:'cancel'},
      {text:'Apply',onPress:()=>void commit()},
    ]);
  }
  async function commit(){
    setBusy(true);setError(null);
    try{await repository.applyUnallocatedPayment(payment.id,effective);onApplied(`${formatMoney(plan.allocatedCents/100)} of the ${payment.paymentDate} payment applied to records.`);}
    catch(cause){setError(cause instanceof Error?cause.message:'The payment could not be applied.');}
    finally{setBusy(false);}
  }

  return <KeyboardAvoidingView style={financeStyles.flex} behavior={Platform.OS==='ios'?'padding':undefined}>
    <ScrollView contentContainerStyle={financeStyles.content} keyboardShouldPersistTaps="handled">
      <FinanceHeader eyebrow="APPLY UNALLOCATED PAYMENT" title={payment.partyName} onBack={onCancel} backLabel="Cancel"/>
      <View style={styles.context} accessible accessibilityRole="text" accessibilityLabel={`Payment of ${formatMoney(payment.amountUsd)} on ${payment.paymentDate}. ${formatMoney(payment.unallocatedUsd)} not yet applied to any record.`}>
        <Text style={financeStyles.meta}>{formatMoney(payment.amountUsd)} paid {payment.paymentDate} · {paymentMethodLabels[payment.method]}{payment.reference?` · ${payment.reference}`:''} · {applicationModeLabels[payment.mode]}</Text>
        <Text style={styles.contextValue}>{formatMoney(payment.unallocatedUsd)}</Text>
        <Text style={financeStyles.meta}>not yet applied to any record</Text>
      </View>
      <Text style={financeStyles.helper}>The payment itself does not change. Only the amount you apply here is moved onto records; anything you do not apply stays unallocated.</Text>
      {error?<Notice kind="error">{error}</Notice>:null}

      <View style={styles.block}>
        <Field label="Amount to apply (USD) *" value={draft.amountUsd} onChangeText={amountUsd=>setDraft(current=>({...current,amountUsd}))} keyboardType="decimal-pad"/>
        <Text style={styles.blockTitle}>Apply it to</Text>
        <View style={styles.modes} accessibilityRole="radiogroup">
          {MODES.map(option=><Pressable key={option.mode} onPress={()=>setDraft(current=>({...current,mode:option.mode}))} style={({pressed})=>[styles.mode,draft.mode===option.mode&&styles.modeSelected,pressed&&styles.pressed]}
            accessibilityRole="radio" accessibilityState={{checked:draft.mode===option.mode}} accessibilityLabel={option.title} accessibilityHint={option.body}>
            <View style={[styles.radio,draft.mode===option.mode&&styles.radioOn]}>{draft.mode===option.mode?<View style={styles.radioDot}/>:null}</View>
            <View style={financeStyles.flex}><Text style={styles.modeTitle}>{option.title}</Text><Text style={financeStyles.meta}>{option.body}</Text></View>
          </Pressable>)}
        </View>

        {draft.mode==='oldest'?<View style={styles.preview}>
          <Text style={financeStyles.subhead}>Records it will pay</Text>
          {plan.allocations.length?plan.allocations.map(line=><View key={`${line.targetType}|${line.targetId}`} style={styles.line}>
            <View style={financeStyles.flex}><Text style={styles.ref}>{line.reference}</Text><Text style={financeStyles.meta}>{line.recordDate.slice(0,10)}</Text></View>
            <Text style={styles.lineAmount}>{formatMoney(line.amountCents/100)}</Text>
          </View>):<Text style={financeStyles.meta}>{open.length?'Enter an amount to see which records it pays.':'This account has no unpaid records.'}</Text>}
        </View>:<View style={styles.preview}>
          <Text style={financeStyles.subhead}>Choose records and amounts</Text>
          {ordered.length?ordered.slice(0,limit).map(target=>{const on=key(target) in selected;return <View key={key(target)} style={[styles.pick,on&&styles.pickOn]}>
            <Pressable onPress={()=>toggle(target)} style={styles.pickHead} accessibilityRole="checkbox" accessibilityState={{checked:on}} accessibilityLabel={`${target.reference}, still owes ${formatMoney(target.remainingUsd)}`}>
              <View style={[styles.check,on&&styles.checkOn]}>{on?<Text style={styles.checkMark}>✓</Text>:null}</View>
              <View style={financeStyles.flex}><Text style={styles.ref}>{target.reference}</Text><Text style={financeStyles.meta}>{target.recordDate.slice(0,10)} · still owes {formatMoney(target.remainingUsd)}</Text></View>
              <StatusBadge word={target.status}/>
            </Pressable>
            {on?<Field label={`Amount for ${target.reference}`} value={selected[key(target)]??''} onChangeText={value=>setSelected(current=>({...current,[key(target)]:value}))} keyboardType="decimal-pad"/>:null}
          </View>;}):<Text style={financeStyles.meta}>This account has no unpaid records.</Text>}
          {ordered.length>limit?<AppButton label={`Show ${Math.min(PAGE,ordered.length-limit)} more records`} tone="secondary" onPress={()=>setLimit(value=>value+PAGE)}/>:null}
        </View>}
      </View>

      <View style={styles.summary} accessible accessibilityRole="summary" accessibilityLabel={`Applying ${formatMoney(plan.allocatedCents/100)}. Still unallocated afterwards ${formatMoney(Math.max(0,payment.unallocatedUsd-plan.allocatedCents/100))}.`}>
        <SummaryLine label="Unallocated now" value={payment.unallocatedUsd}/>
        <SummaryLine label="Applying to records" value={plan.allocatedCents/100} strong/>
        <View style={styles.rule}/>
        <SummaryLine label="Still unallocated afterwards" value={Math.max(0,payment.unallocatedUsd-plan.allocatedCents/100)} strong/>
      </View>
      {attempted&&plan.issues.length?<Notice kind="error">{plan.issues.join('\n')}</Notice>:null}
      <AppButton label={plan.allocatedCents>0?`Apply ${formatMoney(plan.allocatedCents/100)} to records`:'Apply to records'} busy={busy} disabled={attempted&&!ready} onPress={apply}/>
      <TouchableOpacity style={styles.cancel} onPress={onCancel} accessibilityRole="button" accessibilityLabel="Cancel without applying"><Text style={styles.cancelText}>Cancel without applying</Text></TouchableOpacity>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function SummaryLine({label,value,strong=false}:{label:string;value:number;strong?:boolean}){
  return <View style={styles.summaryLine}><Text style={[styles.summaryLabel,strong&&styles.summaryStrong]}>{label}</Text><Text style={[styles.summaryValue,strong&&styles.summaryStrong]}>{formatMoney(value)}</Text></View>;
}

const styles=StyleSheet.create({
  pressed:{backgroundColor:'#F7F4EE'},
  context:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:CARD_BORDER,padding:16,gap:2},
  contextValue:{color:'#6E4B1F',fontSize:26,fontWeight:'800',fontVariant:['tabular-nums']},
  block:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:CARD_BORDER,padding:14,gap:12},
  blockTitle:{color:colors.ink,fontSize:16,fontWeight:'700'},
  modes:{gap:8},
  mode:{flexDirection:'row',alignItems:'flex-start',gap:12,borderRadius:12,borderWidth:1,borderColor:SOFT_BORDER,padding:12,minHeight:64},
  modeSelected:{borderColor:colors.navy,borderWidth:1.5,backgroundColor:'#F4F7FA'},
  modeTitle:{color:colors.ink,fontSize:15,fontWeight:'700',marginBottom:2},
  radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:'#8C97A1',alignItems:'center',justifyContent:'center',marginTop:1},
  radioOn:{borderColor:colors.navy},radioDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.navy},
  preview:{gap:8,borderTopWidth:1,borderTopColor:SOFT_BORDER,paddingTop:12},
  line:{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:6,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.line},
  ref:{color:colors.ink,fontSize:14,fontWeight:'700'},
  lineAmount:{color:colors.ink,fontSize:15,fontWeight:'800',fontVariant:['tabular-nums']},
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
  cancel:{minHeight:48,alignItems:'center',justifyContent:'center'},
  cancelText:{color:BODY_TEXT,fontWeight:'700'},
});
