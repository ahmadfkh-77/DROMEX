import type {QuickTextDocument,QuickTextDraft,QuickTextSetup} from '../../domain/quickText';
export interface QuickTextRepository{getSetup():Promise<QuickTextSetup>;save(draft:QuickTextDraft):Promise<QuickTextDocument>;list():Promise<QuickTextDocument[]>;}
