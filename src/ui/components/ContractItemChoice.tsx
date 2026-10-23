import {useEffect,useMemo,useState} from 'react';
import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import type {ContractQuantitiesRepository,ContractRowView} from '../../data/repositories/ContractQuantitiesRepository';
import {CONTRACT_NEAR_RATIO,contractChoiceIssue} from '../../domain/contractQuantities';
import {colors} from '../theme';

const amount=(value:number)=>String(Number(value.toFixed(3)));
const percent=(used:number,allowed:number)=>`${(Math.round((used/allowed)*1000)/10).toFixed(1)}%`;

/**
 * DEC-522 Phase C. "Counts toward target" inside Make Receipt and New Supplier Load (mockup tab 5). It shows nothing until the
 * project has targets, so a project without contracts records loads exactly as before. One fitting item is preselected with a Change
 * button; several ask for a pick (or Not linked); none says the load saves as not linked. Both units are always side by side, and the
 * 90% / over-contract notes never block Confirm. `value` is an item id, '' for Not linked, or undefined while nothing is chosen.
 */
export function ContractItemChoice({contracts,projectId,materialId,materialName,loadUnitId,loadUnitSymbol,loadQuantity,value,onChange,onIssue,onSelection,variant='card',refreshKey=0}:{
  contracts?:ContractQuantitiesRepository;projectId:string|null;materialId:string;materialName?:string;
  /** The unit the load is recorded in, and its quantity in that unit (null while not yet known). */
  loadUnitId:string|null;loadUnitSymbol:string;loadQuantity:number|null;
  value:string|undefined;onChange:(value:string|undefined)=>void;
  /** The message to show when Confirm or Next is pressed while several items fit and none is chosen, or null. */
  onIssue?:(issue:string|null)=>void;
  /** The chosen item's name, 'Not linked', or null while the choice is not shown, for a summary line elsewhere. */
  onSelection?:(label:string|null)=>void;
  /** `open` is the underlined Open form look of New Supplier Load; `card` is the bordered card of Make Receipt. */
  variant?:'card'|'open';
  /** Changes after a load is confirmed, so the used figures are read again. */
  refreshKey?:number;
}){
  const[rows,setRows]=useState<ContractRowView[]|null>(null);
  const[changing,setChanging]=useState(false);
  useEffect(()=>{
    let active=true;setRows(null);
    if(!contracts||!projectId){setRows([]);return;}
    contracts.listProject(projectId).then(view=>{if(active)setRows(view.rows.filter(row=>!row.item.cancelledAt));}).catch(()=>{if(active)setRows([]);});
    return()=>{active=false;};
  },[contracts,projectId,refreshKey]);
  const candidates=useMemo(()=>rows&&materialId?rows.filter(row=>row.item.materialIds.includes(materialId)):[],[rows,materialId]);
  const ids=candidates.map(row=>row.item.id).join('|');
  useEffect(()=>{
    if(rows===null)return;
    const list=ids?ids.split('|'):[];
    if(value&&!list.includes(value)){onChange(undefined);return;}
    if(value===undefined&&list.length===1){onChange(list[0]);return;}
    if(!list.length&&value!==undefined)onChange(undefined);
  },[rows,ids,value,onChange]);
  useEffect(()=>setChanging(false),[projectId,materialId]);
  const issue=rows===null?null:contractChoiceIssue(candidates.map(row=>row.item),value);
  useEffect(()=>{onIssue?.(issue);},[issue,onIssue]);
  useEffect(()=>()=>onIssue?.(null),[onIssue]);
  const selection=rows===null?undefined:!rows.length||!materialId?null:value===''||!candidates.length?'Not linked':candidates.find(row=>row.item.id===value)?.item.name??null;
  useEffect(()=>{if(selection!==undefined)onSelection?.(selection);},[selection,onSelection]);

  if(!rows||!rows.length||!materialId)return null;
  const open=variant==='open';
  const several=candidates.length>1;
  const picking=candidates.length>0&&(changing||(several&&value===undefined));
  const chosen=value?candidates.find(row=>row.item.id===value)??null:null;
  const pick=(next:string)=>{onChange(next);setChanging(false);};

  return <View style={open?styles.openGroup:styles.card}>
    <Text style={open?styles.openLabel:styles.label}>{open?'TARGET':'Counts toward target'}{several?' *':''}</Text>
    {!candidates.length?<Text style={[styles.note,styles.quiet]}>Not linked to a target. {materialName??'This material'} is in no target of this project. The load saves as usual.</Text>:null}
    {picking?<View style={styles.list}>
      {several&&value===undefined?<Text style={styles.helper}>{materialName??'This material'} is in {candidates.length} items of this project. Choose one.</Text>:null}
      {candidates.map(row=><Choice key={row.item.id} on={value===row.item.id} title={row.item.name} detail={`${amount(row.usage.used)} of ${amount(row.item.quantity)} ${row.item.unitSymbol} used · ${row.usage.overContract?'over target':percent(row.usage.used,row.item.quantity)}${row.item.status==='complete'?' · Complete':''}`} unit={row.item.unitSymbol} onPress={()=>pick(row.item.id)}/>)}
      <Choice on={value===''} title="Not linked to a target" onPress={()=>pick('')}/>
    </View>:null}
    {!picking&&candidates.length?<View style={styles.selected}>
      <View style={styles.selectedCopy}>
        <Text style={styles.selectedTitle} numberOfLines={2}>{chosen?chosen.item.name:'Not linked to a target'}</Text>
        {chosen?<Text style={styles.helper}>{amount(chosen.usage.used)} of {amount(chosen.item.quantity)} {chosen.item.unitSymbol} used · {percent(chosen.usage.used,chosen.item.quantity)}{chosen.item.status==='complete'?' · Complete':''}</Text>:null}
      </View>
      <TouchableOpacity style={styles.change} onPress={()=>setChanging(true)} accessibilityRole="button" accessibilityLabel="Change the target"><Text style={styles.changeText}>Change</Text></TouchableOpacity>
    </View>:null}
    {chosen&&!picking?<Preview row={chosen} loadUnitId={loadUnitId} loadUnitSymbol={loadUnitSymbol} loadQuantity={loadQuantity}/>:null}
  </View>;
}

