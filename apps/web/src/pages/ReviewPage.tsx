import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { buildChanges, countWords } from '@essaybook/core';
import { api } from '../lib/api';
import { documentTitle, formatRelative } from '../lib/format';
import { getIndentPreference } from '../lib/preferences';
import { Avatar } from '../components/Avatar';
import { Editor } from '../components/Editor';
import { Modal } from '../components/Modal';

export function ReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
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

  const ownSubmission = round?.submissions.find(
    (submission) =>
      submission.reviewerId === me.data?.user.id && submission.status === 'submitted',
  );

  const submissionQuery = useQuery({
    queryKey: ['submission', ownSubmission?.id],
    queryFn: () => api.getSubmission(ownSubmission!.id),
    enabled: Boolean(ownSubmission?.id),
  });

  const [content, setContent] = useState('');
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [showSubmit, setShowSubmit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  useEffect(() => {
    if (!round || initializedFor === round.id) return;
    if (ownSubmission && !submissionQuery.isFetched && !submissionQuery.isError) return;
    setContent(
      ownSubmission
        ? submissionQuery.data?.submission.editedContent ?? round.baseContent
        : round.baseContent,
    );
    setInitializedFor(round.id);
  }, [round, ownSubmission, submissionQuery.isFetched, submissionQuery.isError, submissionQuery.data, initializedFor]);

  const changes = useMemo(
    () => (round ? buildChanges(round.baseContent, content) : []),
    [round, content],
  );
  const wordCount = useMemo(() => countWords(content), [content]);

  const submit = useMutation({
    mutationFn: () => api.submitReview(round!.id, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round', round!.id] });
      queryClient.invalidateQueries({ queryKey: ['document', id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowSubmit(false);
    },
  });

  const withdraw = useMutation({
    mutationFn: () => api.withdrawSubmission(ownSubmission!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round', round!.id] });
      queryClient.invalidateQueries({ queryKey: ['document', id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowWithdraw(false);
    },
  });

  if (documentQuery.isLoading || roundQuery.isLoading) {
    return <div className="page-state">正在打开审阅副本…</div>;
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
          <h2>没有进行中的审阅</h2>
          <p>这篇作文现在是「{document.status === 'draft' ? '草稿' : '已定稿'}」状态。</p>
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

  const isAuthor = me.data?.user.role === 'author';
  const submitted = Boolean(ownSubmission);

  return (
    <div className="writing-page review-page">
      <header className="writing-header">
        <button
          className="icon-button"
          onClick={() => navigate(`/doc/${document.id}`)}
          aria-label="回到作文"
        >
          ←
        </button>
        <div className="writing-heading">
          <div className="review-title-row">
            <h1>{documentTitle(document.title)}</h1>
            <span className="badge badge-blue">审阅中</span>
          </div>
          <div className="writing-subline">
            {me.data?.user && (
              <span className="reviewer-identity">
                <Avatar
                  name={me.data.user.name}
                  color={me.data.user.color}
                  size="sm"
                />
                以 <strong>{me.data.user.name}</strong> 的身份审阅
              </span>
            )}
            <span>{wordCount.chars} 字</span>
            <span className="dot">·</span>
            <span>基准版本 {formatRelative(round.createdAt)}</span>
          </div>
        </div>
        <div className="writing-header-actions">
          <span className="review-change-count">
            {changes.length > 0 ? `已修改 ${changes.length} 处` : '还没有修改'}
          </span>
        </div>
      </header>

      {isAuthor && (
        <div className="inline-note">
          你正在以作者身份打开审阅副本。通常由爸爸妈妈来修订，你也可以自己检查一遍。
        </div>
      )}

      {submitted && (
        <div className="review-banner review-banner-submitted">
          <div>
            <strong>你已经提交了修订</strong>
            <p>
              共 {ownSubmission!.summary.total} 处修改。等孩子处理完后，结果会合并到正文。
            </p>
          </div>
          <div className="review-banner-actions">
            <button
              className="btn btn-ghost btn-small"
              onClick={() => setShowWithdraw(true)}
            >
              撤回并重新编辑
            </button>
          </div>
        </div>
      )}

      <div className="writing-editor-wrap">
        <Editor
          value={content}
          onChange={setContent}
          readOnly={submitted}
          indent={getIndentPreference()}
          placeholder="在这里修改孩子的作文……"
          ariaLabel="审阅副本正文"
        />
      </div>

      <footer className="writing-footer">
        <div className="writing-footer-meta">
          <span>{submitted ? '已提交，等待孩子处理' : '修改不会直接改掉原文'}</span>
        </div>
        <div className="writing-footer-actions">
          {!submitted && (
            <button
              className="btn btn-primary"
              onClick={() => setShowSubmit(true)}
              disabled={changes.length === 0 || submit.isPending}
            >
              提交修订
            </button>
          )}
        </div>
      </footer>

      {submit.isError && (
        <div className="inline-error">{(submit.error as Error).message}</div>
      )}
      {submissionQuery.isError && (
        <div className="inline-error">
          载入已提交的修订失败：{(submissionQuery.error as Error).message}
        </div>
      )}
      {withdraw.isError && (
        <div className="inline-error">{(withdraw.error as Error).message}</div>
      )}

      <Modal
        open={showSubmit}
        title="提交这份修订？"
        confirmLabel="提交"
        busy={submit.isPending}
        onConfirm={() => submit.mutate()}
        onCancel={() => setShowSubmit(false)}
      >
        <p>
          检测到 <strong>{changes.length}</strong> 处修改：
          新增 {changes.filter((c) => c.type === 'insert').length} 处，
          删除 {changes.filter((c) => c.type === 'delete').length} 处，
          修改 {changes.filter((c) => c.type === 'replace').length} 处。
        </p>
        <p>提交后由孩子逐条决定接受或拒绝，原文不会被直接覆盖。</p>
      </Modal>

      <Modal
        open={showWithdraw}
        title="撤回这份修订？"
        confirmLabel="撤回"
        confirmTone="danger"
        busy={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
        onCancel={() => setShowWithdraw(false)}
      >
        <p>撤回后可以继续编辑并重新提交。已经提交的修改不会再出现在孩子的处理列表里。</p>
      </Modal>
    </div>
  );
}
