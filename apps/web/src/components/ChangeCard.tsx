import type { ChangeView, ConflictPair } from '../lib/types';
import { changeTypeLabel } from '../lib/format';
import { Avatar } from './Avatar';

interface ChangeCardProps {
  change: ChangeView;
  conflicts: ConflictPair[];
  busy?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onResolveConflict: (keep: ChangeView, drop: ChangeView) => void;
}

export function ChangeCard({
  change,
  conflicts,
  busy = false,
  onAccept,
  onReject,
  onResolveConflict,
}: ChangeCardProps) {
  const related = conflicts
    .filter((pair) => pair.a.id === change.id || pair.b.id === change.id)
    .map((pair) => (pair.a.id === change.id ? pair.b : pair.a));

  const statusLabel =
    change.status === 'accepted'
      ? '已接受'
      : change.status === 'rejected'
        ? '已拒绝'
        : '待处理';

  return (
    <article className={`change-card change-${change.status}`}>
      <header className="change-card-head">
        <div className="change-author">
          <Avatar name={change.reviewerName} color={change.reviewerColor} size="sm" />
          <span>{change.reviewerName}</span>
          <span className="change-type">{changeTypeLabel[change.type]}</span>
        </div>
        <span className={`change-status change-status-${change.status}`}>{statusLabel}</span>
      </header>

      <div className="change-text">
        {change.oldText && (
          <div className="change-old">
            <span className="change-label">原文</span>
            <span>{change.oldText}</span>
          </div>
        )}
        {change.newText && (
          <div className="change-new">
            <span className="change-label">改为</span>
            <span>{change.newText}</span>
          </div>
        )}
        {!change.oldText && !change.newText && (
          <div className="change-empty">这条修改没有文本内容</div>
        )}
      </div>

      {related.length > 0 && (
        <div className="change-conflict">
          <strong>与 {related.map((item) => item.reviewerName).join('、')} 的修改重叠</strong>
          <div className="change-conflict-actions">
            {related.map((other) => (
              <button
                key={other.id}
                className="btn btn-small btn-ghost"
                disabled={busy}
                onClick={() => onResolveConflict(change, other)}
              >
                保留这条，拒绝{other.reviewerName}的
              </button>
            ))}
          </div>
        </div>
      )}

      <footer className="change-actions">
        {change.status !== 'accepted' && (
          <button className="btn btn-small btn-accept" disabled={busy} onClick={onAccept}>
            接受
          </button>
        )}
        {change.status !== 'rejected' && (
          <button className="btn btn-small btn-reject" disabled={busy} onClick={onReject}>
            拒绝
          </button>
        )}
      </footer>
    </article>
  );
}
