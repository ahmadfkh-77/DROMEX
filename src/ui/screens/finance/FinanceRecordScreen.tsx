import {useState} from 'react';
import {Alert,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {FinancialRepository} from '../../../data/repositories/FinancialRepository';
import {applicationModeLabels,paymentMethodLabels,type AccountPayment} from '../../../domain/accountPayments';
import type {FinancialTarget} from '../../../domain/financials';
import {AppButton} from '../../components/AppPrimitives';
import {colors} from '../../theme';
import {formatMoney} from '../projectFinancialReviewPresentation';
import {CARD_BORDER,Field,FinanceHeader,MoneyBox,Notice,SOFT_BORDER,StatusBadge,financeStyles,targetTypeLabel} from './financeParts';

/**
 * One unpaid, partly paid or paid record: its total, paid and remaining amounts, the two ways to pay
 * it, and every payment that ever affected it (kept when a payment or the record is later cancelled).
 * An Open Balance can also be cancelled here, with a reason, once it has no active payments.
 */
export function FinanceRecordScreen({repository,target,accountPayments,onBack,onPay,onChanged}:{
  repository:FinancialRepository;target:FinancialTarget;accountPayments:AccountPayment[];onBack:()=>void;onPay:(full:boolean)=>void;onChanged:(message:string)=>void;
}){
  const[reason,setReason]=useState('');
  const[obReason,setObReason]=useState('');
  const[busy,setBusy]=useState(false);
  const[error,setError]=useState<string|null>(null);
  const activePayments=target.payments.filter(payment=>payment.status==='Active');
  const parentOf=(id:string|null|undefined)=>id?accountPayments.find(payment=>payment.id===id)??null:null;

  function cancelPayment(paymentId:string){
    if(!reason.trim()){setError('Enter the reason for cancelling this payment first.');return;}
    Alert.alert('Cancel this payment?','It stays visible in history but no longer counts toward paid totals or balances.',[
      {text:'Keep payment',style:'cancel'},
      {text:'Cancel payment',style:'destructive',onPress:()=>void run(async()=>{await repository.cancelPayment(paymentId,reason);setReason('');},'Payment cancelled. It remains in history.')},
    ]);
  }
  function cancelOpening(){
    if(!obReason.trim()){setError('Enter the reason for cancelling this Open Balance first.');return;}
    Alert.alert('Cancel this Open Balance?',`${formatMoney(target.totalUsd)} will no longer count toward what is owed. The balance stays in history as Cancelled with your reason.`,[
      {text:'Keep balance',style:'cancel'},
      {text:'Cancel balance',style:'destructive',onPress:()=>void run(async()=>{await repository.cancelOpeningBalance(target.id,obReason);},'Open Balance cancelled. It is kept in history and no longer owed.')},
    ]);
  }
  async function run(action:()=>Promise<void>,success:string){
    setBusy(true);setError(null);
    try{await action();onChanged(success);}catch(cause){setError(cause instanceof Error?cause.message:'The change could not be saved.');}finally{setBusy(false);}
  }

  return <ScrollView contentContainerStyle={financeStyles.content} keyboardShouldPersistTaps="handled">
    <FinanceHeader eyebrow={targetTypeLabel(target.type).toUpperCase()} title={target.reference} onBack={onBack}/>
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={financeStyles.flex}>
          <Text style={styles.party}>{target.partyName}</Text>
          <Text style={financeStyles.meta}>{[target.recordDate.slice(0,10),target.projectName,target.itemName,target.quantity!=null?`${target.quantity} ${target.unitSymbol??''}`.trim():null].filter(Boolean).join(' · ')}</Text>
        </View>
        <StatusBadge word={target.status}/>
      </View>
      <View style={financeStyles.wrapRow}>
        <MoneyBox role="billed" label="Total" value={target.totalUsd}/>
        <MoneyBox role="paid" label="Paid" value={target.paidUsd}/>
        <MoneyBox role="balance" label={target.overpaidUsd>0?'Overpaid':'Remaining'} value={target.overpaidUsd>0?target.overpaidUsd:target.remainingUsd}/>
      </View>
    </View>
    {error?<Notice kind="error">{error}</Notice>:null}

    {target.remainingUsd>0?<View style={styles.actions}>
      <AppButton label="Mark paid in full" hint={`Records ${formatMoney(target.remainingUsd)} against this record`} onPress={()=>onPay(true)}/>
      <AppButton label="Record partial payment" tone="secondary" onPress={()=>onPay(false)}/>
    </View>:<Notice kind="success">Nothing is owed on this record.</Notice>}

    <View style={styles.card}>
      <Text style={styles.cardTitle}>Payment history</Text>
      {target.payments.length?target.payments.map(payment=>{const parent=parentOf(payment.accountPaymentId);const cancelled=payment.status==='Cancelled';return <View key={payment.id} style={[styles.payment,cancelled&&styles.paymentCancelled]} accessible accessibilityLabel={`${formatMoney(payment.amountUsd)} on ${payment.paymentDate}. ${payment.status}.${parent?` Part of a ${formatMoney(parent.amountUsd)} payment, ${applicationModeLabels[parent.mode]}.`:''}`}>
        <View style={styles.top}>
          <View style={financeStyles.flex}>
            <Text style={[styles.amount,cancelled&&styles.struck]}>{formatMoney(payment.amountUsd)}</Text>
            <Text style={financeStyles.meta}>{payment.paymentDate}{parent?` · ${paymentMethodLabels[parent.method]}${parent.reference?` · ${parent.reference}`:''}`:''}</Text>
            {parent?<Text style={financeStyles.meta}>Part of a {formatMoney(parent.amountUsd)} payment ({applicationModeLabels[parent.mode]})</Text>:null}
          </View>
          <StatusBadge word={cancelled?'Cancelled':'Active'} label={cancelled?'Cancelled':'Counted'}/>
        </View>
        {cancelled?<Text style={styles.cancelNote}>Cancelled{payment.cancelledAt?` ${payment.cancelledAt.slice(0,10)}`:''}: {payment.cancellationReason}</Text>
          :parent?<Text style={financeStyles.meta}>To undo it, cancel the whole payment from the account's Payment history.</Text>
          :<TouchableOpacity style={styles.link} disabled={busy} onPress={()=>cancelPayment(payment.id)} accessibilityRole="button" accessibilityLabel={`Cancel the ${formatMoney(payment.amountUsd)} payment`} accessibilityHint="Needs a reason and a confirmation"><Text style={styles.linkText}>Cancel this payment</Text></TouchableOpacity>}
      </View>;}):<Text style={financeStyles.meta}>No payments recorded on this record yet.</Text>}
      {activePayments.some(payment=>!payment.accountPaymentId)?<Field label="Reason for cancelling a payment" value={reason} onChangeText={setReason} multiline/>:null}
    </View>

    {target.type==='openingBalance'?<View style={[styles.card,styles.danger]}>
      <Text style={styles.cardTitle}>Cancel this Open Balance</Text>
      <Text style={financeStyles.helper}>Use this when the balance was entered by mistake. It is never deleted: it stays in history as Cancelled, with your reason, and stops counting toward what is owed.</Text>
      {activePayments.length?<Notice kind="info">{`This Open Balance has ${activePayments.length} active payment${activePayments.length===1?'':'s'}. Cancel those payments first, then cancel the balance.`}</Notice>:<>
        <Field label="Reason for cancelling this Open Balance *" value={obReason} onChangeText={setObReason} multiline/>
        <AppButton label="Cancel this Open Balance" tone="danger" busy={busy} onPress={cancelOpening}/>
      </>}
    </View>:null}
  </ScrollView>;
}

const styles=StyleSheet.create({
  card:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:CARD_BORDER,padding:14,gap:12},
  danger:{borderColor:'#EFC9C4'},
  top:{flexDirection:'row',alignItems:'flex-start',gap:12},
  party:{color:colors.ink,fontSize:16,fontWeight:'700'},
  cardTitle:{color:colors.ink,fontSize:16,fontWeight:'700'},
  actions:{gap:10},
  payment:{borderRadius:12,borderWidth:1,borderColor:SOFT_BORDER,padding:12,gap:6},
  paymentCancelled:{backgroundColor:'#FDF8F7',borderColor:'#EFD3CF'},
  amount:{color:colors.ink,fontSize:16,fontWeight:'800',fontVariant:['tabular-nums']},
  struck:{textDecorationLine:'line-through',color:colors.muted},
  cancelNote:{color:colors.danger,fontSize:12,lineHeight:17},
  link:{minHeight:44,justifyContent:'center',alignSelf:'flex-start'},
  linkText:{color:colors.danger,fontWeight:'700',fontSize:13},
});
