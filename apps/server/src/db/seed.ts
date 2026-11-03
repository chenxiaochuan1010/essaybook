import type { DatabaseSync } from 'node:sqlite';

export const DEFAULT_USERS = [
  {
    id: 'u_child',
    name: '小朋友',
    role: 'author',
    color: '#D97757',
  },
  {
    id: 'u_dad',
    name: '爸爸',
    role: 'reviewer',
    color: '#3D7EA6',
  },
  {
    id: 'u_mom',
    name: '妈妈',
    role: 'reviewer',
    color: '#8E6BBF',
  },
] as const;

export function seedDefaultUsers(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO users
      (id, name, role, color, pin_hash, onboarded_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?)
  `);

  for (const user of DEFAULT_USERS) {
    // 作者（小朋友）第一次进入时需要填写自己的名字；爸妈不需要。
    const onboardedAt = user.role === 'author' ? null : now;
    insert.run(user.id, user.name, user.role, user.color, onboardedAt, now, now);
  }
}
