import type {
  HeaderCompany,
  HeaderCompanyKind,
  PlantHeaderExtras,
  PlantHeaderExtrasDraft,
  ProjectCompanyDraft,
  ProjectCompanyProfile,
} from '../../domain/companyHeaders';

/**
 * Phase 1. The two PDF header companies. The Plant Company is the existing Company profile; this
 * repository only adds its registration number and default signer, and owns the Project Company link.
 * No method here writes to customers, loads, payments or projects (except a project's remembered header).
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
}
