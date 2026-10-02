import type { SignerSnapshot } from './documentSigners';

/**
 * DEC-487 (2)-(5). Statements, invoices and bills built from selected records.
 *
 * - A document is Draft, Issued or Cancelled and is never deleted. Only an Issued document counts as
 *   including a record; a draft never blocks one, and a cancelled document frees its records while
 *   staying in history.
 * - Inclusion status is never stored on a record. It is derived here from the shared
 *   document-to-record links, so every screen that shows a record shows the same status.
 * - Lines are grouped by project, then item and unit; quantities are only ever added within one unit,
 *   and money is totalled only from records that have a recorded price.
 * - An Issued document keeps the snapshots taken when it was issued; nothing here re-reads a record.
 */
export type DocumentKind = 'customer_statement' | 'customer_invoice' | 'supplier_statement' | 'supplier_bill';
export type DocumentStatus = 'Draft' | 'Issued' | 'Cancelled';
export type DocumentSide = 'customer' | 'supplier';
export type DocumentMode = 'internal' | 'official';
export type DocumentRecordType = 'company_load' | 'supplier_load';
export type SelectionMethod = 'date_range' | 'manual' | 'filtered';

export const documentKindInfo: Record<DocumentKind, { side: DocumentSide; mode: DocumentMode; recordType: DocumentRecordType; label: string; plural: string }> = {
  customer_statement: { side: 'customer', mode: 'internal', recordType: 'company_load', label: 'Customer statement', plural: 'Customer statements' },
  customer_invoice: { side: 'customer', mode: 'official', recordType: 'company_load', label: 'Invoice', plural: 'Invoices issued' },
  supplier_statement: { side: 'supplier', mode: 'internal', recordType: 'supplier_load', label: 'Supplier statement', plural: 'Supplier statements' },
  supplier_bill: { side: 'supplier', mode: 'official', recordType: 'supplier_load', label: 'Bill', plural: 'Bills received' },
};
export const documentKinds = Object.keys(documentKindInfo) as DocumentKind[];
export const kindsForSide = (side: DocumentSide): DocumentKind[] => documentKinds.filter((kind) => documentKindInfo[kind].side === side);
export const recordKey = (recordType: DocumentRecordType, recordId: string) => `${recordType}:${recordId}`;

/** One record exactly as it is copied into a document. Money is in US-dollar cents, as DROMEX records it. */
export type RecordSnapshot = {
  recordType: DocumentRecordType;
  recordId: string;
  /** Transaction number (company load) or Supplier Load number. */
  reference: string;
  /** Company load number; null for a legacy load or a Supplier Load. */
  loadNumber: string | null;
  loadNumberSeriesName: string | null;
  itemKey: string;
  itemName: string;
  unitKey: string;
  unitSymbol: string;
  quantity: number;
  projectId: string | null;
  projectName: string | null;
  partyId: string;
  partyName: string;
  /** The record's own date and time (delivery or confirmation). */
  recordedAt: string;
  /** When the record was entered into DROMEX. */
  enteredAt: string | null;
  unitPriceCents: number | null;
  priceBasis: 'per_unit' | 'whole';
  subtotalCents: number | null;
  vatRateBasisPoints: number | null;
  vatCents: number | null;
  totalCents: number | null;
  /** The supplier's own ticket or invoice number, when recorded. */
  supplierReference: string | null;
};

/** One link between a record and a document, as every view reads it. */
export type DocumentLink = { documentId: string; kind: DocumentKind; status: DocumentStatus; draftNumber: string; documentNumber: string | null; issueDate: string | null };

export type InclusionState =
  | { state: 'not_included' }
  | { state: 'in_draft'; drafts: DocumentLink[] }
  | { state: 'included'; document: DocumentLink; others: DocumentLink[] }
  | { state: 'previously_cancelled'; document: DocumentLink };

export type InclusionFilter = 'all' | 'not_included' | 'in_draft' | 'included' | 'cancelled_history';
export const inclusionFilterLabels: Record<InclusionFilter, string> = { all: 'All', not_included: 'Not included', in_draft: 'In draft', included: 'Included', cancelled_history: 'Cancelled history' };

/**
 * The one status a record shows. An Issued document outranks drafts; a draft outranks cancelled
 * history. A cancelled draft (discarded before issue) leaves no trace. `kind` narrows to one kind.
 */
