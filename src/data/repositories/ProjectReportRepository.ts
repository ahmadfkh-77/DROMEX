import type { DailyProjectReport, DailyProjectReportDraft, LinkedFoundationActivity, LinkedFuelFill, LinkedProjectLoad, LinkedQuarryLoad, LinkedWallWork, LinkedWasteDump, ProjectCompletionLoad, ProjectCompletionWasteDump, ProjectReportSetup } from '../../domain/projectReports';

export interface ProjectReportRepository {
  getSetup(): Promise<ProjectReportSetup>;
  listReports(projectId: string): Promise<DailyProjectReport[]>;
  getReportForDate(projectId: string, workDate: string): Promise<DailyProjectReport | null>;
  listLinkedLoads(projectId: string, workDate: string): Promise<LinkedProjectLoad[]>;
  listLinkedQuarryLoads(projectId:string,workDate:string):Promise<LinkedQuarryLoad[]>;
  listLinkedFuelFills(projectId:string,workDate:string):Promise<LinkedFuelFill[]>;
  listLinkedWasteDumps(projectId: string, workDate: string): Promise<LinkedWasteDump[]>;
  listLinkedWallWork(projectId: string, workDate: string): Promise<LinkedWallWork[]>;
  /** DEC-464. Foundations with activity on this work date but no wall linked to them yet. */
  listLinkedFoundationActivity(projectId: string, workDate: string): Promise<LinkedFoundationActivity[]>;
  listProjectLoads(projectId: string): Promise<ProjectCompletionLoad[]>;
  listProjectWasteDumps(projectId: string): Promise<ProjectCompletionWasteDump[]>;
  saveReport(draft: DailyProjectReportDraft): Promise<DailyProjectReport>;
}
