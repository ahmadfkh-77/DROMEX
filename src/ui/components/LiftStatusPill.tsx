import {StyleSheet,Text,View} from 'react-native';

import type {LiftStatus} from '../../domain/wallCyclopeanLift';
import {colors,radius} from '../theme';

/** DEC-466. The three approved, honest lift states -- never an invented fourth "inspected/approved" step. */
export const liftStatusLabels:Record<LiftStatus,string>={planned:'Planned',stone_placed:'Concrete fill pending',completed:'Completed'};
const toneFor:Record<LiftStatus,{bg:string;fg:string}>={
  planned:{bg:'#EDEBE6',fg:colors.muted},
  stone_placed:{bg:'#FFF3D8',fg:colors.warning},
  completed:{bg:'#E5F3EC',fg:colors.success},
};

export function LiftStatusPill({status}:{status:LiftStatus}){
  const tone=toneFor[status];
  return <View style={[styles.pill,{backgroundColor:tone.bg}]}><Text style={[styles.text,{color:tone.fg}]}>{liftStatusLabels[status]}</Text></View>;
}

const styles=StyleSheet.create({
  pill:{alignSelf:'flex-start',borderRadius:radius.pill,paddingHorizontal:10,paddingVertical:5},
  text:{fontSize:12,fontWeight:'900'},
});
