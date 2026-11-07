/**
 * DEC-544. A simple daily who-worked-where sheet: which people (drivers, operators and workers), trucks and machines worked on a day, and at which place
 * or places. Presence and places only: no hours, no pay, no wages. A place is an active project, an active company site, or a typed place
 * (free text for that day only, which creates no project or site).
 */
/** A person is any entry of the People directory (driver, operator or worker). */
export type AttendanceSubjectType='person'|'truck'|'machine';
export type AttendancePlaceType='project'|'company_site'|'typed';
export type AttendancePlace={type:AttendancePlaceType;id:string|null;name:string};
export type AttendanceSubject={type:AttendanceSubjectType;id:string};
export type AttendanceEntry={id:string;workDate:string;subjectType:AttendanceSubjectType;subjectId:string;/** As it was when the entry was saved. */name:string;/** Role (people) or type (trucks, machines), as it was when saved. */detail:string|null;places:AttendancePlace[]};

export const MAX_ATTENDANCE_PLACES=10;
export const MAX_TYPED_PLACE_LENGTH=80;

/** Trims, drops repeated places and checks the rules. At least one place is needed, at most ten; a typed place needs a name; a project or site needs an id. */
export function validateAttendancePlaces(places:readonly AttendancePlace[]):AttendancePlace[]{
  const seen=new Set<string>();const result:AttendancePlace[]=[];
  for(const place of places){
    const name=place.name.replace(/\s+/g,' ').trim();
    if(place.type==='typed'){
      if(!name)throw new Error('Type the name of the place.');
      if(name.length>MAX_TYPED_PLACE_LENGTH)throw new Error(`A typed place can have at most ${MAX_TYPED_PLACE_LENGTH} characters.`);
    }else if(!place.id)throw new Error('Choose a project or company site from the list.');
    const key=place.type==='typed'?`typed:${name.toLowerCase()}`:`${place.type}:${place.id}`;
    if(seen.has(key))continue;seen.add(key);
    result.push({type:place.type,id:place.type==='typed'?null:place.id,name});
  }
  if(!result.length)throw new Error('Choose at least one place.');
  if(result.length>MAX_ATTENDANCE_PLACES)throw new Error(`Choose at most ${MAX_ATTENDANCE_PLACES} places.`);
  return result;
}

export type AttendanceRow={id:string;name:string;detail:string|null;places:AttendancePlace[];/** All places, comma separated: every one is listed, never "N more". */workedAt:string};
export type AttendanceSheet={people:AttendanceRow[];trucks:AttendanceRow[];machines:AttendanceRow[];count:number};

const row=(entry:AttendanceEntry):AttendanceRow=>({id:entry.id,name:entry.name,detail:entry.detail,places:entry.places,workedAt:entry.places.map(p=>p.name).join(', ')});
const byName=(a:AttendanceRow,b:AttendanceRow)=>a.name.localeCompare(b.name);

/** The three lists of the sheet, from the entries of one day. Only entries that exist (ticked as worked) are in it. */
export function buildAttendanceSheet(entries:readonly AttendanceEntry[]):AttendanceSheet{
  const people=entries.filter(e=>e.subjectType==='person').map(row).sort(byName);
  const trucks=entries.filter(e=>e.subjectType==='truck').map(row).sort(byName);
  const machines=entries.filter(e=>e.subjectType==='machine').map(row).sort(byName);
  return {people,trucks,machines,count:people.length+trucks.length+machines.length};
}
