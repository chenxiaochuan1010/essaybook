import type {
  BackupStatus,
  BackupSummary,
  ChangeView,
  ConflictPair,
  DocumentDetail,
  DocumentSummary,
  FeesPayload,
  PublishStats,
  RoundView,
  SettlementInfo,
  SubmissionDetail,
  SubmissionView,
  User,
  VersionDetail,
  VersionSummary,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code = 'UNKNOWN', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  // 只有带请求体时才声明 JSON，否则 Fastify 会因为空的 JSON body 返回 400。
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers,
  });

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new Event('essaybook:auth-expired'));
    }
    const error = (data as { error?: { message?: string; code?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      error?.message ?? '请求失败，请稍后再试',
      res.status,
      error?.code,
      error?.details,
    );
  }

  return data as T;
}

function jsonBody(value: unknown): RequestInit {
  return {
    method: 'POST',
    body: JSON.stringify(value),
  };
}

export const api = {
  profiles: () => request<{ profiles: User[] }>('/api/profiles'),

  login: (userId: string) =>
    request<{ user: User }>('/api/session', jsonBody({ userId })),

  logout: () => request<{ ok: true }>('/api/session', { method: 'DELETE' }),

  me: () => request<{ user: User }>('/api/me'),

  updateMe: (name: string) =>
    request<{ user: User }>('/api/me', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  listDocuments: () => request<{ documents: DocumentSummary[] }>('/api/documents'),

  stats: () => request<{ stats: PublishStats }>('/api/stats'),

  createDocument: (title = '') =>
    request<{ document: DocumentDetail }>('/api/documents', jsonBody({ title })),

  getDocument: (id: string) =>
    request<{ document: DocumentDetail }>(`/api/documents/${id}`),

  updateDocument: (id: string, input: { title?: string; content?: string }) =>
    request<{ document: DocumentDetail }>(`/api/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteDocument: (id: string) =>
    request<{ ok: true }>(`/api/documents/${id}`, { method: 'DELETE' }),

  listTrash: () => request<{ documents: DocumentSummary[] }>('/api/trash'),

  restoreDocument: (id: string) =>
    request<{ document: DocumentDetail }>(`/api/documents/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  purgeDocument: (id: string) =>
    request<{ ok: true }>(`/api/documents/${id}/permanent`, { method: 'DELETE' }),

  publishDocument: (id: string) =>
    request<{
      document: DocumentDetail;
      version: VersionSummary | null;
      number: number;
    }>(`/api/documents/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  reopenDocument: (id: string) =>
    request<{ document: DocumentDetail }>(`/api/documents/${id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  listVersions: (documentId: string) =>
    request<{ versions: VersionSummary[] }>(`/api/documents/${documentId}/versions`),

  getVersion: (versionId: string) =>
    request<{ version: VersionDetail }>(`/api/versions/${versionId}`),

  saveVersion: (documentId: string, note?: string) =>
    request<{ version: VersionSummary }>(`/api/documents/${documentId}/versions`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),

  restoreVersion: (documentId: string, versionId: string) =>
    request<{ document: DocumentDetail }>(
      `/api/documents/${documentId}/versions/${versionId}/restore`,
      { method: 'POST', body: JSON.stringify({}) },
    ),

  submitForReview: (documentId: string) =>
    request<{ round: RoundView }>(`/api/documents/${documentId}/rounds`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getRound: (roundId: string) =>
    request<{ round: RoundView }>(`/api/rounds/${roundId}`),

  cancelRound: (roundId: string) =>
    request<{ round: RoundView }>(`/api/rounds/${roundId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  submitReview: (roundId: string, content: string) =>
    request<{ submission: SubmissionView }>(`/api/rounds/${roundId}/submissions`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  getSubmission: (submissionId: string) =>
    request<{ submission: SubmissionDetail }>(`/api/submissions/${submissionId}`),

  withdrawSubmission: (submissionId: string) =>
    request<{ ok: true }>(`/api/submissions/${submissionId}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  setChangeStatus: (changeId: string, status: 'accepted' | 'rejected') =>
    request<{ change: ChangeView }>(`/api/changes/${changeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  bulkSetChangeStatus: (
    roundId: string,
    status: 'accepted' | 'rejected',
    reviewerId?: string,
  ) =>
    request<{ updated: number }>(`/api/rounds/${roundId}/changes/bulk`, {
      method: 'POST',
      body: JSON.stringify({ status, reviewerId }),
    }),

  getConflicts: (roundId: string) =>
    request<{ conflicts: ConflictPair[] }>(`/api/rounds/${roundId}/conflicts`),

  mergeRound: (roundId: string) =>
    request<{
      document: DocumentDetail;
      version: VersionSummary | null;
      acceptedCount: number;
    }>(`/api/rounds/${roundId}/merge`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  backups: () =>
    request<{ status: BackupStatus; backups: BackupSummary[] }>('/api/backups'),

  createBackup: () =>
    request<{ backup: BackupSummary }>('/api/backups', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  deleteBackup: (id: string) =>
    request<{ ok: true }>(`/api/backups/${id}`, { method: 'DELETE' }),

  exportAllUrl: () => '/api/export/all',

  exportDocumentUrl: (documentId: string) =>
    `/api/export/documents/${documentId}`,

  fees: () => request<FeesPayload>('/api/fees'),

  requestSettlement: () =>
    request<{ settlement: SettlementInfo; amountCents: number }>(
      '/api/fees/request',
      { method: 'POST', body: JSON.stringify({}) },
    ),

  confirmSettlement: (id: string) =>
    request<{ settlement: SettlementInfo }>(`/api/fees/requests/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  cancelSettlement: (id: string) =>
    request<{ ok: true }>(`/api/fees/requests/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
