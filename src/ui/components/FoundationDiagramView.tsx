import {useEffect,useMemo,useRef,useState} from 'react';
import {PanResponder,StyleSheet,Text,View,type LayoutChangeEvent} from 'react-native';
import Svg,{Polygon,Rect,Text as SvgText} from 'react-native-svg';

import {buildFoundationDiagram,stoneCorePositionFromViewBoxPoint,viewBoxPointFromTouch,type FoundationDiagramInput} from '../../domain/wallFoundationDiagram';
import type {StoneCorePosition} from '../../domain/wallFoundation';
import {colors,radius} from '../theme';

/**
 * DEC-461/464. The on-screen twin of the composite foundation's PDF figure, rendered from the same
 * generated element model. In Simple mode, the Stone core can be dragged directly with a finger; the
 * conversion from screen pixels to the diagram's own coordinate space and then to a normalized
 * position lives in `wallFoundationDiagram.ts` so it is unit-tested independently of React Native.
 * Dragging only ever changes where the schematic block is drawn -- never its recorded volume.
 */
export function FoundationDiagramView({input,caption,draggable=false,onDragPosition}:{
  input:FoundationDiagramInput;caption?:string;
  /** True only in composite / simple mode, once the diagram has something to drag. */
  draggable?:boolean;
  /** Committed once per gesture, on release -- not on every intermediate move. */
  onDragPosition?:(position:StoneCorePosition)=>void;
}){
  const[renderedSize,setRenderedSize]=useState({width:0,height:0});
  const[liveDrag,setLiveDrag]=useState<StoneCorePosition|null>(null);
  const[dragging,setDragging]=useState(false);
  const renderedSizeRef=useRef(renderedSize);
  renderedSizeRef.current=renderedSize;

  // A position committed elsewhere (correction, reset, reopening the screen) always wins once the
  // gesture in progress here finishes.
  useEffect(()=>{if(!dragging)setLiveDrag(null);},[input.position,dragging]);

  const effectiveInput=liveDrag?{...input,position:liveDrag}:input;
  const diagram=useMemo(()=>buildFoundationDiagram(effectiveInput),[effectiveInput]);
  const summary=input.mode==='composite'
    ?`Composite foundation drawing. ${input.activeStoneM3>0?`Stone core of ${input.activeStoneM3} cubic metres inside the foundation.`:'No Stone recorded yet.'} Estimated concrete remaining ${input.estimatedConcreteM3} cubic metres.`
    :'Foundation outline. This base uses a single recorded material, not the composite Stone-core model.';

  const panResponder=useMemo(()=>PanResponder.create({
    onStartShouldSetPanResponder:(event)=>{
      if(!draggable)return false;
      const size=renderedSizeRef.current;if(size.width<=0)return false;
      const viewBoxPoint=viewBoxPointFromTouch({x:event.nativeEvent.locationX,y:event.nativeEvent.locationY},size,diagram);
      const bounds=diagram.dragBounds;
      // Only claims the gesture when the touch starts on or near the drawn core, so ordinary page
      // scrolling elsewhere on the screen is never intercepted.
      const margin=Math.min(bounds.coreWidthPx,bounds.coreHeightPx)*.6;
      const position=input.position??{xNorm:.5,yNorm:.5};
      const coreX=bounds.boxLeft+position.xNorm*(bounds.boxWidth-bounds.coreWidthPx),coreY=bounds.boxTop+position.yNorm*(bounds.boxHeight-bounds.coreHeightPx);
      return viewBoxPoint.x>=coreX-margin&&viewBoxPoint.x<=coreX+bounds.coreWidthPx+margin&&viewBoxPoint.y>=coreY-margin&&viewBoxPoint.y<=coreY+bounds.coreHeightPx+margin;
    },
    onMoveShouldSetPanResponder:()=>false,
    onPanResponderGrant:()=>setDragging(true),
    onPanResponderMove:(event)=>{
      const size=renderedSizeRef.current;if(size.width<=0)return;
      const viewBoxPoint=viewBoxPointFromTouch({x:event.nativeEvent.locationX,y:event.nativeEvent.locationY},size,diagram);
      setLiveDrag(stoneCorePositionFromViewBoxPoint(viewBoxPoint,diagram.dragBounds));
    },
    onPanResponderRelease:()=>{
      setDragging(false);
      if(liveDrag)onDragPosition?.(liveDrag);
    },
    onPanResponderTerminate:()=>setDragging(false),
  }),[draggable,diagram,input.position,liveDrag,onDragPosition]);

  const onLayout=(event:LayoutChangeEvent)=>{const{width,height}=event.nativeEvent.layout;setRenderedSize({width,height});};

  return <View style={styles.frame} accessible accessibilityRole="image" accessibilityLabel={summary}>
    <View onLayout={onLayout} {...(draggable?panResponder.panHandlers:{})} style={dragging?styles.dragging:undefined}>
      <Svg width="100%" height={undefined} viewBox={`0 0 ${diagram.width} ${diagram.height}`} style={{aspectRatio:diagram.width/diagram.height}}>
        {diagram.elements.map((element,index)=>{
          if(element.kind==='rect')return <Rect key={index} x={element.x} y={element.y} width={element.width} height={element.height} fill={element.fill} stroke={element.stroke??undefined} strokeWidth={element.stroke?1:0} strokeDasharray={element.dash}/>;
          if(element.kind==='polygon')return <Polygon key={index} points={element.points.map(([x,y])=>`${x},${y}`).join(' ')} fill={element.fill} stroke={element.stroke} strokeWidth={1}/>;
          if(element.kind==='text')return <SvgText key={index} x={element.x} y={element.y} fontSize={element.size} fontWeight={element.weight} fill={element.fill} textAnchor={element.anchor}>{element.value}</SvgText>;
          return null;
        })}
      </Svg>
    </View>
    {caption?<Text style={styles.caption}>{caption}</Text>:null}
    {draggable?<Text style={styles.dragHint} accessibilityElementsHidden importantForAccessibility="no">Drag the Stone core, or use the nudge buttons below.</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  frame:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:8,gap:6},
  caption:{color:colors.muted,fontSize:11,lineHeight:16},
  dragHint:{color:colors.muted,fontSize:10,lineHeight:14,fontStyle:'italic'},
  dragging:{opacity:.92},
});