function Choice({on,title,detail,unit,onPress}:{on:boolean;title:string;detail?:string;unit?:string;onPress:()=>void}){
  return <TouchableOpacity style={[styles.choice,on&&styles.choiceOn]} onPress={onPress} accessibilityRole="radio" accessibilityState={{selected:on}}>
    <View style={[styles.radio]}>{on?<View style={styles.radioDot}/>:null}</View>
    <View style={styles.selectedCopy}><Text style={styles.choiceTitle}>{title}</Text>{detail?<Text style={styles.helper}>{detail}</Text>:null}</View>
    {unit?<Text style={styles.unit}>{unit}</Text>:null}
  </TouchableOpacity>;
}

function Preview({row,loadUnitId,loadUnitSymbol,loadQuantity}:{row:ContractRowView;loadUnitId:string|null;loadUnitSymbol:string;loadQuantity:number|null}){
  const {item,usage}=row;
  const same=loadUnitId!==null&&loadUnitId===item.unitId;
  const notes:{tone:'amber'|'red'|'quiet';text:string}[]=[];
  if(loadUnitId&&!same)notes.push({tone:'amber',text:`Unit differs. This load is in ${loadUnitSymbol||'another unit'} and the item counts ${item.unitSymbol}. The load is saved but not counted; it is listed under Not counted, unit differs. Nothing is converted.`});
  if(item.status==='complete')notes.push({tone:'amber',text:'This item is finished. The load will still count as used, and the item will be flagged.'});
  if(same&&loadQuantity!==null&&loadQuantity>0){
    const after=usage.used+loadQuantity,line=`${amount(after)} of ${amount(item.quantity)} ${item.unitSymbol} · ${percent(after,item.quantity)}`;
    if(usage.overContract)notes.push({tone:'red',text:`${item.name} is already over target. This load will add ${amount(loadQuantity)} ${item.unitSymbol} (now ${line}). You can still confirm.`});
    else if(after>item.quantity+1e-9)notes.push({tone:'red',text:`This load takes ${item.name} over target: ${line}. You can still confirm.`});
    else if(after/item.quantity>=CONTRACT_NEAR_RATIO-1e-9)notes.push({tone:'amber',text:`After this load: ${line}. You can still confirm.`});
    else notes.push({tone:'quiet',text:`After this load: ${line}.`});
  }
  return <View style={styles.list}>
    {loadUnitId?<View style={styles.unitPair}>
      <Text style={styles.unitPairText}>Load</Text><Text style={[styles.unit,!same&&styles.unitBad]}>{loadUnitSymbol}</Text>
      <Text style={styles.unitPairText}>· Item</Text><Text style={styles.unit}>{item.unitSymbol}</Text>
      {same?<Text style={styles.unitPairText}>· same unit, counted</Text>:null}
    </View>:null}
    {notes.map(note=><Text key={note.text} style={[styles.note,note.tone==='amber'?styles.amber:note.tone==='red'?styles.red:styles.quiet]}>{note.text}</Text>)}
  </View>;
}

