import type {SQLiteDatabase} from 'expo-sqlite';
import type {Project} from '../../domain/loads';
import {normalizeSectionName,sectionNameKey,validateConstructionSectionDraft,type ConstructionSection,type ConstructionSectionDraft} from '../../domain/constructionSections';
import {calculateFoundationVolume,diffFoundation,validateFoundationDraft,validateFoundationLifecycle,validateFoundationStatusChange,type Foundation,type FoundationCorrectionDraft,type FoundationDraft,type FoundationStatusChange} from '../../domain/foundations';
import {calculateRebar,calculateWallVolume,diffWallConsumption,normalizePurposeLabel,purposeKey,validateNewPurposeLabel,validateWall,validateWallConsumption,wallVolumeSnapshot,type SavedConcretePurpose,type Wall,type WallConsumption,type WallConsumptionCorrectionDraft,type WallConsumptionDraft,type WallCorrectionEntry,type WallDetail,type WallDraft,type WallSetup} from '../../domain/walls';
import {describeWallStageLock,validateWallWorkDate,type CuringLifecycle} from '../../domain/wallBase';
import {sortedLayers,validateWallLayers,type WallLayer,type WallLayerDraft} from '../../domain/wallDiagram';
import {aggregateActiveQuantity,buildFoundationComposition,defaultStoneCorePosition,validateCompositionRecordDraft,validateFoundationVolumeAgainstStone,validateStoneCapacity,validateStoneCoreOffsets,type FoundationComposition,type FoundationCompositionCorrectionDraft,type FoundationCompositionMode,type FoundationCompositionRecord,type FoundationCompositionRecordDraft,type StoneCoreMode,type StoneCoreOffsets,type StoneCorePosition} from '../../domain/wallFoundation';
import type {WallRepository} from './WallRepository';

