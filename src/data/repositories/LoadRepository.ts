import type {
  ConfirmedLoad, ConversionDraft, ConversionOption, DriverDraft, DriverProfile, LoadCorrectionDraft, LoadDraft, LoadSetupOptions,
  MachineDraft, MachineProfile, MeasurementUnit, Project, ProjectDraft, TruckDraft, TruckProfile, UnitDraft, WorkerDraft, WorkerProfile,
} from '../../domain/loads';

export type DirectoryProfiles = {
  workers: WorkerProfile[];
  drivers: DriverProfile[];
  trucks: TruckProfile[];
  machines: MachineProfile[];
};

export interface LoadRepository {
  getSetupOptions(): Promise<LoadSetupOptions>;
  createUnit(draft: UnitDraft): Promise<MeasurementUnit>;
  createConversion(draft: ConversionDraft): Promise<ConversionOption>;
  createProject(draft: ProjectDraft): Promise<Project>;
  listProjects(): Promise<Project[]>;
  updateProjectStatus(projectId: string, status: Project['status']): Promise<void>;
  createDriver(draft: DriverDraft): Promise<DriverProfile>;
  createTruck(draft: TruckDraft): Promise<TruckProfile>;
  createWorker(draft: WorkerDraft): Promise<WorkerProfile>;
  createMachine(draft: MachineDraft): Promise<MachineProfile>;
  getDirectoryProfiles(): Promise<DirectoryProfiles>;
  setWorkerActive(id: string, isActive: boolean): Promise<void>;
  setDriverActive(id: string, isActive: boolean): Promise<void>;
  setTruckActive(id: string, isActive: boolean): Promise<void>;
  setMachineActive(id: string, isActive: boolean): Promise<void>;
  getDraft(): Promise<LoadDraft | null>;
  saveDraft(draft: LoadDraft): Promise<void>;
  clearDraft(): Promise<void>;
  confirmLoad(draft: LoadDraft): Promise<ConfirmedLoad>;
  listLoads(): Promise<ConfirmedLoad[]>;
  saveLoadSignature(loadId: string, signaturePaths: string[]): Promise<ConfirmedLoad>;
  correctLoad(loadId: string, draft: LoadCorrectionDraft): Promise<ConfirmedLoad>;
}
