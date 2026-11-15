export type OrganizationMode = '一任' | '確認';

export type TendencyCategory = '計算' | '転記' | '読解' | '表記' | '最終確認';

export type QuestionResult = 'correct' | 'partial' | 'incorrect';

export type MistakeCause = 'knowledge' | 'carelessness' | 'both' | 'none';

export type GradingBasis = 'model_answer' | 'ai_grading';

export interface AppLimits {
  maxHeadingLength: number;
  maxTendencyNameLength: number;
  maxExplanationLength: number;
  maxSituationLength: number;
  maxReasonLength: number;
  maxSavePerReview: number;
  maxTendencyPerReview: number;
  maxNoteLength: number;
  maxToolRounds: number;
  autoHideTendencyDays: number;
}

export interface KnowledgeItem {
  id: string;
  folder_path: string;
  heading: string;
  explanation: string;
  mistake_count: number;
  hidden: boolean;
  merged_into_id?: string;
  verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface TendencyOccurrence {
  id: string;
  subject: string;
  unit: string;
  situation: string;
  date: string;
  review_id?: string;
}

export interface Tendency {
  tendency_id: string;
  name: string;
  category: TendencyCategory;
  subjects: string[];
  visible_in: string[];
  hidden: boolean;
  occurrences: TendencyOccurrence[];
  created_at: string;
  updated_at: string;
}

export interface ReviewQuestion {
  label: string;
  result: QuestionResult;
  error_location?: string;
  cause: MistakeCause;
  knowledge_headings?: string[];
  tendency_names?: string[];
}

export interface ReviewRecord {
  review_id: string;
  date: string;
  created_at: string;
  subject: string;
  basis: GradingBasis;
  confidence_low: boolean;
  questions: ReviewQuestion[];
  past_relation?: string;
  note?: string;
  registration_line: string;
  discrepancy_note?: string;
}

export type ProposalTool = 'create_folder' | 'move_item' | 'rename_item' | 'merge_items';

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'invalidated';

export interface OrganizationProposal {
  proposal_id: string;
  tool: ProposalTool;
  args: Record<string, string>;
  reason: string;
  summary: string;
  status: ProposalStatus;
  invalid_reason?: string;
  created_at: string;
  resolved_at?: string;
}

export interface AppState {
  subjects: string[];
  folders: string[];
  items: KnowledgeItem[];
  tendencies: Tendency[];
  reviews: ReviewRecord[];
  proposals: OrganizationProposal[];
  mode: OrganizationMode;
  limits: AppLimits;
  consentAccepted: boolean;
  consentAcceptedAt?: string;
}

export interface ExportDataBundle {
  version: number;
  exportedAt: string;
  subjects: string[];
  folders: string[];
  items: KnowledgeItem[];
  tendencies: Tendency[];
  reviews: ReviewRecord[];
  proposals: OrganizationProposal[];
  mode: OrganizationMode;
  limits: AppLimits;
}

export interface ReviewProgressEvent {
  type: 'progress' | 'clarification' | 'completed' | 'error';
  message?: string;
  round?: number;
  sessionId?: string;
  review?: ReviewRecord;
  state?: AppState;
  code?: string;
}

export interface AnswerAttachment {
  id: string;
  kind: 'image' | 'pdf';
  name: string;
  mimeType: string;
  blob: Blob;
  previewUrl: string;
  width?: number;
  height?: number;
}
