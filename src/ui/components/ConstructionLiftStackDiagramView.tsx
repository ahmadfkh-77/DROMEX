import {StyleSheet,Text,View} from 'react-native';

import type {StackDiagram} from '../../domain/cyclopeanLiftDiagram';
import {colors,radius} from '../theme';
import {DiagramCanvas} from './DiagramCanvas';

/**
 * DEC-466 Phase 4. The ordered lift stack for a foundation, a wall, or the two combined. Read-only:
 * placement is only ever changed in the Stone editor, never from an overview, so nothing here claims
 * a touch gesture.
 */
export function CyclopeanStackDiagramView({diagram,caption,compact=false}:{
  diagram:StackDiagram;caption?:string;
  /** A summary on an overview screen: the drawing only, with the surrounding explanation left to the screen. */
  compact?:boolean;
}){
  const summary=`${diagram.bands.length} lift${diagram.bands.length===1?'':'s'} drawn in construction order.`
    +(diagram.overAllocated?' The lifts exceed the available structural envelope.':diagram.unallocated>0?` ${diagram.unallocated} cubic metres remain unallocated.`:'');
  return <View style={[styles.frame,compact&&styles.compact]}>
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <DiagramCanvas diagram={diagram}/>
    </View>
    {!compact&&caption?<Text style={styles.caption}>{caption}</Text>:null}
    {diagram.exaggerated&&!compact?<Text style={styles.note}>Thin Stone regions are drawn wider than scale so they stay visible. The listed measurements are the recorded ones.</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  frame:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:8,gap:6},
  compact:{padding:6},
  caption:{color:colors.muted,fontSize:11,lineHeight:16},
  note:{color:colors.brandDark,fontSize:11,lineHeight:16},
});
