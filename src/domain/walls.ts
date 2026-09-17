import type {Project} from './loads';
import type {WallBase} from './wallBase';
import type {WallStageLock} from './wallBase';
import type {WallLayer} from './wallDiagram';

export type WallSystem='reinforced_concrete'|'rubble_masonry'|'cyclopean_concrete';
export type WallPurpose='retaining'|'boundary'|'other';
export type WallMaterialType='ready_mix'|'site_mix'|'rebar'|'stone';
export type ConcretePurpose='structural'|'filling'|'cyclopean_matrix'|'mortar'|'footing'|'coping';
export type MaterialUnit='m3'|'tonnes';

// DEC-455. The section 1 wall dimensions a user enters to calculate a Stone or Ready Mix volume, and
// the snapshot stored with the consumption record once gross and net volume have been derived.
export type WallVolumeDimensions={lengthM:number;heightM:number;bottomThicknessM:number;topThicknessM:number;deductionM3:number};
export type WallVolumeSnapshot=WallVolumeDimensions&{grossVolumeM3:number;netVolumeM3:number};
export type WallVolumeInput={length:string;height:string;bottom:string;top:string;deduction:string};
// DEC-451. A saved, reusable Concrete/Mortar purpose. Never renamed or deleted, so a record's label
// snapshot and the saved label can never disagree.
export type SavedConcretePurpose={id:string;label:string;createdAt:string};
// DEC-452. Reasoned correction audit, the same shape used by loads, supplier loads, and fuel.
export type WallCorrectionChange={field:string;originalValue:string|null;newValue:string|null};
export type WallCorrectionEntry={correctedAt:string;correctedBy:string;reason:string;changes:WallCorrectionChange[]};

export type WallDraft={projectId:string;name:string;system:WallSystem;purpose:WallPurpose;lengthM:number;heightM:number;bottomThicknessM:number;topThicknessM:number;deductionM3:number;allowancePercent:number;notes:string};
export type Wall=WallDraft&{id:string;projectName:string;baseRequired:boolean;netVolumeM3:number;plannedVolumeM3:number;createdAt:string;updatedAt:string};
export type WallConsumptionDraft={wallId:string;usedOn:string;type:WallMaterialType;concretePurpose:ConcretePurpose|null;customPurposeId?:string|null;finishedVolumeM3:number|null;cementBags:number|null;cementBagKg:number|null;sandQuantity:number|null;sandUnit:MaterialUnit|null;gravelQuantity:number|null;gravelUnit:MaterialUnit|null;waterLitres:number|null;admixtureQuantity:number|null;admixtureUnit:'litres'|'kg'|null;stoneQuantity:number|null;stoneUnit:MaterialUnit|null;rebarDiameterMm:number|null;rebarCount:number|null;rebarLengthEachM:number|null;rebarGrade:string;notes:string;volume?:WallVolumeDimensions|null};
export type WallConsumptionCorrectionDraft=WallConsumptionDraft&{correctionReason:string};
export type WallConsumption=Omit<WallConsumptionDraft,'customPurposeId'|'volume'>&{id:string;customPurposeId:string|null;customPurposeLabel:string|null;volume:WallVolumeSnapshot|null;totalRebarLengthM:number|null;totalRebarKg:number|null;correctionHistory:WallCorrectionEntry[];createdAt:string;updatedAt:string|null};
export type WallDetail={wall:Wall;entries:WallConsumption[];layers:WallLayer[];base:WallBase|null;stage:WallStageLock};
export type WallSetup={projects:Project[]};

