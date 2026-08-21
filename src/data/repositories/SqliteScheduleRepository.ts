import type {SQLiteDatabase} from 'expo-sqlite';
import type {Project} from '../../domain/loads';
import {validateScheduleTask,type ScheduleSetup,type ScheduleStatus,type ScheduleTask,type ScheduleTaskDraft} from '../../domain/schedule';
import type {ScheduleRepository} from './ScheduleRepository';

type TaskRow={id:string;project_id:string;project_name:string;customer_name:string;title:string;start_date:string;end_date:string;priority:ScheduleTask['priority'];status:ScheduleStatus;responsible_person:string|null;location:string|null;notes:string|null;completed_at:string|null;created_at:string;updated_at:string};
const makeId=()=>`schedule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const clean=(value:string)=>value.trim().replace(/\s+/g,' ')||null;
const select=`SELECT t.*,p.name project_name,c.name customer_name FROM schedule_tasks t JOIN projects p ON p.id=t.project_id JOIN customers c ON c.id=p.customer_id WHERE p.is_archived=0`;
const fromRow=(row:TaskRow):ScheduleTask=>({id:row.id,projectId:row.project_id,projectName:row.project_name,customerName:row.customer_name,title:row.title,startDate:row.start_date,endDate:row.end_date,priority:row.priority,status:row.status,responsiblePerson:row.responsible_person,location:row.location,notes:row.notes,completedAt:row.completed_at,createdAt:row.created_at,updatedAt:row.updated_at});

export class SqliteScheduleRepository implements ScheduleRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async getSetup():Promise<ScheduleSetup>{
    const rows=await this.db.getAllAsync<{id:string;customer_id:string;customer_name:string;name:string;location:string;status:'active'|'completed';notes:string|null}>(`SELECT p.id,p.customer_id,c.name customer_name,p.name,p.location,p.status,p.notes FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.is_archived=0 ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END,p.name COLLATE NOCASE`);
    return{projects:rows.map((row):Project=>({id:row.id,customerId:row.customer_id,customerName:row.customer_name,name:row.name,location:row.location,status:row.status,notes:row.notes}))};
  }

  async listTasks():Promise<ScheduleTask[]>{return(await this.db.getAllAsync<TaskRow>(`${select} ORDER BY CASE t.status WHEN 'Blocked' THEN 0 WHEN 'In Progress' THEN 1 WHEN 'Planned' THEN 2 ELSE 3 END,t.start_date,t.title COLLATE NOCASE`)).map(fromRow);}

  async createTask(draft:ScheduleTaskDraft):Promise<ScheduleTask>{
    const setup=await this.getSetup();const issues=validateScheduleTask(draft,setup.projects);if(issues[0])throw new Error(issues[0]);
    const id=makeId(),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO schedule_tasks (id,project_id,title,start_date,end_date,priority,responsible_person,location,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',id,draft.projectId,draft.title.trim(),draft.startDate,draft.endDate,draft.priority,clean(draft.responsiblePerson),clean(draft.location),clean(draft.notes),now,now);
      await this.enqueue(id,{id,...draft,status:'Planned',createdAt:now,updatedAt:now});
    });
    return this.get(id);
  }

  async updateTask(id:string,draft:ScheduleTaskDraft):Promise<ScheduleTask>{
    await this.get(id);const setup=await this.getSetup();const issues=validateScheduleTask(draft,setup.projects);if(issues[0])throw new Error(issues[0]);const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE schedule_tasks SET project_id=?,title=?,start_date=?,end_date=?,priority=?,responsible_person=?,location=?,notes=?,updated_at=? WHERE id=?',draft.projectId,draft.title.trim(),draft.startDate,draft.endDate,draft.priority,clean(draft.responsiblePerson),clean(draft.location),clean(draft.notes),now,id);
      await this.enqueue(id,{id,...draft,updatedAt:now});
    });
    return this.get(id);
  }

  async setTaskStatus(id:string,status:ScheduleStatus):Promise<ScheduleTask>{
    if(!(['Planned','In Progress','Blocked','Completed'] as ScheduleStatus[]).includes(status))throw new Error('Choose a valid schedule status.');
    await this.get(id);const now=new Date().toISOString(),completed=status==='Completed'?now:null;
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE schedule_tasks SET status=?,completed_at=?,updated_at=? WHERE id=?',status,completed,now,id);
      await this.enqueue(id,{id,status,completedAt:completed,updatedAt:now});
    });
    return this.get(id);
  }

  private async get(id:string){const row=await this.db.getFirstAsync<TaskRow>(`${select} AND t.id=?`,id);if(!row)throw new Error('Scheduled task was not found.');return fromRow(row);}
  private async enqueue(id:string,payload:unknown){await this.db.runAsync('INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)','scheduleTask',id,'upsert',JSON.stringify(payload),new Date().toISOString());}
}
