import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { FeeRecord, FeeStatus } from '../lib/types';
import { formatDateTime, formatMoney } from '../lib/format';
import { Modal } from '../components/Modal';

const statusLabel: Record<FeeStatus, string> = {
  unsettled: '未结算',
  pending: '结算中',
  settled: '已结算',
};

export function FeesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const fees = useQuery({ queryKey: ['fees'], queryFn: api.fees });

  const [showRequest, setShowRequest] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [flash, setFlash] = useState('');

  const overview = fees.data?.overview;
  const pending = overview?.pendingSettlement ?? null;
  const isAuthor = me.data?.user.role === 'author';

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['fees'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }

  const request = useMutation({
    mutationFn: api.requestSettlement,
    onSuccess: (data) => {
      invalidate();
      setShowRequest(false);
      setFlash(`已申请结算 ${formatMoney(data.amountCents)}，等待爸爸妈妈确认。`);
    },
  });

  const confirm = useMutation({
    mutationFn: (id: string) => api.confirmSettlement(id),
    onSuccess: (data) => {
      invalidate();
      setShowConfirm(false);
      setFlash(`已结算 ${formatMoney(data.settlement.amountCents)}。`);
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelSettlement(id),
    onSuccess: () => {
      invalidate();
      setShowCancel(false);
      setFlash('已撤销这次结算申请。');
    },
  });

  return (
    <div className="page fees-page">
      <header className="page-header">
        <button className="icon-button" onClick={() => navigate('/')}>
          ←
        </button>
        <div>
          <h1>稿费明细</h1>
          <p className="page-subtitle">
            每完成一篇成品，按字数赚稿费；申请后由爸爸妈妈确认结算。
          </p>
        </div>
      </header>

      {fees.isLoading && <div className="page-state">正在翻稿费本…</div>}

      {fees.isError && (
        <div className="panel error-panel">
          <strong>稿费本打不开</strong>
          <p>{(fees.error as Error).message}</p>
          <button className="btn btn-ghost" onClick={() => fees.refetch()}>
            重试
          </button>
        </div>
      )}

      {overview && (
        <>
          <section className="fee-summary">
            <div className="fee-summary-item">
              <span>今日稿费</span>
              <strong>{formatMoney(overview.todayFeeCents)}</strong>
            </div>
            <div className={`fee-summary-item is-pending ${overview.unsettledFeeCents === 0 ? 'is-zero' : ''}`}>
              <span>未结算</span>
              <strong>{formatMoney(overview.unsettledFeeCents)}</strong>
            </div>
            <div className="fee-summary-item is-settled">
              <span>累计已结算</span>
              <strong>{formatMoney(overview.settledFeeCents)}</strong>
            </div>
          </section>

          {flash && (
            <div className="flash-banner" role="status">
              <span className="flash-mark" aria-hidden="true" />
              <span>{flash}</span>
              <button className="flash-close" onClick={() => setFlash('')} aria-label="关闭提示">
                ×
              </button>
            </div>
          )}

          {pending ? (
            <div className="settlement-banner">
              <div>
                <strong>
                  {isAuthor
                    ? `${pending.requestedByName}已申请结算 ${formatMoney(pending.amountCents)}`
                    : `${pending.requestedByName}申请结算稿费 ${formatMoney(pending.amountCents)}`}
                </strong>
                <p>
                  {isAuthor
                    ? '等待爸爸妈妈确认。确认后，未结算稿费会清零，并记入下面的历史。'
                    : '确认后，这笔稿费会记为已结算，并记录是谁结算的。'}
                </p>
              </div>
              <div className="settlement-actions">
                {isAuthor ? (
                  <button className="btn btn-ghost btn-small" onClick={() => setShowCancel(true)}>
                    撤销申请
                  </button>
                ) : (
                  <button className="btn btn-primary btn-small" onClick={() => setShowConfirm(true)}>
                    确认结算
                  </button>
                )}
              </div>
            </div>
          ) : (
            isAuthor &&
            overview.unsettledFeeCents > 0 && (
              <div className="settlement-banner settlement-banner-quiet">
                <div>
                  <strong>有 {formatMoney(overview.unsettledFeeCents)} 稿费可以结算</strong>
                  <p>申请后由爸爸妈妈确认，确认后计入累计稿费。</p>
                </div>
                <div className="settlement-actions">
                  <button className="btn btn-primary btn-small" onClick={() => setShowRequest(true)}>
                    申请结算
                  </button>
                </div>
              </div>
            )
          )}

          <section className="panel fee-history">
            <header className="panel-heading">
              <h2>稿费记录</h2>
              <span>每 1 个字 = 1 分钱</span>
            </header>

            {fees.data?.fees.length === 0 ? (
              <div className="empty-panel fee-empty">
                <h2>还没有稿费记录</h2>
                <p>完成第一篇成品后，稿费会出现在这里。</p>
              </div>
            ) : (
              <ul className="fee-list">
                {fees.data?.fees.map((record) => (
                  <FeeRow key={record.id} record={record} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Modal
        open={showRequest}
        title="申请结算稿费？"
        confirmLabel="申请结算"
        busy={request.isPending}
        onConfirm={() => request.mutate()}
        onCancel={() => setShowRequest(false)}
      >
        <p>
          将申请结算 <strong>{formatMoney(overview?.unsettledFeeCents ?? 0)}</strong>。
        </p>
        <p>爸爸妈妈确认后，未结算稿费会清零，并记入稿费历史。</p>
      </Modal>

      <Modal
        open={showConfirm}
        title="确认结算？"
        confirmLabel="确认结算"
        busy={confirm.isPending}
        onConfirm={() => pending && confirm.mutate(pending.id)}
        onCancel={() => setShowConfirm(false)}
      >
        <p>
          确认给 {pending?.requestedByName ?? '小朋友'} 结算{' '}
          <strong>{formatMoney(pending?.amountCents ?? 0)}</strong>。
        </p>
        <p>确认后，小朋友的未结算稿费会清零，这笔记录会记在你名下。</p>
      </Modal>

      <Modal
        open={showCancel}
        title="撤销结算申请？"
        confirmLabel="撤销"
        confirmTone="danger"
        busy={cancel.isPending}
        onConfirm={() => pending && cancel.mutate(pending.id)}
        onCancel={() => setShowCancel(false)}
      >
        <p>撤销后，这些稿费会回到未结算状态，可以之后再申请。</p>
      </Modal>

      {request.isError && (
        <div className="inline-error">{(request.error as Error).message}</div>
      )}
      {confirm.isError && (
        <div className="inline-error">{(confirm.error as Error).message}</div>
      )}
      {cancel.isError && (
        <div className="inline-error">{(cancel.error as Error).message}</div>
      )}
    </div>
  );
}

function FeeRow({ record }: { record: FeeRecord }) {
  return (
    <li className="fee-record">
      <div className="fee-record-main">
        <strong>{record.documentTitle.trim() || '无题'}</strong>
        {record.publishNumber ? (
          <span className="fee-record-number">第 {record.publishNumber} 篇</span>
        ) : null}
        <span className="fee-record-date">{formatDateTime(record.earnedAt)}</span>
      </div>
      <div className="fee-record-side">
        <strong className="fee-amount">{formatMoney(record.amountCents)}</strong>
        <span className={`fee-status fee-status-${record.status}`}>
          {statusLabel[record.status]}
        </span>
        {record.status === 'settled' && (
          <span className="fee-record-settled">
            {record.settledByName ?? '爸爸妈妈'} 结算
            {record.settledAt ? ` · ${formatDateTime(record.settledAt)}` : ''}
          </span>
        )}
        {record.status === 'pending' && (
          <span className="fee-record-settled">等待确认</span>
        )}
      </div>
    </li>
  );
}