type LayerRow={id:string;wall_id:string;phase_order:number;name:string;material_key:string|null;bottom_thickness_m:number;top_thickness_m:number;note:string|null;created_at:string;updated_at:string|null};
type SectionRow={id:string;project_id:string;name:string;name_key:string;location:string|null;description:string|null;created_at:string;updated_at:string|null};
type FoundationRow={id:string;project_id:string;construction_section_id:string;legacy_wall_id:string|null;reference:string;location:string|null;length_m:number;height_m:number;bottom_thickness_m:number;top_thickness_m:number;deduction_m3:number;gross_volume_m3:number;net_volume_m3:number;material_type:Foundation['materialType'];concrete_purpose:Foundation['concretePurpose'];custom_purpose_id:string|null;custom_purpose_label:string|null;quantity:number;quantity_unit:Foundation['quantityUnit'];manual_override:number;consumption_date:string|null;status:Foundation['status'];constructed_on:string|null;curing_started_on:string|null;cured_on:string|null;curing_note:string|null;notes:string|null;correction_history_json:string|null;created_at:string;updated_at:string|null;foundation_mode:FoundationCompositionMode;stone_core_mode:StoneCoreMode|null;stone_core_position_x:number|null;stone_core_position_y:number|null;stone_core_offsets_json:string|null};
type CompositionRow={id:string;foundation_id:string;material_type:FoundationCompositionRecord['materialType'];quantity_m3:number;recorded_on:string;notes:string|null;cancelled_at:string|null;cancelled_reason:string|null;correction_history_json:string|null;created_at:string;updated_at:string|null};
type WallRow={id:string;project_id:string;project_name:string;base_required?:number;foundation_id:string|null;name:string;system:Wall['system'];purpose:Wall['purpose'];length_m:number;height_m:number;bottom_thickness_m:number;top_thickness_m:number;deduction_m3:number;allowance_percent:number;net_volume_m3:number;planned_volume_m3:number;notes:string|null;created_at:string;updated_at:string};
export type WallConsumptionRow={id:string;wall_id:string;used_on:string;material_type:WallConsumption['type'];concrete_purpose:WallConsumption['concretePurpose'];custom_purpose_id:string|null;custom_purpose_label:string|null;finished_volume_m3:number|null;cement_bags:number|null;cement_bag_kg:number|null;sand_quantity:number|null;sand_unit:WallConsumption['sandUnit'];gravel_quantity:number|null;gravel_unit:WallConsumption['gravelUnit'];water_litres:number|null;admixture_quantity:number|null;admixture_unit:WallConsumption['admixtureUnit'];stone_quantity:number|null;stone_unit:WallConsumption['stoneUnit'];rebar_diameter_mm:number|null;rebar_count:number|null;rebar_length_each_m:number|null;total_rebar_length_m:number|null;total_rebar_kg:number|null;rebar_grade:string|null;notes:string|null;volume_length_m:number|null;volume_height_m:number|null;volume_bottom_thickness_m:number|null;volume_top_thickness_m:number|null;volume_deduction_m3:number|null;volume_gross_m3:number|null;volume_net_m3:number|null;correction_history_json:string|null;created_at:string;updated_at:string|null};
const id=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const wallSelect=`SELECT w.*,p.name project_name FROM walls w JOIN projects p ON p.id=w.project_id WHERE p.is_archived=0`;
const wall=(row:WallRow):Wall=>({id:row.id,projectId:row.project_id,projectName:row.project_name,name:row.name,system:row.system,purpose:row.purpose,lengthM:row.length_m,heightM:row.height_m,bottomThicknessM:row.bottom_thickness_m,topThicknessM:row.top_thickness_m,deductionM3:row.deduction_m3,allowancePercent:row.allowance_percent,netVolumeM3:row.net_volume_m3,plannedVolumeM3:row.planned_volume_m3,notes:row.notes??'',baseRequired:row.base_required===1,foundationId:row.foundation_id,createdAt:row.created_at,updatedAt:row.updated_at});
const layerFromRow=(row:LayerRow):WallLayer=>({id:row.id,wallId:row.wall_id,phaseOrder:row.phase_order,name:row.name,materialKey:row.material_key,bottomThicknessM:row.bottom_thickness_m,topThicknessM:row.top_thickness_m,note:row.note??'',createdAt:row.created_at,updatedAt:row.updated_at});
const sectionFromRow=(row:SectionRow):ConstructionSection=>({id:row.id,projectId:row.project_id,name:row.name,location:row.location??'',description:row.description??'',createdAt:row.created_at,updatedAt:row.updated_at});
const foundationFromRow=(row:FoundationRow):Foundation=>({id:row.id,projectId:row.project_id,constructionSectionId:row.construction_section_id,legacyWallId:row.legacy_wall_id,reference:row.reference,location:row.location??'',lengthM:row.length_m,heightM:row.height_m,bottomThicknessM:row.bottom_thickness_m,topThicknessM:row.top_thickness_m,deductionM3:row.deduction_m3,grossVolumeM3:row.gross_volume_m3,netVolumeM3:row.net_volume_m3,materialType:row.material_type,concretePurpose:row.concrete_purpose,customPurposeId:row.custom_purpose_id,customPurposeLabel:row.custom_purpose_label,quantity:row.quantity,quantityUnit:row.quantity_unit,manualOverride:row.manual_override===1,consumptionDate:row.consumption_date,status:row.status,constructedOn:row.constructed_on,curingStartedOn:row.curing_started_on,curedOn:row.cured_on,curingNote:row.curing_note??'',notes:row.notes??'',correctionHistory:parseCorrections(row.correction_history_json),createdAt:row.created_at,updatedAt:row.updated_at});
const foundationFields=(foundation:Foundation)=>diffFieldsOf(foundation);
function diffFieldsOf(foundation:Foundation):[string,string|null][]{
  return[['Foundation reference',foundation.reference],['Foundation location',foundation.location.trim()||null],['Foundation length (m)',String(foundation.lengthM)],['Foundation height (m)',String(foundation.heightM)],['Foundation bottom thickness (m)',String(foundation.bottomThicknessM)],['Foundation top thickness (m)',String(foundation.topThicknessM)],['Foundation deductions (m³)',String(foundation.deductionM3)],['Calculated gross volume (m³)',String(foundation.grossVolumeM3)],['Calculated net volume (m³)',String(foundation.netVolumeM3)],['Foundation material',foundation.materialType],['Foundation purpose',foundation.customPurposeLabel??foundation.concretePurpose??null],['Recorded quantity',`${foundation.quantity} ${foundation.quantityUnit==='tonnes'?'t':'m³'}`],['Manual override',foundation.manualOverride?'Yes':'No'],['Consumption date',foundation.consumptionDate],['Construction date',foundation.constructedOn],['Curing started',foundation.curingStartedOn],['Cured date',foundation.curedOn],['Curing note',foundation.curingNote.trim()||null],['Foundation notes',foundation.notes.trim()||null]];
}
const parseCorrections=(value:string|null):WallCorrectionEntry[]=>{try{const parsed=JSON.parse(value??'[]') as unknown;return Array.isArray(parsed)?parsed as WallCorrectionEntry[]:[];}catch{return[];}};
const compositionRecordFromRow=(row:CompositionRow):FoundationCompositionRecord=>({id:row.id,foundationId:row.foundation_id,materialType:row.material_type,quantityM3:row.quantity_m3,recordedOn:row.recorded_on,notes:row.notes??'',cancelledAt:row.cancelled_at,cancelledReason:row.cancelled_reason,correctionHistory:parseCorrections(row.correction_history_json),createdAt:row.created_at,updatedAt:row.updated_at});
const parseOffsets=(value:string|null|undefined):StoneCoreOffsets|null=>{if(!value)return null;try{return JSON.parse(value) as StoneCoreOffsets;}catch{return null;}};
/** Shared with the Daily Report repository so both read a consumption row identically. */
export const wallConsumptionFromRow=(row:WallConsumptionRow):WallConsumption=>({id:row.id,wallId:row.wall_id,usedOn:row.used_on,type:row.material_type,concretePurpose:row.concrete_purpose,customPurposeId:row.custom_purpose_id??null,customPurposeLabel:row.custom_purpose_label??null,finishedVolumeM3:row.finished_volume_m3,cementBags:row.cement_bags,cementBagKg:row.cement_bag_kg,sandQuantity:row.sand_quantity,sandUnit:row.sand_unit,gravelQuantity:row.gravel_quantity,gravelUnit:row.gravel_unit,waterLitres:row.water_litres,admixtureQuantity:row.admixture_quantity,admixtureUnit:row.admixture_unit,stoneQuantity:row.stone_quantity,stoneUnit:row.stone_unit,rebarDiameterMm:row.rebar_diameter_mm,rebarCount:row.rebar_count,rebarLengthEachM:row.rebar_length_each_m,totalRebarLengthM:row.total_rebar_length_m,totalRebarKg:row.total_rebar_kg,rebarGrade:row.rebar_grade??'',notes:row.notes??'',volume:row.volume_net_m3==null?null:{lengthM:row.volume_length_m!,heightM:row.volume_height_m!,bottomThicknessM:row.volume_bottom_thickness_m!,topThicknessM:row.volume_top_thickness_m!,deductionM3:row.volume_deduction_m3!,grossVolumeM3:row.volume_gross_m3!,netVolumeM3:row.volume_net_m3},correctionHistory:parseCorrections(row.correction_history_json),createdAt:row.created_at,updatedAt:row.updated_at??null});

