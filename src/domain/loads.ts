import type { CompanySettings, Customer } from './profiles';

export type MeasurementUnit = {
  id: string;
  name: string;
  symbol: string;
  isActive: boolean;
};

export type ConversionOption = {
  id: string;
  name: string;
  inputUnitId: string;
  inputUnitName: string;
  inputUnitSymbol: string;
  outputUnitId: string;
  outputUnitName: string;
  outputUnitSymbol: string;
  inputQuantity: number;
  outputQuantity: number;
  decimalPlaces: number;
  isActive: boolean;
};

export type Project = {
  id: string;
  customerId: string;
  customerName: string;
  name: string;
  location: string;
  status: 'active' | 'completed';
  notes: string | null;
  startDate?: string | null;
  endDate?: string | null;
};

export type LoadItemOption = {
  id: string;
  name: string;
  internalCode: string | null;
  categoryName: string;
  defaultPriceUsd: number | null;
  defaultUnitId: string | null;
};

export type DriverProfile = { id: string; name: string; phone: string | null; licenseNumber: string | null; notes: string | null; isActive: boolean };
export type TruckProfile = { id: string; plate: string; makeModel: string | null; capacityKg: number | null; ownerName: string | null; notes: string | null; isActive: boolean };
export type WorkerProfile = { id: string; name: string; role: string | null; phone: string | null; notes: string | null; isActive: boolean };
export type MachineProfile = { id: string; name: string; machineType: string | null; identifier: string | null; notes: string | null; isActive: boolean };
export type DriverDraft = { name: string; phone?: string; licenseNumber?: string; notes?: string };
export type TruckDraft = { plate: string; makeModel?: string; capacityKg?: number | null; ownerName?: string; notes?: string };
export type WorkerDraft = { name: string; role?: string; phone?: string; notes?: string };
export type MachineDraft = { name: string; machineType?: string; identifier?: string; notes?: string };
export type QuantityMethod = 'weighbridge' | 'direct';
/** `correctionReason` is optional on the type so not-yet-updated screens still compile; the repository requires a non-empty value at runtime. */
export type LoadCorrectionDraft = { requestedQuantityKg: string; emptyWeightKg: string; fullWeightKg: string; directQuantity: string; unitPriceUsd: string; destinationAddress: string; notes: string; correctionReason?: string };
export type LoadStatus = 'Active' | 'Cancelled';
export type LoadCorrectionChange = { field: string; originalValue: string | null; newValue: string | null };
export type LoadCorrectionEntry = { correctedAt: string; correctedBy: string; reason: string; changes: LoadCorrectionChange[] };

export type LoadSetupOptions = {
  customers: Customer[];
  items: LoadItemOption[];
  projects: Project[];
  units: MeasurementUnit[];
  conversions: ConversionOption[];
  drivers: DriverProfile[];
  trucks: TruckProfile[];
  workers: WorkerProfile[];
  machines: MachineProfile[];
  companySettings: CompanySettings;
};

export type UnitDraft = { name: string; symbol: string };
export type ConversionDraft = {
  name: string;
  inputUnitId: string;
  outputUnitId: string;
  inputQuantity: number;
  outputQuantity: number;
  decimalPlaces: number;
};
export type ProjectDraft = {
  customerId: string;
  name: string;
  location: string;
  notes?: string;
};

export type LoadDraft = {
  recordDate:string;
  customerId: string;
  projectId: string;
  destinationAddress: string;
  itemId: string;
  driverId: string;
  truckId: string;
  driverName: string;
  truckPlate: string;
  quantityMethod: QuantityMethod;
  requestedQuantityKg: string;
  emptyWeightKg: string;
  fullWeightKg: string;
  conversionId: string;
  directQuantity: string;
  directUnitId: string;
  unitPriceUsd: string;
  notes: string;
};

export const emptyLoadDraft: LoadDraft = {
  recordDate:localLoadDate(),customerId: '', projectId: '', destinationAddress: '', itemId: '', driverId: '', truckId: '', driverName: '',
  truckPlate: '', quantityMethod: 'weighbridge', requestedQuantityKg: '', emptyWeightKg: '', fullWeightKg: '',
  conversionId: '', directQuantity: '', directUnitId: '', unitPriceUsd: '', notes: '',
};

function localLoadDate(date=new Date()){return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}

/** Format/range checks only. Whether narrowing the date would exclude existing linked records is a repository-level, DB-backed check. */
export function validateProjectStartDate(startDate: string, project: Pick<Project, 'endDate'>): string[] {
  const issues: string[] = [];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate);
  if (!match) { issues.push('Start date must be a valid date.'); return issues; }
  const [, y, m, d] = match;
  const parsed = new Date(Number(y), Number(m) - 1, Number(d));
  const roundTrip = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  if (roundTrip !== startDate) { issues.push('Start date must be a valid date.'); return issues; }
  if (startDate > localLoadDate()) issues.push('Start date cannot be in the future.');
  if (project.endDate && startDate > project.endDate) issues.push("Start date cannot be after the project's end date.");
  return issues;
}

