import type { SQLiteDatabase } from 'expo-sqlite';

import type { FuelType } from '../../domain/fuel';
import type { DailyProjectReport, DailyProjectReportDraft, DailyReportMaterial, LinkedFoundationActivity, LinkedFuelFill, LinkedProjectLoad, LinkedQuarryLoad, LinkedWallWork, LinkedWasteDump, ProjectCompletionLoad, ProjectCompletionWasteDump, ProjectReportSetup, ReportPresenceOption, WorkerSafetyEntry } from '../../domain/projectReports';
import { validateDailyReport } from '../../domain/projectReports';
import type { PersonRole } from '../../domain/people';
import { normalizeCustomResourceSnapshots } from '../../domain/customDirectories';
import { SqliteCustomDirectoryRepository } from './SqliteCustomDirectoryRepository';
import { normalizeSupervisorSignoffs } from '../../domain/supervisors';
import { SqliteSupervisorRepository } from './SqliteSupervisorRepository';
import type { BaseStatus } from '../../domain/wallBase';
import type { Foundation } from '../../domain/foundations';
import { buildLiftReportGroup, liftHasActivityOn } from '../../domain/constructionLiftReport';
import { SqliteConstructionLiftRepository } from './SqliteConstructionLiftRepository';
import { SqliteWallRepository, wallConsumptionFromRow, type WallConsumptionRow } from './SqliteWallRepository';
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
  show_ministry_header: number | null;
  show_consulting_agency: number | null;
  show_custom_header: number | null;
  consulting_agency_id: string | null;
  consulting_agency_name_en: string | null;
  consulting_agency_name_ar: string | null;
  operators_json: string | null;
  custom_resources_json: string | null;
  supervisor_signoffs_json: string | null;
};
type PersonOptionRow = { id: string; name: string; person_role: PersonRole; job_title: string | null; phone: string | null; license_number: string | null };

function makeId(prefix: string): string { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }
function clean(value: string): string | null { const next = value.trim(); return next || null; }
function parseArray<T>(value: string | null): T[] { try { const parsed = JSON.parse(value ?? '[]'); return Array.isArray(parsed) ? parsed as T[] : []; } catch { return []; } }
/**
 * Saved people for one list, followed by names typed into earlier reports that are not saved people.
 * `savedPeopleKeys` covers every saved person in every role (DEC-476): a name that now belongs to a
 * saved person is offered only under that person's current role, never again as "Previously entered"
 * under the role it was once recorded in.
 */