export const wallSystemLabels:Record<WallSystem,string>={reinforced_concrete:'Reinforced concrete',rubble_masonry:'Stacked rock + mortar/concrete',cyclopean_concrete:'Concrete + embedded rocks'};
export const wallPurposeLabels:Record<WallPurpose,string>={retaining:'Retaining wall',boundary:'Boundary / free-standing wall',other:'Other wall'};
export const concretePurposeLabels:Record<ConcretePurpose,string>={structural:'Structural concrete',filling:'Filling concrete',cyclopean_matrix:'Cyclopean matrix concrete',mortar:'Stone-wall mortar/fill',footing:'Footing concrete',coping:'Coping concrete'};
export const builtInConcretePurposes=(Object.keys(concretePurposeLabels) as ConcretePurpose[]).map(id=>({id,label:concretePurposeLabels[id]}));
export const wallMaterialLabels:Record<WallMaterialType,string>={ready_mix:'Ready-mix concrete',site_mix:'Site-mixed concrete',rebar:'Steel rebar',stone:'Stone'};

const round=(value:number)=>Number(value.toFixed(9));
const trimNumber=(value:number,digits:number)=>String(Number(value.toFixed(digits)));
const unitSymbol=(unit:MaterialUnit|null)=>unit==='tonnes'?'t':'m³';

export function calculateWallVolume(lengthM:number,heightM:number,bottomThicknessM:number,topThicknessM:number,deductionM3=0,allowancePercent=0){const round=(value:number)=>Number(value.toFixed(9)),gross=round(lengthM*heightM*((bottomThicknessM+topThicknessM)/2)),net=round(Math.max(0,gross-Math.max(0,deductionM3))),allowance=round(net*Math.max(0,allowancePercent)/100);return{grossVolumeM3:gross,netVolumeM3:net,allowanceM3:allowance,plannedVolumeM3:round(net+allowance)};}
export function rebarUnitWeightKgM(diameterMm:number){return Math.PI*(diameterMm/1000)**2/4*7850;}
export function calculateRebar(diameterMm:number,count:number,lengthEachM:number){const totalLengthM=count*lengthEachM;return{totalLengthM,totalKg:totalLengthM*rebarUnitWeightKgM(diameterMm)};}

export function supportsVolumeCalculation(type:WallMaterialType){return type==='stone'||type==='ready_mix';}
const m3=(value:number)=>`${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} m³`;
export function formatCubicMetres(value:number){return m3(value);}
/** How a record's quantity was obtained, for the screen, PDF, and workbook. */
export function formatVolumeCalculation(entry:Pick<WallConsumption,'type'|'volume'>){
  if(!supportsVolumeCalculation(entry.type))return 'Not applicable';
  const volume=entry.volume;if(!volume)return 'Entered directly';
  const thickness=volume.bottomThicknessM===volume.topThicknessM?`${volume.bottomThicknessM} m`:`${volume.bottomThicknessM} to ${volume.topThicknessM} m`;
  return `${m3(volume.netVolumeM3)} net from ${volume.lengthM} m × ${volume.heightM} m × ${thickness}${volume.deductionM3>0?`, less ${m3(volume.deductionM3)}`:''}`;
}

const fieldNames={length:'Wall length',height:'Wall height',bottom:'Bottom thickness',top:'Top thickness'} as const;
const positiveMessage=(name:string)=>`${name} must be greater than zero with no more than three decimals.`;
const deductionMessage='Volume deductions must be zero or more with no more than three decimals.';
const exceedsMessage='Volume deductions must be smaller than the gross wall volume.';
const threeDecimals=/^\d+([.,]\d{1,3})?$/;
const parseMetric=(value:string)=>{const text=value.trim();return threeDecimals.test(text)?Number(text.replace(',','.')):Number.NaN;};
const hasThreeDecimalsAtMost=(value:number)=>Math.abs(value*1000-Math.round(value*1000))<1e-6;
const validPositive=(value:number)=>Number.isFinite(value)&&value>0&&hasThreeDecimalsAtMost(value);

