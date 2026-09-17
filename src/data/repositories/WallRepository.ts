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
}
