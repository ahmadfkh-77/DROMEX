import {useState} from 'react';
import {LayoutAnimation,StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {layerAppearance,validateWallLayers,type WallLayerDraft} from '../../domain/wallDiagram';
import {colors,radius} from '../theme';
import {AppButton,AppField} from './AppPrimitives';
import {useReducedMotion} from './ExpandableMenu';

export type LayerRowForm={name:string;phaseOrder:number;bottom:string;top:string;uniform:boolean;note:string};
export const emptyLayerRow=(phaseOrder:number):LayerRowForm=>({name:'',phaseOrder,bottom:'',top:'',uniform:true,note:''});
const n=(value:string)=>{const parsed=Number(value.trim().replace(',','.'));return Number.isFinite(parsed)?parsed:Number.NaN;};
const metres=(value:number)=>`${Number(value.toFixed(3))} m`;

export const layerRowsFromDrafts=(layers:{name:string;phaseOrder:number;bottomThicknessM:number;topThicknessM:number;note:string}[]):LayerRowForm[]=>
  layers.map(layer=>({name:layer.name,phaseOrder:layer.phaseOrder,bottom:String(layer.bottomThicknessM),top:String(layer.topThicknessM),uniform:layer.bottomThicknessM===layer.topThicknessM,note:layer.note}));
export const layerDraftsFromRows=(rows:LayerRowForm[]):WallLayerDraft[]=>
  rows.map((row,index)=>({name:row.name.trim(),phaseOrder:index+1,bottomThicknessM:n(row.bottom),topThicknessM:row.uniform?n(row.bottom):n(row.top),note:row.note,materialKey:null}));

/**
 * DEC-457. Layers and construction phases for one wall. Phase order is the list order, so reordering a
 * row renumbers the phases and can never produce a duplicate. Totals are shown against the wall's own
 * thickness; an entered thickness is never adjusted to make the sums agree.
 */
export function WallLayersEditor({rows,wall,busy,onChange,onSave}:{rows:LayerRowForm[];wall:{bottomThicknessM:number;topThicknessM:number};busy:boolean;onChange:(rows:LayerRowForm[])=>void;onSave:(drafts:WallLayerDraft[])=>void}){
  const[confirmRemove,setConfirmRemove]=useState<number|null>(null);
  const reducedMotion=useReducedMotion();
  const animate=()=>{if(!reducedMotion)LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);};
  const drafts=layerDraftsFromRows(rows);
  const issues=rows.length?validateWallLayers(drafts,wall):[];
  const totals={bottom:drafts.reduce((sum,layer)=>sum+(Number.isFinite(layer.bottomThicknessM)?layer.bottomThicknessM:0),0),top:drafts.reduce((sum,layer)=>sum+(Number.isFinite(layer.topThicknessM)?layer.topThicknessM:0),0)};

  const update=(index:number,patch:Partial<LayerRowForm>)=>onChange(rows.map((row,position)=>position===index?{...row,...patch}:row));
  const move=(index:number,direction:-1|1)=>{
    const target=index+direction;if(target<0||target>=rows.length)return;
    animate();const next=[...rows];[next[index],next[target]]=[next[target]!,next[index]!];
    onChange(next.map((row,position)=>({...row,phaseOrder:position+1})));
  };
  const remove=(index:number)=>{animate();setConfirmRemove(null);onChange(rows.filter((_,position)=>position!==index).map((row,position)=>({...row,phaseOrder:position+1})));};

  return <View style={styles.editor}>
    <Text style={styles.title}>Layers and construction phases</Text>
    <Text style={styles.helper}>Optional. Record each layer from the inside outwards, in the order it is built. Phase numbers follow this list. The layer thicknesses must add up to the wall thickness.</Text>

    {rows.map((row,index)=>{
      const appearance=layerAppearance(row.name||`layer-${index}`,index+1);
      return <View key={index} style={styles.row}>
        <View style={styles.rowHead}>
          <View style={[styles.swatch,{backgroundColor:appearance.fill}]}><Text style={styles.swatchText}>{index+1}</Text></View>
          <Text style={styles.phase}>Phase {index+1}</Text>
          <View style={styles.rowActions}>
            <TouchableOpacity style={styles.smallButton} disabled={index===0} onPress={()=>move(index,-1)} accessibilityRole="button" accessibilityLabel={`Move ${row.name||`layer ${index+1}`} up`}><Text style={[styles.smallButtonText,index===0&&styles.disabled]}>Move up</Text></TouchableOpacity>
            <TouchableOpacity style={styles.smallButton} disabled={index===rows.length-1} onPress={()=>move(index,1)} accessibilityRole="button" accessibilityLabel={`Move ${row.name||`layer ${index+1}`} down`}><Text style={[styles.smallButtonText,index===rows.length-1&&styles.disabled]}>Move down</Text></TouchableOpacity>
            <TouchableOpacity style={styles.smallButton} onPress={()=>{animate();setConfirmRemove(confirmRemove===index?null:index);}} accessibilityRole="button" accessibilityLabel={`Remove ${row.name||`layer ${index+1}`}`}><Text style={[styles.smallButtonText,styles.removeText]}>Remove</Text></TouchableOpacity>
          </View>
        </View>
        {confirmRemove===index
          ?<View style={styles.confirm}>
            <Text style={styles.confirmText}>Remove this layer from the list? Nothing is saved until you save the layers.</Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.smallButton} onPress={()=>remove(index)} accessibilityRole="button"><Text style={[styles.smallButtonText,styles.removeText]}>Yes, remove</Text></TouchableOpacity>
              <TouchableOpacity style={styles.smallButton} onPress={()=>{animate();setConfirmRemove(null);}} accessibilityRole="button"><Text style={styles.smallButtonText}>Keep layer</Text></TouchableOpacity>
            </View>
          </View>
          :null}
        <AppField label="Material or layer name *" value={row.name} onChangeText={name=>update(index,{name})} placeholder="Example: Stone facing"/>
        <View style={styles.pair}>
          <View style={styles.flex}><AppField label="Bottom thickness (m) *" value={row.bottom} onChangeText={bottom=>update(index,{bottom})} keyboardType="decimal-pad"/></View>
          <View style={styles.flex}>{row.uniform
            ?<View style={styles.uniformBox}><Text style={styles.uniformLabel}>Top thickness</Text><Text style={styles.uniformValue}>{row.bottom.trim()?`${row.bottom} m`:'Same as bottom'}</Text></View>
            :<AppField label="Top thickness (m) *" value={row.top} onChangeText={top=>update(index,{top})} keyboardType="decimal-pad"/>}</View>
        </View>
        <TouchableOpacity style={styles.checkRow} onPress={()=>update(index,{uniform:!row.uniform,top:row.uniform?row.bottom:row.top})} accessibilityRole="checkbox" accessibilityState={{checked:row.uniform}}>
          <View style={[styles.check,row.uniform&&styles.checkOn]}>{row.uniform?<Text style={styles.checkMark}>✓</Text>:null}</View>
          <Text style={styles.checkLabel}>Same thickness top and bottom</Text>
        </TouchableOpacity>
        <AppField label="Layer note" value={row.note} onChangeText={note=>update(index,{note})} placeholder="Optional"/>
      </View>;
    })}

    <View style={styles.totals}>
      <Text style={styles.totalsText}>Layers total: bottom {metres(totals.bottom)} of {metres(wall.bottomThicknessM)} · top {metres(totals.top)} of {metres(wall.topThicknessM)}</Text>
    </View>
    {issues.length?<View accessibilityLiveRegion="polite">{issues.map(issue=><Text key={issue} style={styles.issue}>{issue}</Text>)}</View>:null}

    <AppButton label="Add Layer" tone="secondary" onPress={()=>{animate();onChange([...rows,emptyLayerRow(rows.length+1)]);}}/>
    <AppButton label={rows.length?'Save Layers':'Save Without Layers'} tone="navy" busy={busy} disabled={issues.length>0} onPress={()=>onSave(drafts)} hint={rows.length?'Stores the layers and redraws the diagram':'Keeps this wall with a geometry-only diagram'}/>
  </View>;
}

