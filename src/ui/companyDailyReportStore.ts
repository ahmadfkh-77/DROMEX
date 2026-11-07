import Storage from 'expo-sqlite/kv-store';

import {DAILY_ATTENDANCE_KEY,DAILY_PRICES_KEY,dailyContractKey,parseAttendanceSwitch,parseContractSwitch,parsePricesSwitch,serializeAttendanceSwitch,serializeOnOff} from '../domain/companyDailyReportPreferences';

/** Reads the remembered Company Daily Report switches. A missing or unreadable value gives the safe default, never an error. */
export async function loadDailySwitches(projectIds:readonly string[]):Promise<{attendance:boolean;prices:boolean;contract:Record<string,boolean>}>{
  try{
    const [attendance,prices,...contract]=await Promise.all([Storage.getItem(DAILY_ATTENDANCE_KEY),Storage.getItem(DAILY_PRICES_KEY),...projectIds.map(id=>Storage.getItem(dailyContractKey(id)))]);
    return {attendance:parseAttendanceSwitch(attendance),prices:parsePricesSwitch(prices),contract:Object.fromEntries(projectIds.map((id,index)=>[id,parseContractSwitch(contract[index])]))};
  }catch{return {attendance:true,prices:false,contract:{}};}
}
export const saveAttendanceSwitch=(on:boolean)=>Storage.setItem(DAILY_ATTENDANCE_KEY,serializeAttendanceSwitch(on)).catch(()=>undefined);
export const savePricesSwitch=(on:boolean)=>Storage.setItem(DAILY_PRICES_KEY,serializeOnOff(on)).catch(()=>undefined);
export const saveContractSwitch=(projectId:string,on:boolean)=>Storage.setItem(dailyContractKey(projectId),serializeOnOff(on)).catch(()=>undefined);
