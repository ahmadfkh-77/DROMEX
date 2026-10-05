import type {ReactNode} from 'react';
import {LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {BatchStatus} from '../../../domain/fuelBatches';
import {batchStatusLabels} from '../../../domain/fuelBatches';
import type {DayCard,FillSource} from '../../../domain/fuelBatchViews';
import {formatLitres} from '../../../domain/fuelFillForm';
import {colors,radius} from '../../theme';
import {useReducedMotion} from '../ExpandableMenu';

/**
 * DEC-505. The small parts every diesel batch screen shares: the source tag, the status badge, the navy
 * group header, and the day card (Screen D). Text always carries the meaning; colour only repeats it.
 */
export function SourceTag({source}:{source:FillSource}){
  return <Text style={[styles.tag,source.kind==='tank_batch'&&styles.tagTank,source.kind==='station'&&styles.tagStation,(source.kind==='before'||source.kind==='gasoline')&&styles.tagBefore]}>{source.text}</Text>;
}

export function BatchStatusBadge({status}:{status:BatchStatus}){
  return <Text style={[styles.badge,status==='in_use'&&styles.badgeInUse,status==='waiting'&&styles.badgeWaiting,status==='closed'&&styles.badgeClosed,status==='cancelled'&&styles.badgeCancelled]} accessibilityLabel={`Status ${batchStatusLabels[status]}`}>{batchStatusLabels[status]}</Text>;
}

export function SectionTitle({title,detail}:{title:string;detail?:string}){
  return <Text style={styles.section}>{title.toUpperCase()}{detail?<Text style={styles.sectionDetail}>  ·  {detail}</Text>:null}</Text>;
}

/** A navy header that opens a large list. Closed by default; the count and total are always visible. */
export function GroupHeader({title,summary,open,onToggle}:{title:string;summary:string;open:boolean;onToggle:()=>void}){
  const reducedMotion=useReducedMotion();
  return <TouchableOpacity style={styles.group} onPress={()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);onToggle();}} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${title}, ${summary}`}>
    <View style={styles.flex}><Text style={styles.groupTitle}>{title}</Text><Text style={styles.groupSummary}>{summary}</Text></View>
    <Text style={styles.groupExpand}>{open?'−':'+'}</Text>
  </TouchableOpacity>;
}

const typeLabel={project:'PROJECT',company_site:'COMPANY SITE',unassigned:'UNASSIGNED',all:''} as const;
const totalLabel={project:'Project total',company_site:'Site total',unassigned:'Unassigned total',all:''} as const;

/** Screen D. One card per day: every fill of that day inside, grouped by destination unless the screen is already one destination. */
/**
 * A record row inside a day card. Tapping opens the record when the screen allows it; a cancelled record
 * is struck through and tagged with its reason, and never counts in a total.
 */
function RecordRow({first,title,tag,time,detail,splitLine,litresText,cancelled,onPress,accessibilityLabel}:{first:boolean;title:string;tag:ReactNode;time:string;detail:string|null;splitLine?:string|null;litresText:string;cancelled:boolean;onPress?:()=>void;accessibilityLabel:string}){
  const body=<>
    <View style={styles.flex}>
      <Text style={[styles.equipment,cancelled&&styles.struck]}>{title}</Text>
      <View style={styles.meta}>{tag}<Text style={styles.metaText}>{time}</Text>{detail?<Text style={styles.metaText}>{detail}</Text>:null}</View>
      {splitLine?<Text style={styles.split}>{splitLine}</Text>:null}
    </View>
    <Text style={[styles.litres,cancelled&&styles.struck]}>{litresText}</Text>
  </>;
  return onPress
    ?<TouchableOpacity style={[styles.row,!first&&styles.rowDivider]} onPress={onPress} activeOpacity={.7} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint="Opens this record">{body}</TouchableOpacity>
    :<View style={[styles.row,!first&&styles.rowDivider]} accessibilityLabel={accessibilityLabel}>{body}</View>;
}

export function CancelledTag({reason}:{reason:string|null}){
  return <Text style={[styles.tag,styles.tagCancelled]}>Cancelled · {reason??'No reason recorded'}</Text>;
}

export type DayCardExtraGroup={title:string;rows:{id:string;title:string;tag:{kind:'delivery'|'dip'|'cancelled';text:string};time:string;detail:string|null;litresText:string;cancelled:boolean}[]};

/**
 * Screen D. One card per day: every fill of that day inside, grouped by destination unless the screen is
 * already one destination. History adds the day's deliveries and dip readings above the fills and heads
 * the card with the litres in and out.
 */
export function FuelDayCard({card,footer,onSelectRow,extraGroups=[],headerRight}:{card:DayCard;footer?:ReactNode;onSelectRow?:(id:string)=>void;extraGroups?:DayCardExtraGroup[];headerRight?:ReactNode}){
  const press=(id:string)=>onSelectRow?()=>onSelectRow(id):undefined;
  return <View style={styles.day} accessibilityLabel={`${card.label}, day total ${formatLitres(card.total)}`}>
    <View style={styles.dayHead}><Text style={styles.dayDate}>{card.label}</Text>{headerRight??<Text style={styles.dayTotal}>Day total <Text style={styles.dayTotalValue}>{formatLitres(card.total)}</Text></Text>}</View>
    {extraGroups.filter(group=>group.rows.length).map((group,index)=><View key={group.title} style={[styles.groupBody,index>0&&styles.groupDivider]}>
      <Text style={[styles.typeLabel,styles.typeLabelNavy]}>{group.title}</Text>
      {group.rows.map((row,rowIndex)=><RecordRow key={row.id} first={rowIndex===0} title={row.title} time={row.time} detail={row.detail} litresText={row.litresText} cancelled={row.cancelled} onPress={press(row.id)}
        tag={<Text style={[styles.tag,row.tag.kind==='delivery'&&styles.tagDelivery,row.tag.kind==='dip'&&styles.tagDip,row.tag.kind==='cancelled'&&styles.tagCancelled]}>{row.tag.text}</Text>}
        accessibilityLabel={`${row.title}, ${row.tag.text}, ${row.litresText}`}/>)}
    </View>)}
    {card.groups.map((group,index)=><View key={group.key} style={[styles.groupBody,(index>0||extraGroups.some(extra=>extra.rows.length))&&styles.groupDivider]}>
      {group.type!=='all'?<><Text style={styles.typeLabel}>{typeLabel[group.type]}</Text>{group.type!=='unassigned'?<Text style={styles.destination}>{group.name}</Text>:null}</>:null}
      {group.rows.map((row,rowIndex)=><RecordRow key={row.id} first={rowIndex===0} title={row.equipmentLabel} time={row.time} detail={row.detail} splitLine={row.cancelled?null:row.splitLine} litresText={formatLitres(row.litres)} cancelled={row.cancelled} onPress={press(row.id)}
        tag={row.cancelled?<CancelledTag reason={row.cancellationReason}/>:<SourceTag source={row.source}/>}
        accessibilityLabel={`${row.equipmentLabel}, ${row.cancelled?'cancelled':row.source.text}, ${formatLitres(row.litres)}`}/>)}
      {group.type!=='all'?<View style={styles.subtotal}><Text style={styles.subtotalText}>{totalLabel[group.type]}</Text><Text style={styles.subtotalText}>{formatLitres(group.total)}</Text></View>:null}
    </View>)}
    {footer}
  </View>;
}

const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  tag:{alignSelf:'flex-start',fontSize:11,fontWeight:'800',paddingHorizontal:7,paddingVertical:2,borderRadius:6,overflow:'hidden',borderWidth:1},
  tagTank:{color:colors.navy,borderColor:colors.navy},
  tagStation:{color:colors.ink,borderColor:colors.line,backgroundColor:colors.creamSoft},
  tagBefore:{color:'#555555',borderColor:'#D4D4D4',backgroundColor:'#F1F1F1'},
  tagDelivery:{color:colors.navy,borderColor:colors.navy,backgroundColor:'#EAF1F6'},
  tagDip:{color:colors.warning,borderColor:'#F1CF83',backgroundColor:'#FFF4DC'},
  tagCancelled:{color:colors.danger,borderColor:colors.danger},
  struck:{textDecorationLine:'line-through',color:colors.muted},
  typeLabelNavy:{color:colors.navy},
  badge:{fontSize:12,fontWeight:'900',paddingHorizontal:10,paddingVertical:3,borderRadius:999,overflow:'hidden',borderWidth:1.5},
  badgeInUse:{color:'#FFFFFF',backgroundColor:colors.navy,borderColor:colors.navy},
  badgeWaiting:{color:colors.navy,borderColor:colors.navy},
  badgeClosed:{color:'#8A8F98',borderColor:'#8A8F98'},
  badgeCancelled:{color:colors.danger,borderColor:colors.danger},
  section:{color:colors.navy,fontSize:12,fontWeight:'900',letterSpacing:1},
  sectionDetail:{color:colors.muted,fontWeight:'700',letterSpacing:0},
  group:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,paddingVertical:10,borderRadius:radius.md,backgroundColor:colors.navy},
  groupTitle:{color:'#FFFFFF',fontSize:14,fontWeight:'900'},
  groupSummary:{color:'#C9D6E6',fontSize:12,fontWeight:'600',marginTop:2},
  groupExpand:{color:'#FFFFFF',fontSize:20,fontWeight:'900'},
  day:{backgroundColor:colors.surface,borderRadius:radius.lg,borderWidth:1,borderColor:'#E8DED0',overflow:'hidden'},
  dayHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline',flexWrap:'wrap',gap:8,paddingHorizontal:17,paddingVertical:12,backgroundColor:colors.creamSoft,borderBottomWidth:1,borderBottomColor:'#E8DED0'},
  dayDate:{color:colors.ink,fontSize:15,fontWeight:'900'},
  dayTotal:{color:colors.muted,fontSize:13},
  dayTotalValue:{color:colors.ink,fontSize:15,fontWeight:'900',fontVariant:['tabular-nums']},
  groupBody:{paddingHorizontal:17,paddingVertical:12,gap:4},
  groupDivider:{borderTopWidth:1,borderTopColor:'#E8DED0'},
  typeLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1},
  destination:{color:colors.ink,fontSize:14,fontWeight:'900',marginBottom:4},
  row:{flexDirection:'row',alignItems:'flex-start',gap:12,paddingVertical:8},
  rowDivider:{borderTopWidth:1,borderTopColor:'#EFEAE1',borderStyle:'dashed'},
  equipment:{color:colors.ink,fontSize:14,fontWeight:'800'},
  meta:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:6,marginTop:4},
  metaText:{color:colors.muted,fontSize:12},
  split:{color:colors.ink,fontSize:12,marginTop:5,paddingLeft:8,borderLeftWidth:2,borderLeftColor:colors.navy},
  litres:{color:colors.ink,fontSize:15,fontWeight:'900',textAlign:'right',fontVariant:['tabular-nums']},
  subtotal:{flexDirection:'row',justifyContent:'space-between',paddingTop:8,marginTop:4,borderTopWidth:1,borderTopColor:'#E8DED0'},
  subtotalText:{color:colors.ink,fontSize:13,fontWeight:'900',fontVariant:['tabular-nums']},
});
