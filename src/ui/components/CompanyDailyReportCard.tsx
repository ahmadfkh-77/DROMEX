import {useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';

import {homeFigures,type CompanyDailyReport,type DayTile} from '../../domain/companyDailyReport';
import {colors} from '../theme';

const tileLabel:Record<DayTile['key'],string>={loadsOut:'Loads out',supplierLoads:'Supplier loads',fuel:'Fuel given',waste:'Waste trips'};
export const tileText=(tile:DayTile)=>`${tile.value.toLocaleString(undefined,{maximumFractionDigits:3})}${tile.unit?` ${tile.unit}`:''}`;
export {tileLabel};

/**
 * Company Daily Report on Home. Folded (closed) by default like the other Home sections; the figures are read only when
 * it is opened, count only what exists today, and the card is navigation plus presentation: it changes nothing.
 */
export function CompanyDailyReportCard({dateLabel,loadToday,onOpen}:{dateLabel:string;loadToday:()=>Promise<CompanyDailyReport>;onOpen:()=>void}){
  const[open,setOpen]=useState(false);
  const[state,setState]=useState<{status:'idle'|'loading'|'error'|'ready';report?:CompanyDailyReport}>({status:'idle'});
  const toggle=()=>{
    const next=!open;setOpen(next);
    if(next){setState({status:'loading'});void loadToday().then(report=>setState({status:'ready',report})).catch(()=>setState({status:'error'}));}
  };
  const figures=state.report?homeFigures(state.report):[];
  return <View style={styles.card}>
    <Pressable onPress={toggle} style={styles.header} accessibilityRole="button" accessibilityState={{expanded:open}} accessibilityLabel={`Company Daily Report, ${dateLabel}. ${open?'Fold':'Unfold'}`}>
      <View style={styles.copy}><Text style={styles.title}>Company Daily Report</Text><Text style={styles.date}>{dateLabel}</Text></View>
      <View style={styles.toggle}><Text style={styles.toggleText}>{open?'×':'+'}</Text></View>
    </Pressable>
    {open?<View style={styles.body}>
      {state.status==='loading'?<ActivityIndicator color="#FFFFFF"/>:null}
      {state.status==='error'?<Text style={styles.note}>Could not read today's records. Open the preview to try again.</Text>:null}
      {state.status==='ready'&&figures.length?<View style={styles.figures}>{figures.map(tile=><View key={tile.key} style={styles.figure}><Text style={styles.figureValue}>{tileText(tile)}</Text><Text style={styles.figureLabel}>{tileLabel[tile.key]}</Text></View>)}</View>:null}
      {state.status==='ready'&&!figures.length?<Text style={styles.note}>Nothing recorded today.</Text>:null}
      <Pressable onPress={onOpen} style={styles.button} accessibilityRole="button" accessibilityLabel="Open today's preview"><Text style={styles.buttonText}>Open today's preview</Text></Pressable>
    </View>:null}
  </View>;
}

const styles=StyleSheet.create({
  card:{backgroundColor:colors.navy,borderRadius:16,borderBottomWidth:3,borderBottomColor:colors.brand,overflow:'hidden'},
  header:{flexDirection:'row',alignItems:'center',gap:10,minHeight:56,paddingHorizontal:14,paddingVertical:10},
  copy:{flex:1,gap:2},title:{color:'#FFFFFF',fontSize:16,fontWeight:'900'},date:{color:'#CFDCEA',fontSize:12},
  toggle:{width:34,height:34,borderRadius:17,backgroundColor:'rgba(255,255,255,0.14)',alignItems:'center',justifyContent:'center'},toggleText:{color:'#FFFFFF',fontSize:22,fontWeight:'800',marginTop:-2},
  body:{paddingHorizontal:14,paddingBottom:14,gap:10},
  figures:{flexDirection:'row',gap:8,flexWrap:'wrap'},figure:{flexGrow:1,minWidth:90,backgroundColor:'rgba(255,255,255,0.1)',borderRadius:10,padding:8,alignItems:'center'},
  figureValue:{color:'#FFFFFF',fontSize:19,fontWeight:'900'},figureLabel:{color:'#CFDCEA',fontSize:10.5,fontWeight:'700',textTransform:'uppercase',letterSpacing:0.5},
  note:{color:'#CFDCEA',fontSize:13,textAlign:'center'},
  button:{minHeight:48,borderRadius:12,backgroundColor:colors.brand,alignItems:'center',justifyContent:'center'},buttonText:{color:'#FFFFFF',fontWeight:'800',fontSize:15},
});
