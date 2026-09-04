import {Children,useEffect,useRef,useState,type ReactNode} from 'react';
import {AccessibilityInfo,Animated,Pressable,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {colors} from '../theme';

export type MenuTone='navy'|'orange'|'cream';

export function useReducedMotion(){
  const[reduced,setReduced]=useState(false);
  useEffect(()=>{let active=true;void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(active)setReduced(value);}).catch(()=>{});const sub=AccessibilityInfo.addEventListener('reduceMotionChanged',value=>setReduced(value));return()=>{active=false;sub.remove();};},[]);
  return reduced;
}

const STAGGER_STEP=26;
const STAGGER_CAP=220;

/**
 * `refined` is Home's shipped, physically-approved DROMEX ledger treatment — its values below must not change.
 * `polished` is an additional, opt-in layer (Project Command Center only) that adds the attached numbered tab,
 * the connected header/body seam, header depth, header press feedback, and staggered row reveal on top of `refined`.
 * A caller should only ever pass `polished` alongside `refined`, never alone.
 */
export function ExpandableMenuSection({title,hint,tone='navy',marker,refined=false,polished=false,open,onToggle,children}:{title:string;hint:string;tone?:MenuTone;marker?:string;refined?:boolean;polished?:boolean;open:boolean;onToggle:()=>void;children:ReactNode}){
  const items=Children.toArray(children);
  const[render,setRender]=useState(open);
  const progress=useState(()=>new Animated.Value(open?1:0))[0];
  const rotate=useState(()=>new Animated.Value(open?1:0))[0];
  const press=useState(()=>new Animated.Value(0))[0];
  const itemMotionRef=useRef<Animated.Value[]>([]);
  while(itemMotionRef.current.length<items.length)itemMotionRef.current.push(new Animated.Value(open?1:0));
  const reducedMotion=useReducedMotion();
  const richHeader=polished&&tone!=='cream';
  useEffect(()=>{
    if(open)setRender(true);
    const duration=reducedMotion?0:(open?230:170);
    const animations=[Animated.timing(progress,{toValue:open?1:0,duration,useNativeDriver:false}),Animated.timing(rotate,{toValue:open?1:0,duration,useNativeDriver:true})];
    if(polished&&items.length){
      const itemDuration=reducedMotion?0:(open?200:130);
      const rowAnimations=itemMotionRef.current.slice(0,items.length).map((value,index)=>Animated.timing(value,{toValue:open?1:0,duration:itemDuration,delay:open&&!reducedMotion?Math.min(index*STAGGER_STEP,STAGGER_CAP):0,useNativeDriver:true}));
      animations.push(Animated.parallel(rowAnimations));
    }
    const animation=Animated.parallel(animations);
    animation.start(({finished})=>{if(finished&&!open)setRender(false);});
    return()=>animation.stop();
  },[open,progress,rotate,reducedMotion,polished,items.length]);
  const pressIn=()=>{if(!polished||reducedMotion)return;Animated.spring(press,{toValue:1,useNativeDriver:true,speed:30,bounciness:0}).start();};
  const pressOut=()=>{if(!polished||reducedMotion)return;Animated.spring(press,{toValue:0,useNativeDriver:true,speed:30,bounciness:0}).start();};
  const dark=tone!=='cream';
  const rotateStyle={transform:[{rotate:rotate.interpolate({inputRange:[0,1],outputRange:['0deg','45deg']})}]};
  const pressStyle={transform:[{scale:press.interpolate({inputRange:[0,1],outputRange:[1,.99]})}]};
  return <View style={[styles.section,richHeader&&styles.sectionConnected]}>
    {richHeader&&marker?<View style={styles.tab} pointerEvents="none"><Text style={styles.tabText}>{marker}</Text></View>:null}
    <Pressable onPress={onToggle} onPressIn={pressIn} onPressOut={pressOut} accessibilityRole="button" accessibilityState={{expanded:open}} style={styles.pressable}>
      <Animated.View style={[styles.header,tone==='navy'?styles.navy:tone==='orange'?styles.orange:styles.cream,richHeader&&styles.headerRich,richHeader&&open&&styles.headerOpen,polished&&pressStyle]}>
        {marker&&!richHeader?<View style={[styles.marker,refined?styles.markerRefined:dark&&styles.markerDark]}><Text style={[styles.markerText,refined?styles.markerTextRefined:dark&&styles.light]}>{marker}</Text></View>:null}
        <View style={styles.copy}>
          <Text style={[styles.title,refined&&styles.titleRefined,dark&&styles.light]}>{title}</Text>
          <Text style={[styles.hint,refined&&styles.hintRefined,dark&&styles.lightHint]}>{hint}</Text>
        </View>
        {refined?<Animated.Text style={[styles.plus,dark&&styles.light,rotateStyle]}>+</Animated.Text>:<Text style={[styles.plus,dark&&styles.light]}>{open?'×':'+'}</Text>}
        <Animated.View style={[styles.accent,richHeader&&styles.accentRich,{width:progress.interpolate({inputRange:[0,1],outputRange:['0%','100%']})}]}/>
      </Animated.View>
    </Pressable>
    {render?<View style={[styles.body,refined&&styles.bodyRefined,polished&&styles.bodyPolished,richHeader&&styles.bodyConnected]}>{items.map((item,index)=>{const value=(polished?itemMotionRef.current[index]:undefined)??progress;return <Animated.View key={index} style={{opacity:value,transform:[{translateY:value.interpolate({inputRange:[0,1],outputRange:[-6,0]})}]}}>{item}</Animated.View>;})}</View>:null}
  </View>;
}

