/**
 * Company Daily Report switches, remembered as app preferences (no migration; they travel with the backup like the other `dromex.` keys).
 * Attendance sheet: default ON, only the exact stored value 'off' turns it off. Prices: default OFF (DEC-501 no-prices default), only the
 * exact stored value 'on' turns it on. Contract target: per project, default OFF, only 'on' turns it on. A missing or unreadable value
 * therefore always gives the safe default.
 */
export const DAILY_ATTENDANCE_KEY='dromex.companyDailyReport.attendance.v1';
export const DAILY_PRICES_KEY='dromex.companyDailyReport.prices.v1';
export const dailyContractKey=(projectId:string)=>`dromex.companyDailyReport.contract.${projectId}.v1`;
export const parseAttendanceSwitch=(raw:string|null|undefined)=>raw!=='off';
export const parsePricesSwitch=(raw:string|null|undefined)=>raw==='on';
export const parseContractSwitch=(raw:string|null|undefined)=>raw==='on';
export const serializeAttendanceSwitch=(on:boolean)=>on?'on':'off';
export const serializeOnOff=(on:boolean)=>on?'on':'off';
