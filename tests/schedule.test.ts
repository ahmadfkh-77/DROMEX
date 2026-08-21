import {describe,expect,it} from 'vitest';
import {emptyScheduleTask,resolveScheduleRange,scheduleCounts,taskOverlapsRange,validateScheduleTask,type ScheduleTask} from '../src/domain/schedule';
import type {Project} from '../src/domain/loads';

const projects:Project[]=[{id:'p1',customerId:'c1',customerName:'Customer',name:'Road',location:'Aley',status:'active',notes:null}];
const task=(overrides:Partial<ScheduleTask>={}):ScheduleTask=>({id:'t1',projectId:'p1',projectName:'Road',customerName:'Customer',title:'Excavate',startDate:'2026-08-19',endDate:'2026-08-21',priority:'Normal',status:'Planned',responsiblePerson:null,location:null,notes:null,completedAt:null,createdAt:'',updatedAt:'',...overrides});

describe('project schedule',()=>{
  it('validates the project, title, and inclusive date order',()=>{expect(validateScheduleTask({...emptyScheduleTask('2026-08-19'),projectId:'p1',title:'Excavate'},projects)).toEqual([]);expect(validateScheduleTask({...emptyScheduleTask('2026-08-19'),projectId:'p1',title:'',endDate:'2026-08-18'},projects)).toEqual(['Task name is required.','End date cannot be before start date.']);});
  it('builds inclusive today, week, and three-week planning windows',()=>{expect(resolveScheduleRange('today','2026-08-19')).toMatchObject({fromDate:'2026-08-19',toDate:'2026-08-19'});expect(resolveScheduleRange('week','2026-08-19')).toMatchObject({fromDate:'2026-08-19',toDate:'2026-08-25'});expect(resolveScheduleRange('threeWeeks','2026-08-19')).toMatchObject({fromDate:'2026-08-19',toDate:'2026-09-08'});});
  it('includes tasks that overlap the selected window and reconciles statuses',()=>{const range=resolveScheduleRange('week','2026-08-19');expect(taskOverlapsRange(task(),range)).toBe(true);expect(taskOverlapsRange(task({startDate:'2026-08-26',endDate:'2026-08-27'}),range)).toBe(false);expect(scheduleCounts([task(),task({id:'t2',status:'In Progress'}),task({id:'t3',status:'Blocked'}),task({id:'t4',status:'Completed'})])).toEqual({planned:1,inProgress:1,blocked:1,completed:1});});
});
