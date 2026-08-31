import { netWorkMinutes, type DailyProjectReport, type LinkedFuelFill, type LinkedProjectLoad, type LinkedQuarryLoad, type LinkedWasteDump, type ProjectReportSetup, type ReportProject } from '../domain/projectReports';
import { buildWorkbookFromSheets, localizeWorkbookSheets, type EmbeddedWorkbookImage, type SheetSpec, type WorkbookLocale } from './businessWorkbook';

const list = (values: string[]) => values.length ? values.join(', ') : null;

export function dailyReportWorkbookSheets(report: DailyProjectReport, project: ReportProject, loads: LinkedProjectLoad[], quarry:LinkedQuarryLoad[], waste: LinkedWasteDump[], fuel:LinkedFuelFill[], company: ProjectReportSetup['company'], images: EmbeddedWorkbookImage[] = [], locale: WorkbookLocale = 'en'): SheetSpec[] {
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
    { name:'Worker Safety',rows:report.workers.map(worker=>{const safety=(report.workerSafety??[]).find(value=>value.workerName===worker);return{Worker:worker,Status:safety?.status==='compliant'?'Compliant':safety?.status==='missing'?'Missing PPE':'Not checked','Missing PPE':safety?.missingItems.join(', ')||null,Notes:safety?.notes||null};})},
    { name: 'Materials', rows: report.materials.map((material) => ({ 'Material ID': material.id, 'Item ID': material.itemId, Item: material.itemName, Movement: material.movement, Quantity: material.quantity, 'Unit ID': material.unitId, Unit: material.unitSymbol })) },
    { name: 'Linked Loads', rows: loads.map((load) => ({ 'Record ID': load.id, 'Transaction Number': load.transactionNumber, Item: load.itemName, Quantity: load.quantity, Unit: load.unitSymbol, Driver: load.driverName, 'Truck Plate': load.truckPlate })) },
    { name:'Supplier Loads',rows:quarry.map(load=>({'Record ID':load.id,'Supplier Reference':load.purchaseNumber,'Confirmed At':load.confirmedAt,Supplier:load.supplierName,Item:load.itemName,Quantity:load.quantity,Unit:load.unitSymbol,'Delivery Method':load.deliveryLabel,'Truck Plate':load.truckPlate,'Supplier Ticket':load.supplierTicketNumber,Notes:load.notes}))},
    { name:'Fuel Used',rows:fuel.map(fill=>({'Record ID':fill.id,'Confirmed At':fill.confirmedAt,Equipment:fill.equipmentName,'Litres Filled':fill.litres,'Price per Litre USD':fill.pricePerLitreUsd,'Consumption Cost USD':fill.consumptionCostUsd,'Cost Status':fill.consumptionCostUsd==null?'Unpriced':'Costed','Odometer Reference':fill.odometerReading,Notes:fill.notes}))},
    { name: 'Waste Dumps', rows: waste.map((entry) => ({ 'Record ID': entry.id, 'Dumped At': entry.dumpedAt, Material: entry.materialType, Location: entry.dumpLocation, Driver: entry.driverName, 'Truck Plate': entry.truckPlate })) },
    { name: 'Photos', rows: report.photos.map((uri, index) => ({ Photo: index + 1, 'File name': uri.split('/').pop() ?? `photo-${index + 1}.jpg`, 'Work Date': report.workDate })), images },
  ];
  return localizeWorkbookSheets(sheets, locale);
}

export function buildDailyReportWorkbook(report: DailyProjectReport, project: ReportProject, loads: LinkedProjectLoad[], quarry:LinkedQuarryLoad[], waste: LinkedWasteDump[], fuel:LinkedFuelFill[], company: ProjectReportSetup['company'], images: EmbeddedWorkbookImage[] = [], locale: WorkbookLocale = 'en') {
  return buildWorkbookFromSheets(dailyReportWorkbookSheets(report, project, loads, quarry, waste, fuel, company, images, locale));
}
