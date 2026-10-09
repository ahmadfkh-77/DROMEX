import {useMemo,useState} from 'react';
import {Pressable,StyleSheet,Text,TextInput,View} from 'react-native';

import {customerFilterSummary,type CustomerChoice} from '../../../domain/companyTotals';
import {colors} from '../../theme';
import {FocusedSheet,SheetActions} from '../FocusedSheet';

/**
 * The customer filter: a field showing who is chosen, opening a sheet where one or several customers are ticked.
 * "No customer / Internal" is its own option, so the owner's own projects and loads with no customer stay reachable.
 * Nothing ticked means every customer, exactly as before the filter existed.
 */
export function CustomerFilter({choices,selected,onChange,note}:{choices:CustomerChoice[];selected:string[];onChange:(keys:string[])=>void;
  /** Shown under the list, e.g. that supplier deliveries are hidden while a customer is chosen. */
  note?:string}){
  const [open,setOpen]=useState(false);
  const [draft,setDraft]=useState<string[]>(selected);
  const [search,setSearch]=useState('');
  const visible=useMemo(()=>{const query=search.trim().toLocaleLowerCase('en-US');return query?choices.filter(choice=>choice.name.toLocaleLowerCase('en-US').includes(query)):choices;},[choices,search]);
  const summary=customerFilterSummary(selected,choices.map(choice=>({key:choice.key,name:choice.name})));
  const show=()=>{setDraft(selected);setSearch('');setOpen(true);};
  const toggle=(key:string)=>setDraft(current=>current.includes(key)?current.filter(value=>value!==key):[...current,key]);
  const apply=()=>{onChange(draft);setOpen(false);};
  return <View style={styles.field}>
    <Text style={styles.label}>Customer</Text>
    <Pressable style={({pressed})=>[styles.control,pressed&&styles.pressed]} onPress={show} accessibilityRole="button" accessibilityLabel={`Customer filter. ${summary}. Opens the customer list.`}>
      <Text style={[styles.value,!selected.length&&styles.placeholder]} numberOfLines={1}>{summary}</Text>
      <Text style={styles.chevron} importantForAccessibility="no">›</Text>
    </Pressable>
    <FocusedSheet visible={open} eyebrow="FILTER" title="Customer" onClose={()=>setOpen(false)} footer={<SheetActions primaryLabel={draft.length?`Apply (${draft.length})`:'Apply'} onPrimary={apply} onCancel={()=>setOpen(false)}/>}>
      <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="Search customers…" placeholderTextColor={colors.muted} autoCorrect={false} accessibilityLabel="Search customers"/>
      {visible.map(choice=>{
        const on=draft.includes(choice.key);
        const meta=`${choice.projectCount} project${choice.projectCount===1?'':'s'} · ${choice.loadCount} load${choice.loadCount===1?'':'s'}`;
        return <Pressable key={choice.key} style={[styles.option,choice.isOwnCompany&&styles.optionSpecial]} onPress={()=>toggle(choice.key)} accessibilityRole="checkbox" accessibilityState={{checked:on}} accessibilityLabel={`${choice.name}. ${meta}.`}>
          <View style={[styles.box,on&&styles.boxOn]}>{on?<Text style={styles.tick}>✓</Text>:null}</View>
          <View style={styles.optionCopy}>
            <Text style={styles.optionName} numberOfLines={2}>{choice.name}</Text>
            <Text style={styles.optionMeta}>{choice.isOwnCompany?'Own company projects and loads with no customer':meta}</Text>
          </View>
        </Pressable>;
      })}
      {!visible.length?<Text style={styles.empty}>No customer matches “{search.trim()}”.</Text>:null}
      <Text style={styles.hint}>{draft.length?`${draft.length} selected`:'None selected: every customer'} · works together with the date range, project, item, series and status filters.</Text>
      {note?<Text style={styles.hint}>{note}</Text>:null}
      {draft.length?<Pressable onPress={()=>setDraft([])} style={styles.clear} accessibilityRole="button"><Text style={styles.clearText}>Clear customers</Text></Pressable>:null}
    </FocusedSheet>
  </View>;
}

const styles=StyleSheet.create({
  field:{gap:6},label:{color:colors.ink,fontSize:13,fontWeight:'800'},
  control:{minHeight:49,borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,flexDirection:'row',alignItems:'center',gap:8,backgroundColor:colors.surface},
  pressed:{opacity:.7},value:{flex:1,color:colors.ink,fontSize:15,fontWeight:'700'},placeholder:{color:colors.muted,fontWeight:'500'},chevron:{color:colors.brand,fontSize:22,fontWeight:'700'},
  search:{minHeight:49,borderWidth:1,borderColor:colors.navy,borderRadius:11,paddingHorizontal:13,fontSize:15,color:colors.ink,backgroundColor:colors.surface,marginBottom:6},
  option:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12,paddingHorizontal:4,borderBottomWidth:1,borderBottomColor:colors.line,minHeight:56},
  optionSpecial:{backgroundColor:'#FFF8E5'},box:{width:24,height:24,borderRadius:6,borderWidth:2,borderColor:'#9AA3AB',alignItems:'center',justifyContent:'center',backgroundColor:colors.surface},
  boxOn:{backgroundColor:colors.brand,borderColor:colors.brand},tick:{color:'#FFFFFF',fontSize:15,fontWeight:'900'},optionCopy:{flex:1,gap:2},
  optionName:{color:colors.ink,fontSize:15,fontWeight:'800'},optionMeta:{color:colors.muted,fontSize:12.5},empty:{color:colors.muted,fontStyle:'italic',paddingVertical:12},
  hint:{color:colors.muted,fontSize:12.5,lineHeight:18,marginTop:6},clear:{minHeight:44,borderWidth:1,borderColor:colors.navy,borderRadius:12,alignItems:'center',justifyContent:'center',marginTop:8,backgroundColor:colors.surface},
  clearText:{color:colors.navy,fontWeight:'800',fontSize:15},
});
