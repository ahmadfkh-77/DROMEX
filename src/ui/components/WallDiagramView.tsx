import {useMemo} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import Svg,{Circle,Defs,Line,Path,Pattern,Polygon,Rect,Text as SvgText} from 'react-native-svg';

import {buildWallDiagram,diagramPatternPath,type WallDiagramInput} from '../../domain/wallDiagram';
import {colors,radius} from '../theme';

/**
 * DEC-457. The on-screen twin of the PDF figure: both render the same generated element model, so the
 * phone preview and the exported drawing can never disagree. Nothing is fetched and no bitmap is used.
 */
export function WallDiagramView({input,caption}:{input:WallDiagramInput;caption?:string}){
  const diagram=useMemo(()=>buildWallDiagram(input),[input]);
  const summary=diagram.legend.length
    ?`Wall diagram with ${diagram.legend.length} layer${diagram.legend.length===1?'':'s'}: ${diagram.legend.map(entry=>`phase ${entry.phase} ${entry.name}`).join(', ')}.`
    :'Wall diagram showing the elevation and cross-section with no layers recorded.';

  return <View style={styles.frame} accessible accessibilityRole="image" accessibilityLabel={summary}>
    <Svg width="100%" height={undefined} viewBox={`0 0 ${diagram.width} ${diagram.height}`} style={{aspectRatio:diagram.width/diagram.height}}>
      <Defs>
        {diagram.patterns.map(entry=>{
          const path=diagramPatternPath(entry.pattern);
          return <Pattern key={entry.id} id={entry.id} width={6} height={6} patternUnits="userSpaceOnUse">
            <Rect width={6} height={6} fill={entry.fill}/>
            {path?<Path d={path} stroke="#17212b" strokeWidth={0.8} fill={entry.pattern==='dots'?'#17212b':'none'}/>:null}
          </Pattern>;
        })}
      </Defs>
      {diagram.elements.map((element,index)=>{
        if(element.kind==='rect')return <Rect key={index} x={element.x} y={element.y} width={element.width} height={element.height} fill={element.fill} stroke={element.stroke??undefined} strokeWidth={element.stroke?1:0} strokeDasharray={element.dash}/>;
        if(element.kind==='polygon')return <Polygon key={index} points={element.points.map(([x,y])=>`${x},${y}`).join(' ')} fill={element.fill} stroke={element.stroke} strokeWidth={1}/>;
        if(element.kind==='line')return <Line key={index} x1={element.x1} y1={element.y1} x2={element.x2} y2={element.y2} stroke={element.stroke} strokeWidth={1} strokeDasharray={element.dash}/>;
        if(element.kind==='circle')return <Circle key={index} cx={element.cx} cy={element.cy} r={element.r} fill={element.fill} stroke={element.stroke} strokeWidth={1}/>;
        return <SvgText key={index} x={element.x} y={element.y} fontSize={element.size} fontWeight={element.weight} fill={element.fill} textAnchor={element.anchor}>{element.value}</SvgText>;
      })}
    </Svg>
    {caption?<Text style={styles.caption}>{caption}</Text>:null}
    {diagram.exaggerated?<Text style={styles.note}>Thin layers are drawn wider than scale so they stay visible. The listed thicknesses are the recorded values.</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  frame:{backgroundColor:'#FFFFFF',borderWidth:1,borderColor:colors.line,borderRadius:radius.md,padding:8,gap:6},
  caption:{color:colors.muted,fontSize:11,lineHeight:16},
  note:{color:colors.brandDark,fontSize:11,lineHeight:16,fontWeight:'700'},
});
