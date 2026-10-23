import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import type {ContractReport} from '../domain/contractReport';
import {encodeWorkbookBytes} from './businessWorkbook';
import {buildContractWorkbook} from './contractWorkbook';
import {buildContractReportHtml} from './contractReportTemplate';
import {imageUriToDataUrl} from './media';

/** DEC-522 Phase E. Saves the report as a PDF or an Excel workbook under the chosen header company and opens the share sheet. */
export async function exportAndShareContractReport(report:ContractReport,company:{name:string;logoUri:string|null;contactLine:string|null},kind:'pdf'|'excel'):Promise<string>{
  if(report.empty)throw new Error('This project has no contract items, so there is nothing to export.');
  if(!FileSystem.documentDirectory)throw new Error('Document storage is unavailable.');
  const directory=`${FileSystem.documentDirectory}exports/`;
  await FileSystem.makeDirectoryAsync(directory,{intermediates:true});
  let target:string;
  if(kind==='pdf'){
    const logo=await imageUriToDataUrl(company.logoUri).catch(()=>null);
    const result=await Print.printToFileAsync({html:buildContractReportHtml(report,{companyName:company.name,logo,contactLine:company.contactLine})});
    target=`${directory}${encodeURIComponent(report.fileName)}`;
    await FileSystem.deleteAsync(target,{idempotent:true});
    await FileSystem.moveAsync({from:result.uri,to:target});
  }else{
    target=`${directory}${encodeURIComponent(report.fileName.replace(/\.pdf$/,'.xlsx'))}`;
    const partial=`${target}.partial`;
    await FileSystem.deleteAsync(partial,{idempotent:true});
    await FileSystem.writeAsStringAsync(partial,encodeWorkbookBytes(buildContractWorkbook(report,{name:company.name})),{encoding:FileSystem.EncodingType.Base64});
    await FileSystem.deleteAsync(target,{idempotent:true});
    await FileSystem.moveAsync({from:partial,to:target});
  }
  if(!(await Sharing.isAvailableAsync()))throw new Error(`Saved at ${target}, but sharing is unavailable.`);
  await Sharing.shareAsync(target,kind==='pdf'?{mimeType:'application/pdf',UTI:'com.adobe.pdf',dialogTitle:`Share ${report.title}`}:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',UTI:'org.openxmlformats.spreadsheetml.sheet',dialogTitle:`Share ${report.title} Excel`});
  return target;
}
