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
};

export type LoadItemOption = {
  id: string;
  name: string;
  internalCode: string | null;
  categoryName: string;
  defaultPriceUsd: number | null;
};

export type DriverProfile = { id: string; name: string; phone: string | null; licenseNumber: string | null; notes: string | null; isActive: boolean };
export type TruckProfile = { id: string; plate: string; makeModel: string | null; capacityKg: number | null; ownerName: string | null; notes: string | null; isActive: boolean };
export type WorkerProfile = { id: string; name: string; role: string | null; phone: string | null; notes: string | null; isActive: boolean };
export type MachineProfile = { id: string; name: string; machineType: string | null; identifier: string | null; notes: string | null; isActive: boolean };
export type DriverDraft = { name: string; phone?: string; licenseNumber?: string; notes?: string };
export type TruckDraft = { plate: string; makeModel?: string; capacityKg?: number | null; ownerName?: string; notes?: string };
export type WorkerDraft = { name: string; role?: string; phone?: string; notes?: string };
export type MachineDraft = { name: string; machineType?: string; identifier?: string; notes?: string };
export type LoadCorrectionDraft = { requestedQuantityKg: string; emptyWeightKg: string; fullWeightKg: string; unitPriceUsd: string; destinationAddress: string; notes: string };

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
  customerId: string;
  projectId: string;
  destinationAddress: string;
  itemId: string;
  driverId: string;
  truckId: string;
  driverName: string;
  truckPlate: string;
  requestedQuantityKg: string;
  emptyWeightKg: string;
  fullWeightKg: string;
  conversionId: string;
  unitPriceUsd: string;
  notes: string;
};

export const emptyLoadDraft: LoadDraft = {
  customerId: '', projectId: '', destinationAddress: '', itemId: '', driverId: '', truckId: '', driverName: '',
  truckPlate: '', requestedQuantityKg: '', emptyWeightKg: '', fullWeightKg: '',
  conversionId: '', unitPriceUsd: '', notes: '',
};

export function isMeaningfulLoadDraft(draft: LoadDraft): boolean {
  return Boolean(
    draft.destinationAddress.trim()
    || draft.itemId
    || draft.driverId
    || draft.truckId
    || draft.driverName.trim()
    || draft.truckPlate.trim()
    || draft.requestedQuantityKg.trim()
    || draft.emptyWeightKg.trim()
    || draft.fullWeightKg.trim()
    || draft.conversionId
    || draft.unitPriceUsd.trim()
    || draft.notes.trim()
  );
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
  netWeightKg: number;
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
  emptyWeightKg: number;
  fullWeightKg: number;
  conversionName: string;
  conversionRule: string;
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
};

function wholeNumber(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  return Number(value);
}

export function calculateLoad(
  draft: LoadDraft,
  conversion: ConversionOption | undefined,
  vatRatePercent: number,
): LoadCalculation {
  const empty = wholeNumber(draft.emptyWeightKg);
  const full = wholeNumber(draft.fullWeightKg);
  const netWeightKg = empty != null && full != null && full > empty ? full - empty : null;
  if (netWeightKg == null || !conversion) {
    return { netWeightKg, convertedQuantity: null, billedQuantity: null, subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
  }
  const convertedQuantity = (netWeightKg / conversion.inputQuantity) * conversion.outputQuantity;
  const factor = 10 ** conversion.decimalPlaces;
  const billedQuantity = Math.round((convertedQuantity + Number.EPSILON) * factor) / factor;
  if (!draft.unitPriceUsd.trim()) {
    return { netWeightKg, convertedQuantity, billedQuantity, subtotalUsd: null, vatAmountUsd: null, finalTotalUsd: null };
  }
  const price = Number(draft.unitPriceUsd.replace(',', '.'));
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
  const empty = wholeNumber(draft.emptyWeightKg);
  const full = wholeNumber(draft.fullWeightKg);
  if (empty == null) issues.push('Empty weight must be a whole kilogram value.');
  if (full == null) issues.push('Full weight must be a whole kilogram value.');
  if (empty != null && full != null && full <= empty) issues.push('Full weight must be greater than empty weight.');
  if (!options.conversions.some((value) => value.id === draft.conversionId)) issues.push('Select a conversion.');
  const project = options.projects.find((value) => value.id === draft.projectId);
  if (customer?.isOwnCompany && !project) issues.push('An own-company load requires a project.');
  if (customer && !customer.isOwnCompany && !project && !draft.destinationAddress.trim()) {
    issues.push('Select a project or enter a destination address.');
  }
  if (project && project.customerId !== customer?.id) issues.push('The selected project belongs to another customer.');
  if (draft.requestedQuantityKg.trim() && wholeNumber(draft.requestedQuantityKg) == null) {
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