function mergePresenceOptions(saved: ReportPresenceOption[], historical: string[], prefix: string, savedPeopleKeys: ReadonlySet<string> = new Set()): ReportPresenceOption[] {
  const seen = new Set([...savedPeopleKeys, ...saved.map((value) => value.label.trim().toLocaleLowerCase('en-US'))]);
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
    workers: parseArray<string>(row.workers_json), workerSafety:parseArray<WorkerSafetyEntry>(row.safety_json), drivers: parseArray<string>(row.drivers_json), operators: parseArray<string>(row.operators_json), customResources: normalizeCustomResourceSnapshots(parseArray<unknown>(row.custom_resources_json)), supervisorSignoffs: normalizeSupervisorSignoffs(parseArray<unknown>(row.supervisor_signoffs_json)),
    truckPlates: parseArray<string>(row.truck_plates_json), machines: parseArray<string>(row.machines_json),
    materials: parseArray<DailyReportMaterial>(row.materials_json), notes: row.notes ?? '',
    photos: parseArray<string>(row.photos_json),
    problemsDelaysIncidents: row.problems_delays_incidents ?? '', weatherSiteConditions: row.weather_site_conditions ?? '',
    workStartTime: row.work_start_time ?? '', workEndTime: row.work_end_time ?? '',
    breakMinutes: row.break_minutes == null ? '' : String(row.break_minutes), nextWorkPlanned: row.next_work_planned ?? '',
    consultantSignoffEnabled: row.consultant_signoff_enabled === 1, consultantName: row.consultant_name ?? '',
    consultantSignaturePaths: parseArray<string>(row.consultant_signature_json),
    showMinistryHeader: row.show_ministry_header === 1,
    showConsultingAgency: row.show_consulting_agency === 1,
    showCustomHeader: row.show_custom_header === 1,
    // DEC-417 snapshot: written only by saveReport() from whatever the caller's draft carries, and
    // never re-derived here or anywhere else from the agency's current name.
    consultingAgencyId: row.consulting_agency_id,
    consultingAgencyNameEn: row.consulting_agency_name_en,
    consultingAgencyNameAr: row.consulting_agency_name_ar,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/** DEC-459/464. What happened to this foundation on one work date, in the order it happens on site. */
function foundationEventsOn(foundation:Foundation,workDate:string):string[]{
  const events:string[]=[];
  // DEC-470. Creation is itself a dated event. A planned foundation has no constructed, curing, cured
  // or consumption date at all -- DEC-468 correctly stopped it claiming a consumption it never had --
  // so without this a foundation recorded today would appear in no Daily Report whatsoever.
  if(foundation.createdAt.slice(0,10)===workDate)events.push('Foundation created');
  if(foundation.constructedOn===workDate)events.push('Foundation constructed or poured');
  if(foundation.curingStartedOn===workDate)events.push('Curing started');
  if(foundation.curedOn===workDate)events.push('Foundation confirmed cured');
  if(foundation.consumptionDate===workDate)events.push('Foundation material recorded');
  return events;
}
/** The stage the foundation had actually reached by that date, never its latest stage. */
function foundationStatusOn(foundation:Foundation,workDate:string):BaseStatus{
  if(foundation.curedOn&&foundation.curedOn<=workDate)return 'cured';
  if(foundation.curingStartedOn&&foundation.curingStartedOn<=workDate)return 'curing';
  if(foundation.constructedOn&&foundation.constructedOn<=workDate)return 'constructed';
  return 'planned';
}

export class SqliteProjectReportRepository implements ProjectReportRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getSetup(): Promise<ProjectReportSetup> {
    const [projects, items, units, company, people, trucks, machines, priorReports, agencies, customDirectories, supervisors] = await Promise.all([
      // LEFT JOIN, not filtered to active agencies: a project's own current assignment must stay
      // resolvable and visible even after that agency is later deactivated (DEC-417).
      this.db.getAllAsync<{ id: string; name: string; customer_name: string; location: string; status: 'active' | 'completed';start_date:string|null;end_date:string|null;consulting_agency_id:string|null;agency_name_en:string|null;agency_name_ar:string|null;agency_is_active:number|null }>(`SELECT p.id, p.name, c.name customer_name, p.location, p.status,p.start_date,p.end_date, p.consulting_agency_id, ca.name_en agency_name_en, ca.name_ar agency_name_ar, ca.is_active agency_is_active FROM projects p JOIN customers c ON c.id = p.customer_id LEFT JOIN consulting_agencies ca ON ca.id = p.consulting_agency_id WHERE p.is_archived=0 ORDER BY p.status, p.name COLLATE NOCASE`),
      this.db.getAllAsync<{ id: string; name: string; category_name: string }>(`SELECT i.id, i.name, c.name category_name FROM catalog_items i JOIN categories c ON c.id = i.category_id WHERE i.is_active = 1 AND i.daily_reports_enabled = 1 ORDER BY i.name COLLATE NOCASE`),
      this.db.getAllAsync<{ id: string; name: string; symbol: string }>('SELECT id, name, symbol FROM measurement_units WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
      this.db.getFirstAsync<{ company_name:string;logo_uri:string|null;address:string|null;phone:string|null;email:string|null;tax_vat_number:string|null;ministry_name:string|null;ministry_name_ar:string|null;ministry_logo_uri:string|null;consulting_agency_name:string|null;consulting_agency_name_ar:string|null;custom_header_en:string|null;custom_header_ar:string|null }>("SELECT company_name,logo_uri,address,phone,email,tax_vat_number,ministry_name,ministry_name_ar,ministry_logo_uri,consulting_agency_name,consulting_agency_name_ar,custom_header_en,custom_header_ar FROM company_settings WHERE id='company'"),
      // DEC-476. Every person, active or not: active ones fill their role's list, and every saved name
      // is kept out of the "Previously entered" suggestions below.
      this.db.getAllAsync<PersonOptionRow & { is_active: number }>("SELECT id,name,person_role,job_title,phone,license_number,is_active FROM driver_profiles WHERE substr(id,1,7) <> 'system_' ORDER BY name COLLATE NOCASE"),
      this.db.getAllAsync<{ id:string;plate:string;make_model:string|null;owner_name:string|null }>('SELECT id,plate,make_model,owner_name FROM truck_profiles WHERE is_active = 1 ORDER BY plate COLLATE NOCASE'),
      this.db.getAllAsync<{ id:string;name:string;machine_type:string|null;identifier:string|null }>('SELECT id,name,machine_type,identifier FROM machine_profiles WHERE is_active = 1 ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{ workers_json:string;drivers_json:string;operators_json:string|null;truck_plates_json:string;machines_json:string }>('SELECT workers_json,drivers_json,operators_json,truck_plates_json,machines_json FROM daily_project_reports'),
      // Active only: the pool an override picker offers for a NEW selection (DEC-417). A record's
      // own already-assigned-but-inactive agency is added separately by resolveConsultingAgencySelectorOptions.
      this.db.getAllAsync<{ id:string;name_en:string;name_ar:string|null }>("SELECT id,name_en,name_ar FROM consulting_agencies WHERE is_active=1 ORDER BY name_en_key"),
      new SqliteCustomDirectoryRepository(this.db).listSelectionOptions(),
      new SqliteSupervisorRepository(this.db).listSupervisors(),
    ]);
    const historical = {
      workers: priorReports.flatMap((row) => parseArray<string>(row.workers_json)),
      drivers: priorReports.flatMap((row) => parseArray<string>(row.drivers_json)),
      operators: priorReports.flatMap((row) => parseArray<string>(row.operators_json)),
      truckPlates: priorReports.flatMap((row) => parseArray<string>(row.truck_plates_json)),
      machines: priorReports.flatMap((row) => parseArray<string>(row.machines_json)),
    };
    const savedPeopleKeys = new Set(people.map((row) => row.name.trim().toLocaleLowerCase('en-US')));
    const peopleIn = (role: PersonRole): ReportPresenceOption[] => people
      .filter((row) => row.is_active === 1 && row.person_role === role)
      .map((row) => ({ id: `${role}_${row.id}`, label: row.name, detail: [row.job_title, row.phone, row.license_number].filter(Boolean).join(' · ') || undefined }));
    return {
      projects: projects.map((row) => ({
        id: row.id, name: row.name, customerName: row.customer_name, location: row.location, status: row.status,startDate:row.start_date,endDate:row.end_date,
        consultingAgencyId: row.consulting_agency_id,
        consultingAgencyNameEn: row.agency_name_en,
        consultingAgencyNameAr: row.agency_name_ar,
        consultingAgencyIsActive: row.consulting_agency_id ? row.agency_is_active === 1 : null,
      })),
      items: items.map((row) => ({ id: row.id, name: row.name, categoryName: row.category_name })), units,
      presenceOptions: {
        workers: mergePresenceOptions(peopleIn('worker'), historical.workers, 'worker_history', savedPeopleKeys),
        drivers: mergePresenceOptions(peopleIn('driver'), historical.drivers, 'driver_history', savedPeopleKeys),
        operators: mergePresenceOptions(peopleIn('operator'), historical.operators, 'operator_history', savedPeopleKeys),
        truckPlates: mergePresenceOptions(trucks.map((row) => ({ id: `truck_${row.id}`, label: row.plate, detail: [row.make_model, row.owner_name].filter(Boolean).join(' · ') || undefined })), historical.truckPlates, 'truck_history'),
        machines: mergePresenceOptions(machines.map((row) => ({ id: `machine_${row.id}`, label: row.name, detail: [row.machine_type, row.identifier].filter(Boolean).join(' · ') || undefined })), historical.machines, 'machine_history'),
      },
      company: { name: company?.company_name ?? 'DROMEX', logoUri: company?.logo_uri ?? null, address: company?.address ?? null, phone: company?.phone ?? null, email: company?.email ?? null, taxVatNumber: company?.tax_vat_number ?? null,
        ministryName: company?.ministry_name ?? null, ministryNameAr: company?.ministry_name_ar ?? null, ministryLogoUri: company?.ministry_logo_uri ?? null,
        consultingAgencyName: company?.consulting_agency_name ?? null, consultingAgencyNameAr: company?.consulting_agency_name_ar ?? null,
        customHeaderEn: company?.custom_header_en ?? null, customHeaderAr: company?.custom_header_ar ?? null },
      consultingAgencies: agencies.map((row) => ({ id: row.id, nameEn: row.name_en, nameAr: row.name_ar, isActive: true })),
      customDirectories,
      supervisors: supervisors.filter((supervisor) => supervisor.isActive),
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
    const rows=await this.db.getAllAsync<{id:string;purchase_number:string;confirmed_at:string;supplier_id:string|null;supplier_name:string;item_id:string|null;item_name:string;quantity_cubic_metres:number;unit_id:string|null;unit_symbol:string|null;delivery_method:'company'|'supplier';driver_name:string;truck_plate:string;supplier_ticket_number:string|null;notes:string|null;unit_price_usd_cents:number|null;subtotal_usd_cents:number|null;vat_amount_usd_cents:number|null;final_total_usd_cents:number|null}>(`SELECT id,purchase_number,confirmed_at,supplier_id,supplier_name,item_id,item_name,quantity_cubic_metres,unit_id,unit_symbol,delivery_method,driver_name,truck_plate,supplier_ticket_number,notes,unit_price_usd_cents,subtotal_usd_cents,vat_amount_usd_cents,final_total_usd_cents FROM quarry_purchases WHERE project_id=? AND status='Active' AND date(confirmed_at,'localtime')=? ORDER BY confirmed_at`,projectId,workDate);
    return rows.map(row=>({id:row.id,purchaseNumber:row.purchase_number,confirmedAt:row.confirmed_at,supplierId:row.supplier_id,supplierName:row.supplier_name,itemId:row.item_id,itemName:row.item_name,quantity:row.quantity_cubic_metres,unitId:row.unit_id,unitSymbol:row.unit_symbol??'m³',deliveryMethod:row.delivery_method??'company',deliveryLabel:(row.delivery_method??'company')==='supplier'?'Supplier Delivering':row.driver_name,truckPlate:row.truck_plate.trim()||null,supplierTicketNumber:row.supplier_ticket_number,notes:row.notes,unitPriceUsd:row.unit_price_usd_cents==null?null:row.unit_price_usd_cents/100,subtotalUsd:row.subtotal_usd_cents==null?null:row.subtotal_usd_cents/100,vatAmountUsd:row.vat_amount_usd_cents==null?null:row.vat_amount_usd_cents/100,finalTotalUsd:row.final_total_usd_cents==null?null:row.final_total_usd_cents/100}));
  }

  async listLinkedFuelFills(projectId:string,workDate:string):Promise<LinkedFuelFill[]> {
    const rows=await this.db.getAllAsync<{id:string;confirmed_at:string;equipment_name:string;fuel_type:FuelType;litres:number;price_per_litre_usd_cents:number|null;consumption_cost_usd_cents:number|null;odometer_reading:string|null;notes:string|null}>(`SELECT id,confirmed_at,equipment_name,fuel_type,litres,price_per_litre_usd_cents,consumption_cost_usd_cents,odometer_reading,notes FROM fuel_movements WHERE project_id=? AND movement_type='fill' AND status='Active' AND date(confirmed_at,'localtime')=? ORDER BY confirmed_at`,projectId,workDate);
    return rows.map(row=>({id:row.id,confirmedAt:row.confirmed_at,equipmentName:row.equipment_name??'Unknown equipment',fuelType:row.fuel_type,litres:row.litres,pricePerLitreUsd:row.price_per_litre_usd_cents==null?null:row.price_per_litre_usd_cents/100,consumptionCostUsd:row.consumption_cost_usd_cents==null?null:row.consumption_cost_usd_cents/100,odometerReading:row.odometer_reading,notes:row.notes}));
  }

  async listLinkedWallWork(projectId: string, workDate: string): Promise<LinkedWallWork[]> {
    const rows=await this.db.getAllAsync<WallConsumptionRow&{w_name:string;w_system:LinkedWallWork['system'];w_purpose:LinkedWallWork['purpose'];w_length_m:number;w_height_m:number;w_bottom_thickness_m:number;w_top_thickness_m:number;w_net_volume_m3:number;w_planned_volume_m3:number}>(`SELECT wc.*,w.name w_name,w.system w_system,w.purpose w_purpose,w.length_m w_length_m,w.height_m w_height_m,w.bottom_thickness_m w_bottom_thickness_m,w.top_thickness_m w_top_thickness_m,w.net_volume_m3 w_net_volume_m3,w.planned_volume_m3 w_planned_volume_m3
      FROM wall_consumptions wc JOIN walls w ON w.id=wc.wall_id JOIN projects p ON p.id=w.project_id
      WHERE w.project_id=? AND wc.used_on=? AND p.is_archived=0 ORDER BY w.name COLLATE NOCASE,w.id,wc.created_at`,projectId,workDate);
    // DEC-464. A wall linked to a foundation that had any event on this date, even with no wall
    // material recorded yet -- the report still shows the foundation's honest progress that day.
    const foundationWalls=await this.db.getAllAsync<{wall_id:string}>(`SELECT w.id wall_id FROM walls w JOIN foundations f ON f.id=w.foundation_id JOIN projects p ON p.id=w.project_id
      WHERE w.project_id=? AND p.is_archived=0 AND (date(f.created_at)=? OR f.constructed_on=? OR f.curing_started_on=? OR f.cured_on=? OR f.consumption_date=?)`,projectId,workDate,workDate,workDate,workDate,workDate);
    const walls=new SqliteWallRepository(this.db);
    const lifts=new SqliteConstructionLiftRepository(this.db);
    const groups=new Map<string,LinkedWallWork>();
    for(const row of rows){
      const group=groups.get(row.wall_id)??{wallId:row.wall_id,wallName:row.w_name,system:row.w_system,purpose:row.w_purpose,lengthM:row.w_length_m,heightM:row.w_height_m,bottomThicknessM:row.w_bottom_thickness_m,topThicknessM:row.w_top_thickness_m,netVolumeM3:row.w_net_volume_m3,plannedVolumeM3:row.w_planned_volume_m3,layers:await walls.listLayers(row.wall_id),entries:[],foundation:null,constructionSectionName:null,foundationEvents:[],foundationStatusAsOf:null,foundationComposition:null,foundationLifts:null,wallLifts:null,foundationLegacyStage:null};
      group.entries.push(wallConsumptionFromRow(row));groups.set(row.wall_id,group);
    }
    for(const row of foundationWalls){
      if(groups.has(row.wall_id))continue;
      const wall=await this.db.getFirstAsync<{id:string;name:string;system:LinkedWallWork['system'];purpose:LinkedWallWork['purpose'];length_m:number;height_m:number;bottom_thickness_m:number;top_thickness_m:number;net_volume_m3:number;planned_volume_m3:number}>('SELECT id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,net_volume_m3,planned_volume_m3 FROM walls WHERE id=?',row.wall_id);
      if(!wall)continue;
      groups.set(row.wall_id,{wallId:wall.id,wallName:wall.name,system:wall.system,purpose:wall.purpose,lengthM:wall.length_m,heightM:wall.height_m,bottomThicknessM:wall.bottom_thickness_m,topThicknessM:wall.top_thickness_m,netVolumeM3:wall.net_volume_m3,plannedVolumeM3:wall.planned_volume_m3,layers:[],entries:[],foundation:null,constructionSectionName:null,foundationEvents:[],foundationStatusAsOf:null,foundationComposition:null,foundationLifts:null,wallLifts:null,foundationLegacyStage:null});
    }
    // DEC-467. A wall whose only activity that day was a Lift still belongs in the report,
    // the same way a foundation's own construction or curing date already brings it in.
    for(const row of await this.db.getAllAsync<{wall_id:string}>(`SELECT DISTINCT w.id wall_id FROM walls w JOIN projects p ON p.id=w.project_id
      LEFT JOIN construction_lifts cw ON cw.wall_id=w.id LEFT JOIN construction_lifts cf ON cf.foundation_id=w.foundation_id
      WHERE w.project_id=? AND p.is_archived=0 AND (cw.id IS NOT NULL OR cf.id IS NOT NULL)`,projectId)){
      if(groups.has(row.wall_id))continue;
      const wall=await this.db.getFirstAsync<{id:string;name:string;system:LinkedWallWork['system'];purpose:LinkedWallWork['purpose'];length_m:number;height_m:number;bottom_thickness_m:number;top_thickness_m:number;net_volume_m3:number;planned_volume_m3:number;foundation_id:string|null}>('SELECT id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,net_volume_m3,planned_volume_m3,foundation_id FROM walls WHERE id=?',row.wall_id);
      if(!wall)continue;
      const candidates=[...await lifts.listLiftsForWall(wall.id),...(wall.foundation_id?await lifts.listLiftsForFoundation(wall.foundation_id):[])];
      if(!candidates.some(lift=>liftHasActivityOn(lift,workDate)))continue;
      groups.set(wall.id,{wallId:wall.id,wallName:wall.name,system:wall.system,purpose:wall.purpose,lengthM:wall.length_m,heightM:wall.height_m,bottomThicknessM:wall.bottom_thickness_m,topThicknessM:wall.top_thickness_m,netVolumeM3:wall.net_volume_m3,plannedVolumeM3:wall.planned_volume_m3,layers:[],entries:[],foundation:null,constructionSectionName:null,foundationEvents:[],foundationStatusAsOf:null,foundationComposition:null,foundationLifts:null,wallLifts:null,foundationLegacyStage:null});
    }
    const linked=[...groups.values()].sort((first,second)=>first.wallName.localeCompare(second.wallName));
    for(const group of linked){
      const wallRow=await this.db.getFirstAsync<{foundation_id:string|null}>('SELECT foundation_id FROM walls WHERE id=?',group.wallId);
      const foundation=wallRow?.foundation_id?await walls.getFoundation(wallRow.foundation_id):null;
      group.foundation=foundation;
      group.foundationEvents=foundation?foundationEventsOn(foundation,workDate):[];
      group.foundationStatusAsOf=foundation?foundationStatusOn(foundation,workDate):null;
      group.foundationComposition=foundation?await walls.getFoundationComposition(foundation.id):null;
      if(foundation){
        const section=await this.db.getFirstAsync<{name:string}>('SELECT name FROM construction_sections WHERE id=?',foundation.constructionSectionId);
        group.constructionSectionName=section?.name??null;
      }
      // DEC-467. Both lift groups are projected to this work date, so a Stone placement or concrete
      // pour recorded later never appears in an earlier report.
      group.wallLifts=buildLiftReportGroup({parentType:'wall',parentId:group.wallId,parentReference:group.wallName,
        parentNetVolumeM3:group.netVolumeM3,lifts:await lifts.listLiftsForWall(group.wallId),asOf:workDate});
      group.foundationLifts=foundation?buildLiftReportGroup({parentType:'foundation',parentId:foundation.id,parentReference:foundation.reference,
        parentNetVolumeM3:foundation.netVolumeM3,lifts:await lifts.listLiftsForFoundation(foundation.id),asOf:workDate}):null;
      group.foundationLegacyStage=foundation?await lifts.getLegacyCompositeStage(foundation.id):null;
      // A report dated before any wall work shows the foundation only: no layers, no wall consumption.
      if(!group.entries.length)group.layers=[];
    }
    return linked;
  }

  /** DEC-464. Foundations with an event on this date that have no wall linked to them yet. */
  async listLinkedFoundationActivity(projectId: string, workDate: string): Promise<LinkedFoundationActivity[]> {
    // DEC-467. A foundation with no wall belongs in the report either because of its own lifecycle
    // dates or because one of its Lifts did something that day.
    const rows=await this.db.getAllAsync<{id:string}>(`SELECT DISTINCT f.id FROM foundations f JOIN projects p ON p.id=f.project_id
      LEFT JOIN construction_lifts c ON c.foundation_id=f.id
      WHERE f.project_id=? AND p.is_archived=0 AND f.id NOT IN (SELECT foundation_id FROM walls WHERE foundation_id IS NOT NULL)
      AND (date(f.created_at)=? OR f.constructed_on=? OR f.curing_started_on=? OR f.cured_on=? OR f.consumption_date=? OR c.id IS NOT NULL)`,projectId,workDate,workDate,workDate,workDate,workDate);
    const walls=new SqliteWallRepository(this.db);
    const lifts=new SqliteConstructionLiftRepository(this.db);
    const activity:LinkedFoundationActivity[]=[];
    for(const row of rows){
      const foundation=await walls.getFoundation(row.id);if(!foundation)continue;
      const foundationLifts=await lifts.listLiftsForFoundation(foundation.id);
      const lifecycleEvents=foundationEventsOn(foundation,workDate);
      if(!lifecycleEvents.length&&!foundationLifts.some(lift=>liftHasActivityOn(lift,workDate)))continue;
      const section=await this.db.getFirstAsync<{name:string}>('SELECT name FROM construction_sections WHERE id=?',foundation.constructionSectionId);
      activity.push({foundation,constructionSectionName:section?.name??'',foundationEvents:lifecycleEvents,foundationStatusAsOf:foundationStatusOn(foundation,workDate),composition:await walls.getFoundationComposition(foundation.id),
        lifts:buildLiftReportGroup({parentType:'foundation',parentId:foundation.id,parentReference:foundation.reference,parentNetVolumeM3:foundation.netVolumeM3,lifts:foundationLifts,asOf:workDate}),
        legacyStage:await lifts.getLegacyCompositeStage(foundation.id)});
    }
    return activity.sort((first,second)=>first.foundation.reference.localeCompare(second.foundation.reference));
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
        ...(draft.operators??[]).map(operator=>(draft.workerSafety??[]).find(value=>value.workerName===operator&&value.participantType==='operator')??{workerName:operator,participantType:'operator' as const,status:'not_checked' as const,missingItems:[],notes:''}),
      ];
      await this.db.runAsync(`INSERT INTO daily_project_reports (id, project_id, work_date, work_description, workers_json, safety_json, drivers_json, truck_plates_json, machines_json, materials_json, photos_json, notes, problems_delays_incidents, weather_site_conditions, work_start_time, work_end_time, break_minutes, next_work_planned, consultant_signoff_enabled, consultant_name, consultant_signature_json, show_ministry_header, show_consulting_agency, show_custom_header, consulting_agency_id, consulting_agency_name_en, consulting_agency_name_ar, operators_json, custom_resources_json, supervisor_signoffs_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET work_date=excluded.work_date, work_description=excluded.work_description, workers_json=excluded.workers_json, safety_json=excluded.safety_json, drivers_json=excluded.drivers_json, truck_plates_json=excluded.truck_plates_json, machines_json=excluded.machines_json, materials_json=excluded.materials_json, photos_json=excluded.photos_json, notes=excluded.notes, problems_delays_incidents=excluded.problems_delays_incidents, weather_site_conditions=excluded.weather_site_conditions, work_start_time=excluded.work_start_time, work_end_time=excluded.work_end_time, break_minutes=excluded.break_minutes, next_work_planned=excluded.next_work_planned, consultant_signoff_enabled=excluded.consultant_signoff_enabled, consultant_name=excluded.consultant_name, consultant_signature_json=excluded.consultant_signature_json, show_ministry_header=excluded.show_ministry_header, show_consulting_agency=excluded.show_consulting_agency, show_custom_header=excluded.show_custom_header, consulting_agency_id=excluded.consulting_agency_id, consulting_agency_name_en=excluded.consulting_agency_name_en, consulting_agency_name_ar=excluded.consulting_agency_name_ar, operators_json=excluded.operators_json, custom_resources_json=excluded.custom_resources_json, supervisor_signoffs_json=excluded.supervisor_signoffs_json, updated_at=excluded.updated_at`,
        id, draft.projectId, draft.workDate, draft.workDescription.trim(), JSON.stringify(draft.workers),JSON.stringify(safety), JSON.stringify(draft.drivers), JSON.stringify(draft.truckPlates), JSON.stringify(draft.machines), JSON.stringify(draft.materials), JSON.stringify(draft.photos), clean(draft.notes), clean(draft.problemsDelaysIncidents), clean(draft.weatherSiteConditions), clean(draft.workStartTime), clean(draft.workEndTime), draft.breakMinutes ? Number(draft.breakMinutes) : null, clean(draft.nextWorkPlanned), draft.consultantSignoffEnabled?1:0, clean(draft.consultantName), JSON.stringify(draft.consultantSignaturePaths), draft.showMinistryHeader?1:0, draft.showConsultingAgency?1:0, draft.showCustomHeader?1:0, draft.consultingAgencyId, draft.consultingAgencyNameEn, draft.consultingAgencyNameAr, JSON.stringify(draft.operators ?? []), JSON.stringify(normalizeCustomResourceSnapshots(draft.customResources ?? [])), JSON.stringify(normalizeSupervisorSignoffs(draft.supervisorSignoffs ?? [])), existing?.createdAt ?? now, now);
      // DEC-479. The queued copy names who signed off but never carries their signature strokes.
      const payload = { ...draft, supervisorSignoffs: normalizeSupervisorSignoffs(draft.supervisorSignoffs ?? []).map(({ signature: _signature, ...signoff }) => signoff), id, updatedAt: now };
      await this.db.runAsync(`INSERT INTO sync_outbox (entity_type, entity_id, operation, payload_json, created_at) VALUES ('dailyProjectReport', ?, 'upsert', ?, ?)`, id, JSON.stringify(payload), now);
    });
    const saved = await this.db.getFirstAsync<ReportRow>('SELECT * FROM daily_project_reports WHERE id = ?', id);
    if (!saved) throw new Error('Daily report was not saved.'); return fromRow(saved);
  }

}
