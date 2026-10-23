import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {ContractItem,ContractUsage} from '../../../domain/contractQuantities';
import {colors} from '../../theme';

/** Display only: every figure comes from the domain usage (DEC-522); these helpers format, they never calculate. */
export const contractAmount=(value:number)=>String(Number(value.toFixed(3)));
export const contractPercent=(usage:Pick<ContractUsage,'percentUsed'>)=>`${usage.percentUsed.toFixed(1)}%`;
export const contractUsd=(value:number)=>`$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const shortDay=(day:string)=>{const[year,month,date]=day.split('-').map(Number) as [number,number,number];return new Date(year,month-1,date).toLocaleDateString('en-GB',{day:'2-digit',month:'short'});};
export const contractDay=(day:string)=>{const[year,month,date]=day.split('-').map(Number) as [number,number,number];return new Date(year,month-1,date).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});};

export type ContractTone='progress'|'near'|'over'|'done'|'cancelled';
export function contractTone(item:ContractItem,usage:ContractUsage):ContractTone{
  if(item.cancelledAt)return 'cancelled';
  if(item.status==='complete')return 'done';
  if(usage.warning==='over')return 'over';
  if(usage.warning==='near'||usage.warning==='full')return 'near';
  return 'progress';
}
export function contractPillText(item:ContractItem,usage:ContractUsage):string{
  const tone=contractTone(item,usage);
  if(tone==='cancelled')return 'Cancelled';
  if(tone==='done')return 'Complete';
  if(tone==='over')return 'Over contract';
  if(usage.warning==='full')return `${contractPercent(usage)} · at the limit`;
  if(tone==='near')return `${contractPercent(usage)} · near limit`;
  return contractPercent(usage);
}

export function ContractPill({item,usage}:{item:ContractItem;usage:ContractUsage}){
  const tone=contractTone(item,usage);
  return <Text style={[styles.pill,pillTone[tone]]}>{contractPillText(item,usage)}</Text>;
}

/** The bar never draws past its end; over contract is said in words and in the Over by box, never by a longer bar. */
export function ContractBar({item,usage}:{item:ContractItem;usage:ContractUsage}){
  const tone=contractTone(item,usage);
  const width=`${Math.min(100,Math.max(0,usage.percentUsed))}%` as const;
  return <View style={styles.bar} accessibilityRole="progressbar" accessibilityLabel={`${contractPercent(usage)} of the contract quantity used`}>
    <View style={[styles.barFill,{width},barTone[tone]]}/>
    {tone==='near'||tone==='progress'?<View style={styles.barMark}/>:null}
  </View>;
}

/** Allowed / Used / Remaining (or Over by, or Leftover for a finished item). */
export function ContractFigures({item,usage}:{item:ContractItem;usage:ContractUsage}){
  const unit=item.unitSymbol;
  const third=usage.overContract?{label:'Over by',value:usage.overBy,tone:styles.overValue}:item.status==='complete'?{label:'Leftover',value:usage.leftover,tone:styles.doneValue}:{label:'Remaining',value:usage.remaining,tone:null};
  return <View style={styles.figures}>
    <Figure label="Allowed" value={`${contractAmount(usage.allowed)} ${unit}`}/>
    <Figure label="Used" value={`${contractAmount(usage.used)} ${unit}`} strong/>
    <Figure label={third.label} value={`${contractAmount(third.value)} ${unit}`} valueStyle={third.tone}/>
  </View>;
}
function Figure({label,value,strong=false,valueStyle}:{label:string;value:string;strong?:boolean;valueStyle?:object|null}){
  return <View style={styles.figure}><Text style={styles.figureLabel}>{label.toUpperCase()}</Text><Text style={[styles.figureValue,strong&&styles.figureStrong,valueStyle??null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View>;
}

/** Honesty rule: the work status and the quantity used are two separate boxes, never one number. */
export function ContractWorkAndUse({item,usage}:{item:ContractItem;usage:ContractUsage}){
  if(item.status!=='complete'||!item.completedOn)return null;
  return <View style={styles.two}>
    <View style={[styles.statusBox,styles.workBox]}><Text style={[styles.statusLabel,styles.workText]}>WORK</Text><Text style={[styles.statusValue,styles.workText]}>Complete · {shortDay(item.completedOn)}</Text></View>
    <View style={[styles.statusBox,styles.useBox]}><Text style={[styles.statusLabel,styles.useText]}>QUANTITY USED</Text><Text style={[styles.statusValue,styles.useText]}>{contractPercent(usage)} of contract</Text></View>
  </View>;
}

export function ContractItemCard({item,usage,materialLine,onPress}:{item:ContractItem;usage:ContractUsage;materialLine:string;onPress:()=>void}){
  const tone=contractTone(item,usage);
  return <TouchableOpacity style={[styles.card,cardTone[tone]]} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${item.name}, ${contractPillText(item,usage)}, ${contractAmount(usage.used)} of ${contractAmount(usage.allowed)} ${item.unitSymbol} used`}>
    <View style={styles.head}><View style={styles.flex}><Text style={styles.name}>{item.name}</Text><Text style={styles.materials} numberOfLines={2}>{materialLine}</Text></View><ContractPill item={item} usage={usage}/></View>
    <ContractBar item={item} usage={usage}/>
    {item.status==='complete'?<ContractWorkAndUse item={item} usage={usage}/>:<ContractFigures item={item} usage={usage}/>}
    {usage.lateLoads.length?<Text style={styles.flag}>A load was added after this item was finished.</Text>:null}
  </TouchableOpacity>;
}

