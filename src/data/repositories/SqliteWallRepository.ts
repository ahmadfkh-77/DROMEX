import type {SQLiteDatabase} from 'expo-sqlite';
import type {Project} from '../../domain/loads';
import {calculateRebar,calculateWallVolume,diffWallConsumption,normalizePurposeLabel,purposeKey,validateNewPurposeLabel,validateWall,validateWallConsumption,wallAreaSnapshot,type SavedConcretePurpose,type Wall,type WallConsumption,type WallConsumptionCorrectionDraft,type WallConsumptionDraft,type WallCorrectionEntry,type WallDetail,type WallDraft,type WallSetup} from '../../domain/walls';
import type {WallRepository} from './WallRepository';

type WallRow={id:string;project_id:string;project_name:string;name:string;system:Wall['system'];purpose:Wall['purpose'];length_m:number;height_m:number;bottom_thickness_m:number;top_thickness_m:number;deduction_m3:number;allowance_percent:number;net_volume_m3:number;planned_volume_m3:number;notes:string|null;created_at:string;updated_at:string};
export type WallConsumptionRow={id:string;wall_id:string;used_on:string;material_type:WallConsumption['type'];concrete_purpose:WallConsumption['concretePurpose'];custom_purpose_id:string|null;custom_purpose_label:string|null;finished_volume_m3:number|null;cement_bags:number|null;cement_bag_kg:number|null;sand_quantity:number|null;sand_unit:WallConsumption['sandUnit'];gravel_quantity:number|null;gravel_unit:WallConsumption['gravelUnit'];water_litres:number|null;admixture_quantity:number|null;admixture_unit:WallConsumption['admixtureUnit'];stone_quantity:number|null;stone_unit:WallConsumption['stoneUnit'];rebar_diameter_mm:number|null;rebar_count:number|null;rebar_length_each_m:number|null;total_rebar_length_m:number|null;total_rebar_kg:number|null;rebar_grade:string|null;notes:string|null;area_length_m:number|null;area_height_m:number|null;area_deduction_m2:number|null;area_gross_m2:number|null;area_net_m2:number|null;correction_history_json:string|null;created_at:string;updated_at:string|null};
const id=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const wallSelect=`SELECT w.*,p.name project_name FROM walls w JOIN projects p ON p.id=w.project_id WHERE p.is_archived=0`;
const wall=(row:WallRow):Wall=>({id:row.id,projectId:row.project_id,projectName:row.project_name,name:row.name,system:row.system,purpose:row.purpose,lengthM:row.length_m,heightM:row.height_m,bottomThicknessM:row.bottom_thickness_m,topThicknessM:row.top_thickness_m,deductionM3:row.deduction_m3,allowancePercent:row.allowance_percent,netVolumeM3:row.net_volume_m3,plannedVolumeM3:row.planned_volume_m3,notes:row.notes??'',createdAt:row.created_at,updatedAt:row.updated_at});
const parseCorrections=(value:string|null):WallCorrectionEntry[]=>{try{const parsed=JSON.parse(value??'[]') as unknown;return Array.isArray(parsed)?parsed as WallCorrectionEntry[]:[];}catch{return[];}};
/** Shared with the Daily Report repository so both read a consumption row identically. */
export const wallConsumptionFromRow=(row:WallConsumptionRow):WallConsumption=>({id:row.id,wallId:row.wall_id,usedOn:row.used_on,type:row.material_type,concretePurpose:row.concrete_purpose,customPurposeId:row.custom_purpose_id??null,customPurposeLabel:row.custom_purpose_label??null,finishedVolumeM3:row.finished_volume_m3,cementBags:row.cement_bags,cementBagKg:row.cement_bag_kg,sandQuantity:row.sand_quantity,sandUnit:row.sand_unit,gravelQuantity:row.gravel_quantity,gravelUnit:row.gravel_unit,waterLitres:row.water_litres,admixtureQuantity:row.admixture_quantity,admixtureUnit:row.admixture_unit,stoneQuantity:row.stone_quantity,stoneUnit:row.stone_unit,rebarDiameterMm:row.rebar_diameter_mm,rebarCount:row.rebar_count,rebarLengthEachM:row.rebar_length_each_m,totalRebarLengthM:row.total_rebar_length_m,totalRebarKg:row.total_rebar_kg,rebarGrade:row.rebar_grade??'',notes:row.notes??'',area:row.area_net_m2==null?null:{lengthM:row.area_length_m!,heightM:row.area_height_m!,deductionM2:row.area_deduction_m2!,grossAreaM2:row.area_gross_m2!,netAreaM2:row.area_net_m2},correctionHistory:parseCorrections(row.correction_history_json),createdAt:row.created_at,updatedAt:row.updated_at??null});

