import type {ReactNode} from 'react';
import {ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {ActivityIndicator} from 'react-native';
import {colors,radius} from '../theme';
import {Feedback,PageHeader} from './AppPrimitives';

export type PavementBandTone='navy'|'orange'|'teal'|'cream';
export type PavementBar={label:string;value:string;secondary?:{label:string;onPress:()=>void};primary?:{label:string;onPress:()=>void;disabled?:boolean;busy?:boolean};/** A dimmed bar says the answer is not usable yet. */muted?:boolean};

const bandColors:Record<PavementBandTone,{background:string;ink:string;hint:string;chip:string}>={
  navy:{background:colors.navy,ink:'#FFF',hint:'#D5E4EF',chip:'rgba(255,255,255,.22)'},
  orange:{background:colors.brand,ink:'#FFF',hint:'#FBE6DF',chip:'rgba(255,255,255,.22)'},
  teal:{background:colors.result,ink:'#FFF',hint:colors.resultSoft,chip:'rgba(255,255,255,.22)'},
  cream:{background:colors.cream,ink:colors.ink,hint:colors.muted,chip:colors.navy},
};

/**
 * One page of the Asphalt Calculator (DEC-519): the standard header, progress dots when the page is a step, a coloured band with its own step mark
 * and title so each page looks like its own screen, then the content, and a fixed bottom bar with the figures so far and Back / Next.
 */
export function PavementPageFrame({dots,band,onBack,bar,error,message,children}:{dots?:{total:number;current:number};band:{mark:string;title:string;hint:string;tone:PavementBandTone};onBack:()=>void;bar:PavementBar;error?:string|null;message?:string|null;children:ReactNode}){
  const tone=bandColors[band.tone];
  return <View style={styles.frame}>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <PageHeader eyebrow="PAVEMENT QUANTITY" title="Asphalt Calculator" onBack={onBack}/>
      {dots?<View style={styles.dots} accessibilityRole="progressbar" accessibilityLabel={`Step ${dots.current} of ${dots.total}`}>{Array.from({length:dots.total},(_,index)=><View key={index} style={[styles.dot,index+1<dots.current&&styles.dotDone,index+1===dots.current&&styles.dotOn]}/>)}</View>:null}
      <View style={[styles.band,{backgroundColor:tone.background},band.tone==='cream'&&styles.bandCream]}>
        <View style={[styles.mark,{backgroundColor:tone.chip}]}><Text style={[styles.markText,band.tone==='cream'&&{color:'#FFF'}]}>{band.mark}</Text></View>
        <View style={styles.bandCopy}><Text style={[styles.bandTitle,{color:tone.ink}]}>{band.title}</Text><Text style={[styles.bandHint,{color:tone.hint}]}>{band.hint}</Text></View>
      </View>
      {error?<Feedback kind="error">{error}</Feedback>:null}
      {message?<Feedback kind="success">{message}</Feedback>:null}
      {children}
    </ScrollView>
    <View style={[styles.bar,bar.muted&&styles.barMuted]}>
      <View style={styles.barCopy}><Text style={styles.barLabel}>{bar.label}</Text><Text style={styles.barValue} numberOfLines={1}>{bar.value}</Text></View>
      {bar.secondary?<TouchableOpacity style={styles.secondary} onPress={bar.secondary.onPress} accessibilityRole="button"><Text style={styles.secondaryText}>{bar.secondary.label}</Text></TouchableOpacity>:null}
      {bar.primary?<TouchableOpacity style={[styles.primary,(bar.primary.disabled||bar.primary.busy)&&styles.disabled]} disabled={bar.primary.disabled||bar.primary.busy} onPress={bar.primary.onPress} accessibilityRole="button">{bar.primary.busy?<ActivityIndicator color="#FFF"/>:<Text style={styles.primaryText}>{bar.primary.label}</Text>}</TouchableOpacity>:null}
    </View>
  </View>;
}

const styles=StyleSheet.create({
  frame:{flex:1},
  page:{padding:20,paddingBottom:28,gap:14},
  dots:{flexDirection:'row',gap:6},
  dot:{flex:1,height:6,borderRadius:3,backgroundColor:'#E0E3E8'},
  dotDone:{backgroundColor:colors.navy},
  dotOn:{backgroundColor:colors.brand},
  band:{borderRadius:radius.lg,padding:16,flexDirection:'row',alignItems:'center',gap:12},
  bandCream:{borderWidth:1,borderColor:'#E3DBCD'},
  mark:{width:42,height:42,borderRadius:13,alignItems:'center',justifyContent:'center'},
  markText:{color:'#FFF',fontSize:21,fontWeight:'900'},
  bandCopy:{flex:1,minWidth:0,gap:2},
  bandTitle:{fontSize:21,fontWeight:'900'},
  bandHint:{fontSize:13,lineHeight:18},
  bar:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:colors.navy,paddingHorizontal:16,paddingVertical:12},
  barMuted:{backgroundColor:'#4F5B66'},
  barCopy:{flex:1,minWidth:0},
  barLabel:{color:'#D5E4EF',fontSize:10,fontWeight:'800',letterSpacing:1},
  barValue:{color:'#FFF',fontSize:17,fontWeight:'900'},
  secondary:{minHeight:48,minWidth:48,borderRadius:12,borderWidth:1.5,borderColor:'#FFF',paddingHorizontal:14,alignItems:'center',justifyContent:'center'},
  secondaryText:{color:'#FFF',fontSize:14,fontWeight:'800'},
  primary:{minHeight:48,minWidth:78,borderRadius:12,backgroundColor:colors.brand,paddingHorizontal:18,alignItems:'center',justifyContent:'center'},
  primaryText:{color:'#FFF',fontSize:15,fontWeight:'900'},
  disabled:{opacity:.4},
});
