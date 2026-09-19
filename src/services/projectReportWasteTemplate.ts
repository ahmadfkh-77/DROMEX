import {fuelTypeLabels} from '../domain/fuel';
import {consultantSignoffState,netWorkMinutes,type DailyProjectReport,type LinkedFoundationActivity,type LinkedFuelFill,type LinkedProjectLoad,type LinkedQuarryLoad,type LinkedWallWork,type LinkedWasteDump,type ProjectReportSetup,type ReportProject} from '../domain/projectReports';
import {buildLiftDiagram,liftDiagramLiftFrom,liftStatusText} from '../domain/constructionLiftDiagram';
import {liftHasManualOverride,reportStoneVolume,type ConstructionLiftReportGroup} from '../domain/constructionLiftReport';
import {concreteMatrixVariance,type LegacyCompositeStage} from '../domain/wallConstructionLift';
import {baseStatusLabels} from '../domain/wallBase';
import {buildWallDiagram} from '../domain/wallDiagram';
import {buildFoundationEnvelopeDiagram} from '../domain/foundationEnvelopeDiagram';
import {buildFoundationDiagram} from '../domain/wallFoundationDiagram';
import type {FoundationComposition} from '../domain/wallFoundation';
import {describeFoundationQuantity,hasLegacyMaterialRecord,type Foundation} from '../domain/foundations';
import {concretePurposeLabels,describeWallConsumptionQuantity,formatCubicMetres,supportsVolumeCalculation,wallConsumptionPurposeLabel,wallMaterialLabels,wallPurposeLabels,wallSystemLabels} from '../domain/walls';
const concretePurposeLabelOf=(purpose:keyof typeof concretePurposeLabels|null)=>purpose?concretePurposeLabels[purpose]:'';
const UNASSIGNED_SECTION='Unassigned';

/**
 * DEC-464/DEC-461. The composite-foundation figure and its numbers, shared by a wall's own block and
 * a standalone foundation-only block. Never shows Ready Mix as poured, or curing as confirmed, before
 * it is actually recorded (DEC-463).
 */
function foundationCompositionHtml(foundation:Foundation,stage:Foundation['status'],composition:FoundationComposition|null){
  if(!composition||composition.mode!=='single'&&composition.mode!=='composite')return'';
  if(composition.mode!=='composite')return'';
  const figure=buildFoundationDiagram({
    referenceLabel:foundation.reference,lengthM:foundation.lengthM,heightM:foundation.heightM,bottomThicknessM:foundation.bottomThicknessM,topThicknessM:foundation.topThicknessM,
    status:stage,netFoundationVolumeM3:composition.netFoundationVolumeM3,mode:composition.mode,stoneCoreMode:composition.stoneCoreMode,position:composition.position,offsets:composition.offsets,
    activeStoneM3:composition.activeStoneM3,activeReadyMixM3:composition.activeReadyMixM3,estimatedConcreteM3:composition.estimatedConcreteM3,variance:composition.variance,
  }).svg;
  const varianceText=composition.variance?`${composition.variance.direction==='none'?'Matches estimate':composition.variance.direction==='over'?'+':'-'}${e(formatCubicMetres(Math.abs(composition.variance.varianceM3)))}`:null;
  return `<div class="foundation-composition"><span class="sub">Composite foundation &middot; Stone ${composition.activeStoneM3>0?e(formatCubicMetres(composition.activeStoneM3)):'none recorded'} &middot; Estimated concrete ${e(formatCubicMetres(composition.estimatedConcreteM3))}${composition.activeReadyMixM3>0?` &middot; Actual Ready Mix ${e(formatCubicMetres(composition.activeReadyMixM3))}`:''}${varianceText?` &middot; Variance ${varianceText}`:''}</span><div class="wall-figure">${figure}</div></div>`;
}

const e=(value:unknown)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
const display=(value:string|null|undefined)=>value?.trim()?e(value):'&mdash;';
const list=(values:string[])=>values.length?values.map(e).join('; '):'&mdash;';
const fmt=(value:number)=>Number.isInteger(value)?String(value):value.toFixed(3).replace(/0+$/,'').replace(/\.$/,'');

/**
 * DEC-467. One parent's Lifts, in construction order, each with its own deterministic
 * Phase 4 figure beside its own numbers. Every quantity and status arrives already projected to this
 * report's work date, so nothing here filters or recalculates: a lift prints "Concrete fill pending"
 * because that is the status the projection derived, not because this template decided it.
 * `dir="auto"` lets an Arabic or mixed reference lay itself out without the template guessing.
 */
function liftGroupHtml(group:ConstructionLiftReportGroup|null,heading:string){
  if(!group)return '';
  const totals=group.reconciliation;
  const summary=[`Allocated ${e(formatCubicMetres(totals.totalAllocatedLiftVolumeM3))} of ${e(formatCubicMetres(group.parentNetVolumeM3))}`,
    `Remaining ${e(formatCubicMetres(totals.remainingUnallocatedVolumeM3))}`,
    `Stone ${e(formatCubicMetres(totals.totalActualStoneM3||totals.totalCalculatedStoneM3))}`,
    `Concrete ${e(formatCubicMetres(totals.totalActualReadyMixM3||totals.totalEstimatedConcreteM3))}`].join(' &middot; ');
  const warning=totals.overAllocated
    ?`<p class="lift-warning">Over-allocated by ${e(formatCubicMetres(totals.overAllocationM3))} &mdash; the lifts exceed this ${group.parentType==='wall'?'wall':'foundation'}'s structural envelope.</p>`:'';
  const rows=group.lifts.map(lift=>{
    const figure=buildLiftDiagram(liftDiagramLiftFrom(lift)).svg;
    const concrete=lift.concretePhase;
    const variance=concrete&&concrete.actualReadyMixQuantityM3!=null
      ?concreteMatrixVariance(concrete.estimatedMatrixVolumeM3,concrete.actualReadyMixQuantityM3):null;
    const lastCorrection=lift.correctionHistory.at(-1);
    const details=[
      `<span class="sub">Structural ${e(formatCubicMetres(lift.netLiftVolumeM3))}</span>`,
      `<span class="sub">Stone ${lift.status==='planned'?'none recorded yet':`estimated ${e(formatCubicMetres(lift.stonePhase.calculatedStoneVolumeM3))}, actual ${lift.stonePhase.actualStoneQuantityM3==null?'not recorded':e(formatCubicMetres(reportStoneVolume(lift)))}`}</span>`,
      `<span class="sub">Concrete matrix ${concrete?`estimated ${e(formatCubicMetres(concrete.estimatedMatrixVolumeM3))}${concrete.actualReadyMixQuantityM3==null?'':`, Ready Mix ${e(formatCubicMetres(concrete.actualReadyMixQuantityM3))}`}`:'not started'}</span>`,
      variance?`<span class="sub">Variance ${variance.direction==='none'?'matches estimate':`${variance.direction==='over'?'+':'&minus;'}${e(formatCubicMetres(Math.abs(variance.varianceM3)))}`}</span>`:'',
      liftHasManualOverride(lift)?'<span class="lift-override">Manual override</span>':'',
      lastCorrection?`<span class="corrected">Corrected: ${e(lastCorrection.reason)}</span>`:'',
    ].filter(Boolean).join('');
    const dates=[lift.stonePhase.workDate?`Stone ${e(lift.stonePhase.workDate)}`:'',concrete?.workDate?`Concrete ${e(concrete.workDate)}`:''].filter(Boolean).join(' &middot; ');
    return `<div class="lift-row"><div class="lift-main"><p class="lift-title"><span class="lift-seq">${e(lift.sequence)}</span><b dir="auto">${e(lift.reference)}</b><span class="lift-status">${e(liftStatusText[lift.status])}</span></p>${dates?`<span class="sub">${dates}</span>`:''}${details}</div><div class="lift-figure">${figure}</div></div>`;
  }).join('')||'<p class="empty">No Lifts recorded on or before this date</p>';
  return `<div class="lift-group"><h4 class="lift-head">${e(heading)}</h4><p class="lift-summary">${summary}</p>${warning}${rows}</div>`;
}