export class SqliteWallRepository implements WallRepository{
  constructor(private readonly db:SQLiteDatabase){}
  async getSetup():Promise<WallSetup>{const rows=await this.db.getAllAsync<{id:string;customer_id:string;customer_name:string;name:string;location:string;status:Project['status'];notes:string|null}>(`SELECT p.id,p.customer_id,c.name customer_name,p.name,p.location,p.status,p.notes FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.is_archived=0 ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END,p.name COLLATE NOCASE`);return{projects:rows.map(row=>({id:row.id,customerId:row.customer_id,customerName:row.customer_name,name:row.name,location:row.location,status:row.status,notes:row.notes}))};}
  async listWalls(projectId?:string|null){const rows=projectId?await this.db.getAllAsync<WallRow>(`${wallSelect} AND w.project_id=? ORDER BY w.updated_at DESC`,projectId):await this.db.getAllAsync<WallRow>(`${wallSelect} ORDER BY w.updated_at DESC`);return rows.map(wall);}
  async getWall(wallId:string):Promise<WallDetail>{const found=await this.db.getFirstAsync<WallRow>(`${wallSelect} AND w.id=?`,wallId);if(!found)throw new Error('Wall was not found.');const entries=await this.db.getAllAsync<WallConsumptionRow>(`SELECT * FROM wall_consumptions WHERE wall_id=? ORDER BY used_on DESC,created_at DESC`,wallId);return{wall:wall(found),entries:entries.map(wallConsumptionFromRow)};}
  async saveWall(draft:WallDraft,wallId?:string){const setup=await this.getSetup(),issue=validateWall(draft,setup.projects)[0];if(issue)throw new Error(issue);const result=calculateWallVolume(draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,draft.allowancePercent),now=new Date().toISOString(),recordId=wallId??id('wall'),notes=draft.notes.trim()||null;await this.db.withTransactionAsync(async()=>{if(wallId){const changed=await this.db.runAsync(`UPDATE walls SET project_id=?,name=?,system=?,purpose=?,length_m=?,height_m=?,bottom_thickness_m=?,top_thickness_m=?,deduction_m3=?,allowance_percent=?,net_volume_m3=?,planned_volume_m3=?,notes=?,updated_at=? WHERE id=?`,draft.projectId,draft.name.trim(),draft.system,draft.purpose,draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,draft.allowancePercent,result.netVolumeM3,result.plannedVolumeM3,notes,now,recordId);if(!changed.changes)throw new Error('Wall was not found.');}else await this.db.runAsync(`INSERT INTO walls (id,project_id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,allowance_percent,net_volume_m3,planned_volume_m3,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,recordId,draft.projectId,draft.name.trim(),draft.system,draft.purpose,draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,draft.allowancePercent,result.netVolumeM3,result.plannedVolumeM3,notes,now,now);await this.enqueue('wall',recordId,{id:recordId,...draft,...result,updatedAt:now},now);});const found=await this.db.getFirstAsync<WallRow>(`${wallSelect} AND w.id=?`,recordId);if(!found)throw new Error('Wall was not found after saving.');return wall(found);}

  async listConcretePurposes():Promise<SavedConcretePurpose[]>{
    const rows=await this.db.getAllAsync<{id:string;label:string;created_at:string}>('SELECT id,label,created_at FROM wall_concrete_purposes ORDER BY created_at,label COLLATE NOCASE');
    return rows.map(row=>({id:row.id,label:row.label,createdAt:row.created_at}));
  }
  async createConcretePurpose(label:string):Promise<SavedConcretePurpose>{
    const issue=validateNewPurposeLabel(label,await this.listConcretePurposes())[0];if(issue)throw new Error(issue);
    const purpose:SavedConcretePurpose={id:id('wall_purpose'),label:normalizePurposeLabel(label),createdAt:new Date().toISOString()};
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO wall_concrete_purposes (id,label,label_key,created_at) VALUES (?,?,?,?)',purpose.id,purpose.label,purposeKey(purpose.label),purpose.createdAt);
      await this.enqueue('wallConcretePurpose',purpose.id,purpose,purpose.createdAt);
    });
    return purpose;
  }

  async addConsumption(draft:WallConsumptionDraft){
    const recordId=id('wall_use'),now=new Date().toISOString(),stored=await this.prepare(draft,{id:recordId,createdAt:now,updatedAt:null,correctionHistory:[]});
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,concrete_purpose,custom_purpose_id,custom_purpose_label,finished_volume_m3,cement_bags,cement_bag_kg,sand_quantity,sand_unit,gravel_quantity,gravel_unit,water_litres,admixture_quantity,admixture_unit,stone_quantity,stone_unit,rebar_diameter_mm,rebar_count,rebar_length_each_m,total_rebar_length_m,total_rebar_kg,rebar_grade,notes,area_length_m,area_height_m,area_deduction_m2,area_gross_m2,area_net_m2,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,recordId,...this.values(stored),now);
      await this.db.runAsync(`UPDATE walls SET updated_at=? WHERE id=?`,now,draft.wallId);
      await this.enqueue('wallConsumption',recordId,stored,now);
    });
    return this.readConsumption(recordId);
  }

  async correctConsumption(consumptionId:string,draft:WallConsumptionCorrectionDraft){
    const row=await this.db.getFirstAsync<WallConsumptionRow>('SELECT * FROM wall_consumptions WHERE id=?',consumptionId);
    if(!row)throw new Error('The wall consumption record was not found.');
    if(draft.wallId!==row.wall_id)throw new Error('A correction cannot move a record to another wall.');
    const before=wallConsumptionFromRow(row),reason=draft.correctionReason.trim();
    if(!reason)throw new Error('A correction reason is required.');
    const after=await this.prepare(draft,{id:before.id,createdAt:before.createdAt,updatedAt:before.updatedAt,correctionHistory:before.correctionHistory},before);
    const changes=diffWallConsumption(before,after);
    if(!changes.length)throw new Error('Nothing changed. Edit at least one value before saving a correction.');
    const now=new Date().toISOString(),history=[...before.correctionHistory,{correctedAt:now,correctedBy:'Owner',reason,changes}];
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`UPDATE wall_consumptions SET wall_id=?,used_on=?,material_type=?,concrete_purpose=?,custom_purpose_id=?,custom_purpose_label=?,finished_volume_m3=?,cement_bags=?,cement_bag_kg=?,sand_quantity=?,sand_unit=?,gravel_quantity=?,gravel_unit=?,water_litres=?,admixture_quantity=?,admixture_unit=?,stone_quantity=?,stone_unit=?,rebar_diameter_mm=?,rebar_count=?,rebar_length_each_m=?,total_rebar_length_m=?,total_rebar_kg=?,rebar_grade=?,notes=?,area_length_m=?,area_height_m=?,area_deduction_m2=?,area_gross_m2=?,area_net_m2=?,correction_history_json=?,updated_at=? WHERE id=?`,...this.values(after),JSON.stringify(history),now,consumptionId);
      await this.db.runAsync(`UPDATE walls SET updated_at=? WHERE id=?`,now,row.wall_id);
      await this.enqueue('wallConsumption',consumptionId,{...after,correctionHistory:history,updatedAt:now},now);
    });
    return this.readConsumption(consumptionId);
  }

  /** Validates a draft and resolves everything the row stores: purpose label snapshot, area snapshot, and rebar totals. */
  private async prepare(draft:WallConsumptionDraft,identity:Pick<WallConsumption,'id'|'createdAt'|'updatedAt'|'correctionHistory'>,existing?:WallConsumption):Promise<WallConsumption>{
    const issue=validateWallConsumption(draft)[0];if(issue)throw new Error(issue);
    const exists=await this.db.getFirstAsync<{id:string}>(`SELECT id FROM walls WHERE id=?`,draft.wallId);if(!exists)throw new Error('Wall was not found.');
    const customPurposeId=draft.customPurposeId??null;let customPurposeLabel:string|null=null;
    if(customPurposeId){
      // A record that keeps its saved purpose keeps its own label snapshot.
      if(existing?.customPurposeId===customPurposeId)customPurposeLabel=existing.customPurposeLabel;
      else{const purpose=await this.db.getFirstAsync<{label:string}>('SELECT label FROM wall_concrete_purposes WHERE id=?',customPurposeId);if(!purpose)throw new Error('The selected purpose was not found.');customPurposeLabel=purpose.label;}
    }
    const rebar=draft.type==='rebar'?calculateRebar(draft.rebarDiameterMm!,draft.rebarCount!,draft.rebarLengthEachM!):null;
    return{...draft,...identity,customPurposeId,customPurposeLabel,area:draft.area?wallAreaSnapshot(draft.area):null,rebarGrade:draft.rebarGrade.trim(),notes:draft.notes.trim(),totalRebarLengthM:rebar?.totalLengthM??null,totalRebarKg:rebar?.totalKg??null};
  }
  private values(entry:WallConsumption){
    return [entry.wallId,entry.usedOn,entry.type,entry.concretePurpose,entry.customPurposeId,entry.customPurposeLabel,entry.finishedVolumeM3,entry.cementBags,entry.cementBagKg,entry.sandQuantity,entry.sandUnit,entry.gravelQuantity,entry.gravelUnit,entry.waterLitres,entry.admixtureQuantity,entry.admixtureUnit,entry.stoneQuantity,entry.stoneUnit,entry.rebarDiameterMm,entry.rebarCount,entry.rebarLengthEachM,entry.totalRebarLengthM,entry.totalRebarKg,entry.rebarGrade||null,entry.notes||null,entry.area?.lengthM??null,entry.area?.heightM??null,entry.area?.deductionM2??null,entry.area?.grossAreaM2??null,entry.area?.netAreaM2??null] as const;
  }
  private async readConsumption(recordId:string){const found=await this.db.getFirstAsync<WallConsumptionRow>(`SELECT * FROM wall_consumptions WHERE id=?`,recordId);if(!found)throw new Error('Wall consumption was not found after saving.');return wallConsumptionFromRow(found);}
  private async enqueue(entity:string,entityId:string,payload:unknown,now:string){await this.db.runAsync(`INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)`,entity,entityId,'upsert',JSON.stringify(payload),now);}
}
