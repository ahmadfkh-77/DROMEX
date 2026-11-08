import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

import {todayKey} from '../src/domain/companyDailyReport';

/** The Company Daily Report is about what happened, so its day (and the attendance day) can never be tomorrow or later. */
describe('Company Daily Report day picker',()=>{
  it('todayKey is the local calendar day',()=>{
    expect(todayKey(new Date(2026,10,6,23,59))).toBe('2026-11-06');expect(todayKey(new Date(2026,0,5,0,1))).toBe('2026-01-05');
  });
  it('the report screen and the attendance screen both stop the picker at today',()=>{
    for(const file of ['src/ui/screens/CompanyDailyReportScreen.tsx','src/ui/screens/AttendanceScreen.tsx']){
      const source=readFileSync(file,'utf8');expect(source).toMatch(/<DatePickerField label="Day".*maxDate=\{todayKey\(\)\}/);
    }
  });
});
