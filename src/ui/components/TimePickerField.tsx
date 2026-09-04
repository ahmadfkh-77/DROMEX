import {useEffect,useRef,useState} from 'react';
import {Modal,SafeAreaView,ScrollView,StyleSheet,Text,TouchableOpacity,View,type NativeSyntheticEvent,type NativeScrollEvent} from 'react-native';
import {colors} from '../theme';

const ITEM_HEIGHT=48;
const HOURS=Array.from({length:24},(_,i)=>String(i).padStart(2,'0'));
const MINUTES=Array.from({length:12},(_,i)=>String(i*5).padStart(2,'0'));

function parseTime(value:string):{hour:string;minute:string}|null{
  const match=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if(!match)return null;
  const rounded=(Math.round(Number(match[2])/5)*5)%60;
  return {hour:match[1]!,minute:String(rounded).padStart(2,'0')};
}
function nowRounded():{hour:string;minute:string}{
  const date=new Date();
  return {hour:String(date.getHours()).padStart(2,'0'),minute:String(Math.round(date.getMinutes()/5)*5%60).padStart(2,'0')};
}

/** A scroll-wheel HH:MM picker producing the same 24-hour string the app already validates (see domain/projectReports.ts). */
export function TimePickerField({label,value,onChange,placeholder='Select time'}:{label:string;value:string;onChange:(value:string)=>void;placeholder?:string}){
  const[open,setOpen]=useState(false);
  const[hour,setHour]=useState('07');const[minute,setMinute]=useState('00');
  const hourRef=useRef<ScrollView>(null);const minuteRef=useRef<ScrollView>(null);

  useEffect(()=>{
    if(!open)return;
    const next=parseTime(value)??{hour:'07',minute:'00'};
    setHour(next.hour);setMinute(next.minute);
    const hourIndex=HOURS.indexOf(next.hour);const minuteIndex=MINUTES.indexOf(next.minute);
    const timer=setTimeout(()=>{
      hourRef.current?.scrollTo({y:hourIndex*ITEM_HEIGHT,animated:false});
      minuteRef.current?.scrollTo({y:minuteIndex*ITEM_HEIGHT,animated:false});
    },0);
    return ()=>clearTimeout(timer);
  },[open,value]);

  function confirm(){onChange(`${hour}:${minute}`);setOpen(false);}
  function useNow(){const next=nowRounded();onChange(`${next.hour}:${next.minute}`);setOpen(false);}
  function snap(event:NativeSyntheticEvent<NativeScrollEvent>,values:string[],apply:(value:string)=>void){const index=Math.max(0,Math.min(values.length-1,Math.round(event.nativeEvent.contentOffset.y/ITEM_HEIGHT)));apply(values[index]!);}
  function tapHour(next:string){setHour(next);hourRef.current?.scrollTo({y:HOURS.indexOf(next)*ITEM_HEIGHT,animated:true});}
  function tapMinute(next:string){setMinute(next);minuteRef.current?.scrollTo({y:MINUTES.indexOf(next)*ITEM_HEIGHT,animated:true});}

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity style={styles.control} onPress={()=>setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${value||placeholder}`}>
        <Text style={[styles.value,!value&&styles.placeholder]}>{value||placeholder}</Text>
        <Text style={styles.clockMark}>◴</Text>
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={()=>setOpen(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <View><Text style={styles.eyebrow}>CHOOSE A TIME</Text><Text style={styles.title}>{label.replace(' *','')}</Text></View>
            <TouchableOpacity style={styles.close} onPress={()=>setOpen(false)} accessibilityRole="button" accessibilityLabel="Close"><Text style={styles.closeText}>Close</Text></TouchableOpacity>
          </View>
          <View style={styles.wheelCard}>
            <View style={styles.wheels}>
              <View style={styles.wheelHighlight} pointerEvents="none"/>
              <ScrollView ref={hourRef} style={styles.wheel} showsVerticalScrollIndicator={false} snapToInterval={ITEM_HEIGHT} decelerationRate="fast" onMomentumScrollEnd={(event)=>snap(event,HOURS,setHour)} contentContainerStyle={styles.wheelContent}>
                {HOURS.map((h)=><TouchableOpacity key={h} style={styles.wheelItem} onPress={()=>tapHour(h)} accessibilityRole="button" accessibilityLabel={`${h} hours`}><Text style={[styles.wheelItemText,h===hour&&styles.wheelItemTextActive]}>{h}</Text></TouchableOpacity>)}
              </ScrollView>
              <Text style={styles.colon}>:</Text>
              <ScrollView ref={minuteRef} style={styles.wheel} showsVerticalScrollIndicator={false} snapToInterval={ITEM_HEIGHT} decelerationRate="fast" onMomentumScrollEnd={(event)=>snap(event,MINUTES,setMinute)} contentContainerStyle={styles.wheelContent}>
                {MINUTES.map((m)=><TouchableOpacity key={m} style={styles.wheelItem} onPress={()=>tapMinute(m)} accessibilityRole="button" accessibilityLabel={`${m} minutes`}><Text style={[styles.wheelItemText,m===minute&&styles.wheelItemTextActive]}>{m}</Text></TouchableOpacity>)}
              </ScrollView>
            </View>
            <Text style={styles.wheelHint}>Minutes move in 5-minute steps.</Text>
          </View>
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.quick} onPress={useNow} accessibilityRole="button"><Text style={styles.quickText}>Now (nearest 5 min)</Text></TouchableOpacity>
            <TouchableOpacity style={styles.confirm} onPress={confirm} accessibilityRole="button"><Text style={styles.confirmText}>Set {hour}:{minute}</Text></TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles=StyleSheet.create({
  field:{gap:6},
  label:{color:colors.ink,fontSize:13,fontWeight:'800'},
  control:{minHeight:49,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,paddingVertical:11,backgroundColor:'#FCFBF8',flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  value:{color:colors.ink,fontSize:15,fontWeight:'700'},
  placeholder:{color:colors.muted,fontWeight:'500'},
  clockMark:{color:colors.brandDark,fontSize:20,fontWeight:'900'},
  modal:{flex:1,backgroundColor:colors.background},
  modalHeader:{padding:20,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  eyebrow:{color:colors.brand,fontSize:10,fontWeight:'900',letterSpacing:1.2},
  title:{color:colors.ink,fontSize:26,fontWeight:'900'},
  close:{minHeight:48,minWidth:48,paddingHorizontal:14,alignItems:'center',justifyContent:'center',backgroundColor:colors.surface,borderRadius:10},
  closeText:{color:colors.ink,fontWeight:'800'},
  wheelCard:{margin:20,marginTop:0,backgroundColor:colors.surface,borderRadius:18,padding:15,gap:10},
  wheels:{flexDirection:'row',alignItems:'center',justifyContent:'center',height:ITEM_HEIGHT*3},
  wheelHighlight:{position:'absolute',left:0,right:0,top:ITEM_HEIGHT,height:ITEM_HEIGHT,backgroundColor:colors.creamSoft,borderRadius:12,borderWidth:1,borderColor:colors.line},
  wheel:{width:90,height:ITEM_HEIGHT*3},
  wheelContent:{paddingVertical:ITEM_HEIGHT},
  wheelItem:{height:ITEM_HEIGHT,alignItems:'center',justifyContent:'center'},
  wheelItemText:{color:colors.muted,fontSize:18,fontWeight:'700'},
  wheelItemTextActive:{color:colors.ink,fontSize:24,fontWeight:'900'},
  colon:{color:colors.ink,fontSize:24,fontWeight:'900',marginHorizontal:6},
  wheelHint:{color:colors.muted,fontSize:11,textAlign:'center'},
  quickRow:{flexDirection:'row',gap:9,paddingHorizontal:20,paddingBottom:20},
  quick:{flex:1,minHeight:48,justifyContent:'center',borderWidth:1,borderColor:colors.brand,borderRadius:11,padding:12,alignItems:'center'},
  quickText:{color:colors.brandDark,fontWeight:'900'},
  confirm:{flex:1,minHeight:48,justifyContent:'center',backgroundColor:colors.brand,borderRadius:11,padding:12,alignItems:'center'},
  confirmText:{color:'#FFF',fontWeight:'900'},
});
