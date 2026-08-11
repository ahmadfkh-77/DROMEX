import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme';

export function SignaturePad({ value, onChange, onSigningChange }: { value: string[]; onChange: (paths: string[]) => void; onSigningChange?: (signing: boolean) => void }) {
  const [current, setCurrent] = useState(''); const currentRef = useRef(''); const size = useRef({ width: 320, height: 140 });
  const point = (x: number, y: number) => `${(x / size.current.width * 320).toFixed(1)} ${(y / size.current.height * 140).toFixed(1)}`;
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true, onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => { onSigningChange?.(true); const path = `M ${point(event.nativeEvent.locationX, event.nativeEvent.locationY)}`; currentRef.current = path; setCurrent(path); },
    onPanResponderMove: (event) => { const path = `${currentRef.current} L ${point(event.nativeEvent.locationX, event.nativeEvent.locationY)}`; currentRef.current = path; setCurrent(path); },
    onPanResponderRelease: () => { if (currentRef.current) onChange([...value, currentRef.current]); currentRef.current = ''; setCurrent(''); onSigningChange?.(false); },
    onPanResponderTerminate: () => { currentRef.current = ''; setCurrent(''); onSigningChange?.(false); },
  }), [value, onChange, onSigningChange]);
  return <View style={styles.wrapper}><View style={styles.pad} onLayout={(event) => { size.current = event.nativeEvent.layout; }} {...pan.panHandlers}><Svg width="100%" height="100%" viewBox="0 0 320 140">{value.map((path,index)=><Path key={`${index}-${path.length}`} d={path} fill="none" stroke="#17212B" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>)}{current?<Path d={current} fill="none" stroke="#17212B" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>:null}</Svg><Text style={styles.hint}>Driver signs here</Text></View><TouchableOpacity style={styles.clear} onPress={()=>onChange([])}><Text style={styles.clearText}>Clear signature</Text></TouchableOpacity></View>;
}
const styles=StyleSheet.create({wrapper:{gap:8},pad:{height:150,borderWidth:1,borderColor:colors.line,borderRadius:12,backgroundColor:'#FFF',overflow:'hidden'},hint:{position:'absolute',bottom:7,alignSelf:'center',color:'#9AA3AA',fontSize:11},clear:{alignSelf:'flex-start',paddingVertical:7},clearText:{color:colors.danger,fontWeight:'800'}});
