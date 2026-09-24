import type {ReactNode} from 'react';
import {Pressable,StyleSheet,Text,TextInput,TouchableOpacity,View,type KeyboardTypeOptions} from 'react-native';

import {applicationModeLabels,paymentMethodLabels,type AccountPayment} from '../../../domain/accountPayments';
import type {FinancialTarget,FinancialTargetType,PaymentStatus} from '../../../domain/financials';
import {colors} from '../../theme';
import {formatMoney} from '../projectFinancialReviewPresentation';

/**
 * Shared pieces of Payments & Balances (DEC-482 / DEC-483). Every state is written in words beside its
 * colour; colour only repeats what the words say. Money boxes have one role each: Billed blue-grey,
 * Paid soft green, Balance outlined navy, Unallocated and Credit a quiet cream.
 */
export const CARD_BORDER='#D9CFBE';
export const SOFT_BORDER='#E3DBCD';
export const BODY_TEXT='#5A6570';

export const targetTypeLabel=(type:FinancialTargetType)=>type==='load'?'Load receipt':type==='quarryPurchase'?'Supplier Load':type==='fuelDelivery'?'Fuel delivery':'Open Balance';

type Tone='success'|'warning'|'danger'|'neutral'|'info';
export type StateWord=PaymentStatus|'Cancelled'|'Unallocated'|'Active'|'Credit';
const toneOf=(word:StateWord):Tone=>word==='Paid'||word==='Active'?'success':word==='Unpaid'?'danger':word==='Partially Paid'||word==='Overpaid'||word==='Unpriced'?'warning':word==='Cancelled'?'danger':word==='Unallocated'||word==='Credit'?'info':'neutral';

/** A status written as a word, with a small matching dot. Cancelled is outlined so it reads as ended. */
export function StatusBadge({word,label}:{word:StateWord;label?:string}){
  const tone=toneOf(word);
  return <View style={[styles.badge,tone==='success'&&styles.badgeSuccess,tone==='warning'&&styles.badgeWarning,tone==='danger'&&(word==='Cancelled'?styles.badgeCancelled:styles.badgeDanger),tone==='info'&&styles.badgeInfo,tone==='neutral'&&styles.badgeNeutral]}>
    <View style={[styles.dot,{backgroundColor:tone==='success'?colors.success:tone==='warning'?colors.warning:tone==='danger'?colors.danger:tone==='info'?colors.navy:colors.muted}]}/>
    <Text style={[styles.badgeText,{color:tone==='success'?colors.success:tone==='warning'?'#7A500E':tone==='danger'?colors.danger:tone==='info'?colors.navy:BODY_TEXT}]}>{label??word}</Text>
  </View>;
}

export function FinanceHeader({eyebrow,title,onBack,backLabel='Back'}:{eyebrow:string;title:string;onBack:()=>void;backLabel?:string}){
  return <View style={styles.header}>
    <TouchableOpacity style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel}><Text style={styles.backText}>{backLabel}</Text></TouchableOpacity>
    <View style={styles.flex}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.title}>{title}</Text></View>
  </View>;
}

