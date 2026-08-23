import type {Wall,WallConsumption,WallConsumptionDraft,WallDetail,WallDraft,WallSetup} from '../../domain/walls';

export interface WallRepository{
  getSetup():Promise<WallSetup>;
  listWalls(projectId?:string|null):Promise<Wall[]>;
  getWall(id:string):Promise<WallDetail>;
  saveWall(draft:WallDraft,id?:string):Promise<Wall>;
  addConsumption(draft:WallConsumptionDraft):Promise<WallConsumption>;
}
