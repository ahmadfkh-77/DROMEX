import {ClipPath,Defs,Ellipse,G,Circle,Line,Polygon,Polyline,Rect} from 'react-native-svg';

/**
 * The quarry, asphalt batch plant and concrete batching plant drawings of the DROMEX skyline (DEC-530).
 * Generated from the approved v4 logo sheet; each is drawn flat in four colours so it stays printable and legible small:
 * ink (the main silhouette), acc / acs (orange and its shade) and sh (the lighter shade that rounds the silos and tanks).
 */
export type PlantPalette={ink:string;acc:string;acs:string;sh:string};
export const QUARRY_BOX={width:264,height:150};
export const ASPHALT_BOX={width:260,height:150};
export const CONCRETE_BOX={width:260,height:150};

export function QuarryArt({ink,acc,acs,sh}:PlantPalette){return <>
  <Polygon points="200,146 238,76 264,146" fill={acc} />
  <Polygon points="238,76 264,146 244,146" fill={acs} />
  <G fill={ink}>
    <Polygon points="0,36 32,36 38,56 64,56 70,76 94,76 100,96 116,96 128,146 0,146" />
  </G>
  <G fill={sh}>
    <Rect x="0" y="62" width="60" height="3" />
    <Rect x="0" y="84" width="90" height="3" />
    <Rect x="0" y="106" width="104" height="3" />
    <Rect x="0" y="126" width="116" height="3" />
    <Polygon points="8,48 14,44 20,48" />
    <Polygon points="22,70 30,65 37,70" />
    <Polygon points="52,92 60,87 67,92" />
  </G>
  <G fill={acc}>
    <Rect x="0" y="36" width="32" height="3" />
    <Rect x="38" y="56" width="26" height="3" />
    <Rect x="70" y="76" width="24" height="3" />
    <Rect x="100" y="96" width="16" height="3" />
  </G>
  <Rect x="44" y="50" width="18" height="6" rx="3" fill={sh} />
  <G fill={acc}>
    <Rect x="46" y="42" width="15" height="8" rx="1" />
    <Rect x="54" y="35" width="7" height="8" rx="1" />
    <Polygon points="48,44 40,27 43.5,26 51.5,42" />
    <Polygon points="40,27 32,39 35,41 43,29" />
    <Polygon points="29,37 37,40 34,46 28,44" />
  </G>
  <Rect x="56" y="37" width="4" height="3.5" fill={ink} />
  <Polygon points="130,118 156,118 158,131 132,131" fill={acc} />
  <Polygon points="130,118 156,118 156,121 130,121" fill={acs} />
  <G fill={ink}>
    <Rect x="157" y="121" width="11" height="11" rx="1.5" />
    <Rect x="129" y="131" width="40" height="3.5" />
    <Circle cx="138" cy="140.5" r="5.5" />
    <Circle cx="162" cy="140.5" r="5.5" />
  </G>
  <Rect x="161" y="123.5" width="5" height="4" fill={sh} />
  <Circle cx="138" cy="140.5" r="2" fill={sh} />
  <Circle cx="162" cy="140.5" r="2" fill={sh} />
  <G fill={ink}>
    <Polygon points="172,88 200,88 194,100 178,100" />
    <Rect x="180" y="100" width="13" height="14" />
    <Rect x="172" y="114" width="28" height="2.5" />
    <Rect x="175" y="100" width="3" height="46" />
    <Rect x="195" y="100" width="3" height="46" />
  </G>
  <Rect x="187" y="100" width="6" height="14" fill={sh} />
  <G stroke={ink} strokeWidth="1.6">
    <Line x1="178" y1="118" x2="195" y2="144" />
    <Line x1="195" y1="118" x2="178" y2="144" />
  </G>
  <Polygon points="192,117 234,70 237,72.5 195,119.5" fill={ink} />
  <Polyline points="198,122.1 204,109.4 210,108.7 216,96 222,95.3 228,82.5 234,81.8" fill="none" stroke={ink} strokeWidth="1.5" />
  <Rect x="218" y="92" width="2.5" height="54" fill={ink} />
  <Circle cx="236" cy="71" r="3" fill={ink} />
  </>;}

