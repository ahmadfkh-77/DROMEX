import {useState,type ReactNode} from 'react';
import {LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {describeWallConsumptionQuantity,formatWallArea,supportsCoveredArea,wallConsumptionPurposeLabel,wallMaterialLabels,type WallConsumption} from '../../domain/walls';
import {colors,radius} from '../theme';
import {AppButton,EmptyState} from './AppPrimitives';
import {useReducedMotion} from './ExpandableMenu';

const dateTime=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?value:date.toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});};
const shown=(value:string|null)=>value??'not recorded';

/**
 * DEC-452. Consumption history: each record opens to its full detail and correction trail, and offers
 * "Correct This Record", which renders the correction form in place under that record.
 */
export function WallConsumptionHistory({entries,renderCorrection}:{entries:WallConsumption[];renderCorrection:(entry:WallConsumption,close:()=>void)=>ReactNode}){
  const[openId,setOpenId]=useState<string|null>(null),[correctingId,setCorrectingId]=useState<string|null>(null);
  const reducedMotion=useReducedMotion();
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};
  if(!entries.length)return <EmptyState title="No consumed materials yet" body="Record the first concrete, site mix, rebar, or stone entry in section 2."/>;

  return <View style={styles.list}>{entries.map(entry=>{
    const open=openId===entry.id,correcting=correctingId===entry.id,purpose=wallConsumptionPurposeLabel(entry),corrections=entry.correctionHistory.length;
    const title=purpose??wallMaterialLabels[entry.type];
    return <View key={entry.id} style={[styles.entry,correcting&&styles.entryCorrecting]}>
      <TouchableOpacity style={styles.summary} onPress={()=>{animate();setOpenId(open?null:entry.id);if(open)setCorrectingId(null);}} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`${title}, ${entry.usedOn}, ${describeWallConsumptionQuantity(entry)}`} accessibilityHint={open?'Hides the record details':'Shows the record details and correction options'}>
        <View style={styles.flex}>
          <View style={styles.topLine}>
            <Text style={styles.title} numberOfLines={2}>{title}</Text>
            <Text style={styles.date}>{entry.usedOn}</Text>
          </View>
          <Text style={styles.quantity}>{describeWallConsumptionQuantity(entry)}</Text>
          <View style={styles.metaLine}>
            {supportsCoveredArea(entry.type)?<Text style={entry.area?styles.area:styles.areaMissing}>{entry.area?`${formatWallArea(entry.area.netAreaM2)} covered`:formatWallArea(null)}</Text>:null}
            {corrections?<Text style={styles.correctedTag}>{corrections===1?'Corrected':`Corrected ${corrections} times`}</Text>:null}
          </View>
        </View>
        <Text style={styles.chevron}>{open?'Hide':'Details'}</Text>
      </TouchableOpacity>

      {open?<View style={styles.details}>
        <Detail label="Material" value={wallMaterialLabels[entry.type]}/>
        {purpose?<Detail label="Purpose" value={purpose} note={entry.customPurposeId?'Saved purpose':undefined}/>:null}
        <Detail label="Consumed" value={describeWallConsumptionQuantity(entry)}/>
        {supportsCoveredArea(entry.type)?entry.area
          ?<View style={styles.areaBlock}>
            <Text style={styles.detailLabel}>Covered wall area</Text>
            <Text style={styles.detailValue}>{entry.area.lengthM} m × {entry.area.heightM} m = {formatWallArea(entry.area.grossAreaM2)} gross</Text>
            <Text style={styles.detailValue}>Openings {formatWallArea(entry.area.deductionM2)} · Net {formatWallArea(entry.area.netAreaM2)}</Text>
          </View>
          :<Detail label="Covered wall area" value={formatWallArea(null)}/>:null}
        {entry.notes?<Detail label="Notes" value={entry.notes}/>:null}
        <Detail label="Recorded" value={dateTime(entry.createdAt)}/>
        {corrections?<View style={styles.trail}>
          <Text style={styles.trailTitle}>Correction history</Text>
          {[...entry.correctionHistory].reverse().map((correction,index)=><View key={`${correction.correctedAt}-${index}`} style={styles.trailItem}>
            <Text style={styles.trailWhen}>{dateTime(correction.correctedAt)} · {correction.reason}</Text>
            {correction.changes.map(change=><Text key={change.field} style={styles.trailChange}>{change.field}: {shown(change.originalValue)} → {shown(change.newValue)}</Text>)}
          </View>)}
        </View>:null}
        {correcting
          ?<View style={styles.correction}>
            <Text style={styles.correctionTitle}>Correct this record</Text>
            <Text style={styles.correctionHelp}>Change the values that were wrong. The record keeps its identity, and the reason plus every changed value is added to its history.</Text>
            {renderCorrection(entry,()=>{animate();setCorrectingId(null);})}
          </View>
          :<AppButton label="Correct This Record" tone="secondary" onPress={()=>{animate();setCorrectingId(entry.id);}} hint="Opens a prefilled correction form"/>}
      </View>:null}
    </View>;
  })}</View>;
}

