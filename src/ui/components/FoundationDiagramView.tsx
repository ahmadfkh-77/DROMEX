import {useMemo} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import Svg,{Polygon,Rect,Text as SvgText} from 'react-native-svg';

import {buildFoundationDiagram,type FoundationDiagramInput} from '../../domain/wallFoundationDiagram';
import {colors,radius} from '../theme';

/**
 * DEC-461. The on-screen twin of the composite foundation's PDF figure, rendered from the same
 * generated element model as FoundationDiagramView's caption text below.
 */
export function FoundationDiagramView({input,caption}:{input:FoundationDiagramInput;caption?:string}){
  const diagram=useMemo(()=>buildFoundationDiagram(input),[input]);
  const summary=input.mode==='composite'
    ?`Composite foundation drawing. ${input.activeStoneM3>0?`Stone core of ${input.activeStoneM3} cubic metres inside the foundation.`:'No Stone recorded yet.'} Estimated concrete remaining ${input.estimatedConcreteM3} cubic metres.`
    :'Foundation outline. This base uses a single recorded material, not the composite Stone-core model.';

  return <View style={styles.frame} accessible accessibilityRole="image" accessibilityLabel={summary}>
    <Svg width="100%" height={undefined} viewBox={`0 0 ${diagram.width} ${diagram.height}`} style={{aspectRatio:diagram.width/diagram.height}}>
      {diagram.elements.map((element,index)=>{
        if(element.kind==='rect')return <Rect key={index} x={element.x} y={element.y} width={element.width} height={element.height} fill={element.fill} stroke={element.stroke??undefined} strokeWidth={element.stroke?1:0} strokeDasharray={element.dash}/>;
        if(element.kind==='polygon')return <Polygon key={index} points={element.points.map(([x,y])=>`${x},${y}`).join(' ')} fill={element.fill} stroke={element.stroke} strokeWidth={1}/>;
        if(element.kind==='text')return <SvgText key={index} x={element.x} y={element.y} fontSize={element.size} fontWeight={element.weight} fill={element.fill} textAnchor={element.anchor}>{element.value}</SvgText>;
        return null;
      })}
    </Svg>
    {caption?<Text style={styles.caption}>{caption}</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  frame:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:8,gap:6},
  caption:{color:colors.muted,fontSize:11,lineHeight:16},
});
