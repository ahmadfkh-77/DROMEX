import {StyleSheet,Text,TouchableOpacity,View} from 'react-native';

import {formatStockQuantity,formatUsd} from '../../domain/stock';
import type {SupplierStockSummary} from '../../domain/supplierStock';
import {colors} from '../theme';

/**
 * One supplier's Stock deliveries, drawn like the diesel and bitumen blocks: a navy title bar, chips for the batch count, the priced amount and
 * Unpriced, then one row per batch with its item, invoice and price, and an Open link to the batch in Stock. A record, not a second invoice, and
 * quantities of different items are never added together.
 */
export function SupplierStockBlock({stock,onOpenBatch}:{stock:SupplierStockSummary;onOpenBatch?:(batchId:string)=>void}){
  return <View style={styles.block} accessibilityRole="summary">
    <View style={styles.bar}><Text style={styles.title}>STOCK DELIVERIES</Text><Text style={styles.separate}>recorded in Stock</Text></View>
    <View style={styles.chips}>
      <Text style={styles.chip}>{stock.batchCount} batch{stock.batchCount===1?'':'es'}</Text>
      {stock.pricedAmountUsd!=null?<Text style={styles.chip}>{formatUsd(stock.pricedAmountUsd)} priced</Text>:null}
      {stock.unpricedNote?<Text style={[styles.chip,styles.chipWarn]}>{stock.unpricedNote}</Text>:null}
    </View>
    {stock.rows.map(row=><TouchableOpacity key={row.batchId} style={styles.row} disabled={!onOpenBatch} onPress={()=>onOpenBatch?.(row.batchId)} accessibilityRole={onOpenBatch?'button':'text'} accessibilityLabel={`${row.day}, ${row.batchNumber}, ${row.itemName}, ${formatStockQuantity(row.quantity,row.unitSymbol)}${onOpenBatch?'. Open the batch':''}`}>
      <View style={styles.rowCopy}>
        <Text style={styles.day}>{row.day}</Text>
        <Text style={styles.batch}>{row.batchNumber}<Text style={styles.item}>  {row.itemName}  </Text></Text>
        <Text style={styles.detail}>Invoice {row.invoiceNumber??'not recorded'} · {row.priceLabel}</Text>
      </View>
      <View style={styles.rowRight}><Text style={styles.rowQty}>{formatStockQuantity(row.quantity,row.unitSymbol)}</Text>{onOpenBatch?<Text style={styles.open}>Open ›</Text>:null}</View>
    </TouchableOpacity>)}
    <Text style={styles.note}>Not a second invoice: no payable and no change to Payments & balances. A batch made from a Supplier Load is not listed here; the load shows it.{stock.cancelledCount?` Not counted: ${stock.cancelledCount} cancelled batch${stock.cancelledCount===1?'':'es'}.`:''}</Text>
  </View>;
}

const styles=StyleSheet.create({
  block:{marginHorizontal:12,marginBottom:12,borderRadius:14,borderWidth:1,borderColor:'#C7D3E2',overflow:'hidden',backgroundColor:colors.surface},
  bar:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:10,paddingHorizontal:14,paddingVertical:10,backgroundColor:colors.navy},
  title:{color:colors.cream,fontSize:12,fontWeight:'900',letterSpacing:1},
  separate:{color:'#D5E4EF',fontSize:11},
  chips:{flexDirection:'row',flexWrap:'wrap',gap:6,paddingHorizontal:14,paddingVertical:10},
  chip:{color:colors.navy,fontSize:11,fontWeight:'700',borderRadius:999,borderWidth:1,borderColor:'#C7D3E2',backgroundColor:'#EEF2F7',paddingHorizontal:9,paddingVertical:2,overflow:'hidden'},
  chipWarn:{color:colors.warning,borderColor:'#F1CF83',backgroundColor:'#FFF4DC'},
  row:{flexDirection:'row',gap:12,paddingHorizontal:14,paddingVertical:10,minHeight:56,borderTopWidth:1,borderTopColor:colors.line,borderLeftWidth:3,borderLeftColor:colors.brand,backgroundColor:'#FFFEFC'},
  rowCopy:{flex:1,minWidth:0},
  day:{color:colors.muted,fontSize:12,fontWeight:'600'},
  batch:{color:colors.ink,fontSize:15,fontWeight:'700'},
  item:{color:colors.navy,fontSize:11,fontWeight:'700',backgroundColor:'#EEF2F7'},
  detail:{color:colors.muted,fontSize:12,marginTop:2},
  rowRight:{justifyContent:'space-between',alignItems:'flex-end'},
  rowQty:{color:colors.ink,fontSize:16,fontWeight:'900'},
  open:{color:colors.navy,fontSize:12,fontWeight:'700'},
  note:{color:colors.muted,fontSize:12,paddingHorizontal:14,paddingVertical:8,backgroundColor:'#F7F5F0'},
});
