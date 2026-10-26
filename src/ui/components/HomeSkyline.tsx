import {Image,StyleSheet,Text,View} from 'react-native';
import Svg,{G,Rect} from 'react-native-svg';

import {resolveSkylineStyle,type SkylineStyle} from '../../domain/appearance';
import {AsphaltArt,ASPHALT_BOX,ConcreteArt,CONCRETE_BOX,QuarryArt,QUARRY_BOX,type PlantPalette} from './plantArt';

/** The plant drawings keep the logo's own navy and orange (DEC-530); they are a picture, not app chrome. */
const onLight:PlantPalette={ink:'#0B2A5B',acc:'#F2620F',acs:'#B8420A',sh:'#2F5A96'};
const onNavy:PlantPalette={ink:'#FFFFFF',acc:'#F2620F',acs:'#C4470C',sh:'#AFC0DA'};
const GROUND_Y=146;
const GAP=8;
const SKYLINE_WIDTH=QUARRY_BOX.width+GAP+ASPHALT_BOX.width+GAP+CONCRETE_BOX.width;
const SKYLINE_HEIGHT=GROUND_Y+5;

export const SKYLINE_LABEL='DROMEX plants: quarry, asphalt plant and concrete plant';

function FullSkyline({palette}:{palette:PlantPalette}){
  return <>
    <G><QuarryArt {...palette}/></G>
    <G transform={`translate(${QUARRY_BOX.width+GAP} 0)`}><AsphaltArt {...palette}/></G>
    <G transform={`translate(${QUARRY_BOX.width+GAP+ASPHALT_BOX.width+GAP} 0)`}><ConcreteArt {...palette}/></G>
    <Rect x="0" y={GROUND_Y} width={SKYLINE_WIDTH} height="5" rx="1" fill={palette.acc}/>
  </>;
}

function Single({style,palette}:{style:'asphalt'|'concrete'|'quarry';palette:PlantPalette}){
  return style==='asphalt'?<AsphaltArt {...palette}/>:style==='concrete'?<ConcreteArt {...palette}/>:<QuarryArt {...palette}/>;
}

const singleBox={asphalt:ASPHALT_BOX,concrete:CONCRETE_BOX,quarry:QUARRY_BOX} as const;

/**
 * The picture under the logo on Home, and the small previews on the Appearance screen (`compact`). It is drawn with SVG so it stays sharp
 * on every phone and works offline. `hidden` draws nothing at all, so the header closes up.
 */
export function HomeSkyline({style,image,compact=false}:{style:SkylineStyle;image:string|null;compact?:boolean}){
  const shown=resolveSkylineStyle(style,image);
  if(shown==='hidden')return null;
  const previewHeight=compact?46:undefined;

  if(shown==='custom'&&image)return <Image source={{uri:image}} style={compact?styles.previewImage:styles.customImage} resizeMode="contain" accessibilityLabel="Your Home picture" accessibilityRole="image"/>;

  if(shown==='full'||shown==='banner'){
    const palette=shown==='banner'?onNavy:onLight;
    const art=<Svg width="100%" height={previewHeight} style={compact?undefined:{aspectRatio:SKYLINE_WIDTH/SKYLINE_HEIGHT}} viewBox={`0 0 ${SKYLINE_WIDTH} ${SKYLINE_HEIGHT}`} preserveAspectRatio="xMidYMid meet" accessibilityLabel={SKYLINE_LABEL}><FullSkyline palette={palette}/></Svg>;
    if(shown==='full')return art;
    return <View style={[styles.banner,compact&&styles.bannerCompact]}>{art}{compact?null:<Text style={styles.bannerTag} importantForAccessibility="no">ASPHALT · CONCRETE · QUARRY</Text>}</View>;
  }

  if(shown==='custom')return null;
  const box=singleBox[shown];
  return <View style={compact?styles.fullWidth:styles.singleWrap}>
    <Svg width="100%" height={previewHeight??104} viewBox={`0 0 ${box.width} ${SKYLINE_HEIGHT}`} preserveAspectRatio="xMidYMax meet" accessibilityLabel={SKYLINE_LABEL}><Single style={shown} palette={onLight}/></Svg>
    {compact?null:<View style={styles.ground}/>}
  </View>;
}

const styles=StyleSheet.create({
  banner:{backgroundColor:'#0B2A5B',borderRadius:19,paddingHorizontal:14,paddingTop:16,paddingBottom:12,gap:8},
  bannerCompact:{width:'100%',borderRadius:8,padding:4},
  fullWidth:{width:'100%'},
  bannerTag:{color:'#F2A184',fontWeight:'700',fontSize:11,letterSpacing:3,textAlign:'center'},
  singleWrap:{gap:0},
  ground:{height:5,borderRadius:1,backgroundColor:'#F2620F'},
  customImage:{width:'100%',height:104},
  previewImage:{width:'100%',height:46},
});
