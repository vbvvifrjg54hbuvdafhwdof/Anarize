import Dexie, { type Table } from 'dexie';
import type {
  AppLimits,
  KnowledgeItem,
  OperationLogEntry,
  OrganizationMode,
  OrganizationProposal,
  PdfExportSettings,
  ReviewRecord,
  Tendency,
} from '../types.ts';

export interface MetaRecord {
  key: 'workspace';
  subjects: string[];
  folders: string[];
  mode: OrganizationMode;
  limits: AppLimits;
  pdfSettings?: PdfExportSettings;
  consentAccepted: boolean;
  consentAcceptedAt?: string;
  installGuideDismissed?: boolean;
}

class AnarizeDatabase extends Dexie {
  meta!: Table<MetaRecord, 'workspace'>;
  items!: Table<KnowledgeItem, string>;
  tendencies!: Table<Tendency, string>;
  reviews!: Table<ReviewRecord, string>;
  proposals!: Table<OrganizationProposal, string>;
  logs!: Table<OperationLogEntry, string>;

  constructor() {
    super('AnarizeDB');
    this.version(1).stores({
      meta: 'key',
      items: 'id, folder_path, hidden, mistake_count',
      tendencies: 'tendency_id, category, hidden, updated_at',
      reviews: 'review_id, date, created_at, subject',
      proposals: 'proposal_id, status, created_at',
      logs: 'id, timestamp',
    });

    this.version(2)
      .stores({
        meta: 'key',
        items: 'id, folder_path, hidden, mistake_count',
        tendencies: 'tendency_id, category, hidden, updated_at',
        reviews: 'review_id, date, created_at, subject',
        proposals: 'proposal_id, status, created_at',
        logs: 'id, timestamp',
      })
      .upgrade(async (tx) => {
        const reviews = await tx.table<ReviewRecord, string>('reviews').toArray();
        const referencedReviewIds = new Set(reviews.map((r) => r.review_id));
        const referencedHeadings = new Set(
          reviews.flatMap((r) => r.questions.flatMap((q) => q.knowledge_headings ?? []))
        );
        const referencedTendencyNames = new Set(
          reviews.flatMap((r) => r.questions.flatMap((q) => q.tendency_names ?? []))
        );

        const isExplicitSeed = (obj: unknown, id: string): boolean => {
          if (id.startsWith('seed_')) return true;
          if (!obj || typeof obj !== 'object') return false;
          const rec = obj as Record<string, unknown>;
          return rec.seed === true || rec.isSeed === true;
        };

        const items = await tx.table<KnowledgeItem, string>('items').toArray();
        const seedItemIds = items
          .filter((it) => isExplicitSeed(it, it.id) && !referencedHeadings.has(it.heading))
          .map((it) => it.id);
        if (seedItemIds.length > 0) {
          await tx.table('items').bulkDelete(seedItemIds);
        }

        const tendencies = await tx.table<Tendency, string>('tendencies').toArray();
        const seedTendIds = tendencies
          .filter(
            (t) =>
              isExplicitSeed(t, t.tendency_id) &&
              !referencedTendencyNames.has(t.name) &&
              !t.occurrences.some((occ) => occ.review_id && referencedReviewIds.has(occ.review_id))
          )
          .map((t) => t.tendency_id);
        if (seedTendIds.length > 0) {
          await tx.table('tendencies').bulkDelete(seedTendIds);
        }

        const meta = await tx.table<MetaRecord, 'workspace'>('meta').get('workspace');
        if (meta && meta.limits && 'maxPdfPages' in meta.limits) {
          const cleanLimits: AppLimits = {
            maxToolRounds:
              typeof meta.limits.maxToolRounds === 'number' && meta.limits.maxToolRounds >= 1
                ? meta.limits.maxToolRounds
                : 20,
            autoHideTendencyReviews:
              typeof meta.limits.autoHideTendencyReviews === 'number' &&
              meta.limits.autoHideTendencyReviews >= 0
                ? meta.limits.autoHideTendencyReviews
                : 5,
          };
          await tx.table<MetaRecord, 'workspace'>('meta').put({
            ...meta,
            limits: cleanLimits,
          });
        }
      });
  }
}

export const db = new AnarizeDatabase();
