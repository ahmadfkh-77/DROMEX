import type {AttentionSnapshot} from './workspace';

/**
 * Needs Attention (DEC-531). The Home card and the Needs Attention screen read the same counts, so they are worked out once here.
 * Operational, financial, sync and draft groups match the breakdown Home has always shown.
 */
export type AttentionGroups={operational:number;financial:number;sync:number;drafts:number;total:number};

export function attentionGroups(snapshot:AttentionSnapshot,otherDrafts:number):AttentionGroups{
  const operational=snapshot.missingReportsToday+snapshot.blockedSchedule+snapshot.openIssues+snapshot.incompleteWaste;
  const financial=snapshot.unpricedLoads+snapshot.outstandingRecords;
  const sync=snapshot.syncPending;
  const drafts=snapshot.loadDrafts+otherDrafts;
  return{operational,financial,sync,drafts,total:operational+financial+sync+drafts};
}

/** Chips shown on the Home card: only the groups that have something in them, worded the way the screen reads them. */
export function attentionChips(groups:AttentionGroups):Array<{key:'operational'|'financial'|'sync'|'drafts';label:string}>{
  const chips:Array<{key:'operational'|'financial'|'sync'|'drafts';label:string}>=[];
  if(groups.operational)chips.push({key:'operational',label:`${groups.operational} operational`});
  if(groups.financial)chips.push({key:'financial',label:`${groups.financial} financial`});
  if(groups.sync)chips.push({key:'sync',label:`${groups.sync} pending sync`});
  if(groups.drafts)chips.push({key:'drafts',label:`${groups.drafts} ${groups.drafts===1?'draft':'drafts'}`});
  return chips;
}

export function attentionSummary(groups:AttentionGroups):string{
  return attentionChips(groups).map(chip=>chip.label).join(' · ');
}

export type AttentionSection='fix'|'review'|'housekeeping';
export const attentionSections:ReadonlyArray<{key:AttentionSection;title:string}>=[
  {key:'fix',title:'FIX FIRST'},
  {key:'review',title:'REVIEW'},
  {key:'housekeeping',title:'HOUSEKEEPING'},
];

/** The row colour already carried the urgency (red, amber, navy); the screen now also groups by it. */
export function attentionSectionFor(tone:'danger'|'warning'|'navy'):AttentionSection{
  return tone==='danger'?'fix':tone==='warning'?'review':'housekeeping';
}
