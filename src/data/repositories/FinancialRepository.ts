import type { AccountLedger, AccountPayment, AccountPaymentDraft, ApplyUnallocatedDraft } from '../../domain/accountPayments';
import type { FinancialOverview, FinancialTarget, OpeningBalanceDraft, PaymentDraft, ProjectFinancialSummary } from '../../domain/financials';
export interface FinancialRepository{getOverview():Promise<FinancialOverview&AccountLedger>;getProjectFinancials(projectId:string):Promise<ProjectFinancialSummary>;createOpeningBalance(draft:OpeningBalanceDraft):Promise<FinancialTarget>;recordPayment(draft:PaymentDraft):Promise<FinancialTarget>;cancelPayment(paymentId:string,reason:string):Promise<FinancialTarget>;
  /** DEC-483. Cancels an Open Balance with a reason; refused while it has active payments. Never deletes. */
  cancelOpeningBalance(id:string,reason:string):Promise<void>;
  /** DEC-482. One real payment for an account, applied overall, oldest first, to selected records, or to one record. */
  recordAccountPayment(draft:AccountPaymentDraft):Promise<AccountPayment>;
  /** DEC-485. Applies part or all of a payment's unallocated money to records, without changing the payment. */
  applyUnallocatedPayment(paymentId:string,draft:ApplyUnallocatedDraft):Promise<AccountPayment>;
  /** Cancels an account payment and every amount it applied, together, with a reason. */
  cancelAccountPayment(id:string,reason:string):Promise<void>;}