export function AsphaltArt({ink,acc,acs,sh}:PlantPalette){return <>
  <G fill={sh}>
    <Polygon points="3,100 9,95 15,100" />
    <Polygon points="18,100 24,95 30,100" />
    <Polygon points="33,100 39,95 45,100" />
    <Polygon points="48,100 54,95 60,100" />
  </G>
  <G fill={ink}>
    <Polygon points="2,100 16,100 16,103 12,116 6,116 2,103" />
    <Polygon points="17,100 31,100 31,103 27,116 21,116 17,103" />
    <Polygon points="32,100 46,100 46,103 42,116 36,116 32,103" />
    <Polygon points="47,100 61,100 61,103 57,116 51,116 47,103" />
    <Rect x="0" y="117" width="64" height="3" />
    <Rect x="3" y="120" width="2.5" height="26" />
    <Rect x="30" y="120" width="2.5" height="26" />
    <Rect x="58" y="120" width="2.5" height="26" />
    <Polygon points="60,118 82,96 84.5,98.5 62.5,120.5" />
    <Rect x="70" y="110" width="2.5" height="36" />
  </G>
  <G fill={ink}>
    <Rect x="78" y="86" width="9" height="26" rx="1" />
    <Rect x="80" y="116" width="78" height="4" />
    <Rect x="84" y="120" width="3" height="26" />
    <Rect x="116" y="120" width="3" height="26" />
    <Rect x="150" y="120" width="3" height="26" />
  </G>
  <G transform="rotate(5 115 101)">
    <Rect x="87" y="92" width="56" height="18" rx="3" fill={acc} />
    <Rect x="87" y="103" width="56" height="7" rx="2" fill={acs} />
    <Rect x="95" y="89.5" width="4.5" height="23" rx="1" fill={ink} />
    <Rect x="128" y="89.5" width="4.5" height="23" rx="1" fill={ink} />
  </G>
  <G fill={ink}>
    <Rect x="143" y="96" width="10" height="20" rx="1.5" />
    <Rect x="153" y="102" width="6" height="7" />
    <Rect x="162" y="20" width="7" height="126" />
    <Rect x="160" y="15" width="13" height="8" rx="1" />
    <Rect x="174" y="14" width="38" height="14" />
    <Polygon points="172,14.5 193,6 214,14.5" />
    <Rect x="170" y="28" width="46" height="2.5" />
    <Rect x="177" y="31" width="32" height="22" />
    <Polygon points="180,54 206,54 199,64 187,64" />
    <Rect x="179" y="66" width="28" height="12" rx="1.5" />
    <Rect x="170" y="80" width="46" height="2.5" />
    <Rect x="170" y="74" width="1.5" height="6" />
    <Rect x="214.5" y="74" width="1.5" height="6" />
    <Rect x="175" y="30" width="3" height="116" />
    <Rect x="208" y="30" width="3" height="116" />
  </G>
  <G fill={sh}>
    <Rect x="178" y="18" width="30" height="3" />
    <Rect x="185" y="31" width="1.5" height="22" />
    <Rect x="193" y="31" width="1.5" height="22" />
    <Rect x="201" y="31" width="1.5" height="22" />
    <Rect x="179" y="73" width="28" height="5" />
  </G>
  <Rect x="174" y="22" width="38" height="3" fill={acc} />
  <G stroke={ink} strokeWidth="1.6">
    <Line x1="178" y1="84" x2="208" y2="104" />
    <Line x1="208" y1="84" x2="178" y2="104" />
  </G>
  <Polygon points="180,124 200,124 202,136 182,136" fill={sh} />
  <G fill={ink}>
    <Rect x="202" y="126" width="8" height="10" rx="1.5" />
    <Rect x="180" y="136" width="30" height="3" />
    <Circle cx="186" cy="142" r="4" />
    <Circle cx="205" cy="142" r="4" />
  </G>
  <Rect x="204" y="128" width="4" height="3" fill={sh} />
  <G fill={ink}>
    <Rect x="211" y="60" width="10" height="6" />
    <Rect x="220" y="52" width="24" height="38" />
    <Polygon points="220,52.5 232,46 244,52.5" />
    <Polygon points="220,90 232,90 226,98" />
    <Polygon points="232,90 244,90 238,98" />
    <Rect x="221" y="90" width="2.5" height="32" />
    <Rect x="240.5" y="90" width="2.5" height="32" />
    <Rect x="248" y="4" width="7" height="142" />
    <Rect x="246.5" y="2.5" width="10" height="3" />
    <Rect x="245" y="24" width="13" height="2" />
    <Rect x="214" y="122" width="32" height="18" rx="9" />
    <Rect x="218" y="138" width="4" height="8" />
    <Rect x="238" y="138" width="4" height="8" />
  </G>
  <G fill={sh}>
    <Rect x="228" y="54" width="1.5" height="34" />
    <Rect x="236" y="54" width="1.5" height="34" />
    <Rect x="218" y="132" width="24" height="5" rx="2.5" />
  </G>
  <Rect x="248" y="10" width="7" height="4" fill={acc} />
  </>;}

