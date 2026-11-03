import { db, nowIso, transaction } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';

/** 每 1 个字（不含标点）1 分钱。 */
export const FEE_CENTS_PER_CHAR = 1;

export type FeeStatus = 'unsettled' | 'pending' | 'settled';
export type SettlementStatus = 'pending' | 'confirmed' | 'cancelled';

interface FeeRow {
  id: string;
  document_id: string | null;
  document_title: string;
  publish_number: number | null;
  amount_cents: number;
  earned_at: string;
  settlement_id: string | null;
  settled_at: string | null;
  settled_by: string | null;
  settled_by_name?: string | null;
}

interface SettlementRow {
  id: string;
  requested_by: string;
  requested_at: string;
  status: SettlementStatus;
  amount_cents: number;
  confirmed_by: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  requested_by_name?: string | null;
  confirmed_by_name?: string | null;
}

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
  status: SettlementStatus;
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

function mapFee(row: FeeRow): FeeRecord {
  const status: FeeStatus = row.settled_at
    ? 'settled'
    : row.settlement_id
      ? 'pending'
      : 'unsettled';

  return {
    id: row.id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    publishNumber: row.publish_number,
    amountCents: Number(row.amount_cents),
    earnedAt: row.earned_at,
    status,
    settlementId: row.settlement_id,
    settledAt: row.settled_at,
    settledByName: row.settled_by_name ?? null,
  };
}

function mapSettlement(row: SettlementRow): SettlementInfo {
  return {
    id: row.id,
    amountCents: Number(row.amount_cents),
    requestedAt: row.requested_at,
    requestedByName: row.requested_by_name ?? '小朋友',
    status: row.status,
    confirmedAt: row.confirmed_at,
    confirmedByName: row.confirmed_by_name ?? null,
  };
}

function getSettlementRow(id: string): SettlementRow | undefined {
  return db
    .prepare(`
      SELECT s.*, ru.name AS requested_by_name, cu.name AS confirmed_by_name
      FROM settlements s
      LEFT JOIN users ru ON ru.id = s.requested_by
      LEFT JOIN users cu ON cu.id = s.confirmed_by
      WHERE s.id = ?
    `)
    .get(id) as SettlementRow | undefined;
}

export function getSettlement(id: string): SettlementInfo {
  const row = getSettlementRow(id);
  if (!row) throw notFound('找不到这笔结算');
  return mapSettlement(row);
}

export function getFeeForDocument(documentId: string): {
  amountCents: number;
  settlementId: string | null;
  settledAt: string | null;
} | null {
  const row = db
    .prepare('SELECT * FROM fees WHERE document_id = ?')
    .get(documentId) as FeeRow | undefined;
  if (!row) return null;
  return {
    amountCents: Number(row.amount_cents),
    settlementId: row.settlement_id,
    settledAt: row.settled_at,
  };
}

/**
 * 生成成品时登记稿费。每篇作文只有一条稿费记录：
 * 未结算时随重新生成更新金额；已结算或结算中时只更新标题，不改金额。
 */
