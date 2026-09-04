import type { SQLiteDatabase } from 'expo-sqlite';

import type { DailyProjectReport, DailyProjectReportDraft, DailyReportMaterial, LinkedFuelFill, LinkedProjectLoad, LinkedQuarryLoad, LinkedWasteDump, ProjectCompletionLoad, ProjectCompletionWasteDump, ProjectReportSetup, ReportPresenceOption, WorkerSafetyEntry } from '../../domain/projectReports';
import { validateDailyReport } from '../../domain/projectReports';
import type { ProjectReportRepository } from './ProjectReportRepository';

type ReportRow = {
  id: string; project_id: string; work_date: string; work_description: string; workers_json: string;
  drivers_json: string; truck_plates_json: string; machines_json: string; materials_json: string;
  safety_json: string;
  photos_json: string;
  notes: string | null; problems_delays_incidents: string | null; weather_site_conditions: string | null;
  work_start_time: string | null; work_end_time: string | null; break_minutes: number | null;
  next_work_planned: string | null; created_at: string; updated_at: string;
  consultant_signoff_enabled: number; consultant_name: string | null; consultant_signature_json: string;
};

function makeId(prefix: string): string { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }
function clean(value: string): string | null { const next = value.trim(); return next || null; }
function parseArray<T>(value: string): T[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; } }
function mergePresenceOptions(saved: ReportPresenceOption[], historical: string[], prefix: string): ReportPresenceOption[] {
  const seen = new Set(saved.map((value) => value.label.trim().toLocaleLowerCase('en-US')));
  const options = [...saved];
  for (const label of historical) {
    const cleanLabel = label.trim(); const key = cleanLabel.toLocaleLowerCase('en-US');
    if (!cleanLabel || seen.has(key)) continue;
    seen.add(key); options.push({ id: `${prefix}_${options.length}`, label: cleanLabel, detail: 'Previously entered' });
  }
  return options;
}
function fromRow(row: ReportRow): DailyProjectReport {
  return {
    id: row.id, projectId: row.project_id, workDate: row.work_date, workDescription: row.work_description,
    workers: parseArray<string>(row.workers_json), workerSafety:parseArray<WorkerSafetyEntry>(row.safety_json), drivers: parseArray<string>(row.drivers_json),
    truckPlates: parseArray<string>(row.truck_plates_json), machines: parseArray<string>(row.machines_json),
    materials: parseArray<DailyReportMaterial>(row.materials_json), notes: row.notes ?? '',
    photos: parseArray<string>(row.photos_json),
    problemsDelaysIncidents: row.problems_delays_incidents ?? '', weatherSiteConditions: row.weather_site_conditions ?? '',
    workStartTime: row.work_start_time ?? '', workEndTime: row.work_end_time ?? '',
    breakMinutes: row.break_minutes == null ? '' : String(row.break_minutes), nextWorkPlanned: row.next_work_planned ?? '',
    consultantSignoffEnabled: row.consultant_signoff_enabled === 1, consultantName: row.consultant_name ?? '',
    consultantSignaturePaths: parseArray<string>(row.consultant_signature_json),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class SqliteProjectReportRepository implements ProjectReportRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getSetup(): Promise<ProjectReportSetup> {
    const [projects, items, units, company, drivers, trucks, workers, machines, priorReports] = await Promise.all([
      this.db.getAllAsync<{ id: string; name: string; customer_name: string; location: string; status: 'active' | 'completed';start_date:string|null;end_date:string|null }>(`SELECT p.id, p.name, c.name customer_name, p.location, p.status,p.start_date,p.end_date FROM projects p JOIN customers c ON c.id = p.customer_id WHERE p.is_archived=0 ORDER BY p.status, p.name COLLATE NOCASE`),
      this.db.getAllAsync<{ id: string; name: string; category_name: string }>(`SELECT i.id, i.name, c.name category_name FROM catalog_items i JOIN categories c ON c.id = i.category_id WHERE i.is_active = 1 AND i.daily_reports_enabled = 1 ORDER BY i.name COLLATE NOCASE`),
      this.db.getAllAsync<{ id: string; name: string; symbol: string }>('SELECT id, name, symbol FROM measurement_units WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
      this.db.getFirstAsync<{ company_name:string;logo_uri:string|null;address:string|null;phone:string|null;email:string|null;tax_vat_number:string|null }>("SELECT company_name,logo_uri,address,phone,email,tax_vat_number FROM company_settings WHERE id='company'"),
      this.db.getAllAsync<{ id:string;name:string;phone:string|null;license_number:string|null }>('SELECT id,name,phone,license_number FROM driver_profiles WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{ id:string;plate:string;make_model:string|null;owner_name:string|null }>('SELECT id,plate,make_model,owner_name FROM truck_profiles WHERE is_active = 1 ORDER BY plate COLLATE NOCASE'),
      this.db.getAllAsync<{ id:string;name:string;role:string|null;phone:string|null }>('SELECT id,name,role,phone FROM worker_profiles WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{ id:string;name:string;machine_type:string|null;identifier:string|null }>('SELECT id,name,machine_type,identifier FROM machine_profiles WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{ workers_json:string;drivers_json:string;truck_plates_json:string;machines_json:string }>('SELECT workers_json,drivers_json,truck_plates_json,machines_json FROM daily_project_reports'),
    ]);
    const historical = {
      workers: priorReports.flatMap((row) => parseArray<string>(row.workers_json)),
      drivers: priorReports.flatMap((row) => parseArray<string>(row.drivers_json)),
      truckPlates: priorReports.flatMap((row) => parseArray<string>(row.truck_plates_json)),
      machines: priorReports.flatMap((row) => parseArray<string>(row.machines_json)),
    };
    return {
      projects: projects.map((row) => ({ id: row.id, name: row.name, customerName: row.customer_name, location: row.location, status: row.status,startDate:row.start_date,endDate:row.end_date })),
      items: items.map((row) => ({ id: row.id, name: row.name, categoryName: row.category_name })), units,
      presenceOptions: {
        workers: mergePresenceOptions(workers.map((row) => ({ id: `worker_${row.id}`, label: row.name, detail: [row.role, row.phone].filter(Boolean).join(' · ') || undefined })), historical.workers, 'worker_history'),
        drivers: mergePresenceOptions(drivers.map((row) => ({ id: `driver_${row.id}`, label: row.name, detail: [row.phone, row.license_number].filter(Boolean).join(' · ') || undefined })), historical.drivers, 'driver_history'),
        truckPlates: mergePresenceOptions(trucks.map((row) => ({ id: `truck_${row.id}`, label: row.plate, detail: [row.make_model, row.owner_name].filter(Boolean).join(' · ') || undefined })), historical.truckPlates, 'truck_history'),
        machines: mergePresenceOptions(machines.map((row) => ({ id: `machine_${row.id}`, label: row.name, detail: [row.machine_type, row.identifier].filter(Boolean).join(' · ') || undefined })), historical.machines, 'machine_history'),
      },
      company: { name: company?.company_name ?? 'DROMEX', logoUri: company?.logo_uri ?? null, address: company?.address ?? null, phone: company?.phone ?? null, email: company?.email ?? null, taxVatNumber: company?.tax_vat_number ?? null },
    };
  }

  async listReports(projectId: string): Promise<DailyProjectReport[]> {
    return (await this.db.getAllAsync<ReportRow>('SELECT * FROM daily_project_reports WHERE project_id = ? ORDER BY work_date DESC', projectId)).map(fromRow);
  }

  async getReportForDate(projectId: string, workDate: string): Promise<DailyProjectReport | null> {
    const row = await this.db.getFirstAsync<ReportRow>('SELECT * FROM daily_project_reports WHERE project_id = ? AND work_date = ?', projectId, workDate);
    return row ? fromRow(row) : null;
  }

  async listLinkedLoads(projectId: string, workDate: string): Promise<LinkedProjectLoad[]> {
    const rows = await this.db.getAllAsync<{ id: string; transaction_number: string; item_name: string; converted_quantity: number; output_unit_symbol: string; driver_name: string; truck_plate: string;unit_price_usd_cents:number|null;subtotal_usd_cents:number|null;vat_amount_usd_cents:number|null;final_total_usd_cents:number|null }>(`SELECT id, transaction_number, item_name, converted_quantity, output_unit_symbol, driver_name, truck_plate,unit_price_usd_cents,subtotal_usd_cents,vat_amount_usd_cents,final_total_usd_cents FROM loads WHERE project_id = ? AND is_archived=0 AND status='Active' AND date(confirmed_at, 'localtime') = ? ORDER BY confirmed_at`, projectId, workDate);
    return rows.map((row) => ({ id: row.id, transactionNumber: row.transaction_number, itemName: row.item_name, quantity: row.converted_quantity, unitSymbol: row.output_unit_symbol, driverName: row.driver_name, truckPlate: row.truck_plate,unitPriceUsd:row.unit_price_usd_cents==null?null:row.unit_price_usd_cents/100,subtotalUsd:row.subtotal_usd_cents==null?null:row.subtotal_usd_cents/100,vatAmountUsd:row.vat_amount_usd_cents==null?null:row.vat_amount_usd_cents/100,finalTotalUsd:row.final_total_usd_cents==null?null:row.final_total_usd_cents/100 }));
  }

  async listLinkedQuarryLoads(projectId:string,workDate:string):Promise<LinkedQuarryLoad[]> {
    const rows=await this.db.getAllAsync<{id:string;purchase_number:string;confirmed_at:string;supplier_name:string;item_name:string;quantity_cubic_metres:number;unit_symbol:string|null;delivery_method:'company'|'supplier';driver_name:string;truck_plate:string;supplier_ticket_number:string|null;notes:string|null;unit_price_usd_cents:number|null;subtotal_usd_cents:number|null;vat_amount_usd_cents:number|null;final_total_usd_cents:number|null}>(`SELECT id,purchase_number,confirmed_at,supplier_name,item_name,quantity_cubic_metres,unit_symbol,delivery_method,driver_name,truck_plate,supplier_ticket_number,notes,unit_price_usd_cents,subtotal_usd_cents,vat_amount_usd_cents,final_total_usd_cents FROM quarry_purchases WHERE project_id=? AND status='Active' AND date(confirmed_at,'localtime')=? ORDER BY confirmed_at`,projectId,workDate);
    return rows.map(row=>({id:row.id,purchaseNumber:row.purchase_number,confirmedAt:row.confirmed_at,supplierName:row.supplier_name,itemName:row.item_name,quantity:row.quantity_cubic_metres,unitSymbol:row.unit_symbol??'m³',deliveryMethod:row.delivery_method??'company',deliveryLabel:(row.delivery_method??'company')==='supplier'?'Supplier Delivering':row.driver_name,truckPlate:row.truck_plate.trim()||null,supplierTicketNumber:row.supplier_ticket_number,notes:row.notes,unitPriceUsd:row.unit_price_usd_cents==null?null:row.unit_price_usd_cents/100,subtotalUsd:row.subtotal_usd_cents==null?null:row.subtotal_usd_cents/100,vatAmountUsd:row.vat_amount_usd_cents==null?null:row.vat_amount_usd_cents/100,finalTotalUsd:row.final_total_usd_cents==null?null:row.final_total_usd_cents/100}));
  }

  async listLinkedFuelFills(projectId:string,workDate:string):Promise<LinkedFuelFill[]> {
    const rows=await this.db.getAllAsync<{id:string;confirmed_at:string;equipment_name:string;litres:number;price_per_litre_usd_cents:number|null;consumption_cost_usd_cents:number|null;odometer_reading:string|null;notes:string|null}>(`SELECT id,confirmed_at,equipment_name,litres,price_per_litre_usd_cents,consumption_cost_usd_cents,odometer_reading,notes FROM fuel_movements WHERE project_id=? AND movement_type='fill' AND status='Active' AND date(confirmed_at,'localtime')=? ORDER BY confirmed_at`,projectId,workDate);
    return rows.map(row=>({id:row.id,confirmedAt:row.confirmed_at,equipmentName:row.equipment_name??'Unknown equipment',litres:row.litres,pricePerLitreUsd:row.price_per_litre_usd_cents==null?null:row.price_per_litre_usd_cents/100,consumptionCostUsd:row.consumption_cost_usd_cents==null?null:row.consumption_cost_usd_cents/100,odometerReading:row.odometer_reading,notes:row.notes}));
  }

  async listLinkedWasteDumps(projectId: string, workDate: string): Promise<LinkedWasteDump[]> {
    const rows=await this.db.getAllAsync<{id:string;dumped_at:string;material_type:string|null;dump_location:string|null;truck_plate:string|null;driver_name:string|null}>("SELECT id,dumped_at,material_type,dump_location,truck_plate,driver_name FROM waste_dumps WHERE project_id=? AND work_date=? AND status='Active' ORDER BY dumped_at",projectId,workDate);
    return rows.map((row)=>({id:row.id,dumpedAt:row.dumped_at,materialType:row.material_type??'Unspecified material',dumpLocation:row.dump_location??'Unspecified location',truckPlate:row.truck_plate,driverName:row.driver_name}));
  }

  async listProjectLoads(projectId: string): Promise<ProjectCompletionLoad[]> {
    const rows = await this.db.getAllAsync<{ id:string;transaction_number:string;item_name:string;converted_quantity:number;output_unit_symbol:string;driver_name:string;truck_plate:string;work_date:string }>(`SELECT id,transaction_number,item_name,converted_quantity,output_unit_symbol,driver_name,truck_plate,date(confirmed_at, 'localtime') work_date FROM loads WHERE project_id=? AND is_archived=0 AND status='Active' ORDER BY confirmed_at`, projectId);
    return rows.map((row) => ({ id:row.id, transactionNumber:row.transaction_number, itemName:row.item_name, quantity:row.converted_quantity, unitSymbol:row.output_unit_symbol, driverName:row.driver_name, truckPlate:row.truck_plate, workDate:row.work_date }));
  }

  async listProjectWasteDumps(projectId: string): Promise<ProjectCompletionWasteDump[]> {
    const rows = await this.db.getAllAsync<{id:string;work_date:string;dumped_at:string;material_type:string|null;dump_location:string|null;truck_plate:string|null;driver_name:string|null}>("SELECT id,work_date,dumped_at,material_type,dump_location,truck_plate,driver_name FROM waste_dumps WHERE project_id=? AND status='Active' ORDER BY dumped_at", projectId);
    return rows.map((row) => ({ id:row.id, workDate:row.work_date, dumpedAt:row.dumped_at, materialType:row.material_type??'Unspecified material', dumpLocation:row.dump_location??'Unspecified location', truckPlate:row.truck_plate, driverName:row.driver_name }));
  }

  async saveReport(draft: DailyProjectReportDraft): Promise<DailyProjectReport> {
    const issues = validateDailyReport(draft); if (issues.length) throw new Error(issues.join('\n'));
    const project = await this.db.getFirstAsync<{ id: string; status: string;start_date:string|null;end_date:string|null }>('SELECT id, status,start_date,end_date FROM projects WHERE id = ? AND is_archived=0', draft.projectId);
    if (!project) throw new Error('Selected project no longer exists.');
    if (!draft.id && project.status !== 'active') throw new Error('Completed projects cannot receive a new daily report.');
    if((project.start_date&&draft.workDate<project.start_date)||(project.end_date&&draft.workDate>project.end_date))throw new Error('The report date must be within the project start and finish dates.');
    const existing = await this.getReportForDate(draft.projectId, draft.workDate);
    if(draft.id&&existing&&existing.id!==draft.id)throw new Error('A daily report already exists for this project and work date. Open that report instead.');
    const id = draft.id ?? existing?.id ?? makeId('daily_report'); const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      const safety:WorkerSafetyEntry[]=[
        ...draft.workers.map(worker=>(draft.workerSafety??[]).find(value=>value.workerName===worker&&(value.participantType??'worker')==='worker')??{workerName:worker,participantType:'worker' as const,status:'not_checked' as const,missingItems:[],notes:''}),
        ...draft.drivers.map(driver=>(draft.workerSafety??[]).find(value=>value.workerName===driver&&value.participantType==='driver')??{workerName:driver,participantType:'driver' as const,status:'not_checked' as const,missingItems:[],notes:''}),
      ];
      await this.db.runAsync(`INSERT INTO daily_project_reports (id, project_id, work_date, work_description, workers_json, safety_json, drivers_json, truck_plates_json, machines_json, materials_json, photos_json, notes, problems_delays_incidents, weather_site_conditions, work_start_time, work_end_time, break_minutes, next_work_planned, consultant_signoff_enabled, consultant_name, consultant_signature_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET work_date=excluded.work_date, work_description=excluded.work_description, workers_json=excluded.workers_json, safety_json=excluded.safety_json, drivers_json=excluded.drivers_json, truck_plates_json=excluded.truck_plates_json, machines_json=excluded.machines_json, materials_json=excluded.materials_json, photos_json=excluded.photos_json, notes=excluded.notes, problems_delays_incidents=excluded.problems_delays_incidents, weather_site_conditions=excluded.weather_site_conditions, work_start_time=excluded.work_start_time, work_end_time=excluded.work_end_time, break_minutes=excluded.break_minutes, next_work_planned=excluded.next_work_planned, consultant_signoff_enabled=excluded.consultant_signoff_enabled, consultant_name=excluded.consultant_name, consultant_signature_json=excluded.consultant_signature_json, updated_at=excluded.updated_at`,
        id, draft.projectId, draft.workDate, draft.workDescription.trim(), JSON.stringify(draft.workers),JSON.stringify(safety), JSON.stringify(draft.drivers), JSON.stringify(draft.truckPlates), JSON.stringify(draft.machines), JSON.stringify(draft.materials), JSON.stringify(draft.photos), clean(draft.notes), clean(draft.problemsDelaysIncidents), clean(draft.weatherSiteConditions), clean(draft.workStartTime), clean(draft.workEndTime), draft.breakMinutes ? Number(draft.breakMinutes) : null, clean(draft.nextWorkPlanned), draft.consultantSignoffEnabled?1:0, clean(draft.consultantName), JSON.stringify(draft.consultantSignaturePaths), existing?.createdAt ?? now, now);
      const payload = { ...draft, id, updatedAt: now };
      await this.db.runAsync(`INSERT INTO sync_outbox (entity_type, entity_id, operation, payload_json, created_at) VALUES ('dailyProjectReport', ?, 'upsert', ?, ?)`, id, JSON.stringify(payload), now);
    });
    const saved = await this.db.getFirstAsync<ReportRow>('SELECT * FROM daily_project_reports WHERE id = ?', id);
    if (!saved) throw new Error('Daily report was not saved.'); return fromRow(saved);
  }

}
