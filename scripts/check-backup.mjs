#!/usr/bin/env node
/**
 * 校验一个作文本数据库备份文件。
 *
 * 用法：node scripts/check-backup.mjs data/backups/essaybook-xxxx-auto.sqlite
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = process.argv[2];

if (!file) {
  console.error('用法：node scripts/check-backup.mjs <备份文件.sqlite>');
  process.exit(1);
}

const filePath = path.resolve(file);
if (!fs.existsSync(filePath)) {
  console.error(`找不到文件：${filePath}`);
  process.exit(1);
}

const stat = fs.statSync(filePath);
console.log(`文件：${filePath}`);
console.log(`大小：${(stat.size / 1024).toFixed(1)} KB`);
console.log(`时间：${stat.mtime.toISOString()}`);

const db = new DatabaseSync(filePath, { readOnly: true });

try {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  const ok = integrity?.integrity_check === 'ok';

  const count = (table) => {
    try {
      return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    } catch {
      return null;
    }
  };

  const documents = count('documents');
  const versions = count('versions');
  const submissions = count('review_submissions');
  const backups = count('backups');

  console.log(`完整性：${ok ? '通过 ✅' : `失败 ❌ (${integrity?.integrity_check})`}`);
  if (documents !== null) console.log(`作文：${documents} 篇`);
  if (versions !== null) console.log(`版本：${versions} 个`);
  if (submissions !== null) console.log(`修订提交：${submissions} 份`);
  if (backups !== null) console.log(`备份记录：${backups} 条`);

  if (documents !== null) {
    const latest = db
      .prepare(
        `SELECT title, updated_at FROM documents
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 3`,
      )
      .all();
    if (latest.length > 0) {
      console.log('最近的作文：');
      for (const row of latest) {
        console.log(`  - ${row.title || '无题'}（${row.updated_at}）`);
      }
    }
  }

  process.exit(ok ? 0 : 2);
} finally {
  db.close();
}
