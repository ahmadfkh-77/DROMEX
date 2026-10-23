import type {SQLiteDatabase} from 'expo-sqlite';

import {
  applyContractItemEdit,cancelContractItem,candidateContractItems,computeContractUsage,finishContractItem,groupContractLoadsByDay,
  reopenContractItem,summarizeContractProject,validateContractAdjustment,validateContractItemDraft,validateContractReason,
  type ContractAdjustment,type ContractHistoryKind,type ContractItem,type ContractItemDraft,type ContractItemValues,
} from '../../domain/contractQuantities';
import {localDateKey} from '../../domain/fuel';
import type {
  ContractFormSetup,ContractHistoryLine,ContractItemDetail,ContractLoadDetail,ContractLoadRef,ContractMaterial,ContractQuantitiesRepository,ContractRowView,
} from './ContractQuantitiesRepository';
import {contractLoadTable,insertContractHistory} from './contractLinks';

type ItemRow={id:string;project_id:string;name:string;unit_id:string;unit_symbol:string;quantity:number;unit_price_usd_cents:number|null;status:'in_progress'|'complete';completed_on:string|null;cancelled_at:string|null};
type LoadRow={id:string;source:'company'|'supplier';reference:string;confirmed_at:string;item_id:string;item_name:string;unit_id:string|null;unit_symbol:string|null;quantity:number|null;status:string|null;contract_item_id:string|null;truck_plate:string|null;driver_name:string|null;party_name:string|null;ticket:string|null};

const makeId=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;

/** The unit a company load is billed in, as Project Totals reads it (DEC-481): the direct unit, or the conversion's output unit. */
const COMPANY_UNIT="CASE WHEN l.quantity_method = 'direct' AND COALESCE(l.conversion_rule,'Entered directly') = 'Entered directly' THEN l.direct_unit_id ELSE c.output_unit_id END";
const COMPANY_LOADS=`SELECT l.id,'company' source,COALESCE(l.load_number,l.transaction_number) reference,l.confirmed_at,l.item_id,l.item_name,${COMPANY_UNIT} unit_id,l.output_unit_symbol unit_symbol,
  l.billed_quantity quantity,COALESCE(l.status,'Active') status,l.contract_item_id,l.truck_plate,l.driver_name,l.customer_name party_name,NULL ticket
  FROM loads l LEFT JOIN conversion_options c ON c.id=l.conversion_id`;
const SUPPLIER_LOADS=`SELECT q.id,'supplier' source,q.purchase_number reference,q.confirmed_at,q.item_id,q.item_name,q.unit_id,COALESCE(q.unit_symbol,'m³') unit_symbol,
  q.quantity_cubic_metres quantity,COALESCE(q.status,'Active') status,q.contract_item_id,q.truck_plate,q.driver_name,q.supplier_name party_name,q.supplier_ticket_number ticket
  FROM quarry_purchases q`;

const itemFromRow=(row:ItemRow,materialIds:string[]):ContractItem=>({
  id:row.id,projectId:row.project_id,name:row.name,unitId:row.unit_id,unitSymbol:row.unit_symbol,quantity:row.quantity,
  unitPriceUsd:row.unit_price_usd_cents==null?null:row.unit_price_usd_cents/100,materialIds,status:row.status,completedOn:row.completed_on,cancelledAt:row.cancelled_at,
});
const loadFromRow=(row:LoadRow):ContractLoadDetail=>({
  id:row.id,source:row.source,reference:row.reference,materialId:row.item_id,
  // A legacy row without a unit id keeps its symbol as the key, so it can never match a real unit by accident.
  unitId:row.unit_id??`symbol:${row.unit_symbol??''}`,unitSymbol:row.unit_symbol??'',
  quantity:row.quantity,date:localDateKey(new Date(row.confirmed_at)),status:row.status==='Cancelled'?'Cancelled':'Active',contractItemId:row.contract_item_id,
  confirmedAt:row.confirmed_at,materialName:row.item_name,truckPlate:row.truck_plate??'',driverName:row.driver_name??'',partyName:row.party_name??'',ticketNumber:row.ticket,
});

