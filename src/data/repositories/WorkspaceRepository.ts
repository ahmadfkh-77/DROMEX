import type {AttentionSnapshot,GlobalSearchResult,ProjectWorkspaceSnapshot,WorkspaceActivity,WorkspaceIssue,WorkspaceIssueDraft,WorkspacePhoto} from '../../domain/workspace';

export interface WorkspaceRepository{
  getProjectWorkspace(projectId:string):Promise<ProjectWorkspaceSnapshot>;
  listProjectActivities(projectId:string,fromDate?:string,toDate?:string):Promise<WorkspaceActivity[]>;
  createIssue(projectId:string,draft:WorkspaceIssueDraft):Promise<WorkspaceIssue>;
  setIssueResolved(id:string,resolved:boolean):Promise<void>;
  addProjectPhoto(projectId:string,uri:string,caption:string):Promise<WorkspacePhoto>;
  search(query:string):Promise<GlobalSearchResult[]>;
  getAttentionSnapshot():Promise<AttentionSnapshot>;
}
