import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {formatFuelPriceUsd} from '../../domain/fuel';
import type {SupplierDieselSummary} from '../../domain/supplierDiesel';
import {colors} from '../theme';

/**
 * One supplier's diesel deliveries, drawn the same way in the Delivery Summary and in Purchase history: a navy title bar, the litres
 * as one large number, small chips for the batch count, the priced amount and Unpriced, then one row per batch (date, number with an
 * "opening stock" tag, invoice and price, litres, and an Open link). Litres are never added to a material quantity. A missing price
 * says Unpriced; it is never shown as zero.
 */
const litres=(value:number)=>value.toLocaleString('en-US',{maximumFractionDigits:3});

export function SupplierDieselBlock({diesel,onOpenBatch}:{diesel:SupplierDieselSummary;onOpenBatch?:(batchId:string)=>void}){
  return <View style={styles.block} accessibilityRole="summary">
    <View style={styles.bar}><Text style={styles.title}>DIESEL DELIVERIES</Text><Text style={styles.separate}>separate from materials</Text></View>
    <View style={styles.hero}><Text style={styles.litres}>{litres(diesel.totalLitres)}</Text><Text style={styles.unit}>L</Text></View>
    <View style={styles.chips}>
      <Text style={styles.chip}>{diesel.batchCount} batch{diesel.batchCount===1?'':'es'}</Text>
      {diesel.pricedAmountUsd!=null?<Text style={styles.chip}>${diesel.pricedAmountUsd.toFixed(2)} incl. VAT</Text>:null}
      {diesel.unpricedNote?<Text style={[styles.chip,styles.chipWarn]}>{diesel.unpricedNote.replace(' batches',' Unpriced').replace(' batch',' Unpriced')}</Text>:null}
    </View>
    {diesel.rows.map(row=><TouchableOpacity key={row.batchId} style={styles.row} disabled={!onOpenBatch} onPress={()=>onOpenBatch?.(row.batchId)} accessibilityRole={onOpenBatch?'button':'text'} accessibilityLabel={`${row.day}, ${row.batchLabel}, ${litres(row.litres)} litres${onOpenBatch?'. Open the batch':''}`}>
      <View style={styles.rowCopy}>
        <Text style={styles.day}>{row.day}</Text>
        <Text style={styles.batch}>{row.batchNumber}{row.opening?<Text style={styles.tag}>  opening stock  </Text>:null}</Text>
        <Text style={styles.detail}>Invoice {row.invoiceNumber??'not recorded'} · {row.pricePerLitreUsd==null?'Unpriced':`${formatFuelPriceUsd(row.pricePerLitreUsd)} / L`}</Text>
      </View>
      <View style={styles.rowRight}><Text style={styles.rowLitres}>{litres(row.litres)} L</Text>{onOpenBatch?<Text style={styles.open}>Open ›</Text>:null}</View>
    </TouchableOpacity>)}
    {diesel.cancelledCount?<Text style={styles.note}>Not counted: {diesel.cancelledCount} cancelled batch{diesel.cancelledCount===1?'':'es'}.</Text>:null}
  </View>;
}

const styles=StyleSheet.create({
  block:{marginHorizontal:12,marginBottom:12,borderRadius:14,borderWidth:1,borderColor:'#C7D3E2',overflow:'hidden',backgroundColor:colors.surface},
  bar:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10,paddingHorizontal:14,paddingVertical:10,backgroundColor:colors.navy},
  title:{color:colors.cream,fontSize:12,fontWeight:'900',letterSpacing:1},
  separate:{color:'#D5E4EF',fontSize:11},
  hero:{flexDirection:'row',alignItems:'baseline',paddingHorizontal:14,paddingTop:12,paddingBottom:4,gap:4},
  litres:{color:colors.navy,fontSize:30,fontWeight:'900'},
  unit:{color:colors.navy,fontSize:16,fontWeight:'800'},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:6,paddingHorizontal:14,paddingBottom:10},
  chip:{color:colors.navy,fontSize:11,fontWeight:'700',borderRadius:999,borderWidth:1,borderColor:'#C7D3E2',backgroundColor:'#EEF2F7',paddingHorizontal:9,paddingVertical:2,overflow:'hidden'},
  chipWarn:{color:colors.warning,borderColor:'#F1CF83',backgroundColor:'#FFF4DC'},
  row:{flexDirection:'row',gap:12,paddingHorizontal:14,paddingVertical:10,minHeight:56,borderTopWidth:1,borderTopColor:colors.line,borderLeftWidth:3,borderLeftColor:colors.brand,backgroundColor:'#FFFEFC'},
  rowCopy:{flex:1,minWidth:0},
  day:{color:colors.muted,fontSize:12,fontWeight:'600'},
  batch:{color:colors.ink,fontSize:15,fontWeight:'700'},
  tag:{color:colors.warning,fontSize:10.5,fontWeight:'700',backgroundColor:'#FFF4DC'},
  detail:{color:colors.muted,fontSize:12,marginTop:2},
  rowRight:{justifyContent:'space-between',alignItems:'flex-end'},
  rowLitres:{color:colors.ink,fontSize:19,fontWeight:'900'},
  open:{color:colors.navy,fontSize:12,fontWeight:'700'},
  note:{color:colors.muted,fontSize:12,paddingHorizontal:14,paddingVertical:8,backgroundColor:'#F7F5F0'},
});
