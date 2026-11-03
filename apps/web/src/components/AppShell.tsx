import { useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { User } from '../lib/types';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

interface AppShellProps {
  user: User;
  children: ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showSwitch, setShowSwitch] = useState(false);

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.clear();
      // 直接回到身份选择页，避免任何内存中的旧会话状态残留。
      window.location.assign('/');
    },
  });

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/')} aria-label="回到书架">
          <span className="brand-mark">作</span>
          <span className="brand-text">作文本</span>
        </button>

        <div className="topbar-actions">
          <button
            className="btn btn-ghost btn-small topbar-settings"
            onClick={() => navigate('/settings')}
          >
            设置
          </button>
          <button className="profile-chip" onClick={() => setShowSwitch(true)}>
            <Avatar name={user.name} color={user.color} size="sm" />
            <span className="profile-chip-name">{user.name}</span>
            <span className="profile-chip-caret">⌄</span>
          </button>
        </div>
      </header>

      <main className="app-main">{children}</main>

      <Modal
        open={showSwitch}
        title="切换身份"
        confirmLabel="切换"
        cancelLabel="取消"
        busy={logout.isPending}
        onConfirm={() => logout.mutate()}
        onCancel={() => setShowSwitch(false)}
      >
        <p>
          当前身份是 <strong>{user.name}</strong>。切换后会回到身份选择页，未保存的修改会自动保存。
        </p>
      </Modal>
    </div>
  );
}
