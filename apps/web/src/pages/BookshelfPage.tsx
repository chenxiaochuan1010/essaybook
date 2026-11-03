import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { DocumentSummary } from '../lib/types';
import { documentTitle, formatMoney, formatRelative } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';
import { EmptySheet } from '../components/EmptySheet';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

export function BookshelfPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const documents = useQuery({ queryKey: ['documents'], queryFn: api.listDocuments });
  const fees = useQuery({ queryKey: ['fees'], queryFn: api.fees });

  const [deleteTarget, setDeleteTarget] = useState<DocumentSummary | null>(null);
  const [showSettle, setShowSettle] = useState(false);
  const [showConfirmSettle, setShowConfirmSettle] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const overview = fees.data?.overview;
  const pending = overview?.pendingSettlement ?? null;
  const hasFeeActivity = Boolean(
    pending ||
      (overview &&
        (overview.todayFeeCents > 0 ||
          overview.unsettledFeeCents > 0 ||
          overview.settledFeeCents > 0)),
  );

  function invalidateFees() {
    queryClient.invalidateQueries({ queryKey: ['fees'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }

  const requestSettlement = useMutation({
    mutationFn: api.requestSettlement,
    onSuccess: (data) => {
      invalidateFees();
      setShowSettle(false);
      setFlash(
        `已申请结算 ${formatMoney(data.amountCents)}，等待爸爸妈妈确认。`,
      );
    },
  });

  const confirmSettlement = useMutation({
    mutationFn: (id: string) => api.confirmSettlement(id),
    onSuccess: (data) => {
      invalidateFees();
      setShowConfirmSettle(false);
      setFlash(`已结算 ${formatMoney(data.settlement.amountCents)}。`);
    },
  });

  const create = useMutation({
    mutationFn: () => api.createDocument(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      navigate(`/doc/${data.document.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setDeleteTarget(null);
      setFlash('已放进回收站，之后可以在「设置 → 回收站」里找回。');
    },
  });

  const role = me.data?.user.role ?? 'author';
  const isAuthor = role === 'author';
  const list = documents.data?.documents ?? [];
  const finishedCount = list.filter((item) => item.status === 'final').length;
  const userName = me.data?.user.name ?? '小小作家';
  const pendingDocs = list.filter(
    (item) => item.status === 'in_review' && item.pendingSubmissions > 0,
  );
  const pendingRevisions = pendingDocs.reduce(
    (sum, item) => sum + item.pendingSubmissions,
    0,
  );
  const hasTodo = isAuthor && pendingDocs.length > 0;

  return (
    <div className="page bookshelf-page">
      <section className="shelf-hero">
        <div>
          <h1>{isAuthor ? '我的作文' : '家里的作文'}</h1>
          <p className="shelf-subtitle">
            {greeting()}，{userName}。
            {list.length > 0
              ? ` 书架上有 ${list.length} 篇作文${
                  finishedCount > 0 ? `，其中 ${finishedCount} 篇已经完成` : ''
                }。`
              : ' 还没有作文，写下第一篇吧。'}
          </p>
        </div>
        {list.length > 0 && isAuthor && (
          <button
            className={hasTodo ? 'btn btn-ghost btn-new' : 'btn btn-primary btn-new'}
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            {create.isPending ? '正在新建…' : '＋ 新建作文'}
          </button>
        )}
      </section>

      {hasTodo && (
        <section className="shelf-todo">
          <div>
            <strong>有 {pendingRevisions} 份修订等你处理</strong>
            <p>
              《{documentTitle(pendingDocs[0]!.title)}》等作文已经收到爸爸妈妈的修改。
            </p>
          </div>
          <button
            className="btn btn-primary btn-small"
            onClick={() => navigate(`/doc/${pendingDocs[0]!.id}/resolve`)}
          >
            去处理修订
          </button>
        </section>
      )}

      {!isAuthor && pending && (
        <div className="settlement-banner shelf-settlement">
          <div>
            <strong>
              {pending.requestedByName}申请结算稿费 {formatMoney(pending.amountCents)}
            </strong>
            <p>确认后计入累计稿费，并记录由谁结算。</p>
          </div>
          <div className="settlement-actions">
            <button
              className="btn btn-primary btn-small"
              onClick={() => setShowConfirmSettle(true)}
            >
              确认结算
            </button>
            <button className="btn btn-ghost btn-small" onClick={() => navigate('/fees')}>
              查看明细
            </button>
          </div>
        </div>
      )}

      {overview && hasFeeActivity && (
        <section className="shelf-fee-bar">
          <div className="fee-summary-inline">
            <div>
              <span>今日稿费</span>
              <strong>{formatMoney(overview.todayFeeCents)}</strong>
            </div>
            <div className={`is-lead ${overview.unsettledFeeCents === 0 ? 'is-zero' : ''}`}>
              <span>未结算</span>
              <strong>{formatMoney(overview.unsettledFeeCents)}</strong>
            </div>
            <div>
              <span>累计已结算</span>
              <strong>{formatMoney(overview.settledFeeCents)}</strong>
            </div>
          </div>
          <div className="fee-bar-actions">
            {isAuthor && pending && (
              <span className="fee-pending-note">
                已申请 {formatMoney(pending.amountCents)}，等待爸妈确认
              </span>
            )}
            <button className="btn btn-ghost btn-small" onClick={() => navigate('/fees')}>
              稿费明细
            </button>
            {isAuthor && !pending && overview.unsettledFeeCents > 0 && (
              <button
                className="btn btn-ghost btn-small"
                onClick={() => setShowSettle(true)}
              >
                申请稿费结算
              </button>
            )}
          </div>
        </section>
      )}

      {flash && (
        <div className="flash-banner" role="status">
          <span className="flash-mark" aria-hidden="true" />
          <span>{flash}</span>
          <button className="flash-close" onClick={() => setFlash(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}

      {documents.isLoading && <div className="shelf-loading">正在打开书架…</div>}

      {documents.isError && (
        <div className="panel error-panel">
          <strong>书架打不开了</strong>
          <p>{(documents.error as Error).message}</p>
          <button className="btn btn-ghost" onClick={() => documents.refetch()}>
            重试
          </button>
        </div>
      )}

      {!documents.isLoading && !documents.isError && list.length === 0 && (
        <div className="empty-state">
          <EmptySheet />
          <h2>{isAuthor ? '写下第一篇作文吧' : '还没有作文'}</h2>
          <p>
            {isAuthor
              ? '写完后可以交给爸爸妈妈修订，再由你决定接受哪些修改。'
              : '小朋友写完并提交审阅后，就可以在这里帮忙修订了。'}
          </p>
          {isAuthor && (
            <button
              className="btn btn-primary"
              onClick={() => create.mutate()}
              disabled={create.isPending}
            >
              ＋ 新建作文
            </button>
          )}
        </div>
      )}

      <div className={`document-grid ${list.length === 1 ? 'is-single' : ''}`}>
        {list.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            role={role}
            onOpen={() =>
              navigate(
                document.status === 'final'
                  ? `/doc/${document.id}/finish`
                  : `/doc/${document.id}`,
              )
            }
            onResolve={() => navigate(`/doc/${document.id}/resolve`)}
            onReview={() => navigate(`/doc/${document.id}/review`)}
            onDelete={() => setDeleteTarget(document)}
          />
        ))}
      </div>

      <Modal
        open={Boolean(deleteTarget)}
        title={`删除《${deleteTarget ? documentTitle(deleteTarget.title) : ''}》？`}
        confirmLabel="删除"
        confirmTone="danger"
        busy={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      >
        <p>删除后会放进回收站，之后还可以恢复。</p>
        <p>回收站里的作文，只有爸爸妈妈可以彻底删除。</p>
      </Modal>

      <Modal
        open={showSettle}
        title="申请稿费结算？"
        confirmLabel="申请结算"
        busy={requestSettlement.isPending}
        onConfirm={() => requestSettlement.mutate()}
        onCancel={() => setShowSettle(false)}
      >
        <p>
          将申请结算{' '}
          <strong>{formatMoney(overview?.unsettledFeeCents ?? 0)}</strong>。
        </p>
        <p>爸爸妈妈确认后，未结算稿费会清零，并记入稿费历史。</p>
      </Modal>

      <Modal
        open={showConfirmSettle}
        title="确认结算？"
        confirmLabel="确认结算"
        busy={confirmSettlement.isPending}
        onConfirm={() => pending && confirmSettlement.mutate(pending.id)}
        onCancel={() => setShowConfirmSettle(false)}
      >
        <p>
          确认给 {pending?.requestedByName ?? '小朋友'} 结算{' '}
          <strong>{formatMoney(pending?.amountCents ?? 0)}</strong>。
        </p>
        <p>确认后，这笔稿费会记为已结算，并记录在你名下。</p>
      </Modal>

      {requestSettlement.isError && (
        <div className="inline-error">
          {(requestSettlement.error as Error).message}
        </div>
      )}
      {confirmSettlement.isError && (
        <div className="inline-error">
          {(confirmSettlement.error as Error).message}
        </div>
      )}
    </div>
  );
}

function DocumentCard({
  document,
  role,
  onOpen,
  onResolve,
  onReview,
  onDelete,
}: {
  document: DocumentSummary;
  role: 'author' | 'reviewer' | 'admin';
  onOpen: () => void;
  onResolve: () => void;
  onReview: () => void;
  onDelete: () => void;
}) {
  const pending = document.status === 'in_review' && document.pendingSubmissions > 0;
  const canReview = document.status === 'in_review' && role !== 'author';
  const canDelete = document.status !== 'in_review';

  return (
    <article className="document-card">
      <button className="document-card-main" onClick={onOpen}>
        <div className="document-card-top">
          <StatusBadge document={document} />
          <span className="document-time">{formatRelative(document.updatedAt)}</span>
        </div>
        <h2>{documentTitle(document.title)}</h2>
        <p className="document-excerpt">
          {document.excerpt.trim() || '还没有开始写……'}
        </p>
        <div className="document-meta">
          <span>{document.charCount} 字</span>
          <span>·</span>
          <span>{document.versionCount} 个版本</span>
          {document.status === 'final' && document.publishNumber ? (
            <>
              <span>·</span>
              <span>第 {document.publishNumber} 篇</span>
            </>
          ) : null}
        </div>
      </button>

      <footer className="document-card-foot">
        <div className="document-owner">
          <Avatar name={document.ownerName} color={document.ownerColor} size="sm" />
          <span>{document.ownerName}</span>
        </div>
        <div className="document-card-actions">
          {canDelete && (
            <button className="card-delete" onClick={onDelete} aria-label="删除作文">
              删除
            </button>
          )}
          {canReview && (
            <button className="btn btn-small btn-ghost" onClick={onReview}>
              去修订
            </button>
          )}
          {pending && !canReview && (
            <button className="btn btn-small btn-ghost" onClick={onResolve}>
              去处理 {document.pendingSubmissions} 份修订
            </button>
          )}
          {document.status === 'final' && (
            <button className="btn btn-small btn-ghost" onClick={onOpen}>
              查看成品
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
