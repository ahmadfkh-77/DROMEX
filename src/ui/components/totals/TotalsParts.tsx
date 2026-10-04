import type {ReactNode} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';

import {inclusionLabel,type InclusionState} from '../../../domain/businessDocuments';
import {summarizeInclusionCounts,type InclusionCounts,type RecordedValue,type TotalsView,type UnitMeasures} from '../../../domain/companyTotals';
import {formatTotalQuantity} from '../../../domain/projectTotals';
import {colors} from '../../theme';
import {formatRecordedAt,inclusionTone,recordMoneyLine,recordReferences,recordTitle,recordedValueLine,unitFigures} from '../../totalsPresentation';
import type {CompanyTotalsRecord} from '../../../data/repositories/CompanyTotalsRepository';

/**
 * DEC-500. The building blocks of every totals level: one Structural Navy summary band per level
 * (not a stack of cards), a ruled ledger list of rows on one surface, and record rows that state their
 * document status in words. Delivered keeps DEC-484's cool tint and label, Used its warm one.
 */

/** The navy band that heads a level: where you are, its per-unit totals, records, status and value. */
export function SummaryBand({trail,title,units,view,usageHidden,inclusion,value,lead,children}:{trail:string[];title:string;
  /** Omitted at the top level, where different materials cannot share one unit table. */
  units?:UnitMeasures[];view:TotalsView;usageHidden:boolean;inclusion:InclusionCounts|null;value:RecordedValue|null;lead?:string;children?:ReactNode}){
  const rows=units?unitFigures(units,view,usageHidden):[];
  const showDelivered=view!=='used',showUsed=view!=='delivered'&&!usageHidden;
  return <View style={styles.band}>
    {trail.length?<Text style={styles.trail} numberOfLines={2}>{trail.join('  ›  ')}</Text>:null}
    <Text style={styles.bandTitle} accessibilityRole="header">{title}</Text>
    {lead?<Text style={styles.bandLead}>{lead}</Text>:null}
    {!units?null:rows.length?<View style={styles.bandTable} accessible accessibilityLabel={rows.map(row=>[showDelivered?`Delivered ${row.delivered}`:null,showUsed?`Used ${row.used}`:null].filter(Boolean).join(', ')).join('; ')}>
      <View style={styles.bandRow}>
        <Text style={[styles.bandHead,styles.unitCol]}>Unit</Text>
        {showDelivered?<Text style={[styles.bandHead,styles.figureCol]}>Delivered</Text>:null}
        {showUsed?<Text style={[styles.bandHead,styles.figureCol]}>Used</Text>:null}
      </View>
      {rows.map(row=><View key={row.unitKey} style={styles.bandRow}>
        <Text style={[styles.bandUnit,styles.unitCol]}>{row.unitSymbol}</Text>
        {showDelivered?<Text style={[styles.bandFigure,styles.figureCol,row.delivered==='Not recorded'&&styles.bandMissing]}>{row.delivered}</Text>:null}
        {showUsed?<Text style={[styles.bandFigure,styles.figureCol,row.used==='Not recorded'&&styles.bandMissing]}>{row.used}</Text>:null}
      </View>)}
    </View>:<Text style={styles.bandEmpty}>Nothing recorded for these filters.</Text>}
    {inclusion&&inclusion.total?<Text style={styles.bandMeta}>{summarizeInclusionCounts(inclusion)}</Text>:null}
    {value?<Text style={styles.bandMeta}>{recordedValueLine(value)}</Text>:null}
    {children?<View style={styles.bandActions}>{children}</View>:null}
  </View>;
}

/**
 * A titled list. By default one grouped surface holding ruled rows; `separate` gives every row its own
 * card with space between (rows then pass `card`), as Totals uses so items never run together.
 */
export function Ledger({title,note,separate=false,children}:{title:string;note?:string;separate?:boolean;children:ReactNode}){
  return <View style={styles.ledgerBlock}>
    <Text style={styles.ledgerTitle} accessibilityRole="header">{title}</Text>
    {note?<Text style={styles.ledgerNote}>{note}</Text>:null}
    <View style={separate?styles.ledgerSeparate:styles.ledger}>{children}</View>
  </View>;
}

