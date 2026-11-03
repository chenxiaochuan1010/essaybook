import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, nowIso } from '../db/index.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  SESSION_COOKIE,
  setSessionCookie,
} from '../lib/auth.js';
import { notFound, unauthorized } from '../lib/errors.js';

interface UserRow {
  id: string;
  name: string;
  role: 'author' | 'reviewer' | 'admin';
  color: string;
  onboarded_at: string | null;
}

function mapUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    color: row.color,
    onboardedAt: row.onboarded_at,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/profiles', async () => {
    const rows = db.prepare(`
      SELECT id, name, role, color, onboarded_at FROM users
      ORDER BY CASE role WHEN 'author' THEN 0 WHEN 'reviewer' THEN 1 ELSE 2 END, created_at
    `).all() as unknown as UserRow[];

    return { profiles: rows.map(mapUser) };
  });

  app.post('/api/session', async (request, reply) => {
    const body = z.object({ userId: z.string().min(1) }).parse(request.body);

    const user = db.prepare(`
      SELECT id, name, role, color, onboarded_at FROM users WHERE id = ?
    `).get(body.userId) as UserRow | undefined;

    if (!user) throw notFound('找不到这个家庭成员');

    const token = createSession(user.id);
    setSessionCookie(reply, token);

    return { user: mapUser(user) };
  });

  app.get('/api/me', async (request) => {
    if (!request.user) throw unauthorized();
    return { user: request.user };
  });

  /**
   * 修改自己的显示名。第一次进入的小朋友通过这个接口完成「起名字」。
   */
  app.patch('/api/me', async (request) => {
    if (!request.user) throw unauthorized();

    const body = z
      .object({ name: z.string().trim().min(1).max(12) })
      .parse(request.body);

    const name = body.name.trim();
    const now = nowIso();

    db.prepare(`
      UPDATE users
      SET name = ?, onboarded_at = COALESCE(onboarded_at, ?), updated_at = ?
      WHERE id = ?
    `).run(name, now, now, request.user.id);

    const row = db.prepare(`
      SELECT id, name, role, color, onboarded_at FROM users WHERE id = ?
    `).get(request.user.id) as UserRow | undefined;

    if (!row) throw notFound('找不到这个家庭成员');

    return { user: mapUser(row) };
  });

  app.delete('/api/session', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) destroySession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });
}
