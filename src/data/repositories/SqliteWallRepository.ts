import type {SQLiteDatabase} from 'expo-sqlite';
import type {Project} from '../../domain/loads';
import {calculateRebar,calculateWallVolume,diffWallConsumption,normalizePurposeLabel,purposeKey,validateNewPurposeLabel,validateWall,validateWallConsumption,wallVolumeSnapshot,type SavedConcretePurpose,type Wall,type WallConsumption,type WallConsumptionCorrectionDraft,type WallConsumptionDraft,type WallCorrectionEntry,type WallDetail,type WallDraft,type WallSetup} from '../../domain/walls';
import {calculateBaseVolume,describeWallStageLock,validateBaseLifecycle,validateBaseStatusChange,validateWallBase,validateWallWorkDate,type BaseStatusChange,type WallBase,type WallBaseCorrectionDraft,type WallBaseDraft} from '../../domain/wallBase';
import {sortedLayers,validateWallLayers,type WallLayer,type WallLayerDraft} from '../../domain/wallDiagram';
import type {WallRepository} from './WallRepository';

type LayerRow={id:string;wall_id:string;phase_order:number;name:string;material_key:string|null;bottom_thickness_m:number;top_thickness_m:number;note:string|null;created_at:string;updated_at:string|null};
type BaseRow={id:string;wall_id:string;reference:string;location:string|null;length_m:number;height_m:number;bottom_thickness_m:number;top_thickness_m:number;deduction_m3:number;gross_volume_m3:number;net_volume_m3:number;material_type:WallBase['materialType'];concrete_purpose:WallBase['concretePurpose'];custom_purpose_id:string|null;custom_purpose_label:string|null;quantity:number;quantity_unit:WallBase['quantityUnit'];manual_override:number;consumption_date:string|null;status:WallBase['status'];constructed_on:string|null;curing_started_on:string|null;cured_on:string|null;curing_note:string|null;notes:string|null;correction_history_json:string|null;created_at:string;updated_at:string|null};
type WallRow={id:string;project_id:string;project_name:string;base_required?:number;name:string;system:Wall['system'];purpose:Wall['purpose'];length_m:number;height_m:number;bottom_thickness_m:number;top_thickness_m:number;deduction_m3:number;allowance_percent:number;net_volume_m3:number;planned_volume_m3:number;notes:string|null;created_at:string;updated_at:string};
export type WallConsumptionRow={id:string;wall_id:string;used_on:string;material_type:WallConsumption['type'];concrete_purpose:WallConsumption['concretePurpose'];custom_purpose_id:string|null;custom_purpose_label:string|null;finished_volume_m3:number|null;cement_bags:number|null;cement_bag_kg:number|null;sand_quantity:number|null;sand_unit:WallConsumption['sandUnit'];gravel_quantity:number|null;gravel_unit:WallConsumption['gravelUnit'];water_litres:number|null;admixture_quantity:number|null;admixture_unit:WallConsumption['admixtureUnit'];stone_quantity:number|null;stone_unit:WallConsumption['stoneUnit'];rebar_diameter_mm:number|null;rebar_count:number|null;rebar_length_each_m:number|null;total_rebar_length_m:number|null;total_rebar_kg:number|null;rebar_grade:string|null;notes:string|null;volume_length_m:number|null;volume_height_m:number|null;volume_bottom_thickness_m:number|null;volume_top_thickness_m:number|null;volume_deduction_m3:number|null;volume_gross_m3:number|null;volume_net_m3:number|null;correction_history_json:string|null;created_at:string;updated_at:string|null};
const id=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const wallSelect=`SELECT w.*,p.name project_name FROM walls w JOIN projects p ON p.id=w.project_id WHERE p.is_archived=0`;
const wall=(row:WallRow):Wall=>({id:row.id,projectId:row.project_id,projectName:row.project_name,name:row.name,system:row.system,purpose:row.purpose,lengthM:row.length_m,heightM:row.height_m,bottomThicknessM:row.bottom_thickness_m,topThicknessM:row.top_thickness_m,deductionM3:row.deduction_m3,allowancePercent:row.allowance_percent,netVolumeM3:row.net_volume_m3,plannedVolumeM3:row.planned_volume_m3,notes:row.notes??'',baseRequired:row.base_required===1,createdAt:row.created_at,updatedAt:row.updated_at});
const layerFromRow=(row:LayerRow):WallLayer=>({id:row.id,wallId:row.wall_id,phaseOrder:row.phase_order,name:row.name,materialKey:row.material_key,bottomThicknessM:row.bottom_thickness_m,topThicknessM:row.top_thickness_m,note:row.note??'',createdAt:row.created_at,updatedAt:row.updated_at});
const baseFromRow=(row:BaseRow):WallBase=>({id:row.id,wallId:row.wall_id,reference:row.reference,location:row.location??'',lengthM:row.length_m,heightM:row.height_m,bottomThicknessM:row.bottom_thickness_m,topThicknessM:row.top_thickness_m,deductionM3:row.deduction_m3,grossVolumeM3:row.gross_volume_m3,netVolumeM3:row.net_volume_m3,materialType:row.material_type,concretePurpose:row.concrete_purpose,customPurposeId:row.custom_purpose_id,customPurposeLabel:row.custom_purpose_label,quantity:row.quantity,quantityUnit:row.quantity_unit,manualOverride:row.manual_override===1,consumptionDate:row.consumption_date,status:row.status,constructedOn:row.constructed_on,curingStartedOn:row.curing_started_on,curedOn:row.cured_on,curingNote:row.curing_note??'',notes:row.notes??'',correctionHistory:parseCorrections(row.correction_history_json),createdAt:row.created_at,updatedAt:row.updated_at});
const baseFields=(base:WallBase):[string,string|null][]=>[['Base reference',base.reference],['Base location',base.location.trim()||null],['Base length (m)',String(base.lengthM)],['Base height (m)',String(base.heightM)],['Base bottom thickness (m)',String(base.bottomThicknessM)],['Base top thickness (m)',String(base.topThicknessM)],['Base deductions (m³)',String(base.deductionM3)],['Calculated gross volume (m³)',String(base.grossVolumeM3)],['Calculated net volume (m³)',String(base.netVolumeM3)],['Base material',base.materialType],['Base purpose',base.customPurposeLabel??base.concretePurpose??null],['Recorded quantity',`${base.quantity} ${base.quantityUnit==='tonnes'?'t':'m³'}`],['Manual override',base.manualOverride?'Yes':'No'],['Consumption date',base.consumptionDate],['Construction date',base.constructedOn],['Curing started',base.curingStartedOn],['Cured date',base.curedOn],['Curing note',base.curingNote.trim()||null],['Base notes',base.notes.trim()||null]];
const parseCorrections=(value:string|null):WallCorrectionEntry[]=>{try{const parsed=JSON.parse(value??'[]') as unknown;return Array.isArray(parsed)?parsed as WallCorrectionEntry[]:[];}catch{return[];}};
/** Shared with the Daily Report repository so both read a consumption row identically. */
export const wallConsumptionFromRow=(row:WallConsumptionRow):WallConsumption=>({id:row.id,wallId:row.wall_id,usedOn:row.used_on,type:row.material_type,concretePurpose:row.concrete_purpose,customPurposeId:row.custom_purpose_id??null,customPurposeLabel:row.custom_purpose_label??null,finishedVolumeM3:row.finished_volume_m3,cementBags:row.cement_bags,cementBagKg:row.cement_bag_kg,sandQuantity:row.sand_quantity,sandUnit:row.sand_unit,gravelQuantity:row.gravel_quantity,gravelUnit:row.gravel_unit,waterLitres:row.water_litres,admixtureQuantity:row.admixture_quantity,admixtureUnit:row.admixture_unit,stoneQuantity:row.stone_quantity,stoneUnit:row.stone_unit,rebarDiameterMm:row.rebar_diameter_mm,rebarCount:row.rebar_count,rebarLengthEachM:row.rebar_length_each_m,totalRebarLengthM:row.total_rebar_length_m,totalRebarKg:row.total_rebar_kg,rebarGrade:row.rebar_grade??'',notes:row.notes??'',volume:row.volume_net_m3==null?null:{lengthM:row.volume_length_m!,heightM:row.volume_height_m!,bottomThicknessM:row.volume_bottom_thickness_m!,topThicknessM:row.volume_top_thickness_m!,deductionM3:row.volume_deduction_m3!,grossVolumeM3:row.volume_gross_m3!,netVolumeM3:row.volume_net_m3},correctionHistory:parseCorrections(row.correction_history_json),createdAt:row.created_at,updatedAt:row.updated_at??null});

