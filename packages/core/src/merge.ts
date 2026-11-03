import type { ConflictPair, IdentifiedChange, TextChange } from './types';

export class MergeConflictError extends Error {
  readonly changeIds: string[];

  constructor(changeIds: string[]) {
    super('修订内容存在冲突，请先处理冲突');
    this.name = 'MergeConflictError';
    this.changeIds = changeIds;
  }
}

export function isSameChange(a: TextChange, b: TextChange): boolean {
  return (
    a.type === b.type &&
    a.baseStart === b.baseStart &&
    a.baseEnd === b.baseEnd &&
    a.oldText === b.oldText &&
    a.newText === b.newText
  );
}

/**
 * Two changes conflict when their base ranges overlap. Insertions are
 * zero-width; an insertion exactly at the boundary of another change is
 * allowed. Two insertions at the same position are also allowed and will be
 * concatenated in submission order.
 */
export function changesConflict(a: TextChange, b: TextChange): boolean {
  if (isSameChange(a, b)) return false;

  const aInsert = a.baseStart === a.baseEnd;
  const bInsert = b.baseStart === b.baseEnd;

  if (aInsert && bInsert) return false;
  if (aInsert) return a.baseStart > b.baseStart && a.baseStart < b.baseEnd;
  if (bInsert) return b.baseStart > a.baseStart && b.baseStart < a.baseEnd;

  return a.baseStart < b.baseEnd && b.baseStart < a.baseEnd;
}

export function findConflicts(changes: IdentifiedChange[]): ConflictPair[] {
  const conflicts: ConflictPair[] = [];
  for (let i = 0; i < changes.length; i += 1) {
    for (let j = i + 1; j < changes.length; j += 1) {
      const a = changes[i]!;
      const b = changes[j]!;
      if (changesConflict(a, b)) conflicts.push({ a, b });
    }
  }
  return conflicts;
}

/**
 * Apply accepted changes to the immutable base text.
 *
 * Identical changes from two reviewers are applied once. Insertions at the
 * same offset are concatenated in sequence order.
 */
export function applyAcceptedChanges(
  base: string,
  changes: IdentifiedChange[],
): string {
  const accepted = changes
    .filter((change) => change.status === 'accepted')
    .sort(
      (a, b) =>
        a.baseStart - b.baseStart ||
        a.baseEnd - b.baseEnd ||
        a.seq - b.seq ||
        a.id.localeCompare(b.id),
    );

  const deduped: IdentifiedChange[] = [];
  for (const change of accepted) {
    const duplicate = deduped.some((existing) => isSameChange(existing, change));
    if (!duplicate) deduped.push(change);
  }

  let cursor = 0;
  let out = '';
  const conflictIds: string[] = [];

  for (const change of deduped) {
    if (change.baseStart < cursor) {
      conflictIds.push(change.id);
      continue;
    }
    out += base.slice(cursor, change.baseStart);
    out += change.newText;
    cursor = change.baseEnd;
  }

  if (conflictIds.length > 0) {
    throw new MergeConflictError(conflictIds);
  }

  out += base.slice(cursor);
  return out;
}

/**
 * Validate that the accepted set can be merged. Returns conflict pairs.
 */
export function acceptedConflicts(changes: IdentifiedChange[]): ConflictPair[] {
  const accepted = changes.filter((change) => change.status === 'accepted');
  return findConflicts(accepted);
}
