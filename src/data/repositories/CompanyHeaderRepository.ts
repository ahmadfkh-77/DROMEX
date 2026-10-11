import type {
  HeaderCompany,
  HeaderCompanyKind,
  PlantHeaderExtras,
  PlantHeaderExtrasDraft,
  ProjectCompanyDraft,
  ProjectCompanyProfile,
} from '../../domain/companyHeaders';
import type { LoadNameStatus, LoadNameUpdateInput, LoadNameUpdateRecord } from '../../domain/loadCompanyName';

/**
 * Phase 1. The two PDF header companies. The Plant Company is the existing Company profile; this
 * repository only adds its registration number and default signer, and owns the Project Company link.
 * No method here writes to customers, payments or projects (except a project's remembered header). The one write to loads is
 * `updateLoadCompanyName`: an explicit, confirmed update of the company name (and optionally details) saved on them.
 */
export interface CompanyHeaderRepository {
  getPlantExtras(): Promise<PlantHeaderExtras>;
  savePlantExtras(draft: PlantHeaderExtrasDraft): Promise<PlantHeaderExtras>;
  getProjectCompany(): Promise<ProjectCompanyProfile | null>;
  saveProjectCompany(draft: ProjectCompanyDraft): Promise<ProjectCompanyProfile>;
  /** Removes only the header details and the link. The customer and every record stay untouched. */
  removeProjectCompany(): Promise<void>;
  /** A project with no stored choice reads as the Plant Company. */
  getProjectHeaderDefault(projectId: string): Promise<HeaderCompanyKind>;
  /** `null` clears the choice, so the project falls back to the Plant Company. */
  setProjectHeaderDefault(projectId: string, kind: HeaderCompanyKind | null): Promise<void>;
  /** The header to print for `kind`; the Plant Company when the Project Company is not set up. */
  resolveHeader(kind: HeaderCompanyKind): Promise<HeaderCompany>;
  /** The name on my loads: how many carry another name than the current Plant Company. Read-only. */
  getLoadNameStatus(includeDetails: boolean): Promise<LoadNameStatus>;
  /** The one explicit update of the name (and optionally the details) saved on my loads, with an audit row per old name. All or nothing. */
  updateLoadCompanyName(input: LoadNameUpdateInput): Promise<{ updated: number; records: LoadNameUpdateRecord[] }>;
  listLoadNameUpdates(): Promise<LoadNameUpdateRecord[]>;
}
