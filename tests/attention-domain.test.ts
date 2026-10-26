import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import {attentionChips,attentionGroups,attentionSectionFor,attentionSections,attentionSummary} from '../src/domain/attention';
import type {AttentionSnapshot} from '../src/domain/workspace';

const source=(path:string)=>readFileSync(join(__dirname,'..',path),'utf8');
const empty:AttentionSnapshot={syncPending:0,unpricedLoads:0,outstandingRecords:0,missingReportsToday:0,incompleteWaste:0,blockedSchedule:0,openIssues:0,loadDrafts:0};

describe('Needs Attention groups (DEC-531)',()=>{
  it('is all zero with nothing to review',()=>{
    expect(attentionGroups(empty,0)).toEqual({operational:0,financial:0,sync:0,drafts:0,total:0});
    expect(attentionChips(attentionGroups(empty,0))).toEqual([]);
    expect(attentionSummary(attentionGroups(empty,0))).toBe('');
  });

  it('groups the nine counts the way Home has always shown them',()=>{
    const groups=attentionGroups({syncPending:2,unpricedLoads:3,outstandingRecords:4,missingReportsToday:2,incompleteWaste:1,blockedSchedule:1,openIssues:1,loadDrafts:1},2);
    expect(groups).toEqual({operational:5,financial:7,sync:2,drafts:3,total:17});
  });

  it('lists only the groups that have something, with singular and plural wording',()=>{
    const groups=attentionGroups({...empty,missingReportsToday:2,unpricedLoads:3,outstandingRecords:4,loadDrafts:1},0);
    expect(attentionChips(groups).map(chip=>chip.label)).toEqual(['2 operational','7 financial','1 draft']);
    expect(attentionSummary(groups)).toBe('2 operational · 7 financial · 1 draft');
    expect(attentionChips(attentionGroups(empty,2)).map(chip=>chip.label)).toEqual(['2 drafts']);
    expect(attentionChips(attentionGroups({...empty,syncPending:5},0)).map(chip=>chip.label)).toEqual(['5 pending sync']);
  });

  it('sorts the rows into Fix first, Review and Housekeeping by their existing tone',()=>{
    expect(attentionSections.map(section=>section.key)).toEqual(['fix','review','housekeeping']);
    expect(attentionSectionFor('danger')).toBe('fix');
    expect(attentionSectionFor('warning')).toBe('review');
    expect(attentionSectionFor('navy')).toBe('housekeeping');
  });
});

// Static contract checks: there is no React Native renderer in the test stack.
describe('Needs Attention screens keep their links (DEC-531)',()=>{
  const screen=source('src/ui/screens/AttentionScreen.tsx');
  const home=source('src/ui/screens/HomeScreen.tsx');

  it('keeps every item and the screen each one opens',()=>{
    for(const [title,route] of [['Missing Daily Reports','reports'],['Blocked Scheduled Work','schedule'],['Open Project Issues','projects'],['Unpriced Receipts','loads'],['Outstanding Balances','financials'],['Incomplete Waste Details','waste'],['Receipt Drafts','drafts'],['Other Drafts','drafts']])
      expect(screen).toMatch(new RegExp(`title:'${title}'[^}]*route:'${route}'`));
    expect(screen).toMatch(/title:'Pending Synchronization'[^}]*route:'attention'/);
  });

  it('shows the count in white on navy, no longer navy on orange',()=>{
    expect(screen).toMatch(/hero:\{backgroundColor:colors\.navy/);
    expect(screen).toMatch(/heroNumber:\{color:'#FFF'/);
  });

  it('keeps Draft Center one tap from Home in both states, and the whole card opens Needs Attention',()=>{
    expect(home).toContain('accessibilityLabel="Open draft center"');
    expect(home).toContain('Open draft center. ');
    expect(home).toContain('onPress={onOpen}');
    expect(home).toContain('attentionGroups(snapshot,otherDrafts)');
  });
});
