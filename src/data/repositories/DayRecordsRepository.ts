import type {DayDailyReport,DayIssue} from '../../domain/companyDailyReport';

/** Read-only lists for the Company Daily Report: the issues created on a day and the daily reports of that day, as counts only. */
export interface DayRecordsRepository{
  /** Issues created on the local day, oldest first. */
  listIssues(day:string):Promise<DayIssue[]>;
  /** Daily reports whose work date is the day: photos and filled notes are counted, their text and files are never read. */
  listDailyReports(day:string):Promise<DayDailyReport[]>;
}
