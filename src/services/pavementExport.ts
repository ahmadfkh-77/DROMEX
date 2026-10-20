import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type {PavementCalculation} from '../domain/pavement';
import {buildPavementPdfHtml,buildPavementSheets} from '../domain/pavementReport';
import {buildWorkbookFromSheets,encodeWorkbookBytes} from './businessWorkbook';

const safe=(value:string)=>value.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||'Project';

/** The PDF: one row per calculation, and under a calculation that has road sections, each section and their total (DEC-518). */
export async function exportPavementPdf(records:PavementCalculation[],projectName:string){
  if(!records.length)throw new Error('Save at least one pavement calculation before exporting.');
  const html=buildPavementPdfHtml(records,projectName,new Date().toLocaleString());
  const result=await Print.printToFileAsync({html});
  if(!(await Sharing.isAvailableAsync()))throw new Error(`PDF saved at ${result.uri}, but sharing is unavailable.`);
  await Sharing.shareAsync(result.uri,{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:'Share Pavement Quantity PDF'});
  return result.uri;
}

/** The workbook: Project Summary, Pavement Calculations, and an Area Sections sheet when any calculation has road sections (DEC-518). */
export async function exportPavementExcel(records:PavementCalculation[],projectName:string){
  if(!records.length)throw new Error('Save at least one pavement calculation before exporting.');
  if(!FileSystem.documentDirectory)throw new Error('Document storage is unavailable.');
  const bytes=buildWorkbookFromSheets(buildPavementSheets(records,projectName));
  const directory=`${FileSystem.documentDirectory}exports/`;
  await FileSystem.makeDirectoryAsync(directory,{intermediates:true});
  const uri=`${directory}DROMEX-Pavement-${safe(projectName)}-${Date.now()}.xlsx`;
  await FileSystem.writeAsStringAsync(uri,encodeWorkbookBytes(bytes),{encoding:FileSystem.EncodingType.Base64});
  if(!(await Sharing.isAvailableAsync()))throw new Error(`Excel workbook saved at ${uri}, but sharing is unavailable.`);
  await Sharing.shareAsync(uri,{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',UTI:'org.openxmlformats.spreadsheetml.sheet',dialogTitle:'Share Pavement Quantity Excel'});
  return uri;
}