export function recordPublishFee(input: {
  documentId: string;
  documentTitle: string;
  publishNumber: number;
  amountCents: number;
  earnedAt: string;
}): void {
  const existing = db
    .prepare('SELECT * FROM fees WHERE document_id = ?')
    .get(input.documentId) as FeeRow | undefined;

  if (!existing) {
    db.prepare(`
      INSERT INTO fees
        (id, document_id, document_title, publish_number, amount_cents, earned_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      newId(),
      input.documentId,
      input.documentTitle,
      input.publishNumber,
      input.amountCents,
      input.earnedAt,
    );
    return;
  }

  if (existing.settlement_id || existing.settled_at) {
    db.prepare(`
      UPDATE fees SET document_title = ?, publish_number = ? WHERE id = ?
    `).run(input.documentTitle, input.publishNumber, existing.id);
    return;
  }

  db.prepare(`
    UPDATE fees
    SET document_title = ?, publish_number = ?, amount_cents = ?, earned_at = ?
    WHERE id = ?
  `).run(
    input.documentTitle,
    input.publishNumber,
    input.amountCents,
    input.earnedAt,
    existing.id,
  );
}

function startOfTodayIso(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

export function getPublishStats() {
  const start = startOfTodayIso();

  const today = db
    .prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS feeCents, COUNT(*) AS pieces
      FROM fees WHERE earned_at >= ?
    `)
    .get(start) as { feeCents: number; pieces: number };

  const total = db
    .prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS feeCents, COUNT(*) AS pieces
      FROM fees
    `)
    .get() as { feeCents: number; pieces: number };

  return {
    rateCentsPerChar: FEE_CENTS_PER_CHAR,
    today: { feeCents: Number(today.feeCents), pieces: Number(today.pieces) },
    total: { feeCents: Number(total.feeCents), pieces: Number(total.pieces) },
  };
}

export function getFeesPayload(): FeesPayload {
  const start = startOfTodayIso();

  const today = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM fees WHERE earned_at >= ?')
    .get(start) as { cents: number };

  const unsettled = db
    .prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS cents
      FROM fees WHERE settled_at IS NULL
    `)
    .get() as { cents: number };

  const settled = db
    .prepare(`
      SELECT COALESCE(SUM(amount_cents), 0) AS cents
      FROM fees WHERE settled_at IS NOT NULL
    `)
    .get() as { cents: number };

  const pendingRow = db
    .prepare(`
      SELECT s.*, ru.name AS requested_by_name, cu.name AS confirmed_by_name
      FROM settlements s
      LEFT JOIN users ru ON ru.id = s.requested_by
      LEFT JOIN users cu ON cu.id = s.confirmed_by
      WHERE s.status = 'pending'
      ORDER BY s.requested_at DESC
      LIMIT 1
    `)
    .get() as SettlementRow | undefined;

  const feeRows = db
    .prepare(`
      SELECT f.*, u.name AS settled_by_name
      FROM fees f
      LEFT JOIN users u ON u.id = f.settled_by
      ORDER BY f.earned_at DESC, f.id DESC
      LIMIT 200
    `)
    .all() as unknown as FeeRow[];

  return {
    overview: {
      rateCentsPerChar: FEE_CENTS_PER_CHAR,
      todayFeeCents: Number(today.cents),
      unsettledFeeCents: Number(unsettled.cents),
      settledFeeCents: Number(settled.cents),
      pendingSettlement: pendingRow ? mapSettlement(pendingRow) : null,
    },
    fees: feeRows.map(mapFee),
  };
}

export function requestSettlement(userId: string) {
  return transaction(() => {
    const pending = db
      .prepare("SELECT id FROM settlements WHERE status = 'pending' LIMIT 1")
      .get() as { id: string } | undefined;
    if (pending) {
      throw conflict('SETTLEMENT_PENDING', '已经有一笔结算在等爸爸妈妈确认了');
    }

    const feeRows = db
      .prepare(`
        SELECT id, amount_cents FROM fees
        WHERE settlement_id IS NULL AND settled_at IS NULL
      `)
      .all() as unknown as Array<{ id: string; amount_cents: number }>;

    if (feeRows.length === 0) {
      throw badRequest('还没有可以结算的稿费');
    }

    const amountCents = feeRows.reduce(
      (sum, fee) => sum + Number(fee.amount_cents),
      0,
    );
    const id = newId();
    const now = nowIso();

    db.prepare(`
      INSERT INTO settlements
        (id, requested_by, requested_at, status, amount_cents)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(id, userId, now, amountCents);

    const link = db.prepare('UPDATE fees SET settlement_id = ? WHERE id = ?');
    for (const fee of feeRows) link.run(id, fee.id);

    return { settlement: getSettlement(id), amountCents };
  });
}

export function confirmSettlement(settlementId: string, userId: string) {
  return transaction(() => {
    const row = getSettlementRow(settlementId);
    if (!row) throw notFound('找不到这笔结算');
    if (row.status !== 'pending') {
      throw conflict('SETTLEMENT_CLOSED', '这笔结算已经处理过了');
    }

    const now = nowIso();
    db.prepare(`
      UPDATE fees SET settled_at = ?, settled_by = ? WHERE settlement_id = ?
    `).run(now, userId, settlementId);

    db.prepare(`
      UPDATE settlements
      SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?
      WHERE id = ?
    `).run(userId, now, settlementId);

    return { settlement: getSettlement(settlementId) };
  });
}

export function cancelSettlement(settlementId: string, userId: string) {
  return transaction(() => {
    const row = getSettlementRow(settlementId);
    if (!row) throw notFound('找不到这笔结算');
    if (row.requested_by !== userId) {
      throw forbidden('只能撤销自己发起的结算');
    }
    if (row.status !== 'pending') {
      throw conflict('SETTLEMENT_CLOSED', '这笔结算已经处理过了');
    }

    db.prepare('UPDATE fees SET settlement_id = NULL WHERE settlement_id = ?').run(
      settlementId,
    );
    db.prepare(`
      UPDATE settlements SET status = 'cancelled', cancelled_at = ? WHERE id = ?
    `).run(nowIso(), settlementId);

    return { ok: true };
  });
}