/**
 * DEC-474. What this foundation's own material position actually is.
 *
 * Two independent records can exist and they are never merged or added together. A genuine top-level
 * record made before ordered Lifts existed is a "Legacy foundation material record". The Stone and
 * concrete actually built are recorded through Lifts, and are reported with the number of Lifts they
 * came from so the reader can tie the figures back to the Lift block printed below. When both exist
 * they print as two clearly separated lines, so no quantity is ever double-counted into one total.
 */
function foundationMaterialLineHtml(foundation:Foundation,lifts:ConstructionLiftReportGroup|null){
  const parts:string[]=[];
  if(hasLegacyMaterialRecord(foundation))
    parts.push(`<span class="sub legacy-material">Legacy foundation material record: ${e(describeFoundationQuantity(foundation))}${foundation.manualOverride?' (manual override)':''} &middot; ${e(wallMaterialLabels[foundation.materialType!])}${foundation.customPurposeLabel??foundation.concretePurpose?` &middot; ${e(foundation.customPurposeLabel??concretePurposeLabelOf(foundation.concretePurpose))}`:''}</span>`);
  const totals=lifts?.reconciliation;
  const stone=totals?totals.totalActualStoneM3||totals.totalCalculatedStoneM3:0;
  const concrete=totals?totals.totalActualReadyMixM3||totals.totalEstimatedConcreteM3:0;
  const liftCount=lifts?.lifts.length??0;
  parts.push(liftCount>0&&(stone>0||concrete>0)
    ?`<span class="sub">Materials recorded through ${liftCount} ${liftCount===1?'Lift':'Lifts'}: Stone ${e(formatCubicMetres(stone))} &middot; Concrete ${e(formatCubicMetres(concrete))}</span>`
    :'<span class="sub">No Lift materials recorded yet.</span>');
  return parts.join('');
}

/** DEC-466/467. A foundation recorded before ordered lifts existed, shown as exactly that and never re-drawn as invented lifts. */
function legacyStageHtml(stage:LegacyCompositeStage|null){
  if(!stage)return '';
  return `<div class="legacy-stage"><b>${e(stage.label)}</b><span class="sub">Stone ${e(formatCubicMetres(stage.activeStoneM3))} &middot; estimated concrete ${e(formatCubicMetres(stage.estimatedConcreteM3))}${stage.activeReadyMixM3>0?` &middot; actual Ready Mix ${e(formatCubicMetres(stage.activeReadyMixM3))}`:''}</span><span class="sub">Recorded before ordered Lifts. Shown for history only.</span></div>`;
}

/**
 * DEC-453/DEC-455. One block per wall: the wall's identity and geometry, then one row per consumption
 * with the consumed quantity and, beside it, how that volume was calculated from wall dimensions. An
 * uncalculated quantity reads "Entered directly"; rebar and site mix read "Not applicable". Nothing
 * missing is printed as zero.
 */
