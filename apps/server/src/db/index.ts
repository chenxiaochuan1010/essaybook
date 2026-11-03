import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from './sqlite.js';
import { SCHEMA_SQL } from './schema.js';
import { seedDefaultUsers } from './seed.js';

const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(process.cwd(), 'data');

fs.mkdirSync(dataDir, { recursive: true });

export const DATA_DIR = dataDir;

export const DB_PATH = path.join(dataDir, 'essaybook.sqlite');

export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

export function initDb(): void {
  db.exec(SCHEMA_SQL);
  migrateColumns();
  seedDefaultUsers(db);
}

/**
 * 轻量迁移：给已有数据库补上后来新增的列。
 * SQLite 的 CREATE TABLE IF NOT EXISTS 不会修改旧表，所以需要显式检查。
 */
function migrateColumns(): void {
  ensureColumn('users', 'onboarded_at', 'onboarded_at TEXT');
  ensureColumn('documents', 'published_at', 'published_at TEXT');
  ensureColumn('documents', 'publish_number', 'publish_number INTEGER');
  ensureColumn('documents', 'publish_fee_cents', 'publish_fee_cents INTEGER');
}

function ensureColumn(table: string, column: string, ddl: string): void {
  const rows = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as unknown as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
