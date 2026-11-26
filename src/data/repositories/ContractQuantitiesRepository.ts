import type {
  ContractHistoryKind,ContractModePlan,ContractSiteEntry,ContractTrackingMode,ContractItem,ContractTargetRow,ContractItemDraft,ContractLoad,ContractLoadDay,ContractProjectSummary,ContractTotalsTarget,ContractUsage,
} from '../../domain/contractQuantities';
import type {ContractLoadSource} from './contractLinks';

/** A load as the contract screens show it: the rule fields plus the details the Owner needs to recognise it. */
export type ContractLoadDetail=ContractLoad&{
  confirmedAt:string;materialName:string;truckPlate:string;driverName:string;
  /** The customer of a company load, or the supplier of a supplier load. */
  partyName:string;
  ticketNumber:string|null;
};
export type ContractMaterial={id:string;name:string;unitId:string|null;unitSymbol:string|null};
export type ContractRowView={item:ContractItem;usage:ContractUsage;materials:ContractMaterial[]};
export type ContractHistoryLine={id:string;kind:ContractHistoryKind;reason:string|null;details:Record<string,unknown>;createdAt:string};
export type ContractItemDetail=ContractRowView&{
  /** True once loads point at the item or it has adjustments: every edit then needs a reason (the same rule editItem applies). */
  editNeedsReason:boolean;
  history:ContractHistoryLine[];loadsByDay:{days:ContractLoadDay<ContractLoadDetail>[];cancelled:ContractLoadDetail[]}};
export type ContractLoadRef={source:ContractLoadSource;loadId:string};
/** What the target form chooses from: active Catalog materials (with their usual unit) and active units. */
export type ContractFormSetup={materials:{id:string;name:string;categoryName:string;unitId:string|null;unitSymbol:string|null}[];units:{id:string;name:string;symbol:string}[]};

export interface ContractQuantitiesRepository{
  getSetup():Promise<ContractFormSetup>;
  /** The Company Settings name, logo and contact line: the report header when no Header company is chosen. */
  getCompanyIdentity():Promise<{name:string;logoUri:string|null;contactLine:string|null}>;
  listProject(projectId:string):Promise<{rows:ContractRowView[];summary:ContractProjectSummary}>;
  /** DEC-539. Live targets with their own figures for the Project Totals PDF, as of a date (the To date) or now when null. */
  totalsTargets(projectId:string,asOfDate:string|null):Promise<ContractTotalsTarget[]>;
  /** Company Daily Report. Every live target as of the end of a work date, with used before today, used today, % used and left. Read-only. */
  targetTableOn(projectId:string,workDate:string):Promise<ContractTargetRow[]>;
  getItem(contractItemId:string):Promise<ContractItemDetail>;
  createItem(projectId:string,draft:ContractItemDraft):Promise<ContractItem>;
  editItem(contractItemId:string,draft:ContractItemDraft,reason:string):Promise<ContractItem>;
  cancelItem(contractItemId:string,reason:string):Promise<ContractItem>;
  finishItem(contractItemId:string,completedOn:string):Promise<ContractItem>;
  reopenItem(contractItemId:string,reason:string):Promise<ContractItem>;
  addAdjustment(contractItemId:string,input:{amount:string;reason:string}):Promise<void>;
  /** A linked manual or manual target only: one dated entry in the target's unit; a negative amount is a correction and needs a note. Never edited or deleted. */
  addSiteEntry(contractItemId:string,input:{date:string;amount:string;note:string}):Promise<void>;
  /** What changing how used is tracked would do (value carried over, or entries that would stop counting), before anything is saved. */
  previewModeChange(contractItemId:string,to:ContractTrackingMode):Promise<ContractModePlan>;
  /** Changes how used is tracked as an audited edit. Going back to Automatic needs `confirmed`; no site entry is ever deleted. */
  changeTrackingMode(contractItemId:string,to:ContractTrackingMode,input:{reason:string;confirmed?:boolean}):Promise<ContractItem>;
  /** The target's site entries that count now, newest first. */
  listSiteEntries(contractItemId:string):Promise<ContractSiteEntry[]>;
  /** Links a load recorded earlier (or saved unlinked). A reason is required and kept in the history. */
  linkLoad(contractItemId:string,load:ContractLoadRef,reason:string):Promise<void>;
  /** Several loads with one reason, all or none. */
  linkLoads(contractItemId:string,loads:ContractLoadRef[],reason:string):Promise<void>;
  moveLoad(load:ContractLoadRef,toContractItemId:string,reason:string):Promise<void>;
  unlinkLoad(load:ContractLoadRef,reason:string):Promise<void>;
  /** Active loads of the item's project and materials that count toward no item yet. */
  linkableLoads(contractItemId:string):Promise<ContractLoadDetail[]>;
  candidatesFor(projectId:string|null,materialId:string):Promise<{candidates:ContractItem[];preselectedId:string|null}>;
}
