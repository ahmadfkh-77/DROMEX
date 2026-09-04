import type {SQLiteDatabase} from 'expo-sqlite';
import {isMeaningfulLoadDraft,type LoadDraft,type Project} from '../../domain/loads';
import type {AttentionSnapshot,GlobalSearchResult,ProjectWorkspaceSnapshot,WorkspaceActivity,WorkspaceIssue,WorkspaceIssueDraft,WorkspacePhoto} from '../../domain/workspace';
import type {WorkspaceRepository} from './WorkspaceRepository';

type CountRow={count:number;value?:number|null};
type IssueRow={id:string;project_id:string;title:string;description:string|null;priority:WorkspaceIssue['priority'];status:WorkspaceIssue['status'];due_date:string|null;resolved_at:string|null;created_at:string;updated_at:string};
type PhotoRow={id:string;project_id:string;uri:string;caption:string|null;created_at:string};
type ActivityRow={id:string;type:WorkspaceActivity['type'];occurred_at:string;title:string;detail:string|null};
type SearchRow={id:string;kind:string;title:string;subtitle:string|null;date:string|null;route:GlobalSearchResult['route'];project_id:string|null};
const id=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const clean=(value:string)=>value.trim().replace(/\s+/g,' ')||null;
const issue=(row:IssueRow):WorkspaceIssue=>({id:row.id,projectId:row.project_id,title:row.title,description:row.description,priority:row.priority,status:row.status,dueDate:row.due_date,resolvedAt:row.resolved_at,createdAt:row.created_at,updatedAt:row.updated_at});
const photo=(row:PhotoRow):WorkspacePhoto=>({id:row.id,projectId:row.project_id,uri:row.uri,caption:row.caption,createdAt:row.created_at});
const activity=(row:ActivityRow):WorkspaceActivity=>({id:row.id,type:row.type,occurredAt:row.occurred_at,title:row.title,detail:row.detail});
const activityUnionSql=`
  SELECT id,'Load' type,confirmed_at occurred_at,transaction_number title,item_name||' · '||printf('%.3f',billed_quantity)||' '||output_unit_symbol detail FROM loads WHERE project_id=? AND is_archived=0 AND status='Active'
  UNION ALL SELECT id,'Daily Report',work_date||'T12:00:00',work_description,'Daily project report' FROM daily_project_reports WHERE project_id=?
  UNION ALL SELECT id,'Waste Dump',dumped_at,COALESCE(material_type,'Waste dump'),COALESCE(driver_name,'')||CASE WHEN truck_plate IS NULL THEN '' ELSE ' · '||truck_plate END FROM waste_dumps WHERE project_id=? AND status='Active'
  UNION ALL SELECT id,'Fuel',confirmed_at,COALESCE(equipment_name,'Equipment fill'),printf('%.2f L',litres)||CASE WHEN odometer_reading IS NULL THEN '' ELSE ' · Odometer '||odometer_reading END FROM fuel_movements WHERE project_id=? AND movement_type='fill' AND status='Active'
  UNION ALL SELECT id,'Quarry',confirmed_at,purchase_number,item_name||' · '||quantity_cubic_metres||' '||COALESCE(unit_symbol,'m³') FROM quarry_purchases WHERE project_id=? AND status='Active'
  UNION ALL SELECT id,'Schedule',start_date||'T00:00:00',title,status||' · '||priority FROM schedule_tasks WHERE project_id=?
  UNION ALL SELECT id,'Pavement',updated_at,name,printf('%.0f kg/m² · %.3f t planned',spread_rate_kg_m2,planned_kg/1000.0) FROM pavement_calculations WHERE project_id=?
  UNION ALL SELECT id,'Wall',updated_at,name,printf('%.2f m³ planned',planned_volume_m3) FROM walls WHERE project_id=?
  UNION ALL SELECT id,'Issue',created_at,title,status||' · '||priority FROM project_issues WHERE project_id=?
  UNION ALL SELECT id,'Photo',created_at,COALESCE(caption,'Site photo'),'Project photo' FROM project_media WHERE project_id=?`;
const activityProjectParams=(projectId:string)=>Array(10).fill(projectId);

