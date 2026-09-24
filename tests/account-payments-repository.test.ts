import {afterEach,describe,expect,it} from 'vitest';

import {SqliteFinancialRepository} from '../src/data/repositories/SqliteFinancialRepository';
import {SqliteWorkspaceRepository} from '../src/data/repositories/SqliteWorkspaceRepository';
import {emptyAccountPaymentDraft,summarizeAccount,type AccountPaymentDraft} from '../src/domain/accountPayments';
import {BACKUP_COUNT_TABLES} from '../src/domain/backup';
import {entityTable,syncTables} from '../src/services/cloud/SyncSchema';
import {SEED_TIME,migratedDatabaseWithProject,type SqliteTestDatabase} from './support/sqliteTestDatabase';

/**
 * Account payments and Open Balance cancellation in SQLite (DEC-482, DEC-483). A real payment is one
 * account_payments row; its record allocations are ordinary payment_entries linked back to it, so
 * every existing per-record rule (remaining balance, payment status, load/supplier-load cancellation
 * guards) keeps seeing them. Cancelling never deletes anything.
 */
const databases:SqliteTestDatabase[]=[];
afterEach(()=>{for(const database of databases.splice(0))database.close();});

async function setup(){
  const db=await migratedDatabaseWithProject(databases);
  db.raw.exec(`INSERT INTO suppliers (id,name,is_active,created_at,updated_at) VALUES ('sup','Alpha Quarry',1,'${SEED_TIME}','${SEED_TIME}'),('other','Other Supplier',1,'${SEED_TIME}','${SEED_TIME}')`);
  const repo=new SqliteFinancialRepository(db as never);
  const opening=async(amount:string,asOfDate:string,reference:string,partyId='sup')=>(await repo.createOpeningBalance({partyType:'supplier',partyId,amountUsd:amount,asOfDate,reference,notes:''})).id;
  const a=await opening('300','2026-07-01','Book A');
  const b=await opening('400','2026-07-10','Book B');
  const c=await opening('500','2026-07-20','Book C');
  return {db,repo,a,b,c,opening};
}
const draft=(patch:Partial<AccountPaymentDraft>):AccountPaymentDraft=>({...emptyAccountPaymentDraft('supplier','sup'),paymentDate:'2026-09-01',...patch});
const account=async(repo:SqliteFinancialRepository,partyId='sup')=>{
  const overview=await repo.getOverview();
  const targets=overview.targets.filter(target=>target.partyType==='supplier'&&target.partyId===partyId);
  const payments=overview.accountPayments.filter(payment=>payment.partyType==='supplier'&&payment.partyId===partyId);
  const cancelled=overview.cancelledOpenings.filter(value=>value.partyType==='supplier'&&value.partyId===partyId);
  return {overview,targets,payments,cancelled,summary:summarizeAccount(targets,payments,cancelled)};
};

describe('cancelling an Open Balance',()=>{
  it('requires a reason and keeps the balance in history as Cancelled, out of the amount owed',async()=>{
    const {db,repo,b}=await setup();
    await expect(repo.cancelOpeningBalance(b,'  ')).rejects.toThrow('Enter the reason for cancelling this Open Balance.');
    await repo.cancelOpeningBalance(b,'Entered twice by mistake');
    const {targets,cancelled,summary}=await account(repo);
    expect(targets.map(target=>target.id)).not.toContain(b);
    expect(cancelled).toEqual([expect.objectContaining({id:b,amountUsd:400,cancellationReason:'Entered twice by mistake',statusBeforeCancellation:'Unpaid'})]);
    expect(summary.balanceUsd).toBe(800);
    expect(db.raw.prepare('SELECT COUNT(*) n FROM opening_balances').get()).toEqual({n:3});
    const outbox=db.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='openingBalance' AND entity_id=? ORDER BY id DESC LIMIT 1").get(b) as {payload_json:string};
    expect(JSON.parse(outbox.payload_json)).toMatchObject({id:b,status:'Cancelled',cancellationReason:'Entered twice by mistake',statusBeforeCancellation:'Unpaid'});
  });
  it('is refused while payments are active, and cannot be cancelled twice',async()=>{
    const {repo,a}=await setup();
    await repo.recordAccountPayment(draft({mode:'record',amountUsd:'50',selections:[{targetType:'openingBalance',targetId:a,amountUsd:'50'}]}));
    await expect(repo.cancelOpeningBalance(a,'Wrong')).rejects.toThrow('This Open Balance has 1 active payment. Cancel those payments first, then cancel the balance.');
    const {c}=await setup();
    const second=new SqliteFinancialRepository(databases.at(-1) as never);
    await second.cancelOpeningBalance(c,'Wrong');
    await expect(second.cancelOpeningBalance(c,'Again')).rejects.toThrow('This Open Balance is already cancelled.');
  });
  it('is not counted by the Attention total',async()=>{
    const {db,repo,a,b,c}=await setup();
    const workspace=new SqliteWorkspaceRepository(db as never);
    const before=await workspace.getAttentionSnapshot();
    await repo.cancelOpeningBalance(a,'Wrong');await repo.cancelOpeningBalance(b,'Wrong');await repo.cancelOpeningBalance(c,'Wrong');
    const after=await workspace.getAttentionSnapshot();
    expect(JSON.stringify(after)).not.toEqual(JSON.stringify(before));
  });
});

