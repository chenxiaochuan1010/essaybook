import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { db, nowIso } from '../db/index.js';
import { newId } from './ids.js';

export const SESSION_COOKIE = 'essaybook_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  name: string;
  role: 'author' | 'reviewer' | 'admin';
  color: string;
  onboardedAt: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: string;
  name: string;
  role: SessionUser['role'];
  color: string;
  onboarded_at: string | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    newId(),
    userId,
    hashToken(token),
    now.toISOString(),
    expires.toISOString(),
    now.toISOString(),
  );

  return token;
}

export function findSession(token: string): SessionUser | null {
  const row = db.prepare(`
    SELECT s.id, s.user_id, s.expires_at,
           u.name, u.role, u.color, u.onboarded_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(hashToken(token)) as SessionRow | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    return null;
  }

  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.id);

  return {
    id: row.user_id,
    name: row.name,
    role: row.role,
    color: row.color,
    onboardedAt: row.onboarded_at,
  };
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false');

  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
