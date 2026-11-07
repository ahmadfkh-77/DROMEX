import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import type {CompanyDailyReport} from '../domain/companyDailyReport';
import {buildWorkbookFromSheets,encodeWorkbookBytes} from './businessWorkbook';
import {companyDailyReportSheets} from './companyDailyReportWorkbook';

/** Saves the Company Daily Report workbook safely and opens the share sheet. Kept apart from the pure sheet builder so that can be tested without the phone's file system. Read-only. */
export async function exportAndShareCompanyDailyReportWorkbook(report:CompanyDailyReport,options:{prices?:boolean;attendance?:boolean}={}):Promise<string>{
  if(report.isEmpty&&!(options.attendance&&report.attendance))throw new Error('Nothing was recorded on this day, so there is nothing to export.');
  if(!FileSystem.documentDirectory)throw new Error('Document storage is unavailable.');
  const directory=`${FileSystem.documentDirectory}exports/`;
  const target=`${directory}DROMEX-Company-Daily-Report-${report.day}.xlsx`,partial=`${target}.partial`;
  await FileSystem.makeDirectoryAsync(directory,{intermediates:true});
  await FileSystem.deleteAsync(partial,{idempotent:true});
  await FileSystem.writeAsStringAsync(partial,encodeWorkbookBytes(buildWorkbookFromSheets(companyDailyReportSheets(report,options))),{encoding:FileSystem.EncodingType.Base64});
  await FileSystem.moveAsync({from:partial,to:target});
  if(!(await Sharing.isAvailableAsync()))throw new Error(`Workbook saved at ${target}, but sharing is unavailable.`);
  await Sharing.shareAsync(target,{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',UTI:'org.openxmlformats.spreadsheetml.sheet',dialogTitle:'Share Company Daily Report Excel'});
  return target;
}
