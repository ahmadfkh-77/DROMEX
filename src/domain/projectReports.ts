export type ReportProjectStatus = 'active' | 'completed';
export type MaterialMovement = 'used' | 'transported';
export type WorkerSafetyStatus = 'compliant' | 'missing' | 'not_checked';
export type WorkerSafetyEntry = { workerName:string;status:WorkerSafetyStatus;missingItems:string[];notes:string };
export const safetyEquipment=['Helmet','High-visibility vest','Safety boots','Gloves','Safety glasses','Hearing protection','Harness'] as const;

export type ReportProject = {
  id: string;
  name: string;
  customerName: string;
  location: string;
  status: ReportProjectStatus;
};

export type ReportItemOption = { id: string; name: string; categoryName: string };
export type ReportUnitOption = { id: string; name: string; symbol: string };
export type ReportPresenceOption = { id: string; label: string; detail?: string };

export type DailyReportMaterial = {
  id: string;
  itemId: string;
  itemName: string;
  unitId: string;
  unitName: string;
  unitSymbol: string;
  quantity: number;
  movement: MaterialMovement;
};

export type DailyProjectReportDraft = {
  id: string | null;
  projectId: string;
  workDate: string;
  workDescription: string;
  workers: string[];
  workerSafety?: WorkerSafetyEntry[];
  drivers: string[];
  truckPlates: string[];
  machines: string[];
  materials: DailyReportMaterial[];
  photos: string[];
  notes: string;
  problemsDelaysIncidents: string;
  weatherSiteConditions: string;
  workStartTime: string;
  workEndTime: string;
  breakMinutes: string;
  nextWorkPlanned: string;
};

export type DailyProjectReport = Omit<DailyProjectReportDraft, 'id'> & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type LinkedProjectLoad = {
  id: string;
  transactionNumber: string;
  itemName: string;
  quantity: number;
  unitSymbol: string;
  driverName: string;
  truckPlate: string;
  unitPriceUsd?:number|null;subtotalUsd?:number|null;vatAmountUsd?:number|null;finalTotalUsd?:number|null;
};
export type LinkedQuarryLoad = { id:string; purchaseNumber:string; confirmedAt:string; supplierName:string; itemName:string; quantity:number; unitSymbol:string; deliveryMethod:'company'|'supplier'; deliveryLabel:string; truckPlate:string|null; supplierTicketNumber:string|null; notes:string|null; unitPriceUsd?:number|null;subtotalUsd?:number|null;vatAmountUsd?:number|null;finalTotalUsd?:number|null };
export type LinkedFuelFill = {id:string;confirmedAt:string;equipmentName:string;litres:number;pricePerLitreUsd:number|null;consumptionCostUsd:number|null;odometerReading:string|null;notes:string|null};
export type LinkedWasteDump = { id: string; dumpedAt: string; materialType: string; dumpLocation: string; truckPlate: string | null; driverName: string | null };
export type ProjectCompletionLoad = LinkedProjectLoad & { workDate: string };
export type ProjectCompletionWasteDump = LinkedWasteDump & { workDate: string };

export type ProjectReportSetup = {
  projects: ReportProject[];
  items: ReportItemOption[];
  units: ReportUnitOption[];
  presenceOptions: {
    workers: ReportPresenceOption[];
    drivers: ReportPresenceOption[];
    truckPlates: ReportPresenceOption[];
    machines: ReportPresenceOption[];
  };
  company: { name: string; logoUri: string | null; address: string | null; phone: string | null; email: string | null; taxVatNumber: string | null };
};

export function splitPresence(value: string): string[] {
  return value.split(/[\n,]/).map((part) => part.trim()).filter(Boolean);
}

export function addPresence(values: string[], next: string): string[] {
  const clean = next.trim();
  if (!clean || values.some((value) => value.toLocaleLowerCase('en-US') === clean.toLocaleLowerCase('en-US'))) return values;
  return [...values, clean];
}

export function localDateString(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function validLocalDate(value:string):boolean{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)return false;return localDateString(new Date(Number(match[1]),Number(match[2])-1,Number(match[3])))===value;}

function minutesFromTime(value: string): number {
  const parts = value.split(':');
  return Number(parts[0] ?? 0) * 60 + Number(parts[1] ?? 0);
}

export function emptyDailyReport(projectId: string): DailyProjectReportDraft {
  return {
    id: null, projectId, workDate: localDateString(), workDescription: '', workers: [], workerSafety:[], drivers: [],
    truckPlates: [], machines: [], materials: [], photos: [], notes: '', problemsDelaysIncidents: '',
    weatherSiteConditions: '', workStartTime: '', workEndTime: '', breakMinutes: '', nextWorkPlanned: '',
  };
}

export function validateDailyReport(draft: DailyProjectReportDraft): string[] {
  const issues: string[] = [];
  if (!draft.projectId) issues.push('Select a project.');
  if (!validLocalDate(draft.workDate)) issues.push('Work date must be a valid calendar date.');
  else if (draft.workDate > localDateString()) issues.push('Work date cannot be in the future.');
  if (!draft.workDescription.trim()) issues.push('Work description is required.');
  const hasAnyTime = Boolean(draft.workStartTime || draft.workEndTime || draft.breakMinutes);
  if (hasAnyTime) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.workStartTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.workEndTime)) {
      issues.push('Working time needs valid start and end values such as 07:00 and 17:00.');
    } else {
      const interval = minutesFromTime(draft.workEndTime) - minutesFromTime(draft.workStartTime);
      const breakMinutes = draft.breakMinutes ? Number(draft.breakMinutes) : 0;
      if (interval < 0) issues.push('Work end time cannot be before start time.');
      if (!Number.isInteger(breakMinutes) || breakMinutes < 0) issues.push('Break must be zero or more whole minutes.');
      else if (interval >= 0 && breakMinutes > interval) issues.push('Break cannot exceed the work interval.');
    }
  }
  return issues;
}

export function netWorkMinutes(draft: DailyProjectReportDraft): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.workStartTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.workEndTime)) return null;
  const interval = minutesFromTime(draft.workEndTime) - minutesFromTime(draft.workStartTime);
  const breakMinutes = draft.breakMinutes ? Number(draft.breakMinutes) : 0;
  if (interval < 0 || !Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > interval) return null;
  return interval - breakMinutes;
}
