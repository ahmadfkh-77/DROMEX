import type {DocumentSigner,DocumentSignerDraft,SignerEvent} from '../../domain/documentSigners';

/** DEC-487 (5). Reusable authorized signers; never deleted, every change and use recorded. */
export interface DocumentSignerRepository {
  listSigners(): Promise<DocumentSigner[]>;
  getSigner(id: string): Promise<DocumentSigner>;
  createSigner(draft: DocumentSignerDraft): Promise<DocumentSigner>;
  updateSigner(id: string, draft: DocumentSignerDraft): Promise<DocumentSigner>;
  saveSignature(id: string, strokes: string[]): Promise<DocumentSigner>;
  setSignerActive(id: string, isActive: boolean): Promise<void>;
  listEvents(id: string): Promise<SignerEvent[]>;
}