describe('recording one payment for an account',()=>{
  it('overall balance: saved once, attached to no record, lowers the account balance honestly',async()=>{
    const {db,repo}=await setup();
    const saved=await repo.recordAccountPayment(draft({mode:'overall',amountUsd:'1000',method:'bank_transfer',reference:'TR-77',note:'August statement'}));
    expect(saved).toMatchObject({amountUsd:1000,mode:'overall',method:'bank_transfer',reference:'TR-77',note:'August statement',allocatedUsd:0,unallocatedUsd:1000});
    const {targets,summary}=await account(repo);
    expect(targets.every(target=>target.paidUsd===0)).toBe(true);
    expect(summary).toMatchObject({outstandingRecordsUsd:1200,unallocatedUsd:1000,balanceUsd:200,creditUsd:0});
    expect(db.raw.prepare('SELECT COUNT(*) n FROM payment_entries').get()).toEqual({n:0});
  });
  it('oldest unpaid first: one payment split into linked record entries, nothing over-applied',async()=>{
    const {db,repo,a,b,c}=await setup();
    const saved=await repo.recordAccountPayment(draft({mode:'oldest',amountUsd:'650'}));
    expect(saved.allocations.map(line=>[line.targetId,line.amountUsd])).toEqual([[a,300],[b,350]]);
    const {targets}=await account(repo);
    expect(targets.find(target=>target.id===a)).toMatchObject({status:'Paid',remainingUsd:0});
    expect(targets.find(target=>target.id===b)).toMatchObject({status:'Partially Paid',remainingUsd:50});
    expect(targets.find(target=>target.id===c)).toMatchObject({status:'Unpaid'});
    expect(db.raw.prepare('SELECT COUNT(DISTINCT account_payment_id) n FROM payment_entries').get()).toEqual({n:1});
    expect(db.raw.prepare('SELECT payment_status FROM opening_balances WHERE id=?').get(a)).toEqual({payment_status:'Paid'});
  });
  it('allows more than is owed only as visible credit',async()=>{
    const {repo}=await setup();
    const saved=await repo.recordAccountPayment(draft({mode:'oldest',amountUsd:'1500'}));
    expect(saved).toMatchObject({allocatedUsd:1200,unallocatedUsd:300});
    expect((await account(repo)).summary).toMatchObject({balanceUsd:0,creditUsd:300});
  });
  it('selected records: exact partial amounts, remainder unallocated',async()=>{
    const {repo,a,c}=await setup();
    const saved=await repo.recordAccountPayment(draft({mode:'selected',amountUsd:'600',selections:[{targetType:'openingBalance',targetId:c,amountUsd:'500'},{targetType:'openingBalance',targetId:a,amountUsd:'50'}]}));
    expect(saved).toMatchObject({allocatedUsd:550,unallocatedUsd:50});
    const {targets}=await account(repo);
    expect(targets.find(target=>target.id===c)?.status).toBe('Paid');
    expect(targets.find(target=>target.id===a)).toMatchObject({paidUsd:50,remainingUsd:250});
  });
  it('refuses over-allocation and records of another account, saving nothing',async()=>{
    const {db,repo,a,opening}=await setup();
    const foreign=await opening('100','2026-07-01','Other','other');
    await expect(repo.recordAccountPayment(draft({mode:'selected',amountUsd:'1000',selections:[{targetType:'openingBalance',targetId:a,amountUsd:'301'}]}))).rejects.toThrow('Book A still owes $300.00; it cannot receive $301.00.');
    await expect(repo.recordAccountPayment(draft({mode:'selected',amountUsd:'10',selections:[{targetType:'openingBalance',targetId:foreign,amountUsd:'10'}]}))).rejects.toThrow('A selected record is no longer open on this account.');
    expect(db.raw.prepare('SELECT COUNT(*) n FROM account_payments').get()).toEqual({n:0});
    expect(db.raw.prepare('SELECT COUNT(*) n FROM payment_entries').get()).toEqual({n:0});
  });
});

