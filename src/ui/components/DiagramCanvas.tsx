import Svg,{Circle,Defs,Line,Path,Pattern,Polygon,Rect,Text as SvgText} from 'react-native-svg';

import {diagramPatternPath,type DiagramElement,type DiagramPatternDef} from '../../domain/wallDiagram';

/**
 * DEC-466 Phase 4. The one on-screen renderer for a generated diagram element model, shared by the
 * single-lift figure and the foundation/wall stack so the phone drawing and the exported SVG can
 * never drift apart. It draws exactly what the model says and decides nothing itself.
 */
export type DiagramModel={width:number;height:number;elements:DiagramElement[];patterns:DiagramPatternDef[]};

const INK='#17212b';

export function DiagramCanvas({diagram}:{diagram:DiagramModel}){
  return <Svg width="100%" height={undefined} viewBox={`0 0 ${diagram.width} ${diagram.height}`} style={{aspectRatio:diagram.width/diagram.height}}>
    <Defs>
      {diagram.patterns.map(entry=>{
        const path=diagramPatternPath(entry.pattern);
        return <Pattern key={entry.id} id={entry.id} width={6} height={6} patternUnits="userSpaceOnUse">
          <Rect width={6} height={6} fill={entry.fill}/>
          {path?<Path d={path} stroke={INK} strokeWidth={.8} fill={entry.pattern==='dots'?INK:'none'}/>:null}
        </Pattern>;
      })}
    </Defs>
    <Rect x={0} y={0} width={diagram.width} height={diagram.height} fill="#FFFFFF"/>
    {diagram.elements.map((element,index)=>{
      if(element.kind==='rect')return <Rect key={index} x={element.x} y={element.y} width={element.width} height={element.height}
        fill={element.fill} stroke={element.stroke??undefined} strokeWidth={element.stroke?1:0} strokeDasharray={element.dash}/>;
      if(element.kind==='polygon')return <Polygon key={index} points={element.points.map(([x,y])=>`${x},${y}`).join(' ')}
        fill={element.fill} stroke={element.stroke} strokeWidth={element.stroke==='none'?0:1}/>;
      if(element.kind==='line')return <Line key={index} x1={element.x1} y1={element.y1} x2={element.x2} y2={element.y2}
        stroke={element.stroke} strokeWidth={1} strokeDasharray={element.dash}/>;
      if(element.kind==='circle')return <Circle key={index} cx={element.cx} cy={element.cy} r={element.r} fill={element.fill} stroke={element.stroke} strokeWidth={1}/>;
      return <SvgText key={index} x={element.x} y={element.y} fontSize={element.size} fontWeight={element.weight}
        fill={element.fill} textAnchor={element.anchor}>{element.value}</SvgText>;
    })}
  </Svg>;
}