function volumeIssues(dimensions:WallVolumeDimensions){
  const issues:string[]=[];
  if(!validPositive(dimensions.lengthM))issues.push(positiveMessage(fieldNames.length));
  if(!validPositive(dimensions.heightM))issues.push(positiveMessage(fieldNames.height));
  if(!validPositive(dimensions.bottomThicknessM))issues.push(positiveMessage(fieldNames.bottom));
  if(!validPositive(dimensions.topThicknessM))issues.push(positiveMessage(fieldNames.top));
  if(!Number.isFinite(dimensions.deductionM3)||dimensions.deductionM3<0||!hasThreeDecimalsAtMost(dimensions.deductionM3))issues.push(deductionMessage);
  if(!issues.length&&dimensions.deductionM3>=calculateWallVolume(dimensions.lengthM,dimensions.heightM,dimensions.bottomThicknessM,dimensions.topThicknessM).grossVolumeM3)issues.push(exceedsMessage);
  return issues;
}
/** DEC-455. Builds the stored snapshot with the section 1 formula (no allowance); throws when the dimensions are invalid. */
export function wallVolumeSnapshot(dimensions:WallVolumeDimensions):WallVolumeSnapshot{
  const issue=volumeIssues(dimensions)[0];if(issue)throw new Error(issue);
  const result=calculateWallVolume(dimensions.lengthM,dimensions.heightM,dimensions.bottomThicknessM,dimensions.topThicknessM,dimensions.deductionM3);
  return{...dimensions,grossVolumeM3:result.grossVolumeM3,netVolumeM3:result.netVolumeM3};
}
/** Parses the calculator's text fields. An empty deduction means none. */
export function parseWallVolumeInput(input:WallVolumeInput):{snapshot:WallVolumeSnapshot|null;issues:string[]}{
  const missing=([['length','wall length'],['height','wall height'],['bottom','bottom thickness'],['top','top thickness']] as const).filter(([key])=>!input[key].trim()).map(([,name])=>`Enter the ${name} in metres.`);
  if(missing.length)return{snapshot:null,issues:missing};
  const dimensions={lengthM:parseMetric(input.length),heightM:parseMetric(input.height),bottomThicknessM:parseMetric(input.bottom),topThicknessM:parseMetric(input.top),deductionM3:input.deduction.trim()?parseMetric(input.deduction):0};
  const found=volumeIssues(dimensions);
  return found.length?{snapshot:null,issues:found}:{snapshot:wallVolumeSnapshot(dimensions),issues:[]};
}

export function normalizePurposeLabel(label:string){return label.trim().replace(/\s+/g,' ');}
export function purposeKey(label:string){return normalizePurposeLabel(label).toLocaleLowerCase('en-US');}
export function validateNewPurposeLabel(label:string,saved:SavedConcretePurpose[]){
  const clean=normalizePurposeLabel(label);
  if(!clean)return['Enter a purpose name.'];
  if(clean.length>60)return['Purpose name must be 60 characters or fewer.'];
  const existing=[...builtInConcretePurposes,...saved].find(value=>purposeKey(value.label)===purposeKey(clean));
  return existing?[`A purpose named “${existing.label}” already exists.`]:[];
}
export function wallConsumptionPurposeLabel(entry:Pick<WallConsumption,'concretePurpose'|'customPurposeLabel'>){return entry.concretePurpose?concretePurposeLabels[entry.concretePurpose]:entry.customPurposeLabel??null;}

