import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { changesConflict } from '@essaybook/core';
import { api } from '../lib/api';
import type { ChangeView, ConflictPair, SubmissionView } from '../lib/types';
import { documentTitle } from '../lib/format';
import { Avatar } from '../components/Avatar';
import { DiffPreview } from '../components/DiffPreview';
import { ChangeCard } from '../components/ChangeCard';
import { Modal } from '../components/Modal';
import { EmptySheet } from '../components/EmptySheet';

type ReviewerFilter = 'all' | string;

export function ResolvePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const documentQuery = useQuery({
    queryKey: ['document', id],
    queryFn: () => api.getDocument(id!),
    enabled: Boolean(id),
  });
  const document = documentQuery.data?.document;
  const roundId = document?.activeRoundId;

  const roundQuery = useQuery({
    queryKey: ['round', roundId],
    queryFn: () => api.getRound(roundId!),
    enabled: Boolean(roundId),
    refetchInterval: 5000,
  });
  const round = roundQuery.data?.round;

  const [filter, setFilter] = useState<ReviewerFilter>('all');
  const [busyChange, setBusyChange] = useState<string | null>(null);
  const [showAcceptAll, setShowAcceptAll] = useState(false);
  const [showRejectAll, setShowRejectAll] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [actionError, setActionError] = useState('');

  const submissions = useMemo(
    () => (round?.submissions ?? []).filter((submission) => submission.status === 'submitted'),
    [round],
  );

  const allChanges = useMemo(
    () => submissions.flatMap((submission) => submission.changes),
    [submissions],
  );

  const conflicts = useMemo<ConflictPair[]>(() => {
    const accepted = allChanges.filter((change) => change.status === 'accepted');
    const pairs: ConflictPair[] = [];
    for (let i = 0; i < accepted.length; i += 1) {
      for (let j = i + 1; j < accepted.length; j += 1) {
        const a = accepted[i]!;
        const b = accepted[j]!;
        if (changesConflict(a, b)) pairs.push({ a, b });
      }
    }
    return pairs;
  }, [allChanges]);

  const visibleSubmissions = useMemo(
    () =>
      filter === 'all'
        ? submissions
        : submissions.filter((submission) => submission.reviewerId === filter),
    [submissions, filter],
  );

  const visibleChanges = useMemo(
    () => visibleSubmissions.flatMap((submission) => submission.changes),
    [visibleSubmissions],
  );

  const acceptedCount = allChanges.filter((change) => change.status === 'accepted').length;
  const pendingCount = allChanges.filter((change) => change.status === 'pending').length;
  const rejectedCount = allChanges.filter((change) => change.status === 'rejected').length;

  function invalidateRound() {
    if (roundId) {
      queryClient.invalidateQueries({ queryKey: ['round', roundId] });
      queryClient.invalidateQueries({ queryKey: ['document', id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    }
  }

  async function setStatus(change: ChangeView, status: 'accepted' | 'rejected') {
    setBusyChange(change.id);
    setActionError('');
    try {
      await api.setChangeStatus(change.id, status);
      invalidateRound();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusyChange(null);
    }
  }

  async function resolveConflict(keep: ChangeView, drop: ChangeView) {
    setBusyChange(keep.id);
    setActionError('');
    try {
      await api.setChangeStatus(keep.id, 'accepted');
      await api.setChangeStatus(drop.id, 'rejected');
      invalidateRound();
    } catch (error) {
      setActionError((error as Error).message);
    } finally {
      setBusyChange(null);
    }
  }

  const bulk = useMutation({
    mutationFn: ({ status, reviewerId }: { status: 'accepted' | 'rejected'; reviewerId?: string }) =>
      api.bulkSetChangeStatus(round!.id, status, reviewerId),
    onSuccess: () => {
      invalidateRound();
      setShowAcceptAll(false);
      setShowRejectAll(false);
    },
    onError: (error) => setActionError((error as Error).message),
  });

  const finish = useMutation({
    mutationFn: async () => {
      // 先把接受的修订合并进正文，再把当前全文冻结成成品。
      const merged = await api.mergeRound(round!.id);
      try {
        const published = await api.publishDocument(id!);
        return { merged, published, publishError: null as string | null };
      } catch (error) {
        return { merged, published: null, publishError: (error as Error).message };
      }
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['document', id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['versions', id] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      setShowMerge(false);

      if (result.published) {
        navigate(`/doc/${id}/finish`, { state: { celebrate: true } });
        return;
      }

      navigate(`/doc/${id}`, {
        state: {
          message: `修订已保存，但生成成品失败：${result.publishError ?? '未知原因'}`,
        },
      });
    },
    onError: (error) => setActionError((error as Error).message),
  });

  if (documentQuery.isLoading || roundQuery.isLoading) {
    return <div className="page-state">正在整理修订…</div>;
  }

  if (documentQuery.isError || !document) {
    return (
      <div className="page">
        <div className="panel error-panel">
          <strong>找不到这篇作文</strong>
          <p>{(documentQuery.error as Error)?.message ?? '它可能已经被删除了。'}</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>
            回到书架
          </button>
        </div>
      </div>
    );
  }

  if (!roundId || !round) {
    return (
      <div className="page">
        <div className="panel empty-panel">
          <h2>没有待处理的修订</h2>
          <p>这篇作文现在不需要处理修订。</p>
          <button className="btn btn-primary" onClick={() => navigate(`/doc/${document.id}`)}>
            回到作文
          </button>
        </div>
      </div>
    );
  }

  if (round.status !== 'open') {
    return (
      <div className="page">
        <div className="panel empty-panel">
          <h2>这次审阅已经结束</h2>
          <p>修订结果已经合并，或者审阅被撤回了。</p>
          <button className="btn btn-primary" onClick={() => navigate(`/doc/${document.id}`)}>
            回到作文
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="resolve-page">
      <header className="resolve-header">
        <button
          className="icon-button"
          onClick={() => navigate(`/doc/${document.id}`)}
          aria-label="回到作文"
        >
          ←
        </button>
        <div className="resolve-heading">
          <h1>修订处理</h1>
          <p className="resolve-subline">
            {documentTitle(document.title)} ·{' '}
            {submissions.length === 0
              ? '还没有收到修订'
              : `收到 ${submissions.length} 份修订，共 ${allChanges.length} 处修改`}
          </p>
        </div>
        <div className="resolve-header-actions">
          <button
            className="btn btn-ghost btn-small"
            onClick={() => setShowRejectAll(true)}
            disabled={allChanges.length === 0 || bulk.isPending}
          >
            全部拒绝
          </button>
          <button
            className="btn btn-ghost btn-small"
            onClick={() => setShowAcceptAll(true)}
            disabled={allChanges.length === 0 || bulk.isPending}
          >
            全部接受
          </button>
        </div>
      </header>

      {conflicts.length > 0 && (
        <div className="conflict-banner">
          <strong>有 {conflicts.length} 处修改互相冲突</strong>
          <p>爸爸妈妈改了同一处。请在下面的修订卡片中选择保留哪一条，然后才能完成保存。</p>
        </div>
      )}

      {actionError && <div className="inline-error">{actionError}</div>}

      {submissions.length === 0 ? (
        <div className="panel empty-panel resolve-empty">
          <EmptySheet />
          <h2>等待爸爸妈妈提交修订</h2>
          <p>他们提交后，这里会自动出现红绿修订标记。你可以先回去继续看看别的作文。</p>
          <div className="empty-actions">
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/doc/${document.id}`)}
            >
              回到作文
            </button>
            <button className="btn btn-ghost" onClick={() => roundQuery.refetch()}>
              刷新
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="resolve-toolbar">
            <div className="reviewer-filters">
              <button
                className={`filter-chip ${filter === 'all' ? 'is-active' : ''}`}
                onClick={() => setFilter('all')}
              >
                全部
                <span>{allChanges.length}</span>
              </button>
              {submissions.map((submission) => (
                <button
                  key={submission.id}
                  className={`filter-chip ${filter === submission.reviewerId ? 'is-active' : ''}`}
                  onClick={() => setFilter(submission.reviewerId)}
                >
                  <span
                    className="filter-dot"
                    style={{ backgroundColor: submission.reviewerColor }}
                  />
                  {submission.reviewerName}
                  <span>{submission.changes.length}</span>
                </button>
              ))}
            </div>
            <div className="resolve-summary">
              <span className="summary-accepted">接受 {acceptedCount}</span>
              <span className="summary-pending">待处理 {pendingCount}</span>
              <span className="summary-rejected">拒绝 {rejectedCount}</span>
            </div>
          </div>

          <div className="resolve-layout">
            <section className="resolve-preview-panel">
              <header className="panel-heading">
                <h2>正文预览</h2>
                <span>红绿标记会随你的决定变化</span>
              </header>
              <DiffPreview
                base={round.baseContent}
                changes={visibleChanges}
                reviewerId={filter === 'all' ? undefined : filter}
              />
            </section>

            <section className="resolve-list">
              {visibleSubmissions.map((submission) => (
                <SubmissionSection
                  key={submission.id}
                  submission={submission}
                  conflicts={conflicts}
                  busyChange={busyChange}
                  onAccept={(change) => void setStatus(change, 'accepted')}
                  onReject={(change) => void setStatus(change, 'rejected')}
                  onResolveConflict={(keep, drop) => void resolveConflict(keep, drop)}
                  onBulk={(status) => bulk.mutate({ status, reviewerId: submission.reviewerId })}
                  bulkBusy={bulk.isPending}
                />
              ))}
            </section>
          </div>

          <footer className="resolve-footer">
            <div className="resolve-footer-meta">
              {conflicts.length > 0
                ? `还有 ${conflicts.length} 处冲突需要选择`
                : pendingCount > 0
                  ? `还有 ${pendingCount} 处没有决定，生成成品时会按拒绝处理`
                  : '所有修改都已处理'}
            </div>
            <button
              className="btn btn-primary"
              onClick={() => setShowMerge(true)}
              disabled={conflicts.length > 0 || finish.isPending}
            >
              完成并生成成品
            </button>
          </footer>
        </>
      )}

      <Modal
        open={showAcceptAll}
        title="接受全部修订？"
        confirmLabel="全部接受"
        busy={bulk.isPending}
        onConfirm={() => bulk.mutate({ status: 'accepted' })}
        onCancel={() => setShowAcceptAll(false)}
      >
        <p>所有待处理的修改都会标记为接受。如果爸爸妈妈改了同一处，仍需要你选择保留哪一条。</p>
      </Modal>

      <Modal
        open={showRejectAll}
        title="拒绝全部修订？"
        confirmLabel="全部拒绝"
        confirmTone="danger"
        busy={bulk.isPending}
        onConfirm={() => bulk.mutate({ status: 'rejected' })}
        onCancel={() => setShowRejectAll(false)}
      >
        <p>所有待处理的修改都会标记为拒绝，正文保持原样。这个操作可以在完成保存前改回来。</p>
      </Modal>

      <Modal
        open={showMerge}
        title="完成并生成成品？"
        confirmLabel="生成成品"
        busy={finish.isPending}
        onConfirm={() => finish.mutate()}
        onCancel={() => setShowMerge(false)}
      >
        <p>
          将接受 <strong>{acceptedCount}</strong> 处修改，拒绝{' '}
          <strong>{rejectedCount + pendingCount}</strong> 处。
        </p>
        <p>
          合并后会生成一张成品页，正文会锁定。之后想再改，可以在成品页点「继续修改」。
        </p>
      </Modal>
    </div>
  );
}

function SubmissionSection({
  submission,
  conflicts,
  busyChange,
  onAccept,
  onReject,
  onResolveConflict,
  onBulk,
  bulkBusy,
}: {
  submission: SubmissionView;
  conflicts: ConflictPair[];
  busyChange: string | null;
  onAccept: (change: ChangeView) => void;
  onReject: (change: ChangeView) => void;
  onResolveConflict: (keep: ChangeView, drop: ChangeView) => void;
  onBulk: (status: 'accepted' | 'rejected') => void;
  bulkBusy: boolean;
}) {
  return (
    <div className="submission-section">
      <header className="submission-head">
        <div className="submission-author">
          <Avatar
            name={submission.reviewerName}
            color={submission.reviewerColor}
            size="md"
          />
          <div>
            <strong>{submission.reviewerName}的修订</strong>
            <span>{submission.changes.length} 处修改</span>
          </div>
        </div>
        <div className="submission-actions">
          <button
            className="btn btn-ghost btn-small"
            onClick={() => onBulk('accepted')}
            disabled={bulkBusy}
          >
            全部接受
          </button>
          <button
            className="btn btn-ghost btn-small"
            onClick={() => onBulk('rejected')}
            disabled={bulkBusy}
          >
            全部拒绝
          </button>
        </div>
      </header>

      <div className="change-list">
        {submission.changes.map((change) => (
          <ChangeCard
            key={change.id}
            change={change}
            conflicts={conflicts}
            busy={busyChange === change.id}
            onAccept={() => onAccept(change)}
            onReject={() => onReject(change)}
            onResolveConflict={onResolveConflict}
          />
        ))}
      </div>
    </div>
  );
}