export function deriveInclusion(links: readonly DocumentLink[], kind?: DocumentKind): InclusionState {
  const relevant = kind ? links.filter((value) => value.kind === kind) : [...links];
  const issued = relevant.filter((value) => value.status === 'Issued').sort(byIssue);
  if (issued.length) return { state: 'included', document: issued[0]!, others: issued.slice(1) };
  const drafts = relevant.filter((value) => value.status === 'Draft').sort((a, b) => a.draftNumber.localeCompare(b.draftNumber, undefined, { numeric: true }));
  if (drafts.length) return { state: 'in_draft', drafts };
  const cancelled = relevant.filter((value) => value.status === 'Cancelled' && value.documentNumber).sort(byIssue);
  if (cancelled.length) return { state: 'previously_cancelled', document: cancelled[0]! };
  return { state: 'not_included' };
}
const byIssue = (a: DocumentLink, b: DocumentLink) => (b.issueDate ?? '').localeCompare(a.issueDate ?? '') || (b.documentNumber ?? '').localeCompare(a.documentNumber ?? '', undefined, { numeric: true });

export function inclusionLabel(state: InclusionState): string {
  if (state.state === 'included') return `Included in ${[state.document, ...state.others].map((value) => value.documentNumber).join(', ')}`;
  if (state.state === 'in_draft') return `In draft ${state.drafts.map((value) => value.draftNumber).join(', ')}`;
  if (state.state === 'previously_cancelled') return `Previously included in cancelled ${state.document.documentNumber}`;
  return 'Not included yet';
}

export function matchesInclusionFilter(state: InclusionState, filter: InclusionFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'cancelled_history') return state.state === 'previously_cancelled';
  if (filter === 'not_included') return state.state === 'not_included' || state.state === 'previously_cancelled';
  return state.state === filter;
}

/** "7 records · 5 included · 2 not included"; a record only in a cancelled document counts as not included. */
export function summarizeInclusion(states: readonly InclusionState[]): string {
  const included = states.filter((value) => value.state === 'included') as Extract<InclusionState, { state: 'included' }>[];
  const inDraft = states.filter((value) => value.state === 'in_draft').length;
  const includedIn = [...new Set(included.flatMap((value) => [value.document, ...value.others].map((link) => link.documentNumber ?? '')))].filter(Boolean).sort();
  return summarizeInclusionCounts({ total: states.length, included: included.length, inDraft, open: states.length - included.length - inDraft, includedIn });
}

/** Inclusion counts for an aggregate row, as Company and Project Totals read them from SQL. */
export type InclusionCounts = { total: number; included: number; inDraft: number; open: number; includedIn: string[] };

/** "7 records · 5 included · 2 not included", or "3 records · all included in INV-2026-014". */
export function summarizeInclusionCounts(counts: InclusionCounts): string {
  const head = `${counts.total} record${counts.total === 1 ? '' : 's'}`;
  if (counts.total && counts.included === counts.total) return counts.includedIn.length === 1 ? `${head} · all included in ${counts.includedIn[0]}` : `${head} · all included`;
  if (counts.total === 1 && counts.open === 1) return `${head} · not included`;
  return [head, counts.included ? `${counts.included} included` : null, counts.inDraft ? `${counts.inDraft} in draft` : null, counts.open ? `${counts.open} not included` : null].filter(Boolean).join(' · ');
}

export type DocumentLine = {
  key: string; itemKey: string; itemName: string; unitKey: string; unitSymbol: string;
  quantity: number; recordCount: number; priceBasis: 'per_unit' | 'whole';
  unitPriceCents: number | null; vatRateBasisPoints: number | null;
  subtotalCents: number | null; vatCents: number | null; totalCents: number | null; unpricedCount: number;
};
export type DocumentProjectGroup = { projectId: string | null; projectName: string; lines: DocumentLine[] };
export type MoneyTotals = { subtotalCents: number | null; vatCents: number | null; totalCents: number | null; pricedCount: number; unpricedCount: number };
export type UnitQuantity = { unitKey: string; unitSymbol: string; quantity: number; recordCount: number };
export type DocumentLineGroups = { projects: DocumentProjectGroup[]; quantityByUnit: UnitQuantity[]; money: MoneyTotals };

const clean = (value: number) => Math.round(value * 1e6) / 1e6;
const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const addCents = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);
export const NO_PROJECT_LABEL = 'No project';

/**
 * Lines for a document: Project → item and unit, one line per unit price. A whole-price Supplier Load
 * (one price for the whole delivery) is always its own line, because adding whole prices per unit would
 * misstate a unit price.
 */
