import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { documentTitle, formatDateLong, formatMoney } from '../lib/format';

/**
 * 成品页：把作文排版成一张纸，首屏用打字机效果逐字显示，
 * 完成后盖上「已完稿」印章，并结算按字数计算的稿费。
 */
export function FinishPage() {
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

  const statsQuery = useQuery({
    queryKey: ['stats'],
    queryFn: api.stats,
    enabled: document?.status === 'final',
  });

  const [animating, setAnimating] = useState(
    Boolean((location.state as { celebrate?: boolean } | null)?.celebrate),
  );
  const [visibleCount, setVisibleCount] = useState(0);

  const chars = useMemo(
    () => Array.from(document?.content ?? ''),
    [document?.content],
  );
  const typingDuration = Math.min(5000, Math.max(3000, chars.length * 30));

  useEffect(() => {
    if (!animating) return;

    const total = chars.length;
    if (total === 0) {
      setAnimating(false);
      return;
    }

    const prefersReduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (prefersReduced) {
      setAnimating(false);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / typingDuration);
      setVisibleCount(Math.floor(progress * total));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setVisibleCount(total);
        setAnimating(false);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animating, chars.length, typingDuration]);

  useEffect(() => {
    if (!location.state) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const reopen = useMutation({
    mutationFn: () => api.reopenDocument(id!),
    onSuccess: (data) => {
      queryClient.setQueryData(['document', id], data);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      navigate(`/doc/${id}`);
    },
  });

  if (documentQuery.isLoading) {
    return <div className="page-state">正在打开成品…</div>;
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

  if (document.status !== 'final') {
    return (
      <div className="page">
        <div className="panel empty-panel">
          <h2>
            {document.status === 'in_review' ? '还在等爸妈修订' : '还不是成品'}
          </h2>
          <p>
            {document.status === 'in_review'
              ? '处理完修订建议后，就可以生成成品了。'
              : '先写完作文、处理完修订建议，再来生成成品吧。'}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => navigate(`/doc/${document.id}`)}
          >
            回到作文
          </button>
        </div>
      </div>
    );
  }

  const publishedAt = document.publishedAt ?? document.updatedAt;
  const typing = animating;
  const shownText = chars
    .slice(0, typing ? Math.min(visibleCount, chars.length) : chars.length)
    .join('');
  const rate = statsQuery.data?.stats.rateCentsPerChar ?? 1;
  const feeCents = document.publishFeeCents ?? document.wordCount.chars * rate;
  const todayFee = statsQuery.data?.stats.today.feeCents ?? feeCents;
  const todayPieces = statsQuery.data?.stats.today.pieces;

  return (
    <div className={`finish-page ${typing ? 'is-celebrating' : ''}`}>
      <div className="finish-stage">
        <div className="paper-output">
          <article className="finished-sheet">
            {!typing && (
              <div className="sheet-seal" aria-label="已完稿">
                <span>已完稿</span>
              </div>
            )}

            <header className="sheet-header">
              <h1 className="sheet-title">{documentTitle(document.title)}</h1>
              <p className="sheet-meta">
                {document.ownerName} · {formatDateLong(publishedAt)} ·{' '}
                {document.wordCount.chars} 字
              </p>
            </header>

            <div className="sheet-rule" />

            <div className="sheet-body">
              {shownText}
              {typing && <span className="type-caret" aria-hidden="true" />}
            </div>

            <footer className="sheet-footer">
              作文本 · 第 {document.publishNumber ?? 1} 篇
            </footer>
          </article>
        </div>
      </div>

      {!typing && (
        <>
          <div className="fee-card" aria-live="polite">
            <div className="fee-main">
              <span>本篇稿费</span>
              <strong>{formatMoney(feeCents)}</strong>
              <em>
                {document.wordCount.chars} 字 × {rate} 分
              </em>
            </div>
            <div className="fee-today">
              <span>今日合计</span>
              <strong>{formatMoney(todayFee)}</strong>
              <em>
                {todayPieces === undefined ? '正在结算…' : `${todayPieces} 篇完稿`}
              </em>
            </div>
          </div>

          <div className="finish-actions">
            <button className="btn btn-primary" onClick={() => window.print()}>
              打印 / 存为 PDF
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => reopen.mutate()}
              disabled={reopen.isPending}
            >
              {reopen.isPending ? '正在解锁…' : '继续修改'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => navigate(`/doc/${document.id}/history`)}
            >
              版本记录
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/')}>
              返回书架
            </button>
          </div>
        </>
      )}

      {reopen.isError && (
        <div className="inline-error">{(reopen.error as Error).message}</div>
      )}

      {typing && (
        <button
          className="skip-animation"
          onClick={() => {
            setVisibleCount(chars.length);
            setAnimating(false);
          }}
        >
          跳过动画
        </button>
      )}
    </div>
  );
}
