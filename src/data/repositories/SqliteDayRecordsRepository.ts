import type {SQLiteDatabase} from 'expo-sqlite';

import type {DayDailyReport,DayIssue} from '../../domain/companyDailyReport';
import type {DayRecordsRepository} from './DayRecordsRepository';

type IssueRow={id:string;project_id:string;project_name:string;title:string;priority:string;status:'Open'|'Resolved';created_at:string};
type ReportRow={id:string;project_id:string;project_name:string;notes:string|null;problems:string|null;weather:string|null;photos_json:string|null};

const filled=(value:string|null)=>Boolean(value&&value.trim());
const photoCount=(json:string|null)=>{try{const parsed:unknown=JSON.parse(json??'[]');return Array.isArray(parsed)?parsed.length:0;}catch{return 0;}};

export class SqliteDayRecordsRepository implements DayRecordsRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async listIssues(day:string):Promise<DayIssue[]>{
    const rows=await this.db.getAllAsync<IssueRow>(`SELECT i.id,i.project_id,p.name project_name,i.title,i.priority,i.status,i.created_at
      FROM project_issues i JOIN projects p ON p.id=i.project_id WHERE date(i.created_at,'localtime')=? ORDER BY i.created_at,i.id`,day);
    return rows.map(r=>({id:r.id,time:r.created_at,projectId:r.project_id,projectName:r.project_name,title:r.title,priority:r.priority,status:r.status}));
  }

  async listDailyReports(day:string):Promise<DayDailyReport[]>{
    const rows=await this.db.getAllAsync<ReportRow>(`SELECT r.id,r.project_id,p.name project_name,r.notes,r.problems_delays_incidents problems,r.weather_site_conditions weather,r.photos_json
      FROM daily_project_reports r JOIN projects p ON p.id=r.project_id WHERE r.work_date=? ORDER BY p.name COLLATE NOCASE,r.id`,day);
    return rows.map(r=>({id:r.id,projectId:r.project_id,projectName:r.project_name,photos:photoCount(r.photos_json),notes:[r.notes,r.problems,r.weather].filter(filled).length}));
  }
}
