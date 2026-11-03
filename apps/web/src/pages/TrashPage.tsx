import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { DocumentSummary } from '../lib/types';
import { documentTitle, formatRelative } from '../lib/format';
import { Modal } from '../components/Modal';

export function TrashPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const trash = useQuery({ queryKey: ['trash'], queryFn: api.listTrash });
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  const [purgeTarget, setPurgeTarget] = useState<DocumentSummary | null>(null);

  const canPurge = me.data?.user.role !== 'author';

  const restore = useMutation({
    mutationFn: (id: string) => api.restoreDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const purge = useMutation({
    mutationFn: (id: string) => api.purgeDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setPurgeTarget(null);
    },
  });

  return (
    <div className="page">
      <header className="page-header">
        <button className="icon-button" onClick={() => navigate('/')}>
          ←
        </button>
        <div>
          <h1>删除的作文</h1>
          <p className="page-subtitle">
            删除的作文会先放在这里，可以恢复。只有爸爸妈妈可以彻底删除。
          </p>
        </div>
      </header>

      {trash.isLoading && <div className="page-state">正在打开回收站…</div>}

      {trash.data?.documents.length === 0 && (
        <div className="panel empty-panel">
          <h2>回收站是空的</h2>
          <p>删除的作文会出现在这里。</p>
        </div>
      )}

      <div className="document-grid">
        {trash.data?.documents.map((document) => (
          <article className="document-card" key={document.id}>
            <div className="document-card-main">
              <div className="document-card-top">
                <span className="badge badge-muted">已删除</span>
                <span className="document-time">
                  {formatRelative(document.deletedAt ?? document.updatedAt)}
                </span>
              </div>
              <h2>{documentTitle(document.title)}</h2>
              <p className="document-excerpt">{document.excerpt || '（空白）'}</p>
              <div className="document-meta">
                <span>{document.charCount} 字</span>
                {document.publishNumber ? (
                  <>
                    <span>·</span>
                    <span>第 {document.publishNumber} 篇</span>
                  </>
                ) : null}
              </div>
            </div>
            <footer className="document-card-foot is-actions-only">
              <div className="document-card-actions">
                <button
                  className="btn btn-small btn-ghost"
                  onClick={() => restore.mutate(document.id)}
                  disabled={restore.isPending}
                >
                  恢复
                </button>
                {canPurge && (
                  <button
                    className="btn btn-small btn-danger"
                    onClick={() => setPurgeTarget(document)}
                  >
                    彻底删除
                  </button>
                )}
              </div>
            </footer>
          </article>
        ))}
      </div>

      {restore.isError && (
        <div className="inline-error">{(restore.error as Error).message}</div>
      )}
      {purge.isError && (
        <div className="inline-error">{(purge.error as Error).message}</div>
      )}

      <Modal
        open={Boolean(purgeTarget)}
        title={`彻底删除《${purgeTarget ? documentTitle(purgeTarget.title) : ''}》？`}
        confirmLabel="彻底删除"
        confirmTone="danger"
        busy={purge.isPending}
        onConfirm={() => purgeTarget && purge.mutate(purgeTarget.id)}
        onCancel={() => setPurgeTarget(null)}
      >
        <p>彻底删除后，这篇作文和它的所有版本、修订记录都会从数据库里消失，无法恢复。</p>
        <p>之前的数据库备份中可能仍有副本。</p>
      </Modal>
    </div>
  );
}
