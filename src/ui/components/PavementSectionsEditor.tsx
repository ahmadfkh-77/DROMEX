import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';
import {duplicateSectionText,nextSectionWidthStart,type PavementSectionText,type PavementSectionsAnalysis} from '../../domain/pavement';
import {blankSection} from '../../domain/pavementForm';
import {colors} from '../theme';
import {AppField,Feedback} from './AppPrimitives';

const format=(value:number,digits=1)=>value.toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});

/**
 * The Road sections of the Area page (DEC-518). The area rule is a plain note that is always on screen above the first section, never inside a
 * folded label or a popup. A section that has a problem is named in one error panel once the owner has tried to move on; nothing is counted as zero.
 */
export const AREA_RULE_TITLE='Section area = Length × (Width 1 + Width 2) ÷ 2.';
export const AREA_RULE_BODY='Example: 10 × (4 + 4.4) ÷ 2 = 42.0 m². Total area = the sum of all section areas. Straight edges are assumed inside each section: if the road bends or the width changes unevenly, split it into more sections.';

export function PavementSectionsEditor({sections,analysis,showErrors,onChange}:{sections:PavementSectionText[];analysis:PavementSectionsAnalysis;showErrors:boolean;onChange:(next:PavementSectionText[])=>void}){
  const update=(index:number,key:keyof PavementSectionText,value:string)=>onChange(sections.map((section,i)=>i===index?{...section,[key]:value}:section));
  const duplicate=(index:number)=>onChange([...sections.slice(0,index+1),duplicateSectionText(sections[index]!),...sections.slice(index+1)]);
  const remove=(index:number)=>onChange(sections.filter((_,i)=>i!==index));
  const add=()=>onChange([...sections,{...blankSection(),widthStart:nextSectionWidthStart(sections)}]);
  return <View style={styles.wrap}>
    <View style={styles.note} accessibilityRole="text"><Text style={styles.noteTitle}>{AREA_RULE_TITLE}</Text><Text style={styles.noteBody}>{AREA_RULE_BODY}</Text></View>
    {showErrors&&analysis.errors.length?<Feedback kind="error">{analysis.errors.join('\n')}</Feedback>:null}
    {sections.map((section,index)=>{const area=analysis.areas[index]??null;return <View key={index} style={styles.section}>
      <View style={styles.head}><Text style={styles.title}>Section {index+1}</Text><Text style={[styles.area,area===null&&styles.areaNone]}>{area===null?'—':`${format(area)} m²`}</Text></View>
      <AppField variant="open" label="Name (optional)" value={section.name} onChangeText={value=>update(index,'name',value)} placeholder="e.g. Station 0+000–0+010"/>
      <View style={styles.three}>
        <View style={styles.cell}><AppField variant="open" label="Length (m)" value={section.length} onChangeText={value=>update(index,'length',value)} keyboardType="decimal-pad"/></View>
        <View style={styles.cell}><AppField variant="open" label="Width 1" value={section.widthStart} onChangeText={value=>update(index,'widthStart',value)} keyboardType="decimal-pad"/></View>
        <View style={styles.cell}><AppField variant="open" label="Width 2" value={section.widthEnd} onChangeText={value=>update(index,'widthEnd',value)} keyboardType="decimal-pad"/></View>
      </View>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.action} onPress={()=>duplicate(index)} accessibilityRole="button" accessibilityLabel={`Duplicate section ${index+1}`}><Text style={styles.link}>Duplicate</Text></TouchableOpacity>
        <TouchableOpacity style={styles.action} disabled={sections.length<=1} onPress={()=>remove(index)} accessibilityRole="button" accessibilityLabel={`Remove section ${index+1}`}><Text style={[styles.remove,sections.length<=1&&styles.removeOff]}>Remove</Text></TouchableOpacity>
      </View>
    </View>;})}
    <TouchableOpacity style={styles.add} onPress={add} accessibilityRole="button"><Text style={styles.link}>+ Add section</Text><Text style={styles.addHint}>Width 1 starts at the last Width 2</Text></TouchableOpacity>
    <View style={styles.total}><Text style={styles.totalLabel}>TOTAL AREA · {sections.length} SECTION{sections.length===1?'':'S'}</Text><Text style={styles.totalValue}>{analysis.totalM2===null?'—':`${format(analysis.totalM2)} m²`}</Text></View>
  </View>;
}

const styles=StyleSheet.create({
  wrap:{gap:12},
  note:{backgroundColor:'#E9EEF4',borderRadius:12,padding:12,gap:4},
  noteTitle:{color:colors.ink,fontSize:14,fontWeight:'800',lineHeight:20},
  noteBody:{color:colors.navy,fontSize:13,lineHeight:20},
  section:{borderTopWidth:1,borderTopColor:colors.line,paddingTop:12,gap:8},
  head:{flexDirection:'row',justifyContent:'space-between',alignItems:'baseline'},
  title:{color:colors.navy,fontSize:15,fontWeight:'800'},
  area:{color:colors.resultDark,fontSize:15,fontWeight:'900'},
  areaNone:{color:colors.muted},
  three:{flexDirection:'row',gap:10},
  cell:{flex:1,minWidth:0},
  actions:{flexDirection:'row',gap:20},
  action:{minHeight:44,justifyContent:'center'},
  link:{color:colors.brand,fontSize:13,fontWeight:'800'},
  remove:{color:colors.danger,fontSize:13,fontWeight:'800'},
  removeOff:{opacity:.35},
  add:{minHeight:48,justifyContent:'center',gap:2},
  addHint:{color:colors.muted,fontSize:11},
  total:{backgroundColor:colors.result,borderWidth:2,borderColor:colors.resultDark,borderRadius:14,padding:14,gap:2},
  totalLabel:{color:colors.resultSoft,fontSize:10,fontWeight:'900',letterSpacing:.9},
  totalValue:{color:'#FFF',fontSize:26,fontWeight:'900'},
});
