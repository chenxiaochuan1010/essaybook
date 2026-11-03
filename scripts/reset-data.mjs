#!/usr/bin/env node
/**
 * 清空作文数据，保留家庭成员，用于交付前清理测试内容。
 *
 * 用法：node scripts/reset-data.mjs --yes
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const confirmed = process.argv.includes('--yes');
if (!confirmed) {
  console.error('这会删除所有作文、版本、修订和备份。确认无误后加 --yes 再运行。');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(root, 'apps', 'server', 'data');
const dbPath = path.join(dataDir, 'essaybook.sqlite');

if (!fs.existsSync(dbPath)) {
  console.log(`数据库不存在，无需清理：${dbPath}`);
  process.exit(0);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

const tables = [
  'changes',
  'comments',
  'review_submissions',
  'review_rounds',
  'versions',
  'documents',
  'fees',
  'settlements',
  'backups',
  'sessions',
];

db.exec('BEGIN IMMEDIATE');
try {
  for (const table of tables) {
    db.exec(`DELETE FROM ${table}`);
  }
  // 恢复默认家庭成员与首次使用状态。
  db.prepare(
    "UPDATE users SET name = '小朋友', onboarded_at = NULL WHERE id = 'u_child'",
  ).run();
  db.prepare(
    "UPDATE users SET name = '爸爸', onboarded_at = COALESCE(onboarded_at, created_at) WHERE id = 'u_dad'",
  ).run();
  db.prepare(
    "UPDATE users SET name = '妈妈', onboarded_at = COALESCE(onboarded_at, created_at) WHERE id = 'u_mom'",
  ).run();
  db.prepare("DELETE FROM settings WHERE key = 'publish_count'").run();
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}

const remainingUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
db.close();

const backupsDir = path.join(dataDir, 'backups');
if (fs.existsSync(backupsDir)) {
  for (const file of fs.readdirSync(backupsDir)) {
    if (file.endsWith('.sqlite')) {
      fs.rmSync(path.join(backupsDir, file), { force: true });
    }
  }
}

console.log(`已清空作文数据，保留 ${remainingUsers} 个家庭成员。`);
console.log(`数据库：${dbPath}`);
