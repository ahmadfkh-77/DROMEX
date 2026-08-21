import type {Project} from './loads';

export type SchedulePriority='Low'|'Normal'|'High'|'Urgent';
export type ScheduleStatus='Planned'|'In Progress'|'Blocked'|'Completed';
export type ScheduleView='today'|'week'|'threeWeeks'|'all';

export type ScheduleTask={
  id:string;
  projectId:string;
  projectName:string;
  customerName:string;
  title:string;
  startDate:string;
  endDate:string;
  priority:SchedulePriority;
  status:ScheduleStatus;
  responsiblePerson:string|null;
  location:string|null;
  notes:string|null;
  completedAt:string|null;
  createdAt:string;
  updatedAt:string;
};

export type ScheduleTaskDraft={
  projectId:string;
  title:string;
  startDate:string;
  endDate:string;
  priority:SchedulePriority;
  responsiblePerson:string;
  location:string;
  notes:string;
};

export type ScheduleSetup={projects:Project[]};
export type ScheduleRange={fromDate:string|null;toDate:string|null;label:string};

export const schedulePriorities:SchedulePriority[]=['Low','Normal','High','Urgent'];
export const scheduleStatuses:ScheduleStatus[]=['Planned','In Progress','Blocked','Completed'];

const iso=(value:Date)=>`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
const parseIso=(value:string)=>{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return null;const date=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));return iso(date)===value?date:null;};
export const scheduleToday=()=>iso(new Date());
export const emptyScheduleTask=(date=scheduleToday()):ScheduleTaskDraft=>({projectId:'',title:'',startDate:date,endDate:date,priority:'Normal',responsiblePerson:'',location:'',notes:''});

export function validateScheduleTask(draft:ScheduleTaskDraft,projects:Project[]):string[]{
  const issues:string[]=[];
  if(!projects.some(project=>project.id===draft.projectId&&project.status==='active'))issues.push('Select an active project.');
  if(!draft.title.trim())issues.push('Task name is required.');
  if(!parseIso(draft.startDate))issues.push('Choose a valid start date.');
  if(!parseIso(draft.endDate))issues.push('Choose a valid end date.');
  if(parseIso(draft.startDate)&&parseIso(draft.endDate)&&draft.endDate<draft.startDate)issues.push('End date cannot be before start date.');
  if(!schedulePriorities.includes(draft.priority))issues.push('Choose a valid priority.');
  return issues;
}

export function resolveScheduleRange(view:ScheduleView,anchorDate:string):ScheduleRange{
  const anchor=parseIso(anchorDate)??new Date();
  if(view==='all')return{fromDate:null,toDate:null,label:'All scheduled work'};
  if(view==='today'){const date=iso(anchor);return{fromDate:date,toDate:date,label:anchor.toLocaleDateString(undefined,{weekday:'long',day:'numeric',month:'short'})};}
  const days=view==='week'?6:20;
  const end=new Date(anchor.getFullYear(),anchor.getMonth(),anchor.getDate()+days);
  return{fromDate:iso(anchor),toDate:iso(end),label:view==='week'?'7-day plan':'3-week look-ahead'};
}

export function taskOverlapsRange(task:Pick<ScheduleTask,'startDate'|'endDate'>,range:ScheduleRange):boolean{
  if(range.fromDate&&task.endDate<range.fromDate)return false;
  if(range.toDate&&task.startDate>range.toDate)return false;
  return true;
}

export function scheduleCounts(tasks:ScheduleTask[]){
  return{
    planned:tasks.filter(task=>task.status==='Planned').length,
    inProgress:tasks.filter(task=>task.status==='In Progress').length,
    blocked:tasks.filter(task=>task.status==='Blocked').length,
    completed:tasks.filter(task=>task.status==='Completed').length,
  };
}
