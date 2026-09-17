import type {BaseStatusChange,WallBase,WallBaseCorrectionDraft,WallBaseDraft} from '../../domain/wallBase';
import type {WallLayer,WallLayerDraft} from '../../domain/wallDiagram';
import type {SavedConcretePurpose,Wall,WallConsumption,WallConsumptionCorrectionDraft,WallConsumptionDraft,WallDetail,WallDraft,WallSetup} from '../../domain/walls';

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
}
