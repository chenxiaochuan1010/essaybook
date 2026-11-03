import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from '../db/sqlite.js';
import { DATA_DIR, db, nowIso } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { badRequest, notFound } from '../lib/errors.js';

export type BackupKind = 'auto' | 'manual' | 'pre_migration';

export interface BackupSummary {
  id: string;
  file: string;
  sizeBytes: number;
  kind: BackupKind;
  integrityOk: boolean;
  createdAt: string;
}

interface BackupRow {
  id: string;
  path: string;
  size_bytes: number;
  kind: BackupKind;
  integrity_ok: number;
  created_at: string;
}

export const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.join(DATA_DIR, 'backups');

const AUTO_KEEP = Number(process.env.BACKUP_KEEP ?? 30);
const AUTO_INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS ?? 24);

function mapBackup(row: BackupRow): BackupSummary {
  return {
    id: row.id,
    file: path.basename(row.path),
    sizeBytes: row.size_bytes,
    kind: row.kind,
    integrityOk: row.integrity_ok === 1,
    createdAt: row.created_at,
  };
}

export function listBackups(limit = 50): BackupSummary[] {
  const rows = db
    .prepare('SELECT * FROM backups ORDER BY created_at DESC LIMIT ?')
    .all(limit) as unknown as BackupRow[];
  return rows.map(mapBackup);
}

function timestampForFile(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * 用 SQLite 的 VACUUM INTO 生成一致性快照，不需要停服。
 */
export function createBackup(kind: BackupKind = 'manual'): BackupSummary {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const fileName = `essaybook-${timestampForFile()}-${kind}.sqlite`;
  const filePath = path.join(BACKUP_DIR, fileName);

  if (fs.existsSync(filePath)) {
    throw badRequest('备份文件已存在，请稍后再试');
  }

  // VACUUM INTO 不支持参数绑定，路径里的单引号需要转义。
  db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);

  let integrityOk = false;
  try {
    const check = new DatabaseSync(filePath, { readOnly: true });
    const row = check.prepare('PRAGMA integrity_check').get() as
      | { integrity_check: string }
      | undefined;
    integrityOk = row?.integrity_check === 'ok';
    check.close();
  } catch {
    integrityOk = false;
  }

  const stat = fs.statSync(filePath);
  const id = newId();
  const createdAt = nowIso();

  db.prepare(`
    INSERT INTO backups (id, path, size_bytes, kind, integrity_ok, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, path.relative(DATA_DIR, filePath), stat.size, kind, integrityOk ? 1 : 0, createdAt);

  pruneBackups();

  return {
    id,
    file: fileName,
    sizeBytes: stat.size,
    kind,
    integrityOk,
    createdAt,
  };
}

function pruneBackups(): void {
  if (!Number.isFinite(AUTO_KEEP) || AUTO_KEEP <= 0) return;

  const rows = db
    .prepare(`
      SELECT * FROM backups
      WHERE kind = 'auto'
      ORDER BY created_at DESC
    `)
    .all() as unknown as BackupRow[];

  for (const row of rows.slice(AUTO_KEEP)) {
    const absolute = path.resolve(DATA_DIR, row.path);
    try {
      fs.rmSync(absolute, { force: true });
    } catch {
      // 文件删不掉时保留记录，下次再试。
      continue;
    }
    db.prepare('DELETE FROM backups WHERE id = ?').run(row.id);
  }
}

export function getLastAutoBackup(): BackupSummary | null {
  const row = db
    .prepare(`
      SELECT * FROM backups WHERE kind = 'auto'
      ORDER BY created_at DESC LIMIT 1
    `)
    .get() as BackupRow | undefined;
  return row ? mapBackup(row) : null;
}

export function backupStatus() {
  return {
    dir: BACKUP_DIR,
    autoIntervalHours: AUTO_INTERVAL_HOURS,
    autoKeep: AUTO_KEEP,
    lastAuto: getLastAutoBackup(),
    latest: listBackups(1)[0] ?? null,
    total: (db.prepare('SELECT COUNT(*) AS count FROM backups').get() as { count: number })
      .count,
  };
}

/**
 * 启动一个轻量定时器：服务启动 45 秒后检查，之后每小时检查一次。
 * 只有距离上次自动备份超过间隔时才会真正创建快照。
 */
export function startBackupScheduler(): void {
  if (!Number.isFinite(AUTO_INTERVAL_HOURS) || AUTO_INTERVAL_HOURS <= 0) return;

  const tick = () => {
    try {
      const last = getLastAutoBackup();
      const intervalMs = AUTO_INTERVAL_HOURS * 60 * 60 * 1000;
      if (last && Date.now() - new Date(last.createdAt).getTime() < intervalMs) return;
      const backup = createBackup('auto');
      console.info(
        `[backup] 已创建自动备份 ${backup.file}（${Math.round(backup.sizeBytes / 1024)} KB，完整性 ${backup.integrityOk ? '通过' : '失败'}）`,
      );
    } catch (error) {
      console.error('[backup] 自动备份失败', error);
    }
  };

  const first = setTimeout(tick, 45_000);
  first.unref?.();

  const timer = setInterval(tick, 60 * 60 * 1000);
  timer.unref?.();
}

export function deleteBackup(id: string): void {
  const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(id) as
    | BackupRow
    | undefined;
  if (!row) throw notFound('找不到这个备份');

  fs.rmSync(path.resolve(DATA_DIR, row.path), { force: true });
  db.prepare('DELETE FROM backups WHERE id = ?').run(id);
}
