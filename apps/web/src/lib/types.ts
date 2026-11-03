export interface User {
  id: string;
  name: string;
  role: 'author' | 'reviewer' | 'admin';
  color: string;
  onboardedAt: string | null;
}

export interface WordCount {
  chars: number;
  charsWithPunctuation: number;
  cjk: number;
  latinWords: number;
}

export type DocumentStatus = 'draft' | 'in_review' | 'final';

export interface DocumentSummary {
  id: string;
  title: string;
  excerpt: string;
  status: DocumentStatus;
  ownerId: string;
  ownerName: string;
  ownerColor: string;
  charCount: number;
  versionCount: number;
  pendingSubmissions: number;
  activeRoundId: string | null;
  publishedAt: string | null;
  publishNumber: number | null;
  publishFeeCents: number | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  content: string;
  currentVersionId: string | null;
  folderId: string | null;
  wordCount: WordCount;
  canPublish: boolean;
}

export type VersionKind =
  | 'snapshot'
  | 'auto_snapshot'
  | 'review_base'
  | 'merge'
  | 'restore'
  | 'import';

export interface VersionSummary {
  id: string;
  documentId: string;
  kind: VersionKind;
  createdBy: string;
  authorName: string;
  authorColor: string;
  parentVersionId: string | null;
  note: string | null;
  charCount: number;
  createdAt: string;
}

export interface VersionDetail extends VersionSummary {
  content: string;
  contentHash: string;
}

export type ChangeType = 'insert' | 'delete' | 'replace';
export type ChangeStatus = 'pending' | 'accepted' | 'rejected' | 'conflict';

export interface ChangeView {
  id: string;
  submissionId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerColor: string;
  seq: number;
  type: ChangeType;
  baseStart: number;
  baseEnd: number;
  oldText: string;
  newText: string;
  status: ChangeStatus;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface SubmissionView {
  id: string;
  reviewerId: string;
  reviewerName: string;
  reviewerColor: string;
  status: 'submitted' | 'processed' | 'withdrawn';
  createdAt: string;
  processedAt: string | null;
  summary: {
    total: number;
    insert: number;
    delete: number;
    replace: number;
  };
  changes: ChangeView[];
}

export interface SubmissionDetail extends SubmissionView {
  editedContent: string;
}

export interface RoundView {
  id: string;
  documentId: string;
  documentTitle: string;
  documentStatus: DocumentStatus;
  baseVersionId: string;
  baseContent: string;
  status: 'open' | 'merged' | 'cancelled';
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  submissions: SubmissionView[];
}

export interface ConflictPair {
  a: ChangeView;
  b: ChangeView;
}

export type BackupKind = 'auto' | 'manual' | 'pre_migration';

export interface BackupSummary {
  id: string;
  file: string;
  sizeBytes: number;
  kind: BackupKind;
  integrityOk: boolean;
  createdAt: string;
}

export interface BackupStatus {
  dir: string;
  autoIntervalHours: number;
  autoKeep: number;
  lastAuto: BackupSummary | null;
  latest: BackupSummary | null;
  total: number;
}

export interface PublishStats {
  rateCentsPerChar: number;
  today: { feeCents: number; pieces: number };
  total: { feeCents: number; pieces: number };
}

export type FeeStatus = 'unsettled' | 'pending' | 'settled';

export interface FeeRecord {
  id: string;
  documentId: string | null;
  documentTitle: string;
  publishNumber: number | null;
  amountCents: number;
  earnedAt: string;
  status: FeeStatus;
  settlementId: string | null;
  settledAt: string | null;
  settledByName: string | null;
}

export interface SettlementInfo {
  id: string;
  amountCents: number;
  requestedAt: string;
  requestedByName: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  confirmedAt: string | null;
  confirmedByName: string | null;
}

export interface FeesOverview {
  rateCentsPerChar: number;
  todayFeeCents: number;
  unsettledFeeCents: number;
  settledFeeCents: number;
  pendingSettlement: SettlementInfo | null;
}

export interface FeesPayload {
  overview: FeesOverview;
  fees: FeeRecord[];
}
