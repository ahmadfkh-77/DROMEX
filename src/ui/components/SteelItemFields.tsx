import {StyleSheet,Text,View} from 'react-native';

import {calculatedPatch,calculateRebarLine,calculatedWeightChanged,comparisonText,formatKgFixed,formatMeters,type WeightSource} from '../../domain/rebar';
import {colors} from '../theme';
import {AppButton,AppField} from './AppPrimitives';

/**
 * What a steel item adds under its Quantity and Pieces: the length per bar (typed with or without the calculator), the meters,
 * "Calculated X kg, entered Y kg, difference Z kg (p%)" and, when a weight that came from the calculator no longer matches
 * its diameter, length or pieces, the question "Calculated weight changed, update?". Nothing here changes a weight by
 * itself: Update and Keep are the owner's choice.
 */
const parse=(value:string)=>Number(value.trim().replace(',','.'));

export function SteelItemFields({isSteel,quantity,pieces,length,diameter,calc,source,density,onLength,onResolve}:{
  isSteel:boolean;quantity:string;pieces:string;length:string;diameter:string;calc:string;source:''|WeightSource|undefined;density:number;
  onLength:(value:string)=>void;onResolve:(patch:{quantity:string;calc:string;source:WeightSource})=>void}){
  const calcKg=calc.trim()?parse(calc):null;
  const line=calculateRebarLine({diameterMm:parse(diameter),lengthPerBarM:parse(length),pieces:parse(pieces)},density);
  const meters=parse(pieces)>0&&parse(length)>0?parse(pieces)*parse(length):null;
  const changed=calculatedWeightChanged(source||null,calcKg,line);
  const comparison=comparisonText(calcKg,quantity.trim()?parse(quantity):null);
  if(!isSteel&&!length&&!calc)return null;
  return <View style={styles.wrap}>
    {isSteel?<AppField label="Length per bar (m, optional)" value={length} onChangeText={value=>onLength(value.replace(/[^0-9.,]/g,''))} keyboardType="decimal-pad" placeholder="e.g. 6"/>:null}
    {meters!=null?<Text style={styles.helper}>Total meters: {formatMeters(meters)} m ({pieces} pcs × {length} m)</Text>:null}
    {comparison?<View style={styles.compare}><Text style={styles.compareText}>{comparison}. {source==='calculated'?'The calculated weight is used.':'The weight you entered is the quantity used.'}</Text></View>:null}
    {changed&&line?<View style={styles.warn}>
      <Text style={styles.warnTitle}>Calculated weight changed, update?</Text>
      <Text style={styles.warnText}>{diameter} mm × {length} m × {pieces} pieces is now {formatKgFixed(line.weightKg)} kg. The saved weight is still {quantity} kg.</Text>
      <View style={styles.buttons}>
        <View style={styles.button}><AppButton label={`Update to ${formatKgFixed(line.weightKg)}`} onPress={()=>onResolve(calculatedPatch(line.weightKg))}/></View>
        <View style={styles.button}><AppButton label={`Keep ${quantity}`} tone="secondary" onPress={()=>onResolve({quantity,calc:String(line.weightKg),source:'typed'})}/></View>
      </View>
    </View>:null}
  </View>;
}

const styles=StyleSheet.create({
  wrap:{gap:8},
  helper:{fontSize:13,color:colors.muted},
  compare:{backgroundColor:'#EAF1F6',borderColor:'#9DB6CE',borderWidth:1,borderRadius:12,padding:10},compareText:{fontSize:13,color:colors.ink},
  warn:{backgroundColor:'#FFF4DC',borderColor:'#F1CF83',borderWidth:1,borderRadius:12,padding:10,gap:6},
  warnTitle:{fontWeight:'800',color:colors.ink},warnText:{fontSize:13,color:colors.ink},
  buttons:{flexDirection:'row',gap:8},button:{flex:1},
});