export function validateWall(draft:WallDraft,projects:Project[]){const issues:string[]=[];if(!projects.some(value=>value.id===draft.projectId&&value.status==='active'))issues.push('Select an active project.');if(!draft.name.trim())issues.push('Enter a wall or section name.');if(draft.lengthM<=0||draft.heightM<=0)issues.push('Length and height must be greater than zero.');if(draft.bottomThicknessM<=0||draft.topThicknessM<=0)issues.push('Bottom and top thickness must be greater than zero.');if(draft.deductionM3<0||draft.allowancePercent<0)issues.push('Deductions and allowance cannot be negative.');if(calculateWallVolume(draft.lengthM,draft.heightM,draft.bottomThicknessM,draft.topThicknessM,draft.deductionM3).netVolumeM3<=0)issues.push('Wall net volume must be greater than zero.');return issues;}
export function validateWallConsumption(draft:WallConsumptionDraft){
  const issues:string[]=[],concrete=draft.type==='ready_mix'||draft.type==='site_mix',hasPurpose=!!draft.concretePurpose||!!draft.customPurposeId;
  if(!draft.usedOn)issues.push('Choose the consumption date.');
  if(concrete&&draft.concretePurpose&&draft.customPurposeId)issues.push('Choose one concrete / mortar purpose.');
  if(!concrete&&(draft.concretePurpose||draft.customPurposeId))issues.push('A concrete / mortar purpose applies only to ready-mix and site-mixed records.');
  if(draft.type==='ready_mix'&&(!(draft.finishedVolumeM3!>0)||!hasPurpose))issues.push('Choose the concrete purpose and enter used m³.');
  if(draft.type==='site_mix'){const hasIngredient=(draft.finishedVolumeM3??0)>0||(draft.cementBags??0)>0||(draft.sandQuantity??0)>0||(draft.gravelQuantity??0)>0||(draft.waterLitres??0)>0||(draft.admixtureQuantity??0)>0;if(!hasPurpose)issues.push('Choose the site-mix purpose.');if(!hasIngredient)issues.push('Enter at least one site-mixed quantity.');}
  if(draft.type==='rebar'&&(!(draft.rebarDiameterMm!>0)||!(draft.rebarCount!>0)||!(draft.rebarLengthEachM!>0)))issues.push('Enter rebar diameter, number of bars, and length per bar.');
  if(draft.type==='stone'&&(!(draft.stoneQuantity!>0)||!draft.stoneUnit))issues.push('Enter the stone quantity and unit.');
  if(draft.volume){
    if(!supportsVolumeCalculation(draft.type))issues.push('A volume calculation can be recorded only for Stone and Ready Mix.');
    else{issues.push(...volumeIssues(draft.volume));if(draft.type==='stone'&&draft.stoneUnit==='tonnes')issues.push('A calculated volume is in m³. Set the stone unit to m³ or remove the calculation.');}
  }
  return issues;
}

/** One quantity sentence shared by the wall screen, the Daily Report PDF, and the workbook. Missing values are omitted, never shown as zero. */
export function describeWallConsumptionQuantity(entry:WallConsumption){
  if(entry.type==='rebar')return `${trimNumber(entry.rebarCount??0,0)} bars × ${trimNumber(entry.rebarLengthEachM??0,3)} m${entry.totalRebarKg==null?'':` · ${entry.totalRebarKg.toFixed(1)} kg`}`;
  if(entry.type==='stone')return entry.stoneQuantity==null?'Quantity not recorded':`${trimNumber(entry.stoneQuantity,3)} ${unitSymbol(entry.stoneUnit)} stone`;
  if(entry.type==='ready_mix')return entry.finishedVolumeM3==null?'Quantity not recorded':`${trimNumber(entry.finishedVolumeM3,3)} m³`;
  const parts=[
    entry.finishedVolumeM3==null?null:`${trimNumber(entry.finishedVolumeM3,3)} m³ finished`,
    entry.cementBags==null?null:`${trimNumber(entry.cementBags,2)} cement bags`,
    entry.sandQuantity==null?null:`${trimNumber(entry.sandQuantity,3)} ${unitSymbol(entry.sandUnit)} sand`,
    entry.gravelQuantity==null?null:`${trimNumber(entry.gravelQuantity,3)} ${unitSymbol(entry.gravelUnit)} gravel`,
    entry.waterLitres==null?null:`${trimNumber(entry.waterLitres,1)} L water`,
    entry.admixtureQuantity==null?null:`${trimNumber(entry.admixtureQuantity,3)} ${entry.admixtureUnit==='kg'?'kg':'L'} admixture`,
  ].filter((part):part is string=>!!part);
  return parts.length?parts.join(' · '):'Quantity not recorded';
}