describe('paying an individual record',()=>{
  it('marks a record paid in full, or records a partial payment, and shows which payments affected it',async()=>{
    const {repo,a,b}=await setup();
    await repo.recordAccountPayment(draft({mode:'record',amountUsd:'300',selections:[{targetType:'openingBalance',targetId:a,amountUsd:'300'}]}));
    const partial=await repo.recordAccountPayment(draft({mode:'record',amountUsd:'120',method:'cheque',reference:'CHQ-5',selections:[{targetType:'openingBalance',targetId:b,amountUsd:'120'}]}));
    const {targets}=await account(repo);
    expect(targets.find(target=>target.id===a)).toMatchObject({status:'Paid',totalUsd:300,paidUsd:300,remainingUsd:0});
    const record=targets.find(target=>target.id===b)!;
    expect(record).toMatchObject({status:'Partially Paid',totalUsd:400,paidUsd:120,remainingUsd:280});
    expect(record.payments).toEqual([expect.objectContaining({amountUsd:120,accountPaymentId:partial.id,status:'Active'})]);
  });
});

describe('applying unallocated money later',()=>{
  it('applies part of an unallocated payment to chosen records without re-entering or cancelling it',async()=>{
    const {db,repo,a,b}=await setup();
    const saved=await repo.recordAccountPayment(draft({mode:'overall',amountUsd:'1000',method:'cheque',reference:'CHQ-9'}));
    const applied=await repo.applyUnallocatedPayment(saved.id,{mode:'selected',amountUsd:'450',selections:[{targetType:'openingBalance',targetId:a,amountUsd:'300'},{targetType:'openingBalance',targetId:b,amountUsd:'150'}]});
    expect(applied).toMatchObject({id:saved.id,amountUsd:1000,paymentDate:'2026-09-01',method:'cheque',reference:'CHQ-9',mode:'overall',allocatedUsd:450,unallocatedUsd:550});
    const {targets,summary}=await account(repo);
    expect(targets.find(target=>target.id===a)).toMatchObject({status:'Paid'});
    expect(targets.find(target=>target.id===b)).toMatchObject({status:'Partially Paid',remainingUsd:250});
    expect(summary).toMatchObject({unallocatedUsd:550,balanceUsd:200});
    expect(db.raw.prepare('SELECT COUNT(*) n FROM account_payments').get()).toEqual({n:1});
    const audit=db.raw.prepare("SELECT payload_json FROM sync_outbox WHERE entity_type='accountPayment' AND entity_id=? ORDER BY id DESC LIMIT 1").get(saved.id) as {payload_json:string};
    expect(JSON.parse(audit.payload_json)).toMatchObject({id:saved.id,appliedUsd:450,unallocatedBeforeUsd:1000,unallocatedAfterUsd:550});
  });
  it('can apply the rest oldest first later, and cancelling the payment still undoes every applied amount',async()=>{
    const {repo,a,b,c}=await setup();
    const saved=await repo.recordAccountPayment(draft({mode:'overall',amountUsd:'1000'}));
    await repo.applyUnallocatedPayment(saved.id,{mode:'oldest',amountUsd:'1000',selections:[]});
    const {targets}=await account(repo);
    expect([a,b].map(id=>targets.find(target=>target.id===id)?.status)).toEqual(['Paid','Paid']);
    expect(targets.find(target=>target.id===c)).toMatchObject({paidUsd:300,remainingUsd:200});
    await repo.cancelAccountPayment(saved.id,'Cheque bounced');
    expect((await account(repo)).targets.every(target=>target.paidUsd===0)).toBe(true);
  });
  it('refuses to apply more than is unallocated, from a cancelled payment, or to another account, saving nothing',async()=>{
    const {db,repo,a,opening}=await setup();
    const foreign=await opening('100','2026-07-01','Other','other');
    const saved=await repo.recordAccountPayment(draft({mode:'overall',amountUsd:'100'}));
    await expect(repo.applyUnallocatedPayment(saved.id,{mode:'oldest',amountUsd:'150',selections:[]})).rejects.toThrow('You can apply at most $100.00, the unallocated part of this payment.');
    await expect(repo.applyUnallocatedPayment(saved.id,{mode:'selected',amountUsd:'50',selections:[{targetType:'openingBalance',targetId:foreign,amountUsd:'50'}]})).rejects.toThrow('A selected record is no longer open on this account.');
    await repo.cancelAccountPayment(saved.id,'Wrong');
    await expect(repo.applyUnallocatedPayment(saved.id,{mode:'selected',amountUsd:'50',selections:[{targetType:'openingBalance',targetId:a,amountUsd:'50'}]})).rejects.toThrow('A cancelled payment cannot be applied to records.');
    expect(db.raw.prepare('SELECT COUNT(*) n FROM payment_entries').get()).toEqual({n:0});
  });
});

