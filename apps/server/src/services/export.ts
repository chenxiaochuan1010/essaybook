import {
  getDocument,
  getDocumentOrThrow,
  listDocuments,
  listVersions,
} from './documents.js';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(iso));
}

function safeFileName(title: string, fallback: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

export interface ExportedDocument {
  fileName: string;
  markdown: string;
}

export function exportDocumentMarkdown(documentId: string): ExportedDocument {
  const document = getDocument(documentId);
  const versions = listVersions(documentId);

  const lines: string[] = [];
  lines.push(`# ${document.title.trim() || '无题'}`);
  lines.push('');
  lines.push(`> 作者：${document.ownerName}  `);
  lines.push(`> 创建：${formatDate(document.createdAt)}  `);
  lines.push(`> 最近修改：${formatDate(document.updatedAt)}  `);
  lines.push(`> 字数：${document.wordCount.chars} 字（含标点 ${document.wordCount.charsWithPunctuation}）  `);
  lines.push(`> 版本：${versions.length} 个`);
  if (document.status === 'final' && document.publishNumber) {
    const published = document.publishedAt
      ? ` · ${formatDate(document.publishedAt)}`
      : '';
    lines.push(`> 成品：第 ${document.publishNumber} 篇${published}`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(document.content.trimEnd() || '（空白）');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## 版本历史');
  lines.push('');

  for (const version of versions) {
    const kind = version.note?.startsWith('成品')
      ? '生成成品'
      : versionKind(version.kind);
    lines.push(
      `- ${formatDate(version.createdAt)} · ${kind} · ${version.authorName} · ${version.charCount} 字${
        version.note && !version.note.startsWith('成品') ? ` · ${version.note}` : ''
      }`,
    );
  }
  lines.push('');

  const title = safeFileName(document.title, '无题');
  return {
    fileName: `${title}.md`,
    markdown: lines.join('\n'),
  };
}

function versionKind(kind: string): string {
  const map: Record<string, string> = {
    snapshot: '手动保存',
    auto_snapshot: '自动保存点',
    review_base: '提交审阅',
    merge: '合并修订',
    restore: '恢复版本',
    import: '导入',
  };
  return map[kind] ?? kind;
}

export function exportAllMarkdown(): ExportedDocument {
  const documents = listDocuments();
  const lines: string[] = [];

  lines.push('# 作文本 · 全部作文');
  lines.push('');
  lines.push(`导出时间：${formatDate(new Date().toISOString())}`);
  lines.push('');
  lines.push(`共 ${documents.length} 篇作文。`);
  lines.push('');
  lines.push('## 目录');
  lines.push('');
  documents.forEach((document, index) => {
    lines.push(
      `${index + 1}. ${document.title.trim() || '无题'}（${document.ownerName} · ${document.charCount} 字）`,
    );
  });
  lines.push('');

  for (const summary of documents) {
    const { markdown } = exportDocumentMarkdown(summary.id);
    lines.push('');
    lines.push('---');
    lines.push('');
    // 顶层标题降一级，避免和目录抢层级。
    lines.push(markdown.replace(/^# /, '## '));
  }

  const fileName = `作文本-全部作文-${new Date()
    .toISOString()
    .slice(0, 10)}.md`;

  return { fileName, markdown: lines.join('\n') };
}

export function exportDocumentOrThrow(documentId: string): ExportedDocument {
  getDocumentOrThrow(documentId);
  return exportDocumentMarkdown(documentId);
}
