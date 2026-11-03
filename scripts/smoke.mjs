const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';

let cookie = '';

async function request(path, options = {}) {
  const headers = {
    ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(cookie ? { cookie } : {}),
    ...(options.headers ?? {}),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const error = new Error(`${options.method ?? 'GET'} ${path} -> ${res.status}: ${text}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}

async function login(userId) {
  cookie = '';
  return request('/api/session', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

const baseText = '　　我的妈妈有一双温暖的手。\n　　她每天早起为我做早饭。\n　　我爱我的妈妈。';
const editedText = '　　我的妈妈有一双温暖而有力的手。\n　　她每天早起为我做早饭。\n　　我永远爱我的妈妈。';

console.log('1. 登录孩子');
const child = await login('u_child');
assert(child.user.id === 'u_child', '孩子登录');

console.log('2. 新建作文');
const created = await request('/api/documents', {
  method: 'POST',
  body: JSON.stringify({ title: '我的妈妈' }),
});
const docId = created.document.id;
assert(created.document.status === 'draft', '新文档为草稿');

console.log('3. 自动保存');
const saved = await request(`/api/documents/${docId}`, {
  method: 'PATCH',
  body: JSON.stringify({ content: baseText }),
});
assert(saved.document.content === baseText, '内容保存成功');
assert(saved.document.wordCount.chars > 0, '字数统计');

console.log('3.5 草稿不能直接生成成品');
let draftPublishStatus = 0;
try {
  await request(`/api/documents/${docId}/publish`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
} catch (error) {
  draftPublishStatus = error.status;
}
assert(draftPublishStatus === 409, '草稿生成成品被拒绝');

console.log('4. 提交审阅');
const round = await request(`/api/documents/${docId}/rounds`, {
  method: 'POST',
  body: JSON.stringify({}),
});
const roundId = round.round.id;
assert(round.round.status === 'open', '审阅轮次已开启');
assert(round.round.baseContent === baseText, '基准版本正确');

console.log('5. 爸爸提交修订');
await login('u_dad');
const submission = await request(`/api/rounds/${roundId}/submissions`, {
  method: 'POST',
  body: JSON.stringify({ content: editedText }),
});
assert(submission.submission.changes.length > 0, '生成了修改块');
console.log('   修改块数量:', submission.submission.changes.length);

console.log('6. 孩子查看并接受');
await login('u_child');
const detail = await request(`/api/rounds/${roundId}`);
assert(detail.round.submissions.length === 1, '看到一份提交');
const changes = detail.round.submissions[0].changes;
for (const change of changes) {
  await request(`/api/changes/${change.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'accepted' }),
  });
}

console.log('7. 合并');
const merged = await request(`/api/rounds/${roundId}/merge`, {
  method: 'POST',
  body: JSON.stringify({}),
});
assert(merged.document.status === 'draft', '合并后回到草稿');
assert(merged.document.content === editedText, '合并内容正确');
console.log('   接受修订数:', merged.acceptedCount);

console.log('8. 版本历史');
const versions = await request(`/api/documents/${docId}/versions`);
assert(versions.versions.length >= 2, '至少两个版本');
const mergeVersion = versions.versions.find((v) => v.kind === 'merge');
assert(mergeVersion, '存在合并版本');
const versionDetail = await request(`/api/versions/${mergeVersion.id}`);
assert(versionDetail.version.content === editedText, '版本内容正确');

