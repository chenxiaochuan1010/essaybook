/**
 * 无头 Chrome + CDP 完整流程：
 * 起名字 → 写作 → 提交审阅 → 爸爸修订 → 小朋友处理 → 生成成品
 * → 版本标记 → 删除/恢复 → 爸爸彻底删除 → 审阅者打开草稿的只读态。
 *
 * 用法：node scripts/ui-test.mjs [baseUrl]
 * 需要本机安装 Google Chrome，并且服务已启动。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOT_DIR = path.resolve('artifacts/ui');
const DEBUG_PORT = 9333;

fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'essaybook-chrome-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--window-size=1100,1400',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const cleanup = () => {
  try {
    chrome.kill('SIGKILL');
  } catch {
    // ignore
  }
  fs.rmSync(userDataDir, { recursive: true, force: true });
};

process.on('exit', cleanup);

async function findTarget() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find(
        (target) => target.type === 'page' && target.webSocketDebuggerUrl,
      );
      if (page) return page;
    } catch {
      // Chrome 还没起来
    }
    await sleep(150);
  }
  throw new Error('连不上 Chrome 调试端口');
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }

  if (message.method === 'Runtime.exceptionThrown') {
    const detail = message.params.exceptionDetails;
    pageErrors.push(
      detail.exception?.description ?? detail.text ?? '未知页面异常',
    );
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(
      message.params.args
        .map((arg) => arg.value ?? arg.description ?? '')
        .join(' '),
    );
  }
};

function send(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `页面脚本出错：${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
    );
  }
  return result.result.value;
}

async function waitFor(expression, label, timeout = 20000) {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      const value = await evaluate(expression);
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(220);
  }
  try {
    const body = await evaluate(`document.body.innerText.slice(0, 900)`);
    console.error(`\n[超时现场 ${label}]\n${body}`);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(SHOT_DIR, `timeout-${label.replace(/[^\w\u4e00-\u9fa5-]+/g, '_')}.png`),
      Buffer.from(data, 'base64'),
    );
    console.error(`[控制台]\n${consoleErrors.join('\n')}`);
    console.error(`[页面异常]\n${pageErrors.join('\n')}`);
  } catch {
    // 现场信息收集失败时忽略
  }
  throw new Error(
    `等待超时：${label}${lastError ? `（${lastError.message}）` : ''}`,
  );
}

async function clickText(text, selector = 'button') {
  const ok = await evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = nodes.find((node) => (node.textContent || '').trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`找不到可点击元素：${text} (${selector})`);
  await sleep(180);
}

async function clickModal(text) {
  await waitFor(`Boolean(document.querySelector('.modal-card'))`, '弹窗出现');
  await clickText(text, '.modal-card button');
}

async function clickInCard(title, selector) {
  const ok = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.document-card')]
      .find((node) => (node.innerText || '').includes(${JSON.stringify(title)}));
    if (!card) return false;
    const el = card.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`卡片里找不到 ${selector}：${title}`);
  await sleep(180);
}

async function setValue(selector, value) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`找不到输入框：${selector}`);
  await sleep(140);
}

/** 用真实鼠标点击元素，确保 focus 事件和 React 的 onFocus 都会触发。 */
async function clickElement(selector, offsetY = 48) {
  const box = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + ${offsetY} };
  })()`);
  if (!box) throw new Error(`找不到元素：${selector}`);
  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: box.x,
    y: box.y,
    button: 'left',
    clickCount: 1,
  });
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: box.x,
    y: box.y,
    button: 'left',
    clickCount: 1,
  });
  await sleep(300);
}

async function screenshot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(SHOT_DIR, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  console.log(`   截图 → ${file}`);
}

async function switchTo(name) {
  await clickText('', '.profile-chip');
  await waitFor(`Boolean(document.querySelector('.modal-card'))`, '切换身份弹窗');
  await clickModal('切换');
  await waitFor(
    `Boolean(document.querySelector('.profile-panel'))`,
    '身份选择页',
    25000,
  );
  await clickText(name, '.profile-card');
  await waitFor(`Boolean(document.querySelector('.shelf-hero'))`, `以${name}登录`);
}

const title = `秋天的傍晚 ${Date.now().toString().slice(-5)}`;
const childName = '小雨';
const baseContent =
  '　　秋天的傍晚，天边烧起了橘红色的晚霞。\n　　我和爸爸沿着河边散步，风里有一股桂花的香味。\n　　回家的路上，我捡到了一片金黄的银杏叶。';
const editedContent =
  '　　秋天的傍晚，天边烧起了橘红色的晚霞，像一条柔软的绸带。\n　　我和爸爸沿着河边慢慢散步，风里飘着淡淡的桂花香。\n　　回家的路上，我捡到了一片金黄的银杏叶，把它夹进了最喜欢的书里。';

console.log('1. 打开身份选择页');
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1100,
  height: 1400,
  deviceScaleFactor: 2,
  mobile: false,
});
await send('Page.navigate', { url: `${BASE}/` });
await waitFor(`document.readyState === 'complete'`, '页面加载');
await waitFor(`Boolean(document.querySelector('.profile-panel'))`, '身份选择页出现');
await screenshot('01-profiles');

console.log('2. 小朋友第一次进入，填写名字');
await clickText('小朋友', '.profile-card');
await waitFor(
  `Boolean(document.querySelector('.onboarding-card'))`,
  '起名字页出现',
);
await screenshot('02-onboarding');
await setValue('.onboarding-input', childName);
await clickText('开始写作', '.onboarding-card button');
await waitFor(`Boolean(document.querySelector('.shelf-hero'))`, '进入书架');
await waitFor(
  `document.querySelector('.profile-chip-name')?.textContent?.includes(${JSON.stringify(childName)})`,
  '顶栏显示新名字',
);
await screenshot('03-shelf-empty');

console.log('3. 新建作文并写作');
await waitFor(
  `[...document.querySelectorAll('button')].some((button) => button.textContent.includes('新建作文'))`,
  '新建作文按钮',
);
await clickText('新建作文');
await waitFor(`Boolean(document.querySelector('.editor-textarea'))`, '编辑器出现');
await setValue('.title-input', title);
await clickElement('.editor-textarea');
await waitFor(
  `document.querySelector('.editor-textarea')?.value.startsWith('　　')`,
  '第一段自动首行缩进',
);
await setValue('.editor-textarea', baseContent);
const savedContent = await evaluate(
  `document.querySelector('.editor-textarea').value`,
);
assert(savedContent === baseContent, '正文已写入编辑器');
await screenshot('04-writing');

console.log('4. 立刻提交给爸妈修订（验证提交前会强制保存）');
await clickText('交给爸妈修订');
await clickModal('交给爸妈');
await waitFor(
  `document.body.innerText.includes('正在等爸爸妈妈修订')`,
  '进入审阅状态',
);
await waitFor(
  `(async () => {
    const doc = await (await fetch('/api/documents/' + location.pathname.split('/').pop())).json();
    if (!doc.document.activeRoundId) return false;
    const round = await (await fetch('/api/rounds/' + doc.document.activeRoundId)).json();
    return round.round.baseContent === ${JSON.stringify(baseContent)};
  })()`,
  '审阅基准版本包含刚写的内容',
  15000,
);
assert(
  (await evaluate(`document.querySelector('.editor-textarea').readOnly`)) === true,
  '审阅中正文锁定',
);
await screenshot('05-review-locked');

console.log('5. 切换为爸爸，进入修订副本');
await switchTo('爸爸');
await waitFor(
  `document.body.innerText.includes(${JSON.stringify(title)})`,
  '书架上出现新作文',
);
await clickText('去修订');
await waitFor(`Boolean(document.querySelector('.editor-textarea'))`, '修订编辑器');
await waitFor(
  `document.querySelector('.editor-textarea').value.includes('秋天的傍晚')`,
  '修订副本载入基准正文',
);
assert(
  (await evaluate(`document.querySelector('.editor-textarea').readOnly`)) === false,
  '修订副本可编辑',
);
await setValue('.editor-textarea', editedContent);
await waitFor(`document.body.innerText.includes('已修改')`, '检测到修改');
await screenshot('06-review-editing');

console.log('6. 爸爸提交修订');
await clickText('提交修订');
await clickModal('提交');
await waitFor(
  `document.body.innerText.includes('你已经提交了修订')`,
  '提交成功',
);
await screenshot('07-review-submitted');

console.log('7. 小朋友处理修订，一键生成成品');
await switchTo(childName);
await waitFor(
  `document.body.innerText.includes('去处理 1 份修订')`,
  '书架显示待处理修订',
);
await clickText('去处理 1 份修订');
await waitFor(`Boolean(document.querySelector('.resolve-page'))`, '修订处理页');
await waitFor(`document.body.innerText.includes('爸爸的修订')`, '显示爸爸的修订');
await screenshot('08-resolve');

await clickText('全部接受', '.resolve-header-actions button');
await clickModal('全部接受');
await waitFor(
  `document.querySelectorAll('.change-card.change-accepted').length > 0`,
  '出现已接受标记',
);
await screenshot('09-resolve-accepted');

await clickText('完成并生成成品', '.resolve-footer button');
await clickModal('生成成品');
await waitFor(`Boolean(document.querySelector('.finish-page'))`, '成品页出现');
await waitFor(`Boolean(document.querySelector('.finished-sheet'))`, '成品纸面出现');
await sleep(700);
assert(
  (await evaluate(`Boolean(document.querySelector('.skip-animation'))`)) === true,
  '打字过程中有跳过按钮',
);
assert(
  (await evaluate(`Boolean(document.querySelector('.sheet-seal'))`)) === false,
  '打字过程中印章还没盖下',
);
await screenshot('10-typewriter');

await waitFor(
  `!document.querySelector('.finish-page')?.classList.contains('is-celebrating')`,
  '打字动画结束',
  12000,
);
const sheetText = await evaluate(
  `document.querySelector('.finished-sheet')?.innerText ?? ''`,
);
assert(sheetText.includes('秋天的傍晚'), '成品页包含标题');
assert(sheetText.includes('像一条柔软的绸带'), '成品页包含合并后的正文');
assert(sheetText.includes('第 1 篇'), '成品页包含第 1 篇编号');
assert(
  (await evaluate(`document.querySelector('.sheet-seal')?.innerText ?? ''`)).includes(
    '已完稿',
  ),
  '成品页有「已完稿」印章',
);
await waitFor(`Boolean(document.querySelector('.fee-card'))`, '稿费卡片出现');
const feeText = await evaluate(
  `document.querySelector('.fee-card')?.innerText ?? ''`,
);
assert(feeText.includes('本篇稿费'), '显示本篇稿费');
assert(feeText.includes('今日合计'), '显示今日稿费合计');
assert(feeText.includes('¥'), '稿费显示为金额');
assert(feeText.includes('74 字'), '稿费按字数结算');
assert(
  (await evaluate(
    `[...document.querySelectorAll('.finish-actions button')].some((b) => b.textContent.includes('打印'))`,
  )) === true,
  '成品页有打印按钮',
);
await sleep(700);
await screenshot('11-finished');

console.log('7.1 继续修改后直接生成成品（不需要爸妈再审）');
await clickText('继续修改', '.finish-actions button');
await waitFor(`Boolean(document.querySelector('.writing-page'))`, '回到写作页');
await waitFor(
  `[...document.querySelectorAll('.writing-footer button')].some((button) => button.textContent.includes('生成成品'))`,
  '出现直接生成成品按钮',
);
const republishedContent = `${editedContent}\n　　后来我又补充了一句。`;
await setValue('.editor-textarea', republishedContent);
await clickText('生成成品', '.writing-footer button');
await clickModal('生成成品');
await waitFor(`Boolean(document.querySelector('.finish-page'))`, '再次进入成品页');
await waitFor(`Boolean(document.querySelector('.skip-animation'))`, '再次播放打字动画');
await clickText('跳过动画', '.skip-animation');
await waitFor(`Boolean(document.querySelector('.sheet-seal'))`, '跳过动画后盖章');
await waitFor(
  `document.querySelector('.finished-sheet')?.innerText.includes('后来我又补充了一句')`,
  '成品包含二次修改',
);
await screenshot('11b-republished');

console.log('8. 版本记录与手动标记');
await clickText('版本记录', '.finish-actions button');
await waitFor(`Boolean(document.querySelector('.history-page'))`, '历史页');
await waitFor(
  `document.body.innerText.includes('生成成品')`,
  '历史里显示成品版本',
);
const versionCountBefore = await evaluate(
  `document.querySelectorAll('.history-item').length`,
);
await clickText('打一个标记', '.page-header-actions button');
await waitFor(`Boolean(document.querySelector('.marker-input'))`, '标记输入框');
await setValue('.marker-input', '第一稿');
await clickModal('保存标记');
await waitFor(
  `document.querySelectorAll('.history-item').length > ${versionCountBefore}`,
  '版本数量增加',
);
await waitFor(
  `document.body.innerText.includes('第一稿')`,
  '标记备注出现',
);
await screenshot('12-history');

console.log('9. 回到书架，检查成品卡片');
await clickText('←', '.icon-button');
await waitFor(`Boolean(document.querySelector('.writing-page'))`, '回到作文页');
await clickText('查看成品', '.writing-footer button');
await waitFor(`Boolean(document.querySelector('.finish-page'))`, '再次进入成品页');
await clickText('返回书架', '.finish-actions button');
await waitFor(`Boolean(document.querySelector('.shelf-hero'))`, '回到书架');
await waitFor(
  `[...document.querySelectorAll('.document-card')].some((card) => card.innerText.includes('已完成') && card.innerText.includes('第 1 篇'))`,
  '书架显示成品徽标和编号',
);
await screenshot('13-shelf-finished');

console.log('9.5 小朋友申请稿费结算');
await waitFor(`Boolean(document.querySelector('.shelf-fee-bar'))`, '稿费条出现');
await waitFor(
  `document.body.innerText.includes('未结算')`,
  '显示未结算稿费',
);
await clickText('申请稿费结算', '.shelf-fee-bar button');
await clickModal('申请结算');
await waitFor(
  `document.body.innerText.includes('等待爸妈确认')`,
  '显示等待爸妈确认',
);
await screenshot('13b-settlement-requested');

console.log('10. 小朋友删除成品，再从回收站恢复');
await clickInCard(title, '.card-delete');
await clickModal('删除');
await waitFor(
  `![...document.querySelectorAll('.document-card')].some((card) => card.innerText.includes(${JSON.stringify(title)}))`,
  '成品卡片从书架消失',
);
await screenshot('14-shelf-after-delete');

await clickText('设置', '.topbar-actions button');
await waitFor(`Boolean(document.querySelector('.settings-page'))`, '设置页');

console.log('10.1 切换暗色主题');
await clickText('暗色', '.theme-option');
await waitFor(
  `document.documentElement.dataset.theme === 'dark'`,
  '暗色主题生效',
);
await screenshot('15a-settings-dark');
await clickText('明亮', '.theme-option');
await waitFor(
  `document.documentElement.dataset.theme === 'light'`,
  '恢复明亮主题',
);

await clickText('打开回收站');
await waitFor(
  `document.body.innerText.includes('删除的作文')`,
  '回收站页',
);
assert(
  (await evaluate(
    `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('彻底删除'))`,
  )) === false,
  '小朋友看不到彻底删除按钮',
);
await screenshot('15-trash-child');
await clickText('恢复', '.document-card button');
await waitFor(
  `document.querySelectorAll('.document-card').length === 0`,
  '回收站清空',
);
await clickText('←', '.icon-button');
await waitFor(`Boolean(document.querySelector('.shelf-hero'))`, '回到书架');

console.log('11. 再删除一次，并留一篇草稿给爸爸测试只读态');
const draftId = await evaluate(`(async () => {
  const response = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '爸爸看到的草稿' }),
  });
  const data = await response.json();
  return data.document.id;
})()`);
await clickInCard(title, '.card-delete');
await clickModal('删除');
await waitFor(
  `![...document.querySelectorAll('.document-card')].some((card) => card.innerText.includes(${JSON.stringify(title)}))`,
  '成品再次从书架消失',
);
await waitFor(
  `document.body.innerText.includes('爸爸看到的草稿')`,
  '草稿出现在书架',
  15000,
);

console.log('12. 爸爸确认稿费结算，然后打开草稿');
await switchTo('爸爸');
await waitFor(
  `document.body.innerText.includes('爸爸看到的草稿')`,
  '爸爸看到草稿',
);
await waitFor(
  `Boolean(document.querySelector('.shelf-settlement'))`,
  '爸爸看到结算申请',
);
await screenshot('18-settlement-dad');
await clickText('确认结算', '.shelf-settlement button');
await clickModal('确认结算');
await waitFor(
  `document.body.innerText.includes('已结算')`,
  '确认结算成功',
);
await waitFor(
  `[...document.querySelectorAll('.fee-summary-inline > div')].some(
    (node) => node.innerText.includes('未结算') && node.innerText.includes('¥0.00'),
  )`,
  '未结算稿费清零',
);
await screenshot('18b-settlement-confirmed');

await clickText('稿费明细', '.shelf-fee-bar button');
await waitFor(`Boolean(document.querySelector('.fees-page'))`, '稿费明细页');
await waitFor(
  `document.body.innerText.includes('已结算')`,
  '稿费历史显示已结算',
);
await waitFor(
  `document.body.innerText.includes('爸爸 结算')`,
  '记录由爸爸结算',
);
await screenshot('18c-fees-history');
await clickText('←', '.icon-button');
await waitFor(`Boolean(document.querySelector('.shelf-hero'))`, '回到书架');

await clickInCard('爸爸看到的草稿', '.document-card-main');
await waitFor(`Boolean(document.querySelector('.writing-page'))`, '打开草稿');
await waitFor(
  `document.querySelector('.editor-textarea')?.readOnly === true`,
  '草稿对爸爸只读',
);
const draftBody = await evaluate('document.body.innerText');
assert(
  !draftBody.includes('交给爸妈修订'),
  '爸爸身份不显示「交给爸妈修订」',
);
assert(
  draftBody.includes('这是小朋友的草稿'),
  '爸爸身份显示等待提示',
);
await screenshot('16-reviewer-draft');

console.log('13. 爸爸彻底删除回收站里的成品');
await clickText('设置', '.topbar-actions button');
await waitFor(`Boolean(document.querySelector('.settings-page'))`, '设置页');
await clickText('打开回收站');
await waitFor(
  `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('彻底删除'))`,
  '爸爸看到彻底删除按钮',
);
await screenshot('17-trash-parent');
await clickText('彻底删除', '.document-card button');
await clickModal('彻底删除');
await waitFor(
  `document.querySelectorAll('.document-card').length === 0`,
  '回收站清空',
);

if (pageErrors.length > 0) {
  throw new Error(`页面异常：\n${pageErrors.join('\n')}`);
}

const relevantConsoleErrors = consoleErrors.filter(
  (line) => !line.includes('favicon') && !line.includes('Download the React DevTools'),
);
if (relevantConsoleErrors.length > 0) {
  throw new Error(`控制台错误：\n${relevantConsoleErrors.join('\n')}`);
}

console.log(`\nUI 全流程测试通过 ✅（草稿 ${draftId} 保留，测试结束后请重置数据）`);
ws.close();
cleanup();
process.exit(0);