export function wallConstructionSectionHtml(walls:LinkedWallWork[],foundationActivity:LinkedFoundationActivity[]=[]){
  const head='<thead><tr><th>Material and purpose</th><th>Consumed quantity</th><th>Volume calculation</th><th>Notes</th></tr></thead>';
  const metres=(value:number)=>String(Number(value.toFixed(2)));
  if(!walls.length&&!foundationActivity.length)return `<section class="wall-section"><h2>Wall construction that day</h2><table class="wall-table">${head}<tbody><tr><td colspan="4" class="empty">No wall construction recorded for this date</td></tr></tbody></table></section>`;
  const records=walls.reduce((sum,wall)=>sum+wall.entries.length,0);
  const wallBlock=(wall:LinkedWallWork)=>{
    const rows=wall.entries.map(entry=>{
      const purpose=wallConsumptionPurposeLabel(entry),last=entry.correctionHistory.at(-1);
      const volume=entry.volume,calculation=!supportsVolumeCalculation(entry.type)
        ?'<span class="sub">Not applicable</span>'
        :volume
          ?`<b>${e(formatCubicMetres(volume.netVolumeM3))} net</b><span class="sub">${volume.deductionM3>0?`${e(formatCubicMetres(volume.grossVolumeM3))} gross, ${e(formatCubicMetres(volume.deductionM3))} deductions`:`${e(formatCubicMetres(volume.grossVolumeM3))} gross, no deductions`}</span><span class="sub">${fmt(volume.lengthM)} m × ${fmt(volume.heightM)} m × ${volume.bottomThicknessM===volume.topThicknessM?`${fmt(volume.bottomThicknessM)} m`:`${fmt(volume.bottomThicknessM)} to ${fmt(volume.topThicknessM)} m`} thick</span>`
          :'<span class="missing">Entered directly</span>';
      const notes=[entry.notes.trim()?`<span>${e(entry.notes)}</span>`:'',last?`<span class="corrected">Corrected: ${e(last.reason)}</span>`:''].filter(Boolean).join('');
      return `<tr><td><b>${e(wallMaterialLabels[entry.type])}</b>${purpose?`<span class="sub">${e(purpose)}</span>`:''}</td><td><b>${e(describeWallConsumptionQuantity(entry))}</b></td><td>${calculation}</td><td>${notes}</td></tr>`;
    }).join('')||'<tr><td colspan="4" class="empty">No wall material recorded on this date</td></tr>';
    const thickness=wall.bottomThicknessM===wall.topThicknessM?`${fmt(wall.bottomThicknessM)} m thick`:`${fmt(wall.bottomThicknessM)} m to ${fmt(wall.topThicknessM)} m thick`;
    const geometry=`${fmt(wall.lengthM)} m long × ${fmt(wall.heightM)} m high &middot; ${thickness} &middot; ${metres(wall.plannedVolumeM3)} m³ planned`;
    // DEC-457. The figure is generated here from the same geometry the table prints; it is inline SVG,
    // so the PDF carries no raster image and fetches nothing.
    const foundation=wall.foundation,stage=wall.foundationStatusAsOf;
    const figure=buildWallDiagram({wall:{name:wall.wallName,lengthM:wall.lengthM,heightM:wall.heightM,bottomThicknessM:wall.bottomThicknessM,topThicknessM:wall.topThicknessM},layers:wall.layers??[],
      base:foundation&&stage?{geometry:{lengthM:foundation.lengthM,heightM:foundation.heightM,bottomThicknessM:foundation.bottomThicknessM,topThicknessM:foundation.topThicknessM},status:stage,label:foundation.reference}:null}).svg;
    // DEC-459/460, refined by DEC-463/464. The foundation block states the stage reached by this work
    // date, never a later one, and — since curing no longer blocks wall work — a concise, honest note
    // when wall material was recorded that day while curing was not yet confirmed. It never claims the
    // foundation was cured, and never hides the wall material that was actually recorded.
    const curingNote=stage&&stage!=='cured'&&wall.entries.length?'<span class="curing-note">Base curing not confirmed on this work date</span>':'';
    const foundationBlock=foundation&&stage?`<div class="wall-base"><b>${e(foundation.reference)}</b> &middot; ${e(baseStatusLabels[stage])}${foundation.location.trim()?` &middot; ${e(foundation.location)}`:''}<span class="sub">${fmt(foundation.lengthM)} m × ${fmt(foundation.heightM)} m × ${fmt(foundation.bottomThicknessM)}${foundation.bottomThicknessM===foundation.topThicknessM?'':` to ${fmt(foundation.topThicknessM)}`} m &middot; gross ${e(formatCubicMetres(foundation.grossVolumeM3))}, deduction ${e(formatCubicMetres(foundation.deductionM3))}, net ${e(formatCubicMetres(foundation.netVolumeM3))}</span>${foundationMaterialLineHtml(foundation,wall.foundationLifts)}${foundation.constructedOn?`<span class="sub">Constructed ${e(foundation.constructedOn)}${foundation.curingStartedOn?` &middot; curing from ${e(foundation.curingStartedOn)}`:''}${foundation.curedOn?` &middot; cured ${e(foundation.curedOn)}`:''}</span>`:''}${wall.foundationEvents.length?`<span class="base-events">${wall.foundationEvents.map(e).join(' &middot; ')}</span>`:''}${curingNote}${foundationCompositionHtml(foundation,stage,wall.foundationComposition)}${foundation.notes.trim()?`<span class="sub">${e(foundation.notes)}</span>`:''}</div>`:'';
    // DEC-467. Foundation first with its own lifts, then the wall and its lifts, so the hierarchy
    // reads Construction Section -> Foundation -> its lifts -> linked Wall -> its lifts.
    return `<div class="wall-block"><div class="wall-head"><div class="wall-title"><h3>${e(wall.wallName)}</h3><p>${e(wallSystemLabels[wall.system])} &middot; ${e(wallPurposeLabels[wall.purpose])}</p></div><p class="wall-geometry">${geometry}</p></div>${foundationBlock}${legacyStageHtml(wall.foundationLegacyStage)}${liftGroupHtml(wall.foundationLifts,'Foundation Lifts')}<div class="wall-figure">${figure}</div>${liftGroupHtml(wall.wallLifts,'Wall Lifts')}<table class="wall-table">${head}<tbody>${rows}</tbody></table></div>`;
  };
  const foundationOnlyBlock=(activity:LinkedFoundationActivity)=>{
    const foundation=activity.foundation,stage=activity.foundationStatusAsOf;
    // DEC-474. The Foundation structural envelope, not the wall diagram. Calling buildWallDiagram with
    // an empty layer list used to print "No layers recorded" here, which applied wall-layer vocabulary
    // to a foundation and read as though its materials were missing. The envelope figure states the
    // geometry only; the Lift diagrams below state the Stone and concrete actually placed.
    const figure=buildFoundationEnvelopeDiagram({referenceLabel:foundation.reference,geometry:{lengthM:foundation.lengthM,heightM:foundation.heightM,bottomThicknessM:foundation.bottomThicknessM,topThicknessM:foundation.topThicknessM},status:stage,grossVolumeM3:foundation.grossVolumeM3,deductionM3:foundation.deductionM3,netVolumeM3:foundation.netVolumeM3}).svg;
    // DEC-470/474. A foundation with no wall states its material position too, so the reader is never
    // left guessing whether it was simply omitted.
    const material=foundationMaterialLineHtml(foundation,activity.lifts);
    return `<div class="wall-block foundation-only"><div class="wall-head"><div class="wall-title"><h3>${e(foundation.reference)}</h3><p>Foundation &middot; ${e(baseStatusLabels[stage])} &middot; no wall linked yet</p></div></div><span class="sub">${fmt(foundation.lengthM)} m × ${fmt(foundation.heightM)} m × ${fmt(foundation.bottomThicknessM)}${foundation.bottomThicknessM===foundation.topThicknessM?'':` to ${fmt(foundation.topThicknessM)}`} m &middot; structural envelope ${e(formatCubicMetres(foundation.netVolumeM3))}</span>${material}<div class="wall-figure">${figure}</div>${foundationCompositionHtml(foundation,stage,activity.composition)}${legacyStageHtml(activity.legacyStage)}${liftGroupHtml(activity.lifts,'Foundation Lifts')}${activity.foundationEvents.length?`<span class="base-events">${activity.foundationEvents.map(e).join(' &middot; ')}</span>`:''}</div>`;
  };
  // DEC-464. Grouped by Construction Section, then by foundation/wall inside it, so a report with more
  // than one site segment reads as separate work areas rather than one flat list.
  const sections=new Map<string,{walls:LinkedWallWork[];foundations:LinkedFoundationActivity[]}>();
  for(const wall of walls){const key=wall.constructionSectionName??UNASSIGNED_SECTION;const group=sections.get(key)??{walls:[],foundations:[]};group.walls.push(wall);sections.set(key,group);}
  for(const activity of foundationActivity){const key=activity.constructionSectionName||UNASSIGNED_SECTION;const group=sections.get(key)??{walls:[],foundations:[]};group.foundations.push(activity);sections.set(key,group);}
  const sectionBlocks=[...sections.entries()].sort(([first],[second])=>first.localeCompare(second)).map(([name,group])=>
    `<div class="construction-section"><h3 class="construction-section-title">${name===UNASSIGNED_SECTION?'No Construction Section':e(name)}</h3>${group.walls.map(wallBlock).join('')}${group.foundations.map(foundationOnlyBlock).join('')}</div>`
  ).join('');
  return `<section class="wall-section"><h2>Wall construction that day</h2><p class="wall-summary">${walls.length} wall${walls.length===1?'':'s'} &middot; ${records} material record${records===1?'':'s'}${foundationActivity.length?` &middot; ${foundationActivity.length} foundation${foundationActivity.length===1?'':'s'} not yet linked to a wall`:''}. Calculated volumes use the wall's length, height, and thickness less deductions.</p>${sectionBlocks}</section>`;
}

