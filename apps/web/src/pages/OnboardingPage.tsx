import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

/**
 * 小朋友第一次进入时的起名字页。只出现一次，之后可以在设置里修改。
 */
export function OnboardingPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const save = useMutation({
    mutationFn: () => api.updateMe(name.trim()),
    onSuccess: (data) => {
      queryClient.setQueryData(['me'], data);
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
  });

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && !save.isPending;

  return (
    <div className="onboarding-screen">
      <div className="onboarding-card">
        <div className="onboarding-brand">
          <span className="brand-mark brand-mark-large">作</span>
          <span>作文本</span>
        </div>

        <h1>欢迎，小小作家</h1>
        <p className="onboarding-lead">先告诉我，你叫什么名字呀？</p>

        <form
          className="onboarding-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) save.mutate();
          }}
        >
          <input
            className="onboarding-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="比如：小雨"
            maxLength={12}
            autoFocus
            aria-label="你的名字"
          />
          <p className="onboarding-hint">
            这个名字会出现在你的作文、修订记录和成品上。
          </p>
          <button className="btn btn-primary btn-onboarding" type="submit" disabled={!canSubmit}>
            {save.isPending ? '正在准备…' : '开始写作'}
          </button>
        </form>

        {save.isError && (
          <div className="form-error">{(save.error as Error).message}</div>
        )}

        <p className="onboarding-footnote">以后想改名字，可以在「设置」里修改。</p>
      </div>
    </div>
  );
}
