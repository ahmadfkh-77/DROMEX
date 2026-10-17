import type {WasteHistoryRow} from '../../domain/wasteHistory';
import type {WasteCounterDraft,WasteCounterPreset,WasteDump,WasteDumpDraft,WasteLocation,WasteProjectSummary,WasteSetup,WasteSiteSummary} from '../../domain/waste';

/**
 * Waste dumps count at a Location: a project or a company site. Every method that took a project id accepts a Location, and a bare project id
 * still means that project. A dump at a company site belongs to no project, so it never appears in a project's Daily Report or totals.
 */
export interface WasteRepository{
  getSetup():Promise<WasteSetup>;
  addWasteDump(location:WasteLocation|string,workDate?:string):Promise<WasteDump>;
  addWasteDumpFromCounter(counterId:string,workDate?:string):Promise<WasteDump>;
  listWasteDumps(location:WasteLocation|string):Promise<WasteDump[]>;
  /** Every location, one date range: the rows the waste history groups. Completed and archived projects are included, and cancelled dumps are returned (never counted by the history). */
  listWasteHistory(fromDate:string,toDate:string):Promise<WasteHistoryRow[]>;
  /** The company printed on the history PDF when no Header company was picked, read from Company Settings like the receipts. */
  getCompanyIdentity():Promise<{name:string;logoUri:string|null;contactLine:string|null}>;
  listWasteCounters(location:WasteLocation|string):Promise<WasteCounterPreset[]>;
  saveWasteCounter(location:WasteLocation|string,draft:WasteCounterDraft,id?:string):Promise<WasteCounterPreset>;
  removeWasteCounter(id:string):Promise<void>;
  updateWasteDump(id:string,draft:WasteDumpDraft):Promise<WasteDump>;
  cancelWasteDump(id:string,reason:string):Promise<WasteDump>;
  getProjectSummary(projectId:string):Promise<WasteProjectSummary>;
  /** A running summary for a company site over the dates asked for (all dates when none). A site is never completed. */
  getSiteSummary(siteId:string,fromDate?:string,toDate?:string):Promise<WasteSiteSummary>;
}
