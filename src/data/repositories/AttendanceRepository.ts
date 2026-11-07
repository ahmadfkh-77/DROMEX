import type {AttendanceEntry,AttendancePlace,AttendanceSubject,AttendanceSubjectType} from '../../domain/attendance';

export type AttendanceChoice={subjectType:AttendanceSubjectType;id:string;name:string;detail:string|null};
export type AttendancePlaceChoice={id:string;name:string};
export type AttendanceSetup={
  people:AttendanceChoice[];trucks:AttendanceChoice[];machines:AttendanceChoice[];
  /** Active projects and active company sites, the places an entry can point at. */
  projects:AttendancePlaceChoice[];sites:AttendancePlaceChoice[];
  /** The entries that exist for the day (people ticked as worked). */
  entries:AttendanceEntry[];
};

/** DEC-544. The daily who-worked-where sheet. UI calls this; SQLite persists it and appends a sync_outbox entry in the same transaction. */
export interface AttendanceRepository{
  getSetup(workDate:string):Promise<AttendanceSetup>;
  /** The entries of one day (only those ticked as worked). */
  listDay(workDate:string):Promise<AttendanceEntry[]>;
  /** Ticks a person, truck or machine as worked on a day, at one or more places. Saving again replaces that day's places. */
  saveEntry(workDate:string,subject:AttendanceSubject,places:AttendancePlace[]):Promise<AttendanceEntry>;
  /** Takes the tick off: the entry for that day is removed. */
  removeEntry(workDate:string,subject:AttendanceSubject):Promise<void>;
}
