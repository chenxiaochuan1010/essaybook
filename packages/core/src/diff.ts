import DiffMatchPatch from 'diff-match-patch';
import type { TextChange } from './types';

const { DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } = DiffMatchPatch;

/**
 * Build a list of human-readable changes from `base` to `edited`.
 *
 * Offsets are JavaScript UTF-16 string indices, which are also what
 * diff-match-patch uses. The base text is immutable, so these offsets stay
 * valid for every reviewer working from the same base version.
 */
export function buildChanges(base: string, edited: string): TextChange[] {
  if (base === edited) return [];

  const dmp = new DiffMatchPatch();
  // Keep diffs responsive for long essays; 0 would mean "no timeout".
  dmp.Diff_Timeout = 2;
  const diffs = dmp.diff_main(base, edited);
  dmp.diff_cleanupSemantic(diffs);

  const raw: TextChange[] = [];
  let pos = 0;
  let pendingDelete: string | null = null;
  let pendingInsert: string | null = null;

  const flush = () => {
    if (pendingDelete === null && pendingInsert === null) return;
    if (pendingDelete !== null && pendingInsert !== null) {
      raw.push({
        type: 'replace',
        baseStart: pos - pendingDelete.length,
        baseEnd: pos,
        oldText: pendingDelete,
        newText: pendingInsert,
      });
    } else if (pendingDelete !== null) {
      raw.push({
        type: 'delete',
        baseStart: pos - pendingDelete.length,
        baseEnd: pos,
        oldText: pendingDelete,
        newText: '',
      });
    } else if (pendingInsert !== null) {
      raw.push({
        type: 'insert',
        baseStart: pos,
        baseEnd: pos,
        oldText: '',
        newText: pendingInsert,
      });
    }
    pendingDelete = null;
    pendingInsert = null;
  };

  for (const [op, text] of diffs) {
    if (op === DIFF_EQUAL) {
      flush();
      pos += text.length;
    } else if (op === DIFF_DELETE) {
      pendingDelete = (pendingDelete ?? '') + text;
      pos += text.length;
    } else if (op === DIFF_INSERT) {
      pendingInsert = (pendingInsert ?? '') + text;
    }
  }
  flush();

  return mergeNearbyChanges(base, raw, 4);
}

/**
 * Merge changes separated by a very short equal fragment. Chinese character
 * diffs often produce fragments like "我" -> "我们" split into several tiny
 * blocks; grouping them makes the review UI much easier for a child.
 */
export function mergeNearbyChanges(
  base: string,
  changes: TextChange[],
  maxGap = 4,
): TextChange[] {
  const sorted = [...changes].sort(
    (a, b) => a.baseStart - b.baseStart || a.baseEnd - b.baseEnd,
  );
  const merged: TextChange[] = [];

  for (const change of sorted) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...change });
      continue;
    }

    const gap = change.baseStart - last.baseEnd;
    if (gap < 0 || gap > maxGap) {
      merged.push({ ...change });
      continue;
    }

    const oldText = base.slice(last.baseStart, change.baseEnd);
    const newText =
      last.newText + base.slice(last.baseEnd, change.baseStart) + change.newText;
    const type: TextChange['type'] =
      oldText.length === 0 ? 'insert' : newText.length === 0 ? 'delete' : 'replace';

    last.baseEnd = change.baseEnd;
    last.oldText = oldText;
    last.newText = newText;
    last.type = type;
  }

  return merged;
}