export class SqliteWorkspaceRepository implements WorkspaceRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async getProjectWorkspace(projectId:string):Promise<ProjectWorkspaceSnapshot>{
    const row=await this.db.getFirstAsync<{id:string;customer_id:string;customer_name:string;name:string;location:string;status:Project['status'];notes:string|null;start_date:string|null;end_date:string|null;created_at:string;updated_at:string}>(`SELECT p.id,p.customer_id,c.name customer_name,p.name,p.location,p.status,p.notes,p.start_date,p.end_date,p.created_at,p.updated_at FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.id=? AND p.is_archived=0`,projectId);
    if(!row)throw new Error('Project was not found.');
    const project:Project={id:row.id,customerId:row.customer_id,customerName:row.customer_name,name:row.name,location:row.location,status:row.status,notes:row.notes,startDate:row.start_date??row.created_at.slice(0,10),endDate:row.end_date??(row.status==='completed'?row.updated_at.slice(0,10):null)};
    const[loads,reports,waste,fuel,quarry,scheduled,pavement,walls,openIssues,issues,photos,activities]=await Promise.all([
      this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count,COALESCE(SUM(net_weight_kg),0) value FROM loads WHERE project_id=? AND is_archived=0 AND status='Active'`,projectId),
      this.db.getFirstAsync<CountRow>('SELECT COUNT(*) count FROM daily_project_reports WHERE project_id=?',projectId),
      this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM waste_dumps WHERE project_id=? AND status='Active'`,projectId),
      this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count,COALESCE(SUM(litres),0) value FROM fuel_movements WHERE project_id=? AND movement_type='fill' AND status='Active'`,projectId),
      this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM quarry_purchases WHERE project_id=? AND status='Active'`,projectId),
      this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM schedule_tasks WHERE project_id=? AND status<>'Completed'`,projectId),
      this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM pavement_calculations WHERE project_id=?`,projectId),
      this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM walls WHERE project_id=?`,projectId),
      this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM project_issues WHERE project_id=? AND status='Open'`,projectId),
      this.db.getAllAsync<IssueRow>(`SELECT * FROM project_issues WHERE project_id=? ORDER BY CASE status WHEN 'Open' THEN 0 ELSE 1 END,CASE priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END,created_at DESC`,projectId),
      this.db.getAllAsync<PhotoRow>('SELECT * FROM project_media WHERE project_id=? ORDER BY created_at DESC',projectId),
      this.db.getAllAsync<ActivityRow>(`SELECT id,type,occurred_at,title,detail FROM (SELECT activity.*,ROW_NUMBER() OVER (PARTITION BY type ORDER BY occurred_at DESC) activity_rank FROM (${activityUnionSql}) activity) WHERE activity_rank<=50 ORDER BY occurred_at DESC`,...activityProjectParams(projectId)),
    ]);
    return{project,metrics:{loads:loads?.count??0,netTonnes:Number(loads?.value??0)/1000,dailyReports:reports?.count??0,wasteDumps:waste?.count??0,fuelLitres:Number(fuel?.value??0),quarryPurchases:quarry?.count??0,scheduled:scheduled?.count??0,pavementCalculations:pavement?.count??0,walls:walls?.count??0,openIssues:openIssues?.count??0},activities:activities.map(activity),issues:issues.map(issue),photos:photos.map(photo)};
  }

  async listProjectActivities(projectId:string,fromDate='',toDate=''):Promise<WorkspaceActivity[]>{
    if(fromDate&&toDate&&fromDate>toDate)throw new Error('From date cannot be after To date.');
    const project=await this.db.getFirstAsync<{start_date:string|null;end_date:string|null;created_at:string;updated_at:string;status:Project['status']}>(`SELECT start_date,end_date,created_at,updated_at,status FROM projects WHERE id=? AND is_archived=0`,projectId);if(!project)throw new Error('Project was not found.');const projectStart=project.start_date??project.created_at.slice(0,10),projectEnd=project.status==='completed'?(project.end_date??project.updated_at.slice(0,10)):this.today();if(fromDate&&fromDate<projectStart)throw new Error(`From date cannot be before the project start date (${projectStart}).`);if(toDate&&toDate<projectStart)throw new Error(`To date cannot be before the project start date (${projectStart}).`);if(fromDate&&fromDate>projectEnd)throw new Error(`From date cannot be after the project ${project.status==='completed'?'finish date':'current date'} (${projectEnd}).`);if(toDate&&toDate>projectEnd)throw new Error(`To date cannot be after the project ${project.status==='completed'?'finish date':'current date'} (${projectEnd}).`);
    const conditions:string[]=[];const params:string[]=[...activityProjectParams(projectId)];if(fromDate){conditions.push('substr(occurred_at,1,10)>=?');params.push(fromDate);}if(toDate){conditions.push('substr(occurred_at,1,10)<=?');params.push(toDate);}const where=conditions.length?`WHERE ${conditions.join(' AND ')}`:'';
    const rows=await this.db.getAllAsync<ActivityRow>(`SELECT id,type,occurred_at,title,detail FROM (${activityUnionSql}) ${where} ORDER BY occurred_at DESC LIMIT 500`,...params);
    return rows.map(activity);
  }

  async createIssue(projectId:string,draft:WorkspaceIssueDraft):Promise<WorkspaceIssue>{
    const title=draft.title.trim();if(!title)throw new Error('Issue title is required.');if(!(['Low','Normal','High','Urgent'] as const).includes(draft.priority))throw new Error('Choose a valid priority.');
    const project=await this.db.getFirstAsync<{id:string}>(`SELECT id FROM projects WHERE id=? AND status='active' AND is_archived=0`,projectId);if(!project)throw new Error('Reactivate the project before adding an issue.');
    const issueId=id('project_issue'),now=new Date().toISOString();await this.db.withTransactionAsync(async()=>{await this.db.runAsync('INSERT INTO project_issues (id,project_id,title,description,priority,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',issueId,projectId,title,clean(draft.description),draft.priority,draft.dueDate||null,now,now);await this.enqueue('projectIssue',issueId,{id:issueId,projectId,...draft,status:'Open',createdAt:now,updatedAt:now});});return this.getIssue(issueId);
  }

  async setIssueResolved(issueId:string,resolved:boolean):Promise<void>{const now=new Date().toISOString();const result=await this.db.runAsync(`UPDATE project_issues SET status=?,resolved_at=?,updated_at=? WHERE id=?`,resolved?'Resolved':'Open',resolved?now:null,now,issueId);if(!result.changes)throw new Error('Project issue was not found.');await this.enqueue('projectIssue',issueId,{id:issueId,status:resolved?'Resolved':'Open',resolvedAt:resolved?now:null,updatedAt:now});}

  async addProjectPhoto(projectId:string,uri:string,caption:string):Promise<WorkspacePhoto>{if(!uri)throw new Error('Choose or capture a photo.');const project=await this.db.getFirstAsync<{id:string}>(`SELECT id FROM projects WHERE id=? AND status='active' AND is_archived=0`,projectId);if(!project)throw new Error('Reactivate the project before adding a photo.');const photoId=id('project_photo'),now=new Date().toISOString();await this.db.withTransactionAsync(async()=>{await this.db.runAsync('INSERT INTO project_media (id,project_id,uri,caption,created_at) VALUES (?,?,?,?,?)',photoId,projectId,uri,clean(caption),now);await this.enqueue('projectPhoto',photoId,{id:photoId,projectId,uri,caption:clean(caption),createdAt:now});});const row=await this.db.getFirstAsync<PhotoRow>('SELECT * FROM project_media WHERE id=?',photoId);if(!row)throw new Error('Project photo was not found after saving.');return photo(row);}

  async search(query:string):Promise<GlobalSearchResult[]>{const value=query.trim();if(value.length<2)return[];const like=`%${value.replace(/[\\%_]/g,character=>`\\${character}`)}%`;const rows=await this.db.getAllAsync<SearchRow>(`SELECT * FROM (
      SELECT id,'Load' kind,transaction_number title,(CASE WHEN status='Cancelled' THEN 'CANCELLED · ' ELSE '' END)||customer_name||' · '||COALESCE(project_name,'No project')||' · '||item_name||' · '||driver_name||' · '||truck_plate subtitle,confirmed_at date,'loads' route,project_id FROM loads WHERE is_archived=0 AND (transaction_number LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR COALESCE(project_name,'') LIKE ? ESCAPE '\\' OR item_name LIKE ? ESCAPE '\\' OR driver_name LIKE ? ESCAPE '\\' OR truck_plate LIKE ? ESCAPE '\\')
      UNION ALL SELECT id,'Customer',name,COALESCE(phone,'')||CASE WHEN email IS NULL THEN '' ELSE ' · '||email END,created_at,'customers',NULL FROM customers WHERE name LIKE ? ESCAPE '\\' OR COALESCE(phone,'') LIKE ? ESCAPE '\\' OR COALESCE(email,'') LIKE ? ESCAPE '\\'
      UNION ALL SELECT id,'Project',name,location||' · '||status,updated_at,'projects',id FROM projects WHERE is_archived=0 AND (name LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\')
      UNION ALL SELECT id,'Driver',name,COALESCE(phone,''),created_at,'directory',NULL FROM driver_profiles WHERE name LIKE ? ESCAPE '\\' OR COALESCE(phone,'') LIKE ? ESCAPE '\\'
      UNION ALL SELECT id,'Truck',plate,COALESCE(make_model,''),created_at,'directory',NULL FROM truck_profiles WHERE plate LIKE ? ESCAPE '\\' OR COALESCE(make_model,'') LIKE ? ESCAPE '\\'
      UNION ALL SELECT i.id,'Item',i.name,COALESCE(i.internal_code,'')||' · '||c.name,i.created_at,'catalog',NULL FROM catalog_items i JOIN categories c ON c.id=i.category_id WHERE i.name LIKE ? ESCAPE '\\' OR COALESCE(i.internal_code,'') LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'
      UNION ALL SELECT id,'Supplier',name,COALESCE(phone,''),created_at,'quarry',NULL FROM suppliers WHERE name LIKE ? ESCAPE '\\' OR COALESCE(phone,'') LIKE ? ESCAPE '\\'
      UNION ALL SELECT id,'Supplier Load',purchase_number,supplier_name||' · '||COALESCE(project_name,'No project')||' · '||item_name||' · '||driver_name||' · '||truck_plate,confirmed_at,'quarry',project_id FROM quarry_purchases WHERE purchase_number LIKE ? ESCAPE '\\' OR supplier_name LIKE ? ESCAPE '\\' OR COALESCE(project_name,'') LIKE ? ESCAPE '\\' OR item_name LIKE ? ESCAPE '\\' OR driver_name LIKE ? ESCAPE '\\' OR truck_plate LIKE ? ESCAPE '\\'
      UNION ALL SELECT r.id,'Daily Report',r.work_description,p.name||' · '||r.work_date,r.work_date,'reports',r.project_id FROM daily_project_reports r JOIN projects p ON p.id=r.project_id WHERE r.work_description LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'
      UNION ALL SELECT id,'Quick Text',document_number||' · '||title,COALESCE(project_name,customer_name,'')||' · '||substr(message,1,100),created_at,'quickText',project_id FROM quick_text_documents WHERE document_number LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\' OR COALESCE(reference,'') LIKE ? ESCAPE '\\'
      UNION ALL SELECT w.id,'Waste Dump',COALESCE(w.material_type,'Waste dump'),p.name||' · '||COALESCE(w.driver_name,'')||' · '||COALESCE(w.truck_plate,''),w.dumped_at,'waste',w.project_id FROM waste_dumps w JOIN projects p ON p.id=w.project_id WHERE COALESCE(w.material_type,'') LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\' OR COALESCE(w.driver_name,'') LIKE ? ESCAPE '\\' OR COALESCE(w.truck_plate,'') LIKE ? ESCAPE '\\'
      UNION ALL SELECT schedule_tasks.id,'Schedule',schedule_tasks.title,projects.name||' · '||schedule_tasks.status||' · '||schedule_tasks.priority,schedule_tasks.start_date,'schedule',schedule_tasks.project_id FROM schedule_tasks JOIN projects ON projects.id=schedule_tasks.project_id WHERE schedule_tasks.title LIKE ? ESCAPE '\\' OR projects.name LIKE ? ESCAPE '\\'
      UNION ALL SELECT x.id,'Pavement Calculation',x.name,p.name||' · '||printf('%.0f kg/m² · %.3f t',x.spread_rate_kg_m2,x.planned_kg/1000.0),x.updated_at,'pavement',x.project_id FROM pavement_calculations x JOIN projects p ON p.id=x.project_id WHERE x.name LIKE ? ESCAPE '\\' OR COALESCE(x.notes,'') LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'
      UNION ALL SELECT w.id,'Wall',w.name,p.name||' · '||printf('%.2f m³ planned',w.planned_volume_m3),w.updated_at,'walls',w.project_id FROM walls w JOIN projects p ON p.id=w.project_id WHERE w.name LIKE ? ESCAPE '\\' OR COALESCE(w.notes,'') LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'
      UNION ALL SELECT id,'Payment','Payment · $'||printf('%.2f',amount_usd_cents/100.0),target_type||' · '||payment_date,payment_date,'financials',NULL FROM payment_entries WHERE payment_date LIKE ? ESCAPE '\\' OR target_type LIKE ? ESCAPE '\\'
      UNION ALL SELECT i.id,'Project Issue',i.title,p.name||' · '||i.status||' · '||i.priority,i.created_at,'projects',i.project_id FROM project_issues i JOIN projects p ON p.id=i.project_id WHERE i.title LIKE ? ESCAPE '\\' OR COALESCE(i.description,'') LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'
    ) ORDER BY date DESC,title COLLATE NOCASE LIMIT 80`,...Array(49).fill(like));
    return rows.map(row=>({id:row.id,kind:row.kind,title:row.title,subtitle:row.subtitle??'',date:row.date,route:row.route,projectId:row.project_id}));
  }

  async getAttentionSnapshot():Promise<AttentionSnapshot>{const today=this.today();const[pending,unpriced,outstanding,missing,incomplete,blocked,issues,drafts]=await Promise.all([
    this.db.getFirstAsync<CountRow>('SELECT COUNT(*) count FROM sync_outbox'),
    this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM loads WHERE is_archived=0 AND status='Active' AND payment_status='Unpriced'`),
    this.db.getFirstAsync<CountRow>(`SELECT (SELECT COUNT(*) FROM loads WHERE is_archived=0 AND status='Active' AND payment_status IN ('Unpaid','Partially Paid'))+(SELECT COUNT(*) FROM quarry_purchases WHERE status='Active' AND payment_status IN ('Unpaid','Partially Paid'))+(SELECT COUNT(*) FROM fuel_movements WHERE status='Active' AND movement_type='delivery' AND payment_status IN ('Unpaid','Partially Paid'))+(SELECT COUNT(*) FROM opening_balances WHERE payment_status IN ('Unpaid','Partially Paid')) count`),
    this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM projects p WHERE p.status='active' AND p.is_archived=0 AND EXISTS(SELECT 1 FROM loads l WHERE l.project_id=p.id AND l.is_archived=0 AND l.status='Active' AND substr(l.confirmed_at,1,10)=?) AND NOT EXISTS(SELECT 1 FROM daily_project_reports r WHERE r.project_id=p.id AND r.work_date=?)`,today,today),
    this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM waste_dumps WHERE status='Active' AND (material_type IS NULL OR dump_location IS NULL OR driver_profile_id IS NULL OR truck_profile_id IS NULL)`),
    this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM schedule_tasks WHERE status='Blocked'`),
    this.db.getFirstAsync<CountRow>(`SELECT COUNT(*) count FROM project_issues WHERE status='Open'`),
    this.db.getFirstAsync<{payload_json:string}>('SELECT payload_json FROM load_drafts WHERE id=?','current'),
  ]);let loadDrafts=0;if(drafts?.payload_json){try{loadDrafts=isMeaningfulLoadDraft(JSON.parse(drafts.payload_json) as LoadDraft)?1:0;}catch{loadDrafts=0;}}return{syncPending:pending?.count??0,unpricedLoads:unpriced?.count??0,outstandingRecords:outstanding?.count??0,missingReportsToday:missing?.count??0,incompleteWaste:incomplete?.count??0,blockedSchedule:blocked?.count??0,openIssues:issues?.count??0,loadDrafts};}

  private async getIssue(issueId:string){const row=await this.db.getFirstAsync<IssueRow>('SELECT * FROM project_issues WHERE id=?',issueId);if(!row)throw new Error('Project issue was not found.');return issue(row);}
  private async enqueue(type:string,entityId:string,payload:unknown){await this.db.runAsync(`INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)`,type,entityId,'upsert',JSON.stringify(payload),new Date().toISOString());}
  private today(){const value=new Date();return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;}
}
