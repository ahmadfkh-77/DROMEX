import type {SQLiteDatabase} from 'expo-sqlite';
import {paymentStatus,summarizeMoneyBlock,validateOpeningBalance,validatePayment,type FinancialOverview,type FinancialParty,type FinancialPartyType,type FinancialTarget,type FinancialTargetType,type OpeningBalanceDraft,type PaymentDraft,type PaymentEntry,type ProjectFinancialSummary,type ProjectMoneyBlock,type ProjectFuelCost,type UncostedQuantity} from '../../domain/financials';
import {planAllocation,planApplyUnallocated,validateAccountPaymentDraft,validateOpeningBalanceCancellation,type AccountLedger,type AccountPayment,type AccountPaymentDraft,type ApplicationMode,type ApplyUnallocatedDraft,type CancelledOpeningBalance,type PaymentMethod} from '../../domain/accountPayments';
import type {FinancialRepository} from './FinancialRepository';

type PaymentRow={id:string;target_type:FinancialTargetType;target_id:string;amount_usd_cents:number;payment_date:string;status:'Active'|'Cancelled';cancellation_reason:string|null;cancelled_at:string|null;created_at:string;account_payment_id?:string|null};
type AccountPaymentRow={id:string;party_type:FinancialPartyType;party_id:string;party_name:string;amount_usd_cents:number;payment_date:string;method:PaymentMethod;reference:string|null;notes:string|null;application_mode:ApplicationMode;status:'Active'|'Cancelled';cancellation_reason:string|null;cancelled_at:string|null;created_at:string};
type CancelledOpeningRow={id:string;party_type:FinancialPartyType;party_id:string;party_name:string;reference:string;amount_cents:number;as_of_date:string;cancellation_reason:string|null;cancelled_at:string|null;status_before_cancellation:string|null};
const PAYMENT_COLUMNS=`id,target_type,CASE target_type WHEN 'load' THEN load_id WHEN 'quarryPurchase' THEN quarry_purchase_id WHEN 'fuelDelivery' THEN fuel_movement_id ELSE opening_balance_id END target_id,amount_usd_cents,payment_date,status,cancellation_reason,cancelled_at,created_at,account_payment_id`;
type TargetRow={id:string;type:FinancialTargetType;party_id:string;party_name:string;party_type:FinancialPartyType;reference:string;record_date:string;project_id:string|null;project_name:string|null;project_status:string|null;item_name:string|null;quantity:number|null;unit_symbol:string|null;total_cents:number};
// One definition of "a load that counts financially", shared by the business-wide overview and the
// project-scoped rollup so the two can never disagree about which records are included.
const loadTargetSql=(scopedToProject:boolean)=>`SELECT l.id,'load' type,l.customer_id party_id,l.customer_name party_name,'customer' party_type,l.transaction_number reference,l.confirmed_at record_date,l.project_id,l.project_name,p.status project_status,l.item_name,l.billed_quantity quantity,l.output_unit_symbol unit_symbol,l.final_total_usd_cents total_cents FROM loads l LEFT JOIN projects p ON p.id=l.project_id WHERE l.final_total_usd_cents IS NOT NULL AND l.is_archived=0 AND l.status='Active'${scopedToProject?' AND l.project_id=?':''}`;
const makeId=(prefix:string)=>`${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
const clean=(value:string)=>value.trim()||null;
function paymentFromRow(row:PaymentRow):PaymentEntry{return{id:row.id,targetType:row.target_type,targetId:row.target_id,amountUsd:row.amount_usd_cents/100,paymentDate:row.payment_date,status:row.status,cancellationReason:row.cancellation_reason,cancelledAt:row.cancelled_at,createdAt:row.created_at,accountPaymentId:row.account_payment_id??null};}

export class SqliteFinancialRepository implements FinancialRepository{
  constructor(private readonly db:SQLiteDatabase){}
  async getOverview():Promise<FinancialOverview&AccountLedger>{
    const [customers,suppliers,loads,purchases,fuelDeliveries,openings,paymentRows,accountRows,cancelledRows]=await Promise.all([
      this.db.getAllAsync<{id:string;name:string}>('SELECT id,name FROM customers WHERE merged_into_id IS NULL ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<{id:string;name:string}>('SELECT id,name FROM suppliers ORDER BY name COLLATE NOCASE'),
      this.db.getAllAsync<TargetRow>(loadTargetSql(false)),
      this.db.getAllAsync<TargetRow>(`SELECT id,'quarryPurchase' type,supplier_id party_id,supplier_name party_name,'supplier' party_type,purchase_number reference,confirmed_at record_date,NULL project_id,NULL project_name,NULL project_status,item_name,quantity_cubic_metres quantity,COALESCE(unit_symbol,'m³') unit_symbol,final_total_usd_cents total_cents FROM quarry_purchases WHERE final_total_usd_cents IS NOT NULL AND status='Active'`),
      this.db.getAllAsync<TargetRow>(`SELECT id,'fuelDelivery' type,supplier_id party_id,supplier_name party_name,'supplier' party_type,COALESCE(ticket_number,'Fuel delivery') reference,confirmed_at record_date,NULL project_id,NULL project_name,NULL project_status,'Fuel' item_name,litres quantity,'L' unit_symbol,final_total_usd_cents total_cents FROM fuel_movements WHERE movement_type='delivery' AND supplier_id IS NOT NULL AND final_total_usd_cents IS NOT NULL AND status='Active'`),
      this.db.getAllAsync<TargetRow>(`SELECT id,'openingBalance' type,CASE party_type WHEN 'customer' THEN customer_id ELSE supplier_id END party_id,party_name,party_type,COALESCE(reference,'Opening Balance') reference,as_of_date record_date,NULL project_id,NULL project_name,NULL project_status,NULL item_name,NULL quantity,NULL unit_symbol,original_amount_usd_cents total_cents FROM opening_balances WHERE status='Active'`),
      this.db.getAllAsync<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payment_entries ORDER BY payment_date DESC,created_at DESC`),
      this.db.getAllAsync<AccountPaymentRow>(`SELECT id,party_type,CASE party_type WHEN 'customer' THEN customer_id ELSE supplier_id END party_id,party_name,amount_usd_cents,payment_date,method,reference,notes,application_mode,status,cancellation_reason,cancelled_at,created_at FROM account_payments ORDER BY payment_date DESC,created_at DESC`),
      this.db.getAllAsync<CancelledOpeningRow>(`SELECT id,party_type,CASE party_type WHEN 'customer' THEN customer_id ELSE supplier_id END party_id,party_name,COALESCE(reference,'Opening Balance') reference,original_amount_usd_cents amount_cents,as_of_date,cancellation_reason,cancelled_at,status_before_cancellation FROM opening_balances WHERE status='Cancelled' ORDER BY cancelled_at DESC`),
    ]);
    const parties:FinancialParty[]=[...customers.map((v)=>({...v,type:'customer' as const})),...suppliers.map((v)=>({...v,type:'supplier' as const}))];
    const payments=paymentRows.map(paymentFromRow);
    const targets=this.buildTargets([...loads,...purchases,...fuelDeliveries,...openings],payments);
    const cancelledOpenings=cancelledRows.map((row):CancelledOpeningBalance=>({id:row.id,partyType:row.party_type,partyId:row.party_id,partyName:row.party_name,reference:row.reference,amountUsd:row.amount_cents/100,asOfDate:row.as_of_date,cancellationReason:row.cancellation_reason??'',cancelledAt:row.cancelled_at??'',statusBeforeCancellation:(row.status_before_cancellation as CancelledOpeningBalance['statusBeforeCancellation'])??null}));
    // References for allocation lines: live records first, then cancelled Open Balances, so a line
    // stays readable after its record leaves the active totals.
    const references=new Map<string,string>([...targets.map(target=>[`${target.type}|${target.id}`,target.reference] as const),...cancelledOpenings.map(opening=>[`openingBalance|${opening.id}`,opening.reference] as const)]);
    const linesByPayment=new Map<string,PaymentEntry[]>();
    for(const payment of payments)if(payment.accountPaymentId){const bucket=linesByPayment.get(payment.accountPaymentId);if(bucket)bucket.push(payment);else linesByPayment.set(payment.accountPaymentId,[payment]);}
    const accountPayments=accountRows.map((row):AccountPayment=>{
      const lines=linesByPayment.get(row.id)??[];
      const allocatedCents=lines.filter(line=>line.status==='Active').reduce((sum,line)=>sum+Math.round(line.amountUsd*100),0);
      return{id:row.id,partyType:row.party_type,partyId:row.party_id,partyName:row.party_name,amountUsd:row.amount_usd_cents/100,paymentDate:row.payment_date,method:row.method,reference:row.reference,note:row.notes,mode:row.application_mode,status:row.status,cancellationReason:row.cancellation_reason,cancelledAt:row.cancelled_at,createdAt:row.created_at,
        allocations:lines.map(line=>({paymentEntryId:line.id,targetType:line.targetType,targetId:line.targetId,reference:references.get(`${line.targetType}|${line.targetId}`)??'Record',amountUsd:line.amountUsd,status:line.status,createdAt:line.createdAt})),
        allocatedUsd:allocatedCents/100,unallocatedUsd:row.status==='Active'?Math.max(0,row.amount_usd_cents-allocatedCents)/100:0};
    });
    return{parties,targets:targets.sort((a,b)=>b.recordDate.localeCompare(a.recordDate)),accountPayments,cancelledOpenings};
  }

  /** DEC-483. Cancels (never deletes) an Open Balance; refused while any of its payments is active. */
  async cancelOpeningBalance(id:string,reason:string):Promise<void>{
    const row=await this.db.getFirstAsync<{status:string;payment_status:string;active:number}>(`SELECT status,payment_status,(SELECT COUNT(*) FROM payment_entries WHERE opening_balance_id=opening_balances.id AND status='Active') active FROM opening_balances WHERE id=?`,id);
    if(!row)throw new Error('Open Balance was not found.');
    if(row.status==='Cancelled')throw new Error('This Open Balance is already cancelled.');
    const issues=validateOpeningBalanceCancellation(reason,row.active);
    if(issues.length)throw new Error(issues.join('\n'));
    const now=new Date().toISOString();const cleanReason=reason.trim();
    await this.db.withTransactionAsync(async()=>{
      // Re-checked inside the transaction so a payment saved a moment ago cannot slip past the rule.
      const again=await this.db.getFirstAsync<{active:number}>(`SELECT COUNT(*) active FROM payment_entries WHERE opening_balance_id=? AND status='Active'`,id);
      if((again?.active??0)>0)throw new Error(validateOpeningBalanceCancellation(cleanReason,again?.active??0).join('\n'));
      await this.db.runAsync(`UPDATE opening_balances SET status='Cancelled',cancellation_reason=?,cancelled_at=?,status_before_cancellation=? WHERE id=? AND status='Active'`,cleanReason,now,row.payment_status,id);
      await this.enqueue('openingBalance',id,{id,status:'Cancelled',statusBefore:'Active',statusBeforeCancellation:row.payment_status,cancellationReason:cleanReason,cancelledAt:now});
    });
  }

  /**
   * DEC-482. Records one real payment for an account and applies it as planned. The plan is rebuilt
   * from the current records and every allocation re-checked against the record's live remaining
   * balance inside the same transaction; nothing is saved if any check fails.
   */
  async recordAccountPayment(draft:AccountPaymentDraft):Promise<AccountPayment>{
    const issues=validateAccountPaymentDraft(draft);
    if(issues.length)throw new Error(issues.join('\n'));
    const overview=await this.getOverview();
    const party=overview.parties.find(value=>value.id===draft.partyId&&value.type===draft.partyType);
    if(!party)throw new Error(`Select a ${draft.partyType}.`);
    const open=overview.targets.filter(target=>target.partyType===draft.partyType&&target.partyId===draft.partyId&&target.remainingUsd>0);
    const plan=planAllocation(draft,open);
    if(plan.issues.length)throw new Error(plan.issues.join('\n'));
    const id=makeId('account_payment');const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      for(const line of plan.allocations){
        const current=await this.currentTargetBalance(line.targetType,line.targetId);
        if(!current||line.amountCents>current.remainingCents)throw new Error(`${line.reference} changed while you were entering this payment. Refresh and try again.`);
      }
      await this.db.runAsync(`INSERT INTO account_payments (id,party_type,customer_id,supplier_id,party_name,amount_usd_cents,payment_date,method,reference,notes,application_mode,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,draft.partyType,draft.partyType==='customer'?party.id:null,draft.partyType==='supplier'?party.id:null,party.name,plan.amountCents,draft.paymentDate,draft.method,clean(draft.reference),clean(draft.note),draft.mode,now);
      await this.enqueue('accountPayment',id,{id,partyType:draft.partyType,partyId:party.id,partyName:party.name,amountUsd:plan.amountCents/100,paymentDate:draft.paymentDate,method:draft.method,reference:clean(draft.reference),note:clean(draft.note),mode:draft.mode,createdAt:now});
      for(const line of plan.allocations){
        const entryId=makeId('payment');
        await this.db.runAsync(`INSERT INTO payment_entries (id,target_type,load_id,quarry_purchase_id,opening_balance_id,fuel_movement_id,amount_usd_cents,payment_date,created_at,account_payment_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          entryId,line.targetType,line.targetType==='load'?line.targetId:null,line.targetType==='quarryPurchase'?line.targetId:null,line.targetType==='openingBalance'?line.targetId:null,line.targetType==='fuelDelivery'?line.targetId:null,line.amountCents,draft.paymentDate,now,id);
        await this.updateTargetStatus(line.targetType,line.targetId);
        await this.enqueue('payment',entryId,{id:entryId,targetType:line.targetType,targetId:line.targetId,amountUsd:line.amountCents/100,paymentDate:draft.paymentDate,accountPaymentId:id,createdAt:now});
      }
    });
    return (await this.getOverview()).accountPayments.find(payment=>payment.id===id)!;
  }

  /**
   * DEC-485. Applies part or all of a payment's unallocated money to the account's records, as new
   * linked payment_entries. The original payment (amount, date, method, reference, mode) is never
   * changed; the unallocated amount and each record's remaining balance are re-read inside the
   * transaction, and an audit entry records what was applied and the unallocated amount before/after.
   */
  async applyUnallocatedPayment(paymentId:string,draft:ApplyUnallocatedDraft):Promise<AccountPayment>{
    const overview=await this.getOverview();
    const payment=overview.accountPayments.find(value=>value.id===paymentId);
    if(!payment)throw new Error('Payment was not found.');
    const open=overview.targets.filter(target=>target.partyType===payment.partyType&&target.partyId===payment.partyId&&target.remainingUsd>0);
    const plan=planApplyUnallocated(payment,draft,open);
    if(plan.issues.length)throw new Error(plan.issues.join('\n'));
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      const current=await this.db.getFirstAsync<{status:string;amount:number;allocated:number}>(`SELECT status,amount_usd_cents amount,(SELECT COALESCE(SUM(amount_usd_cents),0) FROM payment_entries WHERE account_payment_id=account_payments.id AND status='Active') allocated FROM account_payments WHERE id=?`,paymentId);
      if(!current||current.status!=='Active')throw new Error('A cancelled payment cannot be applied to records.');
      const before=current.amount-current.allocated;
      if(plan.allocatedCents>before)throw new Error('This payment changed while you were applying it. Refresh and try again.');
      for(const line of plan.allocations){
        const balance=await this.currentTargetBalance(line.targetType,line.targetId);
        if(!balance||line.amountCents>balance.remainingCents)throw new Error(`${line.reference} changed while you were applying this payment. Refresh and try again.`);
        const entryId=makeId('payment');
        await this.db.runAsync(`INSERT INTO payment_entries (id,target_type,load_id,quarry_purchase_id,opening_balance_id,fuel_movement_id,amount_usd_cents,payment_date,created_at,account_payment_id) VALUES (?,?,?,?,?,?,?,?,?,?)`,
          entryId,line.targetType,line.targetType==='load'?line.targetId:null,line.targetType==='quarryPurchase'?line.targetId:null,line.targetType==='openingBalance'?line.targetId:null,line.targetType==='fuelDelivery'?line.targetId:null,line.amountCents,payment.paymentDate,now,paymentId);
        await this.updateTargetStatus(line.targetType,line.targetId);
        await this.enqueue('payment',entryId,{id:entryId,targetType:line.targetType,targetId:line.targetId,amountUsd:line.amountCents/100,paymentDate:payment.paymentDate,accountPaymentId:paymentId,createdAt:now});
      }
      await this.enqueue('accountPayment',paymentId,{id:paymentId,action:'applyUnallocated',mode:draft.mode,appliedUsd:plan.allocatedCents/100,unallocatedBeforeUsd:before/100,unallocatedAfterUsd:(before-plan.allocatedCents)/100,appliedAt:now,records:plan.allocations.map(line=>({targetType:line.targetType,targetId:line.targetId,amountUsd:line.amountCents/100}))});
    });
    return (await this.getOverview()).accountPayments.find(value=>value.id===paymentId)!;
  }

  /** Cancels a whole account payment and every amount it applied, together; all stays in history. */
  async cancelAccountPayment(id:string,reason:string):Promise<void>{
    const cleanReason=reason.trim();
    if(!cleanReason)throw new Error('Cancellation reason is required.');
    const row=await this.db.getFirstAsync<{status:string}>('SELECT status FROM account_payments WHERE id=?',id);
    if(!row)throw new Error('Payment was not found.');
    if(row.status==='Cancelled')throw new Error('A cancelled payment cannot be changed.');
    const lines=await this.db.getAllAsync<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payment_entries WHERE account_payment_id=? AND status='Active'`,id);
    const now=new Date().toISOString();
    await this.db.withTransactionAsync(async()=>{
      await this.db.runAsync("UPDATE account_payments SET status='Cancelled',cancellation_reason=?,cancelled_at=? WHERE id=?",cleanReason,now,id);
      await this.enqueue('accountPayment',id,{id,status:'Cancelled',cancellationReason:cleanReason,cancelledAt:now});
      for(const line of lines){
        await this.db.runAsync("UPDATE payment_entries SET status='Cancelled',cancellation_reason=?,cancelled_at=? WHERE id=?",cleanReason,now,line.id);
        await this.updateTargetStatus(line.target_type,line.target_id);
        await this.enqueue('payment',line.id,{id:line.id,status:'Cancelled',cancellationReason:cleanReason,cancelledAt:now});
      }
    });
  }

  // Index payments by target once: filtering the whole payment list per target is quadratic and
  // reaches ~100s at the 73,000-load acceptance scale. Insertion order preserves the query's
  // payment_date DESC, created_at DESC ordering inside each bucket.
  private buildTargets(rows:TargetRow[],payments:PaymentEntry[]):FinancialTarget[]{
    const paymentsByTarget=new Map<string,PaymentEntry[]>(); for(const payment of payments){const key=`${payment.targetType}|${payment.targetId}`;const bucket=paymentsByTarget.get(key);if(bucket)bucket.push(payment);else paymentsByTarget.set(key,[payment]);}
    return rows.map((row):FinancialTarget=>{const linked=paymentsByTarget.get(`${row.type}|${row.id}`)??[];const paidCents=linked.filter((p)=>p.status==='Active').reduce((sum,p)=>sum+Math.round(p.amountUsd*100),0);const remainingCents=Math.max(0,row.total_cents-paidCents);const overpaidCents=Math.max(0,paidCents-row.total_cents);return{id:row.id,type:row.type,partyId:row.party_id,partyName:row.party_name,partyType:row.party_type,reference:row.reference,recordDate:row.record_date,projectId:row.project_id,projectName:row.project_name,projectStatus:row.project_status,itemName:row.item_name,quantity:row.quantity,unitSymbol:row.unit_symbol,totalUsd:row.total_cents/100,paidUsd:paidCents/100,remainingUsd:remainingCents/100,overpaidUsd:overpaidCents/100,status:paymentStatus(row.total_cents,paidCents),payments:linked};});
  }

  // Revenue-only, read-only project rollup: company loads billed to the project's customer. Supplier
  // purchases, fuel deliveries and opening balances carry no project and are intentionally absent.
  async getProjectFinancials(projectId:string):Promise<ProjectFinancialSummary>{
    const [rows,paymentRows,excluded]=await Promise.all([
      this.db.getAllAsync<TargetRow>(loadTargetSql(true),projectId),
      this.db.getAllAsync<PaymentRow>(`SELECT p.id,p.target_type,p.load_id target_id,p.amount_usd_cents,p.payment_date,p.status,p.cancellation_reason,p.cancelled_at,p.created_at FROM payment_entries p JOIN loads l ON l.id=p.load_id WHERE p.target_type='load' AND l.project_id=? AND l.final_total_usd_cents IS NOT NULL AND l.is_archived=0 AND l.status='Active' ORDER BY p.payment_date DESC,p.created_at DESC`,projectId),
      this.db.getFirstAsync<{cancelled:number;unpriced:number}>(`SELECT (SELECT COUNT(*) FROM loads WHERE project_id=? AND is_archived=0 AND status='Cancelled') cancelled,(SELECT COUNT(*) FROM loads WHERE project_id=? AND is_archived=0 AND status='Active' AND final_total_usd_cents IS NULL) unpriced`,projectId,projectId),
    ]);
    const targets=this.buildTargets(rows,paymentRows.map(paymentFromRow)).sort((a,b)=>b.recordDate.localeCompare(a.recordDate));
    const revenue=summarizeMoneyBlock(targets,{cancelled:excluded?.cancelled??0,unpriced:excluded?.unpriced??0});
    const [supplierPayables,fuel,uncosted]=await Promise.all([this.projectSupplierPayables(projectId),this.projectFuelCost(projectId),this.projectUncostedQuantities(projectId)]);
    return{projectId,revenue,supplierPayables,fuel,uncosted};
  }

  // Supplier loads carry project_id on the record; getOverview() deliberately reports them without a
  // project, so project attribution lives here only and the global Financials screens are unchanged.
  private async projectSupplierPayables(projectId:string):Promise<ProjectMoneyBlock>{
    const [rows,paymentRows,excluded]=await Promise.all([
      this.db.getAllAsync<TargetRow>(`SELECT id,'quarryPurchase' type,supplier_id party_id,supplier_name party_name,'supplier' party_type,purchase_number reference,confirmed_at record_date,project_id,project_name,NULL project_status,item_name,quantity_cubic_metres quantity,COALESCE(unit_symbol,'m³') unit_symbol,final_total_usd_cents total_cents FROM quarry_purchases WHERE project_id=? AND final_total_usd_cents IS NOT NULL AND status='Active'`,projectId),
      this.db.getAllAsync<PaymentRow>(`SELECT p.id,p.target_type,p.quarry_purchase_id target_id,p.amount_usd_cents,p.payment_date,p.status,p.cancellation_reason,p.cancelled_at,p.created_at FROM payment_entries p JOIN quarry_purchases q ON q.id=p.quarry_purchase_id WHERE p.target_type='quarryPurchase' AND q.project_id=? AND q.final_total_usd_cents IS NOT NULL AND q.status='Active' ORDER BY p.payment_date DESC,p.created_at DESC`,projectId),
      this.db.getFirstAsync<{cancelled:number;unpriced:number}>(`SELECT (SELECT COUNT(*) FROM quarry_purchases WHERE project_id=? AND status='Cancelled') cancelled,(SELECT COUNT(*) FROM quarry_purchases WHERE project_id=? AND status='Active' AND final_total_usd_cents IS NULL) unpriced`,projectId,projectId),
    ]);
    const targets=this.buildTargets(rows,paymentRows.map(paymentFromRow)).sort((a,b)=>b.recordDate.localeCompare(a.recordDate));
    return summarizeMoneyBlock(targets,{cancelled:excluded?.cancelled??0,unpriced:excluded?.unpriced??0});
  }

  // Fuel fills are project-linked consumption, not supplier debt: a fuel delivery fills the shared
  // tank and carries no project, so project fuel is reported as cost only (DEC-392).
  private async projectFuelCost(projectId:string):Promise<ProjectFuelCost>{
    const row=await this.db.getFirstAsync<{litres:number|null;cost:number|null;unpriced:number|null;fills:number}>(`SELECT COALESCE(SUM(litres),0) litres,COALESCE(SUM(consumption_cost_usd_cents),0) cost,COALESCE(SUM(CASE WHEN consumption_cost_usd_cents IS NULL THEN litres ELSE 0 END),0) unpriced,COUNT(*) fills FROM fuel_movements WHERE project_id=? AND movement_type='fill' AND status='Active'`,projectId);
    return{litres:row?.litres??0,costUsd:(row?.cost??0)/100,unpricedLitres:row?.unpriced??0,fillCount:row?.fills??0};
  }

  // Recorded quantities that carry no price anywhere in the product (DEC-155). Returned without any
  // money field so they can never be rendered as a zero cost.
  private async projectUncostedQuantities(projectId:string):Promise<UncostedQuantity[]>{
    const [walls,pavement,waste]=await Promise.all([
      this.db.getFirstAsync<{concrete:number|null;cement:number|null;sand:number|null;gravel:number|null;stone:number|null}>(`SELECT COALESCE(SUM(c.finished_volume_m3),0) concrete,COALESCE(SUM(c.cement_bags),0) cement,COALESCE(SUM(c.sand_quantity),0) sand,COALESCE(SUM(c.gravel_quantity),0) gravel,COALESCE(SUM(c.stone_quantity),0) stone FROM wall_consumptions c JOIN walls w ON w.id=c.wall_id WHERE w.project_id=?`,projectId),
      this.db.getFirstAsync<{area:number|null;count:number}>(`SELECT COALESCE(SUM(area_m2),0) area,COUNT(*) count FROM pavement_calculations WHERE project_id=?`,projectId),
      this.db.getAllAsync<{material:string;dumps:number}>(`SELECT material_type material,COUNT(*) dumps FROM waste_dumps WHERE project_id=? AND status='Active' GROUP BY material_type ORDER BY material_type COLLATE NOCASE`,projectId),
    ]);
    const quantities:UncostedQuantity[]=[];
    const wall=(label:string,quantity:number|null|undefined,unit:string)=>{if((quantity??0)>0)quantities.push({source:'Wall materials',label,quantity:Number((quantity??0).toFixed(3)),unit});};
    wall('Concrete',walls?.concrete,'m³');wall('Cement',walls?.cement,'bags');wall('Sand',walls?.sand,'m³');wall('Gravel',walls?.gravel,'m³');wall('Stone',walls?.stone,'m³');
    if((pavement?.area??0)>0)quantities.push({source:'Pavement',label:`Calculated area (${pavement?.count??0} calculation${(pavement?.count??0)===1?'':'s'})`,quantity:Number((pavement?.area??0).toFixed(3)),unit:'m²'});
    for(const row of waste)quantities.push({source:'Waste dumps',label:row.material,quantity:row.dumps,unit:row.dumps===1?'dump':'dumps'});
    return quantities;
  }
  async createOpeningBalance(draft:OpeningBalanceDraft):Promise<FinancialTarget>{const overview=await this.getOverview();const issues=validateOpeningBalance(draft,overview.parties);if(issues.length)throw new Error(issues.join('\n'));const party=overview.parties.find((p)=>p.id===draft.partyId&&p.type===draft.partyType)!;const id=makeId('opening_balance');const now=new Date().toISOString();const cents=Math.round(Number(draft.amountUsd.replace(',','.'))*100);await this.db.withTransactionAsync(async()=>{await this.db.runAsync(`INSERT INTO opening_balances (id,party_type,customer_id,supplier_id,party_name,original_amount_usd_cents,as_of_date,reference,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,id,draft.partyType,draft.partyType==='customer'?party.id:null,draft.partyType==='supplier'?party.id:null,party.name,cents,draft.asOfDate,clean(draft.reference),clean(draft.notes),now);await this.enqueue('openingBalance',id,{id,...draft,partyName:party.name,amountUsd:cents/100,createdAt:now});});return (await this.getOverview()).targets.find((t)=>t.id===id)!;}
  async recordPayment(draft:PaymentDraft):Promise<FinancialTarget>{const overview=await this.getOverview();const target=overview.targets.find((t)=>t.id===draft.targetId&&t.type===draft.targetType)??null;const issues=validatePayment(draft,target);if(issues.length)throw new Error(issues.join('\n'));const id=makeId('payment');const now=new Date().toISOString();const cents=Math.round(Number(draft.amountUsd.replace(',','.'))*100);await this.db.withTransactionAsync(async()=>{const current=await this.currentTargetBalance(draft.targetType,draft.targetId);if(!current)throw new Error('Financial record was not found.');if(cents>current.remainingCents)throw new Error('Payment cannot exceed the current remaining balance. Refresh and try again.');await this.db.runAsync(`INSERT INTO payment_entries (id,target_type,load_id,quarry_purchase_id,opening_balance_id,fuel_movement_id,amount_usd_cents,payment_date,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,id,draft.targetType,draft.targetType==='load'?draft.targetId:null,draft.targetType==='quarryPurchase'?draft.targetId:null,draft.targetType==='openingBalance'?draft.targetId:null,draft.targetType==='fuelDelivery'?draft.targetId:null,cents,draft.paymentDate,now);await this.updateTargetStatus(draft.targetType,draft.targetId);await this.enqueue('payment',id,{id,...draft,amountUsd:cents/100,status:'Active',createdAt:now});});return (await this.getOverview()).targets.find((t)=>t.id===draft.targetId&&t.type===draft.targetType)!;}
  async cancelPayment(paymentId:string,reason:string):Promise<FinancialTarget>{const cleanReason=reason.trim();if(!cleanReason)throw new Error('Cancellation reason is required.');const payment=await this.db.getFirstAsync<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM payment_entries WHERE id=?`,paymentId);if(!payment)throw new Error('Payment was not found.');if(payment.account_payment_id)throw new Error('This amount is part of a larger payment. Cancel that payment instead.');if(payment.status==='Cancelled')throw new Error('A cancelled payment cannot be changed.');const now=new Date().toISOString();await this.db.withTransactionAsync(async()=>{await this.db.runAsync("UPDATE payment_entries SET status='Cancelled',cancellation_reason=?,cancelled_at=? WHERE id=?",cleanReason,now,paymentId);await this.updateTargetStatus(payment.target_type,payment.target_id);await this.enqueue('payment',paymentId,{id:paymentId,status:'Cancelled',cancellationReason:cleanReason,cancelledAt:now});});return (await this.getOverview()).targets.find((t)=>t.id===payment.target_id&&t.type===payment.target_type)!;}
  private async updateTargetStatus(type:FinancialTargetType,id:string){const column=type==='load'?'load_id':type==='quarryPurchase'?'quarry_purchase_id':type==='fuelDelivery'?'fuel_movement_id':'opening_balance_id';const totalTable=type==='load'?'loads':type==='quarryPurchase'?'quarry_purchases':type==='fuelDelivery'?'fuel_movements':'opening_balances';const totalColumn=type==='openingBalance'?'original_amount_usd_cents':'final_total_usd_cents';const row=await this.db.getFirstAsync<{total_cents:number;paid_cents:number}>(`SELECT ${totalColumn} total_cents,(SELECT COALESCE(SUM(amount_usd_cents),0) FROM payment_entries WHERE ${column}=? AND status='Active') paid_cents FROM ${totalTable} WHERE id=?`,id,id);if(!row)throw new Error('Financial record was not found.');const status=paymentStatus(row.total_cents,row.paid_cents);await this.db.runAsync(`UPDATE ${totalTable} SET payment_status=? WHERE id=?`,status,id);}
  private async currentTargetBalance(type:FinancialTargetType,id:string){const column=type==='load'?'load_id':type==='quarryPurchase'?'quarry_purchase_id':type==='fuelDelivery'?'fuel_movement_id':'opening_balance_id';const table=type==='load'?'loads':type==='quarryPurchase'?'quarry_purchases':type==='fuelDelivery'?'fuel_movements':'opening_balances';const totalColumn=type==='openingBalance'?'original_amount_usd_cents':'final_total_usd_cents';const row=await this.db.getFirstAsync<{totalCents:number;paidCents:number}>(`SELECT ${totalColumn} totalCents,(SELECT COALESCE(SUM(amount_usd_cents),0) FROM payment_entries WHERE ${column}=? AND status='Active') paidCents FROM ${table} WHERE id=?`,id,id);return row?{remainingCents:Math.max(0,row.totalCents-row.paidCents)}:null;}
  private async enqueue(entityType:string,entityId:string,payload:unknown){await this.db.runAsync(`INSERT INTO sync_outbox (entity_type,entity_id,operation,payload_json,created_at) VALUES (?,?,?,?,?)`,entityType,entityId,'upsert',JSON.stringify(payload),new Date().toISOString());}
}
