import type { DocumentSummary } from '../lib/types';
import { statusMeta } from '../lib/format';

interface StatusBadgeProps {
  document: Pick<DocumentSummary, 'status' | 'pendingSubmissions'>;
}

export function StatusBadge({ document }: StatusBadgeProps) {
  if (document.status === 'in_review' && document.pendingSubmissions > 0) {
    return <span className="badge badge-amber">待处理</span>;
  }

  const meta = statusMeta[document.status];
  return <span className={`badge badge-${meta.tone}`}>{meta.label}</span>;
}