/**
 * Contract Quantities on SQLite (DEC-522). Used is never stored: it is read from the loads that point at an item every time, so a
 * correction or a cancellation shows at once. Every change writes its history line and a sync_outbox entry in the same transaction.
 */
export class SqliteContractQuantitiesRepository implements ContractQuantitiesRepository{
  constructor(private readonly db:SQLiteDatabase){}

  async getSetup():Promise<ContractFormSetup>{
    const[materials,units]=await Promise.all([
      this.db.getAllAsync<{id:string;name:string;category_name:string;unit_id:string|null;symbol:string|null}>(`SELECT i.id,i.name,c.name category_name,i.default_unit_id unit_id,u.symbol FROM catalog_items i JOIN categories c ON c.id=i.category_id
        LEFT JOIN measurement_units u ON u.id=i.default_unit_id WHERE i.is_active=1 ORDER BY c.name COLLATE NOCASE,i.name COLLATE NOCASE`),
      this.db.getAllAsync<{id:string;name:string;symbol:string}>('SELECT id,name,symbol FROM measurement_units WHERE is_active=1 ORDER BY name COLLATE NOCASE'),
    ]);
    return{materials:materials.map(row=>({id:row.id,name:row.name,categoryName:row.category_name,unitId:row.unit_id,unitSymbol:row.symbol})),units};
  }

  private async enqueue(entityType:'contractItem'|'contractAdjustment'|'contractLink',entityId:string,payload:unknown,now:string){
    await this.db.runAsync("INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,'upsert',?,?)",entityType,entityId,JSON.stringify(payload),now);
  }

  private async materialIds(itemId:string):Promise<string[]>{
    const rows=await this.db.getAllAsync<{item_id:string}>('SELECT item_id FROM contract_item_materials WHERE contract_item_id=? AND removed_at IS NULL ORDER BY item_id',itemId);
    return rows.map(row=>row.item_id);
  }

  private async item(itemId:string):Promise<ContractItem>{
    const row=await this.db.getFirstAsync<ItemRow>('SELECT * FROM contract_items WHERE id=?',itemId);
    if(!row)throw new Error('The contract item was not found.');
    return itemFromRow(row,await this.materialIds(itemId));
  }

  private async materials(itemId:string):Promise<ContractMaterial[]>{
    const rows=await this.db.getAllAsync<{id:string;name:string;unit_id:string|null;symbol:string|null}>(`SELECT m.item_id id,COALESCE(i.name,m.item_name) name,i.default_unit_id unit_id,u.symbol
      FROM contract_item_materials m LEFT JOIN catalog_items i ON i.id=m.item_id LEFT JOIN measurement_units u ON u.id=i.default_unit_id
      WHERE m.contract_item_id=? AND m.removed_at IS NULL ORDER BY m.item_id`,itemId);
    return rows.map(row=>({id:row.id,name:row.name,unitId:row.unit_id,unitSymbol:row.symbol}));
  }

  private async linkedLoads(itemId:string):Promise<ContractLoadDetail[]>{
    const rows=await this.db.getAllAsync<LoadRow>(`SELECT * FROM (${COMPANY_LOADS} WHERE l.contract_item_id=? UNION ALL ${SUPPLIER_LOADS} WHERE q.contract_item_id=?) ORDER BY confirmed_at DESC`,itemId,itemId);
    return rows.map(loadFromRow);
  }

  private async adjustments(itemId:string):Promise<ContractAdjustment[]>{
    const rows=await this.db.getAllAsync<{id:string;amount:number;reason:string;created_at:string}>('SELECT id,amount,reason,created_at FROM contract_item_adjustments WHERE contract_item_id=? ORDER BY created_at,rowid',itemId);
    return rows.map(row=>({id:row.id,contractItemId:itemId,amount:row.amount,reason:row.reason,createdAt:row.created_at}));
  }

  private async row(item:ContractItem):Promise<ContractRowView&{loads:ContractLoadDetail[]}>{
    const[loads,adjustments,materials]=await Promise.all([this.linkedLoads(item.id),this.adjustments(item.id),this.materials(item.id)]);
    return{item,usage:computeContractUsage(item,loads,adjustments),materials,loads};
  }