function Detail({label,value,note}:{label:string;value:string;note?:string}){
  return <View style={styles.detail}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}{note?<Text style={styles.detailNote}>{`  ${note}`}</Text>:null}</Text></View>;
}

const styles=StyleSheet.create({
  list:{gap:10},
  flex:{flex:1,minWidth:0},
  entry:{backgroundColor:colors.surface,borderRadius:radius.md,borderLeftWidth:4,borderLeftColor:colors.result,overflow:'hidden'},
  entryCorrecting:{borderLeftColor:colors.navy},
  summary:{minHeight:64,padding:13,flexDirection:'row',alignItems:'center',gap:10},
  topLine:{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start',gap:10},
  title:{flex:1,color:colors.ink,fontSize:14,fontWeight:'900'},
  date:{color:colors.brandDark,fontSize:11,fontWeight:'900',fontVariant:['tabular-nums']},
  quantity:{color:colors.resultDark,fontSize:13,fontWeight:'900',lineHeight:19,marginTop:3},
  metaLine:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:8,marginTop:3},
  area:{color:colors.ink,fontSize:12,fontWeight:'800'},
  areaMissing:{color:colors.muted,fontSize:12,fontWeight:'700',fontStyle:'italic'},
  correctedTag:{color:colors.navy,fontSize:11,fontWeight:'900',borderWidth:1,borderColor:'#B9C9D8',borderRadius:6,paddingHorizontal:6,paddingVertical:1},
  chevron:{color:colors.navy,fontSize:12,fontWeight:'900',minWidth:44,textAlign:'right'},
  details:{borderTopWidth:1,borderTopColor:colors.line,padding:13,gap:9,backgroundColor:'#FFFEFC'},
  detail:{gap:1},
  detailLabel:{color:colors.muted,fontSize:11,fontWeight:'800'},
  detailValue:{color:colors.ink,fontSize:13,fontWeight:'700',lineHeight:19},
  detailNote:{color:colors.muted,fontSize:11,fontWeight:'700'},
  areaBlock:{gap:1,backgroundColor:colors.resultSoft,borderRadius:10,padding:10},
  trail:{gap:7,borderTopWidth:1,borderTopColor:colors.line,paddingTop:9},
  trailTitle:{color:colors.ink,fontSize:13,fontWeight:'900'},
  trailItem:{gap:2},
  trailWhen:{color:colors.ink,fontSize:12,fontWeight:'800',lineHeight:17},
  trailChange:{color:colors.muted,fontSize:12,lineHeight:17},
  correction:{gap:8,borderTopWidth:1,borderTopColor:colors.line,paddingTop:11},
  correctionTitle:{color:colors.navy,fontSize:15,fontWeight:'900'},
  correctionHelp:{color:colors.muted,fontSize:12,lineHeight:17},
});
