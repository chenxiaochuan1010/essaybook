import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import {
  getIndentPreference,
  getThemePreference,
  setIndentPreference,
  setThemePreference,
  type ThemePreference,
} from '../lib/preferences';
import { Avatar } from '../components/Avatar';
import { Modal } from '../components/Modal';

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles });
  const backups = useQuery({ queryKey: ['backups'], queryFn: api.backups });
  const [indent, setIndent] = useState(getIndentPreference);
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
  const [showSwitch, setShowSwitch] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const rename = useMutation({
    mutationFn: () => api.updateMe(nameDraft.trim()),
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data);
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      setShowRename(false);
    },
  });

  const createBackup = useMutation({
    mutationFn: api.createBackup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
  });

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      window.location.assign('/');
    },
  });

  function toggleIndent() {
    const next = !indent;
    setIndent(next);
    setIndentPreference(next);
  }

  function chooseTheme(next: ThemePreference) {
    setTheme(next);
    setThemePreference(next);
  }

  return (
    <div className="page settings-page">
      <header className="page-header">
        <button className="icon-button" onClick={() => navigate('/')}>
          ←
        </button>
        <div>
          <h1>书架设置</h1>
        </div>
      </header>

      <section className="panel settings-section">
        <h2>家庭成员</h2>
        <p className="settings-hint">每个人有独立的身份和修订颜色。</p>
        <div className="member-list">
          {profiles.data?.profiles.map((profile) => (
            <div className="member-row" key={profile.id}>
              <Avatar name={profile.name} color={profile.color} size="md" />
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.role === 'author' ? '作者' : '审阅者'}</span>
              </div>
              {me.data?.user.id === profile.id && (
                <span className="badge badge-blue">当前身份</span>
              )}
            </div>
          ))}
        </div>
        <div className="settings-button-row">
          <button
            className="btn btn-ghost"
            onClick={() => {
              setNameDraft(me.data?.user.name ?? '');
              setShowRename(true);
            }}
          >
            修改我的名字
          </button>
          <button className="btn btn-ghost" onClick={() => setShowSwitch(true)}>
            切换身份
          </button>
        </div>
      </section>

      <section className="panel settings-section">
        <h2>写作偏好</h2>
        <div className="setting-row">
          <div>
            <strong>自动首行缩进</strong>
            <p>按回车另起一段时，自动插入两个全角空格。</p>
          </div>
          <button
            className={`switch ${indent ? 'is-on' : ''}`}
            onClick={toggleIndent}
            role="switch"
            aria-checked={indent}
          >
            <span />
          </button>
        </div>
      </section>

      <section className="panel settings-section">
        <h2>外观</h2>
        <p className="settings-hint">选一个你喜欢的颜色。</p>
        <div className="theme-options" role="radiogroup" aria-label="主题">
          <button
            type="button"
            role="radio"
            aria-checked={theme === 'light'}
            className={`theme-option ${theme === 'light' ? 'is-active' : ''}`}
            onClick={() => chooseTheme('light')}
          >
            <span className="theme-preview theme-preview-light" aria-hidden="true">
              <span className="theme-preview-dot" />
              <span className="theme-preview-line" />
              <span className="theme-preview-line is-short" />
            </span>
            <span>明亮</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={theme === 'dark'}
            className={`theme-option ${theme === 'dark' ? 'is-active' : ''}`}
            onClick={() => chooseTheme('dark')}
          >
            <span className="theme-preview theme-preview-dark" aria-hidden="true">
              <span className="theme-preview-dot" />
              <span className="theme-preview-line" />
              <span className="theme-preview-line is-short" />
            </span>
            <span>暗色</span>
          </button>
        </div>
      </section>

      <section className="panel settings-section">
        <h2>保存与备份</h2>
        <p className="settings-hint">
          作文保存在家里的 NAS 上，服务会每 {backups.data?.status.autoIntervalHours ?? 24}{' '}
          小时自动生成一次数据库快照，并保留最近{' '}
          {backups.data?.status.autoKeep ?? 30} 份。
        </p>

        <div className="backup-status">
          <div>
            <span className="backup-label">上次备份</span>
            <strong>
              {backups.data?.status.latest
                ? `${formatDateTime(backups.data.status.latest.createdAt)}`
                : '还没有备份'}
            </strong>
            {backups.data?.status.latest && (
              <span className="backup-meta">
                {backups.data.status.latest.kind === 'auto' ? '自动' : '手动'} ·{' '}
                {formatBytes(backups.data.status.latest.sizeBytes)}
              </span>
            )}
          </div>
          <button
            className="btn btn-primary btn-small"
            onClick={() => createBackup.mutate()}
            disabled={createBackup.isPending}
          >
            {createBackup.isPending ? '备份中…' : '立即备份'}
          </button>
        </div>

        {createBackup.isSuccess && (
          <div className="inline-success">
            <span className="flash-mark" aria-hidden="true" />
            已生成备份 {createBackup.data.backup.file}
          </div>
        )}
        {createBackup.isError && (
          <div className="inline-error">{(createBackup.error as Error).message}</div>
        )}

        <div className="backup-actions">
          <a className="btn btn-ghost btn-small" href={api.exportAllUrl()}>
            导出全部作文（Markdown）
          </a>
          <button className="btn btn-ghost btn-small" onClick={() => navigate('/fees')}>
            查看稿费明细
          </button>
          <button className="btn btn-ghost btn-small" onClick={() => navigate('/trash')}>
            打开回收站
          </button>
        </div>

        {backups.data && backups.data.backups.length > 0 && (
          <ul className="backup-list">
            {backups.data.backups.slice(0, 4).map((backup) => (
              <li key={backup.id}>
                <span className={`backup-kind backup-${backup.kind}`}>
                  {backup.kind === 'auto' ? '自动' : backup.kind === 'manual' ? '手动' : '迁移前'}
                </span>
                <span className="backup-file">{backup.file}</span>
                <span className="backup-meta">
                  {formatDateTime(backup.createdAt)} · {formatBytes(backup.sizeBytes)}
                  {backup.integrityOk ? ' · 已校验' : ' · 校验失败'}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="settings-hint settings-hint-fine">
          备份文件默认保存在数据目录的 backups 文件夹里。建议再用 NAS 的同步或快照功能，
          把这个目录复制一份到另一块硬盘或另一台设备。
        </p>
      </section>

      <section className="panel settings-section">
        <h2>关于</h2>
        <p className="settings-hint">
          作文本 v0.2 · 数据保存在家庭 NAS · 通过 Tailscale 访问
        </p>
      </section>

      <Modal
        open={showRename}
        title="修改我的名字"
        confirmLabel="保存"
        busy={rename.isPending}
        onConfirm={() => rename.mutate()}
        onCancel={() => setShowRename(false)}
      >
        <p>这个名字会出现在书架、修订记录和成品上。</p>
        <input
          className="marker-input"
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          placeholder="你的名字"
          maxLength={12}
          aria-label="你的名字"
        />
      </Modal>

      {rename.isError && (
        <div className="inline-error">{(rename.error as Error).message}</div>
      )}

      <Modal
        open={showSwitch}
        title="切换身份"
        confirmLabel="切换"
        busy={logout.isPending}
        onConfirm={() => logout.mutate()}
        onCancel={() => setShowSwitch(false)}
      >
        <p>切换后会回到身份选择页。</p>
      </Modal>
    </div>
  );
}
