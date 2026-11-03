import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { ProfilePicker } from './components/ProfilePicker';
import { AppShell } from './components/AppShell';
import { OnboardingPage } from './pages/OnboardingPage';
import { BookshelfPage } from './pages/BookshelfPage';
import { WritingPage } from './pages/WritingPage';
import { ReviewPage } from './pages/ReviewPage';
import { ResolvePage } from './pages/ResolvePage';
import { FinishPage } from './pages/FinishPage';
import { FeesPage } from './pages/FeesPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { TrashPage } from './pages/TrashPage';

export default function App() {
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
  });

  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
    };
    window.addEventListener('essaybook:auth-expired', handler);
    return () => window.removeEventListener('essaybook:auth-expired', handler);
  }, [queryClient]);

  if (me.isLoading) {
    return (
      <div className="splash-screen">
        <div className="splash-mark">作</div>
        <p>正在打开作文本…</p>
      </div>
    );
  }

  if (!me.data?.user) {
    return <ProfilePicker />;
  }

  if (me.data.user.role === 'author' && !me.data.user.onboardedAt) {
    return <OnboardingPage />;
  }

  return (
    <AppShell user={me.data.user}>
      <Routes>
        <Route path="/" element={<BookshelfPage />} />
        <Route path="/doc/:id" element={<WritingPage />} />
        <Route path="/doc/:id/review" element={<ReviewPage />} />
        <Route path="/doc/:id/resolve" element={<ResolvePage />} />
        <Route path="/doc/:id/finish" element={<FinishPage />} />
        <Route path="/doc/:id/history" element={<HistoryPage />} />
        <Route path="/fees" element={<FeesPage />} />
        <Route path="/trash" element={<TrashPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
