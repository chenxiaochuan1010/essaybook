import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { User } from '../lib/types';
import { Avatar } from './Avatar';

interface ProfilePickerProps {
  onSelected?: (user: User) => void;
}

export function ProfilePicker({ onSelected }: ProfilePickerProps) {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: api.profiles });

  const login = useMutation({
    mutationFn: (userId: string) => api.login(userId),
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data);
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      onSelected?.(data.user);
    },
  });

  return (
    <div className="profile-screen">
      <div className="profile-panel">
        <div className="profile-brand">
          <span className="brand-mark brand-mark-large">作</span>
          <div>
            <h1>作文本</h1>
            <p>写完，交给爸爸妈妈看看。</p>
          </div>
        </div>

        {profiles.isLoading && <div className="profile-loading">正在连接家里的书架…</div>}

        {profiles.isError && (
          <div className="profile-error">
            <strong>连接不到服务</strong>
            <p>请确认 NAS 上的作文本服务正在运行，并且这台设备已连接 Tailscale。</p>
            <button className="btn btn-ghost" onClick={() => profiles.refetch()}>
              重试
            </button>
          </div>
        )}

        <div className="profile-list">
          {profiles.data?.profiles.map((profile) => (
            <button
              key={profile.id}
              className="profile-card"
              onClick={() => login.mutate(profile.id)}
              disabled={login.isPending}
            >
              <Avatar name={profile.name} color={profile.color} size="lg" />
              <span className="profile-name">{profile.name}</span>
              <span className="profile-role">
                {profile.role === 'author' ? '作者' : '审阅者'}
              </span>
              <span className="profile-enter">
                {login.isPending && login.variables === profile.id ? '进入中…' : '进入'}
              </span>
            </button>
          ))}
        </div>

        {login.isError && (
          <div className="form-error">{(login.error as Error).message}</div>
        )}

        <p className="profile-footnote">
          作文和修订记录都保存在家里的 NAS 上，不会上传到第三方。
        </p>
      </div>
    </div>
  );
}
