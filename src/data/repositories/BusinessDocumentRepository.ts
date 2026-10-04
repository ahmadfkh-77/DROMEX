import type {
  BillingContact,BillingContactDraft,BusinessDocument,CreateDraftInput,DocumentKind,DocumentLink,DocumentListFilter,DocumentSettings,DocumentSettingsDraft,
  DocumentSide,DocumentSummary,DraftDetails,EligibleRecord,EligibleRecordQuery,IssueInput,
} from '../../domain/businessDocuments';

/**
 * DEC-500 (2)-(4). Statements, invoices and bills, and the one shared document-to-record link model
 * every screen reads inclusion status from. Ordinary PDF/Excel exports never call a write method here.
 */
export interface BusinessDocumentRepository {
  getSettings(year?: number): Promise<DocumentSettings>;
  saveSettings(draft: DocumentSettingsDraft): Promise<DocumentSettings>;
  setNextDocumentNumber(kind: DocumentKind, year: number, next: number): Promise<void>;
  getBillingContact(side: DocumentSide, partyId: string): Promise<BillingContact>;
  saveBillingContact(side: DocumentSide, partyId: string, draft: BillingContactDraft): Promise<BillingContact>;
  listEligibleRecords(query: EligibleRecordQuery): Promise<EligibleRecord[]>;
  inclusionFor(keys: readonly string[]): Promise<Record<string, DocumentLink[]>>;
  createDraft(input: CreateDraftInput): Promise<BusinessDocument>;
  removeRecordsFromDraft(documentId: string, keys: readonly string[]): Promise<BusinessDocument>;
  updateDraft(documentId: string, details: DraftDetails): Promise<BusinessDocument>;
  issueDocument(documentId: string, input: IssueInput): Promise<BusinessDocument>;
  cancelDocument(documentId: string, reason: string): Promise<BusinessDocument>;
  getDocument(documentId: string, today?: string): Promise<BusinessDocument>;
  listDocuments(filter?: DocumentListFilter, today?: string): Promise<DocumentSummary[]>;
}
