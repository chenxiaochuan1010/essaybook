import {
  acceptedConflicts,
  applyAcceptedChanges,
  buildChanges,
  countWords,
  findConflicts,
  type IdentifiedChange,
} from '@essaybook/core';
import { db, nowIso, transaction } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import {
  createVersion,
  getDocument,
  getDocumentOrThrow,
  type DocumentDetail,
  type VersionSummary,
} from './documents.js';

export type RoundStatus = 'open' | 'merged' | 'cancelled';
export type SubmissionStatus = 'submitted' | 'processed' | 'withdrawn';
export type ChangeStatus = 'pending' | 'accepted' | 'rejected' | 'conflict';

interface RoundRow {
  id: string;
  document_id: string;
  base_version_id: string;
  status: RoundStatus;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

interface SubmissionRow {
  id: string;
  round_id: string;
  reviewer_id: string;
  base_version_id: string;
  edited_content: string;
  status: SubmissionStatus;
  created_at: string;
  processed_at: string | null;
}

interface ChangeRow {
  id: string;
  submission_id: string;
  seq: number;
  type: 'insert' | 'delete' | 'replace';
  base_start: number;
  base_end: number;
  old_text: string;
  new_text: string;
  status: ChangeStatus;
  decided_by: string | null;
  decided_at: string | null;
}

interface SubmissionWithUserRow extends SubmissionRow {
  reviewer_name: string;
  reviewer_color: string;
}

interface ChangeWithUserRow extends ChangeRow {
  reviewer_id: string;
  reviewer_name: string;
  reviewer_color: string;
  submission_created_at: string;
}

export interface ChangeView {
  id: string;
  submissionId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerColor: string;
  seq: number;
  type: 'insert' | 'delete' | 'replace';
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
  status: SubmissionStatus;
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

export interface RoundView {
  id: string;
  documentId: string;
  documentTitle: string;
  documentStatus: string;
  baseVersionId: string;
  baseContent: string;
  status: RoundStatus;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  submissions: SubmissionView[];
}

function getRoundRow(id: string): RoundRow | undefined {
  return db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(id) as
    | RoundRow
    | undefined;
}

export function getRoundOrThrow(id: string): RoundRow {
  const round = getRoundRow(id);
  if (!round) throw notFound('找不到这次审阅');
  return round;
}

function mapChange(row: ChangeWithUserRow): ChangeView {
  return {
    id: row.id,
    submissionId: row.submission_id,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerColor: row.reviewer_color,
    seq: row.seq,
    type: row.type,
    baseStart: row.base_start,
    baseEnd: row.base_end,
    oldText: row.old_text,
    newText: row.new_text,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
  };
}

export function getRound(roundId: string): RoundView {
  const round = getRoundOrThrow(roundId);
  const doc = db.prepare('SELECT id, title, status FROM documents WHERE id = ?').get(
    round.document_id,
  ) as { id: string; title: string; status: string } | undefined;
  if (!doc) throw notFound('找不到这篇作文');

  const base = db.prepare('SELECT content FROM versions WHERE id = ?').get(
    round.base_version_id,
  ) as { content: string } | undefined;
  if (!base) throw notFound('找不到基准版本');

  const submissions = db.prepare(`
    SELECT s.*, u.name AS reviewer_name, u.color AS reviewer_color
    FROM review_submissions s
    JOIN users u ON u.id = s.reviewer_id
    WHERE s.round_id = ?
    ORDER BY s.created_at ASC
  `).all(roundId) as unknown as SubmissionWithUserRow[];

  const changeRows = db.prepare(`
    SELECT c.*, s.reviewer_id, u.name AS reviewer_name, u.color AS reviewer_color,
           s.created_at AS submission_created_at
    FROM changes c
    JOIN review_submissions s ON s.id = c.submission_id
    JOIN users u ON u.id = s.reviewer_id
    WHERE s.round_id = ?
    ORDER BY s.created_at ASC, c.seq ASC
  `).all(roundId) as unknown as ChangeWithUserRow[];

  const changesBySubmission = new Map<string, ChangeView[]>();
  for (const row of changeRows) {
    const list = changesBySubmission.get(row.submission_id) ?? [];
    list.push(mapChange(row));
    changesBySubmission.set(row.submission_id, list);
  }

  const submissionViews: SubmissionView[] = submissions.map((submission) => {
    const changes = changesBySubmission.get(submission.id) ?? [];
    return {
      id: submission.id,
      reviewerId: submission.reviewer_id,
      reviewerName: submission.reviewer_name,
      reviewerColor: submission.reviewer_color,
      status: submission.status,
      createdAt: submission.created_at,
      processedAt: submission.processed_at,
      summary: {
        total: changes.length,
        insert: changes.filter((change) => change.type === 'insert').length,
        delete: changes.filter((change) => change.type === 'delete').length,
        replace: changes.filter((change) => change.type === 'replace').length,
      },
      changes,
    };
  });

  return {
    id: round.id,
    documentId: round.document_id,
    documentTitle: doc.title,
    documentStatus: doc.status,
    baseVersionId: round.base_version_id,
    baseContent: base.content,
    status: round.status,
    createdBy: round.created_by,
    createdAt: round.created_at,
    closedAt: round.closed_at,
    submissions: submissionViews,
  };
}

export function getSubmission(submissionId: string): SubmissionView & {
  editedContent: string;
} {
  const row = db.prepare(`
    SELECT s.*, u.name AS reviewer_name, u.color AS reviewer_color
    FROM review_submissions s
    JOIN users u ON u.id = s.reviewer_id
    WHERE s.id = ?
  `).get(submissionId) as SubmissionWithUserRow | undefined;
  if (!row) throw notFound('找不到这次提交');

  const changes = db.prepare(`
    SELECT c.*, s.reviewer_id, u.name AS reviewer_name, u.color AS reviewer_color,
           s.created_at AS submission_created_at
    FROM changes c
    JOIN review_submissions s ON s.id = c.submission_id
    JOIN users u ON u.id = s.reviewer_id
    WHERE c.submission_id = ?
    ORDER BY c.seq ASC
  `).all(submissionId) as unknown as ChangeWithUserRow[];

  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    reviewerName: row.reviewer_name,
    reviewerColor: row.reviewer_color,
    status: row.status,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    summary: {
      total: changes.length,
      insert: changes.filter((change) => change.type === 'insert').length,
      delete: changes.filter((change) => change.type === 'delete').length,
      replace: changes.filter((change) => change.type === 'replace').length,
    },
    changes: changes.map(mapChange),
    editedContent: row.edited_content,
  };
}

/**
 * Changes belonging to active (not withdrawn) submissions in a round.
 */
export function getSubmittedChanges(roundId: string): IdentifiedChange[] {
  const rows = db.prepare(`
    SELECT c.*, s.reviewer_id, u.name AS reviewer_name, u.color AS reviewer_color,
           s.created_at AS submission_created_at
    FROM changes c
    JOIN review_submissions s ON s.id = c.submission_id
    JOIN users u ON u.id = s.reviewer_id
    WHERE s.round_id = ? AND s.status = 'submitted'
    ORDER BY s.created_at ASC, c.seq ASC
  `).all(roundId) as unknown as ChangeWithUserRow[];

  return rows.map((row) => ({
    id: row.id,
    submissionId: row.submission_id,
    reviewerId: row.reviewer_id,
    seq: row.seq,
    type: row.type,
    baseStart: row.base_start,
    baseEnd: row.base_end,
    oldText: row.old_text,
    newText: row.new_text,
    status: row.status,
  }));
}

export function submitForReview(documentId: string, userId: string): RoundView {
  return transaction(() => {
    const doc = getDocumentOrThrow(documentId);
    if (doc.status !== 'draft') {
      throw conflict('DOCUMENT_LOCKED', '这篇作文当前不能提交审阅');
    }
    if (!doc.content.trim()) {
      throw badRequest('作文还是空的，先写一点内容吧');
    }

    const base = createVersion(
      documentId,
      doc.content,
      userId,
      'review_base',
      doc.current_version_id,
      '提交审阅的基准版本',
    );

    const roundId = newId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO review_rounds
        (id, document_id, base_version_id, status, created_by, created_at)
      VALUES (?, ?, ?, 'open', ?, ?)
    `).run(roundId, documentId, base.id, userId, now);

    db.prepare(`
      UPDATE documents
      SET status = 'in_review', active_round_id = ?, current_version_id = ?, updated_at = ?
      WHERE id = ?
    `).run(roundId, base.id, now, documentId);

    return getRound(roundId);
  });
}

export function submitReview(
  roundId: string,
  reviewerId: string,
  content: string,
): SubmissionView {
  return transaction(() => {
    const round = getRoundOrThrow(roundId);
    if (round.status !== 'open') {
      throw conflict('ROUND_CLOSED', '这次审阅已经结束');
    }

    const doc = getDocumentOrThrow(round.document_id);
    if (doc.status !== 'in_review') {
      throw conflict('ROUND_CLOSED', '这篇作文不在审阅状态');
    }

    const base = db.prepare('SELECT content FROM versions WHERE id = ?').get(
      round.base_version_id,
    ) as { content: string } | undefined;
    if (!base) throw notFound('找不到基准版本');

    if (content === base.content) {
      throw badRequest('没有检测到修改');
    }

    const changes = buildChanges(base.content, content);
    if (changes.length === 0) {
      throw badRequest('没有检测到修改');
    }

    const existing = db.prepare(`
      SELECT id FROM review_submissions
      WHERE round_id = ? AND reviewer_id = ? AND status = 'submitted'
    `).get(roundId, reviewerId) as { id: string } | undefined;

    if (existing) {
      throw conflict('ALREADY_SUBMITTED', '你已经提交过修订，请先撤回再重新提交');
    }

    const submissionId = newId();
    const now = nowIso();
    db.prepare(`
      INSERT INTO review_submissions
        (id, round_id, reviewer_id, base_version_id, edited_content, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'submitted', ?)
    `).run(submissionId, roundId, reviewerId, round.base_version_id, content, now);

    const insertChange = db.prepare(`
      INSERT INTO changes
        (id, submission_id, seq, type, base_start, base_end, old_text, new_text, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);

    changes.forEach((change, index) => {
      insertChange.run(
        newId(),
        submissionId,
        index,
        change.type,
        change.baseStart,
        change.baseEnd,
        change.oldText,
        change.newText,
      );
    });

    const view = getSubmission(submissionId);
    return view;
  });
}

export function updateChangeStatus(
  changeId: string,
  status: 'accepted' | 'rejected',
  userId: string,
): ChangeView {
  const row = db.prepare(`
    SELECT c.*, s.reviewer_id, u.name AS reviewer_name, u.color AS reviewer_color,
           s.created_at AS submission_created_at, r.status AS round_status
    FROM changes c
    JOIN review_submissions s ON s.id = c.submission_id
    JOIN review_rounds r ON r.id = s.round_id
    JOIN users u ON u.id = s.reviewer_id
    WHERE c.id = ?
  `).get(changeId) as (ChangeWithUserRow & { round_status: RoundStatus }) | undefined;

  if (!row) throw notFound('找不到这条修订');
  if (row.round_status !== 'open') {
    throw conflict('ROUND_CLOSED', '这次审阅已经结束');
  }

  db.prepare(`
    UPDATE changes SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?
  `).run(status, userId, nowIso(), changeId);

  return mapChange({ ...row, status });
}

export function bulkUpdateChangeStatus(
  roundId: string,
  status: 'accepted' | 'rejected',
  userId: string,
  reviewerId?: string,
): { updated: number } {
  const round = getRoundOrThrow(roundId);
  if (round.status !== 'open') {
    throw conflict('ROUND_CLOSED', '这次审阅已经结束');
  }

  const params: string[] = [status, userId, nowIso(), roundId];
  let reviewerFilter = '';
  if (reviewerId) {
    reviewerFilter = 'AND s.reviewer_id = ?';
    params.push(reviewerId);
  }

  const result = db.prepare(`
    UPDATE changes
    SET status = ?, decided_by = ?, decided_at = ?
    WHERE submission_id IN (
      SELECT s.id FROM review_submissions s
      WHERE s.round_id = ? AND s.status = 'submitted' ${reviewerFilter}
    )
  `).run(...params);

  return { updated: Number(result.changes) };
}

export function getRoundConflicts(roundId: string) {
  const changes = getSubmittedChanges(roundId);
  const accepted = changes.filter((change) => change.status === 'accepted');
  const pairs = findConflicts(accepted);

  const byId = new Map(changes.map((change) => [change.id, change]));
  return {
    conflicts: pairs.map((pair) => ({
      a: byId.get(pair.a.id)!,
      b: byId.get(pair.b.id)!,
    })),
  };
}

export function withdrawSubmission(submissionId: string, userId: string): void {
  const row = db.prepare(`
    SELECT s.*, r.status AS round_status
    FROM review_submissions s
    JOIN review_rounds r ON r.id = s.round_id
    WHERE s.id = ?
  `).get(submissionId) as (SubmissionRow & { round_status: RoundStatus }) | undefined;

  if (!row) throw notFound('找不到这次提交');
  if (row.reviewer_id !== userId) {
    throw conflict('FORBIDDEN', '只能撤回自己的修订');
  }
  if (row.round_status !== 'open' || row.status !== 'submitted') {
    throw conflict('ROUND_CLOSED', '这次提交已经不能撤回');
  }

  db.prepare(`
    UPDATE review_submissions SET status = 'withdrawn' WHERE id = ?
  `).run(submissionId);
}

export interface MergeResult {
  document: DocumentDetail;
  version: VersionSummary | null;
  acceptedCount: number;
}

export function mergeRound(roundId: string, userId: string): MergeResult {
  return transaction(() => {
    const round = getRoundOrThrow(roundId);
    if (round.status !== 'open') {
      throw conflict('ROUND_CLOSED', '这次审阅已经结束');
    }

    const changes = getSubmittedChanges(roundId);
    const conflicts = acceptedConflicts(changes);
    if (conflicts.length > 0) {
      throw conflict('MERGE_CONFLICT', '有修改互相冲突，请先处理冲突', {
        conflicts,
      });
    }

    const base = db.prepare('SELECT content FROM versions WHERE id = ?').get(
      round.base_version_id,
    ) as { content: string } | undefined;
    if (!base) throw notFound('找不到基准版本');

    const accepted = changes.filter((change) => change.status === 'accepted');
    const now = nowIso();

    db.prepare(`
      UPDATE changes
      SET status = 'rejected', decided_by = ?, decided_at = ?
      WHERE status = 'pending' AND submission_id IN (
        SELECT id FROM review_submissions WHERE round_id = ? AND status = 'submitted'
      )
    `).run(userId, now, roundId);

    let version: VersionSummary | null = null;
    let mergedContent = base.content;

    if (accepted.length > 0) {
      mergedContent = applyAcceptedChanges(base.content, changes);
      const created = createVersion(
        round.document_id,
        mergedContent,
        userId,
        'merge',
        round.base_version_id,
        `合并审阅：接受 ${accepted.length} 处修订`,
      );
      version = {
        id: created.id,
        documentId: created.document_id,
        kind: created.kind,
        createdBy: created.created_by,
        authorName: '',
        authorColor: '',
        parentVersionId: created.parent_version_id,
        note: created.note,
        charCount: countWords(mergedContent).chars,
        createdAt: created.created_at,
      };
    }

    db.prepare(`
      UPDATE documents
      SET content = ?, status = 'draft', active_round_id = NULL,
          current_version_id = COALESCE(?, current_version_id), updated_at = ?
      WHERE id = ?
    `).run(mergedContent, version?.id ?? null, now, round.document_id);

    db.prepare(`
      UPDATE review_rounds SET status = 'merged', closed_at = ? WHERE id = ?
    `).run(now, roundId);

    db.prepare(`
      UPDATE review_submissions
      SET status = 'processed', processed_at = ?
      WHERE round_id = ? AND status = 'submitted'
    `).run(now, roundId);

    return {
      document: getDocument(round.document_id),
      version,
      acceptedCount: accepted.length,
    };
  });
}

export function cancelRound(roundId: string): RoundView {
  return transaction(() => {
    const round = getRoundOrThrow(roundId);
    if (round.status !== 'open') {
      throw conflict('ROUND_CLOSED', '这次审阅已经结束');
    }

    const now = nowIso();
    db.prepare(`
      UPDATE review_rounds SET status = 'cancelled', closed_at = ? WHERE id = ?
    `).run(now, roundId);

    db.prepare(`
      UPDATE documents
      SET status = 'draft', active_round_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(now, round.document_id);

    return getRound(roundId);
  });
}

export function listRoundsForDocument(documentId: string): RoundRow[] {
  return db.prepare(`
    SELECT * FROM review_rounds WHERE document_id = ? ORDER BY created_at DESC
  `).all(documentId) as unknown as RoundRow[];
}