const pillTone=StyleSheet.create({progress:{backgroundColor:'#E8EDF3',color:colors.navy},near:{backgroundColor:'#FFF4DC',color:'#8A5300',borderColor:'#EFC979',borderWidth:1},over:{backgroundColor:'#FDECEA',color:'#A61B12',borderColor:'#F0ABA4',borderWidth:1},done:{backgroundColor:'#E6F4EA',color:'#17693B',borderColor:'#A9D8B8',borderWidth:1},cancelled:{backgroundColor:'#ECE9E2',color:colors.muted}});
const barTone=StyleSheet.create({progress:{backgroundColor:colors.navy},near:{backgroundColor:'#C98A1A'},over:{backgroundColor:'#A61B12'},done:{backgroundColor:'#17693B'},cancelled:{backgroundColor:'#B9B2A6'}});
const cardTone=StyleSheet.create({progress:{},near:{borderColor:'#EFC979'},over:{borderColor:'#F0ABA4'},done:{borderColor:'#A9D8B8'},cancelled:{opacity:.7}});
const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:16,padding:14,gap:10},
  head:{flexDirection:'row',alignItems:'flex-start',gap:10},
  name:{color:colors.ink,fontSize:16,fontWeight:'800'},
  materials:{color:colors.muted,fontSize:12,marginTop:2},
  pill:{fontSize:11,fontWeight:'800',paddingHorizontal:9,paddingVertical:4,borderRadius:999,overflow:'hidden'},
  bar:{height:12,borderRadius:99,backgroundColor:'#ECE7DD',overflow:'hidden',position:'relative'},
  barFill:{position:'absolute',left:0,top:0,bottom:0,borderRadius:99},
  barMark:{position:'absolute',left:'90%',top:0,bottom:0,width:2,backgroundColor:colors.ink,opacity:.45},
  figures:{flexDirection:'row',gap:6},
  figure:{flex:1,minWidth:0,borderRadius:10,paddingVertical:8,paddingHorizontal:6,backgroundColor:colors.background,alignItems:'center'},
  figureLabel:{color:colors.muted,fontSize:10.5,fontWeight:'800',letterSpacing:.6},
  figureValue:{color:colors.ink,fontSize:16,fontWeight:'800',marginTop:2},
  figureStrong:{color:colors.navy},
  overValue:{color:'#A61B12'},
  doneValue:{color:'#17693B'},
  two:{flexDirection:'row',gap:6},
  statusBox:{flex:1,borderRadius:10,paddingVertical:8,paddingHorizontal:10},
  statusLabel:{fontSize:10.5,fontWeight:'800',letterSpacing:.6},
  statusValue:{fontSize:15,fontWeight:'800',marginTop:2},
  workBox:{backgroundColor:'#E6F4EA'},workText:{color:'#17693B'},
  useBox:{backgroundColor:'#E8EDF3'},useText:{color:colors.navy},
  flag:{backgroundColor:'#FFF4DC',borderColor:'#EFC979',borderWidth:1,borderRadius:12,padding:10,color:'#5E3A00',fontSize:13,lineHeight:19,overflow:'hidden'},
});
