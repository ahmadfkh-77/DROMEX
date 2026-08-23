import type {Project} from './loads';

export type WallSystem='reinforced_concrete'|'rubble_masonry'|'cyclopean_concrete';
export type WallPurpose='retaining'|'boundary'|'other';
export type WallMaterialType='ready_mix'|'site_mix'|'rebar'|'stone';
export type ConcretePurpose='structural'|'filling'|'cyclopean_matrix'|'mortar'|'footing'|'coping';
export type MaterialUnit='m3'|'tonnes';

export type WallDraft={projectId:string;name:string;system:WallSystem;purpose:WallPurpose;lengthM:number;heightM:number;bottomThicknessM:number;topThicknessM:number;deductionM3:number;allowancePercent:number;notes:string};
export type Wall=WallDraft&{id:string;projectName:string;netVolumeM3:number;plannedVolumeM3:number;createdAt:string;updatedAt:string};
export type WallConsumptionDraft={wallId:string;usedOn:string;type:WallMaterialType;concretePurpose:ConcretePurpose|null;finishedVolumeM3:number|null;cementBags:number|null;cementBagKg:number|null;sandQuantity:number|null;sandUnit:MaterialUnit|null;gravelQuantity:number|null;gravelUnit:MaterialUnit|null;waterLitres:number|null;admixtureQuantity:number|null;admixtureUnit:'litres'|'kg'|null;stoneQuantity:number|null;stoneUnit:MaterialUnit|null;rebarDiameterMm:number|null;rebarCount:number|null;rebarLengthEachM:number|null;rebarGrade:string;notes:string};
export type WallConsumption=WallConsumptionDraft&{id:string;totalRebarLengthM:number|null;totalRebarKg:number|null;createdAt:string};
export type WallDetail={wall:Wall;entries:WallConsumption[]};
export type WallSetup={projects:Project[]};

export const wallSystemLabels:Record<WallSystem,string>={reinforced_concrete:'Reinforced concrete',rubble_masonry:'Stacked rock + mortar/concrete',cyclopean_concrete:'Concrete + embedded rocks'};
export const concretePurposeLabels:Record<ConcretePurpose,string>={structural:'Structural concrete',filling:'Filling concrete',cyclopean_matrix:'Cyclopean matrix concrete',mortar:'Stone-wall mortar/fill',footing:'Footing concrete',coping:'Coping concrete'};

export function calculateWallVolume(lengthM:number,heightM:number,bottomThicknessM:number,topThicknessM:number,deductionM3=0,allowancePercent=0){const round=(value:number)=>Number(value.toFixed(9)),gross=round(lengthM*heightM*((bottomThicknessM+topThicknessM)/2)),net=round(Math.max(0,gross-Math.max(0,deductionM3))),allowance=round(net*Math.max(0,allowancePercent)/100);return{grossVolumeM3:gross,netVolumeM3:net,allowanceM3:allowance,plannedVolumeM3:round(net+allowance)};}
export function rebarUnitWeightKgM(diameterMm:number){return Math.PI*(diameterMm/1000)**2/4*7850;}
export function calculateRebar(diameterMm:number,count:number,lengthEachM:number){const totalLengthM=count*lengthEachM;return{totalLengthM,totalKg:totalLengthM*rebarUnitWeightKgM(diameterMm)};}

export function validateWall(draft:WallDraft,projects:Project[]){const issues:string[]=[];if(!projects.some(value=>value.id===draft.projectId&&value.status==='active'))issues.push('Select an active project.');if(!draft.name.trim())issues.push('Enter a wall or section name.');if(draft.lengthM<=0||draft.heightM<=0)issues.push('Length and height must be greater than zero.');if(draft.bottomThicknessM<=0||draft.topThicknessM<=0)issues.push('Bottom and top thickness must be greater than zero.');if(draft.deductionM3<0||draft.allowancePercent<0)issues.push('Deductions and allowance cannot be negative.');if(calculateWallVolume(draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3).netVolumeM3<=0)issues.push('Wall net volume must be greater than zero.');return issues;}
export function validateWallConsumption(draft:WallConsumptionDraft){const issues:string[]=[];if(!draft.usedOn)issues.push('Choose the consumption date.');if(draft.type==='ready_mix'&&(!(draft.finishedVolumeM3!>0)||!draft.concretePurpose))issues.push('Choose the concrete purpose and enter used m³.');if(draft.type==='site_mix'){const hasIngredient=(draft.finishedVolumeM3??0)>0||(draft.cementBags??0)>0||(draft.sandQuantity??0)>0||(draft.gravelQuantity??0)>0||(draft.waterLitres??0)>0||(draft.admixtureQuantity??0)>0;if(!draft.concretePurpose)issues.push('Choose the site-mix purpose.');if(!hasIngredient)issues.push('Enter at least one site-mixed quantity.');}if(draft.type==='rebar'&&(!(draft.rebarDiameterMm!>0)||!(draft.rebarCount!>0)||!(draft.rebarLengthEachM!>0)))issues.push('Enter rebar diameter, number of bars, and length per bar.');if(draft.type==='stone'&&(!(draft.stoneQuantity!>0)||!draft.stoneUnit))issues.push('Enter the stone quantity and unit.');return issues;}
