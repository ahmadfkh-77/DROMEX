import { netWorkMinutes, type DailyProjectReport, type LinkedFoundationActivity, type LinkedFuelFill, type LinkedProjectLoad, type LinkedQuarryLoad, type LinkedWallWork, type LinkedWasteDump, type ProjectReportSetup, type ReportProject } from '../domain/projectReports';
import { liftHasManualOverride, type ConstructionLiftReportGroup } from '../domain/constructionLiftReport';
import { liftStatusText } from '../domain/constructionLiftDiagram';
import { concreteMatrixVariance } from '../domain/wallConstructionLift';
import { baseStatusLabels } from '../domain/wallBase';
import { foundationQuantityUnitSymbol, type Foundation } from '../domain/foundations';
import type { FoundationComposition } from '../domain/wallFoundation';
import { concretePurposeLabels, describeWallConsumptionQuantity, supportsVolumeCalculation, wallConsumptionPurposeLabel, wallMaterialLabels, wallSystemLabels } from '../domain/walls';
import { buildWorkbookFromSheets, localizeWorkbookSheets, type EmbeddedWorkbookImage, type SheetSpec, type WorkbookLocale } from './businessWorkbook';

const list = (values: string[]) => values.length ? values.join(', ') : null;
const unit = (value: string | null) => value === 'tonnes' ? 't' : value === 'm3' ? 'm³' : value === 'litres' ? 'L' : value;

/** DEC-453. The workbook twin of the PDF Wall Construction section: one row per consumption, with the same quantity sentence and numeric columns left empty when not recorded. */
export function wallConstructionRows(walls: LinkedWallWork[]) {
  return walls.flatMap((wall) => wall.entries.map((entry) => ({
    'Record ID': entry.id, 'Wall ID': wall.wallId, Wall: wall.wallName, 'Wall System': wallSystemLabels[wall.system],
    'Wall Length m': wall.lengthM, 'Wall Height m': wall.heightM, 'Wall Bottom Thickness m': wall.bottomThicknessM, 'Wall Top Thickness m': wall.topThicknessM,
    'Wall Gross Volume m³': wall.netVolumeM3, 'Wall Planned Volume m³': wall.plannedVolumeM3, 'Wall Layer Count': wall.layers?.length ?? 0,
    'Used On': entry.usedOn, Material: wallMaterialLabels[entry.type], Purpose: wallConsumptionPurposeLabel(entry),
    'Purpose Source': entry.customPurposeId ? 'Saved purpose' : entry.concretePurpose ? 'Built-in purpose' : null,
    Quantity: describeWallConsumptionQuantity(entry),
    'Ready-Mix or Finished m³': entry.finishedVolumeM3, 'Cement Bags': entry.cementBags, 'Sand Quantity': entry.sandQuantity, 'Sand Unit': unit(entry.sandUnit),
    'Gravel Quantity': entry.gravelQuantity, 'Gravel Unit': unit(entry.gravelUnit), 'Water L': entry.waterLitres, 'Admixture Quantity': entry.admixtureQuantity, 'Admixture Unit': unit(entry.admixtureUnit),
    'Stone Quantity': entry.stoneQuantity, 'Stone Unit': unit(entry.stoneUnit), 'Rebar Diameter mm': entry.rebarDiameterMm, 'Rebar Bars': entry.rebarCount, 'Rebar Length Each m': entry.rebarLengthEachM, 'Rebar kg': entry.totalRebarKg,
    'Calc Length m': entry.volume?.lengthM ?? null, 'Calc Height m': entry.volume?.heightM ?? null, 'Calc Bottom Thickness m': entry.volume?.bottomThicknessM ?? null,
    'Calc Top Thickness m': entry.volume?.topThicknessM ?? null, 'Calc Deductions m³': entry.volume?.deductionM3 ?? null,
    'Calc Gross Volume m³': entry.volume?.grossVolumeM3 ?? null, 'Calc Net Volume m³': entry.volume?.netVolumeM3 ?? null,
    'Volume Calculation': !supportsVolumeCalculation(entry.type) ? 'Not applicable' : entry.volume ? 'Calculated' : 'Entered directly',
    Corrections: entry.correctionHistory.length, 'Last Correction Reason': entry.correctionHistory.at(-1)?.reason ?? null, Notes: entry.notes.trim() || null,
  })));
}

/** DEC-457. The workbook twin of the diagram legend: one row per layer, in construction-phase order. */
export function wallLayerRows(walls: LinkedWallWork[]) {
  return walls.flatMap((wall) => (wall.layers ?? []).map((layer) => ({
    'Wall ID': wall.wallId, Wall: wall.wallName, Phase: layer.phaseOrder, Layer: layer.name,
    'Layer Bottom Thickness m': layer.bottomThicknessM, 'Layer Top Thickness m': layer.topThicknessM,
    'Wall Bottom Thickness m': wall.bottomThicknessM, 'Wall Top Thickness m': wall.topThicknessM, Note: layer.note.trim() || null,
  })));
}