export function isMeaningfulLoadDraft(draft: LoadDraft): boolean {
  return Boolean(
    draft.destinationAddress.trim()
    || draft.itemId
    || draft.driverId
    || draft.truckId
    || draft.driverName.trim()
    || draft.truckPlate.trim()
    || draft.quantityMethod !== 'weighbridge'
    || draft.requestedQuantityKg.trim()
    || draft.emptyWeightKg.trim()
    || draft.fullWeightKg.trim()
    || draft.conversionId
    || draft.directQuantity.trim()
    || draft.directUnitId
    || draft.unitPriceUsd.trim()
    || draft.notes.trim()
  );
}

/** The shared delivery context "Create Another Item for Same Delivery" is allowed to carry forward. */
export type SharedDeliveryContext = Pick<
  LoadDraft,
  'recordDate' | 'customerId' | 'projectId' | 'destinationAddress' | 'driverId' | 'driverName' | 'truckId' | 'truckPlate'
>;

/**
 * Builds a genuinely new draft for a second item on the same delivery. Only the shared
 * delivery context (who, where, driver, truck) survives from `source`; everything
 * item-, quantity-, price-, and document-specific resets to `emptyLoadDraft`, including
 * the quantity method, which always returns to the app default rather than being retained.
 * `source` is read only, never mutated, and the result is always a fresh object.
 */
export function createAnotherItemDraft(source: SharedDeliveryContext): LoadDraft {
  return {
    ...emptyLoadDraft,
    recordDate: source.recordDate,
    customerId: source.customerId,
    projectId: source.projectId,
    destinationAddress: source.destinationAddress,
    driverId: source.driverId,
    driverName: source.driverName,
    truckId: source.truckId,
    truckPlate: source.truckPlate,
  };
}

export type LoadCalculation = {
  netWeightKg: number | null;
  convertedQuantity: number | null;
  billedQuantity: number | null;
  subtotalUsd: number | null;
  vatAmountUsd: number | null;
  finalTotalUsd: number | null;
};

export type ConfirmedLoad = Omit<LoadCalculation, 'netWeightKg' | 'convertedQuantity' | 'billedQuantity'> & {
  quantityMethod: QuantityMethod;
  netWeightKg: number | null;
  convertedQuantity: number;
  billedQuantity: number;
  id: string;
  transactionNumber: string;
  confirmedAt: string;
  customerName: string;
  projectName: string | null;
  projectLocation: string | null;
  destinationAddress: string | null;
  itemName: string;
  itemCode: string | null;
  categoryName: string;
  driverName: string;
  truckPlate: string;
  requestedQuantityKg: number | null;
  emptyWeightKg: number | null;
  fullWeightKg: number | null;
  conversionName: string | null;
  conversionRule: string | null;
  directQuantity: number | null;
  directUnitName: string | null;
  directUnitSymbol: string | null;
  outputUnitSymbol: string;
  unitPriceUsd: number | null;
  vatRatePercent: number | null;
  paymentStatus: 'Unpriced' | 'No Payment Due' | 'Unpaid' | 'Partially Paid' | 'Paid' | 'Overpaid';
  signatureStatus: 'Unsigned' | 'Signed';
  signaturePaths: string[];
  notes: string | null;
  companyName: string;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyTaxVatNumber: string | null;
  companyReceiptFooter: string | null;
  companyLogoUri: string | null;
  status: LoadStatus;
  cancellationReason: string | null;
  cancelledAt: string | null;
  correctionHistory: LoadCorrectionEntry[];
};

/** Mirrors correctLoad's own field validation so an invalid draft is blocked in the editor instead of surfacing as a raw repository error at Confirm. */
export function correctionValidationError(selected: Pick<ConfirmedLoad, 'quantityMethod'>, draft: LoadCorrectionDraft): string | null {
  const isDirect = selected.quantityMethod === 'direct';
  if (isDirect) {
    const directText = draft.directQuantity.trim().replace(',', '.');
    const direct = /^\d+(\.\d{1,6})?$/.test(directText) ? Number(directText) : NaN;
    if (!Number.isFinite(direct) || direct <= 0) return 'Direct quantity must be greater than zero with no more than six decimals.';
  } else {
    const wholeRequired = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : NaN);
    const empty = wholeRequired(draft.emptyWeightKg), full = wholeRequired(draft.fullWeightKg);
    if (!Number.isInteger(empty) || !Number.isInteger(full)) return 'Empty and full weights must be whole kilogram values.';
    if (full <= empty) return 'Full weight must be greater than empty weight.';
    if (draft.requestedQuantityKg.trim() && !/^\d+$/.test(draft.requestedQuantityKg.trim())) return 'Requested quantity must be a whole kilogram value.';
  }
  const priceText = draft.unitPriceUsd.trim().replace(',', '.');
  if (priceText && !/^\d+(\.\d{1,2})?$/.test(priceText)) return 'Unit price must be zero or more with no more than two decimals.';
  return null;
}

function wholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

