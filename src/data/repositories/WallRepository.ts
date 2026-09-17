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
}