const compositionColumns=(composition:FoundationComposition|null)=>({
  'Foundation Mode': composition?composition.mode==='composite'?'Composite (Stone + concrete)':'Single material':null,
  'Stone Core Mode': composition?.stoneCoreMode==='detailed'?'Detailed':composition?.stoneCoreMode==='simple'?'Simple':null,
  'Stone Quantity m³': composition?.mode==='composite'?composition.activeStoneM3:null,
  'Estimated Concrete m³': composition?.mode==='composite'?composition.estimatedConcreteM3:null,
  'Actual Ready Mix m³': composition&&composition.activeReadyMixM3>0?composition.activeReadyMixM3:null,
  'Concrete Variance m³': composition?.variance?composition.variance.varianceM3:null,
});

/** DEC-459/464. The foundation linked to each wall on this work date, with its Construction Section, the stage it had reached by then, and its composite composition. */
export function wallFoundationRows(walls: LinkedWallWork[]) {
  return walls.flatMap((wall) => {
    const foundation = wall.foundation;
    if (!foundation || !wall.foundationStatusAsOf) return [];
    return [{
      'Wall ID': wall.wallId, Wall: wall.wallName, 'Construction Section': wall.constructionSectionName, 'Foundation Reference': foundation.reference, Location: foundation.location.trim() || null,
      'Foundation Status': baseStatusLabels[wall.foundationStatusAsOf], 'Constructed On': foundation.constructedOn, 'Curing Started': foundation.curingStartedOn, 'Cured On': foundation.curedOn,
      'Foundation Length m': foundation.lengthM, 'Foundation Height m': foundation.heightM, 'Foundation Bottom Thickness m': foundation.bottomThicknessM, 'Foundation Top Thickness m': foundation.topThicknessM,
      'Foundation Gross Volume m³': foundation.grossVolumeM3, 'Foundation Deduction m³': foundation.deductionM3, 'Foundation Net Volume m³': foundation.netVolumeM3,
      'Recorded Quantity': foundation.quantity, 'Quantity Unit': foundationQuantityUnitSymbol(foundation), 'Manual Override': foundation.manualOverride ? 'Yes' : 'No',
      Material: foundation.materialType ? wallMaterialLabels[foundation.materialType] : null, Purpose: foundation.customPurposeLabel ?? (foundation.concretePurpose ? concretePurposeLabels[foundation.concretePurpose] : null),
      ...compositionColumns(wall.foundationComposition),
      'Consumption Date': foundation.consumptionDate, 'Events On This Date': wall.foundationEvents.join('; ') || null, 'Curing Note': foundation.curingNote.trim() || null, Notes: foundation.notes.trim() || null,
    }];
  });
}

/** DEC-464. Foundations with activity on this work date but no wall linked to them yet. */
export function foundationOnlyRows(activity: LinkedFoundationActivity[]) {
  return activity.map((entry) => {
    const foundation: Foundation = entry.foundation;
    return {
      'Construction Section': entry.constructionSectionName, 'Foundation Reference': foundation.reference, Location: foundation.location.trim() || null,
      'Foundation Status': baseStatusLabels[entry.foundationStatusAsOf], 'Constructed On': foundation.constructedOn, 'Curing Started': foundation.curingStartedOn, 'Cured On': foundation.curedOn,
      'Foundation Length m': foundation.lengthM, 'Foundation Height m': foundation.heightM, 'Foundation Bottom Thickness m': foundation.bottomThicknessM, 'Foundation Top Thickness m': foundation.topThicknessM,
      'Foundation Net Volume m³': foundation.netVolumeM3, 'Recorded Quantity': foundation.quantity, 'Quantity Unit': foundationQuantityUnitSymbol(foundation),
      Material: foundation.materialType ? wallMaterialLabels[foundation.materialType] : null, ...compositionColumns(entry.composition),
      'Events On This Date': entry.foundationEvents.join('; ') || null, Notes: foundation.notes.trim() || null,
    };
  });
}

/**
 * DEC-467. One row per Lift visible on the report date, for both foundation and wall
 * parents, flat enough to filter and total in a spreadsheet. Every quantity stays a real number and a
 * quantity that has not been recorded yet stays empty rather than becoming a misleading zero; the
 * lift diagram deliberately has no cell, because a drawing embedded in a grid cannot be filtered.
 */
