import type {SQLiteDatabase} from 'expo-sqlite';

import {validateAttendancePlaces,type AttendanceEntry,type AttendancePlace,type AttendanceSubject,type AttendanceSubjectType} from '../../domain/attendance';
import type {AttendanceChoice,AttendanceRepository,AttendanceSetup} from './AttendanceRepository';

type EntryRow={id:string;work_date:string;subject_type:AttendanceSubjectType;subject_id:string;subject_name:string;subject_detail:string|null};
type PlaceRow={attendance_id:string;place_type:AttendancePlace['type'];place_id:string|null;place_name:string};

const newId=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const clean=(value:string|null|undefined)=>value&&value.trim()?value.trim():null;

/** A person's role as the sheet prints it: the job title when there is one, otherwise Driver, Operator or Worker. */
const personDetail=(role:string,jobTitle:string|null)=>clean(jobTitle)??(role.charAt(0).toUpperCase()+role.slice(1));

/** The name and role or type of the person, truck or machine, read from its profile. Null when the profile does not exist. */
async function lookupSubject(db:SQLiteDatabase,subject:AttendanceSubject):Promise<{name:string;detail:string|null}|null>{
  if(subject.type==='person'){const row=await db.getFirstAsync<{name:string;person_role:string;job_title:string|null}>('SELECT name,person_role,job_title FROM driver_profiles WHERE id=?',subject.id);return row?{name:row.name,detail:personDetail(row.person_role,row.job_title)}:null;}
  if(subject.type==='truck'){const row=await db.getFirstAsync<{plate:string;make_model:string|null}>('SELECT plate,make_model FROM truck_profiles WHERE id=?',subject.id);return row?{name:row.plate,detail:clean(row.make_model)??'Truck'}:null;}
  const row=await db.getFirstAsync<{name:string;machine_type:string|null}>('SELECT name,machine_type FROM machine_profiles WHERE id=?',subject.id);return row?{name:row.name,detail:clean(row.machine_type)??'Machine'}:null;
}

