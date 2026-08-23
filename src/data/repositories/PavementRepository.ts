import type {PavementCalculation,PavementCalculationDraft,PavementSetup} from '../../domain/pavement';

export interface PavementRepository{
  getSetup():Promise<PavementSetup>;
  listCalculations(projectId?:string|null):Promise<PavementCalculation[]>;
  saveCalculation(draft:PavementCalculationDraft,id?:string):Promise<PavementCalculation>;
}