const styles=StyleSheet.create({
  editor:{gap:11},
  title:{color:colors.ink,fontSize:15,fontWeight:'900'},
  helper:{color:colors.muted,fontSize:12,lineHeight:17},
  row:{gap:9,backgroundColor:colors.surface,borderRadius:radius.md,borderWidth:1,borderColor:colors.line,padding:12},
  rowHead:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},
  swatch:{width:22,height:22,borderRadius:6,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.ink},
  swatchText:{color:'#FFFFFF',fontSize:11,fontWeight:'900'},
  phase:{flex:1,minWidth:70,color:colors.ink,fontSize:13,fontWeight:'900'},
  rowActions:{flexDirection:'row',gap:4},
  smallButton:{minHeight:44,justifyContent:'center',paddingHorizontal:8},
  smallButtonText:{color:colors.navy,fontSize:12,fontWeight:'900'},
  removeText:{color:colors.danger},
  disabled:{color:colors.muted,opacity:.5},
  confirm:{gap:6,backgroundColor:'#FCE8E6',borderRadius:radius.sm,padding:10},
  confirmText:{color:colors.ink,fontSize:12,lineHeight:17},
  confirmActions:{flexDirection:'row',gap:6},
  pair:{flexDirection:'row',gap:10},
  flex:{flex:1,minWidth:0},
  uniformBox:{minHeight:49,justifyContent:'center',borderWidth:1,borderColor:colors.line,borderRadius:11,paddingHorizontal:13,backgroundColor:colors.creamSoft},
  uniformLabel:{color:colors.muted,fontSize:11,fontWeight:'800'},
  uniformValue:{color:colors.ink,fontSize:14,fontWeight:'800'},
  checkRow:{minHeight:44,flexDirection:'row',alignItems:'center',gap:9},
  check:{width:22,height:22,borderRadius:6,borderWidth:2,borderColor:colors.muted,alignItems:'center',justifyContent:'center'},
  checkOn:{borderColor:colors.navy,backgroundColor:colors.navy},
  checkMark:{color:'#FFFFFF',fontSize:13,fontWeight:'900'},
  checkLabel:{color:colors.ink,fontSize:13,fontWeight:'700'},
  totals:{backgroundColor:colors.resultSoft,borderRadius:radius.sm,padding:10},
  totalsText:{color:colors.resultDark,fontSize:12,fontWeight:'800',lineHeight:17},
  issue:{color:colors.danger,fontSize:12,fontWeight:'800',lineHeight:17},
});