export function ConcreteArt({ink,acc,acs,sh}:PlantPalette){return <>
  <Defs><ClipPath id="c-drumclip"><Ellipse cx="100" cy="118" rx="17" ry="10" transform="rotate(14 100 118)" /></ClipPath></Defs>
  <G fill={ink}>
    <Rect x="2" y="14" width="20" height="68" rx="2" />
    <Polygon points="2,15 12,9 22,15" />
    <Rect x="8" y="4" width="8" height="6" />
    <Polygon points="2,82 22,82 14,96 10,96" />
    <Rect x="26" y="14" width="20" height="68" rx="2" />
    <Polygon points="26,15 36,9 46,15" />
    <Rect x="32" y="4" width="8" height="6" />
    <Polygon points="26,82 46,82 38,96 34,96" />
    <Rect x="50" y="14" width="20" height="68" rx="2" />
    <Polygon points="50,15 60,9 70,15" />
    <Rect x="56" y="4" width="8" height="6" />
    <Polygon points="50,82 70,82 62,96 58,96" />
    <Rect x="0" y="1.5" width="72" height="1.6" />
    <Rect x="3" y="82" width="2.5" height="64" />
    <Rect x="18.5" y="82" width="2.5" height="64" />
    <Rect x="27" y="82" width="2.5" height="64" />
    <Rect x="42.5" y="82" width="2.5" height="64" />
    <Rect x="51" y="82" width="2.5" height="64" />
    <Rect x="66.5" y="82" width="2.5" height="64" />
  </G>
  <G fill={sh}>
    <Rect x="15" y="16" width="6" height="66" />
    <Rect x="39" y="16" width="6" height="66" />
    <Rect x="63" y="16" width="6" height="66" />
  </G>
  <G fill={acc}>
    <Rect x="2" y="24" width="20" height="4" />
    <Rect x="26" y="24" width="20" height="4" />
    <Rect x="50" y="24" width="20" height="4" />
  </G>
  <G stroke={ink} strokeWidth="1.3">
    <Line x1="5" y1="104" x2="19" y2="144" />
    <Line x1="19" y1="104" x2="5" y2="144" />
    <Line x1="29" y1="104" x2="43" y2="144" />
    <Line x1="43" y1="104" x2="29" y2="144" />
    <Line x1="53" y1="104" x2="67" y2="144" />
    <Line x1="67" y1="104" x2="53" y2="144" />
  </G>
  <G fill={ink}>
    <Polygon points="34,95 92,68 93.5,71 35.5,97.6" />
    <Polygon points="58,94 94,62 96,64.5 60,96.5" />
    <Rect x="88" y="52" width="40" height="28" />
    <Polygon points="86,52.5 108,42 130,52.5" />
    <Rect x="116" y="38" width="12" height="9" rx="2" />
    <Rect x="82" y="80" width="52" height="2.5" />
    <Rect x="82" y="74" width="1.5" height="6" />
    <Rect x="132.5" y="74" width="1.5" height="6" />
    <Polygon points="102,82.5 114,82.5 111,90 105,90" />
    <Rect x="88" y="82" width="3" height="64" />
    <Rect x="125" y="82" width="3" height="64" />
  </G>
  <Rect x="94" y="58" width="14" height="8" fill={acc} />
  <Rect x="114" y="58" width="9" height="16" fill={sh} />
  <G stroke={ink} strokeWidth="1.6">
    <Line x1="91" y1="84" x2="125" y2="100" />
    <Line x1="125" y1="84" x2="91" y2="100" />
  </G>
  <Ellipse cx="100" cy="118" rx="17" ry="10" transform="rotate(14 100 118)" fill={acc} />
  <G clipPath="url(#c-drumclip)" stroke={acs} strokeWidth="2.4">
    <Line x1="94" y1="102" x2="89" y2="130" />
    <Line x1="103" y1="104" x2="98" y2="132" />
    <Line x1="112" y1="106" x2="107" y2="134" />
  </G>
  <G fill={ink}>
    <Rect x="83" y="121" width="4" height="12" />
    <Rect x="118" y="116" width="14" height="17" rx="2" />
    <Rect x="82" y="132" width="52" height="4" />
    <Circle cx="89" cy="141" r="5" />
    <Circle cx="101" cy="141" r="5" />
    <Circle cx="125" cy="141" r="5" />
  </G>
  <G fill={sh}>
    <Rect x="124" y="119" width="6" height="6" />
    <Circle cx="89" cy="141" r="1.8" />
    <Circle cx="101" cy="141" r="1.8" />
    <Circle cx="125" cy="141" r="1.8" />
  </G>
  <Polygon points="128,46 256,134 256,142 128,54" fill={ink} />
  <Polygon points="134,51.8 252,133 252,135 134,53.8" fill={sh} />
  <Rect x="168.5" y="82" width="2.5" height="64" fill={ink} />
  <Rect x="191.5" y="97" width="2.5" height="49" fill={ink} />
  <G fill={sh}>
    <Polygon points="149,124 158,116 167,124" />
    <Polygon points="172,124 181,116 190,124" />
    <Polygon points="195,124 204,116 213,124" />
  </G>
  <G fill={ink}>
    <Polygon points="148,124 168,124 168,127 162,136 154,136 148,127" />
    <Polygon points="171,124 191,124 191,127 185,136 177,136 171,127" />
    <Polygon points="194,124 214,124 214,127 208,136 200,136 194,127" />
    <Rect x="146" y="137" width="110" height="3" />
    <Rect x="149" y="140" width="2.5" height="6" />
    <Rect x="211" y="140" width="2.5" height="6" />
  </G>
  </>;}
