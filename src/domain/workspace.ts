import type {Project} from './loads';

export type WorkspaceIssuePriority='Low'|'Normal'|'High'|'Urgent';
export type WorkspaceIssueStatus='Open'|'Resolved';
export type WorkspaceIssue={id:string;projectId:string;title:string;description:string|null;priority:WorkspaceIssuePriority;status:WorkspaceIssueStatus;dueDate:string|null;resolvedAt:string|null;createdAt:string;updatedAt:string};
export type WorkspaceIssueDraft={title:string;description:string;priority:WorkspaceIssuePriority;dueDate:string};
export type WorkspacePhoto={id:string;projectId:string;uri:string;caption:string|null;createdAt:string};
export type WorkspaceActivity={id:string;type:'Load'|'Daily Report'|'Waste Dump'|'Fuel'|'Quarry'|'Schedule'|'Pavement'|'Wall'|'Issue'|'Photo';occurredAt:string;title:string;detail:string|null};
export type ProjectWorkspaceSnapshot={
  project:Project;
  metrics:{loads:number;netTonnes:number;dailyReports:number;wasteDumps:number;fuelLitres:number;quarryPurchases:number;scheduled:number;pavementCalculations:number;walls:number;openIssues:number};
  activities:WorkspaceActivity[];
  issues:WorkspaceIssue[];
  photos:WorkspacePhoto[];
};

export type GlobalSearchRoute='loads'|'customers'|'projects'|'directory'|'catalog'|'reports'|'quarry'|'quickText'|'financials'|'waste'|'schedule'|'pavement'|'walls';
export type GlobalSearchResult={id:string;kind:string;title:string;subtitle:string;date:string|null;route:GlobalSearchRoute;projectId:string|null};
export type AttentionSnapshot={syncPending:number;unpricedLoads:number;outstandingRecords:number;missingReportsToday:number;incompleteWaste:number;blockedSchedule:number;openIssues:number;loadDrafts:number};

export const emptyWorkspaceIssue:WorkspaceIssueDraft={title:'',description:'',priority:'Normal',dueDate:''};
