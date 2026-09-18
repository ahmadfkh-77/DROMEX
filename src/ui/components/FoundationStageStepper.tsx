import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {colors,radius} from '../theme';

export type FoundationStageKey='foundation'|'curing'|'wall'|'layers'|'history';
export const FOUNDATION_STAGES:{key:FoundationStageKey;title:string}[]=[
  {key:'foundation',title:'Foundation'},
  {key:'curing',title:'Curing'},
  {key:'wall',title:'Wall'},
  {key:'layers',title:'Layers and Materials'},
  {key:'history',title:'History and Reports'},
];

/**
 * DEC-464. Checkpoint 4's five organizational stages. Unlike the earlier per-wall base stepper,
 * every stage here is always tappable: these are never curing locks (DEC-463) -- only informational
 * "current" and "attention" markers, plus a completed check. Vertical/compact, never a row of tiny
 * horizontal labels, so it stays legible on a phone.
 */
export function FoundationStageStepper({active,completed,attention,onSelect}:{
  active:FoundationStageKey;completed:Set<FoundationStageKey>;attention?:FoundationStageKey|null;onSelect:(stage:FoundationStageKey)=>void;
}){
  return <View style={styles.list} accessibilityRole="tablist">
    {FOUNDATION_STAGES.map((stage,index)=>{
      const isActive=stage.key===active,isDone=completed.has(stage.key),needsAttention=attention===stage.key&&!isActive;
      return <TouchableOpacity key={stage.key} style={[styles.row,isActive&&styles.rowActive]} onPress={()=>onSelect(stage.key)} accessibilityRole="tab" accessibilityState={{selected:isActive}}>
        <View style={[styles.marker,isActive&&styles.markerActive,isDone&&styles.markerDone]}>
          <Text style={[styles.markerText,(isActive||isDone)&&styles.markerTextOn]}>{isDone?'✓':index+1}</Text>
        </View>
        <View style={styles.labelWrap}>
          <Text style={[styles.label,isActive&&styles.labelActive]}>{stage.title}</Text>
          {needsAttention?<Text style={styles.attention}>Needs attention</Text>:null}
        </View>
      </TouchableOpacity>;
    })}
  </View>;
}

const styles=StyleSheet.create({
  list:{gap:4},
  row:{flexDirection:'row',alignItems:'center',gap:10,minHeight:48,paddingHorizontal:10,borderRadius:radius.sm},
  rowActive:{backgroundColor:'#EAF1F6'},
  marker:{width:26,height:26,borderRadius:13,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.line,backgroundColor:colors.surface},
  markerActive:{borderColor:colors.navy,backgroundColor:colors.navy},
  markerDone:{borderColor:colors.success,backgroundColor:colors.success},
  markerText:{color:colors.muted,fontSize:12,fontWeight:'900'},
  markerTextOn:{color:'#FFFFFF'},
  labelWrap:{flex:1,minWidth:0},
  label:{color:colors.ink,fontSize:13,fontWeight:'800'},
  labelActive:{color:colors.navy,fontWeight:'900'},
  attention:{color:colors.warning,fontSize:10,fontWeight:'800'},
});