export function groupDocumentLines(records: readonly RecordSnapshot[]): DocumentLineGroups {
  const projects = new Map<string, { projectId: string | null; projectName: string; lines: Map<string, DocumentLine> }>();
  const units = new Map<string, UnitQuantity>();
  const money: MoneyTotals = { subtotalCents: null, vatCents: null, totalCents: null, pricedCount: 0, unpricedCount: 0 };
  for (const record of records) {
    const projectKey = record.projectId ?? '';
    const project = projects.get(projectKey) ?? { projectId: record.projectId, projectName: record.projectName || NO_PROJECT_LABEL, lines: new Map() };
    projects.set(projectKey, project);
    const priced = record.unitPriceCents != null;
    const key = [record.itemKey, record.unitKey, record.priceBasis, record.priceBasis === 'whole' ? record.recordId : '', priced ? record.unitPriceCents : 'unpriced', priced ? record.vatRateBasisPoints ?? '' : ''].join('|');
    const line = project.lines.get(key) ?? { key, itemKey: record.itemKey, itemName: record.itemName, unitKey: record.unitKey, unitSymbol: record.unitSymbol, quantity: 0, recordCount: 0, priceBasis: record.priceBasis, unitPriceCents: record.unitPriceCents, vatRateBasisPoints: priced ? record.vatRateBasisPoints : null, subtotalCents: null, vatCents: null, totalCents: null, unpricedCount: 0 };
    line.quantity = clean(line.quantity + record.quantity); line.recordCount += 1;
    if (priced) { line.subtotalCents = addCents(line.subtotalCents, record.subtotalCents); line.vatCents = addCents(line.vatCents, record.vatCents); line.totalCents = addCents(line.totalCents, record.totalCents); }
    else line.unpricedCount += 1;
    project.lines.set(key, line);
    const unit = units.get(record.unitKey) ?? { unitKey: record.unitKey, unitSymbol: record.unitSymbol, quantity: 0, recordCount: 0 };
    unit.quantity = clean(unit.quantity + record.quantity); unit.recordCount += 1; units.set(record.unitKey, unit);
    if (priced) { money.pricedCount += 1; money.subtotalCents = addCents(money.subtotalCents, record.subtotalCents); money.vatCents = addCents(money.vatCents, record.vatCents); money.totalCents = addCents(money.totalCents, record.totalCents); }
    else money.unpricedCount += 1;
  }
  const lineOrder = (a: DocumentLine, b: DocumentLine) => byLabel(a.itemName, b.itemName) || byLabel(a.unitSymbol, b.unitSymbol) || (a.unitPriceCents ?? Infinity) - (b.unitPriceCents ?? Infinity) || a.key.localeCompare(b.key);
  return {
    projects: [...projects.values()]
      .sort((a, b) => Number(a.projectId == null) - Number(b.projectId == null) || byLabel(a.projectName, b.projectName))
      .map((value) => ({ projectId: value.projectId, projectName: value.projectName, lines: [...value.lines.values()].sort(lineOrder) })),
    quantityByUnit: [...units.values()].sort((a, b) => byLabel(a.unitSymbol, b.unitSymbol)),
    money,
  };
}

