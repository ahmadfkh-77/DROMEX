import type {AttentionSnapshot,GlobalSearchResult,ProjectWorkspaceSnapshot,WorkspaceActivity,WorkspaceIssue,WorkspaceIssueDraft,WorkspacePhoto} from '../../domain/workspace';

export interface WorkspaceRepository{
  getProjectWorkspace(projectId:string):Promise<ProjectWorkspaceSnapshot>;
  listProjectActivities(projectId:string,fromDate?:string,toDate?:string):Promise<WorkspaceActivity[]>;
  /**
   * Latest effective date (YYYY-MM-DD) of recorded work, by project id. Only Active operational
   * records count -- loads, supplier loads, daily reports, fuel fills, waste dumps, issues, photos --
   * never schedule plans or wall/pavement edits. A project with no such record is absent.
   */
  getLastRecordedActivityDates():Promise<Record<string,string>>;
  createIssue(projectId:string,draft:WorkspaceIssueDraft):Promise<WorkspaceIssue>;
  setIssueResolved(id:string,resolved:boolean):Promise<void>;
  addProjectPhoto(projectId:string,uri:string,caption:string):Promise<WorkspacePhoto>;
  search(query:string):Promise<GlobalSearchResult[]>;
  getAttentionSnapshot():Promise<AttentionSnapshot>;
}
