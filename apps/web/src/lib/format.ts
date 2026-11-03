import type { ChangeType, DocumentStatus, VersionKind } from './types';

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatDateLong(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(iso));
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
  return formatDateTime(iso);
}

export const statusMeta: Record<
  DocumentStatus,
  { label: string; tone: 'muted' | 'blue' | 'amber' | 'green' }
> = {
  draft: { label: '草稿', tone: 'muted' },
  in_review: { label: '审阅中', tone: 'blue' },
  final: { label: '已完成', tone: 'green' },
};

export const versionKindLabel: Record<VersionKind, string> = {
  snapshot: '手动保存',
  auto_snapshot: '自动保存点',
  review_base: '提交审阅',
  merge: '合并修订',
  restore: '恢复版本',
  import: '导入',
};

export const changeTypeLabel: Record<ChangeType, string> = {
  insert: '新增',
  delete: '删除',
  replace: '修改',
};

export function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const chars = Array.from(trimmed);

  // 中文名取第一个字；英文名取前两个字母，头像里更清爽。
  if (/^[A-Za-z]/.test(trimmed)) {
    return chars.slice(0, 2).join('').toUpperCase();
  }
  return chars[0] ?? '?';
}

export function documentTitle(title: string): string {
  return title.trim() || '无题';
}

export function plural(n: number, unit: string): string {
  return `${n} ${unit}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** index;
  const digits = index === 0 ? 0 : value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export function formatMoney(cents: number): string {
  const value = Math.max(0, Math.round(cents)) / 100;
  return `¥${value.toFixed(2)}`;
}
