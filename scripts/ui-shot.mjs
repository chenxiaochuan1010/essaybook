/**
 * 打开应用并截图，用于快速查看某个页面的实际渲染效果。
 *
 * 用法：node scripts/ui-shot.mjs [path] [outName] [--login=小朋友]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const CHROME =
  process.env.CHROME_PATH ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9336;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const loginArg = process.argv.find((arg) => arg.startsWith('--login='));
const loginAs = loginArg ? loginArg.split('=')[1] : null;
const printMedia = process.argv.includes('--print');
const darkTheme = process.argv.includes('--dark');
const targetPath = args[0] ?? '/';
const outName = args[1] ?? 'shot';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'essaybook-shot-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${dir}`,
    '--no-first-run',
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
  fs.rmSync(dir, { recursive: true, force: true });
};
process.on('exit', cleanup);

let page;
for (let i = 0; i < 80; i += 1) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    page = list.find((target) => target.type === 'page');
    if (page) break;
  } catch {
    // Chrome 还没起来
  }
  await sleep(150);
}
if (!page) throw new Error('连不上 Chrome');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    logs.push('异常：' + (message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text));
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    logs.push('console.error：' + message.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
};

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1100,
  height: 1400,
  deviceScaleFactor: 2,
  mobile: false,
});
if (printMedia) {
  await send('Emulation.setEmulatedMedia', { media: 'print' });
}
await send('Page.navigate', { url: `${BASE}${targetPath}` });

for (let i = 0; i < 60; i += 1) {
  if (await evaluate(`document.readyState === 'complete'`)) break;
  await sleep(200);
}
await sleep(1200);

if (loginAs) {
  const clicked = await evaluate(`(() => {
    const card = [...document.querySelectorAll('.profile-card')]
      .find((node) => (node.textContent || '').includes(${JSON.stringify(loginAs)}));
    if (!card) return false;
    card.click();
    return true;
  })()`);
  if (!clicked) console.error(`没有找到身份：${loginAs}（可能已经登录）`);
  await sleep(2500);
}

if (darkTheme) {
  await evaluate(`document.documentElement.dataset.theme = 'dark'`);
  await sleep(600);
}

const body = await evaluate('document.body.innerText');
console.log('--- 页面文本 ---');
console.log(body.slice(0, 600));

const { data } = await send('Page.captureScreenshot', { format: 'png' });
const outDir = path.resolve('artifacts/ui');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${outName}.png`);
fs.writeFileSync(file, Buffer.from(data, 'base64'));
console.log(`截图 → ${file}`);

if (logs.length > 0) {
  console.error('--- 页面错误 ---');
  console.error(logs.join('\n'));
}

ws.close();
cleanup();
process.exit(0);