export function MenuAction({number,title,body,onPress,tone='white',badge,refined=false,polished=false}:{number:string;title:string;body:string;onPress:()=>void;tone?:'white'|'cream'|'orange';badge?:string;refined?:boolean;polished?:boolean}){
  const press=useState(()=>new Animated.Value(0))[0];
  const pressStyle={transform:[{scale:press.interpolate({inputRange:[0,1],outputRange:[1,.985]})}]};
  const content=<>
    <Text style={[styles.number,refined&&styles.numberRefined,polished&&styles.numberPolished]}>{number}</Text>
    <View style={styles.actionCopy}>
      {badge?<Text style={[styles.badge,refined&&styles.badgeRefined,polished&&styles.badgePolished]}>{badge}</Text>:null}
      <Text style={[styles.actionTitle,refined&&styles.actionTitleRefined]}>{title}</Text>
      <Text style={styles.actionBody}>{body}</Text>
    </View>
    <Text style={[styles.arrow,refined&&styles.arrowRefined]}>›</Text>
  </>;
  if(!refined)return <TouchableOpacity activeOpacity={.7} style={[styles.action,tone==='cream'&&styles.actionCream,tone==='orange'&&styles.actionOrange]} onPress={onPress} accessibilityRole="button">{content}</TouchableOpacity>;
  if(!polished)return <TouchableOpacity activeOpacity={.7} style={[styles.action,styles.actionRefined,tone==='orange'&&styles.actionOrangeRefined]} onPress={onPress} accessibilityRole="button">{content}</TouchableOpacity>;
  return <Pressable onPress={onPress} onPressIn={()=>Animated.spring(press,{toValue:1,useNativeDriver:true,speed:30,bounciness:0}).start()} onPressOut={()=>Animated.spring(press,{toValue:0,useNativeDriver:true,speed:30,bounciness:0}).start()} accessibilityRole="button">
    <Animated.View style={[styles.action,styles.actionPolished,tone==='orange'&&styles.actionOrangePolished,pressStyle]}>{content}</Animated.View>
  </Pressable>;
}

