import {afterEach,describe,expect,it} from 'vitest';

import {SqliteWorkspaceRepository} from '../src/data/repositories/SqliteWorkspaceRepository';
import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * Projects list "Last activity": the latest effective date of recorded work on a project. Only
 * Active operational records count; plans (schedule tasks) and design edits (walls, pavement) do not,
 * because a future task date or a recalculated wall is not work that happened on site.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});
const T=SEED_TIME;

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`
    INSERT INTO projects (id,customer_id,name,location,status,start_date,created_at,updated_at,is_archived) VALUES
      ('quiet','customer','Quiet Project','Tyre','active','2026-08-01','${T}','${T}',0),
      ('issues','customer','Issue Project','Saida','completed','2026-08-01','${T}','${T}',0);
    INSERT INTO categories (id,name,created_at,updated_at) VALUES ('cat','Materials','${T}','${T}');
    INSERT INTO catalog_items (id,category_id,name,loads_enabled,created_at,updated_at) VALUES ('sand','cat','Sand',1,'${T}','${T}');
    INSERT INTO truck_profiles (id,plate,is_active,created_at,updated_at) VALUES ('truck','B123',1,'${T}','${T}');
    INSERT INTO driver_profiles (id,name,is_active,created_at,updated_at,person_role) VALUES ('driver','Omar',1,'${T}','${T}','driver');
  `);
  return db;
}
const companyLoad=(db:SqliteTestDatabase,id:string,day:string,status='Active',archived=0)=>db.raw.exec(`INSERT INTO loads (id,transaction_number,confirmed_at,customer_id,customer_name,project_id,project_name,item_id,item_name,category_name,driver_name,truck_plate,driver_profile_id,truck_profile_id,
  empty_weight_kg,full_weight_kg,net_weight_kg,conversion_id,conversion_name,conversion_rule,output_unit_symbol,converted_quantity,billed_quantity,payment_status,company_name,quantity_method,status,is_archived)
  VALUES ('${id}','TX-${id}','${day}T09:00:00','customer','Road Co','road','Mountain Road','sand','Sand','Materials','Omar','B123','driver','truck',0,1,1,'conversion_kg_ton','Direct quantity','Entered directly','t',1,1,'Unpriced','DROMEX','weighbridge','${status}',${archived})`);

describe('last recorded activity per project',()=>{
  it('takes the latest Active operational record and ignores cancelled, archived, planned and design-only records',async()=>{
    const db=await setup();
    companyLoad(db,'l1','2026-08-05');
    companyLoad(db,'l2','2026-09-18','Cancelled');
    companyLoad(db,'l3','2026-09-19','Active',1);
    db.raw.exec(`
      INSERT INTO daily_project_reports (id,project_id,work_date,work_description,created_at,updated_at) VALUES ('r1','road','2026-08-20','Paving','2026-09-02T08:00:00Z','2026-09-02T08:00:00Z');
      INSERT INTO waste_dumps (id,project_id,work_date,dumped_at,status,created_at,updated_at) VALUES ('w1','road','2026-09-12','2026-09-12T10:00:00','Cancelled','${T}','${T}');
      INSERT INTO schedule_tasks (id,project_id,title,start_date,end_date,created_at,updated_at) VALUES ('s1','road','Future paving','2026-12-01','2026-12-10','${T}','${T}');
    `);
    const dates=await new SqliteWorkspaceRepository(db as never).getLastRecordedActivityDates();
    // The report counts on its work date, not on the day it was typed in.
    expect(dates.road).toBe('2026-08-20');
  });

  it('uses the waste work date and counts issues and photos',async()=>{
    const db=await setup();
    db.raw.exec(`
      INSERT INTO waste_dumps (id,project_id,work_date,dumped_at,status,created_at,updated_at) VALUES ('w1','road','2026-08-22','2026-09-30T10:00:00','Active','${T}','${T}');
      INSERT INTO project_issues (id,project_id,title,created_at,updated_at) VALUES ('i1','issues','Blocked road','2026-08-25T10:00:00','2026-08-25T10:00:00');
      INSERT INTO project_media (id,project_id,uri,created_at) VALUES ('m1','issues','file:///photo.jpg','2026-08-27T10:00:00');
    `);
    const dates=await new SqliteWorkspaceRepository(db as never).getLastRecordedActivityDates();
    expect(dates.road).toBe('2026-08-22');
    expect(dates.issues).toBe('2026-08-27');
  });

  it('omits a project with no recorded work instead of inventing a date',async()=>{
    const db=await setup();
    const dates=await new SqliteWorkspaceRepository(db as never).getLastRecordedActivityDates();
    expect(dates).not.toHaveProperty('quiet');
    expect(dates).not.toHaveProperty('road');
  });
});