  async listProject(projectId:string){
    const rows=await this.db.getAllAsync<{id:string}>('SELECT id FROM contract_items WHERE project_id=? ORDER BY created_at,rowid',projectId);
    const views:ContractRowView[]=[];
    for(const {id} of rows){const {item,usage,materials}=await this.row(await this.item(id));views.push({item,usage,materials});}
    return{rows:views,summary:summarizeContractProject(views)};
  }

  private async editNeedsReason(contractItemId:string):Promise<boolean>{
    const counted=await this.db.getFirstAsync<{n:number}>('SELECT (SELECT COUNT(*) FROM loads WHERE contract_item_id=?)+(SELECT COUNT(*) FROM quarry_purchases WHERE contract_item_id=?)+(SELECT COUNT(*) FROM contract_item_adjustments WHERE contract_item_id=?) n',contractItemId,contractItemId,contractItemId);
    return (counted?.n??0)>0;
  }

  async getItem(contractItemId:string):Promise<ContractItemDetail>{
    const {item,usage,materials,loads}=await this.row(await this.item(contractItemId));
    const history=await this.db.getAllAsync<{id:string;kind:ContractHistoryKind;reason:string|null;details_json:string;created_at:string}>('SELECT id,kind,reason,details_json,created_at FROM contract_item_history WHERE contract_item_id=? ORDER BY created_at DESC,rowid DESC',contractItemId);
    const lines:ContractHistoryLine[]=history.map(line=>{let details:Record<string,unknown>={};try{details=JSON.parse(line.details_json) as Record<string,unknown>;}catch{details={};}return{id:line.id,kind:line.kind,reason:line.reason,details,createdAt:line.created_at};});
    return{item,usage,materials,editNeedsReason:await this.editNeedsReason(contractItemId),history:lines,loadsByDay:groupContractLoadsByDay(item,loads)};
  }

  private async checkedValues(draft:ContractItemDraft):Promise<ContractItemValues&{unitSymbol:string;materialNames:Map<string,string>}>{
    const result=validateContractItemDraft({...draft,materialIds:[...draft.materialIds].sort()});
    if(!result.ok)throw new Error(result.errors.join(' '));
    const unit=await this.db.getFirstAsync<{symbol:string}>('SELECT symbol FROM measurement_units WHERE id=?',result.value.unitId);
    if(!unit)throw new Error('Choose a unit that exists.');
    const materialNames=new Map<string,string>();
    for(const id of result.value.materialIds){
      const material=await this.db.getFirstAsync<{name:string}>('SELECT name FROM catalog_items WHERE id=?',id);
      if(!material)throw new Error('A linked material was not found in the Catalog.');
      materialNames.set(id,material.name);
    }
    return{...result.value,unitSymbol:unit.symbol,materialNames};
  }