const styles=StyleSheet.create({section:{gap:8},sectionConnected:{gap:0,marginTop:9},pressable:{minHeight:48},header:{minHeight:67,borderRadius:15,paddingHorizontal:15,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:12,overflow:'hidden'},headerRich:{paddingTop:20,shadowColor:'#17212B',shadowOpacity:.16,shadowRadius:6,shadowOffset:{width:0,height:3},elevation:3},headerOpen:{borderBottomLeftRadius:0,borderBottomRightRadius:0},navy:{backgroundColor:colors.navy},orange:{backgroundColor:colors.brand},cream:{backgroundColor:colors.cream,borderWidth:1,borderColor:'#E4D7C7'},marker:{width:26,height:26,borderRadius:13,alignItems:'center',justifyContent:'center',backgroundColor:'rgba(23,33,43,0.08)'},markerDark:{backgroundColor:'rgba(255,255,255,0.16)'},markerRefined:{width:34,height:30,borderRadius:8,backgroundColor:colors.cream},markerText:{color:colors.navy,fontSize:11,fontWeight:'900'},markerTextRefined:{color:colors.navy,fontSize:13,fontWeight:'900'},tab:{position:'absolute',top:-9,left:16,zIndex:3,minWidth:36,height:28,paddingHorizontal:8,borderRadius:7,backgroundColor:colors.cream,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#E3D6C2',shadowColor:'#17212B',shadowOpacity:.18,shadowRadius:3,shadowOffset:{width:0,height:1},elevation:4},tabText:{color:colors.navy,fontSize:13,fontWeight:'900'},copy:{flex:1,minWidth:0,gap:3},title:{color:colors.ink,fontSize:19,fontWeight:'900'},titleRefined:{fontWeight:'700'},hint:{color:colors.muted,fontSize:11,lineHeight:16},hintRefined:{fontWeight:'500'},light:{color:'#FFF8ED'},lightHint:{color:'#F2E2D5'},plus:{width:26,textAlign:'center',color:colors.navy,fontSize:27,fontWeight:'700'},accent:{position:'absolute',height:3,left:0,bottom:0,backgroundColor:colors.brand},accentRich:{height:4},body:{gap:8,paddingLeft:10},bodyRefined:{gap:0,paddingLeft:0,backgroundColor:colors.cream,borderRadius:16,borderWidth:1,borderColor:'#E8DED0',padding:10},bodyPolished:{gap:8},bodyConnected:{borderTopLeftRadius:0,borderTopRightRadius:0,borderTopWidth:4,borderTopColor:colors.brand},action:{minHeight:80,backgroundColor:colors.surface,borderRadius:14,borderLeftWidth:4,borderLeftColor:colors.navy,padding:14,flexDirection:'row',alignItems:'center',gap:11},actionCream:{backgroundColor:'#FFF8ED',borderLeftColor:colors.brand},actionOrange:{backgroundColor:'#FFF1E9',borderLeftColor:colors.brand,borderWidth:1,borderColor:'#F0C5B4'},actionRefined:{backgroundColor:'transparent',borderRadius:0,borderLeftWidth:3,borderWidth:0,borderBottomWidth:1,borderBottomColor:'#EFE6D8',paddingVertical:13,paddingHorizontal:10},actionOrangeRefined:{backgroundColor:'rgba(200,75,49,0.07)'},actionPolished:{minHeight:80,backgroundColor:colors.surface,borderRadius:13,borderLeftWidth:3,borderLeftColor:colors.navy,shadowColor:'#17212B',shadowOpacity:.06,shadowRadius:4,shadowOffset:{width:0,height:2},elevation:1,paddingVertical:13,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:11},actionOrangePolished:{backgroundColor:'rgba(200,75,49,0.07)'},number:{width:28,color:colors.brand,fontSize:11,fontWeight:'900'},numberRefined:{color:colors.navy,fontWeight:'700'},numberPolished:{fontWeight:'600'},actionCopy:{flex:1,minWidth:0,gap:3},badge:{color:colors.brandDark,fontSize:11,fontWeight:'900',letterSpacing:.5},badgeRefined:{fontWeight:'700'},badgePolished:{fontWeight:'600'},actionTitle:{color:colors.ink,fontSize:16,fontWeight:'900'},actionTitleRefined:{fontWeight:'700'},actionBody:{color:colors.muted,fontSize:11,lineHeight:16},arrow:{color:colors.brand,fontSize:27,fontWeight:'900'},arrowRefined:{color:colors.navy}});
