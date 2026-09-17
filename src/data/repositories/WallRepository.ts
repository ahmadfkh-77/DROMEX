import type {BaseStatusChange,WallBase,WallBaseCorrectionDraft,WallBaseDraft} from '../../domain/wallBase';
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
  /** DEC-459. The wall section's base, or null when none is recorded (always so for a legacy wall). */
  getBase(wallId:string):Promise<WallBase|null>;
  /** Creates or replaces the base's geometry and material. The lifecycle is changed separately. */
  saveBase(draft:WallBaseDraft):Promise<WallBase>;
  /** Moves the base one explicit step along planned to constructed to curing to cured. */
  changeBaseStatus(wallId:string,change:BaseStatusChange):Promise<WallBase>;
  /** Reasoned correction of the base's geometry, material, and quantity, with a before/after audit. */
  correctBase(wallId:string,draft:WallBaseCorrectionDraft):Promise<WallBase>;
  /** Reasoned correction of the curing dates; refused when it would strand existing wall work. */
  correctBaseCuring(wallId:string,change:{constructedOn?:string;curingStartedOn?:string;curedOn?:string;reason:string}):Promise<WallBase>;

  /** DEC-461. The base's composite composition (Stone core + estimated concrete), or null with no base. */
  getFoundationComposition(wallId:string):Promise<FoundationComposition|null>;
  /** Switches the base between a single recorded material and the composite Stone-core model. */
  setFoundationMode(wallId:string,mode:FoundationCompositionMode,stoneCoreMode?:StoneCoreMode):Promise<FoundationComposition>;
  /** Simple mode only. Moves the schematic Stone-core block; never changes its recorded volume. */
  saveStoneCorePosition(wallId:string,position:StoneCorePosition):Promise<FoundationComposition>;
  /** Detailed mode only. Refused when the core would extend outside the outer foundation. */
  saveStoneCoreOffsets(wallId:string,offsets:StoneCoreOffsets):Promise<FoundationComposition>;
  /** Refused for Stone when the active total would exceed the foundation's net volume. */
  addFoundationCompositionRecord(draft:FoundationCompositionRecordDraft):Promise<FoundationCompositionRecord>;
  cancelFoundationCompositionRecord(recordId:string,reason:string):Promise<FoundationCompositionRecord>;
  correctFoundationCompositionRecord(recordId:string,draft:FoundationCompositionCorrectionDraft):Promise<FoundationCompositionRecord>;
}