  async createItem(projectId:string,draft:ContractItemDraft):Promise<ContractItem>{
    if(!await this.db.getFirstAsync('SELECT 1 one FROM projects WHERE id=?',projectId))throw new Error('Select a project that exists.');
    const values=await this.checkedValues(draft);
    const id=makeId('contract_item'),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO contract_items (id,project_id,name,unit_id,unit_symbol,quantity,unit_price_usd_cents,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        id,projectId,values.name,values.unitId,values.unitSymbol,values.quantity,values.unitPriceUsd==null?null:Math.round(values.unitPriceUsd*100),'in_progress',now,now);
      for(const materialId of values.materialIds)await this.db.runAsync('INSERT INTO contract_item_materials (contract_item_id,item_id,item_name,added_at) VALUES (?,?,?,?)',id,materialId,values.materialNames.get(materialId)!,now);
      const details={name:values.name,quantity:values.quantity,unitSymbol:values.unitSymbol,unitPriceUsd:values.unitPriceUsd,materialIds:values.materialIds};
      await insertContractHistory(this.db,{contractItemId:id,kind:'created',reason:null,details,createdAt:now});
      await this.enqueue('contractItem',id,{id,projectId,...details,change:'created'},now);
    });
    return this.item(id);
  }

  async editItem(contractItemId:string,draft:ContractItemDraft,reason:string):Promise<ContractItem>{
    const current=await this.item(contractItemId);
    if(current.cancelledAt)throw new Error('A cancelled contract item cannot be edited.');
    const values=await this.checkedValues(draft);
    const removed=current.materialIds.filter(id=>!values.materialIds.includes(id));
    for(const materialId of removed){
      const used=await this.db.getFirstAsync<{name:string}>(`SELECT item_name name FROM (${COMPANY_LOADS} WHERE l.contract_item_id=? AND l.item_id=? UNION ALL ${SUPPLIER_LOADS} WHERE q.contract_item_id=? AND q.item_id=?) LIMIT 1`,contractItemId,materialId,contractItemId,materialId);
      if(used)throw new Error(`${used.name} has loads counted in this contract item. Move or remove those loads first.`);
    }
    const now=new Date();
    const {item,entry}=applyContractItemEdit(current,{name:values.name,unitId:values.unitId,unitSymbol:values.unitSymbol,quantity:values.quantity,unitPriceUsd:values.unitPriceUsd,materialIds:values.materialIds},{hasHistory:await this.editNeedsReason(contractItemId),reason,now});
    const stamp=now.toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE contract_items SET name=?,unit_id=?,unit_symbol=?,quantity=?,unit_price_usd_cents=?,updated_at=? WHERE id=?',
        item.name,item.unitId,item.unitSymbol,item.quantity,item.unitPriceUsd==null?null:Math.round(item.unitPriceUsd*100),stamp,contractItemId);
      for(const materialId of removed)await this.db.runAsync('UPDATE contract_item_materials SET removed_at=? WHERE contract_item_id=? AND item_id=?',stamp,contractItemId,materialId);
      for(const materialId of values.materialIds.filter(id=>!current.materialIds.includes(id))){
        const existing=await this.db.getFirstAsync('SELECT 1 one FROM contract_item_materials WHERE contract_item_id=? AND item_id=?',contractItemId,materialId);
        if(existing)await this.db.runAsync('UPDATE contract_item_materials SET removed_at=NULL,item_name=? WHERE contract_item_id=? AND item_id=?',values.materialNames.get(materialId)!,contractItemId,materialId);
        else await this.db.runAsync('INSERT INTO contract_item_materials (contract_item_id,item_id,item_name,added_at) VALUES (?,?,?,?)',contractItemId,materialId,values.materialNames.get(materialId)!,stamp);
      }
      await insertContractHistory(this.db,{contractItemId,kind:entry.kind,reason:entry.reason,details:entry.details,createdAt:stamp});
      await this.enqueue('contractItem',contractItemId,{id:contractItemId,change:'edited',reason:entry.reason,...entry.details},stamp);
    });
    return this.item(contractItemId);
  }

  async cancelItem(contractItemId:string,reason:string):Promise<ContractItem>{
    const now=new Date();
    const {item,entry}=cancelContractItem(await this.item(contractItemId),reason,now);
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('UPDATE contract_items SET cancelled_at=?,cancellation_reason=?,updated_at=? WHERE id=?',item.cancelledAt,entry.reason,item.cancelledAt,contractItemId);
      await insertContractHistory(this.db,{contractItemId,kind:entry.kind,reason:entry.reason,details:entry.details,createdAt:entry.createdAt});
      await this.enqueue('contractItem',contractItemId,{id:contractItemId,change:'cancelled',reason:entry.reason},entry.createdAt);
    });
    return this.item(contractItemId);
  }

  async finishItem(contractItemId:string,completedOn:string):Promise<ContractItem>{
    const now=new Date();
    if(/^\d{4}-\d{2}-\d{2}$/.test(completedOn)&&completedOn>localDateKey(now))throw new Error('Choose today or a past day for the finish.');
    const {item:current,usage}=await this.row(await this.item(contractItemId));
    const {item,entry}=finishContractItem(current,usage,completedOn,now);
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync("UPDATE contract_items SET status='complete',completed_on=?,updated_at=? WHERE id=?",item.completedOn,entry.createdAt,contractItemId);
      await insertContractHistory(this.db,{contractItemId,kind:entry.kind,reason:entry.reason,details:entry.details,createdAt:entry.createdAt});
      await this.enqueue('contractItem',contractItemId,{id:contractItemId,change:'finished',...entry.details},entry.createdAt);
    });
    return this.item(contractItemId);
  }

  async reopenItem(contractItemId:string,reason:string):Promise<ContractItem>{
    const {item,entry}=reopenContractItem(await this.item(contractItemId),reason,new Date());
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync("UPDATE contract_items SET status='in_progress',completed_on=NULL,updated_at=? WHERE id=?",entry.createdAt,contractItemId);
      await insertContractHistory(this.db,{contractItemId,kind:entry.kind,reason:entry.reason,details:entry.details,createdAt:entry.createdAt});
      await this.enqueue('contractItem',contractItemId,{id:contractItemId,change:'reopened',reason:entry.reason},entry.createdAt);
    });
    return item;
  }

  async addAdjustment(contractItemId:string,input:{amount:string;reason:string}):Promise<void>{
    const {item,usage}=await this.row(await this.item(contractItemId));
    if(item.cancelledAt)throw new Error('A cancelled contract item cannot be adjusted.');
    const {amount,reason}=validateContractAdjustment(input,usage);
    const id=makeId('contract_adjustment'),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync('INSERT INTO contract_item_adjustments (id,contract_item_id,amount,reason,created_at) VALUES (?,?,?,?,?)',id,contractItemId,amount,reason,now);
      await insertContractHistory(this.db,{contractItemId,kind:'adjusted',reason,details:{adjustmentId:id,amount,usedBefore:usage.used,usedAfter:Math.round((usage.used+amount)*1e6)/1e6},createdAt:now});
      await this.enqueue('contractAdjustment',id,{id,contractItemId,amount,reason},now);
    });
  }

  private async loadRow(ref:ContractLoadRef):Promise<LoadRow&{project_id:string|null}>{
    const sql=ref.source==='company'?`SELECT x.*,p.project_id FROM (${COMPANY_LOADS} WHERE l.id=?) x JOIN loads p ON p.id=x.id`:`SELECT x.*,p.project_id FROM (${SUPPLIER_LOADS} WHERE q.id=?) x JOIN quarry_purchases p ON p.id=x.id`;
    const row=await this.db.getFirstAsync<LoadRow&{project_id:string|null}>(sql,ref.loadId);
    if(!row)throw new Error('The load was not found.');
    return row;
  }

  /** The checks a load must pass to count toward an item: an open item of the load's own project that lists the load's material. */
  private async assertCanCount(item:ContractItem,load:LoadRow&{project_id:string|null}){
    if(item.cancelledAt)throw new Error('This contract item is cancelled.');
    if(load.status==='Cancelled')throw new Error('A cancelled load cannot be linked.');
    if(load.project_id!==item.projectId)throw new Error('This load belongs to another project.');
    if(!item.materialIds.includes(load.item_id))throw new Error(`${load.item_name} is not one of the materials of this contract item.`);
  }

  async linkLoad(contractItemId:string,ref:ContractLoadRef,reason:string):Promise<void>{
    await this.linkLoads(contractItemId,[ref],reason);
  }

  async linkLoads(contractItemId:string,refs:ContractLoadRef[],reason:string):Promise<void>{
    if(!refs.length)throw new Error('Tick at least one load.');
    const item=await this.item(contractItemId),rows:{ref:ContractLoadRef;load:LoadRow&{project_id:string|null}}[]=[];
    for(const ref of refs){
      const load=await this.loadRow(ref);
      await this.assertCanCount(item,load);
      if(load.contract_item_id===contractItemId)throw new Error('This load already counts toward this contract item.');
      if(load.contract_item_id)throw new Error(`${load.reference} already counts toward another contract item. Move it instead.`);
      rows.push({ref,load});
    }
    const clean=validateContractReason(reason,'linking a load to'),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      for(const {ref,load} of rows){
        await this.db.runAsync(`UPDATE ${contractLoadTable(ref.source)} SET contract_item_id=? WHERE id=?`,contractItemId,ref.loadId);
        await insertContractHistory(this.db,{contractItemId,kind:'load_linked',reason:clean,details:{source:ref.source,loadId:ref.loadId,reference:load.reference},createdAt:now});
        await this.enqueue('contractLink',ref.loadId,{source:ref.source,loadId:ref.loadId,contractItemId,reason:clean},now);
      }
    });
  }

  async moveLoad(ref:ContractLoadRef,toContractItemId:string,reason:string):Promise<void>{
    const load=await this.loadRow(ref);
    if(!load.contract_item_id)throw new Error('This load is not linked to a contract item.');
    if(load.contract_item_id===toContractItemId)throw new Error('This load already counts toward this contract item.');
    const target=await this.item(toContractItemId);
    await this.assertCanCount(target,load);
    const from=load.contract_item_id,clean=validateContractReason(reason,'moving a load to'),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`UPDATE ${contractLoadTable(ref.source)} SET contract_item_id=? WHERE id=?`,toContractItemId,ref.loadId);
      const details={source:ref.source,loadId:ref.loadId,reference:load.reference,fromContractItemId:from,toContractItemId};
      await insertContractHistory(this.db,{contractItemId:from,kind:'load_moved',reason:clean,details,createdAt:now});
      await insertContractHistory(this.db,{contractItemId:toContractItemId,kind:'load_moved',reason:clean,details,createdAt:now});
      await this.enqueue('contractLink',ref.loadId,{source:ref.source,loadId:ref.loadId,contractItemId:toContractItemId,from,reason:clean},now);
    });
  }

  async unlinkLoad(ref:ContractLoadRef,reason:string):Promise<void>{
    const load=await this.loadRow(ref);
    if(!load.contract_item_id)throw new Error('This load is not linked to a contract item.');
    const from=load.contract_item_id,clean=validateContractReason(reason,'removing a load from'),now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync(`UPDATE ${contractLoadTable(ref.source)} SET contract_item_id=NULL WHERE id=?`,ref.loadId);
      await insertContractHistory(this.db,{contractItemId:from,kind:'load_unlinked',reason:clean,details:{source:ref.source,loadId:ref.loadId,reference:load.reference},createdAt:now});
      await this.enqueue('contractLink',ref.loadId,{source:ref.source,loadId:ref.loadId,contractItemId:null,from,reason:clean},now);
    });
  }

  async linkableLoads(contractItemId:string):Promise<ContractLoadDetail[]>{
    const item=await this.item(contractItemId);
    if(item.cancelledAt||!item.materialIds.length)return [];
    const marks=item.materialIds.map(()=>'?').join(',');
    const rows=await this.db.getAllAsync<LoadRow>(`SELECT * FROM (
        ${COMPANY_LOADS} WHERE l.contract_item_id IS NULL AND l.project_id=? AND COALESCE(l.is_archived,0)=0 AND COALESCE(l.status,'Active')='Active' AND l.item_id IN (${marks})
        UNION ALL ${SUPPLIER_LOADS} WHERE q.contract_item_id IS NULL AND q.project_id=? AND COALESCE(q.status,'Active')='Active' AND q.item_id IN (${marks})
      ) ORDER BY confirmed_at DESC`,item.projectId,...item.materialIds,item.projectId,...item.materialIds);
    return rows.map(loadFromRow);
  }

  async candidatesFor(projectId:string|null,materialId:string){
    if(!projectId)return{candidates:[],preselectedId:null};
    const rows=await this.db.getAllAsync<{id:string}>('SELECT id FROM contract_items WHERE project_id=? AND cancelled_at IS NULL ORDER BY created_at,rowid',projectId);
    const items:ContractItem[]=[];for(const {id} of rows)items.push(await this.item(id));
    return candidateContractItems(items,projectId,materialId);
  }
}
