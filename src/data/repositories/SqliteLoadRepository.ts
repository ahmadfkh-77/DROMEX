import type { SQLiteDatabase } from 'expo-sqlite';

import {
  calculateLoad,
  emptyLoadDraft,
  type ConfirmedLoad,
  type ConversionDraft,
  type ConversionOption,
  type DriverDraft,
  type DriverProfile,
  type LoadDraft,
  type LoadCorrectionDraft,
  type LoadItemOption,
  type LoadSetupOptions,
  type MachineDraft,
  type MachineProfile,
  type MeasurementUnit,
  type Project,
  type ProjectDraft,
  type TruckDraft,
  type TruckProfile,
  type UnitDraft,
  type WorkerDraft,
  type WorkerProfile,
  validateLoadDraft,
} from '../../domain/loads';
import type { DirectoryProfiles, LoadRepository } from './LoadRepository';
import {paymentStatus} from '../../domain/financials';
import { SqliteProfileRepository } from './SqliteProfileRepository';

type UnitRow = { id: string; name: string; symbol: string; is_active: number };
type ConversionRow = {
  id: string; name: string; input_unit_id: string; input_unit_name: string;
  input_unit_symbol: string; output_unit_id: string; output_unit_name: string;
  output_unit_symbol: string; input_quantity: number; output_quantity: number;
  decimal_places: number; is_active: number;
};
type ProjectRow = {
  id: string; customer_id: string; customer_name: string; name: string; location: string;
  status: 'active' | 'completed'; notes: string | null;start_date:string|null;end_date:string|null;created_at:string;updated_at:string;
};
type ItemRow = {
  id: string; name: string; internal_code: string | null; category_name: string;
  default_receipt_price_usd_cents: number | null; default_unit_id: string | null;
};
type DriverRow = { id: string; name: string; phone: string | null; license_number: string | null; notes: string | null; is_active: number };
type TruckRow = { id: string; plate: string; make_model: string | null; capacity_kg: number | null; owner_name: string | null; notes: string | null; is_active: number };
type WorkerRow = { id: string; name: string; role: string | null; phone: string | null; notes: string | null; is_active: number };
type MachineRow = { id: string; name: string; machine_type: string | null; identifier: string | null; notes: string | null; is_active: number };
type LoadRow = {
  id: string; transaction_number: string; confirmed_at: string; customer_name: string;
  project_name: string | null; project_location: string | null; destination_address: string | null;
  item_name: string; item_code: string | null; category_name: string; driver_name: string;
  truck_plate: string; requested_quantity_kg: number | null; empty_weight_kg: number;
  full_weight_kg: number; net_weight_kg: number; conversion_name: string;
  conversion_rule: string; output_unit_symbol: string; converted_quantity: number;
  billed_quantity: number; unit_price_usd_cents: number | null; subtotal_usd_cents: number | null;
  vat_rate_basis_points: number | null; vat_amount_usd_cents: number | null;
  final_total_usd_cents: number | null; payment_status: ConfirmedLoad['paymentStatus'];
  signature_status: ConfirmedLoad['signatureStatus']; notes: string | null; company_name: string;
  company_address: string | null; company_phone: string | null; company_email: string | null;
  company_tax_vat_number: string | null; company_receipt_footer: string | null;
  signature_json: string | null; company_logo_uri: string | null;
  conversion_id: string;
  quantity_method: 'weighbridge' | 'direct'; direct_quantity: number | null;
  direct_unit_id: string | null; direct_unit_name: string | null; direct_unit_symbol: string | null;
};

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function clean(value: string): string | null { const next = value.trim().replace(/\s+/g, ' '); return next || null; }
function localToday(){const value=new Date();return`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;}
function unitFromRow(row: UnitRow): MeasurementUnit {
  return { id: row.id, name: row.name, symbol: row.symbol, isActive: row.is_active === 1 };
}
function conversionFromRow(row: ConversionRow): ConversionOption {
  return {
    id: row.id, name: row.name, inputUnitId: row.input_unit_id, inputUnitName: row.input_unit_name,
    inputUnitSymbol: row.input_unit_symbol, outputUnitId: row.output_unit_id,
    outputUnitName: row.output_unit_name, outputUnitSymbol: row.output_unit_symbol,
    inputQuantity: row.input_quantity, outputQuantity: row.output_quantity,
    decimalPlaces: row.decimal_places, isActive: row.is_active === 1,
  };
}
function projectFromRow(row: ProjectRow): Project {
  return { id: row.id, customerId: row.customer_id, customerName: row.customer_name, name: row.name, location: row.location, status: row.status, notes: row.notes,startDate:row.start_date??row.created_at.slice(0,10),endDate:row.end_date??(row.status==='completed'?row.updated_at.slice(0,10):null) };
}
function loadFromRow(row: LoadRow): ConfirmedLoad {
  const quantityMethod = row.quantity_method ?? 'weighbridge';
  return {
    quantityMethod,
    id: row.id, transactionNumber: row.transaction_number, confirmedAt: row.confirmed_at,
    customerName: row.customer_name, projectName: row.project_name, projectLocation: row.project_location,
    destinationAddress: row.destination_address, itemName: row.item_name, itemCode: row.item_code,
    categoryName: row.category_name, driverName: row.driver_name, truckPlate: row.truck_plate,
    requestedQuantityKg: quantityMethod === 'weighbridge' ? row.requested_quantity_kg : null,
    emptyWeightKg: quantityMethod === 'weighbridge' ? row.empty_weight_kg : null,
    fullWeightKg: quantityMethod === 'weighbridge' ? row.full_weight_kg : null,
    netWeightKg: quantityMethod === 'weighbridge' ? row.net_weight_kg : null,
    conversionName: quantityMethod === 'weighbridge' ? row.conversion_name : null,
    conversionRule: quantityMethod === 'weighbridge' ? row.conversion_rule : null,
    directQuantity: row.direct_quantity, directUnitName: row.direct_unit_name, directUnitSymbol: row.direct_unit_symbol,
    outputUnitSymbol: row.output_unit_symbol, convertedQuantity: row.converted_quantity,
    billedQuantity: row.billed_quantity, unitPriceUsd: row.unit_price_usd_cents == null ? null : row.unit_price_usd_cents / 100,
    subtotalUsd: row.subtotal_usd_cents == null ? null : row.subtotal_usd_cents / 100,
    vatRatePercent: row.vat_rate_basis_points == null ? null : row.vat_rate_basis_points / 100,
    vatAmountUsd: row.vat_amount_usd_cents == null ? null : row.vat_amount_usd_cents / 100,
    finalTotalUsd: row.final_total_usd_cents == null ? null : row.final_total_usd_cents / 100,
    paymentStatus: row.payment_status, signatureStatus: row.signature_status,
    signaturePaths: row.signature_json ? JSON.parse(row.signature_json) as string[] : [], notes: row.notes,
    companyName: row.company_name, companyAddress: row.company_address, companyPhone: row.company_phone,
    companyEmail: row.company_email, companyTaxVatNumber: row.company_tax_vat_number,
    companyReceiptFooter: row.company_receipt_footer, companyLogoUri: row.company_logo_uri,
  };
}

export class SqliteLoadRepository implements LoadRepository {
  private readonly profiles: SqliteProfileRepository;
  constructor(private readonly db: SQLiteDatabase) { this.profiles = new SqliteProfileRepository(db); }

  async getSetupOptions(): Promise<LoadSetupOptions> {
    const [customers, companySettings, unitRows, conversionRows, projectRows, itemRows, driverRows, truckRows, workerRows, machineRows] = await Promise.all([
      this.profiles.listCustomers(),
      this.profiles.getCompanySettings(),
      this.db.getAllAsync<UnitRow>('SELECT * FROM measurement_units WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<ConversionRow>(`SELECT c.*, iu.name input_unit_name, iu.symbol input_unit_symbol,
        ou.name output_unit_name, ou.symbol output_unit_symbol FROM conversion_options c
        JOIN measurement_units iu ON iu.id = c.input_unit_id JOIN measurement_units ou ON ou.id = c.output_unit_id
        WHERE c.is_active = 1 AND iu.is_active=1 AND ou.is_active=1 ORDER BY c.name COLLATE NOCASE`),
      this.db.getAllAsync<ProjectRow>(`SELECT p.*, c.name customer_name FROM projects p JOIN customers c ON c.id = p.customer_id
        WHERE p.status = 'active' AND p.is_archived = 0 ORDER BY p.name COLLATE NOCASE`),
      this.db.getAllAsync<ItemRow>(`SELECT i.id, i.name, i.internal_code, i.default_unit_id, c.name category_name,
        i.default_receipt_price_usd_cents FROM catalog_items i JOIN categories c ON c.id = i.category_id
        WHERE i.is_active = 1 AND i.loads_enabled = 1 ORDER BY i.name COLLATE NOCASE`),
      this.db.getAllAsync<DriverRow>('SELECT * FROM driver_profiles WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<TruckRow>('SELECT * FROM truck_profiles WHERE is_active = 1 ORDER BY plate COLLATE NOCASE'),
      this.db.getAllAsync<WorkerRow>('SELECT * FROM worker_profiles WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<MachineRow>('SELECT * FROM machine_profiles WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
    ]);
    const items: LoadItemOption[] = itemRows.map((row) => ({
      id: row.id, name: row.name, internalCode: row.internal_code, categoryName: row.category_name,
      defaultPriceUsd: row.default_receipt_price_usd_cents == null ? null : row.default_receipt_price_usd_cents / 100,
      defaultUnitId: row.default_unit_id,
    }));
    const drivers: DriverProfile[] = driverRows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, licenseNumber: row.license_number, notes: row.notes, isActive: row.is_active === 1 }));
    const trucks: TruckProfile[] = truckRows.map((row) => ({ id: row.id, plate: row.plate, makeModel: row.make_model, capacityKg: row.capacity_kg, ownerName: row.owner_name, notes: row.notes, isActive: row.is_active === 1 }));
    const workers: WorkerProfile[] = workerRows.map((row) => ({ id: row.id, name: row.name, role: row.role, phone: row.phone, notes: row.notes, isActive: row.is_active === 1 }));
    const machines: MachineProfile[] = machineRows.map((row) => ({ id: row.id, name: row.name, machineType: row.machine_type, identifier: row.identifier, notes: row.notes, isActive: row.is_active === 1 }));
    return { customers: customers.filter((value) => value.isActive), companySettings, units: unitRows.map(unitFromRow), conversions: conversionRows.map(conversionFromRow), projects: projectRows.map(projectFromRow), items, drivers, trucks, workers, machines };
  }

  async createUnit(draft: UnitDraft): Promise<MeasurementUnit> {
    const name = draft.name.trim().replace(/\s+/g, ' '); const symbol = draft.symbol.trim();
    if (!name || !symbol) throw new Error('Unit name and symbol are required.');
    const now = new Date().toISOString(); const unit = { id: makeId('unit'), name, symbol, isActive: true };
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('INSERT INTO measurement_units (id, name, symbol, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', unit.id, name, symbol, now, now);
      await this.enqueue('measurementUnit', unit.id, unit);
    });
    return unit;
  }

  async createConversion(draft: ConversionDraft): Promise<ConversionOption> {
    if (!draft.name.trim() || !draft.inputUnitId || !draft.outputUnitId) throw new Error('Conversion name and both units are required.');
    if (!(draft.inputQuantity > 0) || !(draft.outputQuantity > 0)) throw new Error('Conversion quantities must be positive.');
    if (!Number.isInteger(draft.decimalPlaces) || draft.decimalPlaces < 0 || draft.decimalPlaces > 6) throw new Error('Decimal places must be a whole number from 0 to 6.');
    const now = new Date().toISOString(); const id = makeId('conversion');
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`INSERT INTO conversion_options (id, name, input_unit_id, output_unit_id, input_quantity,
        output_quantity, decimal_places, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, draft.name.trim(), draft.inputUnitId, draft.outputUnitId, draft.inputQuantity, draft.outputQuantity, draft.decimalPlaces, now, now);
      await this.enqueue('conversionOption', id, { id, ...draft, isActive: true });
    });
    const options = await this.getSetupOptions();
    const created = options.conversions.find((value) => value.id === id); if (!created) throw new Error('Conversion was not saved.'); return created;
  }

  async listMeasurementUnits():Promise<MeasurementUnit[]>{return (await this.db.getAllAsync<UnitRow>('SELECT * FROM measurement_units ORDER BY is_active DESC,name COLLATE NOCASE')).map(unitFromRow);}
  async updateUnit(id:string,draft:UnitDraft):Promise<MeasurementUnit>{const name=draft.name.trim().replace(/\s+/g,' '),symbol=draft.symbol.trim();if(!name||!symbol)throw new Error('Unit name and symbol are required.');const now=new Date().toISOString();const result=await this.db.runAsync('UPDATE measurement_units SET name=?,symbol=?,updated_at=? WHERE id=?',name,symbol,now,id);if(!result.changes)throw new Error('Measurement unit was not found.');const row=await this.db.getFirstAsync<UnitRow>('SELECT * FROM measurement_units WHERE id=?',id);await this.enqueue('measurementUnit',id,{...unitFromRow(row!),updatedAt:now});return unitFromRow(row!);}
  async removeUnit(id:string):Promise<'deleted'|'deactivated'>{const references=await this.db.getFirstAsync<{total:number}>(`SELECT (SELECT COUNT(*) FROM conversion_options WHERE input_unit_id=? OR output_unit_id=?)+(SELECT COUNT(*) FROM catalog_items WHERE default_unit_id=?)+(SELECT COUNT(*) FROM loads WHERE direct_unit_id=?) total`,id,id,id,id);if((references?.total??0)>0){await this.db.withTransactionAsync(async()=>{await this.db.runAsync('UPDATE measurement_units SET is_active=0,updated_at=? WHERE id=?',new Date().toISOString(),id);await this.db.runAsync('UPDATE conversion_options SET is_active=0,updated_at=? WHERE input_unit_id=? OR output_unit_id=?',new Date().toISOString(),id,id);await this.enqueue('measurementUnit',id,{id,isActive:false});});return'deactivated';}await this.db.runAsync('DELETE FROM measurement_units WHERE id=?',id);await this.enqueue('measurementUnit',id,{id,deleted:true});return'deleted';}
  async setUnitActive(id:string,isActive:boolean):Promise<void>{if(isActive){const row=await this.db.getFirstAsync<UnitRow>('SELECT * FROM measurement_units WHERE id=?',id);if(!row)throw new Error('Measurement unit was not found.');}await this.db.runAsync('UPDATE measurement_units SET is_active=?,updated_at=? WHERE id=?',isActive?1:0,new Date().toISOString(),id);if(!isActive)await this.db.runAsync('UPDATE conversion_options SET is_active=0,updated_at=? WHERE input_unit_id=? OR output_unit_id=?',new Date().toISOString(),id,id);await this.enqueue('measurementUnit',id,{id,isActive});}
  async listConversionOptions():Promise<ConversionOption[]>{return (await this.db.getAllAsync<ConversionRow>(`SELECT c.*,iu.name input_unit_name,iu.symbol input_unit_symbol,ou.name output_unit_name,ou.symbol output_unit_symbol FROM conversion_options c JOIN measurement_units iu ON iu.id=c.input_unit_id JOIN measurement_units ou ON ou.id=c.output_unit_id ORDER BY c.is_active DESC,c.name COLLATE NOCASE`)).map(conversionFromRow);}
  async updateConversion(id:string,draft:ConversionDraft):Promise<ConversionOption>{if(!draft.name.trim()||!draft.inputUnitId||!draft.outputUnitId)throw new Error('Conversion name and both units are required.');if(!(draft.inputQuantity>0)||!(draft.outputQuantity>0))throw new Error('Conversion quantities must be positive.');if(!Number.isInteger(draft.decimalPlaces)||draft.decimalPlaces<0||draft.decimalPlaces>6)throw new Error('Decimal places must be a whole number from 0 to 6.');const now=new Date().toISOString();const result=await this.db.runAsync('UPDATE conversion_options SET name=?,input_unit_id=?,output_unit_id=?,input_quantity=?,output_quantity=?,decimal_places=?,updated_at=? WHERE id=?',draft.name.trim(),draft.inputUnitId,draft.outputUnitId,draft.inputQuantity,draft.outputQuantity,draft.decimalPlaces,now,id);if(!result.changes)throw new Error('Conversion option was not found.');await this.enqueue('conversionOption',id,{id,...draft,updatedAt:now});const row=(await this.listConversionOptions()).find(value=>value.id===id);if(!row)throw new Error('Conversion option could not be reloaded.');return row;}
  async removeConversion(id:string):Promise<'deleted'|'deactivated'>{const used=await this.db.getFirstAsync<{total:number}>('SELECT COUNT(*) total FROM loads WHERE conversion_id=?',id);if((used?.total??0)>0){await this.setConversionActive(id,false);return'deactivated';}await this.db.runAsync('DELETE FROM conversion_options WHERE id=?',id);await this.enqueue('conversionOption',id,{id,deleted:true});return'deleted';}
  async setConversionActive(id:string,isActive:boolean):Promise<void>{if(isActive){const row=await this.db.getFirstAsync<{units_active:number}>('SELECT MIN(iu.is_active,ou.is_active) units_active FROM conversion_options c JOIN measurement_units iu ON iu.id=c.input_unit_id JOIN measurement_units ou ON ou.id=c.output_unit_id WHERE c.id=?',id);if(!row)throw new Error('Conversion option was not found.');if(!row.units_active)throw new Error('Reactivate both measurement units before this conversion.');}await this.db.runAsync('UPDATE conversion_options SET is_active=?,updated_at=? WHERE id=?',isActive?1:0,new Date().toISOString(),id);await this.enqueue('conversionOption',id,{id,isActive});}

  async createProject(draft: ProjectDraft): Promise<Project> {
    if (!draft.customerId || !draft.name.trim() || !draft.location.trim()) throw new Error('Customer, project name, and location are required.');
    const customer = (await this.profiles.listCustomers()).find((value) => value.id === draft.customerId && value.isActive);
    if (!customer) throw new Error('Select an active customer.');
    const now = new Date().toISOString(); const id = makeId('project');
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`INSERT INTO projects (id, customer_id, name, location, notes, start_date, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, id, draft.customerId, draft.name.trim(), draft.location.trim(), clean(draft.notes ?? ''), localToday(),now, now);
      await this.enqueue('project', id, { id, ...draft, status: 'active' });
    });
    return { id, customerId: customer.id, customerName: customer.name, name: draft.name.trim(), location: draft.location.trim(), status: 'active', notes: clean(draft.notes ?? ''),startDate:localToday(),endDate:null };
  }

  async listProjects(): Promise<Project[]> {
    const rows = await this.db.getAllAsync<ProjectRow>(`SELECT p.*, c.name customer_name FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.is_archived = 0 ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END, p.name COLLATE NOCASE`);
    return rows.map(projectFromRow);
  }

  async updateProjectStatus(projectId: string, status: Project['status']): Promise<void> {
    if (status !== 'active' && status !== 'completed') throw new Error('Select a valid project status.');
    const project = await this.db.getFirstAsync<ProjectRow>(`SELECT p.*, c.name customer_name FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.id = ?`, projectId);
    if (!project) throw new Error('Project was not found.');
    const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('UPDATE projects SET status = ?, start_date=COALESCE(start_date,substr(created_at,1,10)), end_date=?, updated_at = ? WHERE id = ?', status,status==='completed'?localToday():null,now, projectId);
      await this.enqueue('project', projectId, { ...projectFromRow(project), status,endDate:status==='completed'?localToday():null, updatedAt: now });
    });
  }

  async createDriver(draft: DriverDraft): Promise<DriverProfile> {
    if (!draft.name.trim()) throw new Error('Driver name is required.');
    const now = new Date().toISOString(); const driver: DriverProfile = { id: makeId('driver'), name: draft.name.trim().replace(/\s+/g, ' '), phone: clean(draft.phone ?? ''), licenseNumber: clean(draft.licenseNumber ?? ''), notes: clean(draft.notes ?? ''), isActive: true };
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`INSERT INTO driver_profiles (id, name, phone, license_number, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, driver.id, driver.name, driver.phone, driver.licenseNumber, driver.notes, now, now);
      await this.enqueue('driverProfile', driver.id, driver);
    }); return driver;
  }

  async createTruck(draft: TruckDraft): Promise<TruckProfile> {
    const plate = draft.plate.trim().toUpperCase(); if (!plate) throw new Error('Truck plate is required.');
    if (draft.capacityKg != null && (!Number.isInteger(draft.capacityKg) || draft.capacityKg <= 0)) throw new Error('Capacity must be a positive whole kilogram value.');
    const now = new Date().toISOString(); const truck: TruckProfile = { id: makeId('truck'), plate, makeModel: clean(draft.makeModel ?? ''), capacityKg: draft.capacityKg ?? null, ownerName: clean(draft.ownerName ?? ''), notes: clean(draft.notes ?? ''), isActive: true };
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`INSERT INTO truck_profiles (id, plate, make_model, capacity_kg, owner_name, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, truck.id, truck.plate, truck.makeModel, truck.capacityKg, truck.ownerName, truck.notes, now, now);
      await this.enqueue('truckProfile', truck.id, truck);
    }); return truck;
  }

  async updateTruck(id:string,draft:TruckDraft):Promise<TruckProfile>{
    const plate=draft.plate.trim().toUpperCase();if(!plate)throw new Error('Truck plate is required.');
    if(draft.capacityKg!=null&&(!Number.isInteger(draft.capacityKg)||draft.capacityKg<=0))throw new Error('Capacity must be a positive whole kilogram value.');
    const now=new Date().toISOString();
    try{const result=await this.db.runAsync('UPDATE truck_profiles SET plate=?,make_model=?,capacity_kg=?,owner_name=?,notes=?,updated_at=? WHERE id=?',plate,clean(draft.makeModel??''),draft.capacityKg??null,clean(draft.ownerName??''),clean(draft.notes??''),now,id);if(!result.changes)throw new Error('Truck was not found.');}
    catch(cause){if(cause instanceof Error&&cause.message.toLowerCase().includes('unique'))throw new Error('Another truck already uses this plate.');throw cause;}
    const row=await this.db.getFirstAsync<TruckRow>('SELECT * FROM truck_profiles WHERE id=?',id);if(!row)throw new Error('Truck was not found after saving.');
    const truck:TruckProfile={id:row.id,plate:row.plate,makeModel:row.make_model,capacityKg:row.capacity_kg,ownerName:row.owner_name,notes:row.notes,isActive:row.is_active===1};await this.enqueue('truckProfile',id,{...truck,updatedAt:now});return truck;
  }

  async createWorker(draft: WorkerDraft): Promise<WorkerProfile> {
    const name = draft.name.trim().replace(/\s+/g, ' '); if (!name) throw new Error('Worker name is required.');
    const now = new Date().toISOString(); const worker: WorkerProfile = { id: makeId('worker'), name, role: clean(draft.role ?? ''), phone: clean(draft.phone ?? ''), notes: clean(draft.notes ?? ''), isActive: true };
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('INSERT INTO worker_profiles (id,name,role,phone,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', worker.id, worker.name, worker.role, worker.phone, worker.notes, now, now);
      await this.enqueue('workerProfile', worker.id, worker);
    }); return worker;
  }

  async createMachine(draft: MachineDraft): Promise<MachineProfile> {
    const name = draft.name.trim().replace(/\s+/g, ' '); if (!name) throw new Error('Machine name is required.');
    const now = new Date().toISOString(); const machine: MachineProfile = { id: makeId('machine'), name, machineType: clean(draft.machineType ?? ''), identifier: clean(draft.identifier ?? ''), notes: clean(draft.notes ?? ''), isActive: true };
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync('INSERT INTO machine_profiles (id,name,machine_type,identifier,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', machine.id, machine.name, machine.machineType, machine.identifier, machine.notes, now, now);
      await this.enqueue('machineProfile', machine.id, machine);
    }); return machine;
  }

  async updateMachine(id:string,draft:MachineDraft):Promise<MachineProfile>{
    const name=draft.name.trim().replace(/\s+/g,' ');if(!name)throw new Error('Machine name is required.');const now=new Date().toISOString();
    try{const result=await this.db.runAsync('UPDATE machine_profiles SET name=?,machine_type=?,identifier=?,notes=?,updated_at=? WHERE id=?',name,clean(draft.machineType??''),clean(draft.identifier??''),clean(draft.notes??''),now,id);if(!result.changes)throw new Error('Machine was not found.');}
    catch(cause){if(cause instanceof Error&&cause.message.toLowerCase().includes('unique'))throw new Error('Another machine already uses this name or identifier.');throw cause;}
    const row=await this.db.getFirstAsync<MachineRow>('SELECT * FROM machine_profiles WHERE id=?',id);if(!row)throw new Error('Machine was not found after saving.');
    const machine:MachineProfile={id:row.id,name:row.name,machineType:row.machine_type,identifier:row.identifier,notes:row.notes,isActive:row.is_active===1};await this.enqueue('machineProfile',id,{...machine,updatedAt:now});return machine;
  }

  async getDirectoryProfiles(): Promise<DirectoryProfiles> {
    const [workerRows, driverRows, truckRows, machineRows] = await Promise.all([
      this.db.getAllAsync<WorkerRow>('SELECT * FROM worker_profiles ORDER BY is_active DESC, name COLLATE NOCASE'),
      this.db.getAllAsync<DriverRow>('SELECT * FROM driver_profiles ORDER BY is_active DESC, name COLLATE NOCASE'),
      this.db.getAllAsync<TruckRow>('SELECT * FROM truck_profiles ORDER BY is_active DESC, plate COLLATE NOCASE'),
      this.db.getAllAsync<MachineRow>('SELECT * FROM machine_profiles ORDER BY is_active DESC, name COLLATE NOCASE'),
    ]);
    return {
      workers: workerRows.map((row) => ({ id: row.id, name: row.name, role: row.role, phone: row.phone, notes: row.notes, isActive: row.is_active === 1 })),
      drivers: driverRows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, licenseNumber: row.license_number, notes: row.notes, isActive: row.is_active === 1 })),
      trucks: truckRows.map((row) => ({ id: row.id, plate: row.plate, makeModel: row.make_model, capacityKg: row.capacity_kg, ownerName: row.owner_name, notes: row.notes, isActive: row.is_active === 1 })),
      machines: machineRows.map((row) => ({ id: row.id, name: row.name, machineType: row.machine_type, identifier: row.identifier, notes: row.notes, isActive: row.is_active === 1 })),
    };
  }

  async setWorkerActive(id: string, isActive: boolean): Promise<void> { await this.setDirectoryProfileActive('worker_profiles', 'workerProfile', id, isActive); }
  async setDriverActive(id: string, isActive: boolean): Promise<void> { await this.setDirectoryProfileActive('driver_profiles', 'driverProfile', id, isActive); }
  async setTruckActive(id: string, isActive: boolean): Promise<void> { await this.setDirectoryProfileActive('truck_profiles', 'truckProfile', id, isActive); }
  async setMachineActive(id: string, isActive: boolean): Promise<void> { await this.setDirectoryProfileActive('machine_profiles', 'machineProfile', id, isActive); }

  async getDraft(): Promise<LoadDraft | null> {
    const row = await this.db.getFirstAsync<{ payload_json: string }>('SELECT payload_json FROM load_drafts WHERE id = ?', 'current');
    if (!row) return null;
    try { return { ...emptyLoadDraft, ...(JSON.parse(row.payload_json) as Partial<LoadDraft>) }; } catch { return null; }
  }
  async saveDraft(draft: LoadDraft): Promise<void> {
    const now=new Date().toISOString();await this.db.withTransactionAsync(async()=>{await this.db.runAsync(`INSERT INTO load_drafts (id, payload_json, updated_at) VALUES ('current', ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`, JSON.stringify(draft), now);await this.db.runAsync("DELETE FROM sync_outbox WHERE entity_type='loadDraft' AND entity_id='current'");await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES ('loadDraft','current','upsert',?,?)",JSON.stringify(draft),now);});
  }
  async clearDraft(): Promise<void> { const now=new Date().toISOString();await this.db.withTransactionAsync(async()=>{await this.db.runAsync('DELETE FROM load_drafts WHERE id = ?', 'current');await this.db.runAsync("DELETE FROM sync_outbox WHERE entity_type='loadDraft' AND entity_id='current'");await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES ('loadDraft','current','delete','{}',?)",now);}); }

  async confirmLoad(draft: LoadDraft): Promise<ConfirmedLoad> {
    const options = await this.getSetupOptions(); const issues = validateLoadDraft(draft, options);
    if (issues.length) throw new Error(issues.join('\n'));
    const customer = options.customers.find((value) => value.id === draft.customerId)!;
    const project = options.projects.find((value) => value.id === draft.projectId);
    const item = options.items.find((value) => value.id === draft.itemId)!;
    const conversion = options.conversions.find((value) => value.id === draft.conversionId);
    const directUnit = options.units.find((value) => value.id === draft.directUnitId);
    const calculation = calculateLoad(draft, conversion, options.companySettings.vatRatePercent);
    if (calculation.convertedQuantity == null || calculation.billedQuantity == null || (draft.quantityMethod === 'weighbridge' && calculation.netWeightKg == null)) throw new Error('Load calculations are incomplete.');
    if (draft.quantityMethod === 'direct' && !directUnit) throw new Error('The direct quantity unit is unavailable.');
    if (draft.quantityMethod === 'weighbridge' && !conversion) throw new Error('The selected conversion is unavailable.');
    const enteredAt=new Date().toISOString();const now=new Date(),[year=0,month=0,day=0]=draft.recordDate.split('-').map(Number);const confirmedAt=new Date(year,month-1,day,now.getHours(),now.getMinutes(),now.getSeconds(),now.getMilliseconds()).toISOString(); const id = makeId('load');
    let transactionNumber = '';
    await this.db.withTransactionAsync(async () => {
      const state = await this.db.getFirstAsync<{ device_code: string; next_load_sequence: number }>('SELECT device_code, next_load_sequence FROM device_state WHERE id = ?', 'local');
      if (!state) throw new Error('Device numbering is not configured.');
      const date = new Date(confirmedAt); const localDate = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
      transactionNumber = `${localDate}-${state.device_code}-${String(state.next_load_sequence).padStart(5, '0')}`;
      const price = draft.unitPriceUsd.trim() ? Number(draft.unitPriceUsd.replace(',', '.')) : null;
      const paymentStatus: ConfirmedLoad['paymentStatus'] = price == null ? 'Unpriced' : price === 0 ? 'No Payment Due' : 'Unpaid';
      const isDirect = draft.quantityMethod === 'direct';
      const retainedRow = conversion ? null : await this.db.getFirstAsync<ConversionRow>(`SELECT c.*, iu.name input_unit_name, iu.symbol input_unit_symbol,
        ou.name output_unit_name, ou.symbol output_unit_symbol FROM conversion_options c
        JOIN measurement_units iu ON iu.id=c.input_unit_id JOIN measurement_units ou ON ou.id=c.output_unit_id WHERE c.id=?`, 'conversion_kg_ton');
      const retainedConversion:ConversionOption|undefined=conversion??(retainedRow?conversionFromRow(retainedRow):undefined);
      if (!retainedConversion) throw new Error('The built-in receipt compatibility conversion is unavailable.');
      await this.db.runAsync(`INSERT INTO loads (id, transaction_number, confirmed_at, customer_id, customer_name,
        project_id, project_name, project_location, destination_address, item_id, item_name, item_code, category_name,
        driver_name, truck_plate, driver_profile_id, truck_profile_id, requested_quantity_kg, empty_weight_kg, full_weight_kg, net_weight_kg, conversion_id,
        conversion_name, conversion_rule, output_unit_symbol, converted_quantity, billed_quantity, unit_price_usd_cents,
        subtotal_usd_cents, vat_rate_basis_points, vat_amount_usd_cents, final_total_usd_cents, payment_status, notes,
        company_name, company_address, company_phone, company_email, company_tax_vat_number, company_receipt_footer, company_logo_uri,
        quantity_method, direct_quantity, direct_unit_id, direct_unit_name, direct_unit_symbol,entered_at)
        VALUES (${Array.from({length:47},()=>'?').join(', ')})`,
        id, transactionNumber, confirmedAt, customer.id, customer.name, project?.id ?? null, project?.name ?? null,
        project?.location ?? null, clean(draft.destinationAddress), item.id, item.name, item.internalCode, item.categoryName,
        draft.driverName.trim(), draft.truckPlate.trim().toUpperCase(), draft.driverId, draft.truckId, !isDirect && draft.requestedQuantityKg.trim() ? Number(draft.requestedQuantityKg) : null,
        isDirect ? 0 : Number(draft.emptyWeightKg), isDirect ? 1 : Number(draft.fullWeightKg), isDirect ? 1 : calculation.netWeightKg,
        retainedConversion.id, isDirect ? 'Direct quantity' : retainedConversion.name,
        isDirect ? 'Entered directly' : `${retainedConversion.inputQuantity} ${retainedConversion.inputUnitSymbol} = ${retainedConversion.outputQuantity} ${retainedConversion.outputUnitSymbol}`,
        isDirect ? directUnit!.symbol : retainedConversion.outputUnitSymbol, calculation.convertedQuantity, calculation.billedQuantity, price == null ? null : Math.round(price * 100),
        calculation.subtotalUsd == null ? null : Math.round(calculation.subtotalUsd * 100), price == null ? null : Math.round(options.companySettings.vatRatePercent * 100),
        calculation.vatAmountUsd == null ? null : Math.round(calculation.vatAmountUsd * 100), calculation.finalTotalUsd == null ? null : Math.round(calculation.finalTotalUsd * 100),
        paymentStatus, clean(draft.notes), options.companySettings.companyName, options.companySettings.address,
        options.companySettings.phone, options.companySettings.email, options.companySettings.taxVatNumber, options.companySettings.receiptFooter, options.companySettings.logoUri,
        draft.quantityMethod, isDirect ? calculation.billedQuantity : null, isDirect ? directUnit!.id : null, isDirect ? directUnit!.name : null, isDirect ? directUnit!.symbol : null,enteredAt);
      await this.db.runAsync('UPDATE device_state SET next_load_sequence = next_load_sequence + 1 WHERE id = ?', 'local');
      await this.db.runAsync('DELETE FROM load_drafts WHERE id = ?', 'current');
      await this.db.runAsync("DELETE FROM sync_outbox WHERE entity_type='loadDraft' AND entity_id='current'");
      await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES ('loadDraft','current','delete','{}',?)",confirmedAt);
      await this.enqueue('load', id, { id, transactionNumber, confirmedAt,enteredAt });
    });
    const row = await this.db.getFirstAsync<LoadRow>('SELECT * FROM loads WHERE id = ?', id);
    if (!row) throw new Error('Confirmed load was not found.'); return loadFromRow(row);
  }

  async listLoads(): Promise<ConfirmedLoad[]> {
    const rows = await this.db.getAllAsync<LoadRow>('SELECT * FROM loads WHERE is_archived = 0 ORDER BY confirmed_at DESC'); return rows.map(loadFromRow);
  }
  async saveLoadSignature(loadId: string, signaturePaths: string[]): Promise<ConfirmedLoad> {
    const row = await this.db.getFirstAsync<LoadRow>('SELECT * FROM loads WHERE id = ?', loadId);
    if (!row) throw new Error('Load was not found.');
    const paths = signaturePaths.filter((value) => value.trim());
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync("UPDATE loads SET signature_json = ?, signature_status = ? WHERE id = ?", paths.length ? JSON.stringify(paths) : null, paths.length ? 'Signed' : 'Unsigned', loadId);
      await this.enqueue('loadSignature', loadId, { loadId, signaturePaths: paths, signatureStatus: paths.length ? 'Signed' : 'Unsigned' });
    });
    const updated = await this.db.getFirstAsync<LoadRow>('SELECT * FROM loads WHERE id = ?', loadId);
    if (!updated) throw new Error('Updated load was not found.'); return loadFromRow(updated);
  }
  async correctLoad(loadId:string,draft:LoadCorrectionDraft):Promise<ConfirmedLoad>{
    const row=await this.db.getFirstAsync<LoadRow>('SELECT * FROM loads WHERE id=?',loadId);if(!row)throw new Error('Load was not found.');
    const isDirect=(row.quantity_method??'weighbridge')==='direct';
    const whole=(value:string,optional=false)=>optional&&!value.trim()?null:/^\d+$/.test(value.trim())?Number(value):NaN;
    const directText=draft.directQuantity.trim().replace(',','.');
    const direct=/^\d+(\.\d{1,6})?$/.test(directText)?Number(directText):NaN;
    const empty=isDirect?row.empty_weight_kg:whole(draft.emptyWeightKg);
    const full=isDirect?row.full_weight_kg:whole(draft.fullWeightKg);
    const requested=isDirect?null:whole(draft.requestedQuantityKg,true);
    if(isDirect&&(!Number.isFinite(direct)||direct<=0))throw new Error('Direct quantity must be greater than zero with no more than six decimals.');
    if(!isDirect&&(!Number.isInteger(empty)||!Number.isInteger(full)))throw new Error('Empty and full weights must be whole kilogram values.');
    if(!isDirect&&(full as number)<=(empty as number))throw new Error('Full weight must be greater than empty weight.');
    if(!isDirect&&requested!=null&&!Number.isInteger(requested))throw new Error('Requested quantity must be a whole kilogram value.');
    const priceText=draft.unitPriceUsd.trim().replace(',','.');if(priceText&&!/^\d+(\.\d{1,2})?$/.test(priceText))throw new Error('Unit price must be zero or more with no more than two decimals.');const price=priceText?Number(priceText):null;
    let net:number;let converted:number;let billed:number;
    if(isDirect){net=1;converted=direct;billed=direct;}else{const conversion=await this.db.getFirstAsync<{input_quantity:number;output_quantity:number;decimal_places:number}>('SELECT input_quantity,output_quantity,decimal_places FROM conversion_options WHERE id=?',row.conversion_id);if(!conversion)throw new Error('The retained conversion is unavailable.');net=(full as number)-(empty as number);converted=net/conversion.input_quantity*conversion.output_quantity;const factor=10**conversion.decimal_places;billed=Math.round((converted+Number.EPSILON)*factor)/factor;}
    const subtotal=price==null?null:Math.round(billed*price*100);const vat=price==null?null:Math.round((subtotal??0)*(row.vat_rate_basis_points??0)/10000);const total=subtotal==null?null:subtotal+(vat??0);const paid=await this.db.getFirstAsync<{cents:number}>("SELECT COALESCE(SUM(amount_usd_cents),0) cents FROM payment_entries WHERE load_id=? AND status='Active'",loadId);if(total==null&&(paid?.cents??0)>0)throw new Error('A load with active payments cannot be corrected to Unpriced.');const status=total==null?'Unpriced':paymentStatus(total,paid?.cents??0);const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{await this.db.runAsync('UPDATE loads SET requested_quantity_kg=?,empty_weight_kg=?,full_weight_kg=?,net_weight_kg=?,direct_quantity=?,converted_quantity=?,billed_quantity=?,unit_price_usd_cents=?,subtotal_usd_cents=?,vat_amount_usd_cents=?,final_total_usd_cents=?,payment_status=?,destination_address=?,notes=? WHERE id=?',requested,empty,full,net,isDirect?billed:null,converted,billed,price==null?null:Math.round(price*100),subtotal,vat,total,status,clean(draft.destinationAddress),clean(draft.notes),loadId);await this.enqueue('load',loadId,{id:loadId,correction:{...draft,netWeightKg:isDirect?null:net,billedQuantity:billed,finalTotalUsd:total==null?null:total/100,paymentStatus:status},updatedAt:now});});const updated=await this.db.getFirstAsync<LoadRow>('SELECT * FROM loads WHERE id=?',loadId);if(!updated)throw new Error('Corrected load was not found.');return loadFromRow(updated);
  }
  private async enqueue(entityType: string, entityId: string, payload: unknown): Promise<void> {
    await this.db.runAsync(`INSERT INTO sync_outbox (entity_type, entity_id, operation, payload_json, created_at)
      VALUES (?, ?, 'upsert', ?, ?)`, entityType, entityId, JSON.stringify(payload), new Date().toISOString());
  }
  private async setDirectoryProfileActive(table: 'worker_profiles'|'driver_profiles'|'truck_profiles'|'machine_profiles', entityType: string, id: string, isActive: boolean): Promise<void> {
    const exists = await this.db.getFirstAsync<{ id: string }>(`SELECT id FROM ${table} WHERE id = ?`, id);
    if (!exists) throw new Error('The saved profile was not found.');
    const updatedAt = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`UPDATE ${table} SET is_active = ?, updated_at = ? WHERE id = ?`, isActive ? 1 : 0, updatedAt, id);
      await this.enqueue(entityType, id, { id, isActive, updatedAt });
    });
  }
}
