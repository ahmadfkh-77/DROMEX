import type {CustomDirectory,CustomDirectoryDraft,CustomDirectoryEntry,CustomDirectoryEntryDraft,CustomDirectoryOption} from '../../domain/customDirectories';

export type {CustomDirectoryOption};

/**
 * DEC-478. Owner-defined resource directories. Names are unique by their normalized key (a directory
 * among directories, an entry within its own directory). Nothing is ever deleted: archiving is the
 * only removal path, so every report that selected an entry keeps its own snapshot regardless.
 */
export interface CustomDirectoryRepository {
  /** Every directory, active and archived, in display order. */
  listDirectories(): Promise<CustomDirectory[]>;
  createDirectory(draft: CustomDirectoryDraft): Promise<CustomDirectory>;
  updateDirectory(id: string, draft: CustomDirectoryDraft): Promise<CustomDirectory>;
  setDirectoryActive(id: string, isActive: boolean): Promise<void>;
  /** Swaps the directory with its neighbour in display order; a move past either end does nothing. */
  moveDirectory(id: string, direction: -1 | 1): Promise<void>;
  /** Every entry of one directory, active and archived, in display order. */
  listEntries(directoryId: string): Promise<CustomDirectoryEntry[]>;
  createEntry(directoryId: string, draft: CustomDirectoryEntryDraft): Promise<CustomDirectoryEntry>;
  updateEntry(id: string, draft: CustomDirectoryEntryDraft): Promise<CustomDirectoryEntry>;
  setEntryActive(id: string, isActive: boolean): Promise<void>;
  moveEntry(id: string, direction: -1 | 1): Promise<void>;
  listSelectionOptions(): Promise<CustomDirectoryOption[]>;
}
