import { createHash } from 'node:crypto';
import { countWords, buildChanges } from '@essaybook/core';
import { db, nowIso, transaction } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { conflict, notFound } from '../lib/errors.js';
import {
  FEE_CENTS_PER_CHAR,
  getFeeForDocument,
  recordPublishFee,
} from './fees.js';

export type DocumentStatus = 'draft' | 'in_review' | 'final';
export type VersionKind =
  | 'snapshot'
  | 'auto_snapshot'
  | 'review_base'
  | 'merge'
  | 'restore'
  | 'import';

export interface DocumentRow {
  id: string;
  title: string;
  content: string;
  status: DocumentStatus;
  owner_id: string;
  folder_id: string | null;
  current_version_id: string | null;
  active_round_id: string | null;
  published_at: string | null;
  publish_number: number | null;
  publish_fee_cents: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  document_id: string;
  content: string;
  content_hash: string;
  kind: VersionKind;
  created_by: string;
  parent_version_id: string | null;
  note: string | null;
  created_at: string;
}

interface DocumentListRow extends DocumentRow {
  owner_name: string;
  owner_color: string;
  excerpt: string;
  version_count: number;
  pending_submissions: number;
  has_merged_round?: number;
}

interface VersionListRow extends VersionRow {
  author_name: string;
  author_color: string;
}

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
  wordCount: ReturnType<typeof countWords>;
  /** 已经完成过一次修订合并，可以直接再次生成成品。 */
  canPublish: boolean;
}

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