const text=(value:number|null|undefined)=>value==null?null:String(value);
const quantity=(value:number|null,unit:MaterialUnit|'litres'|'kg'|null)=>value==null?null:`${value} ${unit==='tonnes'?'t':unit==='litres'?'L':unit==='kg'?'kg':'m³'}`;
function correctionFields(entry:WallConsumption):[string,string|null][]{
  return [
    ['Used on',entry.usedOn],['Material',wallMaterialLabels[entry.type]],['Concrete / mortar purpose',wallConsumptionPurposeLabel(entry)],
    ['Concrete volume (m³)',text(entry.finishedVolumeM3)],['Cement bags',text(entry.cementBags)],['Kilograms per cement bag',text(entry.cementBagKg)],
    ['Sand',quantity(entry.sandQuantity,entry.sandUnit)],['Gravel / aggregate',quantity(entry.gravelQuantity,entry.gravelUnit)],['Water (L)',text(entry.waterLitres)],
    ['Admixture',quantity(entry.admixtureQuantity,entry.admixtureUnit)],['Stone',quantity(entry.stoneQuantity,entry.stoneUnit)],
    ['Rebar diameter (mm)',text(entry.rebarDiameterMm)],['Number of bars',text(entry.rebarCount)],['Length per bar (m)',text(entry.rebarLengthEachM)],['Rebar grade',entry.rebarGrade.trim()||null],
    ['Calculation length (m)',text(entry.volume?.lengthM)],['Calculation height (m)',text(entry.volume?.heightM)],['Calculation bottom thickness (m)',text(entry.volume?.bottomThicknessM)],['Calculation top thickness (m)',text(entry.volume?.topThicknessM)],
    ['Calculation deductions (m³)',text(entry.volume?.deductionM3)],['Calculated gross volume (m³)',text(entry.volume?.grossVolumeM3)],['Calculated net volume (m³)',text(entry.volume?.netVolumeM3)],
    ['Notes',entry.notes.trim()||null],
  ];
}
/** DEC-452. Field-level before/after changes between a stored record and its proposed correction. */
export function diffWallConsumption(before:WallConsumption,after:WallConsumption):WallCorrectionChange[]{
  const next=new Map(correctionFields(after));
  return correctionFields(before).flatMap(([field,originalValue])=>{const newValue=next.get(field)??null;return originalValue===newValue?[]:[{field,originalValue,newValue}];});
}

export type WallConsumptionSummary={structural:number;filling:number;otherConcrete:number;cement:number;cementKg:number;water:number;rebarKg:number;stoneM3:number;stoneT:number;sandM3:number;sandT:number;gravelM3:number;gravelT:number;calculatedRecords:number};
export function summarizeWallConsumption(entries:WallConsumption[]):WallConsumptionSummary{
  const sum=(filter:(entry:WallConsumption)=>boolean,value:(entry:WallConsumption)=>number)=>round(entries.filter(filter).reduce((total,entry)=>total+value(entry),0));
  const all=()=>true,volume=(entry:WallConsumption)=>entry.finishedVolumeM3??0;
  return{
    structural:sum(entry=>entry.concretePurpose==='structural',volume),
    filling:sum(entry=>entry.concretePurpose==='filling'||entry.concretePurpose==='mortar',volume),
    otherConcrete:sum(entry=>!!entry.customPurposeId||entry.concretePurpose==='cyclopean_matrix'||entry.concretePurpose==='footing'||entry.concretePurpose==='coping',volume),
    cement:sum(all,entry=>entry.cementBags??0),cementKg:sum(all,entry=>(entry.cementBags??0)*(entry.cementBagKg??0)),water:sum(all,entry=>entry.waterLitres??0),rebarKg:sum(all,entry=>entry.totalRebarKg??0),
    stoneM3:sum(entry=>entry.stoneUnit==='m3',entry=>entry.stoneQuantity??0),stoneT:sum(entry=>entry.stoneUnit==='tonnes',entry=>entry.stoneQuantity??0),
    sandM3:sum(entry=>entry.sandUnit==='m3',entry=>entry.sandQuantity??0),sandT:sum(entry=>entry.sandUnit==='tonnes',entry=>entry.sandQuantity??0),
    gravelM3:sum(entry=>entry.gravelUnit==='m3',entry=>entry.gravelQuantity??0),gravelT:sum(entry=>entry.gravelUnit==='tonnes',entry=>entry.gravelQuantity??0),
    calculatedRecords:entries.filter(entry=>entry.volume).length,
  };
}