export function constructionLiftRows(walls: LinkedWallWork[], foundationActivity: LinkedFoundationActivity[], project: ReportProject, workDate: string) {
  const fromGroup = (group: ConstructionLiftReportGroup | null, context: {sectionName: string | null; sectionLocation: string | null; foundationReference: string | null; wallReference: string | null; curingStatus: string | null}) =>
    (group?.lifts ?? []).map((lift) => {
      const concreteVariance = lift.concretePhase?.actualReadyMixQuantityM3 == null ? null
        : concreteMatrixVariance(lift.concretePhase.estimatedMatrixVolumeM3, lift.concretePhase.actualReadyMixQuantityM3).varianceM3;
      const actualStone = lift.stonePhase.actualStoneQuantityM3;
      return {
        Project: project.name, 'Report Work Date': workDate,
        'Construction Section': context.sectionName, 'Section Location': context.sectionLocation,
        'Foundation Reference': context.foundationReference, 'Wall Reference': context.wallReference,
        'Parent Type': group!.parentType === 'foundation' ? 'Foundation' : 'Wall', 'Parent Reference': group!.parentReference,
        'Lift Sequence': lift.sequence, 'Lift Reference': lift.reference, 'Lift Status': liftStatusText[lift.status],
        'Stone Work Date': lift.stonePhase.workDate, 'Concrete Work Date': lift.concretePhase?.workDate ?? null,
        'Structural Volume m³': lift.netLiftVolumeM3,
        'Estimated Stone m³': lift.stonePhase.calculatedStoneVolumeM3,
        'Actual Stone m³': actualStone,
        'Stone Variance m³': actualStone == null ? null : Number((actualStone - lift.stonePhase.calculatedStoneVolumeM3).toFixed(9)),
        'Estimated Concrete Matrix m³': lift.concretePhase?.estimatedMatrixVolumeM3 ?? null,
        'Actual Ready Mix m³': lift.concretePhase?.actualReadyMixQuantityM3 ?? null,
        'Concrete Variance m³': concreteVariance,
        'Remaining Volume m³': group!.reconciliation.remainingUnallocatedVolumeM3,
        'Over-Allocation Warning': group!.reconciliation.overAllocated ? `Over-allocated by ${group!.reconciliation.overAllocationM3} m³` : null,
        'Manual Override': liftHasManualOverride(lift) ? 'Yes' : 'No',
        'Concrete Purpose': lift.concretePhase?.purpose || null,
        Corrections: lift.correctionHistory.length,
        'Last Correction Reason': lift.correctionHistory.at(-1)?.reason ?? null,
        'Curing Status': context.curingStatus, Notes: lift.notes.trim() || null,
      };
    });

  return [
    ...walls.flatMap((wall) => {
      const context = {
        sectionName: wall.constructionSectionName, sectionLocation: wall.foundation?.location.trim() || null,
        foundationReference: wall.foundation?.reference ?? null, wallReference: wall.wallName,
        curingStatus: wall.foundationStatusAsOf ? baseStatusLabels[wall.foundationStatusAsOf] : null,
      };
      return [...fromGroup(wall.foundationLifts, context), ...fromGroup(wall.wallLifts, context)];
    }),
    ...foundationActivity.flatMap((activity) => fromGroup(activity.lifts, {
      sectionName: activity.constructionSectionName || null, sectionLocation: activity.foundation.location.trim() || null,
      foundationReference: activity.foundation.reference, wallReference: null,
      curingStatus: baseStatusLabels[activity.foundationStatusAsOf],
    })),
  ];
}

