import { randomBytes } from 'node:crypto';

/**
 * UUID v7: time-ordered, which keeps SQLite indexes and version lists tidy.
 */
export function newId(): string {
  const ts = Date.now().toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  const randA = rand.slice(0, 3);
  const variant = ((Number.parseInt(rand.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  const randB = rand.slice(4, 19);

  return [
    ts.slice(0, 8),
    ts.slice(8, 12),
    `7${randA}`,
    `${variant}${rand.slice(4, 7)}`,
    randB,
  ].join('-');
}
