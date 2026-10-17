import {Modal,Pressable,ScrollView,StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import Svg,{Circle,Path} from 'react-native-svg';
import type {Project} from '../../domain/loads';
import {createGroups,type CreateAction,type CreateTone} from '../../domain/createActions';
import {colors} from '../theme';

export type {CreateAction};
type Tone=CreateTone;

const toneColors:Record<Tone,{badge:string;ink:string}>={orange:{badge:'#FBE6DF',ink:colors.brand},navy:{badge:'#E1EAF3',ink:colors.navy},teal:{badge:'#E3F1F2',ink:'#1F6F78'}};

/** Small line icons, drawn here so no icon font is needed. Each is a 24 by 24 outline in the group's colour. */
function ActionIcon({id,color}:{id:CreateAction;color:string}){
  const common={stroke:color,strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const,fill:'none'};
  const paths:Record<CreateAction,string>={
    receipt:'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
    quickText:'M5 6h14 M5 10h14 M5 14h9 M5 18h6',
    dailyReport:'M7 4h10v16H7z M9.5 9h5 M9.5 13h5',
    schedule:'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
    waste:'M12 4v10 M8 10l4 4 4-4 M5 19h14',
    issue:'M12 4l9 16H3z M12 10v4 M12 17v.5',
    photo:'M4 8h4l2-3h4l2 3h4v11H4z',
    quarry:'M3 7h11v9H3z M14 10h4l3 3v3h-7z',
    fuelDelivery:'M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z',
    equipmentFill:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 3v3 M12 18v3 M3 12h3 M18 12h3',
  };
  return <Svg width={22} height={22} viewBox="0 0 24 24"><Path d={paths[id]} {...common}/>{id==='photo'?<Circle cx={12} cy={13} r={3.5} {...common}/>:null}{id==='quarry'?<><Circle cx={7} cy={18} r={1.6} {...common}/><Circle cx={17} cy={18} r={1.6} {...common}/></>:null}</Svg>;
}

export function CreateActionSheet({visible,activeProject,onClose,onSelect,onChooseProject}:{visible:boolean;activeProject:Project|null;onClose:()=>void;onSelect:(action:CreateAction)=>void;onChooseProject:()=>void}){
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.overlay}><Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close"/>
    <View style={styles.sheet}><View style={styles.handle}/>
      <View style={styles.header}><View style={styles.flex}><Text style={styles.eyebrow}>CREATE</Text><Text style={styles.title}>What are you recording?</Text></View><TouchableOpacity style={styles.close} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close"><Text style={styles.closeText}>×</Text></TouchableOpacity></View>
      <TouchableOpacity style={styles.projectBar} onPress={onChooseProject} accessibilityRole="button" accessibilityLabel={activeProject?`Project ${activeProject.name}. Change`:'No project chosen. Choose one'}>
        <View style={styles.flex}><Text style={styles.projectLabel}>PROJECT</Text><Text style={[styles.projectName,!activeProject&&styles.projectNone]} numberOfLines={1}>{activeProject?.name??'None chosen'}</Text></View>
        <Text style={styles.change}>{activeProject?'Change':'Choose'}</Text>
      </TouchableOpacity>
      <ScrollView contentContainerStyle={styles.groups} showsVerticalScrollIndicator={false}>
        {createGroups.map(group=><View key={group.title} style={styles.group}>
          <View style={styles.sectionRow}><Text style={styles.section}>{group.title}</Text><View style={styles.sectionLine}/></View>
          <View style={styles.grid}>{group.actions.map((action,index)=>{
            const primary=group.tone==='orange'&&index===0,needs=action.needsProject&&!activeProject,tone=toneColors[group.tone];
            return <TouchableOpacity key={action.id} activeOpacity={.7} style={[styles.tile,primary&&styles.tilePrimary]} onPress={()=>onSelect(action.id)} accessibilityRole="button" accessibilityLabel={`${action.title}. ${action.hint}${needs?'. Needs a project, you will choose one first':''}`}>
              <View style={[styles.badge,{backgroundColor:tone.badge}]}><ActionIcon id={action.id} color={tone.ink}/></View>
              <View style={styles.flex}><Text style={styles.tileTitle}>{action.title}</Text><Text style={styles.tileHint}>{action.hint}</Text></View>
              {needs?<Text style={styles.tag}>Needs project</Text>:null}
              {primary?<Text style={styles.arrow}>›</Text>:null}
            </TouchableOpacity>;
          })}</View>
        </View>)}
      </ScrollView>
    </View></View></Modal>;
}

const styles=StyleSheet.create({
  overlay:{flex:1,backgroundColor:'rgba(8,27,45,.55)',justifyContent:'flex-end'},
  sheet:{maxHeight:'92%',backgroundColor:colors.background,borderTopLeftRadius:26,borderTopRightRadius:26,padding:16,paddingBottom:24,gap:12},
  handle:{width:48,height:5,borderRadius:3,backgroundColor:'#C6BFB4',alignSelf:'center'},
  header:{flexDirection:'row',alignItems:'flex-start',gap:12},
  flex:{flex:1,minWidth:0},
  eyebrow:{color:colors.brand,fontSize:10,fontWeight:'900',letterSpacing:1.4},
  title:{color:colors.ink,fontSize:23,fontWeight:'900',marginTop:2},
  close:{width:44,height:44,borderRadius:13,backgroundColor:colors.surface,alignItems:'center',justifyContent:'center'},
  closeText:{color:colors.navy,fontSize:28,fontWeight:'700'},
  projectBar:{minHeight:52,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:14,paddingHorizontal:14,paddingVertical:8,flexDirection:'row',alignItems:'center',gap:10},
  projectLabel:{color:colors.muted,fontSize:10,fontWeight:'800',letterSpacing:1},
  projectName:{color:colors.navy,fontSize:16,fontWeight:'800'},
  projectNone:{color:colors.muted,fontWeight:'700'},
  change:{color:colors.brand,fontSize:14,fontWeight:'800'},
  groups:{gap:14,paddingBottom:6},
  group:{gap:8},
  sectionRow:{flexDirection:'row',alignItems:'center',gap:8},
  section:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1.2},
  sectionLine:{flex:1,height:1,backgroundColor:colors.line},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:8},
  tile:{flexBasis:'48%',flexGrow:1,minHeight:64,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:16,padding:11,flexDirection:'row',alignItems:'center',gap:10},
  tilePrimary:{flexBasis:'100%',borderWidth:2,borderColor:colors.brand,backgroundColor:colors.cream,minHeight:70},
  badge:{width:38,height:38,borderRadius:12,alignItems:'center',justifyContent:'center'},
  tileTitle:{color:colors.ink,fontSize:14,fontWeight:'800',lineHeight:18},
  tileHint:{color:colors.muted,fontSize:11,lineHeight:15,marginTop:1},
  tag:{position:'absolute',top:6,right:6,fontSize:9,fontWeight:'800',color:colors.warning,backgroundColor:'#FFF4DC',borderWidth:1,borderColor:'#E8CB8A',borderRadius:999,paddingHorizontal:6,paddingVertical:1,overflow:'hidden'},
  arrow:{color:colors.brand,fontSize:24,fontWeight:'900'},
});
