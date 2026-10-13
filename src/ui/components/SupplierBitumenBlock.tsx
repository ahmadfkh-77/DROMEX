import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {formatKg,formatTons,formatUsd,type SupplierBitumenSummary} from '../../domain/bitumen';
import {colors} from '../theme';

/**
 * One supplier's bitumen deliveries, drawn like the diesel block in the Delivery Summary and in Purchase history: a navy title bar,
 * the kilograms as one large number, chips for the batch count, the tons, the priced amount and Unpriced, then one row per batch with
 * its grade, invoice and price, and an Open link. Kilograms are never added to litres, tons of material or any other quantity.
 */
export function SupplierBitumenBlock({bitumen,onOpenBatch}:{bitumen:SupplierBitumenSummary;onOpenBatch?:(batchId:string)=>void}){
  return <View style={styles.block} accessibilityRole="summary">
    <View style={styles.bar}><Text style={styles.title}>BITUMEN DELIVERIES</Text><Text style={styles.separate}>separate from materials</Text></View>
    <View style={styles.hero}><Text style={styles.kg}>{bitumen.totalKg.toLocaleString('en-US',{maximumFractionDigits:3})}</Text><Text style={styles.unit}>kg</Text></View>
    <View style={styles.chips}>
      <Text style={styles.chip}>{bitumen.batchCount} batch{bitumen.batchCount===1?'':'es'}</Text>
      <Text style={styles.chip}>{formatTons(bitumen.totalKg)}</Text>
      {bitumen.pricedAmountUsd!=null?<Text style={styles.chip}>{formatUsd(bitumen.pricedAmountUsd)} priced</Text>:null}
      {bitumen.unpricedNote?<Text style={[styles.chip,styles.chipWarn]}>{bitumen.unpricedNote}</Text>:null}
    </View>
    {bitumen.rows.map(row=><TouchableOpacity key={row.batchId} style={styles.row} disabled={!onOpenBatch} onPress={()=>onOpenBatch?.(row.batchId)} accessibilityRole={onOpenBatch?'button':'text'} accessibilityLabel={`${row.day}, ${row.batchNumber}, ${formatKg(row.kg)}${onOpenBatch?'. Open the batch':''}`}>
      <View style={styles.rowCopy}>
        <Text style={styles.day}>{row.day}</Text>
        <Text style={styles.batch}>{row.batchNumber}<Text style={styles.grade}>  {row.gradeName}  </Text></Text>
        <Text style={styles.detail}>Invoice {row.invoiceNumber??'not recorded'} · {row.priceLabel}</Text>
      </View>
      <View style={styles.rowRight}><Text style={styles.rowKg}>{formatKg(row.kg)}</Text>{onOpenBatch?<Text style={styles.open}>Open ›</Text>:null}</View>
    </TouchableOpacity>)}
    {bitumen.cancelledCount?<Text style={styles.note}>Not counted: {bitumen.cancelledCount} cancelled batch{bitumen.cancelledCount===1?'':'es'}.</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  block:{marginHorizontal:12,marginBottom:12,borderRadius:14,borderWidth:1,borderColor:'#C7D3E2',overflow:'hidden',backgroundColor:colors.surface},
  bar:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10,paddingHorizontal:14,paddingVertical:10,backgroundColor:colors.navy},
  title:{color:colors.cream,fontSize:12,fontWeight:'900',letterSpacing:1},
  separate:{color:'#D5E4EF',fontSize:11},
  hero:{flexDirection:'row',alignItems:'baseline',paddingHorizontal:14,paddingTop:12,paddingBottom:4,gap:4},
  kg:{color:colors.navy,fontSize:30,fontWeight:'900'},
  unit:{color:colors.navy,fontSize:16,fontWeight:'800'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:6,paddingHorizontal:14,paddingBottom:10},
  chip:{color:colors.navy,fontSize:11,fontWeight:'700',borderRadius:999,borderWidth:1,borderColor:'#C7D3E2',backgroundColor:'#EEF2F7',paddingHorizontal:9,paddingVertical:2,overflow:'hidden'},
  chipWarn:{color:colors.warning,borderColor:'#F1CF83',backgroundColor:'#FFF4DC'},
  row:{flexDirection:'row',gap:12,paddingHorizontal:14,paddingVertical:10,minHeight:56,borderTopWidth:1,borderTopColor:colors.line,borderLeftWidth:3,borderLeftColor:colors.brand,backgroundColor:'#FFFEFC'},
  rowCopy:{flex:1,minWidth:0},
  day:{color:colors.muted,fontSize:12,fontWeight:'600'},
  batch:{color:colors.ink,fontSize:15,fontWeight:'700'},
  grade:{color:colors.navy,fontSize:11,fontWeight:'700',backgroundColor:'#EEF2F7'},
  detail:{color:colors.muted,fontSize:12,marginTop:2},
  rowRight:{justifyContent:'space-between',alignItems:'flex-end'},
  rowKg:{color:colors.ink,fontSize:17,fontWeight:'900'},
  open:{color:colors.navy,fontSize:12,fontWeight:'700'},
  note:{color:colors.muted,fontSize:12,paddingHorizontal:14,paddingVertical:8,backgroundColor:'#F7F5F0'},
});
