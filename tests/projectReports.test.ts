import { describe, expect, it } from 'vitest';

import { addPresence, emptyDailyReport, netWorkMinutes, splitPresence, validateDailyReport } from '../src/domain/projectReports';

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
});
