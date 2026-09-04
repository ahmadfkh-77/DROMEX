import { describe, expect, it } from 'vitest';

import { addPresence, consultantSignoffState, emptyDailyReport, netWorkMinutes, splitPresence, validateDailyReport } from '../src/domain/projectReports';

describe('daily project reports', () => {
  it('requires a non-future date and work description', () => {
    const draft = emptyDailyReport('project_1');
    draft.workDate = '2999-01-01';
    expect(validateDailyReport(draft)).toEqual(expect.arrayContaining([
      'Work date cannot be in the future.',
      'Work description is required.',
    ]));
  });

  it('calculates net working time after a break', () => {
    const draft = { ...emptyDailyReport('project_1'), workDescription: 'Paving', workStartTime: '07:00', workEndTime: '17:00', breakMinutes: '60' };
    expect(validateDailyReport(draft)).toEqual([]);
    expect(netWorkMinutes(draft)).toBe(540);
  });

  it('rejects an end before start and an excessive break', () => {
    const base = { ...emptyDailyReport('project_1'), workDescription: 'Paving' };
    expect(validateDailyReport({ ...base, workStartTime: '17:00', workEndTime: '07:00' })).toContain('Work end time cannot be before start time.');
    expect(validateDailyReport({ ...base, workStartTime: '07:00', workEndTime: '17:00', breakMinutes: '601' })).toContain('Break cannot exceed the work interval.');
  });

  it('splits manual presence entries by comma or line', () => {
    expect(splitPresence('Ali, Sara\nOmar')).toEqual(['Ali', 'Sara', 'Omar']);
  });

  it('combines dropdown and typed presence without duplicates', () => {
    expect(addPresence(['Ali'], 'Sara')).toEqual(['Ali', 'Sara']);
    expect(addPresence(['Ali'], ' ali ')).toEqual(['Ali']);
  });
  it('rejects impossible work dates',()=>{const draft={...emptyDailyReport('project_1'),workDate:'2026-02-30',workDescription:'Paving'};expect(validateDailyReport(draft)).toContain('Work date must be a valid calendar date.');});

  it('defaults a new daily report to consultant sign-off disabled and empty',()=>{
    const draft=emptyDailyReport('project_1');
    expect(draft.consultantSignoffEnabled).toBe(false);
    expect(draft.consultantName).toBe('');
    expect(draft.consultantSignaturePaths).toEqual([]);
  });

  describe('consultantSignoffState',()=>{
    const base=emptyDailyReport('project_1');
    it('is disabled when the toggle is off, regardless of stored name or signature',()=>{
      expect(consultantSignoffState({...base,consultantSignoffEnabled:false,consultantName:'',consultantSignaturePaths:[]})).toBe('disabled');
      expect(consultantSignoffState({...base,consultantSignoffEnabled:false,consultantName:'Jad Khoury',consultantSignaturePaths:['M0 0']})).toBe('disabled');
    });
    it('is incomplete when enabled but missing the name',()=>{
      expect(consultantSignoffState({...base,consultantSignoffEnabled:true,consultantName:'',consultantSignaturePaths:['M0 0']})).toBe('incomplete');
    });
    it('is incomplete when enabled but missing the signature',()=>{
      expect(consultantSignoffState({...base,consultantSignoffEnabled:true,consultantName:'Jad Khoury',consultantSignaturePaths:[]})).toBe('incomplete');
    });
    it('is incomplete when enabled and both name and signature are missing',()=>{
      expect(consultantSignoffState({...base,consultantSignoffEnabled:true,consultantName:'   ',consultantSignaturePaths:[]})).toBe('incomplete');
    });
    it('is complete only when enabled with both a non-blank name and at least one signature path',()=>{
      expect(consultantSignoffState({...base,consultantSignoffEnabled:true,consultantName:'Jad Khoury',consultantSignaturePaths:['M0 0']})).toBe('complete');
    });
  });
});