function positiveDecimal(value: string): number | null {
  const text = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,6})?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function calculateLoad(
  draft: LoadDraft,
  conversion: ConversionOption | undefined,
  vatRatePercent: number,
): LoadCalculation {
  if (draft.quantityMethod === 'direct') {
    const quantity = positiveDecimal(draft.directQuantity);
    if (quantity == null) return { netWeightKg: null, convertedQuantity: null, billedQuantity: null, subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
    return calculateValue(null, quantity, quantity, draft.unitPriceUsd, vatRatePercent);
  }
  const empty = wholeNumber(draft.emptyWeightKg);
  const full = wholeNumber(draft.fullWeightKg);
  const netWeightKg = empty != null && full != null && full > empty ? full - empty : null;
  if (netWeightKg == null || !conversion) {
    return { netWeightKg, convertedQuantity: null, billedQuantity: null, subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
  }
  const convertedQuantity = (netWeightKg / conversion.inputQuantity) * conversion.outputQuantity;
  const factor = 10 ** conversion.decimalPlaces;
  const billedQuantity = Math.round((convertedQuantity + Number.EPSILON) * factor) / factor;
  return calculateValue(netWeightKg, convertedQuantity, billedQuantity, draft.unitPriceUsd, vatRatePercent);
}

function calculateValue(netWeightKg: number | null, convertedQuantity: number, billedQuantity: number, priceText: string, vatRatePercent: number): LoadCalculation {
  if (!priceText.trim()) return { netWeightKg, convertedQuantity, billedQuantity, subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
  const price = Number(priceText.replace(',', '.'));
  if (!Number.isFinite(price) || price < 0) {
    return { netWeightKg, convertedQuantity, billedQuantity, subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
  }
  const subtotalCents = Math.round(billedQuantity * price * 100);
  const vatCents = Math.round(subtotalCents * vatRatePercent / 100);
  return {
    netWeightKg,
    convertedQuantity,
    billedQuantity,
    subtotalUsd: subtotalCents / 100,
    vatAmountUsd: vatCents / 100,
    finalTotalUsd: (subtotalCents + vatCents) / 100,
  };
}

export function validateLoadDraft(draft: LoadDraft, options: LoadSetupOptions): string[] {
  const issues: string[] = [];
  const customer = options.customers.find((value) => value.id === draft.customerId);
  if (!customer) issues.push('Select a saved customer.');
  if (!options.items.some((value) => value.id === draft.itemId)) issues.push('Select a load-enabled item.');
  const driver = options.drivers.find((value) => value.id === draft.driverId);
  const truck = options.trucks.find((value) => value.id === draft.truckId);
  if (!driver) issues.push('Select a saved driver.');
  if (!truck) issues.push('Select a saved truck.');
  if (!draft.driverName.trim()) issues.push('Driver name is required.');
  if (!draft.truckPlate.trim()) issues.push('Truck plate is required.');
  if (draft.quantityMethod === 'direct') {
    if (positiveDecimal(draft.directQuantity) == null) issues.push('Direct quantity must be greater than zero with no more than six decimals.');
    if (!options.units.some((value) => value.id === draft.directUnitId)) issues.push('Select the direct quantity unit.');
  } else {
    const empty = wholeNumber(draft.emptyWeightKg);
    const full = wholeNumber(draft.fullWeightKg);
    if (empty == null) issues.push('Empty weight must be a whole kilogram value.');
    if (full == null) issues.push('Full weight must be a whole kilogram value.');
    if (empty != null && full != null && full <= empty) issues.push('Full weight must be greater than empty weight.');
    if (!options.conversions.some((value) => value.id === draft.conversionId)) issues.push('Select a conversion.');
  }
  const project = options.projects.find((value) => value.id === draft.projectId);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(draft.recordDate)||draft.recordDate>localLoadDate())issues.push('Record date must be today or a valid past date.');
  else if(project&&((project.startDate&&draft.recordDate<project.startDate)||(project.endDate&&draft.recordDate>project.endDate)))issues.push('The record date must be within the selected project dates.');
  if (customer?.isOwnCompany && !project) issues.push('An own-company load requires a project.');
  if (customer && !customer.isOwnCompany && !project && !draft.destinationAddress.trim()) {
    issues.push('Select a project or enter a destination address.');
  }
  if (project && project.customerId !== customer?.id) issues.push('The selected project belongs to another customer.');
  if (draft.quantityMethod === 'weighbridge' && draft.requestedQuantityKg.trim() && wholeNumber(draft.requestedQuantityKg) == null) {
    issues.push('Requested quantity must be a whole kilogram value.');
  }
  if (draft.unitPriceUsd.trim()) {
    const priceText=draft.unitPriceUsd.trim().replace(',', '.');const price = Number(priceText);
    if (!/^\d+(\.\d{1,2})?$/.test(priceText)||!Number.isFinite(price) || price < 0) issues.push('Unit price must be zero or more with no more than two decimals.');
  }
  if (!options.companySettings.companyName.trim()) issues.push('Save the required company name in Settings.');
  return issues;
}

export function formatUsd(value: number | null): string {
  return value == null ? 'Unpriced' : `$${value.toFixed(2)}`;
}