export class SqliteWallRepository implements WallRepository{
  constructor(private readonly db:SQLiteDatabase){}
  async getSetup():Promise<WallSetup>{const rows=await this.db.getAllAsync<{id:string;customer_id:string;customer_name:string;name:string;location:string;status:Project['status'];notes:string|null}>(`SELECT p.id,p.customer_id,c.name customer_name,p.name,p.location,p.status,p.notes FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.is_archived=0 ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END,p.name COLLATE NOCASE`);return{projects:rows.map(row=>({id:row.id,customerId:row.customer_id,customerName:row.customer_name,name:row.name,location:row.location,status:row.status,notes:row.notes}))};}
  async listWalls(projectId?:string|null){const rows=projectId?await this.db.getAllAsync<WallRow>(`${wallSelect} AND w.project_id=? ORDER BY w.updated_at DESC`,projectId):await this.db.getAllAsync<WallRow>(`${wallSelect} ORDER BY w.updated_at DESC`);return rows.map(wall);}
  async getWall(wallId:string):Promise<WallDetail>{
    const found=await this.db.getFirstAsync<WallRow>(`${wallSelect} AND w.id=?`,wallId);if(!found)throw new Error('Wall was not found.');
    const entries=await this.db.getAllAsync<WallConsumptionRow>(`SELECT * FROM wall_consumptions WHERE wall_id=? ORDER BY used_on DESC,created_at DESC`,wallId);
    const detail=wall(found);
    const foundation=detail.foundationId?await this.getFoundation(detail.foundationId):null;
    return{wall:detail,entries:entries.map(wallConsumptionFromRow),layers:await this.listLayers(wallId),foundation,stage:describeWallStageLock(foundation,!detail.baseRequired)};
  }
  async saveWall(draft:WallDraft,wallId?:string){
    const setup=await this.getSetup(),issue=validateWall(draft,setup.projects)[0];if(issue)throw new Error(issue);
    if(wallId){const existing=await this.listLayers(wallId);const layerIssue=validateWallLayers(existing,draft)[0];if(layerIssue)throw new Error(layerIssue);}
    let foundationId:string|null=null;
    if(!wallId&&draft.foundationId){
      const foundation=await this.getFoundation(draft.foundationId);
      if(!foundation)throw new Error('The selected foundation was not found.');
      if(foundation.projectId!==draft.projectId)throw new Error('The selected foundation belongs to a different project.');
      const linked=await this.db.getFirstAsync<{id:string}>('SELECT id FROM walls WHERE foundation_id=?',foundation.id);
      if(linked)throw new Error('This foundation already has a wall linked to it. Choose a different foundation, or open the existing wall.');
      foundationId=foundation.id;
    }
    const result=calculateWallVolume(draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,draft.allowancePercent),now=new Date().toISOString(),recordId=wallId??id('wall'),notes=draft.notes.trim()||null;
    await this.db.withTransactionAsync(async()=>{
      if(wallId){
        const changed=await this.db.runAsync(`UPDATE walls SET project_id=?,name=?,system=?,purpose=?,length_m=?,height_m=?,bottom_thickness_m=?,top_thickness_m=?,deduction_m3=?,allowance_percent=?,net_volume_m3=?,planned_volume_m3=?,notes=?,updated_at=? WHERE id=?`,draft.projectId,draft.name.trim(),draft.system,draft.purpose,draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,draft.allowancePercent,result.netVolumeM3,result.plannedVolumeM3,notes,now,recordId);
        if(!changed.changes)throw new Error('Wall was not found.');
      }else{
        try{
          await this.db.runAsync(`INSERT INTO walls (id,project_id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,allowance_percent,net_volume_m3,planned_volume_m3,notes,base_required,foundation_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,recordId,draft.projectId,draft.name.trim(),draft.system,draft.purpose,draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,draft.allowancePercent,result.netVolumeM3,result.plannedVolumeM3,notes,foundationId,now,now);
        }catch(cause){
          if(cause instanceof Error&&/walls.foundation_id/.test(cause.message))throw new Error('This foundation already has a wall linked to it. Choose a different foundation, or open the existing wall.');
          throw cause;
        }
      }
      await this.enqueue('wall',recordId,{id:recordId,...draft,foundationId,...result,updatedAt:now},now);
    });
    const found=await this.db.getFirstAsync<WallRow>(`${wallSelect} AND w.id=?`,recordId);if(!found)throw new Error('Wall was not found after saving.');return wall(found);
  }

  async linkWallToFoundation(wallId:string,foundationId:string):Promise<Wall>{
    const found=await this.db.getFirstAsync<WallRow>(`${wallSelect} AND w.id=?`,wallId);if(!found)throw new Error('Wall was not found.');
    const target=await this.getFoundation(foundationId);if(!target)throw new Error('The selected foundation was not found.');
    if(target.projectId!==found.project_id)throw new Error('The selected foundation belongs to a different project.');
    if(found.foundation_id)throw new Error('This wall is already linked to a foundation.');
    const now=new Date().toISOString();
    try{
      await this.db.withTransactionAsync(async()=>{
        await this.db.runAsync('UPDATE walls SET foundation_id=?,updated_at=? WHERE id=?',foundationId,now,wallId);
        await this.enqueue('wallFoundationLink',wallId,{wallId,foundationId,updatedAt:now},now);
      });
    }catch(cause){
      if(cause instanceof Error&&/walls.foundation_id/.test(cause.message))throw new Error('This foundation already has a wall linked to it. Choose a different foundation.');
      throw cause;
    }
    const relinked=await this.db.getFirstAsync<WallRow>(`${wallSelect} AND w.id=?`,wallId);
    return wall(relinked!);
  }

  async listLayers(wallId:string):Promise<WallLayer[]>{
    const rows=await this.db.getAllAsync<LayerRow>('SELECT * FROM wall_layers WHERE wall_id=? ORDER BY phase_order',wallId);
    return rows.map(layerFromRow);
  }
  async saveLayers(wallId:string,layers:WallLayerDraft[]):Promise<WallLayer[]>{
    if(layers.length)await this.assertWallLinked(wallId);
    const found=await this.db.getFirstAsync<{bottom_thickness_m:number;top_thickness_m:number}>('SELECT bottom_thickness_m,top_thickness_m FROM walls WHERE id=?',wallId);
    if(!found)throw new Error('Wall was not found.');
    const issue=validateWallLayers(layers,{bottomThicknessM:found.bottom_thickness_m,topThicknessM:found.top_thickness_m})[0];
    if(issue)throw new Error(issue);
    const now=new Date().toISOString(),ordered=sortedLayers(layers);
    await this.db.withTransactionAsync(async()=>{
      // The set is replaced as a whole, so reordering and removal are one atomic, revalidated change.
      await this.db.runAsync('DELETE FROM wall_layers WHERE wall_id=?',wallId);
      for(const layer of ordered)await this.db.runAsync('INSERT INTO wall_layers (id,wall_id,phase_order,name,material_key,bottom_thickness_m,top_thickness_m,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id('wall_layer'),wallId,layer.phaseOrder,layer.name.trim(),layer.materialKey??null,layer.bottomThicknessM,layer.topThicknessM,layer.note.trim()||null,now,now);
      await this.db.runAsync('UPDATE walls SET updated_at=? WHERE id=?',now,wallId);
      await this.enqueue('wallLayers',wallId,{wallId,layers:ordered,updatedAt:now},now);
    });
    return this.listLayers(wallId);
  }

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
    await this.assertWallLinked(draft.wallId);
    const recordId=id('wall_use'),now=new Date().toISOString(),stored=await this.prepare(draft,{id:recordId,createdAt:now,updatedAt:null,correctionHistory:[]});
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`INSERT INTO wall_consumptions (id,wall_id,used_on,material_type,concrete_purpose,custom_purpose_id,custom_purpose_label,finished_volume_m3,cement_bags,cement_bag_kg,sand_quantity,sand_unit,gravel_quantity,gravel_unit,water_litres,admixture_quantity,admixture_unit,stone_quantity,stone_unit,rebar_diameter_mm,rebar_count,rebar_length_each_m,total_rebar_length_m,total_rebar_kg,rebar_grade,notes,volume_length_m,volume_height_m,volume_bottom_thickness_m,volume_top_thickness_m,volume_deduction_m3,volume_gross_m3,volume_net_m3,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,recordId,...this.values(stored),now);
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
      await this.db.runAsync(`UPDATE wall_consumptions SET wall_id=?,used_on=?,material_type=?,concrete_purpose=?,custom_purpose_id=?,custom_purpose_label=?,finished_volume_m3=?,cement_bags=?,cement_bag_kg=?,sand_quantity=?,sand_unit=?,gravel_quantity=?,gravel_unit=?,water_litres=?,admixture_quantity=?,admixture_unit=?,stone_quantity=?,stone_unit=?,rebar_diameter_mm=?,rebar_count=?,rebar_length_each_m=?,total_rebar_length_m=?,total_rebar_kg=?,rebar_grade=?,notes=?,volume_length_m=?,volume_height_m=?,volume_bottom_thickness_m=?,volume_top_thickness_m=?,volume_deduction_m3=?,volume_gross_m3=?,volume_net_m3=?,area_length_m=NULL,area_height_m=NULL,area_deduction_m2=NULL,area_gross_m2=NULL,area_net_m2=NULL,correction_history_json=?,updated_at=? WHERE id=?`,...this.values(after),JSON.stringify(history),now,consumptionId);
      await this.db.runAsync(`UPDATE walls SET updated_at=? WHERE id=?`,now,row.wall_id);
      await this.enqueue('wallConsumption',consumptionId,{...after,correctionHistory:history,updatedAt:now},now);
    });
    return this.readConsumption(consumptionId);
  }

  /** Validates a draft and resolves everything the row stores: purpose label snapshot, volume calculation snapshot, and rebar totals. */
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
    return{...draft,...identity,customPurposeId,customPurposeLabel,volume:draft.volume?wallVolumeSnapshot(draft.volume):null,rebarGrade:draft.rebarGrade.trim(),notes:draft.notes.trim(),totalRebarLengthM:rebar?.totalLengthM??null,totalRebarKg:rebar?.totalKg??null};
  }
  private values(entry:WallConsumption){
    return [entry.wallId,entry.usedOn,entry.type,entry.concretePurpose,entry.customPurposeId,entry.customPurposeLabel,entry.finishedVolumeM3,entry.cementBags,entry.cementBagKg,entry.sandQuantity,entry.sandUnit,entry.gravelQuantity,entry.gravelUnit,entry.waterLitres,entry.admixtureQuantity,entry.admixtureUnit,entry.stoneQuantity,entry.stoneUnit,entry.rebarDiameterMm,entry.rebarCount,entry.rebarLengthEachM,entry.totalRebarLengthM,entry.totalRebarKg,entry.rebarGrade||null,entry.notes||null,entry.volume?.lengthM??null,entry.volume?.heightM??null,entry.volume?.bottomThicknessM??null,entry.volume?.topThicknessM??null,entry.volume?.deductionM3??null,entry.volume?.grossVolumeM3??null,entry.volume?.netVolumeM3??null] as const;
  }
  /** DEC-463/464. Wall work is refused only when this wall requires a foundation and none is linked yet; curing status never blocks it. */
  private async assertWallLinked(wallId:string){
    const row=await this.db.getFirstAsync<{base_required:number;foundation_id:string|null}>('SELECT base_required,foundation_id FROM walls WHERE id=?',wallId);
    if(!row)throw new Error('Wall was not found.');
    if(row.base_required!==1)return;
    const foundation=row.foundation_id?await this.getFoundation(row.foundation_id):null;
    const issue=validateWallWorkDate(foundation as CuringLifecycle|null,false);
    if(issue)throw new Error(issue);
  }

  private async readConsumption(recordId:string){const found=await this.db.getFirstAsync<WallConsumptionRow>(`SELECT * FROM wall_consumptions WHERE id=?`,recordId);if(!found)throw new Error('Wall consumption was not found after saving.');return wallConsumptionFromRow(found);}
  private async enqueue(entity:string,entityId:string,payload:unknown,now:string){await this.db.runAsync(`INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)`,entity,entityId,'upsert',JSON.stringify(payload),now);}

  // DEC-464. Project -> Construction Section -> Foundation -> Wall.
  async listConstructionSections(projectId:string):Promise<ConstructionSection[]>{
    const rows=await this.db.getAllAsync<SectionRow>('SELECT * FROM construction_sections WHERE project_id=? ORDER BY created_at',projectId);
    return rows.map(sectionFromRow);
  }
  async createConstructionSection(draft:ConstructionSectionDraft):Promise<ConstructionSection>{
    const existing=await this.listConstructionSections(draft.projectId);
    const issue=validateConstructionSectionDraft(draft,existing)[0];if(issue)throw new Error(issue);
    const exists=await this.db.getFirstAsync<{id:string}>('SELECT id FROM projects WHERE id=?',draft.projectId);if(!exists)throw new Error('Project was not found.');
    const now=new Date().toISOString(),recordId=id('section'),name=normalizeSectionName(draft.name);
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO construction_sections (id,project_id,name,name_key,location,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',recordId,draft.projectId,name,sectionNameKey(name),draft.location.trim()||null,draft.description.trim()||null,now,now);
      await this.enqueue('constructionSection',recordId,{id:recordId,...draft,name,updatedAt:now},now);
    });
    const found=await this.db.getFirstAsync<SectionRow>('SELECT * FROM construction_sections WHERE id=?',recordId);
    return sectionFromRow(found!);
  }
  async renameConstructionSection(sectionId:string,patch:{name:string;location:string;description:string}):Promise<ConstructionSection>{
    const found=await this.db.getFirstAsync<SectionRow>('SELECT * FROM construction_sections WHERE id=?',sectionId);
    if(!found)throw new Error('Construction Section was not found.');
    const others=(await this.listConstructionSections(found.project_id)).filter(section=>section.id!==sectionId);
    const issue=validateConstructionSectionDraft({projectId:found.project_id,name:patch.name,location:patch.location,description:patch.description},others)[0];
    if(issue)throw new Error(issue);
    const now=new Date().toISOString(),name=normalizeSectionName(patch.name);
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE construction_sections SET name=?,name_key=?,location=?,description=?,updated_at=? WHERE id=?',name,sectionNameKey(name),patch.location.trim()||null,patch.description.trim()||null,now,sectionId);
      await this.enqueue('constructionSection',sectionId,{id:sectionId,name,location:patch.location,description:patch.description,updatedAt:now},now);
    });
    const updated=await this.db.getFirstAsync<SectionRow>('SELECT * FROM construction_sections WHERE id=?',sectionId);
    return sectionFromRow(updated!);
  }

  async listFoundations(projectId:string,constructionSectionId?:string|null):Promise<Foundation[]>{
    const rows=constructionSectionId
      ?await this.db.getAllAsync<FoundationRow>('SELECT * FROM foundations WHERE project_id=? AND construction_section_id=? ORDER BY created_at DESC',projectId,constructionSectionId)
      :await this.db.getAllAsync<FoundationRow>('SELECT * FROM foundations WHERE project_id=? ORDER BY created_at DESC',projectId);
    return rows.map(foundationFromRow);
  }
  async getFoundation(foundationId:string):Promise<Foundation|null>{
    const row=await this.db.getFirstAsync<FoundationRow>('SELECT * FROM foundations WHERE id=?',foundationId);
    return row?foundationFromRow(row):null;
  }
  private async requireFoundationRow(foundationId:string):Promise<FoundationRow>{
    const row=await this.db.getFirstAsync<FoundationRow>('SELECT * FROM foundations WHERE id=?',foundationId);
    if(!row)throw new Error('Foundation was not found.');
    return row;
  }
  private async requireFoundation(foundationId:string):Promise<Foundation>{return foundationFromRow(await this.requireFoundationRow(foundationId));}

  /** DEC-464. A Foundation is created independently -- before any wall ever exists for it. */
  async createFoundation(draft:FoundationDraft):Promise<Foundation>{
    const issue=validateFoundationDraft(draft)[0];if(issue)throw new Error(issue);
    const project=await this.db.getFirstAsync<{id:string}>('SELECT id FROM projects WHERE id=?',draft.projectId);if(!project)throw new Error('Project was not found.');
    const section=await this.db.getFirstAsync<{id:string;project_id:string}>('SELECT id,project_id FROM construction_sections WHERE id=?',draft.constructionSectionId);
    if(!section)throw new Error('Construction Section was not found.');
    if(section.project_id!==draft.projectId)throw new Error('The selected Construction Section belongs to a different project.');
    const volume=calculateFoundationVolume(draft),now=new Date().toISOString(),recordId=id('foundation');
    const purposeLabel=await this.purposeLabel(draft.customPurposeId,null);
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`INSERT INTO foundations (id,project_id,construction_section_id,legacy_wall_id,reference,location,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,concrete_purpose,custom_purpose_id,custom_purpose_label,quantity,quantity_unit,manual_override,consumption_date,status,notes,created_at,updated_at) VALUES (?,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned',?,?,?)`,
        recordId,draft.projectId,draft.constructionSectionId,draft.reference.trim(),draft.location.trim()||null,draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,volume.grossVolumeM3,volume.netVolumeM3,draft.materialType,draft.concretePurpose,draft.customPurposeId,purposeLabel,draft.quantity,draft.quantityUnit,draft.manualOverride?1:0,draft.consumptionDate,draft.notes.trim()||null,now,now);
      await this.enqueue('foundation',recordId,{...draft,...volume,id:recordId,updatedAt:now},now);
    });
    return this.requireFoundation(recordId);
  }

  async changeFoundationStatus(foundationId:string,change:FoundationStatusChange):Promise<Foundation>{
    const foundation=await this.requireFoundation(foundationId);
    const issue=validateFoundationStatusChange(foundation,change)[0];if(issue)throw new Error(issue);
    const now=new Date().toISOString();
    const next={constructedOn:change.constructedOn??foundation.constructedOn,curingStartedOn:change.status==='curing'?change.curingStartedOn??foundation.curingStartedOn:foundation.curingStartedOn,curedOn:change.status==='cured'?change.curedOn??foundation.curedOn:change.status==='curing'?null:foundation.curedOn};
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE foundations SET status=?,constructed_on=?,curing_started_on=?,cured_on=?,curing_note=COALESCE(?,curing_note),updated_at=? WHERE id=?',change.status,next.constructedOn,next.curingStartedOn,next.curedOn,change.curingNote?.trim()||null,now,foundationId);
      await this.enqueue('foundation',foundationId,{id:foundationId,status:change.status,...next,updatedAt:now},now);
    });
    return this.requireFoundation(foundationId);
  }

  async correctFoundation(foundationId:string,draft:FoundationCorrectionDraft):Promise<Foundation>{
    const before=await this.requireFoundation(foundationId),reason=draft.correctionReason.trim();
    if(!reason)throw new Error('A correction reason is required.');
    const issue=validateFoundationDraft(draft)[0];if(issue)throw new Error(issue);
    const volume=calculateFoundationVolume(draft);
    // DEC-461. A geometry correction can never silently strand Stone already recorded against this foundation.
    const capacityIssue=validateFoundationVolumeAgainstStone(volume.netVolumeM3,await this.activeStoneVolume(before.id))[0];
    if(capacityIssue)throw new Error(capacityIssue);
    const purposeLabel=await this.purposeLabel(draft.customPurposeId,before.customPurposeId===draft.customPurposeId?before.customPurposeLabel:null);
    const after:Foundation={...before,...draft,...volume,customPurposeLabel:purposeLabel};
    const next=new Map(foundationFields(after));
    const changes=foundationFields(before).flatMap(([field,originalValue])=>{const newValue=next.get(field)??null;return originalValue===newValue?[]:[{field,originalValue,newValue}];});
    if(!changes.length)throw new Error('Nothing changed. Edit at least one value before saving a correction.');
    const now=new Date().toISOString(),history=[...before.correctionHistory,{correctedAt:now,correctedBy:'Owner',reason,changes}];
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE foundations SET reference=?,location=?,length_m=?,height_m=?,bottom_thickness_m=?,top_thickness_m=?,deduction_m3=?,gross_volume_m3=?,net_volume_m3=?,material_type=?,concrete_purpose=?,custom_purpose_id=?,custom_purpose_label=?,quantity=?,quantity_unit=?,manual_override=?,consumption_date=?,notes=?,correction_history_json=?,updated_at=? WHERE id=?',
        after.reference.trim(),after.location.trim()||null,after.lengthM,after.heightM,after.bottomThicknessM,after.topThicknessM,after.deductionM3,after.grossVolumeM3,after.netVolumeM3,after.materialType,after.concretePurpose,after.customPurposeId,after.customPurposeLabel,after.quantity,after.quantityUnit,after.manualOverride?1:0,after.consumptionDate,after.notes.trim()||null,JSON.stringify(history),now,before.id);
      await this.enqueue('foundation',before.id,{...after,correctionHistory:history,updatedAt:now},now);
    });
    return this.requireFoundation(foundationId);
  }

  async correctFoundationCuring(foundationId:string,change:{constructedOn?:string;curingStartedOn?:string;curedOn?:string;reason:string}):Promise<Foundation>{
    const before=await this.requireFoundation(foundationId),reason=change.reason.trim();
    if(!reason)throw new Error('A correction reason is required.');
    const after={...before,constructedOn:change.constructedOn??before.constructedOn,curingStartedOn:change.curingStartedOn??before.curingStartedOn,curedOn:change.curedOn??before.curedOn};
    const issue=validateFoundationLifecycle(after)[0];if(issue)throw new Error(issue);
    // DEC-463. Curing chronology is informational: a cured-date correction never invalidates, blocks, or removes wall work already recorded, however it is dated.
    const fields:[string,string|null][]=[['Construction date',before.constructedOn],['Curing started',before.curingStartedOn],['Cured date',before.curedOn]];
    const nextValues=new Map<string,string|null>([['Construction date',after.constructedOn],['Curing started',after.curingStartedOn],['Cured date',after.curedOn]]);
    const changes=fields.flatMap(([field,originalValue])=>{const newValue=nextValues.get(field)??null;return originalValue===newValue?[]:[{field,originalValue,newValue}];});
    if(!changes.length)throw new Error('Nothing changed. Edit at least one date before saving a correction.');
    const now=new Date().toISOString(),history=[...before.correctionHistory,{correctedAt:now,correctedBy:'Owner',reason,changes}];
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE foundations SET constructed_on=?,curing_started_on=?,cured_on=?,correction_history_json=?,updated_at=? WHERE id=?',after.constructedOn,after.curingStartedOn,after.curedOn,JSON.stringify(history),now,before.id);
      await this.enqueue('foundation',before.id,{...after,correctionHistory:history,updatedAt:now},now);
    });
    return this.requireFoundation(foundationId);
  }

  private async purposeLabel(customPurposeId:string|null,known:string|null){
    if(!customPurposeId)return null;
    if(known)return known;
    const purpose=await this.db.getFirstAsync<{label:string}>('SELECT label FROM wall_concrete_purposes WHERE id=?',customPurposeId);
    if(!purpose)throw new Error('The selected purpose was not found.');
    return purpose.label;
  }

  // DEC-461/464. The composite foundation model: an optional Stone core inside the foundation's outer
  // volume, with the concrete that fills the rest estimated rather than assumed poured until Ready
  // Mix is itself recorded. Additive on top of the foundation's existing single-material field above.
  private async compositionRecords(foundationId:string):Promise<FoundationCompositionRecord[]>{
    const rows=await this.db.getAllAsync<CompositionRow>('SELECT * FROM foundation_composition_records WHERE foundation_id=? ORDER BY recorded_on,created_at',foundationId);
    return rows.map(compositionRecordFromRow);
  }
  private async activeStoneVolume(foundationId:string):Promise<number>{return aggregateActiveQuantity(await this.compositionRecords(foundationId),'stone');}
  private async compositionFor(row:FoundationRow):Promise<FoundationComposition>{
    const foundation=foundationFromRow(row);
    return buildFoundationComposition({
      foundationId:row.id,mode:row.foundation_mode??'single',stoneCoreMode:row.stone_core_mode??null,
      position:row.stone_core_position_x!=null&&row.stone_core_position_y!=null?{xNorm:row.stone_core_position_x,yNorm:row.stone_core_position_y}:null,
      offsets:parseOffsets(row.stone_core_offsets_json),netFoundationVolumeM3:foundation.netVolumeM3,records:await this.compositionRecords(row.id),
    });
  }

  async getFoundationComposition(foundationId:string):Promise<FoundationComposition|null>{
    const row=await this.db.getFirstAsync<FoundationRow>('SELECT * FROM foundations WHERE id=?',foundationId);
    return row?this.compositionFor(row):null;
  }

  async setFoundationMode(foundationId:string,mode:FoundationCompositionMode,stoneCoreMode?:StoneCoreMode):Promise<FoundationComposition>{
    const row=await this.requireFoundationRow(foundationId);
    const nextStoneCoreMode=mode==='composite'?stoneCoreMode??row.stone_core_mode??'simple':row.stone_core_mode??null;
    const hasPosition=row.stone_core_position_x!=null&&row.stone_core_position_y!=null;
    const position=mode==='composite'&&nextStoneCoreMode==='simple'&&!hasPosition?defaultStoneCorePosition():null;
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      if(position)await this.db.runAsync('UPDATE foundations SET foundation_mode=?,stone_core_mode=?,stone_core_position_x=?,stone_core_position_y=?,updated_at=? WHERE id=?',mode,nextStoneCoreMode,position.xNorm,position.yNorm,now,foundationId);
      else await this.db.runAsync('UPDATE foundations SET foundation_mode=?,stone_core_mode=?,updated_at=? WHERE id=?',mode,nextStoneCoreMode,now,foundationId);
      await this.enqueue('foundationMode',foundationId,{foundationId,mode,stoneCoreMode:nextStoneCoreMode,updatedAt:now},now);
    });
    return this.getFoundationComposition(foundationId) as Promise<FoundationComposition>;
  }

  async saveStoneCorePosition(foundationId:string,position:StoneCorePosition):Promise<FoundationComposition>{
    const row=await this.requireFoundationRow(foundationId);
    if(row.foundation_mode!=='composite'||row.stone_core_mode!=='simple')throw new Error('Switch this foundation to composite / simple Stone-core mode before positioning the core.');
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE foundations SET stone_core_position_x=?,stone_core_position_y=?,updated_at=? WHERE id=?',position.xNorm,position.yNorm,now,foundationId);
      await this.enqueue('foundationPosition',foundationId,{foundationId,position,updatedAt:now},now);
    });
    return this.getFoundationComposition(foundationId) as Promise<FoundationComposition>;
  }

  async saveStoneCoreOffsets(foundationId:string,offsets:StoneCoreOffsets):Promise<FoundationComposition>{
    const row=await this.requireFoundationRow(foundationId);
    if(row.foundation_mode!=='composite'||row.stone_core_mode!=='detailed')throw new Error('Switch this foundation to composite / detailed Stone-core mode before entering its geometry.');
    const foundation=foundationFromRow(row);
    const issue=validateStoneCoreOffsets(offsets,foundation)[0];if(issue)throw new Error(issue);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE foundations SET stone_core_offsets_json=?,updated_at=? WHERE id=?',JSON.stringify(offsets),now,foundationId);
      await this.enqueue('foundationOffsets',foundationId,{foundationId,offsets,updatedAt:now},now);
    });
    return this.getFoundationComposition(foundationId) as Promise<FoundationComposition>;
  }

  async addFoundationCompositionRecord(draft:FoundationCompositionRecordDraft):Promise<FoundationCompositionRecord>{
    const row=await this.requireFoundationRow(draft.foundationId);
    if(row.foundation_mode!=='composite')throw new Error('Switch this foundation to composite mode before recording Stone or Ready Mix separately.');
    const issue=validateCompositionRecordDraft(draft)[0];if(issue)throw new Error(issue);
    if(draft.materialType==='stone'){
      const capacityIssue=validateStoneCapacity(foundationFromRow(row).netVolumeM3,await this.activeStoneVolume(row.id),draft.quantityM3)[0];
      if(capacityIssue)throw new Error(capacityIssue);
    }
    const recordId=id('found_rec'),now=new Date().toISOString();
    const record:FoundationCompositionRecord={id:recordId,foundationId:draft.foundationId,materialType:draft.materialType,quantityM3:draft.quantityM3,recordedOn:draft.recordedOn,notes:draft.notes.trim(),cancelledAt:null,cancelledReason:null,correctionHistory:[],createdAt:now,updatedAt:null};
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO foundation_composition_records (id,foundation_id,material_type,quantity_m3,recorded_on,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',recordId,row.id,draft.materialType,draft.quantityM3,draft.recordedOn,record.notes||null,now,now);
      await this.enqueue('foundationCompositionRecord',recordId,record,now);
    });
    return record;
  }

  async cancelFoundationCompositionRecord(recordId:string,reason:string):Promise<FoundationCompositionRecord>{
    const cleanReason=reason.trim();if(!cleanReason)throw new Error('A cancellation reason is required.');
    const row=await this.db.getFirstAsync<CompositionRow>('SELECT * FROM foundation_composition_records WHERE id=?',recordId);
    if(!row)throw new Error('The foundation composition record was not found.');
    if(row.cancelled_at)throw new Error('This record is already cancelled.');
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE foundation_composition_records SET cancelled_at=?,cancelled_reason=? WHERE id=?',now,cleanReason,recordId);
      await this.enqueue('foundationCompositionRecord',recordId,{...compositionRecordFromRow(row),cancelledAt:now,cancelledReason:cleanReason},now);
    });
    const found=await this.db.getFirstAsync<CompositionRow>('SELECT * FROM foundation_composition_records WHERE id=?',recordId);
    return compositionRecordFromRow(found!);
  }

  async correctFoundationCompositionRecord(recordId:string,draft:FoundationCompositionCorrectionDraft):Promise<FoundationCompositionRecord>{
    const reason=draft.correctionReason.trim();if(!reason)throw new Error('A correction reason is required.');
    const row=await this.db.getFirstAsync<CompositionRow>('SELECT * FROM foundation_composition_records WHERE id=?',recordId);
    if(!row)throw new Error('The foundation composition record was not found.');
    const before=compositionRecordFromRow(row);
    const issue=validateCompositionRecordDraft(draft)[0];if(issue)throw new Error(issue);
    if(draft.materialType==='stone'){
      const foundationRow=await this.db.getFirstAsync<FoundationRow>('SELECT * FROM foundations WHERE id=?',row.foundation_id);
      if(!foundationRow)throw new Error('Foundation was not found.');
      const othersActive=await this.activeStoneVolume(row.foundation_id)-(before.cancelledAt?0:before.quantityM3);
      const capacityIssue=validateStoneCapacity(foundationFromRow(foundationRow).netVolumeM3,othersActive,draft.quantityM3)[0];
      if(capacityIssue)throw new Error(capacityIssue);
    }
    const changed=before.quantityM3!==draft.quantityM3||before.recordedOn!==draft.recordedOn||before.notes.trim()!==draft.notes.trim();
    if(!changed)throw new Error('Nothing changed. Edit at least one value before saving a correction.');
    const now=new Date().toISOString();
    const history=[...before.correctionHistory,{correctedAt:now,correctedBy:'Owner',reason,changes:[
      ...(before.quantityM3!==draft.quantityM3?[{field:'Quantity (m³)',originalValue:String(before.quantityM3),newValue:String(draft.quantityM3)}]:[]),
      ...(before.recordedOn!==draft.recordedOn?[{field:'Recorded on',originalValue:before.recordedOn,newValue:draft.recordedOn}]:[]),
      ...(before.notes.trim()!==draft.notes.trim()?[{field:'Notes',originalValue:before.notes.trim()||null,newValue:draft.notes.trim()||null}]:[]),
    ]}];
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE foundation_composition_records SET quantity_m3=?,recorded_on=?,notes=?,correction_history_json=?,updated_at=? WHERE id=?',draft.quantityM3,draft.recordedOn,draft.notes.trim()||null,JSON.stringify(history),now,recordId);
      await this.enqueue('foundationCompositionRecord',recordId,{...before,quantityM3:draft.quantityM3,recordedOn:draft.recordedOn,notes:draft.notes.trim(),correctionHistory:history,updatedAt:now},now);
    });
    const found=await this.db.getFirstAsync<CompositionRow>('SELECT * FROM foundation_composition_records WHERE id=?',recordId);
    return compositionRecordFromRow(found!);
  }
}
