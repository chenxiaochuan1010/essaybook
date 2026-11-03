import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { VersionSummary } from '../lib/types';
import { documentTitle, formatDateTime, versionKindLabel } from '../lib/format';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';

function versionLabel(version: VersionSummary): string {
  if (version.note?.startsWith('成品')) return '生成成品';
  return versionKindLabel[version.kind];
}

function versionBadgeClass(version: VersionSummary): string {
  if (version.note?.startsWith('成品')) return 'version-publish';
  return `version-${version.kind}`;
}

export function HistoryPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const documentQuery = useQuery({
    queryKey: ['document', id],
    queryFn: () => api.getDocument(id!),
    enabled: Boolean(id),
  });
  const versionsQuery = useQuery({
    queryKey: ['versions', id],
    queryFn: () => api.listVersions(id!),
    enabled: Boolean(id),
  });

  const versions = versionsQuery.data?.versions ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [showMarker, setShowMarker] = useState(false);
  const [markerNote, setMarkerNote] = useState('');

  const marker = useMutation({
    mutationFn: () => api.saveVersion(id!, markerNote.trim() || undefined),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['versions', id] });
      queryClient.invalidateQueries({ queryKey: ['document', id] });
      setSelectedId(data.version.id);
      setMarkerNote('');
      setShowMarker(false);
    },
  });

  const selected = useMemo(
    () => versions.find((version) => version.id === selectedId) ?? versions[0],
    [versions, selectedId],
  );

  const versionQuery = useQuery({
    queryKey: ['version', selected?.id],
    queryFn: () => api.getVersion(selected!.id),
    enabled: Boolean(selected?.id),
  });

  const restore = useMutation({
    mutationFn: () => api.restoreVersion(id!, selected!.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', id] });
      queryClient.invalidateQueries({ queryKey: ['versions', id] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowRestore(false);
      navigate(`/doc/${id}`);
    },
  });

  if (documentQuery.isLoading || versionsQuery.isLoading) {
    return <div className="page-state">正在翻看历史…</div>;
  }

  if (documentQuery.isError || !documentQuery.data) {
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

  const document = documentQuery.data.document;

  return (
    <div className="page history-page">
      <header className="page-header">
        <button className="icon-button" onClick={() => navigate(`/doc/${document.id}`)}>
          ←
        </button>
        <div>
          <h1>版本历史</h1>
          <p className="page-subtitle">
            {documentTitle(document.title)} · 每一次提交、合并和恢复都会留下一个版本。
          </p>
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-ghost btn-small"
            onClick={() => setShowMarker(true)}
          >
            打一个标记
          </button>
          <a
            className="btn btn-ghost btn-small"
            href={api.exportDocumentUrl(document.id)}
          >
            导出 Markdown
          </a>
        </div>
      </header>

      {versions.length === 0 ? (
        <div className="panel empty-panel">
          <h2>还没有历史版本</h2>
          <p>写一会儿后，系统会自动留下保存点；提交审阅和合并也会生成版本。</p>
          <button className="btn btn-primary" onClick={() => navigate(`/doc/${document.id}`)}>
            继续写
          </button>
        </div>
      ) : (
        <div className="history-layout">
          <section className="history-list">
            {versions.map((version) => (
              <button
                key={version.id}
                className={`history-item ${selected?.id === version.id ? 'is-active' : ''}`}
                onClick={() => setSelectedId(version.id)}
              >
                <div className="history-item-top">
                  <span className={`version-badge ${versionBadgeClass(version)}`}>
                    {versionLabel(version)}
                  </span>
                  <span className="history-time">{formatDateTime(version.createdAt)}</span>
                </div>
                <div className="history-item-main">
                  <Avatar
                    name={version.authorName}
                    color={version.authorColor}
                    size="sm"
                  />
                  <span>{version.authorName}</span>
                  <span className="history-chars">{version.charCount} 字</span>
                </div>
                {version.note && <p className="history-note">{version.note}</p>}
                {version.id === document.currentVersionId && (
                  <span className="current-version">当前版本</span>
                )}
              </button>
            ))}
          </section>

          <section className="history-preview panel">
            {selected && (
              <>
                <header className="panel-heading">
                  <div>
                    <h2>{versionLabel(selected)}</h2>
                    <span>
                      {selected.authorName} · {formatDateTime(selected.createdAt)} ·{' '}
                      {selected.charCount} 字
                    </span>
                  </div>
                  <button
                    className="btn btn-primary btn-small"
                    onClick={() => setShowRestore(true)}
                  >
                    恢复到此版本
                  </button>
                </header>

                {versionQuery.isLoading && <div className="page-state">正在打开版本…</div>}
                {versionQuery.isError && (
                  <div className="inline-error">
                    {(versionQuery.error as Error).message}
                  </div>
                )}
                {versionQuery.data && (
                  <pre className="version-content">
                    {versionQuery.data.version.content || '（空白版本）'}
                  </pre>
                )}
              </>
            )}
          </section>
        </div>
      )}

      <Modal
        open={showMarker}
        title="给当前正文打个标记？"
        confirmLabel="保存标记"
        busy={marker.isPending}
        onConfirm={() => marker.mutate()}
        onCancel={() => setShowMarker(false)}
      >
        <p>当前正文会保存成一个可以随时恢复的版本，不会影响正在写的内容。</p>
        <input
          className="marker-input"
          value={markerNote}
          onChange={(event) => setMarkerNote(event.target.value)}
          placeholder="备注（可选），比如：第一稿"
          maxLength={100}
          aria-label="版本备注"
        />
      </Modal>

      {marker.isError && (
        <div className="inline-error">{(marker.error as Error).message}</div>
      )}

      <Modal
        open={showRestore}
        title="恢复到这个版本？"
        confirmLabel="恢复"
        busy={restore.isPending}
        onConfirm={() => restore.mutate()}
        onCancel={() => setShowRestore(false)}
      >
        <p>当前正文会被替换成这个版本的内容，同时生成一个新的恢复版本。</p>
        <p>
          现有版本都不会被删除，随时可以再恢复回来。如果这篇已经是成品，恢复后会回到草稿状态。
        </p>
      </Modal>
    </div>
  );
}
