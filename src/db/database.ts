import Dexie, { type Table } from 'dexie';
import type {
  AppLimits,
  KnowledgeItem,
  OrganizationMode,
  OrganizationProposal,
  ReviewRecord,
  Tendency,
} from '../types.ts';

export interface MetaRecord {
  key: 'workspace';
  subjects: string[];
  folders: string[];
  mode: OrganizationMode;
  limits: AppLimits;
  consentAccepted: boolean;
  consentAcceptedAt?: string;
}

class TensakuNoteDatabase extends Dexie {
  meta!: Table<MetaRecord, 'workspace'>;
  items!: Table<KnowledgeItem, string>;
  tendencies!: Table<Tendency, string>;
  reviews!: Table<ReviewRecord, string>;
  proposals!: Table<OrganizationProposal, string>;

  constructor() {
    super('TensakuNoteDB');
    this.version(1).stores({
      meta: 'key',
      items: 'id, folder_path, hidden, mistake_count',
      tendencies: 'tendency_id, category, hidden, updated_at',
      reviews: 'review_id, date, created_at, subject',
      proposals: 'proposal_id, status, created_at',
    });
  }
}

export const db = new TensakuNoteDatabase();
