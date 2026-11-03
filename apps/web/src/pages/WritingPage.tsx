import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { countWords } from '@essaybook/core';
import { api } from '../lib/api';
import { documentTitle } from '../lib/format';
import { getIndentPreference } from '../lib/preferences';
import { Editor } from '../components/Editor';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function WritingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const documentQuery = useQuery({
    queryKey: ['document', id],
    queryFn: () => api.getDocument(id!),
    enabled: Boolean(id),
  });

  const document = documentQuery.data?.document;
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });

  // 只有作者能编辑草稿；爸妈/管理员打开草稿时是只读等待态。
  const role = me.data?.user.role;
  const isAuthor = role === 'author';
  const isReviewer = role === 'reviewer' || role === 'admin';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [showSubmit, setShowSubmit] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [flash, setFlash] = useState<string | null>(
    (location.state as { message?: string } | null)?.message ?? null,
  );
  const savedDocRef = useRef<{ title: string; content: string } | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!document) return;

    if (initializedFor !== document.id) {
      setTitle(document.title);
      setContent(document.content);
      setInitializedFor(document.id);
      setSaveState('saved');
      savedDocRef.current = { title: document.title, content: document.content };
      return;
    }

    // 同一篇作文收到外部更新（例如另一台设备合并了修订）时，
    // 只在本地没有未保存修改的情况下采用服务器内容，避免覆盖正在输入的文字。
    const saved = savedDocRef.current;
    if (!saved) return;
    const localClean = title === saved.title && content === saved.content;
    const serverChanged =
      document.title !== saved.title || document.content !== saved.content;

    if (localClean && serverChanged) {
      setTitle(document.title);
      setContent(document.content);
      savedDocRef.current = { title: document.title, content: document.content };
      setSaveState('saved');
    }
  }, [document, initializedFor, title, content]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 6000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!location.state) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const isReview = document?.status === 'in_review';
  const isFinal = document?.status === 'final';
  const locked = Boolean(isReview || isFinal || isReviewer);

  const dirty =
    Boolean(document) &&
    !locked &&
    initializedFor === document!.id &&
    (title !== document!.title || content !== document!.content);

  const wordCount = useMemo(() => countWords(content), [content]);
  const saveIndicator: SaveState =
    saveState === 'error' ? 'error' : dirty || saveState === 'saving' ? 'saving' : 'saved';

  async function saveNow(nextTitle = title, nextContent = content) {
    if (!document || locked) return;

    // 串行化保存请求，避免两次 PATCH 竞态导致旧内容覆盖新内容。
    const task = saveChainRef.current.then(async () => {
      setSaveState('saving');
      setSaveError('');
      try {
        const result = await api.updateDocument(document.id, {
          title: nextTitle,
          content: nextContent,
        });
        queryClient.setQueryData(['document', document.id], result);
        queryClient.invalidateQueries({ queryKey: ['documents'] });
        savedDocRef.current = { title: nextTitle, content: nextContent };
        setSaveState('saved');
      } catch (error) {
        setSaveState('error');
        setSaveError((error as Error).message);
        throw error;
      }
    });

    saveChainRef.current = task.catch(() => {
      // 失败状态已经显示在界面上，这里只保证队列继续。
    });

    return task;
  }

  useEffect(() => {
    if (!document || !dirty || locked) return;

    const timer = window.setTimeout(() => {
      void saveNow(title, content).catch(() => {
        // 保存失败的状态已经显示在界面上，这里只是避免未处理的 Promise。
      });
    }, 800);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, content, dirty, locked, document?.id]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // 离开页面或切到后台时尽量把还没落盘的内容保存掉（iPad 上 beforeunload 不可靠）。
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (dirty && !locked) {
      void saveNow(title, content).catch(() => {});
    }
  };

  useEffect(() => {
    const onVisibility = () => {
      if (window.document.visibilityState === 'hidden') flushRef.current();
    };
    window.document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.document.removeEventListener('visibilitychange', onVisibility);
      flushRef.current();
    };
  }, []);

  const submitReview = useMutation({
    mutationFn: async () => {
      // 先落盘再提交，避免刚打的字还没自动保存就被提交上去。
      await saveNow();
      return api.submitForReview(document!.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', document!.id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowSubmit(false);
    },
  });

  const cancelReview = useMutation({
    mutationFn: () => api.cancelRound(document!.activeRoundId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', document!.id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowCancel(false);
    },
  });

  // 已经完成过一次修订的作文，重新打开后允许小朋友直接再次生成成品。
  const publishSelf = useMutation({
    mutationFn: async () => {
      await saveNow();
      return api.publishDocument(document!.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', document!.id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['fees'] });
      setShowPublish(false);
      navigate(`/doc/${document!.id}/finish`, { state: { celebrate: true } });
    },
  });

  const reopen = useMutation({
    mutationFn: () => api.reopenDocument(document!.id),
    onSuccess: (data) => {
      setFlash('已解锁，可以继续修改了');
      queryClient.setQueryData(['document', document!.id], data);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  if (documentQuery.isLoading) {
    return <div className="page-state">正在打开作文…</div>;
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

  return (
    <div className="writing-page">
      <header className="writing-header">
        <button className="icon-button" onClick={() => navigate('/')} aria-label="回到书架">
          ←
        </button>
        <div className="writing-heading">
          <input
            className="title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="给作文起个题目"
            readOnly={locked}
            maxLength={200}
            aria-label="作文题目"
          />
          <div className="writing-subline">
            <StatusBadge document={document} />
            <span>{wordCount.chars} 字</span>
            <span className="dot">·</span>
            <span>含标点 {wordCount.charsWithPunctuation}</span>
            {!locked && (
              <span className={`save-state save-${saveIndicator}`}>
                {saveIndicator === 'saving' && '保存中…'}
                {saveIndicator === 'saved' && '已保存'}
                {saveIndicator === 'error' && '保存失败'}
              </span>
            )}
          </div>
        </div>
        <div className="writing-header-actions">
          <button
            className="btn btn-ghost btn-small"
            onClick={() => navigate(`/doc/${document.id}/history`)}
          >
            历史
          </button>
        </div>
      </header>

      {flash && (
        <div className="flash-banner" role="status">
          <span className="flash-mark" aria-hidden="true" />
          <span>{flash}</span>
          <button className="flash-close" onClick={() => setFlash(null)} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}

      {isReview && (
        <div className="review-banner">
          <div>
            <strong>
              {isReviewer ? '这篇作文正在等你修订' : '这篇作文正在等爸爸妈妈修订'}
            </strong>
            <p>
              {isReviewer
                ? '在修订副本里修改不会直接覆盖原文，提交后由小朋友逐条决定是否接受。'
                : document.pendingSubmissions > 0
                  ? `已经收到 ${document.pendingSubmissions} 份修订，去看看吧。`
                  : '正文暂时锁定，爸爸妈妈提交后你就可以逐条处理。'}
            </p>
          </div>
          <div className="review-banner-actions">
            {isReviewer && (
              <button
                className="btn btn-primary btn-small"
                onClick={() => navigate(`/doc/${document.id}/review`)}
              >
                开始修订
              </button>
            )}
            {isAuthor && document.pendingSubmissions > 0 && (
              <button
                className="btn btn-primary btn-small"
                onClick={() => navigate(`/doc/${document.id}/resolve`)}
              >
                去处理修订
              </button>
            )}
            {isAuthor && (
              <button
                className="btn btn-ghost btn-small"
                onClick={() => setShowCancel(true)}
              >
                撤回审阅
              </button>
            )}
          </div>
        </div>
      )}

      {isFinal && (
        <div className="review-banner finish-banner">
          <div>
            <strong>
              {isAuthor ? '这篇作文已经是成品了' : '这是小朋友完成的成品'}
            </strong>
            <p>
              {isAuthor
                ? '成品会锁定正文。想再改一改，可以点「继续修改」，原来的成品版本仍会留在历史里。'
                : '成品是小朋友自己决定完成的版本。'}
            </p>
          </div>
          <div className="review-banner-actions">
            <button
              className="btn btn-primary btn-small"
              onClick={() => navigate(`/doc/${document.id}/finish`)}
            >
              查看成品
            </button>
            {isAuthor && (
              <button
                className="btn btn-ghost btn-small"
                onClick={() => reopen.mutate()}
                disabled={reopen.isPending}
              >
                {reopen.isPending ? '正在解锁…' : '继续修改'}
              </button>
            )}
          </div>
        </div>
      )}

      {isReviewer && !isReview && !isFinal && (
        <div className="inline-note">
          这是小朋友的草稿。等小朋友提交审阅后，你就可以在修订副本里修改了。
        </div>
      )}

      {isAuthor && !isReview && !isFinal && document.canPublish && (
        <div className="inline-note">
          这篇之前已经完成过，可以直接生成新成品；也可以再交给爸爸妈妈看一遍。
        </div>
      )}

      {saveState === 'error' && !locked && (
        <div className="inline-error">
          保存失败：{saveError}
          <button className="link-button" onClick={() => void saveNow()}>
            重试
          </button>
        </div>
      )}

      <div className="writing-editor-wrap">
        <Editor
          value={content}
          onChange={setContent}
          readOnly={locked}
          indent={getIndentPreference()}
          placeholder={
            isReview
              ? '审阅中，正文暂时不能修改。'
              : isFinal
                ? '成品已锁定，点「继续修改」才能编辑。'
                : isReviewer
                  ? '等小朋友提交审阅后，就可以在这里修订了。'
                  : '　　今天发生了什么呢？从这里开始写……'
          }
        />
      </div>

      <footer className="writing-footer">
        <div className="writing-footer-meta">
          <span>{documentTitle(title)}</span>
          <span className="dot">·</span>
          <span>{wordCount.chars} 字</span>
          {isReviewer && !isReview && !isFinal && (
            <>
              <span className="dot">·</span>
              <span>等待小朋友提交审阅</span>
            </>
          )}
        </div>
        <div className="writing-footer-actions">
          {isAuthor && !isReview && !isFinal && (
            <>
              <button
                className={document.canPublish ? 'btn btn-ghost' : 'btn btn-primary'}
                onClick={() => setShowSubmit(true)}
                disabled={!content.trim() || saveState === 'saving'}
              >
                交给爸妈修订
              </button>
              {document.canPublish && (
                <button
                  className="btn btn-primary"
                  onClick={() => setShowPublish(true)}
                  disabled={!content.trim() || saveState === 'saving'}
                >
                  生成成品
                </button>
              )}
            </>
          )}
          {isAuthor && isReview && document.pendingSubmissions > 0 && (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/doc/${document.id}/resolve`)}
            >
              处理修订
            </button>
          )}
          {isFinal && (
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/doc/${document.id}/finish`)}
            >
              查看成品
            </button>
          )}
        </div>
      </footer>

      <Modal
        open={showSubmit}
        title="交给爸妈修订？"
        confirmLabel="交给爸妈"
        busy={submitReview.isPending}
        onConfirm={() => submitReview.mutate()}
        onCancel={() => setShowSubmit(false)}
      >
        <p>提交后正文会暂时锁定，爸爸妈妈可以各自修改并提交建议。</p>
        <p>他们不会直接改掉你的原文，所有修改都由你逐条决定接受或拒绝。</p>
      </Modal>

      <Modal
        open={showCancel}
        title="撤回这次审阅？"
        confirmLabel="撤回"
        confirmTone="danger"
        busy={cancelReview.isPending}
        onConfirm={() => cancelReview.mutate()}
        onCancel={() => setShowCancel(false)}
      >
        <p>撤回后，已经提交的修订不会应用到正文，作文恢复可编辑。</p>
        <p>修订记录仍会保留在历史里。</p>
      </Modal>

      <Modal
        open={showPublish}
        title="直接生成成品？"
        confirmLabel="生成成品"
        busy={publishSelf.isPending}
        onConfirm={() => publishSelf.mutate()}
        onCancel={() => setShowPublish(false)}
      >
        <p>这次修改会直接冻结成成品，不需要再经过爸爸妈妈修订。</p>
        <p>生成后正文会锁定；想再改，可以在成品页点「继续修改」。</p>
      </Modal>

      {publishSelf.isError && (
        <div className="inline-error">{(publishSelf.error as Error).message}</div>
      )}
    </div>
  );
}
