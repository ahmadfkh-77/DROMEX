import { netWorkMinutes, type DailyProjectReport, type LinkedFuelFill, type LinkedProjectLoad, type LinkedQuarryLoad, type LinkedWallWork, type LinkedWasteDump, type ProjectReportSetup, type ReportProject } from '../domain/projectReports';
import { describeWallConsumptionQuantity, supportsCoveredArea, wallConsumptionPurposeLabel, wallMaterialLabels, wallSystemLabels } from '../domain/walls';
import { buildWorkbookFromSheets, localizeWorkbookSheets, type EmbeddedWorkbookImage, type SheetSpec, type WorkbookLocale } from './businessWorkbook';

const list = (values: string[]) => values.length ? values.join(', ') : null;
const unit = (value: string | null) => value === 'tonnes' ? 't' : value === 'm3' ? 'm³' : value === 'litres' ? 'L' : value;

/** DEC-453. The workbook twin of the PDF Wall Construction section: one row per consumption, with the same quantity sentence and numeric columns left empty when not recorded. */
export function wallConstructionRows(walls: LinkedWallWork[]) {
  return walls.flatMap((wall) => wall.entries.map((entry) => ({
    'Record ID': entry.id, 'Wall ID': wall.wallId, Wall: wall.wallName, 'Wall System': wallSystemLabels[wall.system],
    'Wall Length m': wall.lengthM, 'Wall Height m': wall.heightM, 'Wall Planned Volume m³': wall.plannedVolumeM3,
    'Used On': entry.usedOn, Material: wallMaterialLabels[entry.type], Purpose: wallConsumptionPurposeLabel(entry),
    'Purpose Source': entry.customPurposeId ? 'Saved purpose' : entry.concretePurpose ? 'Built-in purpose' : null,
    Quantity: describeWallConsumptionQuantity(entry),
    'Ready-Mix or Finished m³': entry.finishedVolumeM3, 'Cement Bags': entry.cementBags, 'Sand Quantity': entry.sandQuantity, 'Sand Unit': unit(entry.sandUnit),
    'Gravel Quantity': entry.gravelQuantity, 'Gravel Unit': unit(entry.gravelUnit), 'Water L': entry.waterLitres, 'Admixture Quantity': entry.admixtureQuantity, 'Admixture Unit': unit(entry.admixtureUnit),
    'Stone Quantity': entry.stoneQuantity, 'Stone Unit': unit(entry.stoneUnit), 'Rebar Diameter mm': entry.rebarDiameterMm, 'Rebar Bars': entry.rebarCount, 'Rebar Length Each m': entry.rebarLengthEachM, 'Rebar kg': entry.totalRebarKg,
    'Area Length m': entry.area?.lengthM ?? null, 'Area Height m': entry.area?.heightM ?? null, 'Openings m²': entry.area?.deductionM2 ?? null,
    'Gross Area m²': entry.area?.grossAreaM2 ?? null, 'Net Covered Area m²': entry.area?.netAreaM2 ?? null,
    'Area Status': !supportsCoveredArea(entry.type) ? 'Not applicable' : entry.area ? 'Recorded' : 'Area not recorded',
    Corrections: entry.correctionHistory.length, 'Last Correction Reason': entry.correctionHistory.at(-1)?.reason ?? null, Notes: entry.notes.trim() || null,
  })));
}

export function dailyReportWorkbookSheets(report: DailyProjectReport, project: ReportProject, loads: LinkedProjectLoad[], quarry:LinkedQuarryLoad[], waste: LinkedWasteDump[], fuel:LinkedFuelFill[], company: ProjectReportSetup['company'], images: EmbeddedWorkbookImage[] = [], locale: WorkbookLocale = 'en', wallWork: LinkedWallWork[] = []): SheetSpec[] {
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
    { name: 'Photos', rows: report.photos.map((uri, index) => ({ Photo: index + 1, 'File name': uri.split('/').pop() ?? `photo-${index + 1}.jpg`, 'Work Date': report.workDate })), images },
  ];
  return localizeWorkbookSheets(sheets, locale);
}

export function buildDailyReportWorkbook(report: DailyProjectReport, project: ReportProject, loads: LinkedProjectLoad[], quarry:LinkedQuarryLoad[], waste: LinkedWasteDump[], fuel:LinkedFuelFill[], company: ProjectReportSetup['company'], images: EmbeddedWorkbookImage[] = [], locale: WorkbookLocale = 'en', wallWork: LinkedWallWork[] = []) {
  return buildWorkbookFromSheets(dailyReportWorkbookSheets(report, project, loads, quarry, waste, fuel, company, images, locale, wallWork));
}