export type MoneyRole='billed'|'paid'|'balance'|'unallocated';
export function MoneyBox({role,label,value,note}:{role:MoneyRole;label:string;value:number;note?:string}){
  return <View style={[styles.box,role==='billed'&&styles.boxBilled,role==='paid'&&styles.boxPaid,role==='balance'&&styles.boxBalance,role==='unallocated'&&styles.boxUnallocated]} accessible accessibilityRole="text" accessibilityLabel={`${label} ${formatMoney(value)}${note?`. ${note}`:''}`}>
    <Text style={[styles.boxLabel,role==='billed'&&{color:colors.navy},role==='paid'&&{color:'#1F6446'},role==='balance'&&{color:colors.navy},role==='unallocated'&&{color:'#6E4B1F'}]} numberOfLines={2}>{label}</Text>
    <Text style={[styles.boxValue,role==='balance'&&styles.boxValueBalance]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{formatMoney(value)}</Text>
    {note?<Text style={styles.boxNote}>{note}</Text>:null}
  </View>;
}

/** A statement section that opens with + and closes with ×. */
export function Section({title,summary,open,onToggle,children}:{title:string;summary:string;open:boolean;onToggle:()=>void;children:ReactNode}){
  return <View style={styles.section}>
    <Pressable onPress={onToggle} style={({pressed})=>[styles.sectionHead,pressed&&styles.pressed]} android_ripple={{color:'#EFE9DF'}} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${title}. ${summary}`} accessibilityHint={open?'Hides this section':'Shows this section'}>
      <View style={styles.flex}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.meta}>{summary}</Text></View>
      <View style={[styles.toggle,open&&styles.toggleOpen]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={[styles.toggleGlyph,open&&styles.toggleGlyphOpen]}>{open?'×':'+'}</Text></View>
    </Pressable>
    {open?<View style={styles.sectionBody}>{children}</View>:null}
  </View>;
}

/** One record in a statement: what it is, what it still owes, and its state. */
export function RecordLine({target,onPress}:{target:FinancialTarget;onPress:()=>void}){
  const detail=[target.recordDate.slice(0,10),targetTypeLabel(target.type),target.projectName,target.itemName].filter(Boolean).join(' · ');
  return <Pressable onPress={onPress} style={({pressed})=>[styles.card,pressed&&styles.pressed]} android_ripple={{color:'#EFE9DF'}} accessibilityRole="button"
    accessibilityLabel={`${target.reference}, ${detail}. ${target.status}. Remaining ${formatMoney(target.remainingUsd)} of ${formatMoney(target.totalUsd)}.`} accessibilityHint="Opens this record to pay it or see its payments">
    <View style={styles.cardTop}>
      <View style={styles.flex}><Text style={styles.cardTitle}>{target.reference}</Text><Text style={styles.meta}>{detail}</Text></View>
      <View style={styles.right}><Text style={styles.amount}>{formatMoney(target.remainingUsd)}</Text><Text style={styles.meta}>remaining</Text></View>
    </View>
    <View style={styles.cardBottom}>
      <StatusBadge word={target.status}/>
      <Text style={styles.meta}>Paid {formatMoney(target.paidUsd)} of {formatMoney(target.totalUsd)}</Text>
    </View>
  </Pressable>;
}

/** One real payment: amount, date, method, how it was applied, and what stayed unallocated. */
export function PaymentCard({payment,children}:{payment:AccountPayment;children?:ReactNode}){
  const cancelled=payment.status==='Cancelled';
  const how=[paymentMethodLabels[payment.method],payment.reference].filter(Boolean).join(' · ');
  return <View style={[styles.card,cancelled&&styles.cardCancelled]} accessible={!children} accessibilityLabel={`${formatMoney(payment.amountUsd)} paid on ${payment.paymentDate}, ${how}. ${applicationModeLabels[payment.mode]}. Applied to records ${formatMoney(payment.allocatedUsd)}, unallocated ${formatMoney(payment.unallocatedUsd)}. ${payment.status}.`}>
    <View style={styles.cardTop}>
      <View style={styles.flex}>
        <Text style={[styles.cardTitle,cancelled&&styles.struck]}>{formatMoney(payment.amountUsd)}</Text>
        <Text style={styles.meta}>{payment.paymentDate} · {how}</Text>
        <Text style={styles.meta}>{applicationModeLabels[payment.mode]}</Text>
      </View>
      <StatusBadge word={cancelled?'Cancelled':'Active'} label={cancelled?'Cancelled':'Recorded'}/>
    </View>
    {payment.allocations.length?<View style={styles.lines}>{payment.allocations.map(line=><View key={line.paymentEntryId} style={styles.line}>
      <Text style={[styles.lineText,line.status==='Cancelled'&&styles.struck]} numberOfLines={2}>{line.reference}{line.createdAt&&line.createdAt!==payment.createdAt?<Text style={styles.meta}>{`  applied ${line.createdAt.slice(0,10)}`}</Text>:null}</Text>
      <Text style={[styles.lineAmount,line.status==='Cancelled'&&styles.struck]}>{formatMoney(line.amountUsd)}</Text>
    </View>)}</View>:null}
    {!cancelled&&payment.unallocatedUsd>0?<View style={styles.cardBottom}><StatusBadge word="Unallocated"/><Text style={styles.meta}>{formatMoney(payment.unallocatedUsd)} not applied to any record</Text></View>:null}
    {payment.note?<Text style={styles.meta}>Note: {payment.note}</Text>:null}
    {cancelled?<Text style={styles.cancelNote}>Cancelled{payment.cancelledAt?` ${payment.cancelledAt.slice(0,10)}`:''}: {payment.cancellationReason}. Not counted in any total.</Text>:null}
    {children}
  </View>;
}

export function Field({label,value,onChangeText,placeholder,multiline,keyboardType,accessibilityHint}:{label:string;value:string;onChangeText:(value:string)=>void;placeholder?:string;multiline?:boolean;keyboardType?:KeyboardTypeOptions;accessibilityHint?:string}){
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput style={[styles.input,multiline&&styles.multiline]} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#6B7681" multiline={multiline} keyboardType={keyboardType} accessibilityLabel={label} accessibilityHint={accessibilityHint}/>
  </View>;
}

export function Notice({kind,children}:{kind:'error'|'success'|'info';children:ReactNode}){
  return <Text style={[styles.notice,kind==='error'&&styles.noticeError,kind==='success'&&styles.noticeSuccess]} accessibilityRole={kind==='error'?'alert':'text'}>{children}</Text>;
}

export const financeStyles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  content:{padding:20,paddingBottom:48,gap:14},
  meta:{color:BODY_TEXT,fontSize:12,lineHeight:17},
  helper:{color:BODY_TEXT,fontSize:13,lineHeight:19},
  subhead:{color:colors.navy,fontSize:13,fontWeight:'700'},
  row:{flexDirection:'row',gap:10},
  wrapRow:{flexDirection:'row',flexWrap:'wrap',gap:10},
  empty:{color:BODY_TEXT,fontSize:13,lineHeight:19,backgroundColor:colors.surface,borderRadius:12,borderWidth:1,borderColor:SOFT_BORDER,borderStyle:'dashed',padding:14},
});

const styles=StyleSheet.create({
  ...financeStyles,
  pressed:{backgroundColor:'#F7F4EE'},
  header:{flexDirection:'row',alignItems:'center',gap:14},
  back:{minHeight:48,minWidth:48,backgroundColor:colors.surface,paddingHorizontal:14,borderRadius:10,justifyContent:'center',alignItems:'center',borderWidth:1,borderColor:SOFT_BORDER},
  backText:{color:colors.ink,fontWeight:'700'},
  eyebrow:{color:colors.brand,fontSize:11,fontWeight:'900',letterSpacing:1.3},
  title:{color:colors.ink,fontSize:24,fontWeight:'800',marginTop:2},

  badge:{flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:10,paddingVertical:5,borderRadius:14,flexShrink:0,alignSelf:'flex-start'},
  badgeSuccess:{backgroundColor:'#E5F3EC'},badgeWarning:{backgroundColor:'#FFF3D8'},badgeDanger:{backgroundColor:'#FCE8E6'},
  badgeCancelled:{backgroundColor:colors.surface,borderWidth:1,borderColor:'#E7B7B1'},badgeInfo:{backgroundColor:'#EEF3F8'},badgeNeutral:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line},
  dot:{width:6,height:6,borderRadius:3},
  badgeText:{fontSize:12,fontWeight:'700'},

  box:{flexGrow:1,flexBasis:100,minWidth:0,borderRadius:12,paddingHorizontal:12,paddingVertical:11,gap:2},
  boxBilled:{backgroundColor:'#EEF3F8'},boxPaid:{backgroundColor:'#E8F3EC'},boxBalance:{backgroundColor:colors.surface,borderWidth:1.5,borderColor:colors.navy},boxUnallocated:{backgroundColor:'#F6F0E6'},
  boxLabel:{fontSize:12,fontWeight:'700'},
  boxValue:{color:colors.ink,fontSize:18,fontWeight:'800',fontVariant:['tabular-nums']},
  boxValueBalance:{color:colors.navy,fontSize:22},
  boxNote:{color:BODY_TEXT,fontSize:11,fontWeight:'600'},

  section:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:CARD_BORDER,overflow:'hidden'},
  sectionHead:{minHeight:64,flexDirection:'row',alignItems:'center',gap:12,paddingLeft:16,paddingRight:12,paddingVertical:12},
  sectionTitle:{color:colors.ink,fontSize:16,fontWeight:'700'},
  sectionBody:{borderTopWidth:1,borderTopColor:SOFT_BORDER,backgroundColor:'#FAF8F4',padding:10,gap:8},
  toggle:{width:36,height:36,borderRadius:18,borderWidth:1,borderColor:CARD_BORDER,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},
  toggleOpen:{backgroundColor:colors.navy,borderColor:colors.navy},
  toggleGlyph:{color:colors.navy,fontSize:22,lineHeight:24,fontWeight:'500'},toggleGlyphOpen:{color:'#FFF8ED'},

  card:{backgroundColor:colors.surface,borderRadius:12,borderWidth:1,borderColor:SOFT_BORDER,paddingHorizontal:13,paddingVertical:12,gap:8},
  cardCancelled:{backgroundColor:'#FDF8F7',borderColor:'#EFD3CF'},
  cardTop:{flexDirection:'row',alignItems:'flex-start',gap:12},
  cardBottom:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:8},
  cardTitle:{color:colors.ink,fontSize:15,fontWeight:'700'},
  right:{alignItems:'flex-end',flexShrink:0},
  amount:{color:colors.ink,fontSize:16,fontWeight:'800',fontVariant:['tabular-nums']},
  struck:{textDecorationLine:'line-through',color:colors.muted},
  lines:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line,paddingTop:6,gap:4},
  line:{flexDirection:'row',alignItems:'center',gap:10},
  lineText:{flex:1,minWidth:0,color:colors.ink,fontSize:13},
  lineAmount:{color:colors.ink,fontSize:13,fontWeight:'700',fontVariant:['tabular-nums']},
  cancelNote:{color:colors.danger,fontSize:12,lineHeight:17},

  field:{gap:6},
  label:{color:colors.ink,fontSize:13,fontWeight:'700'},
  input:{minHeight:48,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,paddingVertical:11,color:colors.ink,backgroundColor:'#FCFBF8',fontSize:15},
  multiline:{minHeight:72,textAlignVertical:'top'},
  notice:{color:colors.ink,backgroundColor:colors.surface,borderRadius:12,borderWidth:1,borderColor:SOFT_BORDER,padding:12,fontSize:13,lineHeight:19,fontWeight:'600'},
  noticeError:{color:colors.danger,backgroundColor:'#FCE8E6',borderColor:'#F0C3BE'},
  noticeSuccess:{color:'#1F6446',backgroundColor:'#E5F3EC',borderColor:'#BFE0CD'},
});