/** A tappable ledger row: name, aligned per-unit figures, and the status/value line. */
export function LedgerRow({name,tag,units,view,usageHidden=false,inclusion,value,first,card=false,onPress,hint}:{name:string;tag?:string;units:UnitMeasures[];view:TotalsView;usageHidden?:boolean;inclusion?:InclusionCounts|null;value?:RecordedValue|null;first:boolean;card?:boolean;onPress:()=>void;hint:string}){
  const rows=unitFigures(units,view,usageHidden);
  const showDelivered=view!=='used',showUsed=view!=='delivered'&&!usageHidden;
  const spoken=`${name}${tag?`, ${tag}`:''}. ${rows.map(row=>[showDelivered?`Delivered ${row.delivered}`:null,showUsed?`Used ${row.used}`:null].filter(Boolean).join(', ')).join('; ')}${inclusion?`. ${summarizeInclusionCounts(inclusion)}`:''}`;
  return <Pressable onPress={onPress} style={({pressed})=>[styles.row,card?styles.card:!first&&styles.rowRule,pressed&&styles.pressed]} android_ripple={{color:'#EFE9DF'}} accessibilityRole="button" accessibilityLabel={spoken} accessibilityHint={hint}>
    <View style={styles.rowHead}>
      <View style={styles.flex}>
        <Text style={styles.rowName}>{name}</Text>
        {tag?<Text style={styles.rowTag}>{tag}</Text>:null}
      </View>
      <Text style={styles.chevron} importantForAccessibility="no">›</Text>
    </View>
    <View style={styles.figures}>
      {rows.map(row=><View key={row.unitKey} style={styles.figureLine}>
        {showDelivered?<View style={[styles.figureCell,styles.deliveredCell]}><Text style={styles.figureLabelDelivered}>Delivered</Text><Text style={[styles.figure,row.delivered==='Not recorded'&&styles.missing]}>{row.delivered}</Text></View>:null}
        {showUsed?<View style={[styles.figureCell,styles.usedCell]}><Text style={styles.figureLabelUsed}>Used</Text><Text style={[styles.figure,row.used==='Not recorded'&&styles.missing]}>{row.used}</Text></View>:null}
      </View>)}
    </View>
    {inclusion&&inclusion.total?<Text style={styles.rowMeta}>{summarizeInclusionCounts(inclusion)}</Text>:null}
    {value?<Text style={styles.rowMeta}>{recordedValueLine(value)}</Text>:null}
  </Pressable>;
}

