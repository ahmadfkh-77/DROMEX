import {describe,expect,it} from 'vitest';
import {emptyLoadDraft,isMeaningfulLoadDraft} from '../src/domain/loads';
import {countMeaningfulStoredDrafts,isMeaningfulStoredDraft} from '../src/ui/draftRecognition';

describe('draft recognition',()=>{
  it('ignores forms that only contain automatic context or default presentation values',()=>{
    expect(isMeaningfulLoadDraft({...emptyLoadDraft,customerId:'customer-1',projectId:'project-1'})).toBe(false);
    expect(isMeaningfulStoredDraft('dromex.draft.quarry.v1',{projectId:'project-1',photos:[]})).toBe(false);
    expect(isMeaningfulStoredDraft('dromex.draft.quick-text.v1',{title:'Quick Text',projectId:'project-1',customerId:'customer-1'})).toBe(false);
    expect(isMeaningfulStoredDraft('dromex.draft.fuel.v1',{tab:'fill',fill:{projectId:'project-1'}})).toBe(false);
    expect(isMeaningfulStoredDraft('dromex.draft.daily-report.project-1.v1',{projectId:'project-1',workDate:'2026-08-19'})).toBe(false);
  });

  it('recognizes operational work even when a required description is not entered yet',()=>{
    expect(isMeaningfulLoadDraft({...emptyLoadDraft,projectId:'project-1',emptyWeightKg:'12000'})).toBe(true);
    expect(isMeaningfulStoredDraft('dromex.draft.quarry.v1',{projectId:'project-1',quantityCubicMetres:'12'})).toBe(true);
    expect(isMeaningfulStoredDraft('dromex.draft.quick-text.v1',{title:'Quick Text',message:'Site access notice'})).toBe(true);
    expect(isMeaningfulStoredDraft('dromex.draft.fuel.v1',{tab:'fill',fill:{projectId:'project-1',litres:'40'}})).toBe(true);
    expect(isMeaningfulStoredDraft('dromex.draft.daily-report.project-1.v1',{projectId:'project-1',workers:['Worker A']})).toBe(true);
  });

  it('counts only valid, meaningful, non-trash stored drafts',()=>{
    expect(countMeaningfulStoredDrafts([
      ['dromex.draft.quick-text.v1',JSON.stringify({title:'Quick Text'})],
      ['dromex.draft.quarry.v1',JSON.stringify({quantityCubicMetres:'8'})],
      ['dromex.draft.daily-report.project-1.v1','not-json'],
      ['dromex.draft.trash.v1',JSON.stringify([{entry:{}}])],
    ])).toBe(1);
  });
});
