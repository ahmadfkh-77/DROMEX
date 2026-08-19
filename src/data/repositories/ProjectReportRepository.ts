import type { DailyProjectReport, DailyProjectReportDraft, LinkedProjectLoad, LinkedWasteDump, ProjectCompletionLoad, ProjectCompletionWasteDump, ProjectReportSetup } from '../../domain/projectReports';

export interface ProjectReportRepository {
  getSetup(): Promise<ProjectReportSetup>;
  listReports(projectId: string): Promise<DailyProjectReport[]>;
  getReportForDate(projectId: string, workDate: string): Promise<DailyProjectReport | null>;
  listLinkedLoads(projectId: string, workDate: string): Promise<LinkedProjectLoad[]>;
  listLinkedWasteDumps(projectId: string, workDate: string): Promise<LinkedWasteDump[]>;
  listProjectLoads(projectId: string): Promise<ProjectCompletionLoad[]>;
  listProjectWasteDumps(projectId: string): Promise<ProjectCompletionWasteDump[]>;
  saveReport(draft: DailyProjectReportDraft): Promise<DailyProjectReport>;
}