/** A row for a recorded-use or transported figure, which opens its Daily Report records. */
export function MeasureRow({label,quantity,unitSymbol,recordCount,first,card=false,onPress}:{label:string;quantity:number;unitSymbol:string;recordCount:number;first:boolean;card?:boolean;onPress:()=>void}){
  return <Pressable onPress={onPress} style={({pressed})=>[styles.measure,card?styles.card:!first&&styles.rowRule,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={`${label}: ${formatTotalQuantity(quantity,unitSymbol)}, ${recordCount} records. View Daily Reports.`}>
    <View style={styles.flex}><Text style={styles.measureLabel}>{label}</Text><Text style={styles.rowMeta}>{recordCount} record{recordCount===1?'':'s'} · Daily Reports</Text></View>
    <Text style={styles.measureValue}>{formatTotalQuantity(quantity,unitSymbol)}</Text>
    <Text style={styles.chevron} importantForAccessibility="no">›</Text>
  </Pressable>;
}

/** A document status in words, with a dot so it never depends on colour alone. */
export function InclusionPill({state}:{state:InclusionState}){
  const tone=inclusionTone(state);
  return <View style={[styles.pill,pillTone[tone]]}><View style={[styles.pillDot,dotTone[tone]]}/><Text style={[styles.pillText,pillText[tone]]} numberOfLines={2}>{inclusionLabel(state)}</Text></View>;
}

/** One original record: load number or Supplier Load number first, then when, where, who, money, status. */
export function RecordRow({record,first,card=false,selectable=false,selected=false,onToggle,onOpen}:{record:CompanyTotalsRecord;first:boolean;card?:boolean;selectable?:boolean;selected?:boolean;onToggle?:()=>void;onOpen:()=>void}){
  const snap=record.snapshot;
  const legacy=snap.recordType==='company_load'&&!snap.loadNumber;
  const where=[snap.projectName??'No project',snap.recordType==='company_load'?`Customer ${snap.partyName}`:snap.partyName].join(' · ');
  return <View style={[styles.record,card?styles.card:!first&&styles.rowRule]}>
    {selectable?<Pressable onPress={onToggle} style={styles.checkTarget} accessibilityRole="checkbox" accessibilityState={{checked:selected}} accessibilityLabel={`Select ${recordTitle(snap)}`}>
      <View style={[styles.check,selected&&styles.checkOn]}>{selected?<Text style={styles.checkMark}>✓</Text>:null}</View>
    </Pressable>:null}
    <Pressable onPress={onOpen} style={({pressed})=>[styles.recordBody,pressed&&styles.pressed]} accessibilityRole="button" accessibilityHint="Opens the original record"
      accessibilityLabel={`${recordTitle(snap)}. ${snap.itemName}, ${formatTotalQuantity(snap.quantity,snap.unitSymbol)}. ${formatRecordedAt(snap.recordedAt)}. ${where}. ${recordMoneyLine(snap)}. ${inclusionLabel(record.inclusion)}.`}>
      <View style={styles.recordTop}>
        <Text style={[styles.recordTitle,legacy&&styles.recordLegacy]} numberOfLines={2}>{recordTitle(snap)}</Text>
        <Text style={styles.recordQty}>{formatTotalQuantity(snap.quantity,snap.unitSymbol)}</Text>
      </View>
      <Text style={styles.recordLine}>{snap.itemName} · {formatRecordedAt(snap.recordedAt)}</Text>
      <Text style={styles.recordLine}>{where}</Text>
      <Text style={styles.recordRef}>{recordReferences(snap)}</Text>
      <Text style={[styles.recordMoney,snap.unitPriceCents==null&&styles.missing]}>{recordMoneyLine(snap)}</Text>
      <View style={styles.recordFoot}>
        <InclusionPill state={record.inclusion}/>
        {record.correctionCount?<Text style={styles.history}>Corrected {record.correctionCount}×</Text>:null}
        {record.status==='Cancelled'?<Text style={styles.cancelled}>Cancelled{record.cancellationReason?` — ${record.cancellationReason}`:''}</Text>:null}
      </View>
    </Pressable>
  </View>;
}

export function QuietButton({label,onPress,hint,disabled=false}:{label:string;onPress:()=>void;hint?:string;disabled?:boolean}){
  return <Pressable onPress={onPress} disabled={disabled} style={({pressed})=>[styles.quiet,pressed&&styles.quietPressed,disabled&&styles.disabled]} accessibilityRole="button" accessibilityHint={hint} accessibilityState={{disabled}}><Text style={styles.quietText}>{label}</Text></Pressable>;
}

const pillTone=StyleSheet.create({open:{backgroundColor:colors.surface,borderColor:colors.line},draft:{backgroundColor:'#EEF3F8',borderColor:'#C9D7E6'},included:{backgroundColor:'#E5F3EC',borderColor:'#B9DCCA'},history:{backgroundColor:colors.surface,borderColor:colors.line,borderStyle:'dashed'}});
const dotTone=StyleSheet.create({open:{backgroundColor:colors.muted},draft:{backgroundColor:colors.navy},included:{backgroundColor:colors.success},history:{backgroundColor:'#A9B1B8'}});
const pillText=StyleSheet.create({open:{color:'#4F5B66'},draft:{color:colors.navy},included:{color:'#1F6145'},history:{color:'#4F5B66'}});

export const styles=StyleSheet.create({
  flex:{flex:1,minWidth:0},
  pressed:{backgroundColor:'#F7F4EE'},
  disabled:{opacity:.4},
  missing:{color:'#5A6570',fontStyle:'italic',fontWeight:'400'},
  chevron:{color:colors.navy,fontSize:22,fontWeight:'600'},

  band:{backgroundColor:colors.navy,borderRadius:16,paddingHorizontal:16,paddingTop:14,paddingBottom:14,gap:8},
  trail:{color:'#C9D7E6',fontSize:12,fontWeight:'600'},
  bandTitle:{color:'#FFF8ED',fontSize:22,lineHeight:27,fontWeight:'800'},
  bandTable:{gap:4,marginTop:2,paddingTop:8,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:'rgba(255,255,255,0.3)'},
  bandRow:{flexDirection:'row',alignItems:'baseline',gap:8},
  bandHead:{color:'#C9D7E6',fontSize:12,fontWeight:'700'},
  bandUnit:{color:'#D5E4EF',fontSize:14,fontWeight:'700'},
  bandFigure:{color:'#FFF8ED',fontSize:17,fontWeight:'700',fontVariant:['tabular-nums']},
  bandMissing:{color:'#C9D7E6',fontSize:13,fontStyle:'italic',fontWeight:'400'},
  unitCol:{width:44},
  figureCol:{flex:1,minWidth:0,textAlign:'right'},
  bandEmpty:{color:'#D5E4EF',fontSize:14},
  bandLead:{color:'#FFF8ED',fontSize:15,fontWeight:'600'},
  bandMeta:{color:'#D5E4EF',fontSize:13,lineHeight:18},
  bandActions:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:4},

  ledgerBlock:{gap:8},
  ledgerTitle:{color:colors.ink,fontSize:17,fontWeight:'800'},
  ledgerNote:{color:'#4F5B66',fontSize:13,lineHeight:19},
  ledger:{backgroundColor:colors.surface,borderRadius:16,borderWidth:1,borderColor:'#E3DBCD',overflow:'hidden'},
  ledgerSeparate:{gap:10},
  card:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:'#D9CFBE',overflow:'hidden',shadowColor:'#17212B',shadowOpacity:.05,shadowRadius:4,shadowOffset:{width:0,height:2},elevation:1},
  row:{paddingHorizontal:16,paddingVertical:12,gap:8},
  rowRule:{borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:colors.line},
  rowHead:{flexDirection:'row',alignItems:'center',gap:10},
  rowName:{color:colors.ink,fontSize:16,lineHeight:21,fontWeight:'700'},
  rowTag:{color:colors.brandDark,fontSize:12,fontWeight:'600',marginTop:1},
  rowMeta:{color:'#4F5B66',fontSize:12,lineHeight:17},
  figures:{gap:6},
  figureLine:{flexDirection:'row',gap:8},
  figureCell:{flex:1,minWidth:0,borderRadius:10,paddingHorizontal:10,paddingVertical:7},
  deliveredCell:{backgroundColor:'#EEF3F8'},
  usedCell:{backgroundColor:'#F6F0E6'},
  figureLabelDelivered:{color:colors.navy,fontSize:11,fontWeight:'700'},
  figureLabelUsed:{color:'#6E4B1F',fontSize:11,fontWeight:'700'},
  figure:{color:colors.ink,fontSize:16,fontWeight:'700',fontVariant:['tabular-nums'],marginTop:1},

  measure:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:16,paddingVertical:10},
  measureLabel:{color:colors.ink,fontSize:14,fontWeight:'600'},
  measureValue:{color:colors.ink,fontSize:16,fontWeight:'700',fontVariant:['tabular-nums']},

  pill:{flexDirection:'row',alignItems:'center',gap:6,borderWidth:1,borderRadius:999,paddingHorizontal:10,paddingVertical:4,alignSelf:'flex-start',maxWidth:'100%'},
  pillDot:{width:6,height:6,borderRadius:3},
  pillText:{fontSize:12,fontWeight:'600',flexShrink:1},

  record:{flexDirection:'row',alignItems:'stretch'},
  checkTarget:{width:52,alignItems:'center',paddingTop:14},
  check:{width:26,height:26,borderRadius:7,borderWidth:2,borderColor:colors.navy,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface},
  checkOn:{backgroundColor:colors.navy},
  checkMark:{color:'#FFF8ED',fontSize:15,fontWeight:'800'},
  recordBody:{flex:1,minWidth:0,paddingHorizontal:16,paddingVertical:12,gap:3},
  recordTop:{flexDirection:'row',alignItems:'flex-start',gap:10},
  recordTitle:{flex:1,minWidth:0,color:colors.ink,fontSize:15,fontWeight:'700',fontVariant:['tabular-nums']},
  recordLegacy:{color:'#4F5B66',fontSize:13,fontWeight:'600',fontStyle:'italic'},
  recordQty:{color:colors.ink,fontSize:16,fontWeight:'800',fontVariant:['tabular-nums']},
  recordLine:{color:'#4F5B66',fontSize:13,lineHeight:18},
  recordRef:{color:colors.muted,fontSize:12,lineHeight:17},
  recordMoney:{color:colors.ink,fontSize:13,lineHeight:18,fontWeight:'600'},
  recordFoot:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8,marginTop:5},
  history:{color:colors.warning,fontSize:12,fontWeight:'600'},
  cancelled:{color:colors.danger,fontSize:12,fontWeight:'600'},

  quiet:{minHeight:48,borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.45)',paddingHorizontal:14,justifyContent:'center'},
  quietPressed:{backgroundColor:'rgba(255,255,255,0.12)'},
  quietText:{color:'#FFF8ED',fontSize:14,fontWeight:'700'},
});
