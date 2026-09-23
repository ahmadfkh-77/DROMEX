import type {
  ConfirmedLoad, ConversionDraft, ConversionOption, LoadCorrectionDraft, LoadDraft, LoadSetupOptions,
  MachineDraft, MachineProfile, MeasurementUnit, Project, ProjectDraft, ProjectInformationDraft, TruckDraft, TruckProfile, UnitDraft,
} from '../../domain/loads';
import type { PersonDraft, PersonProfile } from '../../domain/people';
import type { ConsultingAgencyOption } from '../../domain/profiles';

export type DirectoryProfiles = {
  /** DEC-476. Every person, active and inactive, whatever their role. */
  people: PersonProfile[];
  trucks: TruckProfile[];
  machines: MachineProfile[];
};

export interface LoadRepository {
  getSetupOptions(): Promise<LoadSetupOptions>;
  createUnit(draft: UnitDraft): Promise<MeasurementUnit>;
  createConversion(draft: ConversionDraft): Promise<ConversionOption>;
  listMeasurementUnits(): Promise<MeasurementUnit[]>;
  updateUnit(id:string,draft:UnitDraft):Promise<MeasurementUnit>;
  removeUnit(id:string):Promise<'deleted'|'deactivated'>;
  setUnitActive(id:string,isActive:boolean):Promise<void>;
  listConversionOptions():Promise<ConversionOption[]>;
  updateConversion(id:string,draft:ConversionDraft):Promise<ConversionOption>;
  removeConversion(id:string):Promise<'deleted'|'deactivated'>;
  setConversionActive(id:string,isActive:boolean):Promise<void>;
  createProject(draft: ProjectDraft): Promise<Project>;
  listProjects(): Promise<Project[]>;
  updateProjectStatus(projectId: string, status: Project['status']): Promise<void>;
  updateProjectStartDate(projectId: string, startDate: string): Promise<Project>;
  /** DEC-404, extended by DEC-417 for the optional agency field. Never the customer, dates, status, or any record. */
  updateProjectInformation(projectId: string, draft: ProjectInformationDraft): Promise<Project>;
  /** DEC-417. Read-only: every active agency, plus the calling project's own current agency even
   * if it has since been deactivated, resolved via resolveConsultingAgencySelectorOptions. */
  listConsultingAgencyOptions(currentAgencyId?: string | null): Promise<ConsultingAgencyOption[]>;
  /**
   * DEC-476. One People directory. A duplicate normalized name is refused in any role; a role change
   * edits the same record and appends to its role history; people are deactivated, never deleted.
   */
  listPeople(): Promise<PersonProfile[]>;
  createPerson(draft: PersonDraft): Promise<PersonProfile>;
  updatePerson(id: string, draft: PersonDraft): Promise<PersonProfile>;
  setPersonActive(id: string, isActive: boolean): Promise<void>;
  createTruck(draft: TruckDraft): Promise<TruckProfile>;
  updateTruck(id:string,draft:TruckDraft):Promise<TruckProfile>;
  createMachine(draft: MachineDraft): Promise<MachineProfile>;
  updateMachine(id:string,draft:MachineDraft):Promise<MachineProfile>;
  getDirectoryProfiles(): Promise<DirectoryProfiles>;
  setTruckActive(id: string, isActive: boolean): Promise<void>;
  setMachineActive(id: string, isActive: boolean): Promise<void>;
  getDraft(): Promise<LoadDraft | null>;
  saveDraft(draft: LoadDraft): Promise<void>;
  clearDraft(): Promise<void>;
  confirmLoad(draft: LoadDraft): Promise<ConfirmedLoad>;
  listLoads(): Promise<ConfirmedLoad[]>;
  saveLoadSignature(loadId: string, signaturePaths: string[]): Promise<ConfirmedLoad>;
  correctLoad(loadId: string, draft: LoadCorrectionDraft): Promise<ConfirmedLoad>;
  cancelLoad(loadId: string, reason: string): Promise<ConfirmedLoad>;
}