export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(3, '0')}`;
}
export function validateDocumentNumber(value: string): string[] {
  const text = value.trim();
  if (!text) return ['Enter a document number.'];
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/._]{0,39}$/.test(text)) return ['Use letters, digits, and - / . _ only (40 characters at most).'];
  return [];
}
export function validateDocumentPrefix(value: string): string[] {
  return /^[A-Z]{2,6}$/.test(value.trim()) ? [] : ['A prefix must be 2 to 6 letters A–Z.'];
}

/** Who issues or receives a document. Empty fields print nothing and read "Not configured". */
export type PartyBlock = {
  name: string | null; tradingName: string | null; contactPerson: string | null; address: string | null; phone: string | null; email: string | null;
  website: string | null; taxRegistrationNumber: string | null; companyRegistrationNumber: string | null;
};
/** DROMEX records every amount in US dollars, so documents state USD (DEC-487 (4)). */
export type DocumentTerms = { currency: 'USD'; paymentTerms: string | null; bankDetails: string | null; footerNote: string | null };
export type SignerSelection = { signerId: string; display: 'name_only' | 'name_with_signature' };

export type DocumentSettings = {
  legalName: string | null; tradingName: string | null; address: string | null; phone: string | null; email: string | null; website: string | null;
  taxRegistrationNumber: string | null; companyRegistrationNumber: string | null; currencyCode: 'USD';
  bankDetails: string | null; paymentTerms: string | null; footerNote: string | null;
  prefixes: Record<DocumentKind, string>;
  /** Next automatic number per kind for `year`. */
  nextNumbers: Record<DocumentKind, number>;
  year: number;
  /** Company Settings identity, used where a document setting is empty. */
  company: { name: string | null; address: string | null; phone: string | null; email: string | null; taxVatNumber: string | null };
};
export type DocumentSettingsDraft = Omit<DocumentSettings, 'nextNumbers' | 'year' | 'company' | 'currencyCode'> & { currencyCode?: string | null };

export type BillingContactDraft = { billingName: string; contactPerson: string; address: string; phone: string; email: string; taxRegistrationNumber: string; companyRegistrationNumber: string; notes: string };
export type BillingContact = { saved: boolean; billingName: string | null; contactPerson: string | null; address: string | null; phone: string | null; email: string | null; taxRegistrationNumber: string | null; companyRegistrationNumber: string | null; notes: string | null };

export type EligibleRecordQuery = {
  side: DocumentSide; partyId?: string; fromDate?: string; toDate?: string;
  /** A project id, or '' for records with no project. */
  projectId?: string; itemKey?: string; unitKey?: string; seriesId?: string;
  recordKeys?: string[]; inclusion?: InclusionFilter; kind?: DocumentKind;
};
export type EligibleRecord = { key: string; snapshot: RecordSnapshot; seriesId: string | null; inclusion: InclusionState; links: DocumentLink[] };

export type CreateDraftInput = { kind: DocumentKind; partyId: string; recordKeys: string[]; selectionMethod: SelectionMethod; periodFrom?: string | null; periodTo?: string | null };
export type DraftDetails = {
  dueDate?: string | null; reference?: string | null; notes?: string | null; periodFrom?: string | null; periodTo?: string | null;
  issuerOverride?: Partial<PartyBlock>; recipientOverride?: Partial<PartyBlock>; termsOverride?: Partial<Omit<DocumentTerms, 'currency'>>;
  signer?: SignerSelection | null;
};
export type IssueInput = { issueDate: string; documentNumber?: string | null };

export type DocumentPaymentStatus = 'Paid' | 'Partially paid' | 'Unpaid' | 'No payment due' | 'No amount recorded';
/** Read live from Payments & Balances; never stored on the document. */
export type DocumentPayment = { status: DocumentPaymentStatus; owedCents: number | null; paidCents: number; overdue: boolean };
export type DocumentHistoryEntry = { status: DocumentStatus; at: string; reason?: string; documentNumber?: string };
export type DocumentRecordProblem = { key: string; message: string };

export type BusinessDocument = {
  id: string; kind: DocumentKind; status: DocumentStatus; draftNumber: string; documentNumber: string | null;
  partyType: DocumentSide; partyId: string; partyName: string;
  periodFrom: string | null; periodTo: string | null; selectionMethod: SelectionMethod;
  issueDate: string | null; dueDate: string | null; reference: string | null; notes: string | null;
  issuer: PartyBlock | null; recipient: PartyBlock | null; terms: DocumentTerms | null;
  /** Issued: the frozen signer copy. Draft: the selection, resolved for preview. */
  signer: SignerSnapshot | null;
  signerSelection: SignerSelection | null;
  /** Issued: the Company Settings logo file as it was at issue. Draft: the current logo, for preview. */
  logoUri: string | null;
  records: { key: string; snapshot: RecordSnapshot; position: number }[];
  groups: DocumentLineGroups;
  /** Drafts only: records that can no longer be issued as they stand. */
  problems: DocumentRecordProblem[];
  history: DocumentHistoryEntry[];
  payment: DocumentPayment | null;
  issuedAt: string | null; cancelledAt: string | null; cancellationReason: string | null; createdAt: string; updatedAt: string;
};
export type DocumentSummary = Pick<BusinessDocument, 'id' | 'kind' | 'status' | 'draftNumber' | 'documentNumber' | 'partyType' | 'partyId' | 'partyName' | 'issueDate' | 'dueDate' | 'periodFrom' | 'periodTo' | 'reference' | 'createdAt' | 'payment'> & { recordCount: number };
export type DocumentListFilter = {
  partyType?: DocumentSide; partyId?: string; status?: DocumentStatus; kind?: DocumentKind; fromDate?: string; toDate?: string;
  projectId?: string; itemKey?: string; search?: string; paymentStatus?: DocumentPaymentStatus | 'Overdue';
};

/** "Not configured" fields an Official document would print empty, for the review screen. */
export function missingOfficialFields(block: PartyBlock | null): string[] {
  if (!block) return ['Business name'];
  const fields: [keyof PartyBlock, string][] = [['name', 'Business name'], ['address', 'Address'], ['taxRegistrationNumber', 'Tax / VAT registration number'], ['phone', 'Phone'], ['email', 'Email']];
  return fields.filter(([key]) => !block[key]).map(([, label]) => label);
}