export class SqliteWallRepository implements WallRepository{
  constructor(private readonly db:SQLiteDatabase){}
  async getSetup():Promise<WallSetup>{const rows=await this.db.getAllAsync<{id:string;customer_id:string;customer_name:string;name:string;location:string;status:Project['status'];notes:string|null}>(`SELECT p.id,p.customer_id,c.name customer_name,p.name,p.location,p.status,p.notes FROM projects p JOIN customers c ON c.id=p.customer_id WHERE p.is_archived=0 ORDER BY CASE p.status WHEN 'active' THEN 0 ELSE 1 END,p.name COLLATE NOCASE`);return{projects:rows.map(row=>({id:row.id,customerId:row.customer_id,customerName:row.customer_name,name:row.name,location:row.location,status:row.status,notes:row.notes}))};}
  async listWalls(projectId?:string|null){const rows=projectId?await this.db.getAllAsync<WallRow>(`${wallSelect} AND w.project_id=? ORDER BY w.updated_at DESC`,projectId):await this.db.getAllAsync<WallRow>(`${wallSelect} ORDER BY w.updated_at DESC`);return rows.map(wall);}
  async getWall(wallId:string):Promise<WallDetail>{const found=await this.db.getFirstAsync<WallRow>(`${wallSelect} AND w.id=?`,wallId);if(!found)throw new Error('Wall was not found.');const entries=await this.db.getAllAsync<WallConsumptionRow>(`SELECT * FROM wall_consumptions WHERE wall_id=? ORDER BY used_on DESC,created_at DESC`,wallId);const base=await this.getBase(wallId);const detail=wall(found);return{wall:detail,entries:entries.map(wallConsumptionFromRow),layers:await this.listLayers(wallId),base,stage:describeWallStageLock(base,!detail.baseRequired)};}
  async saveWall(draft:WallDraft,wallId?:string){const setup=await this.getSetup(),issue=validateWall(draft,setup.projects)[0];if(issue)throw new Error(issue);
    if(wallId){const existing=await this.listLayers(wallId);const layerIssue=validateWallLayers(existing,draft)[0];if(layerIssue)throw new Error(layerIssue);}const result=calculateWallVolume(draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,draft.allowancePercent),now=new Date().toISOString(),recordId=wallId??id('wall'),notes=draft.notes.trim()||null;await this.db.withTransactionAsync(async()=>{if(wallId){const changed=await this.db.runAsync(`UPDATE walls SET project_id=?,name=?,system=?,purpose=?,length_m=?,height_m=?,bottom_thickness_m=?,top_thickness_m=?,deduction_m3=?,allowance_percent=?,net_volume_m3=?,planned_volume_m3=?,notes=?,updated_at=? WHERE id=?`,draft.projectId,draft.name.trim(),draft.system,draft.purpose,draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,draft.allowancePercent,result.netVolumeM3,result.plannedVolumeM3,notes,now,recordId);if(!changed.changes)throw new Error('Wall was not found.');}else await this.db.runAsync(`INSERT INTO walls (id,project_id,name,system,purpose,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,allowance_percent,net_volume_m3,planned_volume_m3,notes,base_required,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,recordId,draft.projectId,draft.name.trim(),draft.system,draft.purpose,draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,draft.allowancePercent,result.netVolumeM3,result.plannedVolumeM3,notes,now,now);await this.enqueue('wall',recordId,{id:recordId,...draft,...result,updatedAt:now},now);});const found=await this.db.getFirstAsync<WallRow>(`${wallSelect} AND w.id=?`,recordId);if(!found)throw new Error('Wall was not found after saving.');return wall(found);}

  async listLayers(wallId:string):Promise<WallLayer[]>{
    const rows=await this.db.getAllAsync<LayerRow>('SELECT * FROM wall_layers WHERE wall_id=? ORDER BY phase_order',wallId);
    return rows.map(layerFromRow);
  }
  async saveLayers(wallId:string,layers:WallLayerDraft[]):Promise<WallLayer[]>{
    if(layers.length)await this.assertWallStageOpen(wallId,null);
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
    await this.assertWallStageOpen(draft.wallId,draft.usedOn);
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
  /** DEC-459. Wall work is refused until this wall's base is explicitly cured, unless it is a legacy wall. */
  private async assertWallStageOpen(wallId:string,usedOn:string|null){
    const row=await this.db.getFirstAsync<{base_required:number}>('SELECT base_required FROM walls WHERE id=?',wallId);
    if(!row)throw new Error('Wall was not found.');
    if(row.base_required!==1)return;
    const base=await this.getBase(wallId);
    const issue=usedOn?validateWallWorkDate(usedOn,base,false):describeWallStageLock(base,false).reason;
    if(usedOn?issue:describeWallStageLock(base,false).locked)throw new Error(issue??'Wall construction is locked until the base is confirmed cured.');
  }

  async getBase(wallId:string):Promise<WallBase|null>{
    const row=await this.db.getFirstAsync<BaseRow>('SELECT * FROM wall_bases WHERE wall_id=?',wallId);
    return row?baseFromRow(row):null;
  }

  async saveBase(draft:WallBaseDraft):Promise<WallBase>{
    const issue=validateWallBase(draft)[0];if(issue)throw new Error(issue);
    const exists=await this.db.getFirstAsync<{id:string}>('SELECT id FROM walls WHERE id=?',draft.wallId);
    if(!exists)throw new Error('Wall was not found.');
    const current=await this.getBase(draft.wallId);
    if(current&&current.status!=='planned')throw new Error('This base is already constructed. Use a reasoned correction to change it.');
    const volume=calculateBaseVolume(draft),now=new Date().toISOString();
    const purposeLabel=await this.purposeLabel(draft.customPurposeId,current?.customPurposeId===draft.customPurposeId?current.customPurposeLabel:null);
    const recordId=current?.id??id('wall_base');
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`INSERT INTO wall_bases (id,wall_id,reference,location,length_m,height_m,bottom_thickness_m,top_thickness_m,deduction_m3,gross_volume_m3,net_volume_m3,material_type,concrete_purpose,custom_purpose_id,custom_purpose_label,quantity,quantity_unit,manual_override,consumption_date,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'planned',?,?,?)
        ON CONFLICT(id) DO UPDATE SET reference=excluded.reference,location=excluded.location,length_m=excluded.length_m,height_m=excluded.height_m,bottom_thickness_m=excluded.bottom_thickness_m,top_thickness_m=excluded.top_thickness_m,deduction_m3=excluded.deduction_m3,gross_volume_m3=excluded.gross_volume_m3,net_volume_m3=excluded.net_volume_m3,material_type=excluded.material_type,concrete_purpose=excluded.concrete_purpose,custom_purpose_id=excluded.custom_purpose_id,custom_purpose_label=excluded.custom_purpose_label,quantity=excluded.quantity,quantity_unit=excluded.quantity_unit,manual_override=excluded.manual_override,consumption_date=excluded.consumption_date,notes=excluded.notes,updated_at=excluded.updated_at`,
        recordId,draft.wallId,draft.reference.trim(),draft.location.trim()||null,draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3,volume.grossVolumeM3,volume.netVolumeM3,draft.materialType,draft.concretePurpose,draft.customPurposeId,purposeLabel,draft.quantity,draft.quantityUnit,draft.manualOverride?1:0,draft.consumptionDate,draft.notes.trim()||null,current?.createdAt??now,now);
      await this.enqueue('wallBase',recordId,{...draft,...volume,id:recordId,updatedAt:now},now);
    });
    return this.requireBase(draft.wallId);
  }

  async changeBaseStatus(wallId:string,change:BaseStatusChange):Promise<WallBase>{
    const base=await this.requireBase(wallId);
    const wallActivity=await this.hasWallActivity(wallId);
    const issue=validateBaseStatusChange(base,change,{wallActivity})[0];if(issue)throw new Error(issue);
    const now=new Date().toISOString();
    const next={constructedOn:change.constructedOn??base.constructedOn,curingStartedOn:change.status==='curing'?change.curingStartedOn??base.curingStartedOn:base.curingStartedOn,curedOn:change.status==='cured'?change.curedOn??base.curedOn:change.status==='curing'?null:base.curedOn};
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE wall_bases SET status=?,constructed_on=?,curing_started_on=?,cured_on=?,curing_note=COALESCE(?,curing_note),updated_at=? WHERE id=?',change.status,next.constructedOn,next.curingStartedOn,next.curedOn,change.curingNote?.trim()||null,now,base.id);
      await this.enqueue('wallBase',base.id,{id:base.id,wallId,status:change.status,...next,updatedAt:now},now);
    });
    return this.requireBase(wallId);
  }

  async correctBase(wallId:string,draft:WallBaseCorrectionDraft):Promise<WallBase>{
    const before=await this.requireBase(wallId),reason=draft.correctionReason.trim();
    if(!reason)throw new Error('A correction reason is required.');
    const issue=validateWallBase(draft)[0];if(issue)throw new Error(issue);
    const volume=calculateBaseVolume(draft);
    const purposeLabel=await this.purposeLabel(draft.customPurposeId,before.customPurposeId===draft.customPurposeId?before.customPurposeLabel:null);
    const after:WallBase={...before,...draft,...volume,customPurposeLabel:purposeLabel};
    const next=new Map(baseFields(after));
    const changes=baseFields(before).flatMap(([field,originalValue])=>{const newValue=next.get(field)??null;return originalValue===newValue?[]:[{field,originalValue,newValue}];});
    if(!changes.length)throw new Error('Nothing changed. Edit at least one value before saving a correction.');
    const now=new Date().toISOString(),history=[...before.correctionHistory,{correctedAt:now,correctedBy:'Owner',reason,changes}];
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE wall_bases SET reference=?,location=?,length_m=?,height_m=?,bottom_thickness_m=?,top_thickness_m=?,deduction_m3=?,gross_volume_m3=?,net_volume_m3=?,material_type=?,concrete_purpose=?,custom_purpose_id=?,custom_purpose_label=?,quantity=?,quantity_unit=?,manual_override=?,consumption_date=?,notes=?,correction_history_json=?,updated_at=? WHERE id=?',
        after.reference.trim(),after.location.trim()||null,after.lengthM,after.heightM,after.bottomThicknessM,after.topThicknessM,after.deductionM3,after.grossVolumeM3,after.netVolumeM3,after.materialType,after.concretePurpose,after.customPurposeId,after.customPurposeLabel,after.quantity,after.quantityUnit,after.manualOverride?1:0,after.consumptionDate,after.notes.trim()||null,JSON.stringify(history),now,before.id);
      await this.enqueue('wallBase',before.id,{...after,correctionHistory:history,updatedAt:now},now);
    });
    return this.requireBase(wallId);
  }

  async correctBaseCuring(wallId:string,change:{constructedOn?:string;curingStartedOn?:string;curedOn?:string;reason:string}):Promise<WallBase>{
    const before=await this.requireBase(wallId),reason=change.reason.trim();
    if(!reason)throw new Error('A correction reason is required.');
    const after={...before,constructedOn:change.constructedOn??before.constructedOn,curingStartedOn:change.curingStartedOn??before.curingStartedOn,curedOn:change.curedOn??before.curedOn};
    const issue=validateBaseLifecycle(after)[0];if(issue)throw new Error(issue);
    // A corrected cured date may never leave already recorded wall work dated before it.
    if(after.curedOn){
      const earliest=await this.db.getFirstAsync<{used_on:string}>('SELECT used_on FROM wall_consumptions WHERE wall_id=? ORDER BY used_on LIMIT 1',wallId);
      if(earliest&&earliest.used_on<after.curedOn)throw new Error(`Wall work is already recorded on ${earliest.used_on}, before the corrected cured date of ${after.curedOn}.`);
    }
    const fields:[string,string|null][]=[['Construction date',before.constructedOn],['Curing started',before.curingStartedOn],['Cured date',before.curedOn]];
    const nextValues=new Map<string,string|null>([['Construction date',after.constructedOn],['Curing started',after.curingStartedOn],['Cured date',after.curedOn]]);
    const changes=fields.flatMap(([field,originalValue])=>{const newValue=nextValues.get(field)??null;return originalValue===newValue?[]:[{field,originalValue,newValue}];});
    if(!changes.length)throw new Error('Nothing changed. Edit at least one date before saving a correction.');
    const now=new Date().toISOString(),history=[...before.correctionHistory,{correctedAt:now,correctedBy:'Owner',reason,changes}];
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE wall_bases SET constructed_on=?,curing_started_on=?,cured_on=?,correction_history_json=?,updated_at=? WHERE id=?',after.constructedOn,after.curingStartedOn,after.curedOn,JSON.stringify(history),now,before.id);
      await this.enqueue('wallBase',before.id,{...after,correctionHistory:history,updatedAt:now},now);
    });
    return this.requireBase(wallId);
  }

  private async requireBase(wallId:string){const base=await this.getBase(wallId);if(!base)throw new Error('This wall has no recorded base yet.');return base;}
  private async hasWallActivity(wallId:string){
    const [entries,layers]=await Promise.all([
      this.db.getFirstAsync<{count:number}>('SELECT COUNT(*) count FROM wall_consumptions WHERE wall_id=?',wallId),
      this.db.getFirstAsync<{count:number}>('SELECT COUNT(*) count FROM wall_layers WHERE wall_id=?',wallId),
    ]);
    return Number(entries?.count??0)+Number(layers?.count??0)>0;
  }
  private async purposeLabel(customPurposeId:string|null,known:string|null){
    if(!customPurposeId)return null;
    if(known)return known;
    const purpose=await this.db.getFirstAsync<{label:string}>('SELECT label FROM wall_concrete_purposes WHERE id=?',customPurposeId);
    if(!purpose)throw new Error('The selected purpose was not found.');
    return purpose.label;
  }

  private async readConsumption(recordId:string){const found=await this.db.getFirstAsync<WallConsumptionRow>(`SELECT * FROM wall_consumptions WHERE id=?`,recordId);if(!found)throw new Error('Wall consumption was not found after saving.');return wallConsumptionFromRow(found);}
  private async enqueue(entity:string,entityId:string,payload:unknown,now:string){await this.db.runAsync(`INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)`,entity,entityId,'upsert',JSON.stringify(payload),now);}
}