function mapSummary(row: DocumentListRow): DocumentSummary {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt ?? '',
    status: row.status,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    ownerColor: row.owner_color,
    charCount: countWords(row.content).chars,
    versionCount: row.version_count ?? 0,
    pendingSubmissions: row.pending_submissions ?? 0,
    activeRoundId: row.active_round_id,
    publishedAt: row.published_at ?? null,
    publishNumber: row.publish_number ?? null,
    publishFeeCents: row.publish_fee_cents ?? null,
    deletedAt: row.deleted_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getDocumentRow(id: string): DocumentRow | undefined {
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as
    | DocumentRow
    | undefined;
}

export function getDocumentOrThrow(id: string): DocumentRow {
  const row = getDocumentRow(id);
  if (!row || row.deleted_at) throw notFound('找不到这篇作文');
  return row;
}

export function getDocument(id: string): DocumentDetail {
  const row = db.prepare(`
    SELECT d.*, u.name AS owner_name, u.color AS owner_color,
           substr(d.content, 1, 160) AS excerpt,
           (SELECT COUNT(*) FROM versions v WHERE v.document_id = d.id) AS version_count,
           (SELECT COUNT(*) FROM review_submissions s
             WHERE s.round_id = d.active_round_id AND s.status = 'submitted') AS pending_submissions,
           (SELECT COUNT(*) FROM review_rounds r
             WHERE r.document_id = d.id AND r.status = 'merged') AS has_merged_round
    FROM documents d
    JOIN users u ON u.id = d.owner_id
    WHERE d.id = ? AND d.deleted_at IS NULL
  `).get(id) as DocumentListRow | undefined;

  if (!row) throw notFound('找不到这篇作文');

  return {
    ...mapSummary(row),
    content: row.content,
    currentVersionId: row.current_version_id,
    folderId: row.folder_id,
    wordCount: countWords(row.content),
    canPublish:
      Number(row.has_merged_round ?? 0) > 0 || Boolean(row.publish_number),
  };
}

export function listDocuments(): DocumentSummary[] {
  const rows = db.prepare(`
    SELECT d.*, u.name AS owner_name, u.color AS owner_color,
           substr(d.content, 1, 160) AS excerpt,
           (SELECT COUNT(*) FROM versions v WHERE v.document_id = d.id) AS version_count,
           (SELECT COUNT(*) FROM review_submissions s
             WHERE s.round_id = d.active_round_id AND s.status = 'submitted') AS pending_submissions
    FROM documents d
    JOIN users u ON u.id = d.owner_id
    WHERE d.deleted_at IS NULL
    ORDER BY d.updated_at DESC
  `).all() as unknown as DocumentListRow[];

  return rows.map(mapSummary);
}

export function listTrash(): DocumentSummary[] {
  const rows = db.prepare(`
    SELECT d.*, u.name AS owner_name, u.color AS owner_color,
           substr(d.content, 1, 160) AS excerpt,
           (SELECT COUNT(*) FROM versions v WHERE v.document_id = d.id) AS version_count,
           0 AS pending_submissions
    FROM documents d
    JOIN users u ON u.id = d.owner_id
    WHERE d.deleted_at IS NOT NULL
    ORDER BY d.deleted_at DESC
  `).all() as unknown as DocumentListRow[];

  return rows.map(mapSummary);
}

export function createDocument(ownerId: string, title = ''): DocumentDetail {
  const id = newId();
  const now = nowIso();
  db.prepare(`
    INSERT INTO documents (id, title, content, status, owner_id, created_at, updated_at)
    VALUES (?, ?, '', 'draft', ?, ?, ?)
  `).run(id, title.trim(), ownerId, now, now);
  return getDocument(id);
}

export function updateDocument(
  id: string,
  userId: string,
  input: { title?: string; content?: string },
): DocumentDetail {
  const doc = getDocumentOrThrow(id);
  if (doc.status === 'in_review') {
    throw conflict('DOCUMENT_LOCKED', '这篇作文正在审阅中，暂时不能修改');
  }
  if (doc.status === 'final' && input.content !== undefined) {
    throw conflict('DOCUMENT_LOCKED', '这篇作文已经是成品，点「继续修改」后才能编辑');
  }

  const title = input.title !== undefined ? input.title : doc.title;
  const content = input.content !== undefined ? input.content : doc.content;
  const contentChanged = content !== doc.content;
  const now = nowIso();

  db.prepare(`
    UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ?
  `).run(title, content, now, id);

  if (contentChanged) {
    maybeCreateAutoSnapshot(id, userId, content, doc.current_version_id);
  }

  return getDocument(id);
}

function maybeCreateAutoSnapshot(
  documentId: string,
  userId: string,
  content: string,
  parentVersionId: string | null,
): void {
  const last = db.prepare(`
    SELECT created_at FROM versions
    WHERE document_id = ? AND kind = 'auto_snapshot'
    ORDER BY created_at DESC LIMIT 1
  `).get(documentId) as { created_at: string } | undefined;

  const tenMinutes = 10 * 60 * 1000;
  if (last && Date.now() - new Date(last.created_at).getTime() < tenMinutes) return;

  const version = createVersion(
    documentId,
    content,
    userId,
    'auto_snapshot',
    parentVersionId,
    '自动保存点',
  );
  db.prepare('UPDATE documents SET current_version_id = ? WHERE id = ?').run(
    version.id,
    documentId,
  );
}

export function softDeleteDocument(id: string): void {
  const doc = getDocumentOrThrow(id);
  if (doc.status === 'in_review') {
    throw conflict('DOCUMENT_LOCKED', '这篇作文正在审阅中，不能删除');
  }
  db.prepare('UPDATE documents SET deleted_at = ?, updated_at = ? WHERE id = ?').run(
    nowIso(),
    nowIso(),
    id,
  );
}

export function restoreDocument(id: string): DocumentDetail {
  const row = getDocumentRow(id);
  if (!row) throw notFound('找不到这篇作文');
  db.prepare('UPDATE documents SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(
    nowIso(),
    id,
  );
  return getDocument(id);
}

export interface PublishResult {
  document: DocumentDetail;
  version: VersionSummary | null;
  number: number;
}

/**
 * 生成成品：把当前正文冻结成一个成品版本，并锁定编辑。
 * 「第 N 篇」的编号只增不减，同一篇重新生成时沿用原编号。
 */
export function publishDocument(documentId: string, userId: string): PublishResult {
  return transaction(() => {
    const doc = getDocumentOrThrow(documentId);

    if (doc.status === 'in_review') {
      throw conflict('DOCUMENT_LOCKED', '这篇作文正在审阅中，还不能生成成品');
    }

    if (doc.status === 'final' && doc.publish_number) {
      return {
        document: getDocument(documentId),
        version: null,
        number: doc.publish_number,
      };
    }

    // 草稿不能直接变成成品：必须至少完成过一次修订合并。
    const mergedRound = db
      .prepare(`
        SELECT 1 AS ok FROM review_rounds
        WHERE document_id = ? AND status = 'merged'
        LIMIT 1
      `)
      .get(documentId) as { ok: number } | undefined;

    if (!mergedRound && !doc.publish_number) {
      throw conflict('NOT_READY', '先完成一次修订，才能生成成品');
    }

    if (doc.content.trim() === '') {
      throw conflict('EMPTY_DOCUMENT', '作文还是空的，先写一点内容吧');
    }

    let number = doc.publish_number ?? 0;
    if (!number) {
      const counter = db
        .prepare("SELECT value FROM settings WHERE key = 'publish_count'")
        .get() as { value: string } | undefined;
      const max = db
        .prepare('SELECT COALESCE(MAX(publish_number), 0) AS max FROM documents')
        .get() as { max: number };
      number =
        Math.max(Number(counter?.value ?? 0), Number(max.max ?? 0)) + 1;

      db.prepare(`
        INSERT INTO settings (key, value) VALUES ('publish_count', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(String(number));
    }

    const created = createVersion(
      documentId,
      doc.content,
      userId,
      'snapshot',
      doc.current_version_id,
      `成品 · 第 ${number} 篇`,
    );

    const computedFee = countWords(doc.content).chars * FEE_CENTS_PER_CHAR;
    const existingFee = getFeeForDocument(documentId);
    // 已经结算或正在结算的稿费不因重新生成而变化。
    const feeCents =
      existingFee && (existingFee.settlementId || existingFee.settledAt)
        ? existingFee.amountCents
        : computedFee;

    const now = nowIso();
    db.prepare(`
      UPDATE documents
      SET status = 'final', published_at = ?, publish_number = ?,
          publish_fee_cents = ?, current_version_id = ?, updated_at = ?
      WHERE id = ?
    `).run(now, number, feeCents, created.id, now, documentId);

    recordPublishFee({
      documentId,
      documentTitle: doc.title,
      publishNumber: number,
      amountCents: feeCents,
      earnedAt: now,
    });

    const version =
      listVersions(documentId).find((item) => item.id === created.id) ?? null;

    return { document: getDocument(documentId), version, number };
  });
}

/**
 * 继续修改：把成品退回草稿，成品版本仍然保留在历史里。
 * 编号和发布时间保留，下次再生成成品时沿用同一个编号。
 */
export function reopenDocument(documentId: string): DocumentDetail {
  const doc = getDocumentOrThrow(documentId);
  if (doc.status !== 'final') {
    throw conflict('NOT_FINAL', '这篇作文还不是成品');
  }

  db.prepare("UPDATE documents SET status = 'draft', updated_at = ? WHERE id = ?").run(
    nowIso(),
    documentId,
  );

  return getDocument(documentId);
}

/**
 * 彻底删除：只允许对回收站里的作文操作，按外键顺序清理所有关联数据。
 */
export function purgeDocument(documentId: string): void {
  const row = getDocumentRow(documentId);
  if (!row) throw notFound('找不到这篇作文');
  if (!row.deleted_at) {
    throw conflict('NOT_DELETED', '请先把作文放进回收站，再彻底删除');
  }

  transaction(() => {
    db.prepare(`
      DELETE FROM changes WHERE submission_id IN (
        SELECT s.id FROM review_submissions s
        JOIN review_rounds r ON r.id = s.round_id
        WHERE r.document_id = ?
      )
    `).run(documentId);

    db.prepare(`
      DELETE FROM comments WHERE submission_id IN (
        SELECT s.id FROM review_submissions s
        JOIN review_rounds r ON r.id = s.round_id
        WHERE r.document_id = ?
      )
    `).run(documentId);

    db.prepare(`
      DELETE FROM review_submissions WHERE round_id IN (
        SELECT id FROM review_rounds WHERE document_id = ?
      )
    `).run(documentId);

    db.prepare('DELETE FROM review_rounds WHERE document_id = ?').run(documentId);
    db.prepare('DELETE FROM versions WHERE document_id = ?').run(documentId);
    db.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
  });
}

export function createVersion(
  documentId: string,
  content: string,
  userId: string,
  kind: VersionKind,
  parentVersionId: string | null = null,
  note: string | null = null,
): VersionRow {
  const id = newId();
  const contentHash = createHash('sha256').update(content).digest('hex');
  const createdAt = nowIso();

  db.prepare(`
    INSERT INTO versions
      (id, document_id, content, content_hash, kind, created_by, parent_version_id, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    documentId,
    content,
    contentHash,
    kind,
    userId,
    parentVersionId,
    note,
    createdAt,
  );

  return {
    id,
    document_id: documentId,
    content,
    content_hash: contentHash,
    kind,
    created_by: userId,
    parent_version_id: parentVersionId,
    note,
    created_at: createdAt,
  };
}

function mapVersion(row: VersionListRow): VersionSummary {
  return {
    id: row.id,
    documentId: row.document_id,
    kind: row.kind,
    createdBy: row.created_by,
    authorName: row.author_name,
    authorColor: row.author_color,
    parentVersionId: row.parent_version_id,
    note: row.note,
    charCount: countWords(row.content).chars,
    createdAt: row.created_at,
  };
}

export function listVersions(documentId: string): VersionSummary[] {
  getDocumentOrThrow(documentId);
  const rows = db.prepare(`
    SELECT v.*, u.name AS author_name, u.color AS author_color
    FROM versions v
    JOIN users u ON u.id = v.created_by
    WHERE v.document_id = ?
    ORDER BY v.created_at DESC
  `).all(documentId) as unknown as VersionListRow[];

  return rows.map(mapVersion);
}

export function getVersion(versionId: string): VersionDetail {
  const row = db.prepare(`
    SELECT v.*, u.name AS author_name, u.color AS author_color
    FROM versions v
    JOIN users u ON u.id = v.created_by
    WHERE v.id = ?
  `).get(versionId) as VersionListRow | undefined;

  if (!row) throw notFound('找不到这个版本');

  return {
    ...mapVersion(row),
    content: row.content,
    contentHash: row.content_hash,
  };
}

export function saveSnapshot(
  documentId: string,
  userId: string,
  note = '手动保存',
): VersionSummary {
  const doc = getDocumentOrThrow(documentId);
  const version = createVersion(
    documentId,
    doc.content,
    userId,
    'snapshot',
    doc.current_version_id,
    note,
  );
  db.prepare('UPDATE documents SET current_version_id = ? WHERE id = ?').run(
    version.id,
    documentId,
  );
  return listVersions(documentId).find((item) => item.id === version.id)!;
}

export function restoreVersion(
  documentId: string,
  versionId: string,
  userId: string,
): DocumentDetail {
  const doc = getDocumentOrThrow(documentId);
  if (doc.status === 'in_review') {
    throw conflict('DOCUMENT_LOCKED', '审阅期间不能恢复版本');
  }

  const target = db.prepare('SELECT * FROM versions WHERE id = ? AND document_id = ?').get(
    versionId,
    documentId,
  ) as VersionRow | undefined;

  if (!target) throw notFound('找不到这个版本');

  const restored = createVersion(
    documentId,
    target.content,
    userId,
    'restore',
    doc.current_version_id,
    `恢复到 ${target.created_at} 的版本`,
  );

  db.prepare(`
    UPDATE documents SET content = ?, status = 'draft', current_version_id = ?, updated_at = ?
    WHERE id = ?
  `).run(target.content, restored.id, nowIso(), documentId);

  return getDocument(documentId);
}

export function diffVersions(versionId: string, againstId: string) {
  const a = getVersion(versionId);
  const b = getVersion(againstId);
  if (a.documentId !== b.documentId) {
    throw conflict('DIFFERENT_DOCUMENTS', '只能对比同一篇作文的版本');
  }
  return {
    from: { id: a.id, createdAt: a.createdAt, authorName: a.authorName },
    to: { id: b.id, createdAt: b.createdAt, authorName: b.authorName },
    changes: buildChanges(a.content, b.content),
  };
}
