import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe,expect,it} from 'vitest';

import type {Project} from '../src/domain/loads';
import {summarizeProjectCard} from '../src/domain/projectList';

const project=(patch:Partial<Project>={}):Project=>({id:'p1',customerId:'c1',customerName:'Road Co',name:'Mountain Road',location:'Aley',status:'active',notes:'Long internal notes',startDate:'2026-08-01',endDate:null,...patch});

describe('project card summary',()=>{
  it('carries only name, status, location, start date and last activity',()=>{
    expect(summarizeProjectCard(project(),'2026-09-20')).toEqual({name:'Mountain Road',status:'Active',location:'Aley',startDate:'2026-08-01',lastActivityDate:'2026-09-20'});
  });
  it('names a completed project in words, not colour',()=>{
    expect(summarizeProjectCard(project({status:'completed'}),null).status).toBe('Completed');
  });
  it('hides last activity when no recorded work exists, never inventing one',()=>{
    expect(summarizeProjectCard(project(),undefined).lastActivityDate).toBeNull();
    expect(summarizeProjectCard(project(),null).lastActivityDate).toBeNull();
    expect(summarizeProjectCard(project(),'not a date').lastActivityDate).toBeNull();
  });
  it('reports a missing start date or blank location as absent rather than blank',()=>{
    const summary=summarizeProjectCard(project({startDate:null,location:'   '}),null);
    expect(summary.startDate).toBeNull();
    expect(summary.location).toBeNull();
  });
  it('keeps Arabic and long names intact, only trimming surrounding space',()=>{
    const arabic='  طريق الجبل - المرحلة الثانية من مشروع توسيع الطريق الرئيسي  ';
    expect(summarizeProjectCard(project({name:arabic}),null).name).toBe(arabic.trim());
  });
});

// Static contract checks: no React Native renderer is available in this suite.
const read=(path:string)=>existsSync(join(__dirname,'..',path))?readFileSync(join(__dirname,'..',path),'utf8'):'';

describe('Projects list screen',()=>{
  const screen=read('src/ui/screens/ProjectsScreen.tsx');
  const card=screen.slice(screen.indexOf('function ProjectCard'),screen.indexOf('function ManageProjectSheet'));
  it('builds each card from the domain summary and nothing else',()=>{
    expect(screen).toContain('summarizeProjectCard(');
    expect(card).not.toContain('customerName');
    expect(card).not.toContain('notes');
    expect(card).not.toContain('endDate');
    expect(card).not.toMatch(/Open Project Command Center<\/Text>/);
  });
  it('has one tap target to open the project and one quiet Manage control',()=>{
    expect(card.match(/onPress=\{onOpen\}/g)).toHaveLength(1);
    expect(card).toContain('accessibilityLabel={`Open ${summary.name}`}');
    expect(card).toContain('accessibilityLabel={`Manage ${summary.name}`}');
    expect(card).not.toContain('Edit Information');
    expect(card).not.toContain('Mark Completed');
  });
  it('keeps every management action reachable from the Manage sheet',()=>{
    const sheet=screen.slice(screen.indexOf('function ManageProjectSheet'));
    expect(sheet).toContain('<FocusedSheet');
    for(const label of ['Edit information','Change start date','Mark completed','Reactivate project'])expect(sheet).toContain(label);
  });
  it('shows last activity only when a real date exists and says when a start date is missing',()=>{
    expect(card).toMatch(/summary\.lastActivityDate\?/);
    expect(card).toContain('Last activity');
    expect(card).toContain('Start date not recorded');
  });
  it('states status in words and does not force left alignment on names',()=>{
    expect(card).toContain('{summary.status}');
    expect(screen).not.toMatch(/textAlign:\s*'left'/);
  });
  it('has loading, error with retry, and empty states',()=>{
    expect(screen).toContain('Loading projects');
    expect(screen).toContain('Projects could not be loaded');
    expect(screen).toContain('Try again');
    expect(screen).toContain('No active projects yet');
  });
  it('receives last-activity dates from the workspace repository',()=>{
    expect(screen).toContain('getLastRecordedActivityDates');
    const app=read('src/ui/DromexApp.tsx');
    expect(app).toMatch(/<ProjectsScreen[^>]*activityRepository=\{workspaceRepository\}/);
  });
});
