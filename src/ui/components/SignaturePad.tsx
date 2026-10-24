import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

/**
 * `large` (DEC-524, Make Receipt) is a taller pad. It draws in its own shape (one scale for both directions, so nothing
 * stretches); the caller fits the strokes into the printed 320 x 140 box with fitSignatureToBox before saving.
 */
export function SignaturePad({ value, onChange, onSigningChange, hint = 'Driver signs here', large = false }: { value: string[]; onChange: (paths: string[]) => void; onSigningChange?: (signing: boolean) => void; hint?: string; large?: boolean }) {
  const [current, setCurrent] = useState(''); const currentRef = useRef(''); const size = useRef({ width: 320, height: 140 });
  const [viewHeight, setViewHeight] = useState(140);
  // Touches near the walls can report points outside the pad, or relative to a child; every point is clamped into the pad so the line can never jump.
  const clamp = (value: number, max: number) => Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), max);
  const point = (rawX: number, rawY: number) => { const x = clamp(rawX, size.current.width), y = clamp(rawY, size.current.height); return large ? `${(x / size.current.width * 320).toFixed(1)} ${(y / size.current.width * 320).toFixed(1)}` : `${(x / size.current.width * 320).toFixed(1)} ${(y / size.current.height * 140).toFixed(1)}`; };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true, onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => { onSigningChange?.(true); const path = `M ${point(event.nativeEvent.locationX, event.nativeEvent.locationY)}`; currentRef.current = path; setCurrent(path); },
    onPanResponderMove: (event) => { const path = `${currentRef.current} L ${point(event.nativeEvent.locationX, event.nativeEvent.locationY)}`; currentRef.current = path; setCurrent(path); },
    onPanResponderRelease: () => { if (currentRef.current) onChange([...value, currentRef.current]); currentRef.current = ''; setCurrent(''); onSigningChange?.(false); },
    onPanResponderTerminate: () => { currentRef.current = ''; setCurrent(''); onSigningChange?.(false); },
  }), [value, onChange, onSigningChange, large]);
  return <View style={styles.wrapper}><View style={[styles.pad, large && styles.padLarge]} onLayout={(event) => { const layout = event.nativeEvent.layout; size.current = layout; if (large && layout.width) setViewHeight(Math.round(layout.height / layout.width * 320)); }} {...pan.panHandlers}><Svg pointerEvents="none" width="100%" height="100%" viewBox={`0 0 320 ${large ? viewHeight : 140}`}>{value.map((path,index)=><Path key={`${index}-${path.length}`} d={path} fill="none" stroke="#17212B" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}{current?<Path d={current} fill="none" stroke="#17212B" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>:null}</Svg><Text pointerEvents="none" style={styles.hint}>{hint}</Text></View><TouchableOpacity style={styles.clear} onPress={()=>onChange([])}><Text style={styles.clearText}>Clear signature</Text></TouchableOpacity></View>;
}
const styles=StyleSheet.create({wrapper:{gap:8},pad:{height:150,borderWidth:1,borderColor:colors.line,borderRadius:12,backgroundColor:'#FFF',overflow:'hidden'},padLarge:{height:240},hint:{position:'absolute',bottom:7,alignSelf:'center',color:'#9AA3AA',fontSize:11},clear:{alignSelf:'flex-start',paddingVertical:7},clearText:{color:colors.danger,fontWeight:'800'}});
