import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import type {StockOverview} from '../domain/stock';
import type {StockReportFilter} from '../domain/stockReport';
import {buildWorkbookFromSheets,encodeWorkbookBytes} from './businessWorkbook';
import {stockWorkbookSheets} from './stockWorkbook';

/** Saves the Stock workbook safely and opens the share sheet. Kept apart from the pure sheet builder so the builder can be tested without the phone's file system. */
export async function exportAndShareStockWorkbook(overview:StockOverview,filter:StockReportFilter,company:{name:string}):Promise<string>{
  if(!FileSystem.documentDirectory)throw new Error('Document storage is unavailable.');
  const exportedAt=new Date().toISOString(),sheets=stockWorkbookSheets(overview,filter,company,exportedAt);
  if(!sheets[1]!.rows.length)throw new Error('Nothing is in Stock yet, so there is nothing to export.');
  const directory=`${FileSystem.documentDirectory}exports/`,stamp=exportedAt.replace(/[:.]/g,'-').slice(0,19);
  const target=`${directory}DROMEX-Stock-${filter.itemId?'Report':'Summary'}-${stamp}.xlsx`,partial=`${target}.partial`;
  await FileSystem.makeDirectoryAsync(directory,{intermediates:true});
  await FileSystem.deleteAsync(partial,{idempotent:true});
  await FileSystem.writeAsStringAsync(partial,encodeWorkbookBytes(buildWorkbookFromSheets(sheets)),{encoding:FileSystem.EncodingType.Base64});
  await FileSystem.moveAsync({from:partial,to:target});
  if(!(await Sharing.isAvailableAsync()))throw new Error(`Workbook saved at ${target}, but sharing is unavailable.`);
  await Sharing.shareAsync(target,{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',UTI:'org.openxmlformats.spreadsheetml.sheet',dialogTitle:'Share Stock Excel'});
  return target;
}
