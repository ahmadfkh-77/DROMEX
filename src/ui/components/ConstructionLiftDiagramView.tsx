import {useEffect,useMemo,useRef,useState} from 'react';
import {AccessibilityInfo,PanResponder,StyleSheet,Text,View,type LayoutChangeEvent} from 'react-native';

import {
  buildLiftDiagram,describeStonePlacement,liftDragBounds,liftStoneOffsetsFromViewBoxPoint,
  liftStonePositionFromViewBoxPoint,shouldClaimDragGesture,stoneTouchesRegion,viewBoxPointFromTouch,
  DEFAULT_LIFT_STONE_POSITION,LIFT_DIAGRAM_PLANE_LABEL,type LiftDiagramLift,
} from '../../domain/constructionLiftDiagram';
import type {LiftStoneOffsets,LiftStonePosition} from '../../domain/wallConstructionLift';
import {colors,radius} from '../theme';
import {DiagramCanvas} from './DiagramCanvas';

export type StonePlacement={position:LiftStonePosition|null;offsets:LiftStoneOffsets|null};

/**
 * DEC-466 Phase 4. One Lift drawn on screen, optionally with its Stone region draggable by
 * finger. Every conversion from touch to placement lives in domain/constructionLiftDiagram.ts, so the
 * drawn region and the draggable region are computed once and cannot drift apart, and the arithmetic
 * is unit-tested without a renderer. Dragging changes only where the Stone is drawn -- never its
 * recorded volume, and never its measured dimensions in Detailed mode.
 */
export function ConstructionLiftDiagramView({lift,contextLabel,caption,draggable=false,onPlacementChange}:{
  lift:LiftDiagramLift;contextLabel?:string|null;caption?:string;
  /** True only in an editor, once the lift actually has Stone to place. */
  draggable?:boolean;
  /** A preview of the placement, reported once per gesture on release. The screen decides when it is saved. */
  onPlacementChange?:(placement:StonePlacement)=>void;
}){
  const[renderedSize,setRenderedSize]=useState({width:0,height:0});
  const[live,setLive]=useState<StonePlacement|null>(null);
  const[dragging,setDragging]=useState(false);
  const[reducedMotion,setReducedMotion]=useState(false);
  const sizeRef=useRef(renderedSize);sizeRef.current=renderedSize;
  const startedOnStone=useRef(false);

  useEffect(()=>{
    let active=true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(active)setReducedMotion(value);}).catch(()=>{});
    const subscription=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>setReducedMotion(value));
    return()=>{active=false;subscription.remove();};
  },[]);

  // A placement committed elsewhere -- a save, a nudge, a reset, or reopening the screen -- always
  // wins once the gesture in progress here has finished.
  useEffect(()=>{if(!dragging)setLive(null);},[lift.position,lift.offsets,dragging]);

  const effective=live?{...lift,position:live.position,offsets:live.offsets}:lift;
  const diagram=useMemo(()=>buildLiftDiagram(effective,{contextLabel}),[effective,contextLabel]);
  const detailed=lift.offsets!=null;
  const description=describeStonePlacement(effective);

  const panResponder=useMemo(()=>PanResponder.create({
    // Recording the start without claiming leaves a tap, and any scroll that begins elsewhere,
    // completely untouched; only a deliberate movement that began on the Stone becomes a drag.
    onStartShouldSetPanResponderCapture:(event)=>{
      if(!draggable){startedOnStone.current=false;return false;}
      const size=sizeRef.current;
      if(size.width<=0){startedOnStone.current=false;return false;}
      const point=viewBoxPointFromTouch({x:event.nativeEvent.locationX,y:event.nativeEvent.locationY},size,diagram);
      startedOnStone.current=stoneTouchesRegion(point,diagram.dragBounds,lift.position??DEFAULT_LIFT_STONE_POSITION);
      return false;
    },
    onMoveShouldSetPanResponder:(_event,gesture)=>
      draggable&&shouldClaimDragGesture({dx:gesture.dx,dy:gesture.dy,onStone:startedOnStone.current}),
    onPanResponderGrant:()=>setDragging(true),
    onPanResponderMove:(event)=>{
      const size=sizeRef.current;if(size.width<=0)return;
      const point=viewBoxPointFromTouch({x:event.nativeEvent.locationX,y:event.nativeEvent.locationY},size,diagram);
      const bounds=liftDragBounds(lift);
      setLive(detailed
        ?{position:lift.position,offsets:liftStoneOffsetsFromViewBoxPoint(point,lift,bounds)}
        :{position:liftStonePositionFromViewBoxPoint(point,bounds),offsets:null});
    },
    onPanResponderRelease:()=>{setDragging(false);if(live)onPlacementChange?.(live);},
    onPanResponderTerminate:()=>{setDragging(false);setLive(null);},
  }),[draggable,diagram,detailed,lift,live,onPlacementChange]);

  const onLayout=(event:LayoutChangeEvent)=>{
    const{width,height}=event.nativeEvent.layout;
    setRenderedSize({width,height});
  };

  return <View style={styles.frame}>
    <View onLayout={onLayout} {...(draggable?panResponder.panHandlers:{})}
      style={dragging&&!reducedMotion?styles.dragging:dragging?styles.draggingPlain:undefined}
      accessible accessibilityRole="image" accessibilityLabel={description}>
      <DiagramCanvas diagram={diagram}/>
    </View>
    {dragging?<Text style={styles.live} accessibilityLiveRegion="polite">{description}</Text>:null}
    {caption?<Text style={styles.caption}>{caption}</Text>:null}
    {draggable?<Text style={styles.hint} accessibilityElementsHidden importantForAccessibility="no">
      Drag the Stone region, or use the placement controls below. {detailed?LIFT_DIAGRAM_PLANE_LABEL:'Placement is schematic and does not change the recorded volume.'}
    </Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  frame:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:8,gap:6},
  caption:{color:colors.muted,fontSize:11,lineHeight:16},
  hint:{color:colors.muted,fontSize:10,lineHeight:14,fontStyle:'italic'},
  live:{color:colors.resultDark,fontSize:11,lineHeight:16,fontWeight:'700'},
  // Reduced motion still gets the selected outline, just without the opacity change.
  dragging:{opacity:.92,borderWidth:2,borderColor:colors.result,borderRadius:radius.sm},
  draggingPlain:{borderWidth:2,borderColor:colors.result,borderRadius:radius.sm},
});
