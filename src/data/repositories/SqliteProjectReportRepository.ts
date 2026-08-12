import type { SQLiteDatabase } from 'expo-sqlite';

import type { DailyProjectReport, DailyProjectReportDraft, DailyReportMaterial, LinkedProjectLoad, LinkedWasteDump, ProjectCompletionLoad, ProjectCompletionWasteDump, ProjectReportSetup, ReportPresenceOption } from '../../domain/projectReports';
import { validateDailyReport } from '../../domain/projectReports';
import type { ProjectReportRepository } from './ProjectReportRepository';
import {removeLinkedDemoData,seedLinkedDemoData} from '../testing/linkedDemoData';

type ReportRow = {
  id: string; project_id: string; work_date: string; work_description: string; workers_json: string;
  drivers_json: string; truck_plates_json: string; machines_json: string; materials_json: string;
  photos_json: string;
  notes: string | null; problems_delays_incidents: string | null; weather_site_conditions: string | null;
  work_start_time: string | null; work_end_time: string | null; break_minutes: number | null;
  next_work_planned: string | null; created_at: string; updated_at: string;
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
    workers: parseArray<string>(row.workers_json), drivers: parseArray<string>(row.drivers_json),
    truckPlates: parseArray<string>(row.truck_plates_json), machines: parseArray<string>(row.machines_json),
    materials: parseArray<DailyReportMaterial>(row.materials_json), notes: row.notes ?? '',
    photos: parseArray<string>(row.photos_json),
    problemsDelaysIncidents: row.problems_delays_incidents ?? '', weatherSiteConditions: row.weather_site_conditions ?? '',
    workStartTime: row.work_start_time ?? '', workEndTime: row.work_end_time ?? '',
    breakMinutes: row.break_minutes == null ? '' : String(row.break_minutes), nextWorkPlanned: row.next_work_planned ?? '',
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export class SqliteProjectReportRepository implements ProjectReportRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getSetup(): Promise<ProjectReportSetup> {
    const [projects, items, units, company, drivers, trucks, workers, machines, priorReports] = await Promise.all([
      this.db.getAllAsync<{ id: string; name: string; customer_name: string; location: string; status: 'active' | 'completed' }>(`SELECT p.id, p.name, c.name customer_name, p.location, p.status FROM projects p JOIN customers c ON c.id = p.customer_id ORDER BY p.status, p.name COLLATE NOCASE`),
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
      projects: projects.map((row) => ({ id: row.id, name: row.name, customerName: row.customer_name, location: row.location, status: row.status })),
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
    const rows = await this.db.getAllAsync<{ id: string; transaction_number: string; item_name: string; converted_quantity: number; output_unit_symbol: string; driver_name: string; truck_plate: string }>(`SELECT id, transaction_number, item_name, converted_quantity, output_unit_symbol, driver_name, truck_plate FROM loads WHERE project_id = ? AND date(confirmed_at, 'localtime') = ? ORDER BY confirmed_at`, projectId, workDate);
    return rows.map((row) => ({ id: row.id, transactionNumber: row.transaction_number, itemName: row.item_name, quantity: row.converted_quantity, unitSymbol: row.output_unit_symbol, driverName: row.driver_name, truckPlate: row.truck_plate }));
  }

  async listLinkedWasteDumps(projectId: string, workDate: string): Promise<LinkedWasteDump[]> {
    const rows=await this.db.getAllAsync<{id:string;dumped_at:string;material_type:string|null;dump_location:string|null;truck_plate:string|null;driver_name:string|null}>("SELECT id,dumped_at,material_type,dump_location,truck_plate,driver_name FROM waste_dumps WHERE project_id=? AND work_date=? AND status='Active' ORDER BY dumped_at",projectId,workDate);
    return rows.map((row)=>({id:row.id,dumpedAt:row.dumped_at,materialType:row.material_type??'Unspecified material',dumpLocation:row.dump_location??'Unspecified location',truckPlate:row.truck_plate,driverName:row.driver_name}));
  }

  async listProjectLoads(projectId: string): Promise<ProjectCompletionLoad[]> {
    const rows = await this.db.getAllAsync<{ id:string;transaction_number:string;item_name:string;converted_quantity:number;output_unit_symbol:string;driver_name:string;truck_plate:string;work_date:string }>(`SELECT id,transaction_number,item_name,converted_quantity,output_unit_symbol,driver_name,truck_plate,date(confirmed_at, 'localtime') work_date FROM loads WHERE project_id=? ORDER BY confirmed_at`, projectId);
    return rows.map((row) => ({ id:row.id, transactionNumber:row.transaction_number, itemName:row.item_name, quantity:row.converted_quantity, unitSymbol:row.output_unit_symbol, driverName:row.driver_name, truckPlate:row.truck_plate, workDate:row.work_date }));
  }

  async listProjectWasteDumps(projectId: string): Promise<ProjectCompletionWasteDump[]> {
    const rows = await this.db.getAllAsync<{id:string;work_date:string;dumped_at:string;material_type:string|null;dump_location:string|null;truck_plate:string|null;driver_name:string|null}>("SELECT id,work_date,dumped_at,material_type,dump_location,truck_plate,driver_name FROM waste_dumps WHERE project_id=? AND status='Active' ORDER BY dumped_at", projectId);
    return rows.map((row) => ({ id:row.id, workDate:row.work_date, dumpedAt:row.dumped_at, materialType:row.material_type??'Unspecified material', dumpLocation:row.dump_location??'Unspecified location', truckPlate:row.truck_plate, driverName:row.driver_name }));
  }

  async saveReport(draft: DailyProjectReportDraft): Promise<DailyProjectReport> {
    const issues = validateDailyReport(draft); if (issues.length) throw new Error(issues.join('\n'));
    const project = await this.db.getFirstAsync<{ id: string; status: string }>('SELECT id, status FROM projects WHERE id = ?', draft.projectId);
    if (!project) throw new Error('Selected project no longer exists.');
    if (!draft.id && project.status !== 'active') throw new Error('Completed projects cannot receive a new daily report.');
    const existing = await this.getReportForDate(draft.projectId, draft.workDate);
    const id = draft.id ?? existing?.id ?? makeId('daily_report'); const now = new Date().toISOString();
    await this.db.withTransactionAsync(async () => {
      await this.db.runAsync(`INSERT INTO daily_project_reports (id, project_id, work_date, work_description, workers_json, drivers_json, truck_plates_json, machines_json, materials_json, photos_json, notes, problems_delays_incidents, weather_site_conditions, work_start_time, work_end_time, break_minutes, next_work_planned, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET work_date=excluded.work_date, work_description=excluded.work_description, workers_json=excluded.workers_json, drivers_json=excluded.drivers_json, truck_plates_json=excluded.truck_plates_json, machines_json=excluded.machines_json, materials_json=excluded.materials_json, photos_json=excluded.photos_json, notes=excluded.notes, problems_delays_incidents=excluded.problems_delays_incidents, weather_site_conditions=excluded.weather_site_conditions, work_start_time=excluded.work_start_time, work_end_time=excluded.work_end_time, break_minutes=excluded.break_minutes, next_work_planned=excluded.next_work_planned, updated_at=excluded.updated_at`,
        id, draft.projectId, draft.workDate, draft.workDescription.trim(), JSON.stringify(draft.workers), JSON.stringify(draft.drivers), JSON.stringify(draft.truckPlates), JSON.stringify(draft.machines), JSON.stringify(draft.materials), JSON.stringify(draft.photos), clean(draft.notes), clean(draft.problemsDelaysIncidents), clean(draft.weatherSiteConditions), clean(draft.workStartTime), clean(draft.workEndTime), draft.breakMinutes ? Number(draft.breakMinutes) : null, clean(draft.nextWorkPlanned), existing?.createdAt ?? now, now);
      const payload = { ...draft, id, updatedAt: now };
      await this.db.runAsync(`INSERT INTO sync_outbox (entity_type, entity_id, operation, payload_json, created_at) VALUES ('dailyProjectReport', ?, 'upsert', ?, ?)`, id, JSON.stringify(payload), now);
    });
    const saved = await this.db.getFirstAsync<ReportRow>('SELECT * FROM daily_project_reports WHERE id = ?', id);
    if (!saved) throw new Error('Daily report was not saved.'); return fromRow(saved);
  }

  async seedReportTestData():Promise<{projects:number;reports:number;wasteDumps:number}>{
    const seeded=await seedLinkedDemoData(this.db);return{projects:seeded.projects,reports:seeded.reports,wasteDumps:seeded.wasteDumps};
  }

  async removeReportTestData():Promise<{projects:number;reports:number;wasteDumps:number}>{const removed=await removeLinkedDemoData(this.db);return{projects:removed.projects,reports:removed.reports,wasteDumps:removed.wasteDumps};}
}
