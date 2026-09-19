import {useEffect,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {
  describeStonePlacement,nudgeLiftStoneOffsets,nudgeLiftStonePosition,offsetTextMatchesValue,parseOffsetText,
  resetLiftStoneOffsets,resetLiftStonePosition,validateLiftStoneOffsets,
  LIFT_DIAGRAM_PLANE_LABEL,LIFT_NUDGE_STEP_M,LIFT_NUDGE_STEP_NORM,
  type LiftDiagramLift,type NudgeDirection,
} from '../../domain/constructionLiftDiagram';
import type {LiftStoneOffsets,LiftStonePosition} from '../../domain/wallConstructionLift';
import {AppField,Feedback} from './AppPrimitives';
import {colors,radius} from '../theme';

const offsetText=(value:number)=>Number.isFinite(value)?String(value):'';
const offsetTexts=(offsets:LiftStoneOffsets|null)=>({
  longitudinalOffsetM:offsetText(offsets?.longitudinalOffsetM??Number.NaN),
  verticalOffsetM:offsetText(offsets?.verticalOffsetM??Number.NaN),
  transverseOffsetM:offsetText(offsets?.transverseOffsetM??Number.NaN),
});

const directions:{direction:NudgeDirection;glyph:string;label:string}[]=[
  {direction:'left',glyph:'←',label:'Move Stone left'},
  {direction:'right',glyph:'→',label:'Move Stone right'},
  {direction:'up',glyph:'↑',label:'Move Stone up'},
  {direction:'down',glyph:'↓',label:'Move Stone down'},
];

/**
 * DEC-466 Phase 4. The placement controls that make dragging optional rather than required: a nudge
 * pad, a reset, and -- in Detailed mode -- typed offsets in metres, including the transverse axis the
 * drawn elevation deliberately does not represent. Every value is produced by the same clamped domain
 * functions the drag gesture uses, so the two routes can never disagree.
 */
export function StonePlacementControls({lift,position,offsets,onPosition,onOffsets,onSwitchMode}:{
  lift:LiftDiagramLift;position:LiftStonePosition|null;offsets:LiftStoneOffsets|null;
  onPosition:(value:LiftStonePosition)=>void;onOffsets:(value:LiftStoneOffsets)=>void;
  /** Offered only when measured Stone dimensions exist, since Detailed mode has nothing to place without them. */
  onSwitchMode?:(detailed:boolean)=>void;
}){
  const detailed=offsets!=null;
  const current={...lift,position,offsets};
  const issues=detailed?validateLiftStoneOffsets(offsets,current):[];

  // DEC-469. The typed offsets are held as text and only committed once parsed. Re-rendering
  // String(Number(text)) on every keystroke used to erase the decimal point as soon as it was typed,
  // which made a value like 0.5 impossible to enter at all.
  const[text,setText]=useState(()=>offsetTexts(offsets));
  useEffect(()=>{
    if(!offsets)return;
    setText(currentText=>({
      longitudinalOffsetM:offsetTextMatchesValue(currentText.longitudinalOffsetM,offsets.longitudinalOffsetM)?currentText.longitudinalOffsetM:offsetText(offsets.longitudinalOffsetM),
      verticalOffsetM:offsetTextMatchesValue(currentText.verticalOffsetM,offsets.verticalOffsetM)?currentText.verticalOffsetM:offsetText(offsets.verticalOffsetM),
      transverseOffsetM:offsetTextMatchesValue(currentText.transverseOffsetM,offsets.transverseOffsetM)?currentText.transverseOffsetM:offsetText(offsets.transverseOffsetM),
    }));
  },[offsets]);

  const nudge=(direction:NudgeDirection)=>{
    if(detailed)onOffsets(nudgeLiftStoneOffsets(offsets,direction,current));
    else onPosition(nudgeLiftStonePosition(position??{xNorm:.5,yNorm:.5},direction));
  };
  const reset=()=>{if(detailed)onOffsets(resetLiftStoneOffsets(current));else onPosition(resetLiftStonePosition());};
  const editOffset=(key:keyof LiftStoneOffsets)=>(value:string)=>{
    setText(current=>({...current,[key]:value}));
    onOffsets({...offsets!,[key]:parseOffsetText(value)});
  };
  const stepLabel=detailed?`${LIFT_NUDGE_STEP_M} m`:`${Math.round(LIFT_NUDGE_STEP_NORM*100)}%`;

  return <View style={styles.panel}>
    <View style={styles.headerRow}>
      <Text style={styles.title}>Stone placement</Text>
      <Text style={styles.step}>Step {stepLabel}</Text>
    </View>
    <Text style={styles.description} accessibilityLiveRegion="polite">{describeStonePlacement(current)}</Text>

    <View style={styles.pad}>
      {directions.map(entry=><TouchableOpacity key={entry.direction} style={styles.key} onPress={()=>nudge(entry.direction)}
        accessibilityRole="button" accessibilityLabel={`${entry.label} by ${stepLabel}`}>
        <Text style={styles.glyph}>{entry.glyph}</Text>
      </TouchableOpacity>)}
      <TouchableOpacity style={styles.reset} onPress={reset} accessibilityRole="button" accessibilityLabel="Reset the Stone placement to the centre of the lift">
        <Text style={styles.resetText}>{detailed?'Reset Position':'Reset to Centre'}</Text>
      </TouchableOpacity>
    </View>

    {onSwitchMode&&lift.stoneGeometry?<TouchableOpacity style={styles.mode} onPress={()=>onSwitchMode(!detailed)}
      accessibilityRole="button" accessibilityLabel={detailed?'Switch to schematic placement':'Switch to measured placement in metres'}>
      <Text style={styles.modeText}>{detailed?'Use schematic placement instead':'Place using measured offsets (metres)'}</Text>
    </TouchableOpacity>:null}

    {detailed?<View style={styles.fields}>
      <Text style={styles.plane}>{LIFT_DIAGRAM_PLANE_LABEL}</Text>
      <AppField label="Offset along the lift (m)" value={text.longitudinalOffsetM} onChangeText={editOffset('longitudinalOffsetM')} keyboardType="decimal-pad"/>
      <AppField label="Offset above the lift base (m)" value={text.verticalOffsetM} onChangeText={editOffset('verticalOffsetM')} keyboardType="decimal-pad"/>
      <AppField label="Transverse offset (m) — not shown on this plane" value={text.transverseOffsetM} onChangeText={editOffset('transverseOffsetM')} keyboardType="decimal-pad"/>
      {issues.length?<Feedback kind="error">{issues.join(' ')}</Feedback>:null}
      <Text style={styles.note}>Measured Stone dimensions are never changed by placing it.</Text>
    </View>:null}
  </View>;
}

const styles=StyleSheet.create({
  panel:{gap:8,padding:12,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,backgroundColor:colors.surface},
  headerRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  title:{color:colors.ink,fontSize:14,fontWeight:'900'},
  step:{color:colors.muted,fontSize:11,fontWeight:'700'},
  description:{color:colors.muted,fontSize:12,lineHeight:17},
  pad:{flexDirection:'row',flexWrap:'wrap',gap:8},
  key:{minWidth:56,minHeight:48,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:radius.sm,backgroundColor:colors.creamSoft},
  glyph:{color:colors.ink,fontSize:19,fontWeight:'900'},
  reset:{minWidth:132,minHeight:48,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.result,borderRadius:radius.sm,paddingHorizontal:12},
  resetText:{color:colors.resultDark,fontSize:13,fontWeight:'900'},
  mode:{minHeight:44,justifyContent:'center'},
  modeText:{color:colors.resultDark,fontSize:13,fontWeight:'800',textDecorationLine:'underline'},
  fields:{gap:8},
  plane:{color:colors.muted,fontSize:11,lineHeight:16},
  note:{color:colors.muted,fontSize:11,lineHeight:16,fontStyle:'italic'},
});