export function dailyReportWorkbookSheets(report: DailyProjectReport, project: ReportProject, loads: LinkedProjectLoad[], quarry:LinkedQuarryLoad[], waste: LinkedWasteDump[], fuel:LinkedFuelFill[], company: ProjectReportSetup['company'], images: EmbeddedWorkbookImage[] = [], locale: WorkbookLocale = 'en', wallWork: LinkedWallWork[] = [], foundationActivity: LinkedFoundationActivity[] = []): SheetSpec[] {
  const net = netWorkMinutes(report);
  const sheets: SheetSpec[] = [
    { name: 'Report Overview', rows: [
      { Metric: 'Report title', Value: 'Daily Project Report' }, { Metric: 'Company', Value: company.name },
      { Metric: 'Report ID', Value: report.id }, { Metric: 'Project', Value: project.name }, { Metric: 'Customer', Value: project.customerName },
      { Metric: 'Location', Value: project.location }, { Metric: 'Work Date', Value: report.workDate }, { Metric: 'Created At', Value: report.createdAt },
      { Metric: 'Updated At', Value: report.updatedAt }, { Metric: 'Photo Count', Value: report.photos.length },
    ] },
    { name: 'Work Details', rows: [
      { Section: 'Work performed', Details: report.workDescription }, { Section: 'Weather / Site Conditions', Details: report.weatherSiteConditions || null },
      { Section: 'Problems / Delays / Incidents', Details: report.problemsDelaysIncidents || null }, { Section: 'Notes', Details: report.notes || null },
      { Section: 'Next Work Planned', Details: report.nextWorkPlanned || null }, { Section: 'Work Start', Details: report.workStartTime || null },
      { Section: 'Work End', Details: report.workEndTime || null }, { Section: 'Break Minutes', Details: report.breakMinutes ? Number(report.breakMinutes) : null },
      { Section: 'Net Work Minutes', Details: net },
    ] },
    { name: 'Presence', rows: [
      { Category: 'Workers', Entries: list(report.workers) }, { Category: 'Drivers', Entries: list(report.drivers) },
      { Category: 'Truck Plates', Entries: list(report.truckPlates) }, { Category: 'Machines', Entries: list(report.machines) },
    ] },
    { name:'Worker Safety',rows:[...report.workers.map(name=>({name,type:'Worker' as const})),...report.drivers.map(name=>({name,type:'Truck Driver' as const}))].map(person=>{const safety=(report.workerSafety??[]).find(value=>value.workerName===person.name&&(value.participantType??'worker')===(person.type==='Worker'?'worker':'driver'));return{Person:person.name,Role:person.type,Status:safety?.status==='compliant'?'Compliant':safety?.status==='missing'?'Missing PPE':'Not checked','Missing PPE':safety?.missingItems.join(', ')||null,Notes:safety?.notes||null};})},
    { name: 'Materials', rows: report.materials.map((material) => ({ 'Material ID': material.id, 'Item ID': material.itemId, Item: material.itemName, Movement: material.movement, Quantity: material.quantity, 'Unit ID': material.unitId, Unit: material.unitSymbol })) },
    { name: 'Linked Loads', rows: loads.map((load) => ({ 'Record ID': load.id, 'Transaction Number': load.transactionNumber, Item: load.itemName, Quantity: load.quantity, Unit: load.unitSymbol, Driver: load.driverName, 'Truck Plate': load.truckPlate })) },
    { name:'Supplier Loads',rows:quarry.map(load=>({'Record ID':load.id,'Supplier Reference':load.purchaseNumber,'Confirmed At':load.confirmedAt,Supplier:load.supplierName,Item:load.itemName,Quantity:load.quantity,Unit:load.unitSymbol,'Delivery Method':load.deliveryLabel,'Truck Plate':load.truckPlate,'Supplier Ticket':load.supplierTicketNumber,Notes:load.notes}))},
    { name:'Fuel Used',rows:fuel.map(fill=>({'Record ID':fill.id,'Confirmed At':fill.confirmedAt,Equipment:fill.equipmentName,'Litres Filled':fill.litres,'Price per Litre USD':fill.pricePerLitreUsd,'Consumption Cost USD':fill.consumptionCostUsd,'Cost Status':fill.consumptionCostUsd==null?'Unpriced':'Costed','Odometer Reference':fill.odometerReading,Notes:fill.notes}))},
    { name: 'Waste Dumps', rows: waste.map((entry) => ({ 'Record ID': entry.id, 'Dumped At': entry.dumpedAt, Material: entry.materialType, Location: entry.dumpLocation, Driver: entry.driverName, 'Truck Plate': entry.truckPlate })) },
    { name: 'Wall Construction', rows: wallConstructionRows(wallWork) },
    { name: 'Wall Layers', rows: wallLayerRows(wallWork) },
    { name: 'Wall Foundations', rows: wallFoundationRows(wallWork) },
    { name: 'Lifts', rows: constructionLiftRows(wallWork, foundationActivity, project, report.workDate) },
    { name: 'Foundations Without a Wall', rows: foundationOnlyRows(foundationActivity) },
    { name: 'Photos', rows: report.photos.map((uri, index) => ({ Photo: index + 1, 'File name': uri.split('/').pop() ?? `photo-${index + 1}.jpg`, 'Work Date': report.workDate })), images },
  ];
  return localizeWorkbookSheets(sheets, locale);
}

export function buildDailyReportWorkbook(report: DailyProjectReport, project: ReportProject, loads: LinkedProjectLoad[], quarry:LinkedQuarryLoad[], waste: LinkedWasteDump[], fuel:LinkedFuelFill[], company: ProjectReportSetup['company'], images: EmbeddedWorkbookImage[] = [], locale: WorkbookLocale = 'en', wallWork: LinkedWallWork[] = [], foundationActivity: LinkedFoundationActivity[] = []) {
  return buildWorkbookFromSheets(dailyReportWorkbookSheets(report, project, loads, quarry, waste, fuel, company, images, locale, wallWork, foundationActivity));
}