export function buildProjectReportHtmlWithWaste(report:DailyProjectReport,project:ReportProject,loads:LinkedProjectLoad[],quarry:LinkedQuarryLoad[],waste:LinkedWasteDump[],fuel:LinkedFuelFill[],company:ProjectReportSetup['company'],logo:string|null,photos:(string|null)[],includePrices?:boolean,ministryLogo?:string|null,wallWork?:LinkedWallWork[],foundationActivity?:LinkedFoundationActivity[]):string;
export function buildProjectReportHtmlWithWaste(report:DailyProjectReport,project:ReportProject,loads:LinkedProjectLoad[],waste:LinkedWasteDump[],company:ProjectReportSetup['company'],logo:string|null,photos:(string|null)[]):string;
export function buildProjectReportHtmlWithWaste(report:DailyProjectReport,project:ReportProject,loads:LinkedProjectLoad[],quarryOrWaste:LinkedQuarryLoad[]|LinkedWasteDump[],wasteOrCompany:LinkedWasteDump[]|ProjectReportSetup['company'],fuelOrLogo:LinkedFuelFill[]|string|null,companyOrPhotos:ProjectReportSetup['company']|(string|null)[],logo?:string|null,photosArg?:(string|null)[],includePricesArg=false,ministryLogoArg?:string|null,wallWorkArg:LinkedWallWork[]=[],foundationActivityArg:LinkedFoundationActivity[]=[]){
  const current=Array.isArray(wasteOrCompany);const quarry=current?quarryOrWaste as LinkedQuarryLoad[]:[];const waste=current?wasteOrCompany as LinkedWasteDump[]:quarryOrWaste as LinkedWasteDump[];const fuel=current?fuelOrLogo as LinkedFuelFill[]:[];const company=(current?companyOrPhotos:wasteOrCompany) as ProjectReportSetup['company'];const resolvedLogo=current?logo:fuelOrLogo as string|null;const photos=(current?photosArg:companyOrPhotos) as (string|null)[];
  const includePrices=current&&includePricesArg;
  const minutes=netWorkMinutes(report);
  const updatedDate=new Date(report.updatedAt);const updatedLabel=Number.isNaN(updatedDate.getTime())?'Not available':updatedDate.toLocaleString();
  const timeValue=minutes==null?'Not recorded':`${Math.floor(minutes/60)}h ${minutes%60}m`;
  const timeNote=report.workStartTime&&report.workEndTime?`${e(report.workStartTime)} to ${e(report.workEndTime)}${report.breakMinutes?` &middot; ${e(report.breakMinutes)} min break`:''}`:'No working time entered';
  const wasteGroups=[...waste.reduce((map,dump)=>{const key=`${dump.dumpLocation}\u0000${dump.materialType}`;const prior=map.get(key);map.set(key,{location:dump.dumpLocation,material:dump.materialType,count:(prior?.count??0)+1});return map;},new Map<string,{location:string;material:string;count:number}>()).values()];
  const materialRows=report.materials.map(material=>`<tr><td>${e(material.movement==='used'?'Used':'Transported')}</td><td>${e(material.itemName)}</td><td class="number">${fmt(material.quantity)}</td><td>${e(material.unitSymbol)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty">No materials recorded</td></tr>';
  const loadRows=loads.map(load=>`<tr><td>${e(load.transactionNumber)}</td><td>${e(load.itemName)}</td><td>${fmt(load.quantity)} ${e(load.unitSymbol)}</td><td>${e(load.driverName)}</td><td>${e(load.truckPlate)}</td>${includePrices?`<td class="number">${load.finalTotalUsd==null?'Unpriced':`$${load.finalTotalUsd.toFixed(2)}`}</td>`:''}</tr>`).join('')||`<tr><td colspan="${includePrices?6:5}" class="empty">No project-linked loads for this date</td></tr>`;
  const quarryRows=quarry.map(load=>`<tr><td>${e(load.purchaseNumber)}</td><td>${e(load.supplierName)}</td><td>${e(load.itemName)}</td><td>${fmt(load.quantity)} ${e(load.unitSymbol)}</td><td>${e(load.deliveryLabel)}</td><td>${display(load.truckPlate)}</td><td>${display(load.supplierTicketNumber)}</td>${includePrices?`<td class="number">${load.finalTotalUsd==null?'Unpriced':`$${load.finalTotalUsd.toFixed(2)}`}</td>`:''}</tr>`).join('')||`<tr><td colspan="${includePrices?8:7}" class="empty">No project-linked supplier loads for this date</td></tr>`;
  const fuelRows=fuel.map(fill=>`<tr><td>${new Date(fill.confirmedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td><td>${e(fill.equipmentName)}</td><td>${e(fuelTypeLabels[fill.fuelType])}</td><td class="number">${fmt(fill.litres)} L</td>${includePrices?`<td class="number">${fill.pricePerLitreUsd==null?'Unpriced':`$${fill.pricePerLitreUsd.toFixed(2)}/L`}</td><td class="number">${fill.consumptionCostUsd==null?'&mdash;':`$${fill.consumptionCostUsd.toFixed(2)}`}</td>`:''}<td>${display(fill.odometerReading)}</td></tr>`).join('')||`<tr><td colspan="${includePrices?7:5}" class="empty">No project-linked fuel fills for this date</td></tr>`;
  const fuelLitres=fuel.reduce((sum,fill)=>sum+fill.litres,0),fuelCost=fuel.reduce((sum,fill)=>sum+(fill.consumptionCostUsd??0),0),unpricedFuel=fuel.filter(fill=>fill.consumptionCostUsd==null).reduce((sum,fill)=>sum+fill.litres,0);
  const wasteRows=wasteGroups.map(group=>`<tr><td>${e(group.material)}</td><td>${e(group.location)}</td><td class="number">${group.count}</td></tr>`).join('')||'<tr><td colspan="3" class="empty">No completed waste dumps for this date</td></tr>';
  const safetyRows=[...report.workers.map(name=>({name,type:'Worker',key:'worker'})),...report.drivers.map(name=>({name,type:'Truck Driver',key:'driver'}))].map(person=>{const safety=(report.workerSafety??[]).find(value=>value.workerName===person.name&&(value.participantType??'worker')===person.key);const status=safety?.status==='compliant'?'Compliant':safety?.status==='missing'?'Missing PPE':'Not checked';const statusColor=safety?.status==='compliant'?'#287A55':safety?.status==='missing'?'#9A6512':'#65717D';const details=safety?.status==='missing'?(safety.missingItems.join(', ')||'Missing item not specified'):'—';return`<tr><td>${e(person.name)}</td><td>${e(person.type)}</td><td><span style="color:${statusColor};font-weight:700">${e(status)}</span></td><td>${e(details)}</td><td>${display(safety?.notes)}</td></tr>`;}).join('')||'<tr><td colspan="5" class="empty">No workers or truck drivers recorded</td></tr>';
  const photoHtml=photos.filter((photo):photo is string=>!!photo).map((src,index)=>`<figure><img src="${src}"/><figcaption>Photo ${index+1} &middot; ${e(report.workDate)}</figcaption></figure>`).join('')||'<div class="empty-photo">No photos attached to this daily report</div>';
  const modeBadge='';
  // DEC-398 to DEC-401. Three independent optional headers. Each reads its own per-report switch and
  // its own global values; none gates another, and in particular the consulting agency no longer
  // depends on Consultant Sign-off (DEC-399, superseding the coupling in DEC-391).
  const value=(raw:string|null|undefined,on:boolean)=>on?(raw??'').trim():'';
  const ministryLogo=report.showMinistryHeader?(ministryLogoArg??null):null;
  const ministryEn=value(company.ministryName,report.showMinistryHeader);
  const ministryAr=value(company.ministryNameAr,report.showMinistryHeader);
  // DEC-417, superseding DEC-403/DEC-391 for agency values only: the report's own captured
  // snapshot renders, never the current (possibly since-renamed) global or saved agency value. When
  // the header is on but no agency was ever selected, both names are empty and biLine() below
  // already omits the row cleanly with no blank spacing -- the same mechanism ministry and custom
  // header already rely on.
  const agencyEn=value(report.consultingAgencyNameEn,report.showConsultingAgency);
  const agencyAr=value(report.consultingAgencyNameAr,report.showConsultingAgency);
  const customEn=value(company.customHeaderEn,report.showCustomHeader);
  const customAr=value(company.customHeaderAr,report.showCustomHeader);
  // DEC-400. English left and LTR, Arabic right and RTL, facing each other. A header with only one
  // configured language takes the full width instead of leaving an empty facing column.
  const biLine=(en:string,ar:string,kind:string)=>{
    if(!en&&!ar)return '';
    if(en&&ar)return `<div class="bi-line ${kind}"><div class="bi-en" dir="ltr" lang="en">${e(en)}</div><div class="bi-ar" dir="rtl" lang="ar">${e(ar)}</div></div>`;
    return en
      ?`<div class="bi-line ${kind}"><div class="bi-en bi-solo" dir="ltr" lang="en">${e(en)}</div></div>`
      :`<div class="bi-line ${kind}"><div class="bi-ar bi-solo" dir="rtl" lang="ar">${e(ar)}</div></div>`;
  };
  const institutionalLines=`${biLine(ministryEn,ministryAr,'inst-ministry')}${biLine(agencyEn,agencyAr,'inst-agency')}${biLine(customEn,customAr,'inst-custom')}`;
  const institutional=institutionalLines?`<div class="institutional">${institutionalLines}</div>`:'';
  // The ministry logo belongs to the ministry option alone; the company logo is never part of an
  // optional header and never disappears with one.
  const ministryLogoHtml=ministryLogo?`<div class="ministry-slot"><img class="ministry-logo" src="${ministryLogo}" alt=""/></div>`:'';
  const companyMark=resolvedLogo?`<img class="company-logo" src="${resolvedLogo}"/>`:`<div class="brand-name">${e(company.name)}</div>`;
  // The Contractor cell is roughly 94mm wide. At 10.5pt an Arial name runs about 2mm per character,
  // so ~30 characters is where it stops fitting on one line; past ~60 even the compact size cannot,
  // and wrapping is preferred to overlapping the column beside it.
  const contractorLength=(company.name??'').length;
  const contractorClass=contractorLength>60?'value value-compact':contractorLength>30?'value value-compact value-nowrap':'value value-nowrap';
  const signoffState=consultantSignoffState(report);
  const consultantSection=signoffState==='disabled'?'':signoffState==='complete'
    ?`<section class="section consultant-section"><h2>Consultant Sign-off</h2><div class="consultant-complete"><div class="consultant-signature-box"><svg viewBox="0 0 320 140">${report.consultantSignaturePaths.map(p=>`<path d="${e(p)}" fill="none" stroke="#17212b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg></div><div class="consultant-name-line">${e(report.consultantName)}</div></div></section>`
    :`<section class="section consultant-section"><h2>Consultant Sign-off</h2><p class="consultant-incomplete">${report.consultantName.trim()?`Name on file: ${e(report.consultantName)}. `:''}Consultant sign-off incomplete.${report.consultantSignaturePaths.length?'':' Signature not supplied.'}${report.consultantName.trim()?'':' Consultant name not supplied.'}</p></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    /* Latin resolves from Arial; Arabic glyphs fall through per-glyph to the platform Arabic face
       (DEC-400), so mixed lines shape correctly without bundling a font. */
    @page{size:A4;margin:13mm 13mm 15mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,'Noto Naskh Arabic','Geeza Pro',sans-serif;color:#17212b;font-size:9pt;line-height:1.4}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #c84b31;padding-bottom:4mm;margin-bottom:5mm}
    .brand img{max-width:36mm;max-height:18mm}.company-line{font-size:7.5pt;color:#65717d;margin:0 0 5mm;text-align:center}
    .report-title{text-align:right}.report-title h1{font-size:14pt;line-height:1.05;margin:0;color:#173f67;letter-spacing:1.2pt;font-weight:900}.report-title p{font-size:7.5pt;margin:1.5mm 0 1mm;color:#65717d}
    .mode-badge{display:inline-block;border:1px solid #173f67;color:#173f67;font-size:7.5pt;font-weight:700;padding:1mm 2.8mm;border-radius:3mm;letter-spacing:.4pt}.mode-badge-prices{border-color:#c84b31;color:#8e2e1b}
    /* A contained two-column grid: both columns are inset from the page edges, the second column is
       wider so a real contractor name fits, and both columns stay left-aligned so Contractor and
       Work date share one left edge. The gap is tightened from 8mm; 5mm still separates the columns
       for scanning without stranding the second one near the right margin. */
    /* fr, not %: 45% + 55% + a 5mm gap overflows the row, which pushed the second column past the
       right edge. minmax(0,..fr) divides what is actually left after the gap, and the min of 0 lets
       a cell shrink instead of being forced wider by its own content. */
    .project-line{display:grid;grid-template-columns:minmax(0,45fr) minmax(0,55fr);column-gap:5mm;row-gap:3mm;margin-bottom:5mm;padding:0 4mm 4mm;border-bottom:1px solid #e3d6c2;box-sizing:border-box}
    .project-line>div{min-width:0;box-sizing:border-box}
    /* Contractor and Work date: right-hand column, but their own text stays left-aligned on one
       shared left edge. Stated explicitly so no future rule can right-align them by inheritance. */
    .project-line>div:nth-child(2),.project-line>div:nth-child(4){text-align:left;justify-self:stretch}
    /* Contractor stays on one line. Past a tested length it steps down one size rather than being
       clipped; past the point where even that cannot fit, wrapping is allowed so it can never
       overlap the neighbouring column. Nothing is ever truncated or hidden. */
    .value-compact{font-size:8.5pt;line-height:1.25}
    .value-nowrap{white-space:nowrap}
    .label{display:block;color:#65717d;font-size:7.5pt;font-weight:700;letter-spacing:.5pt;margin-bottom:.8mm;text-transform:uppercase}.value{font-size:10.5pt;font-weight:700;color:#17212b}
    .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:2.5mm;margin:4mm 0}
    .card{min-height:24mm;padding:3mm;background:#fff8ed;border:1px solid #e3d6c2;border-left:3px solid #173f67}
    .card strong{display:block;font-size:16pt;font-weight:900;line-height:1;color:#17212b}.card b{display:block;font-size:7.5pt;font-weight:700;letter-spacing:.3pt;margin-top:2mm;color:#173f67}.card small{display:block;color:#65717d;font-size:7pt;margin-top:2mm}
    h2{font-size:12.5pt;font-weight:700;color:#17212b;margin:5mm 0 2mm;padding-bottom:1mm;border-bottom:2px solid #c84b31}
    .panel{padding:3.5mm 4mm;background:#fff8ed;border:1px solid #e3d6c2;border-left:3px solid #173f67;break-inside:avoid}
    .panel-attention{background:#fce8e6;border-color:#e3b7b0;border-left-color:#b3261e}
    .panel h3{margin:0 0 2mm;font-size:10pt;font-weight:700;color:#17212b}.panel p{margin:0;white-space:pre-wrap;font-size:9pt}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:2.5mm}.section{break-inside:avoid}
    table{width:100%;border-collapse:collapse;font-size:8pt}thead{display:table-header-group}
    th{background:#e7eef5;color:#173f67;text-align:left;font-size:7.5pt;font-weight:700;letter-spacing:.2pt}
    th,td{border:1px solid #d9d5ce;padding:2.2mm 2mm;vertical-align:top}
    .table-accent-company th:first-child,.table-accent-supplier th:first-child{border-left-width:3px}
    .table-accent-company th{border-top:2px solid #c84b31}.table-accent-supplier th{border-top:2px solid #173f67}
    .number{text-align:right}.empty{text-align:center;color:#65717d;padding:5mm}
    .page-two{page-break-before:always}.notes-grid{display:grid;grid-template-columns:1fr 1fr;gap:2.5mm}
    .photos{display:grid;grid-template-columns:1fr 1fr;gap:4mm}.photos figure{margin:0;break-inside:avoid}.photos img{width:100%;height:73mm;object-fit:contain;background:#f5f2ec;border-radius:2mm;border:1px solid #e3d6c2}.photos figcaption{font-size:7.5pt;color:#65717d;margin-top:1mm}
    .empty-photo{grid-column:1/-1;background:#f5f2ec;color:#65717d;padding:16mm;text-align:center;border:1px dashed #d9d5ce}
    .footer-note{margin-top:5mm;border-top:1px solid #d9d5ce;padding-top:2mm;color:#65717d;font-size:7pt}
    /* DEC-453 Wall Construction. The heading stays with its table, a short block never splits, and a
       long one breaks only between rows with the column headings repeated. Weight, rules, and italics
       carry the hierarchy so the section still reads in grayscale. */
    .wall-summary{margin:0 0 2.5mm;color:#65717d;font-size:8pt}
    .wall-block{break-inside:avoid;page-break-inside:avoid;margin:0 0 4mm}
    .wall-head{break-after:avoid;page-break-after:avoid;display:flex;justify-content:space-between;align-items:flex-end;gap:5mm;padding:2.5mm 3mm;background:#fff8ed;border:1px solid #e3d6c2;border-bottom:2px solid #173f67}
    .wall-title{min-width:0}.wall-title h3{margin:0;font-size:10.5pt;font-weight:700;color:#17212b}.wall-title p{margin:.6mm 0 0;font-size:7.5pt;color:#65717d}
    .wall-geometry{margin:0;font-size:7.5pt;color:#17212b;text-align:right;max-width:52%}
    .wall-table{table-layout:fixed}.wall-table th:nth-child(1){width:27%}.wall-table th:nth-child(2){width:25%}.wall-table th:nth-child(3){width:26%}
    .wall-table tr{break-inside:avoid;page-break-inside:avoid}
    .wall-table .sub{display:block;margin-top:.6mm;font-size:7pt;color:#65717d;font-weight:400}
    .wall-table .missing{color:#65717d;font-style:italic}
    .wall-table .corrected{display:block;margin-top:.8mm;font-size:7pt;font-weight:700;color:#173f67}
    /* The generated figure is never split; if it does not fit, its whole wall block moves on. */
    .wall-base{break-inside:avoid;margin:2mm 0;padding:2.5mm 3mm;background:#f5f2ec;border-left:3px solid #65717d;font-size:8.5pt}
    .wall-base .sub{display:block;margin-top:.6mm;font-size:7.5pt;color:#65717d}
    .wall-base .base-events{display:block;margin-top:1mm;font-size:7.5pt;font-weight:700;color:#173f67}
    .wall-base .curing-note{display:block;margin-top:1mm;font-size:7.5pt;font-weight:700;color:#9a6512}
    .construction-section{margin-top:3mm}
    .construction-section-title{font-size:10pt;font-weight:800;color:#173f67;border-bottom:.4pt solid #c9c2b4;padding-bottom:1mm;margin:0 0 2mm}
    /* DEC-467. Lifts read as a list of records, not a dense grid: each lift keeps its own
       figure beside its numbers and never splits across a page, and a group heading never strands
       itself at the foot of one. Status and override are carried by text and a border, never colour. */
    .lift-group{margin:2mm 0 0;padding-left:2.5mm;border-left:1.5pt solid #173f67;break-inside:auto}
    .lift-head{break-after:avoid;page-break-after:avoid;margin:0 0 1mm;font-size:8.6pt;letter-spacing:.3pt;text-transform:uppercase;color:#173f67}
    .lift-summary{margin:0 0 1.5mm;font-size:8pt;color:#4a4a4a}
    .lift-warning{margin:0 0 1.5mm;padding:1mm 2mm;font-size:8pt;font-weight:700;color:#8e2e1b;border:1pt solid #8e2e1b}
    /* DEC-472. Each detail is its own line. These spans sit outside .wall-base and .wall-table, whose
       rules previously supplied display:block, so without this every line printed as one run-on
       paragraph — which is exactly how it came out on the device. */
    .lift-main .sub,.foundation-only .sub{display:block;margin-top:.6mm}
    /* DEC-472. The figure sits under its own numbers rather than in a 46mm side column: at that width
       a 360-unit drawing rendered its labels at roughly 4pt, which is unreadable in a printed record.
       Still inside .lift-row, so a lift and its drawing never separate across a page. */
    .lift-row{break-inside:avoid;page-break-inside:avoid;padding:1.5mm 0;border-bottom:.5pt dotted #d8d2c6}
    .lift-row:last-child{border-bottom:0}
    .lift-main{min-width:0}
    .lift-title{margin:0 0 .8mm;display:flex;gap:2mm;align-items:baseline;flex-wrap:wrap}
    .lift-title b{overflow-wrap:anywhere}
    .lift-seq{display:inline-block;min-width:5mm;padding:0 1mm;font-size:8pt;font-weight:700;text-align:center;border:1pt solid #17212b}
    .lift-status{font-size:8pt;font-weight:700;color:#04545d}
    .lift-override{display:block;font-size:8pt;font-weight:700;color:#8e2e1b}
    .lift-figure{width:118mm;max-width:100%;margin:1.5mm 0 0}
    .lift-figure svg{width:100%;height:auto}
    .legacy-stage{margin:1.5mm 0;padding:1.5mm 2mm;border:1pt dashed #9a927f;font-size:8pt}
    .legacy-stage .sub{display:block;color:#5c5c5c}
    .foundation-composition{margin-top:1.5mm}
    .foundation-composition .wall-figure{margin-top:1mm}
    .wall-block.foundation-only{border-left:2pt dashed #c9c2b4}
    .wall-figure{break-inside:avoid;page-break-inside:avoid;margin:2mm 0 2.5mm}
    .wall-figure svg{max-width:100%;height:auto;display:block}
    .source-label{display:flex;align-items:center;gap:2mm;margin:3mm 0 1.5mm}.source-label h3{margin:0;font-size:10pt;font-weight:700;color:#17212b}.source-chip{font-size:7pt;font-weight:700;letter-spacing:.3pt;padding:.6mm 2mm;border-radius:2.5mm;color:#fff}.source-chip-company{background:#c84b31}.source-chip-supplier{background:#173f67}
    .consultant-complete{display:flex;align-items:flex-end;gap:5mm;padding:3.5mm 4mm;background:#fff8ed;border:1px solid #e3d6c2;border-left:3px solid #173f67}
    .consultant-signature-box{width:55mm;height:22mm;border-bottom:1px solid #17212b}.consultant-signature-box svg{width:100%;height:100%}
    .consultant-name-line{font-size:9.5pt;font-weight:700;color:#17212b;padding-bottom:1mm}
    .consultant-incomplete{margin:0;padding:3.5mm 4mm;background:#fff3d8;border:1px solid #e3c681;border-left:3px solid #9a6512;color:#7a5010;font-size:9pt;font-weight:700}
    /* DEC-401 page-one composition: logo row, institutional text, divider, centred title. */
    .doc-head{margin-bottom:3mm}
    .logo-row{display:flex;align-items:center;justify-content:space-between;gap:8mm;min-height:20mm}
    .company-slot,.ministry-slot{flex:1 1 0;min-width:0;display:flex;align-items:center}
    .ministry-slot{justify-content:flex-end}
    .company-logo,.ministry-logo{max-width:min(100%,56mm);width:auto;height:auto;max-height:26mm;object-fit:contain}
    .brand-name{font-size:19pt;font-weight:900;line-height:1.12;color:#17212b;overflow-wrap:anywhere}
    /* 6mm, not 3mm: at the tighter gap the logo row and the names read as one four-row grid whose
       columns look like they correspond, which they do not. No second rule here on purpose, since a
       line between the logo row and the names would separate the ministry from its own name. */
    .institutional{margin-top:6mm;display:flex;flex-direction:column;gap:2mm}
    /* DEC-400 bilingual pair: English left and LTR, Arabic right and RTL, facing each other. */
    .bi-line{display:flex;align-items:baseline;justify-content:space-between;gap:6mm}
    .bi-en,.bi-ar{flex:1 1 0;min-width:0;overflow-wrap:anywhere;color:#173f67;line-height:1.35}
    .bi-en{direction:ltr;text-align:left}
    .bi-ar{direction:rtl;text-align:right;font-family:'Noto Naskh Arabic','Geeza Pro','Segoe UI',Arial,sans-serif}
    .bi-solo{flex:1 1 100%}
    .inst-ministry .bi-en,.inst-ministry .bi-ar{font-size:13pt;font-weight:800}
    .inst-agency .bi-en,.inst-agency .bi-ar{font-size:11pt;font-weight:700}
    .inst-custom .bi-en,.inst-custom .bi-ar{font-size:10pt;font-weight:700;color:#65717d}
    .head-rule{height:2px;background:#c84b31;margin:4mm 0 3.5mm}
    .doc-title{font-size:16pt;line-height:1.05;margin:0;text-align:center;color:#173f67;letter-spacing:1.4pt;font-weight:900}
    .doc-date{font-size:8pt;margin:1.5mm 0 0;text-align:center;color:#65717d}
  </style></head><body>
    <div class="doc-head">
      <div class="logo-row"><div class="company-slot">${companyMark}</div>${ministryLogoHtml}</div>
      ${institutional}
      <div class="head-rule"></div>
      <h1 class="doc-title">DAILY PROJECT REPORT</h1>
      <p class="doc-date">${e(report.workDate)}</p>
    </div>
    <div class="company-line">${[company.address,company.phone,company.email].filter(Boolean).map(e).join(' &middot; ')}</div>
    <div class="project-line"><div><span class="label">Project</span><span class="value">${e(project.name)}</span></div><div><span class="label">Contractor</span><span class="${contractorClass}">${e(company.name)}</span></div><div><span class="label">Location</span>${e(project.location)}</div><div><span class="label">Work date</span>${e(report.workDate)}</div></div>
    <div class="cards"><div class="card"><strong>${e(timeValue)}</strong><b>NET WORKING TIME</b><small>${timeNote}</small></div><div class="card"><strong>${loads.length+quarry.length}</strong><b>LOADS DELIVERED</b><small>${loads.length} company &middot; ${quarry.length} supplier</small></div><div class="card"><strong>${fmt(fuelLitres)} L</strong><b>FUEL USED</b><small>${includePrices?`$${fuelCost.toFixed(2)}${unpricedFuel?` &middot; ${fmt(unpricedFuel)} L unpriced`:''}`:'Operational quantities only'}</small></div><div class="card"><strong>${photos.filter(Boolean).length}</strong><b>PHOTOS</b><small>Saved with this report</small></div></div>
    <section class="section"><h2>Work performed today</h2><div class="panel"><h3>Daily work description</h3><p>${display(report.workDescription)}</p></div></section>
    <section class="section"><h2>Time and site conditions</h2><div class="two"><div class="panel"><h3>Working time</h3><p>Start ${display(report.workStartTime)} &middot; End ${display(report.workEndTime)} &middot; Break ${report.breakMinutes?`${e(report.breakMinutes)} minutes`:'&mdash;'}<br/><b>Net ${e(timeValue)}</b></p></div><div class="panel"><h3>Weather and site</h3><p>${display(report.weatherSiteConditions)}</p></div></div></section>
    <section class="section"><h2>People and equipment</h2><table><thead><tr><th>Section</th><th>Count</th><th>Present today</th></tr></thead><tbody><tr><td>Workers</td><td class="number">${report.workers.length}</td><td>${list(report.workers)}</td></tr><tr><td>Drivers</td><td class="number">${report.drivers.length}</td><td>${list(report.drivers)}</td></tr><tr><td>Trucks</td><td class="number">${report.truckPlates.length}</td><td>${list(report.truckPlates)}</td></tr><tr><td>Machines</td><td class="number">${report.machines.length}</td><td>${list(report.machines)}</td></tr></tbody></table></section>
    <section class="section"><h2>Worker safety / PPE</h2><table><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Missing PPE</th><th>Notes</th></tr></thead><tbody>${safetyRows}</tbody></table></section>
    <section class="section"><h2>Materials used or transported</h2><table class="materials"><thead><tr><th>Movement</th><th>Material</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>${materialRows}</tbody></table></section>
    <div class="page-two">
      <header><div class="brand">${resolvedLogo?`<img src="${resolvedLogo}"/>`:`<div class="brand-name">${e(company.name)}</div>`}</div><div class="report-title"><h1>DAILY PROJECT REPORT</h1><p>${e(project.name)} &middot; ${e(report.workDate)}</p>${modeBadge}</div></header>
      <section><h2>Loads delivered that day</h2><div class="source-label"><h3>Company Loads</h3><span class="source-chip source-chip-company">${e(company.name)}</span></div><table class="table-accent-company"><thead><tr><th>Transaction</th><th>Item</th><th>Quantity</th><th>Driver</th><th>Truck</th>${includePrices?'<th>Total</th>':''}</tr></thead><tbody>${loadRows}</tbody></table><div class="source-label"><h3>Supplier Loads</h3><span class="source-chip source-chip-supplier">SUPPLIER</span></div><table class="table-accent-supplier"><thead><tr><th>Reference</th><th>Supplier</th><th>Item</th><th>Quantity</th><th>Delivery</th><th>Truck</th><th>Ticket</th>${includePrices?'<th>Total</th>':''}</tr></thead><tbody>${quarryRows}</tbody></table></section>
      <section><h2>Fuel used that day</h2><table><thead><tr><th>Time</th><th>Equipment</th><th>Fuel type</th><th>Litres</th>${includePrices?'<th>Price</th><th>Cost</th>':''}<th>Odometer</th></tr></thead><tbody>${fuelRows}</tbody></table></section>
      <section><h2>Waste dumps completed that day</h2><div class="two"><div class="card"><strong>${waste.length}</strong><b>TOTAL DUMPS</b><small>Total completed dumps: ${waste.length}</small></div><table class="waste"><thead><tr><th>Material</th><th>Dump location</th><th>Dumps</th></tr></thead><tbody>${wasteRows}</tbody></table></div></section>
      ${wallConstructionSectionHtml(current?wallWorkArg:[],current?foundationActivityArg:[])}
      <section><h2>Site notes and follow-up</h2><div class="notes-grid"><div class="panel"><h3>General notes</h3><p>${display(report.notes)}</p></div><div class="panel panel-attention"><h3>Problems, delays, or incidents</h3><p>${display(report.problemsDelaysIncidents)}</p></div><div class="panel"><h3>Next work planned</h3><p>${display(report.nextWorkPlanned)}</p></div><div class="panel"><h3>Daily report status</h3><p>Saved project-day record<br/>Updated ${e(updatedLabel)}</p></div></div></section>
      ${consultantSection}
      <section><h2>Photo evidence</h2><div class="photos">${photoHtml}</div></section>
      <div class="footer-note">Linked company loads, supplier loads, fuel fills, waste dumps, and wall construction records are read-only here. Corrections are made in their original operational records and automatically appear in later exports.</div>
    </div>
  </body></html>`;
}
