import {describe,expect,it} from 'vitest';

import type {AttendanceEntry} from '../src/domain/attendance';
import {buildAttendanceSheet} from '../src/domain/attendance';
import {buildCompanyDailyReport,withAttendance,type DayFill,type DayInput} from '../src/domain/companyDailyReport';
import {loadCompanyDailyReport} from '../src/services/companyDailyReportLoader';
import {buildCompanyDailyReportHtml} from '../src/services/companyDailyReportTemplate';
import {companyDailyReportSheets} from '../src/services/companyDailyReportWorkbook';

const DAY='2026-11-06';
const entry=(over:Partial<AttendanceEntry>={}):AttendanceEntry=>({id:'e1',workDate:DAY,subjectType:'person',subjectId:'d1',name:'Samir',detail:'Driver',places:[{type:'project',id:'p1',name:'Airport Road'},{type:'company_site',id:'s1',name:'Main Plant'}],...over});
const fill=(over:Partial<DayFill>={}):DayFill=>({id:'f1',status:'Active',time:`${DAY}T06:30:00`,givenTo:'Excavator E-3',fuelType:'diesel',operatorName:null,litres:120,projectId:'p1',projectName:'Airport Road',siteId:null,siteName:null,...over});
const empty:DayInput={loadsOut:[],supplierLoads:[],fills:[],dumps:[]};
const entries=[entry(),entry({id:'e2',subjectId:'d2',name:'Omar',places:[{type:'project',id:'p1',name:'Airport Road'}]}),entry({id:'e3',subjectType:'truck',subjectId:'t1',name:'T-12',detail:'Tipper'}),entry({id:'e4',subjectType:'machine',subjectId:'m1',name:'Excavator E-3',detail:'Excavator',places:[{type:'typed',id:null,name:'Yard'}]})];
const report=(input:Partial<DayInput>,list:AttendanceEntry[]=entries)=>withAttendance(buildCompanyDailyReport(DAY,{...empty,...input}),buildAttendanceSheet(list));

describe('Company Daily Report PDF - Attendance sheet',()=>{
  const on=buildCompanyDailyReportHtml({logo:null,report:report({fills:[fill()]}),attendance:true});
  it('prints People, Trucks and Machines as three tables with name, role or type, and worked at',()=>{
    expect(on).toContain('Attendance sheet');expect(on).toContain('>People<');expect(on).toContain('>Trucks<');expect(on).toContain('>Machines<');
    expect(on).toContain('>Worked at<');expect(on).toContain('Airport Road, Main Plant');expect(on).toContain('Yard');expect(on).toContain('Tipper');
  });
  it('lists everyone, with no "N more" shortcut, and never mentions hours or pay',()=>{
    expect(on).not.toMatch(/\d+ more/i);expect(on).not.toMatch(/hours|wage|salary|overtime|\bpay\b/i);
  });
  it('is left out when the Attendance switch is off',()=>{
    const off=buildCompanyDailyReportHtml({logo:null,report:report({fills:[fill()]}),attendance:false});
    expect(off).not.toContain('Attendance sheet');expect(off).not.toContain('Worked at');
  });
  it('prints no empty group: only the lists that have someone in them',()=>{
    const html=buildCompanyDailyReportHtml({logo:null,report:report({fills:[fill()]},[entry()]),attendance:true});
    expect(html).toContain('>People<');expect(html).not.toContain('>Trucks<');expect(html).not.toContain('>Machines<');
  });
  it('shows an attendance-only day (nothing else recorded) when the switch is on, and says nothing was recorded when it is off',()=>{
    expect(buildCompanyDailyReportHtml({logo:null,report:report({}),attendance:true})).toContain('Worked at');
    expect(buildCompanyDailyReportHtml({logo:null,report:report({}),attendance:false})).toContain('Nothing was recorded on this day');
  });
  it('lists the attendance sheet in the contents',()=>{expect(on.slice(on.indexOf('Contents'),on.indexOf('</ol>'))).toContain('Attendance sheet');});
});

describe('Company Daily Report workbook - Attendance sheet',()=>{
  it('adds an Attendance sheet with one row per person or equipment and place when the switch is on',()=>{
    const sheet=companyDailyReportSheets(report({fills:[fill()]}),{attendance:true}).find(s=>s.name==='Attendance')!;
    expect(sheet.rows).toHaveLength(6);
    expect(sheet.rows[0]).toMatchObject({Group:'People',Name:'Omar',Role:'Driver','Place Type':'Project',Place:'Airport Road',Date:DAY});
    expect(sheet.rows.some(r=>r.Group==='Machines'&&r.Place==='Yard'&&r['Place Type']==='Typed place')).toBe(true);
  });
  it('has no Attendance sheet when the switch is off or nobody worked',()=>{
    expect(companyDailyReportSheets(report({fills:[fill()]}),{attendance:false}).some(s=>s.name==='Attendance')).toBe(false);
    expect(companyDailyReportSheets(report({fills:[fill()]},[]),{attendance:true}).some(s=>s.name==='Attendance')).toBe(false);
  });
});

describe('loadCompanyDailyReport - attendance',()=>{
  it('reads the day\'s entries from the attendance repository',async()=>{
    const loaded=await loadCompanyDailyReport(DAY,{
      totals:{listRecords:async()=>[]},fuel:{getOverview:async()=>({currentBalanceLitres:0,hasKnownBalance:false,latestGauge:null,movements:[]})},waste:{listWasteHistory:async()=>[]},
      bitumen:{getOverview:async()=>({usingBatchId:null,totalRemainingKg:0,batches:[],useRows:[]})},attendance:{listDay:async()=>entries}});
    expect(loaded.attendance?.count).toBe(4);
  });
});
