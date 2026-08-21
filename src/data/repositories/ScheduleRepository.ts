import type {ScheduleSetup,ScheduleStatus,ScheduleTask,ScheduleTaskDraft} from '../../domain/schedule';

export interface ScheduleRepository{
  getSetup():Promise<ScheduleSetup>;
  listTasks():Promise<ScheduleTask[]>;
  createTask(draft:ScheduleTaskDraft):Promise<ScheduleTask>;
  updateTask(id:string,draft:ScheduleTaskDraft):Promise<ScheduleTask>;
  setTaskStatus(id:string,status:ScheduleStatus):Promise<ScheduleTask>;
}
