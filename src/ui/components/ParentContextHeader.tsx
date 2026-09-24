import {StyleSheet,Text,View} from 'react-native';

import {colors} from '../theme';

/** `Section A → Foundation A1 → Lift 2 → Concrete Fill` -- so the user always knows where they are without a deep, confusing stack. */
export function ParentContextHeader({trail}:{trail:string[]}){
  if(!trail.length)return null;
  return <View style={styles.row} accessibilityLabel={trail.join(', then ')}>
    <Text style={styles.text} numberOfLines={1}>{trail.join(' → ')}</Text>
  </View>;
}

const styles=StyleSheet.create({
  row:{paddingHorizontal:2},
  text:{color:colors.muted,fontSize:12,fontWeight:'700'},
});