describe('cancelling a payment',()=>{
  it('cancels the payment and every allocation together, keeping all of it in history',async()=>{
    const {repo,a,b}=await setup();
    const saved=await repo.recordAccountPayment(draft({mode:'oldest',amountUsd:'650'}));
    await expect(repo.cancelAccountPayment(saved.id,'')).rejects.toThrow('Cancellation reason is required.');
    await repo.cancelAccountPayment(saved.id,'Cheque bounced');
    const {targets,payments}=await account(repo);
    expect(payments[0]).toMatchObject({status:'Cancelled',cancellationReason:'Cheque bounced'});
    expect(payments[0]!.allocations.every(line=>line.status==='Cancelled')).toBe(true);
    expect(targets.find(target=>target.id===a)).toMatchObject({status:'Unpaid',paidUsd:0});
    expect(targets.find(target=>target.id===b)?.payments[0]?.status).toBe('Cancelled');
  });
  it('refuses to cancel one allocation of a larger payment on its own',async()=>{
    const {repo}=await setup();
    const saved=await repo.recordAccountPayment(draft({mode:'oldest',amountUsd:'650'}));
    await expect(repo.cancelPayment(saved.allocations[0]!.paymentEntryId,'Wrong')).rejects.toThrow('This amount is part of a larger payment. Cancel that payment instead.');
  });
});

describe('reports and the dashboard',()=>{
  it('show a cancelled balance as Cancelled, never bill it, and count an unallocated payment as paid',async()=>{
    const {db}=await setup();
    db.raw.exec(`INSERT INTO customers (id,customer_type,name,is_own_company,is_active,created_at,updated_at) VALUES ('cust','company','Road Co 2',0,1,'${SEED_TIME}','${SEED_TIME}')`);
    const repo=new SqliteFinancialRepository(db as never);
    const keep=(await repo.createOpeningBalance({partyType:'customer',partyId:'cust',amountUsd:'700',asOfDate:'2026-07-01',reference:'Keep',notes:''})).id;
    const wrong=(await repo.createOpeningBalance({partyType:'customer',partyId:'cust',amountUsd:'900',asOfDate:'2026-07-02',reference:'Wrong',notes:''})).id;
    await repo.cancelOpeningBalance(wrong,'Duplicate');
    await repo.recordAccountPayment({...emptyAccountPaymentDraft('customer','cust'),paymentDate:'2026-09-01',mode:'overall',amountUsd:'200'});
    const {SqliteBusinessReportRepository}=await import('../src/data/repositories/SqliteBusinessReportRepository');
    const {buildDashboardSnapshot}=await import('../src/domain/dashboard');
    const data=await new SqliteBusinessReportRepository(db as never).getReportData();
    expect(data.openingBalances.find(row=>row['Record ID']===wrong)).toMatchObject({'Record Status':'Cancelled','Cancellation Reason':'Duplicate'});
    expect(data.customers.find(row=>row['Customer ID']==='cust')).toMatchObject({'Total Billed USD':700,'Total Paid USD':200,'Remaining USD':500});
    expect(data.payments.find(row=>row['Target Type']==='unallocated')).toMatchObject({'Customer ID':'cust','Amount USD':200,'Status':'Active'});
    // The dashboard never counts the cancelled $900, and subtracts the unallocated $200 from what the
    // customer still owes, matching the account in Payments & Balances.
    const snapshot=buildDashboardSnapshot(data,{fromDate:'2026-01-01',toDate:'2026-12-31',label:'2026'});
    expect(snapshot.financial.receivableUsd).toBe(500);
    expect(snapshot.financial.largestBalances.find(value=>value.id==='cust')).toMatchObject({remainingUsd:500,recordCount:1});
    expect(keep).toBeTruthy();
  });
});

describe('backup and sync',()=>{
  it('counts balances and account payments in backups and syncs account payments before their allocations',()=>{
    expect(BACKUP_COUNT_TABLES).toEqual(expect.arrayContaining(['opening_balances','account_payments','payment_entries']));
    expect(entityTable.accountPayment).toBe('account_payments');
    const rank=(table:string)=>syncTables.find(entry=>entry.table===table)?.rank??-1;
    expect(rank('account_payments')).toBeGreaterThan(rank('suppliers'));
    expect(rank('account_payments')).toBeLessThan(rank('payment_entries'));
  });
  it('a restored cancelled balance stays cancelled when payment statuses are recalculated',async()=>{
    const {db,repo,b}=await setup();
    await repo.cancelOpeningBalance(b,'Duplicate');
    db.raw.exec(`UPDATE opening_balances SET payment_status=CASE WHEN COALESCE((SELECT SUM(amount_usd_cents) FROM payment_entries WHERE opening_balance_id=opening_balances.id AND status='Active'),0)=0 THEN 'Unpaid' ELSE payment_status END`);
    expect(db.raw.prepare('SELECT status FROM opening_balances WHERE id=?').get(b)).toEqual({status:'Cancelled'});
    expect((await account(repo)).cancelled.map(value=>value.id)).toEqual([b]);
  });
});
