import type {ConstructionSection,ConstructionSectionDraft} from '../../domain/constructionSections';
import type {Foundation,FoundationCorrectionDraft,FoundationDraft,FoundationStatusChange} from '../../domain/foundations';
import type {WallLayer,WallLayerDraft} from '../../domain/wallDiagram';
import type {SavedConcretePurpose,Wall,WallConsumption,WallConsumptionCorrectionDraft,WallConsumptionDraft,WallDetail,WallDraft,WallSetup} from '../../domain/walls';
import type {FoundationComposition,FoundationCompositionCorrectionDraft,FoundationCompositionMode,FoundationCompositionRecord,FoundationCompositionRecordDraft,StoneCoreMode,StoneCoreOffsets,StoneCorePosition} from '../../domain/wallFoundation';

export interface WallRepository{
  getSetup():Promise<WallSetup>;
  listWalls(projectId?:string|null):Promise<Wall[]>;
  getWall(id:string):Promise<WallDetail>;
  saveWall(draft:WallDraft,id?:string):Promise<Wall>;
  addConsumption(draft:WallConsumptionDraft):Promise<WallConsumption>;
  /** DEC-452. Corrects one record in place with a mandatory reason; its wall never changes. */
  correctConsumption(id:string,draft:WallConsumptionCorrectionDraft):Promise<WallConsumption>;
  /** DEC-451. Saved Concrete/Mortar purposes, oldest first. Built-in purposes are not listed here. */
  listConcretePurposes():Promise<SavedConcretePurpose[]>;
  createConcretePurpose(label:string):Promise<SavedConcretePurpose>;
  /** DEC-457. Wall layers in construction-phase order; empty for a wall with no layers recorded. */
  listLayers(wallId:string):Promise<WallLayer[]>;
  /** Replaces the wall's whole layer set, after validating it against the wall's own thickness. */
  saveLayers(wallId:string,layers:WallLayerDraft[]):Promise<WallLayer[]>;

  // DEC-464. Project -> Construction Section -> Foundation -> Wall.
  /** Construction Sections in a project, oldest first. */
  listConstructionSections(projectId:string):Promise<ConstructionSection[]>;
  createConstructionSection(draft:ConstructionSectionDraft):Promise<ConstructionSection>;
  /** Renames/redescribes a section; never touches its foundations' or walls' own links. */
  renameConstructionSection(id:string,patch:{name:string;location:string;description:string}):Promise<ConstructionSection>;

  /** Foundations in a project, optionally scoped to one Construction Section, newest first. */
  listFoundations(projectId:string,constructionSectionId?:string|null):Promise<Foundation[]>;
  getFoundation(id:string):Promise<Foundation|null>;
  /** Creates a Foundation independently of any wall -- Checkpoint 2's core rule. */
  createFoundation(draft:FoundationDraft):Promise<Foundation>;
  /** Moves the foundation one explicit step along planned to constructed to curing to cured. */
  changeFoundationStatus(id:string,change:FoundationStatusChange):Promise<Foundation>;
  /** Reasoned correction of the foundation's geometry, material, and quantity, with a before/after audit. */
  correctFoundation(id:string,draft:FoundationCorrectionDraft):Promise<Foundation>;
  /** Reasoned correction of the curing dates; DEC-463 -- never blocks or invalidates wall work. */
  correctFoundationCuring(id:string,change:{constructedOn?:string;curingStartedOn?:string;curedOn?:string;reason:string}):Promise<Foundation>;
  /** Permanently links an existing wall to a foundation. Refused if the foundation already has a wall, or belongs to another project. */
  linkWallToFoundation(wallId:string,foundationId:string):Promise<Wall>;

  /** DEC-461/464. The foundation's composite composition (Stone core + estimated concrete). */
  getFoundationComposition(foundationId:string):Promise<FoundationComposition|null>;
  /** Switches the foundation between a single recorded material and the composite Stone-core model. */
  setFoundationMode(foundationId:string,mode:FoundationCompositionMode,stoneCoreMode?:StoneCoreMode):Promise<FoundationComposition>;
  /** Simple mode only. Moves the schematic Stone-core block; never changes its recorded volume. */
  saveStoneCorePosition(foundationId:string,position:StoneCorePosition):Promise<FoundationComposition>;
  /** Detailed mode only. Refused when the core would extend outside the outer foundation. */
  saveStoneCoreOffsets(foundationId:string,offsets:StoneCoreOffsets):Promise<FoundationComposition>;
  /** Refused for Stone when the active total would exceed the foundation's net volume. */
  addFoundationCompositionRecord(draft:FoundationCompositionRecordDraft):Promise<FoundationCompositionRecord>;
  cancelFoundationCompositionRecord(recordId:string,reason:string):Promise<FoundationCompositionRecord>;
  correctFoundationCompositionRecord(recordId:string,draft:FoundationCompositionCorrectionDraft):Promise<FoundationCompositionRecord>;
}
