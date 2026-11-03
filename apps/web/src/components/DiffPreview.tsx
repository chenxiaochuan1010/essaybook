import type { CSSProperties, ReactNode } from 'react';
import type { ChangeView } from '../lib/types';

interface DiffPreviewProps {
  base: string;
  changes: ChangeView[];
  reviewerId?: string;
  showRejected?: boolean;
}

interface Segment {
  key: string;
  node: ReactNode;
}

/**
 * Render the base text with inline revision marks. Overlapping changes cannot
 * be rendered inline reliably, so the first non-overlapping change wins and
 * the rest are represented by a small conflict marker. The change cards remain
 * the source of truth for deciding conflicts.
 */
export function DiffPreview({
  base,
  changes,
  reviewerId,
  showRejected = false,
}: DiffPreviewProps) {
  const visible = changes
    .filter((change) => change.status !== 'rejected' || showRejected)
    .filter((change) => !reviewerId || change.reviewerId === reviewerId)
    .sort((a, b) => a.baseStart - b.baseStart || a.baseEnd - b.baseEnd || a.seq - b.seq);

  const segments: Segment[] = [];
  let cursor = 0;
  let overlapCount = 0;

  for (const change of visible) {
    if (change.baseStart < cursor) {
      overlapCount += 1;
      continue;
    }

    if (change.baseStart > cursor) {
      segments.push({
        key: `text-${cursor}-${change.baseStart}`,
        node: base.slice(cursor, change.baseStart),
      });
    }

    const style = { '--reviewer-color': change.reviewerColor } as CSSProperties;
    const stateClass = change.status === 'accepted' ? 'is-accepted' : 'is-pending';

    if (change.type === 'insert') {
      segments.push({
        key: change.id,
        node: (
          <ins className={`diff-ins ${stateClass}`} style={style} title={change.reviewerName}>
            {change.newText}
          </ins>
        ),
      });
    } else if (change.type === 'delete') {
      segments.push({
        key: change.id,
        node: (
          <del className={`diff-del ${stateClass}`} style={style} title={change.reviewerName}>
            {change.oldText}
          </del>
        ),
      });
    } else {
      segments.push({
        key: change.id,
        node: (
          <span className="diff-replace" style={style} title={change.reviewerName}>
            <del className={`diff-del ${stateClass}`}>{change.oldText}</del>
            <ins className={`diff-ins ${stateClass}`}>{change.newText}</ins>
          </span>
        ),
      });
    }

    cursor = Math.max(cursor, change.baseEnd);
  }

  if (cursor < base.length) {
    segments.push({ key: `tail-${cursor}`, node: base.slice(cursor) });
  }

  return (
    <div className="diff-preview">
      {segments.map((segment) => (
        <span key={segment.key}>{segment.node}</span>
      ))}
      {overlapCount > 0 && (
        <div className="diff-overlap-note">
          有 {overlapCount} 处修改互相重叠，请在修订列表中选择保留哪一条。
        </div>
      )}
    </div>
  );
}