const styles=StyleSheet.create({
  card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.line,borderRadius:16,padding:14,gap:8},
  openGroup:{gap:8,borderTopWidth:1,borderTopColor:colors.line,paddingTop:14,marginTop:16},
  label:{color:colors.ink,fontSize:14,fontWeight:'800'},
  openLabel:{color:colors.muted,fontSize:11,fontWeight:'900',letterSpacing:1.2},
  helper:{color:colors.muted,fontSize:12.5,lineHeight:18},
  list:{gap:8},
  selected:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1.5,borderColor:colors.navy,borderRadius:12,paddingHorizontal:12,paddingVertical:8,backgroundColor:colors.surface},
  selectedCopy:{flex:1,minWidth:0},
  selectedTitle:{color:colors.ink,fontSize:15,fontWeight:'800'},
  change:{minHeight:44,minWidth:64,alignItems:'center',justifyContent:'center'},
  changeText:{color:colors.brand,fontSize:14,fontWeight:'800'},
  choice:{minHeight:56,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1.5,borderColor:'#CFC8BB',borderRadius:12,paddingHorizontal:12,paddingVertical:8,backgroundColor:colors.surface},
  choiceOn:{borderColor:colors.navy,backgroundColor:'#F1F5FA'},
  choiceTitle:{color:colors.ink,fontSize:14,fontWeight:'800'},
  radio:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:colors.navy,alignItems:'center',justifyContent:'center'},
  radioDot:{width:11,height:11,borderRadius:6,backgroundColor:colors.navy},
  unit:{color:colors.navy,backgroundColor:'#E8EDF3',fontSize:12,fontWeight:'800',borderRadius:8,paddingHorizontal:8,paddingVertical:3,overflow:'hidden'},
  unitBad:{color:colors.danger,backgroundColor:'#FDECEA'},
  unitPair:{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:6},
  unitPairText:{color:colors.muted,fontSize:12,fontWeight:'700'},
  note:{borderRadius:12,paddingHorizontal:12,paddingVertical:10,fontSize:13,lineHeight:19,borderWidth:1,overflow:'hidden'},
  amber:{backgroundColor:'#FFF4DC',borderColor:'#EFC979',color:'#5E3A00'},
  red:{backgroundColor:'#FDECEA',borderColor:'#F0ABA4',color:'#6E120B'},
  quiet:{backgroundColor:'#EEF2F6',borderColor:'#D3DDE7',color:'#24384D'},
});