console.log('9. 冲突检测');
const round2 = await request(`/api/documents/${docId}/rounds`, {
  method: 'POST',
  body: JSON.stringify({}),
});
const round2Id = round2.round.id;
await login('u_dad');
const dadSub = await request(`/api/rounds/${round2Id}/submissions`, {
  method: 'POST',
  body: JSON.stringify({ content: editedText.replace('温暖而有力', '温柔而有力') }),
});
await login('u_mom');
const momSub = await request(`/api/rounds/${round2Id}/submissions`, {
  method: 'POST',
  body: JSON.stringify({ content: editedText.replace('温暖而有力', '暖和而有力') }),
});
await login('u_child');
for (const change of [...dadSub.submission.changes, ...momSub.submission.changes]) {
  await request(`/api/changes/${change.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'accepted' }),
  });
}
const conflicts = await request(`/api/rounds/${round2Id}/conflicts`);
assert(conflicts.conflicts.length > 0, '检测到冲突');
let mergeStatus = 0;
try {
  await request(`/api/rounds/${round2Id}/merge`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
} catch (error) {
  mergeStatus = error.status;
}
assert(mergeStatus === 409, '冲突时合并返回 409');

console.log('10. 撤回审阅');
const cancelled = await request(`/api/rounds/${round2Id}/cancel`, {
  method: 'POST',
  body: JSON.stringify({}),
});
assert(cancelled.round.status === 'cancelled', '审阅已撤回');

console.log('11. 第一次使用填写名字');
const renamed = await request('/api/me', {
  method: 'PATCH',
  body: JSON.stringify({ name: '小雨' }),
});
assert(renamed.user.name === '小雨', '名字已更新');
assert(renamed.user.onboardedAt, '记录首次使用完成');
let emptyNameStatus = 0;
try {
  await request('/api/me', {
    method: 'PATCH',
    body: JSON.stringify({ name: '   ' }),
  });
} catch (error) {
  emptyNameStatus = error.status;
}
assert(emptyNameStatus === 400, '空名字被拒绝');

console.log('12. 生成成品与继续修改');
const published = await request(`/api/documents/${docId}/publish`, {
  method: 'POST',
  body: JSON.stringify({}),
});
assert(published.document.status === 'final', '文档进入成品状态');
assert(published.number >= 1, '分配了成品编号');
assert(published.document.publishedAt, '记录成品时间');
const publishNumber = published.number;

const statsAfterPublish = await request('/api/stats');
const rate = statsAfterPublish.stats.rateCentsPerChar;
assert(rate > 0, '稿费标准有效');
assert(
  published.document.publishFeeCents ===
    published.document.wordCount.chars * rate,
  '稿费按成稿字数计算',
);
assert(
  statsAfterPublish.stats.today.feeCents >= published.document.publishFeeCents,
  '今日稿费包含本篇',
);
assert(
  statsAfterPublish.stats.total.pieces >= 1,
  '累计完稿篇数增加',
);

let lockedStatus = 0;
try {
  await request(`/api/documents/${docId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content: '想偷偷改掉' }),
  });
} catch (error) {
  lockedStatus = error.status;
}
assert(lockedStatus === 409, '成品正文不可修改');

const reopened = await request(`/api/documents/${docId}/reopen`, {
  method: 'POST',
  body: JSON.stringify({}),
});
assert(reopened.document.status === 'draft', '继续修改后回到草稿');
assert(reopened.document.publishNumber === publishNumber, '重新打开后保留编号');

const republished = await request(`/api/documents/${docId}/publish`, {
  method: 'POST',
  body: JSON.stringify({}),
});
assert(republished.number === publishNumber, '重新生成沿用同一个编号');

console.log('12.5 稿费结算');
let fees = await request('/api/fees');
assert(
  fees.overview.unsettledFeeCents >= published.document.publishFeeCents,
  '未结算稿费包含本篇',
);

const settlement = await request('/api/fees/request', {
  method: 'POST',
  body: JSON.stringify({}),
});
assert(settlement.settlement.status === 'pending', '生成待确认的结算');
assert(
  settlement.amountCents === fees.overview.unsettledFeeCents,
  '结算金额等于未结算稿费',
);

let childConfirmStatus = 0;
try {
  await request(`/api/fees/requests/${settlement.settlement.id}/confirm`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
} catch (error) {
  childConfirmStatus = error.status;
}
assert(childConfirmStatus === 403, '小朋友不能自己确认结算');

await login('u_dad');
const confirmed = await request(
  `/api/fees/requests/${settlement.settlement.id}/confirm`,
  { method: 'POST', body: JSON.stringify({}) },
);
assert(confirmed.settlement.status === 'confirmed', '爸爸确认结算');

fees = await request('/api/fees');
assert(fees.overview.unsettledFeeCents === 0, '结算后未结算清零');
assert(
  fees.overview.settledFeeCents >= settlement.amountCents,
  '累计稿费增加',
);
const feeRecord = fees.fees.find((item) => item.documentId === docId);
assert(feeRecord?.status === 'settled', '稿费记录标记为已结算');
assert(feeRecord?.settledByName === '爸爸', '记录由谁结算');

console.log('13. 删除与彻底删除权限');
await login('u_child');
await request(`/api/documents/${docId}`, { method: 'DELETE' });
let childPurgeStatus = 0;
try {
  await request(`/api/documents/${docId}/permanent`, { method: 'DELETE' });
} catch (error) {
  childPurgeStatus = error.status;
}
assert(childPurgeStatus === 403, '小朋友不能彻底删除');

await login('u_dad');
const purged = await request(`/api/documents/${docId}/permanent`, { method: 'DELETE' });
assert(purged.ok === true, '爸爸可以彻底删除');
const trash = await request('/api/trash');
assert(
  !trash.documents.some((document) => document.id === docId),
  '彻底删除后回收站不再出现',
);

const feesAfterPurge = await request('/api/fees');
assert(
  feesAfterPurge.fees.some((item) => item.documentId === docId),
  '彻底删除后稿费记录仍然保留',
);
assert(
  feesAfterPurge.overview.settledFeeCents >= settlement.amountCents,
  '累计稿费不因删除而减少',
);

console.log('\n全部冒烟测试通过 ✅');