export class SqliteAttendanceRepository implements AttendanceRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async getSetup(workDate:string):Promise<AttendanceSetup>{
    const [people,trucks,machines,projects,sites,entries]=await Promise.all([
      this.db.getAllAsync<{id:string;name:string;person_role:string;job_title:string|null}>('SELECT id,name,person_role,job_title FROM driver_profiles WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;plate:string;make_model:string|null}>('SELECT id,plate,make_model FROM truck_profiles WHERE is_active=1 ORDER BY plate COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;name:string;machine_type:string|null}>('SELECT id,name,machine_type FROM machine_profiles WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;name:string}>("SELECT id,name FROM projects WHERE status='active' AND is_archived=0 ORDER BY name COLLATE NOCASE"),
      this.db.getAllAsync<{id:string;name:string}>('SELECT id,name FROM company_sites WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
      this.listDay(workDate),
    ]);
    const choice=(subjectType:AttendanceSubjectType,id:string,name:string,detail:string|null):AttendanceChoice=>({subjectType,id,name,detail});
    return {
      people:people.map(r=>choice('person',r.id,r.name,personDetail(r.person_role,r.job_title))),
      trucks:trucks.map(r=>choice('truck',r.id,r.plate,clean(r.make_model)??'Truck')),
      machines:machines.map(r=>choice('machine',r.id,r.name,clean(r.machine_type)??'Machine')),
      projects,sites,entries,
    };
  }

  async listDay(workDate:string):Promise<AttendanceEntry[]>{
    const rows=await this.db.getAllAsync<EntryRow>('SELECT id,work_date,subject_type,subject_id,subject_name,subject_detail FROM daily_attendance WHERE work_date=? ORDER BY subject_name COLLATE NOCASE',workDate);
    if(!rows.length)return [];
    const places=await this.db.getAllAsync<PlaceRow>(`SELECT attendance_id,place_type,place_id,place_name FROM daily_attendance_places WHERE attendance_id IN (${rows.map(()=>'?').join(',')}) ORDER BY position`,...rows.map(r=>r.id));
    return rows.map(r=>({id:r.id,workDate:r.work_date,subjectType:r.subject_type,subjectId:r.subject_id,name:r.subject_name,detail:r.subject_detail,
      places:places.filter(p=>p.attendance_id===r.id).map(p=>({type:p.place_type,id:p.place_id,name:p.place_name}))}));
  }

  async saveEntry(workDate:string,subject:AttendanceSubject,places:AttendancePlace[]):Promise<AttendanceEntry>{
    const valid=validateAttendancePlaces(places);
    const found=await lookupSubject(this.db,subject);
    if(!found)throw new Error('That person, truck or machine was not found.');
    // Projects and company sites are taken from the records, so the name printed is the real one at the time; a typed place stays as typed.
    const resolved:AttendancePlace[]=[];
    for(const place of valid){
      if(place.type==='project'){const row=await this.db.getFirstAsync<{name:string}>('SELECT name FROM projects WHERE id=?',place.id);if(!row)throw new Error('The chosen project was not found.');resolved.push({type:'project',id:place.id,name:row.name});}
      else if(place.type==='company_site'){const row=await this.db.getFirstAsync<{name:string}>('SELECT name FROM company_sites WHERE id=?',place.id);if(!row)throw new Error('The chosen company site was not found.');resolved.push({type:'company_site',id:place.id,name:row.name});}
      else resolved.push(place);
    }
    const now=new Date().toISOString();let entry!:AttendanceEntry;
    await this.db.withTransactionAsync(async()=>{
      const existing=await this.db.getFirstAsync<{id:string}>('SELECT id FROM daily_attendance WHERE work_date=? AND subject_type=? AND subject_id=?',workDate,subject.type,subject.id);
      const id=existing?.id??newId('attendance');
      if(existing){
        await this.db.runAsync('DELETE FROM daily_attendance_places WHERE attendance_id=?',id);
        await this.db.runAsync('UPDATE daily_attendance SET updated_at=? WHERE id=?',now,id);
      }else await this.db.runAsync('INSERT INTO daily_attendance (id,work_date,subject_type,subject_id,subject_name,subject_detail,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',id,workDate,subject.type,subject.id,found.name,found.detail,now,now);
      for(const [index,place] of resolved.entries())await this.db.runAsync('INSERT INTO daily_attendance_places (id,attendance_id,place_type,place_id,place_name,position) VALUES (?,?,?,?,?,?)',newId('attplace'),id,place.type,place.id,place.name,index);
      const saved=await this.db.getFirstAsync<{subject_name:string;subject_detail:string|null}>('SELECT subject_name,subject_detail FROM daily_attendance WHERE id=?',id);
      entry={id,workDate,subjectType:subject.type,subjectId:subject.id,name:saved!.subject_name,detail:saved!.subject_detail,places:resolved};
      await this.db.runAsync('INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)','dailyAttendance',id,'upsert',JSON.stringify(entry),now);
    });
    return entry;
  }

  async removeEntry(workDate:string,subject:AttendanceSubject):Promise<void>{
    await this.db.withTransactionAsync(async()=>{
      const existing=await this.db.getFirstAsync<{id:string}>('SELECT id FROM daily_attendance WHERE work_date=? AND subject_type=? AND subject_id=?',workDate,subject.type,subject.id);
      if(!existing)return;
      await this.db.runAsync('DELETE FROM daily_attendance_places WHERE attendance_id=?',existing.id);
      await this.db.runAsync('DELETE FROM daily_attendance WHERE id=?',existing.id);
      await this.db.runAsync('INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)','dailyAttendance',existing.id,'delete',JSON.stringify({id:existing.id,workDate}),new Date().toISOString());
    });
  }
}
