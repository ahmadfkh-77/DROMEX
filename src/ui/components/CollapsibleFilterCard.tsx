import {useState,type ReactNode} from 'react';
import {LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {colors} from '../theme';

export function CollapsibleFilterCard({title,summary,children,defaultOpen=false}:{title:string;summary:string;children:ReactNode;defaultOpen?:boolean}){
  const[open,setOpen]=useState(defaultOpen);
  const toggle=()=>{LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);setOpen(value=>!value);};
  return <View style={styles.card}><TouchableOpacity activeOpacity={.72} style={styles.header} onPress={toggle} accessibilityRole="button" accessibilityState={{expanded:open}}><View style={styles.copy}><Text style={styles.title}>{title}</Text><Text style={styles.summary}>{summary}</Text></View><Text style={styles.mark}>{open?'\u00D7':'+'}</Text></TouchableOpacity>{open?<View style={styles.body}>{children}</View>:null}</View>;
}

const styles=StyleSheet.create({card:{backgroundColor:colors.brand,borderRadius:15,overflow:'hidden',shadowColor:'#8E2E1B',shadowOpacity:.12,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:2},header:{flexDirection:'row',alignItems:'center',gap:12,padding:16},copy:{flex:1},title:{color:'#FFF8ED',fontSize:17,fontWeight:'900'},summary:{color:'#F9E8D8',fontSize:11,fontWeight:'700',marginTop:3},mark:{color:'#FFF8ED',fontSize:28,fontWeight:'700',width:28,textAlign:'center'},body:{gap:12,backgroundColor:'#FFF8ED',padding:16,borderTopWidth:3,borderTopColor:'#173F67'}});
